import type { ServiceProvider } from "@getstrata/bootstrap/contracts";
import AuditLogRepository from "./repository";
import AuditService from "./service";

const auditServiceToken = "audit.service";

const auditProvider: ServiceProvider = {
  name: "audit.provider",
  register({ container }) {
    container.singleton(auditServiceToken, () => {
      return new AuditService(new AuditLogRepository());
    });
  },
};

export default auditProvider;
export { auditServiceToken };
