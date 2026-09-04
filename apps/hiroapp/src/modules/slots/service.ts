import {
  ForbiddenError,
  UnprocessableEntityError,
  ValidationError,
} from "@getstrata/core/errors/http";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import { recordHiringEvent } from "../../lib/hiringEvents.ts";
import { isCandidate, isStaff } from "../../lib/roles.ts";
import { iso } from "../../lib/serialize.ts";
import type { Position } from "../../models/Position.ts";
import type { Slot } from "../../models/Slot.ts";
import { applications } from "../applications/repository.ts";
import { interviews } from "../interviews/repository.ts";
import { interviewNotification, notifyUser } from "../notifications/service.ts";
import { users } from "../users/repository.ts";
import type { UserRecord } from "../users/table.ts";
import { slots } from "./repository.ts";
import type { SlotRecord, SlotStatus } from "./table.ts";

export type CreateSlotInput = {
  starts_at: string;
  ends_at: string;
};

function asSlotStatus(value: unknown): SlotStatus {
  if (value === "open" || value === "booked" || value === "cancelled") {
    return value;
  }
  return "open";
}

function assertStaff(actor: UserRecord) {
  if (!isStaff(actor.role_id)) {
    throw new ForbiddenError("Only staff can manage interview slots.");
  }
}

function parseSlotDate(value: string, field: "starts_at" | "ends_at") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError("The given data was invalid.", {
      [field]: ["The slot time is invalid."],
    });
  }
  return date;
}

export function serializeSlot(row: Slot | SlotRecord) {
  const record =
    typeof (row as Slot).toObject === "function" ? (row as Slot).toObject() : (row as SlotRecord);
  return {
    id: Number(record.id),
    position_id: Number(record.position_id),
    created_by: Number(record.created_by),
    starts_at: iso(record.starts_at),
    ends_at: iso(record.ends_at),
    status: asSlotStatus(record.status),
    booked_by: record.booked_by == null ? null : Number(record.booked_by),
    interview_id: record.interview_id == null ? null : Number(record.interview_id),
    created_at: iso(record.created_at),
    updated_at: iso(record.updated_at),
  };
}

export class SlotService {
  async listForPosition(actor: UserRecord, position: Position) {
    const rows = await slots.forPosition(Number(position.id));
    if (isStaff(actor.role_id)) {
      return rows.map(serializeSlot);
    }
    return rows
      .filter(
        (row) => asSlotStatus(row.status) === "open" || Number(row.booked_by) === Number(actor.id),
      )
      .map(serializeSlot);
  }

  async create(actor: UserRecord, position: Position, input: CreateSlotInput) {
    assertStaff(actor);
    const startsAt = parseSlotDate(input.starts_at, "starts_at");
    const endsAt = parseSlotDate(input.ends_at, "ends_at");
    if (endsAt.getTime() <= startsAt.getTime()) {
      throw new UnprocessableEntityError("The slot must end after it starts.");
    }
    const created = await slots.create({
      position_id: Number(position.id),
      created_by: actor.id,
      tenant_id: currentTenantId(),
      starts_at: startsAt,
      ends_at: endsAt,
      status: "open",
      booked_by: null,
      interview_id: null,
    });
    await recordHiringEvent(
      "interview_slot.created",
      {
        slot_id: created.id,
        position_id: created.position_id,
        starts_at: iso(startsAt),
        ends_at: iso(endsAt),
      },
      { type: "interview_slot", id: created.id },
    );
    return created;
  }

  async cancel(actor: UserRecord, slot: Slot) {
    assertStaff(actor);
    if (asSlotStatus(slot.get("status")) !== "open") {
      throw new ForbiddenError("Only an open slot can be cancelled.");
    }
    const updated = await slots.updateByIdOrThrow(Number(slot.id), { status: "cancelled" });
    await recordHiringEvent(
      "interview_slot.cancelled",
      { slot_id: updated.id, position_id: updated.position_id },
      { type: "interview_slot", id: updated.id },
    );
    return updated;
  }

  async book(actor: UserRecord, slot: Slot) {
    if (!isCandidate(actor.role_id)) {
      throw new ForbiddenError("Only candidates can book interview slots.");
    }
    if (asSlotStatus(slot.get("status")) !== "open") {
      throw new ForbiddenError("This slot is not open.");
    }
    const positionId = Number(slot.get("position_id"));
    const application = await applications.findPair(actor.id, positionId);
    if (!application) {
      throw new UnprocessableEntityError("Apply to this position before booking a slot.");
    }
    const startsAt = new Date(String(slot.get("starts_at")));
    const interview = await interviews.create({
      application_id: application.id,
      created_by: Number(slot.get("created_by")),
      tenant_id: currentTenantId(),
      scheduled_at: startsAt,
      place: null,
      notes: null,
      status: "confirmed",
    });
    const updated = await slots.updateByIdOrThrow(Number(slot.id), {
      status: "booked",
      booked_by: actor.id,
      interview_id: interview.id,
    });
    const staff = await users.findByIdOrThrow(Number(slot.get("created_by")));
    const message = interviewNotification({
      text: "Your interview time is confirmed.",
      datetime: startsAt.toISOString(),
      place: "",
      sender: {
        first_name: staff.first_name,
        last_name: staff.last_name,
        email: staff.email,
      },
      to: actor.email,
    });
    await notifyUser({ userId: actor.id, ...message });
    await recordHiringEvent(
      "interview_slot.booked",
      {
        slot_id: updated.id,
        interview_id: interview.id,
        application_id: application.id,
        user_id: actor.id,
      },
      { type: "interview_slot", id: updated.id },
    );
    return updated;
  }
}

export const slotService = new SlotService();
