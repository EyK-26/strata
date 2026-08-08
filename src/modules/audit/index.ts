import { type AppModule } from "../../bootstrap/contracts";
import auditProvider, { auditServiceToken } from "./provider";
import { createAuditRoutes } from "./routes";

const auditModule: AppModule = {
  name: "audit",
  order: 55,
  tableName: "audit_log",
  providers: [auditProvider],
  routes({ dependencies, kernel }) {
    return createAuditRoutes(dependencies, kernel);
  },
};

export default auditModule;
export { auditProvider, auditServiceToken };
