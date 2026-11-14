import type { StarterFeaturePlan } from "./featurePlan.ts";

function renderCliRegisterTs(plan?: StarterFeaturePlan): string {
  return `import type { StrataCommandMap } from "@getstrata/cli";

const commands: StrataCommandMap = {${plan?.decisions.users ? '\n  "auth:provision-admin": async () => (await import("./initialAdmin.ts")).initialAdminCommand,' : ""}

};

export { commands };
`;
}

export { renderCliRegisterTs };
