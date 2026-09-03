import type { AppModule } from "@getstrata/bootstrap/contracts";
import AuthController from "./controller";
import userProvider, { tokenServiceToken, userRepositoryToken } from "./provider";
import { createAuthRoutes } from "./routes";
import { userTable } from "./table";
import { createWebAccountRoutes } from "./webAccountController";
import { createWebAuthRoutes } from "./webAuthRoutes";
import { createWebNotificationRoutes } from "./webNotificationController";

const userModule: AppModule = {
  name: "user",
  order: 5,
  tableName: userTable.name,
  providers: [userProvider],
  routes({ dependencies, kernel }) {
    return createAuthRoutes(dependencies, kernel);
  },
  webRoutes({ dependencies, kernel }) {
    return {
      ...createWebAuthRoutes(dependencies, kernel),
      ...createWebNotificationRoutes(dependencies, kernel),
      ...createWebAccountRoutes(dependencies, kernel),
    };
  },
};

export default userModule;
export { UserFactory, userFactory } from "./factory";
export { UserModel, userRepository } from "./model";
export { default as UserRepository } from "./repository";
export { createAuthRoutes } from "./routes";
export { userTable } from "./table";
export { default as TokenService } from "./tokenService";
export type { UserRecord } from "./types";
export { AuthController, tokenServiceToken, userProvider, userRepositoryToken };
