import { BaseRepository } from "../../core/database";
import { userTable } from "./table";
import type { UserRecord } from "./types";

class UserRepository extends BaseRepository<UserRecord, "id"> {
  constructor() {
    super(userTable);
  }
}

export default UserRepository;
