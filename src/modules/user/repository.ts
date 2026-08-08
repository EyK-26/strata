import { BaseRepository } from "../../core/database";
import type { QueryWhere } from "../../core/database/types";
import { userTable } from "./table";
import type { UserRecord } from "./types";

class UserRepository extends BaseRepository<UserRecord, "id"> {
  constructor() {
    super(userTable);
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const records = await this.findWhere(
      { email } as unknown as QueryWhere<UserRecord>,
      { limit: 1 },
    );

    return records[0] ?? null;
  }
}

export default UserRepository;
