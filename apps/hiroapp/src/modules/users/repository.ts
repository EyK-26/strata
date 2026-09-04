import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { type UserRecord, userTable } from "./table.ts";

class UserRepository extends BaseRepository<UserRecord, "id"> {
  constructor() {
    super(userTable);
  }

  async findByEmail(email: string) {
    return this.firstOrNull({ email: email.toLowerCase() });
  }

  async search(search: string, ids?: number[]) {
    const where: Record<string, unknown> = {};
    if (ids) {
      where.id = { in: ids };
    }
    if (search) {
      return this.findWhere(
        {
          ...where,
          last_name: { ilike: `%${search}%` },
        },
        { orderBy: { column: "last_name", direction: "ASC" } },
      ).then(async (byLast) => {
        const byFirst = await this.findWhere(
          {
            ...where,
            first_name: { ilike: `%${search}%` },
          },
          { orderBy: { column: "last_name", direction: "ASC" } },
        );
        const seen = new Set<number>();
        return [...byLast, ...byFirst].filter((user) => {
          if (seen.has(user.id)) return false;
          seen.add(user.id);
          return true;
        });
      });
    }
    return this.findWhere(where, { orderBy: { column: "last_name", direction: "ASC" } });
  }

  async countByEmailPrefix(prefix: string) {
    return this.countWhere({ email: { ilike: `${prefix}%` } });
  }

  async findWherePublic(
    where: Parameters<UserRepository["findWhere"]>[0],
    options?: Parameters<UserRepository["findWhere"]>[1],
  ) {
    return this.findWhere(where, options);
  }
}

export const users = new UserRepository();
export type { UserRecord };
