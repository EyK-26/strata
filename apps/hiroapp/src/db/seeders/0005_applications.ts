import type { Seeder } from "@getstrata/core/database/seeders/types";
import { seedScale } from "../../bootstrap/config.ts";
import { ROLE } from "../../lib/roles.ts";
import { Position } from "../../models/Position.ts";
import { User } from "../../models/User.ts";
import { positions } from "../../modules/positions/repository.ts";
import { users } from "../../modules/users/repository.ts";
import { applicationFactory } from "../factories/applicationFactory.ts";

const seeder: Seeder = {
  name: "applications",
  async run() {
    const { applications: count } = seedScale();
    const candidates = await users.findWherePublic({ role_id: ROLE.CANDIDATE });
    const hiring = await positions.hiring();
    const demo = await users.findByEmail("candidate@hiroapp.com");
    const used = new Set<string>();
    let created = 0;

    const tryCreate = async (
      user: (typeof candidates)[number],
      position: (typeof hiring)[number],
    ) => {
      const key = `${user.id}:${position.id}`;
      if (used.has(key) || created >= count) return;
      used.add(key);
      await applicationFactory
        .for(User.newFromRecord(user))
        .for(Position.newFromRecord(position))
        .create();
      created += 1;
    };

    if (demo && hiring[0]) {
      await tryCreate(demo, hiring[0]);
    }

    for (const candidate of candidates) {
      for (const position of hiring) {
        if (created >= count) return;
        if (Math.random() > 0.35) continue;
        await tryCreate(candidate, position);
      }
    }

    let candidateIndex = 0;
    let positionIndex = 0;
    while (created < count && candidates.length > 0 && hiring.length > 0) {
      await tryCreate(
        candidates[candidateIndex % candidates.length]!,
        hiring[positionIndex % hiring.length]!,
      );
      candidateIndex += 1;
      if (candidateIndex % candidates.length === 0) positionIndex += 1;
      if (positionIndex >= hiring.length && candidateIndex >= candidates.length) break;
    }
  },
};

export default seeder;
