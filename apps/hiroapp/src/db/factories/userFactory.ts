import { faker } from "@faker-js/faker";
import { Factory } from "@getstrata/core/database/factory";
import { ROLE } from "../../lib/roles.ts";
import { User } from "../../models/User.ts";
import type { UserRecord } from "../../modules/users/repository.ts";

export class UserFactory extends Factory<UserRecord> {
  protected model = User;

  protected definition(): UserRecord {
    const first_name = faker.person.firstName();
    const last_name = faker.person.lastName();
    return {
      id: 0,
      first_name,
      last_name,
      email: `${first_name}.${last_name}.${faker.string.alphanumeric(6)}@hiroapp.com`.toLowerCase(),
      password: "",
      role_id: faker.helpers.arrayElement([ROLE.ADMIN, ROLE.CANDIDATE, ROLE.RECRUITER]),
      created_at: null,
      updated_at: null,
    };
  }
}

export const userFactory = new UserFactory();
