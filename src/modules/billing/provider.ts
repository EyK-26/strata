import type { ServiceProvider } from "@getstrata/core/contracts/di";
import BillingService from "./service";

const billingServiceToken = "billing.service";

const billingProvider: ServiceProvider = {
  name: "billing.provider",
  register({ container }) {
    container.singleton(billingServiceToken, () => new BillingService());
  },
};

export default billingProvider;
export { billingServiceToken };
