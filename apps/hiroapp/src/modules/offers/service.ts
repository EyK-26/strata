import {
  ConflictError,
  ForbiddenError,
  UnprocessableEntityError,
} from "@getstrata/core/errors/http";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import { recordHiringEvent } from "../../lib/hiringEvents.ts";
import { isCandidate, isStaff } from "../../lib/roles.ts";
import { dateOnly, iso } from "../../lib/serialize.ts";
import { Application } from "../../models/Application.ts";
import type { Offer } from "../../models/Offer.ts";
import { notifyUser } from "../notifications/service.ts";
import { users } from "../users/repository.ts";
import type { UserRecord } from "../users/table.ts";
import { offers } from "./repository.ts";
import type { OfferRecord, OfferStatus } from "./table.ts";

export type CreateOfferInput = {
  salary: number;
  starts_on?: string | null;
  notes?: string | null;
};

function asOfferStatus(value: unknown): OfferStatus {
  if (
    value === "draft" ||
    value === "sent" ||
    value === "accepted" ||
    value === "declined" ||
    value === "withdrawn" ||
    value === "expired"
  ) {
    return value;
  }
  return "draft";
}

function assertStaff(actor: UserRecord) {
  if (!isStaff(actor.role_id)) {
    throw new ForbiddenError("Only staff can manage offers.");
  }
}

async function assertCanView(actor: UserRecord, application: Application) {
  if (isStaff(actor.role_id)) {
    return;
  }
  if (Number(application.get("user_id")) !== Number(actor.id)) {
    throw new ForbiddenError("You cannot view this offer.");
  }
}

function parseSalary(value: number) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new UnprocessableEntityError("Salary must be a positive integer.");
  }
  return value;
}

function parseStartsOn(value: string | null | undefined) {
  const raw = value?.trim() ?? "";
  if (!raw) {
    return null;
  }
  const startsOn = new Date(raw);
  if (Number.isNaN(startsOn.getTime())) {
    throw new UnprocessableEntityError("The start date is invalid.");
  }
  return startsOn;
}

function parseExpiresAt(value: string | null | undefined) {
  const raw = value?.trim() ?? "";
  if (!raw) {
    return null;
  }
  const expiresAt = new Date(raw);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new UnprocessableEntityError("The expiry date is invalid.");
  }
  if (expiresAt.getTime() <= Date.now()) {
    throw new UnprocessableEntityError("The expiry must be in the future.");
  }
  return expiresAt;
}

export function serializeOffer(row: Offer | OfferRecord) {
  const record =
    typeof (row as Offer).toObject === "function"
      ? (row as Offer).toObject()
      : (row as OfferRecord);
  return {
    id: Number(record.id),
    application_id: Number(record.application_id),
    created_by: Number(record.created_by),
    salary: Number(record.salary),
    starts_on: dateOnly(record.starts_on),
    expires_at: iso(record.expires_at),
    status: asOfferStatus(record.status),
    notes: record.notes,
    created_at: iso(record.created_at),
    updated_at: iso(record.updated_at),
  };
}

export class OfferService {
  private async expireIfDue(row: OfferRecord): Promise<OfferRecord> {
    if (asOfferStatus(row.status) !== "sent") {
      return row;
    }
    if (!row.expires_at) {
      return row;
    }
    const expiresAt = new Date(row.expires_at);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() > Date.now()) {
      return row;
    }
    const updated = await offers.updateByIdOrThrow(row.id, { status: "expired" });
    await recordHiringEvent(
      "offer.expired",
      { offer_id: updated.id, application_id: updated.application_id },
      { type: "offer", id: updated.id },
    );
    return updated;
  }

  async serializedForApplication(applicationId: number) {
    const rows = await offers.forApplication(applicationId);
    const fresh: OfferRecord[] = [];
    for (const row of rows) {
      fresh.push(await this.expireIfDue(row));
    }
    return fresh.map(serializeOffer);
  }

  async listForApplication(actor: UserRecord, application: Application) {
    await assertCanView(actor, application);
    return this.serializedForApplication(Number(application.id));
  }

  async create(actor: UserRecord, application: Application, input: CreateOfferInput) {
    assertStaff(actor);
    const salary = parseSalary(Number(input.salary));
    const startsOn = parseStartsOn(input.starts_on);
    const notes = input.notes?.trim() || null;
    await this.serializedForApplication(Number(application.id));
    const active = await offers.activeForApplication(Number(application.id));
    if (active) {
      throw new ConflictError("This application already has an active offer.");
    }
    const created = await offers.create({
      application_id: Number(application.id),
      created_by: actor.id,
      tenant_id: currentTenantId(),
      salary,
      starts_on: startsOn,
      expires_at: null,
      status: "draft",
      notes,
    });
    await recordHiringEvent(
      "offer.created",
      { offer_id: created.id, application_id: created.application_id, salary },
      { type: "offer", id: created.id },
    );
    return created;
  }

  async send(actor: UserRecord, offer: Offer, input: { expires_at?: string | null } = {}) {
    assertStaff(actor);
    if (asOfferStatus(offer.get("status")) !== "draft") {
      throw new ForbiddenError("Only a draft offer can be sent.");
    }
    const expiresAt = parseExpiresAt(input.expires_at);
    const updated = await offers.updateByIdOrThrow(Number(offer.id), {
      status: "sent",
      expires_at: expiresAt,
    });
    const application = await Application.findOrFail(updated.application_id);
    const applicant = await users.findByIdOrThrow(Number(application.get("user_id")));
    await notifyUser({
      userId: applicant.id,
      type: "App\\Notifications\\OfferSent",
      data: {
        offer_id: updated.id,
        application_id: updated.application_id,
        salary: updated.salary,
      },
      email: {
        to: applicant.email,
        subject: "You have an offer",
        body: `You have been offered a yearly salary of ${updated.salary}.`,
      },
    });
    await recordHiringEvent(
      "offer.sent",
      { offer_id: updated.id, application_id: updated.application_id, user_id: applicant.id },
      { type: "offer", id: updated.id },
    );
    return updated;
  }

  async withdraw(actor: UserRecord, offer: Offer) {
    assertStaff(actor);
    const current = await this.expireIfDue(offer.toObject());
    const status = asOfferStatus(current.status);
    if (status !== "draft" && status !== "sent") {
      throw new ForbiddenError("This offer cannot be withdrawn.");
    }
    const updated = await offers.updateByIdOrThrow(Number(offer.id), { status: "withdrawn" });
    await recordHiringEvent(
      "offer.withdrawn",
      { offer_id: updated.id, application_id: updated.application_id },
      { type: "offer", id: updated.id },
    );
    return updated;
  }

  async expire(actor: UserRecord, offer: Offer) {
    assertStaff(actor);
    const current = await this.expireIfDue(offer.toObject());
    if (asOfferStatus(current.status) !== "sent") {
      throw new ForbiddenError("Only a sent offer can be expired.");
    }
    const updated = await offers.updateByIdOrThrow(Number(offer.id), { status: "expired" });
    await recordHiringEvent(
      "offer.expired",
      { offer_id: updated.id, application_id: updated.application_id },
      { type: "offer", id: updated.id },
    );
    return updated;
  }

  async respond(actor: UserRecord, offer: Offer, decision: "accepted" | "declined") {
    if (!isCandidate(actor.role_id)) {
      throw new ForbiddenError("Only the candidate can respond to an offer.");
    }
    const application = await Application.findOrFail(Number(offer.get("application_id")));
    if (Number(application.get("user_id")) !== Number(actor.id)) {
      throw new ForbiddenError("This offer belongs to another candidate.");
    }
    const current = await this.expireIfDue(offer.toObject());
    if (asOfferStatus(current.status) === "expired") {
      throw new ForbiddenError("This offer has expired.");
    }
    if (asOfferStatus(current.status) !== "sent") {
      throw new ForbiddenError("Only a sent offer can be accepted or declined.");
    }
    const updated = await offers.updateByIdOrThrow(Number(offer.id), { status: decision });
    const recruiter = await users.findByIdOrThrow(updated.created_by);
    await notifyUser({
      userId: recruiter.id,
      type: "App\\Notifications\\OfferResponded",
      data: {
        offer_id: updated.id,
        application_id: updated.application_id,
        status: decision,
      },
    });
    await recordHiringEvent(
      decision === "accepted" ? "offer.accepted" : "offer.declined",
      { offer_id: updated.id, application_id: updated.application_id, user_id: actor.id },
      { type: "offer", id: updated.id },
    );
    return updated;
  }

  async accept(actor: UserRecord, offer: Offer) {
    return this.respond(actor, offer, "accepted");
  }

  async decline(actor: UserRecord, offer: Offer) {
    return this.respond(actor, offer, "declined");
  }
}

export const offerService = new OfferService();
