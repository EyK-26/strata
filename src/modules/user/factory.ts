import { Factory } from "@getstrata/core/database/factory";
import UserRepository from "./repository";
import type { UserRecord } from "./types";

class UserFactory extends Factory<UserRecord> {
  protected override definition(): UserRecord {
    const now = new Date();

    return {
      id: 0,
      name: "Factory User",
      email: `factory-${crypto.randomUUID()}@workhub.test`,
      role: "member",
      tenant_id: 1,
      created_at: now,
      updated_at: now,
    };
  }

  protected override persist(values: Partial<UserRecord>): Promise<UserRecord> {
    return new UserRepository().create(values);
  }
}

const userFactory = new UserFactory();

export { UserFactory, userFactory };
