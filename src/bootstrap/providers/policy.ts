import { PolicyGate } from "@getstrata/core/auth/policy";
import { CORE_POLICY_GATE_TOKEN, CORE_POLICY_REGISTRY_TOKEN } from "../config";
import type { ServiceProvider } from "../contracts";

const policyProvider: ServiceProvider = {
  name: "core.policy",
  register({ container }) {
    const gate = new PolicyGate();
    container.set(CORE_POLICY_GATE_TOKEN, gate);
    container.set(CORE_POLICY_REGISTRY_TOKEN, gate);
  },
};

export default policyProvider;
