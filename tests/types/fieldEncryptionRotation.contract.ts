import type { FieldEncryptionKeyring } from "@getstrata/core/crypto/fieldEncryption";
import {
  type FieldEncryptionRotationOptions,
  runFieldEncryptionRotationBatch,
} from "@getstrata/core/crypto/fieldEncryptionRotation";
import type { BaseRepository } from "@getstrata/core/database/baseRepository";

type Account = { id: number; email: string; lookup: string; mfa: string | null };
export async function rotationContract(
  repository: BaseRepository<Account, "id">,
  source: FieldEncryptionKeyring,
  target: FieldEncryptionKeyring,
) {
  const options: FieldEncryptionRotationOptions<Account, "id"> = {
    repository,
    runId: "admin_run",
    scopeId: "tenant_1",
    maintenanceMode: true,
    source,
    target,
    fields: [
      { column: "email", purpose: "email", lookupColumn: "lookup" },
      { column: "mfa", purpose: "mfa" },
    ],
  };
  const result = await runFieldEncryptionRotationBatch(options);
  const completed: boolean = result.completed;
  // @ts-expect-error Primary-key fields cannot be re-encrypted.
  options.fields = [{ column: "id", purpose: "email" }];
  return completed;
}
