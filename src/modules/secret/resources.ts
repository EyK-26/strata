import { toResourceCollection } from "../../core/http";
import type { Secret } from "../../types/secret";

interface SecretResource {
  id: number;
  secret_code: string;
  nemesis_id: number;
}

function toSecretResource(secret: Secret): SecretResource {
  return {
    id: secret.id,
    secret_code: secret.secret_code,
    nemesis_id: secret.nemesis_id,
  };
}

function toSecretResourceCollection(
  secrets: readonly Secret[],
): SecretResource[] {
  return toResourceCollection(secrets, toSecretResource);
}

export { toSecretResource, toSecretResourceCollection };
export type { SecretResource };
