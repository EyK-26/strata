import { Factory } from "@getstrata/core/database/factory";
import type { UserRecord } from "../../modules/user/types";

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
}

const userFactory = new UserFactory();

export { UserFactory, userFactory };
