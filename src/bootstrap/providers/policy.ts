import { PolicyGate } from "../../core/auth/policy";
import { CORE_POLICY_GATE_TOKEN } from "../config";
import type { ServiceProvider } from "../contracts";

const policyProvider: ServiceProvider = {
  name: "core.policy",
  register({ container }) {
    container.set(CORE_POLICY_GATE_TOKEN, new PolicyGate());
  },
};

export default policyProvider;
