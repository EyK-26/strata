import { JsonResource } from "@getstrata/core/http/resources";
import { dateOnly, hiringFlag, iso, serializeTimestamps } from "../lib/serialize.ts";

function asRaw<T extends Record<string, unknown>>(value: {
  toArray?: () => T;
  toObject?: () => T;
}): T {
  if (typeof value.toArray === "function") {
    return value.toArray();
  }
  if (typeof value.toObject === "function") {
    return value.toObject();
  }
  return value as T;
}

function id(value: unknown) {
  return Number(value);
}

export function mergeResource(
  resource: JsonResource,
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  return { ...resource.toArray(), ...extras };
}

class NamedResource extends JsonResource {
  override toArray(): Record<string, unknown> {
    const raw = asRaw<{
      id: unknown;
      name: string;
      created_at?: Date | string | null;
      updated_at?: Date | string | null;
    }>(this.resource as never);
    return {
      id: id(raw.id),
      name: raw.name,
      ...serializeTimestamps(raw),
    };
  }
}

class UserResource extends JsonResource {
  override toArray(): Record<string, unknown> {
    const raw = asRaw<{
      id: unknown;
      first_name: string;
      last_name: string;
      email: string;
      role_id: unknown;
      email_verified_at?: Date | string | null;
      mfa_enabled?: boolean;
      created_at?: Date | string | null;
      updated_at?: Date | string | null;
    }>(this.resource as never);
    return {
      id: id(raw.id),
      first_name: raw.first_name,
      last_name: raw.last_name,
      email: raw.email,
      email_verified_at: iso(raw.email_verified_at),
      mfa_enabled: Boolean(raw.mfa_enabled),
      role_id: id(raw.role_id),
      ...serializeTimestamps(raw),
    };
  }
}

class PositionResource extends JsonResource {
  override toArray(): Record<string, unknown> {
    const raw = asRaw<{
      id: unknown;
      user_id: unknown;
      department_id: unknown;
      grade_id: unknown;
      name: string;
      description: string | null;
      hiring: boolean | number;
      start_date?: Date | string | null;
      end_date?: Date | string | null;
      created_at?: Date | string | null;
      updated_at?: Date | string | null;
    }>(this.resource as never);
    return {
      id: id(raw.id),
      user_id: raw.user_id === null || raw.user_id === undefined ? null : id(raw.user_id),
      department_id: id(raw.department_id),
      grade_id: id(raw.grade_id),
      name: raw.name,
      description: raw.description,
      hiring: hiringFlag(raw.hiring),
      start_date: dateOnly(raw.start_date),
      end_date: dateOnly(raw.end_date),
      ...serializeTimestamps(raw),
    };
  }
}

class ApplicationResource extends JsonResource {
  override toArray(): Record<string, unknown> {
    const raw = asRaw<{
      id: unknown;
      user_id: unknown;
      position_id: unknown;
      status_id: unknown;
      attachment_text: string | null;
      attachment_file: string | null;
      created_at?: Date | string | null;
      updated_at?: Date | string | null;
    }>(this.resource as never);
    const payload: Record<string, unknown> = {
      id: id(raw.id),
      user_id: id(raw.user_id),
      position_id:
        raw.position_id === null || raw.position_id === undefined ? null : id(raw.position_id),
      status_id: id(raw.status_id),
      attachment_text: raw.attachment_text,
      attachment_file: raw.attachment_file,
      ...serializeTimestamps(raw),
    };
    const position = this.whenLoaded("position", (value) => new PositionResource(value).toArray());
    const status = this.whenLoaded("status", (value) => new NamedResource(value).toArray());
    const user = this.whenLoaded("user", (value) => new UserResource(value).toArray());
    if (position !== undefined) {
      payload.position = position;
    }
    if (status !== undefined) {
      payload.status = status;
    }
    if (user !== undefined) {
      payload.user = user;
    }
    return payload;
  }
}

class NotificationResource extends JsonResource {
  override toArray(): Record<string, unknown> {
    const raw = asRaw<{
      id: string;
      type: string;
      notifiable_type: string;
      notifiable_id: unknown;
      data: unknown;
      read_at: Date | string | null;
      created_at?: Date | string | null;
      updated_at?: Date | string | null;
    }>(this.resource as never);
    return {
      id: raw.id,
      type: raw.type,
      notifiable_type: raw.notifiable_type,
      notifiable_id: id(raw.notifiable_id),
      data: typeof raw.data === "string" ? JSON.parse(raw.data) : raw.data,
      read_at: iso(raw.read_at),
      ...serializeTimestamps(raw),
    };
  }
}

export { ApplicationResource, NamedResource, NotificationResource, PositionResource, UserResource };
