import { Factory } from "../../core/database/factory";
import type { UserRecord } from "../../modules/user/types";

class UserFactory extends Factory<UserRecord> {
  protected definition(): UserRecord {
    const now = new Date();

    return {
      id: 0,
      name: "Factory User",
      email: `factory-${crypto.randomUUID()}@workhub.test`,
      role: "member",
      created_at: now,
      updated_at: now,
    };
  }
}

const userFactory = new UserFactory();

export { UserFactory, userFactory };
