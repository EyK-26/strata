import type { ServiceProvider } from "../../bootstrap/contracts";
import ApiTokenRepository from "./apiTokenRepository";
import UserRepository from "./repository";
import TokenService from "./tokenService";

const userRepositoryToken = "user.repository";
const apiTokenRepositoryToken = "user.apiTokenRepository";
const tokenServiceToken = "user.tokenService";

const userProvider: ServiceProvider = {
  name: "user.provider",
  register({ container }) {
    container.singleton(userRepositoryToken, () => new UserRepository());
    container.singleton(apiTokenRepositoryToken, () => new ApiTokenRepository());
  },
  boot({ container }) {
    container.singleton(tokenServiceToken, () => {
      const users = container.resolve<UserRepository>(userRepositoryToken);
      const tokens = container.resolve<ApiTokenRepository>(apiTokenRepositoryToken);
      return new TokenService(users, tokens);
    });
  },
};

export default userProvider;
export {
  apiTokenRepositoryToken,
  tokenServiceToken,
  userRepositoryToken,
};
