import type { AppModule } from "../../bootstrap/contracts";
import AuthController from "./controller";
import userProvider, { tokenServiceToken, userRepositoryToken } from "./provider";
import { createAuthRoutes } from "./routes";
import { userTable } from "./table";

const userModule: AppModule = {
  name: "user",
  order: 5,
  tableName: userTable.name,
  providers: [userProvider],
  routes({ dependencies, kernel }) {
    return createAuthRoutes(dependencies, kernel);
  },
};

export default userModule;
export { default as UserRepository } from "./repository";
export { createAuthRoutes } from "./routes";
export { userTable } from "./table";
export { default as TokenService } from "./tokenService";
export type { UserRecord } from "./types";
export { AuthController, tokenServiceToken, userProvider, userRepositoryToken };
