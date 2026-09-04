import type { ServiceProvider } from "@getstrata/bootstrap/contracts";
import { PolicyGate } from "@getstrata/core/auth/policy";
import { CORE_POLICY_GATE_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import { ApplicationPolicy } from "../../modules/applications/policy.ts";
import { DashboardPolicy } from "../../modules/dashboard/policy.ts";
import { NotificationPolicy } from "../../modules/notifications/policy.ts";
import { PositionPolicy } from "../../modules/positions/policy.ts";
import { SkillPolicy } from "../../modules/skills/policy.ts";
import { UserPolicy } from "../../modules/users/policy.ts";

export const policyProvider: ServiceProvider = {
  name: "hiroapp.policy",
  register({ container }) {
    const gate = new PolicyGate();
    gate.register("users", new UserPolicy());
    gate.register("positions", new PositionPolicy());
    gate.register("applications", new ApplicationPolicy());
    gate.register("notifications", new NotificationPolicy());
    gate.register("dashboard", new DashboardPolicy());
    gate.register("skills", new SkillPolicy());
    container.set(CORE_POLICY_GATE_TOKEN, gate);
  },
};
