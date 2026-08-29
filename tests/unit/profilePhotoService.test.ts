import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashPassword } from "@getstrata/core/auth/password";
import type { ParsedUpload } from "@getstrata/core/http/parseMultipartUpload";
import { LocalStorageDriver, StorageManager } from "@getstrata/core/storage/storage";
import { runWithTenantDatabase } from "@getstrata/core/tenant/tenantDatabaseScope";
import ProfilePhotoService, {
  buildProfilePhotoPath,
  contentTypeForPhotoPath,
  extensionForContentType,
  PROFILE_PHOTO_WIDTH,
} from "../../src/modules/user/profilePhotoService";
import UserRepository from "../../src/modules/user/repository";
import { defaultTestTenant } from "./testHelpers";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function pngBytes(): Uint8Array {
  return Uint8Array.from(atob(PNG_BASE64), (char) => char.charCodeAt(0));
}

function pngUpload(mimeType = "image/png"): ParsedUpload {
  const contents = pngBytes();

  return {
    fileName: "avatar.png",
    mimeType,
    size: contents.byteLength,
    contents,
  };
}

async function createDisposableUser(users: UserRepository) {
  return await users.create({
    name: "Photo User",
    email: `photo-${Date.now()}-${crypto.randomUUID()}@workhub.test`,
    role: "member",
    tenant_id: defaultTestTenant.id,
    password_hash: await hashPassword("password"),
    created_at: new Date(),
    updated_at: new Date(),
  });
}

describe("ProfilePhotoService", () => {
  test("extension and content-type helpers cover stored formats", () => {
    expect(extensionForContentType("image/png")).toBe("png");
    expect(extensionForContentType("image/webp")).toBe("webp");
    expect(extensionForContentType("image/jpeg")).toBe("jpg");
    expect(contentTypeForPhotoPath("profile-photos/1/a.png")).toBe("image/png");
    expect(contentTypeForPhotoPath("profile-photos/1/a.webp")).toBe("image/webp");
    expect(contentTypeForPhotoPath("profile-photos/1/a.jpg")).toBe("image/jpeg");
    expect(buildProfilePhotoPath(9, "image/png")).toMatch(/^profile-photos\/9\/.+\.png$/);
    expect(PROFILE_PHOTO_WIDTH).toBe(400);
  });

  test("updatePhoto stores a resized image and replaces the previous file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "workhub-profile-photos-"));
    const storage = new StorageManager(new LocalStorageDriver(directory));

    try {
      await runWithTenantDatabase(defaultTestTenant, async () => {
        const users = new UserRepository();
        const service = new ProfilePhotoService(users, storage);
        const created = await createDisposableUser(users);

        const first = await service.updatePhoto(created.id, pngUpload());
        expect(first.profile_photo_path).toMatch(
          new RegExp(`^profile-photos/${created.id}/.+\\.png$`),
        );
        expect(await storage.get(first.profile_photo_path ?? "")).not.toBeNull();

        const jpeg = await service.updatePhoto(created.id, pngUpload("image/jpeg"));
        expect(jpeg.profile_photo_path).toMatch(/\.jpg$/);
        expect(await storage.get(first.profile_photo_path ?? "")).toBeNull();
        expect(await storage.get(jpeg.profile_photo_path ?? "")).not.toBeNull();

        const photo = await service.readPhoto(created.id);
        expect(photo.contentType).toBe("image/jpeg");
        expect(photo.contents.byteLength).toBeGreaterThan(0);
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("updatePhoto rejects non-image uploads", async () => {
    const directory = await mkdtemp(join(tmpdir(), "workhub-profile-photos-"));
    const storage = new StorageManager(new LocalStorageDriver(directory));

    try {
      await runWithTenantDatabase(defaultTestTenant, async () => {
        const users = new UserRepository();
        const service = new ProfilePhotoService(users, storage);
        const created = await createDisposableUser(users);

        await expect(
          service.updatePhoto(created.id, {
            fileName: "notes.txt",
            mimeType: "text/plain",
            size: 4,
            contents: new TextEncoder().encode("nope"),
          }),
        ).rejects.toThrow("Profile photos must be JPEG, PNG, GIF, or WebP.");
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("deletePhoto is a no-op without a stored path and removes an existing photo", async () => {
    const directory = await mkdtemp(join(tmpdir(), "workhub-profile-photos-"));
    const storage = new StorageManager(new LocalStorageDriver(directory));

    try {
      await runWithTenantDatabase(defaultTestTenant, async () => {
        const users = new UserRepository();
        const service = new ProfilePhotoService(users, storage);
        const created = await createDisposableUser(users);

        const unchanged = await service.deletePhoto(created.id);
        expect(unchanged.profile_photo_path ?? null).toBeNull();

        const uploaded = await service.updatePhoto(created.id, pngUpload());
        const removed = await service.deletePhoto(created.id);
        expect(removed.profile_photo_path).toBeNull();
        expect(await storage.get(uploaded.profile_photo_path ?? "")).toBeNull();
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("readPhoto rejects missing users, missing paths, and missing files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "workhub-profile-photos-"));
    const storage = new StorageManager(new LocalStorageDriver(directory));

    try {
      await runWithTenantDatabase(defaultTestTenant, async () => {
        const users = new UserRepository();
        const service = new ProfilePhotoService(users, storage);
        const created = await createDisposableUser(users);

        await expect(service.readPhoto(999_999_999)).rejects.toThrow("User 999999999 not found.");
        await expect(service.updatePhoto(999_999_999, pngUpload())).rejects.toThrow(
          "User 999999999 not found.",
        );
        await expect(service.deletePhoto(999_999_999)).rejects.toThrow("User 999999999 not found.");
        await expect(service.readPhoto(created.id)).rejects.toThrow("Profile photo not found.");

        await users.updateByIdOrThrow(created.id, {
          profile_photo_path: `profile-photos/${created.id}/missing.png`,
        });
        await expect(service.readPhoto(created.id)).rejects.toThrow("Profile photo not found.");
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("updatePhoto stores a webp when the upload is webp", async () => {
    const directory = await mkdtemp(join(tmpdir(), "workhub-profile-photos-"));
    const storage = new StorageManager(new LocalStorageDriver(directory));

    try {
      await runWithTenantDatabase(defaultTestTenant, async () => {
        const users = new UserRepository();
        const service = new ProfilePhotoService(users, storage);
        const created = await createDisposableUser(users);
        const webp = await new Bun.Image(pngBytes()).webp().bytes();

        const uploaded = await service.updatePhoto(created.id, {
          fileName: "avatar.webp",
          mimeType: "image/webp",
          size: webp.byteLength,
          contents: webp,
        });

        expect(uploaded.profile_photo_path).toMatch(/\.webp$/);
        const photo = await service.readPhoto(created.id);
        expect(photo.contentType).toBe("image/webp");
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
