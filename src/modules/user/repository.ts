import { emailLookupForQuery, protectEmail, revealEmail } from "../../core/crypto/fieldEncryption";
import { BaseRepository } from "../../core/database";
import type { QueryWhere } from "../../core/database/types";
import { currentTenantId } from "../../core/tenant/tenantContext";
import { userTable } from "./table";
import type { UserRecord } from "./types";

type StoredUserRecord = UserRecord & { email_lookup?: string | null };

class UserRepository extends BaseRepository<UserRecord, "id"> {
  constructor() {
    super(userTable);
  }

  private decode(record: StoredUserRecord): UserRecord {
    return {
      ...record,
      email: revealEmail(record.email),
    };
  }

  override async findById(id: number): Promise<UserRecord | null> {
    const record = await super.findById(id);
    return record ? this.decode(record as StoredUserRecord) : null;
  }

  override async findAll(
    options: Parameters<BaseRepository<UserRecord, "id">["findAll"]>[0] = {},
  ): Promise<UserRecord[]> {
    const records = await super.findAll(options);
    return records.map((record) => this.decode(record as StoredUserRecord));
  }

  override async create(values: Partial<UserRecord>): Promise<UserRecord> {
    const email = values.email;

    if (!email) {
      throw new Error("Email is required.");
    }

    const protectedEmail = protectEmail(email);
    const record = await super.create({
      ...values,
      tenant_id: values.tenant_id ?? currentTenantId(),
      email: protectedEmail.storedEmail,
      email_lookup: protectedEmail.emailLookup,
    } as StoredUserRecord);

    return this.decode(record as StoredUserRecord);
  }

  override async updateByIdOrThrow(
    id: number,
    values: Partial<UserRecord>,
    errorFactory?: (missingId: number) => Error,
  ): Promise<UserRecord> {
    const changes = { ...values } as Partial<StoredUserRecord>;

    if (values.email !== undefined) {
      const protectedEmail = protectEmail(values.email);
      changes.email = protectedEmail.storedEmail;
      changes.email_lookup = protectedEmail.emailLookup;
    }

    const record = await super.updateByIdOrThrow(id, changes as Partial<UserRecord>, errorFactory);
    return this.decode(record as StoredUserRecord);
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const records = await this.findWhere(
      { email_lookup: emailLookupForQuery(email) } as unknown as QueryWhere<UserRecord>,
      { limit: 1 },
    );

    return records[0] ?? null;
  }
}

export default UserRepository;
