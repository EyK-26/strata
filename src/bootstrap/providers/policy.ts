import type { ServiceProvider } from "../contracts";
import { CORE_POLICY_GATE_TOKEN } from "../config";
import { PolicyGate } from "../../core/auth/policy";

const policyProvider: ServiceProvider = {
  name: "core.policy",
  register({ container }) {
    container.set(CORE_POLICY_GATE_TOKEN, new PolicyGate());
  },
};

export default policyProvider;
