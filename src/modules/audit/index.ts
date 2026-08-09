import type { AppModule } from "@getstrata/bootstrap/contracts";
import { isFeatureEnabled } from "../../config/features";
import auditProvider, { auditServiceToken } from "./provider";
import { createAuditRoutes } from "./routes";

const auditModule: AppModule = {
  name: "audit",
  order: 55,
  tableName: "audit_log",
  cacheTags: [],
  providers: [auditProvider],
  routes({ dependencies, kernel }) {
    if (!isFeatureEnabled("auditLog")) {
      return {};
    }

    return createAuditRoutes(dependencies, kernel);
  },
};

export default auditModule;
export { auditProvider, auditServiceToken };
