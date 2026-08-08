import type { ServiceProvider } from "../../bootstrap/contracts";
import AdminService from "./service";

const adminServiceToken = "admin.service";

const adminProvider: ServiceProvider = {
  name: "admin.provider",
  register({ container }) {
    container.singleton(adminServiceToken, () => new AdminService());
  },
};

export default adminProvider;
export { adminServiceToken };
