import { randomUUID } from "node:crypto";
import { BadRequestError, NotFoundError } from "@getstrata/core/errors/http";
import type { ParsedUpload } from "@getstrata/core/http/parseMultipartUpload";
import { isImageMimeType, resizeImageContents } from "@getstrata/core/media/imageTransform";
import type { StorageManager } from "@getstrata/core/storage/storage";
import type UserRepository from "./repository";
import type { UserRecord } from "./types";

const PROFILE_PHOTO_WIDTH = 400;
const profilePhotoServiceToken = "user.profilePhotoService";

type ProfilePhotoContents = {
  contents: Uint8Array;
  contentType: string;
};

function extensionForContentType(contentType: string): string {
  if (contentType === "image/png") {
    return "png";
  }

  if (contentType === "image/webp") {
    return "webp";
  }

  return "jpg";
}

function contentTypeForPhotoPath(path: string): string {
  if (path.endsWith(".png")) {
    return "image/png";
  }

  if (path.endsWith(".webp")) {
    return "image/webp";
  }

  return "image/jpeg";
}

function buildProfilePhotoPath(userId: number, contentType: string): string {
  return `profile-photos/${userId}/${randomUUID()}.${extensionForContentType(contentType)}`;
}

class ProfilePhotoService {
  constructor(
    private readonly users: UserRepository,
    private readonly storage: StorageManager,
  ) {}

  async updatePhoto(userId: number, upload: ParsedUpload): Promise<UserRecord> {
    const user = await this.requireUser(userId);

    if (!isImageMimeType(upload.mimeType)) {
      throw new BadRequestError("Profile photos must be JPEG, PNG, GIF, or WebP.");
    }

    const resized = await resizeImageContents(
      upload.contents,
      PROFILE_PHOTO_WIDTH,
      upload.mimeType,
    );
    const storagePath = buildProfilePhotoPath(userId, resized.contentType);
    await this.storage.put(storagePath, resized.body);

    const updated = await this.users.updateByIdOrThrow(userId, {
      profile_photo_path: storagePath,
      updated_at: new Date(),
    });

    await this.deleteStoredPhoto(user.profile_photo_path);

    return updated;
  }

  async deletePhoto(userId: number): Promise<UserRecord> {
    const user = await this.requireUser(userId);

    if (!user.profile_photo_path) {
      return user;
    }

    await this.deleteStoredPhoto(user.profile_photo_path);

    return await this.users.updateByIdOrThrow(userId, {
      profile_photo_path: null,
      updated_at: new Date(),
    });
  }

  async readPhoto(userId: number): Promise<ProfilePhotoContents> {
    const user = await this.requireUser(userId);

    if (!user.profile_photo_path) {
      throw new NotFoundError("Profile photo not found.");
    }

    const contents = await this.storage.get(user.profile_photo_path);

    if (!contents) {
      throw new NotFoundError("Profile photo not found.");
    }

    return {
      contents,
      contentType: contentTypeForPhotoPath(user.profile_photo_path),
    };
  }

  private async requireUser(userId: number): Promise<UserRecord> {
    return await this.users.findByIdOrThrow(
      userId,
      (id) => new NotFoundError(`User ${id} not found.`),
    );
  }

  private async deleteStoredPhoto(path: string | null | undefined): Promise<void> {
    if (!path) {
      return;
    }

    await this.storage.delete(path);
  }
}

export default ProfilePhotoService;
export type { ProfilePhotoContents };
export {
  buildProfilePhotoPath,
  contentTypeForPhotoPath,
  extensionForContentType,
  PROFILE_PHOTO_WIDTH,
  profilePhotoServiceToken,
};
