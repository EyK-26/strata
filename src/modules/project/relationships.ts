import { belongsTo } from "../../core/database";
import type { OrganizationRecord } from "../organization/types";
import type { ProjectRecord } from "./types";

const projectBelongsToOrganization = belongsTo<
  ProjectRecord,
  OrganizationRecord
>({
  name: "organization",
  foreignKey: "organization_id",
  ownerKey: "id",
});

export { projectBelongsToOrganization };
