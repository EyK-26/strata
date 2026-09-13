import { CORE_POLICY_GATE_TOKEN } from "@getstrata/bootstrap/config";
import { PolicyGate } from "@getstrata/core/auth/policy";
import type { ServiceProvider } from "@getstrata/core/contracts/di";

const policyProvider: ServiceProvider = {
  name: "core.policy",
  register({ container }) {
    container.set(CORE_POLICY_GATE_TOKEN, new PolicyGate());
  },
};

export default policyProvider;
