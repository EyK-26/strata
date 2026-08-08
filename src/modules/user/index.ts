import { type AppModule } from "../../bootstrap/contracts";
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
export { userProvider, tokenServiceToken, userRepositoryToken };
export { AuthController };
export { createAuthRoutes } from "./routes";
export { default as UserRepository } from "./repository";
export { default as TokenService } from "./tokenService";
export { userTable } from "./table";
export type { UserRecord } from "./types";
