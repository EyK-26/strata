import { ForbiddenError, UnprocessableEntityError } from "@getstrata/core/errors/http";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import { recordHiringEvent } from "../../lib/hiringEvents.ts";
import { isStaff } from "../../lib/roles.ts";
import { iso } from "../../lib/serialize.ts";
import type { Application } from "../../models/Application.ts";
import type { UserRecord } from "../users/table.ts";
import { applicationAttributions, applicationSources } from "./repository.ts";
import type { ApplicationAttributionRecord, ApplicationSourceRecord } from "./table.ts";

export type RecordSourceInput = {
  source_id: number;
  notes?: string | null;
};

async function assertCanView(actor: UserRecord, application: Application) {
  if (isStaff(actor.role_id)) {
    return;
  }
  if (Number(application.get("user_id")) !== Number(actor.id)) {
    throw new ForbiddenError("You cannot view this application source.");
  }
}

export function serializeSource(row: ApplicationSourceRecord) {
  return { id: Number(row.id), name: row.name };
}

export function serializeAttribution(row: ApplicationAttributionRecord) {
  return {
    id: Number(row.id),
    application_id: Number(row.application_id),
    source_id: Number(row.source_id),
    created_by: Number(row.created_by),
    notes: row.notes,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

export class SourceService {
  async assertKnown(sourceId: number) {
    const row = await applicationSources.findById(sourceId);
    if (!row) {
      throw new UnprocessableEntityError("Unknown application source.");
    }
    return row;
  }

  async list() {
    return (await applicationSources.ordered()).map(serializeSource);
  }

  async forApplication(actor: UserRecord, application: Application) {
    await assertCanView(actor, application);
    const row = await applicationAttributions.forApplication(Number(application.id));
    return row ? serializeAttribution(row) : null;
  }

  async record(actor: UserRecord, application: Application, input: RecordSourceInput) {
    if (!isStaff(actor.role_id) && Number(application.get("user_id")) !== Number(actor.id)) {
      throw new ForbiddenError("You cannot set this application source.");
    }
    const source = await this.assertKnown(Number(input.source_id));
    const notes = input.notes?.trim() || null;
    const existing = await applicationAttributions.forApplication(Number(application.id));
    const saved = existing
      ? await applicationAttributions.updateByIdOrThrow(existing.id, {
          source_id: source.id,
          notes,
        })
      : await applicationAttributions.create({
          application_id: Number(application.id),
          source_id: source.id,
          created_by: actor.id,
          tenant_id: currentTenantId(),
          notes,
        });
    await recordHiringEvent(
      "application.source_recorded",
      {
        application_id: Number(application.id),
        source_id: source.id,
        created_by: actor.id,
      },
      { type: "application", id: Number(application.id) },
    );
    return saved;
  }
}

export const sourceService = new SourceService();
