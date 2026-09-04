import {
  ConflictError,
  ForbiddenError,
  UnprocessableEntityError,
} from "@getstrata/core/errors/http";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import { recordHiringEvent } from "../../lib/hiringEvents.ts";
import { isStaff } from "../../lib/roles.ts";
import { iso } from "../../lib/serialize.ts";
import type { Position } from "../../models/Position.ts";
import type { Referral } from "../../models/Referral.ts";
import type { UserRecord } from "../users/table.ts";
import { referrals } from "./repository.ts";
import type { ReferralRecord, ReferralStatus } from "./table.ts";

export type CreateReferralInput = {
  email: string;
  name: string;
  notes?: string | null;
};

function asReferralStatus(value: unknown): ReferralStatus {
  if (value === "open" || value === "applied" || value === "closed") {
    return value;
  }
  return "open";
}

function assertStaff(actor: UserRecord) {
  if (!isStaff(actor.role_id)) {
    throw new ForbiddenError("Only staff can manage referrals.");
  }
}

function parseEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (!email.includes("@") || email.length < 3) {
    throw new UnprocessableEntityError("A valid referral email is required.");
  }
  return email;
}

function parseName(value: string) {
  const name = value.trim();
  if (!name) {
    throw new UnprocessableEntityError("A referral name is required.");
  }
  return name;
}

export function serializeReferral(row: Referral | ReferralRecord) {
  const record =
    typeof (row as Referral).toObject === "function"
      ? (row as Referral).toObject()
      : (row as ReferralRecord);
  return {
    id: Number(record.id),
    position_id: Number(record.position_id),
    referred_by: Number(record.referred_by),
    email: record.email,
    name: record.name,
    notes: record.notes,
    status: asReferralStatus(record.status),
    created_at: iso(record.created_at),
    updated_at: iso(record.updated_at),
  };
}

export class ReferralService {
  async listForPosition(actor: UserRecord, position: Position) {
    assertStaff(actor);
    return (await referrals.forPosition(Number(position.id))).map(serializeReferral);
  }

  async listForReferrer(actor: UserRecord) {
    assertStaff(actor);
    return (await referrals.forReferrer(actor.id)).map(serializeReferral);
  }

  async create(actor: UserRecord, position: Position, input: CreateReferralInput) {
    assertStaff(actor);
    const email = parseEmail(String(input.email ?? ""));
    const name = parseName(String(input.name ?? ""));
    const notes = input.notes?.trim() || null;
    const open = await referrals.openForEmail(email, Number(position.id));
    if (open) {
      throw new ConflictError("An open referral already exists for this email and position.");
    }
    const created = await referrals.create({
      position_id: Number(position.id),
      referred_by: actor.id,
      tenant_id: currentTenantId(),
      email,
      name,
      notes,
      status: "open",
    });
    await recordHiringEvent(
      "referral.created",
      {
        referral_id: created.id,
        position_id: created.position_id,
        referred_by: actor.id,
        email,
      },
      { type: "referral", id: created.id },
    );
    return created;
  }

  async close(actor: UserRecord, referral: Referral) {
    assertStaff(actor);
    if (asReferralStatus(referral.get("status")) === "closed") {
      throw new ForbiddenError("This referral is already closed.");
    }
    const updated = await referrals.updateByIdOrThrow(Number(referral.id), { status: "closed" });
    await recordHiringEvent(
      "referral.closed",
      { referral_id: updated.id, position_id: updated.position_id },
      { type: "referral", id: updated.id },
    );
    return updated;
  }

  async markApplied(email: string, positionId: number) {
    const normalized = email.trim().toLowerCase();
    const open = await referrals.openForEmail(normalized, positionId);
    if (!open) {
      return null;
    }
    const updated = await referrals.updateByIdOrThrow(open.id, { status: "applied" });
    await recordHiringEvent(
      "referral.applied",
      { referral_id: updated.id, position_id: updated.position_id, email: normalized },
      { type: "referral", id: updated.id },
    );
    return updated;
  }
}

export const referralService = new ReferralService();
