import { ForbiddenError, UnprocessableEntityError } from "@getstrata/core/errors/http";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import { recordHiringEvent } from "../../lib/hiringEvents.ts";
import { isStaff, STATUS } from "../../lib/roles.ts";
import { iso } from "../../lib/serialize.ts";
import { Application } from "../../models/Application.ts";
import type { OnboardingItem } from "../../models/OnboardingItem.ts";
import type { UserRecord } from "../users/table.ts";
import { onboardingItems } from "./repository.ts";
import type { OnboardingItemRecord, OnboardingStatus } from "./table.ts";

export type CreateOnboardingInput = {
  title: string;
  notes?: string | null;
};

function asOnboardingStatus(value: unknown): OnboardingStatus {
  if (value === "open" || value === "done") {
    return value;
  }
  return "open";
}

function assertStaff(actor: UserRecord) {
  if (!isStaff(actor.role_id)) {
    throw new ForbiddenError("Only staff can manage onboarding items.");
  }
}

async function assertCanView(actor: UserRecord, application: Application) {
  if (isStaff(actor.role_id)) {
    return;
  }
  if (Number(application.get("user_id")) !== Number(actor.id)) {
    throw new ForbiddenError("You cannot view this onboarding checklist.");
  }
}

function parseTitle(value: string) {
  const title = value.trim();
  if (!title) {
    throw new UnprocessableEntityError("An onboarding item title is required.");
  }
  return title;
}

export function serializeOnboardingItem(row: OnboardingItem | OnboardingItemRecord) {
  const record =
    typeof (row as OnboardingItem).toObject === "function"
      ? (row as OnboardingItem).toObject()
      : (row as OnboardingItemRecord);
  return {
    id: Number(record.id),
    application_id: Number(record.application_id),
    created_by: Number(record.created_by),
    completed_by: record.completed_by == null ? null : Number(record.completed_by),
    title: record.title,
    notes: record.notes,
    status: asOnboardingStatus(record.status),
    completed_at: iso(record.completed_at),
    created_at: iso(record.created_at),
    updated_at: iso(record.updated_at),
  };
}

export class OnboardingService {
  async listForApplication(actor: UserRecord, application: Application) {
    await assertCanView(actor, application);
    return (await onboardingItems.forApplication(Number(application.id))).map(
      serializeOnboardingItem,
    );
  }

  async create(actor: UserRecord, application: Application, input: CreateOnboardingInput) {
    assertStaff(actor);
    if (Number(application.get("status_id")) !== STATUS.HIRED) {
      throw new UnprocessableEntityError(
        "Onboarding items can only be added to a hired application.",
      );
    }
    const created = await onboardingItems.create({
      application_id: Number(application.id),
      created_by: actor.id,
      completed_by: null,
      tenant_id: currentTenantId(),
      title: parseTitle(String(input.title ?? "")),
      notes: input.notes?.trim() || null,
      status: "open",
      completed_at: null,
    });
    await recordHiringEvent(
      "onboarding.created",
      {
        onboarding_item_id: created.id,
        application_id: created.application_id,
        title: created.title,
      },
      { type: "onboarding_item", id: created.id },
    );
    return created;
  }

  async complete(actor: UserRecord, item: OnboardingItem) {
    const application = await Application.findOrFail(Number(item.get("application_id")));
    await assertCanView(actor, application);
    if (asOnboardingStatus(item.get("status")) === "done") {
      throw new ForbiddenError("This onboarding item is already done.");
    }
    const updated = await onboardingItems.updateByIdOrThrow(Number(item.id), {
      status: "done",
      completed_by: actor.id,
      completed_at: new Date(),
    });
    await recordHiringEvent(
      "onboarding.completed",
      {
        onboarding_item_id: updated.id,
        application_id: updated.application_id,
        completed_by: actor.id,
      },
      { type: "onboarding_item", id: updated.id },
    );
    return updated;
  }
}

export const onboardingService = new OnboardingService();
