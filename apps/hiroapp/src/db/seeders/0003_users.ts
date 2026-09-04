import { hashPassword } from "@getstrata/core/auth/password";
import type { Seeder } from "@getstrata/core/database/seeders/types";
import { seedScale } from "../../bootstrap/config.ts";
import { ROLE } from "../../lib/roles.ts";
import { userFactory } from "../factories/userFactory.ts";

const seeder: Seeder = {
  name: "users",
  async run() {
    const password = await hashPassword("password");
    const { users } = seedScale();

    await userFactory
      .state({
        first_name: "Admin",
        last_name: "Hiro",
        email: "admin@hiroapp.com",
        password,
        role_id: ROLE.ADMIN,
      })
      .create();
    await userFactory
      .state({
        first_name: "Candidate",
        last_name: "Hiro",
        email: "candidate@hiroapp.com",
        password,
        role_id: ROLE.CANDIDATE,
      })
      .create();
    await userFactory
      .state({
        first_name: "Recruiter",
        last_name: "Hiro",
        email: "recruiter@hiroapp.com",
        password,
        role_id: ROLE.RECRUITER,
      })
      .create();

    for (let index = 3; index < users; index += 1) {
      const role_id =
        index % 10 === 0 ? ROLE.ADMIN : index % 5 === 0 ? ROLE.RECRUITER : ROLE.CANDIDATE;
      await userFactory.state({ password, role_id }).create();
    }
  },
};

export default seeder;
