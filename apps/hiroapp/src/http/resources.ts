import { JsonResource } from "@getstrata/core/http/resources";
import { serializeNamed, serializePosition } from "../lib/serialize.ts";
import type { Position } from "../models/Position.ts";

class NamedResource extends JsonResource {
  override toArray(): Record<string, unknown> {
    const record = this.resource as {
      id: unknown;
      name: string;
      toArray?: () => Record<string, unknown>;
    };
    const raw = typeof record.toArray === "function" ? record.toArray() : record;
    return {
      id: Number(raw.id),
      name: raw.name,
    };
  }
}

class UserResource extends JsonResource {
  override toArray(): Record<string, unknown> {
    const user = this.resource as {
      toArray?: () => Record<string, unknown>;
      id: unknown;
      first_name: string;
      last_name: string;
      email: string;
      role_id: unknown;
      created_at?: Date | string | null;
      updated_at?: Date | string | null;
    };
    const raw = typeof user.toArray === "function" ? user.toArray() : user;
    return {
      id: Number(raw.id),
      first_name: raw.first_name,
      last_name: raw.last_name,
      email: raw.email,
      role_id: Number(raw.role_id),
      created_at: raw.created_at ?? null,
      updated_at: raw.updated_at ?? null,
    };
  }
}

class PositionResource extends JsonResource {
  override toArray(): Record<string, unknown> {
    const position = this.resource as {
      toArray?: () => Record<string, unknown>;
      id: unknown;
      user_id: unknown;
      department_id: unknown;
      grade_id: unknown;
      name: string;
      description: string | null;
      hiring: boolean | number;
      start_date?: Date | string | null;
      end_date?: Date | string | null;
    };
    const raw = typeof position.toArray === "function" ? position.toArray() : position;
    return {
      id: Number(raw.id),
      user_id: raw.user_id === null || raw.user_id === undefined ? null : Number(raw.user_id),
      department_id: Number(raw.department_id),
      grade_id: Number(raw.grade_id),
      name: raw.name,
      description: raw.description,
      hiring: raw.hiring === true || raw.hiring === 1 ? 1 : 0,
      start_date: raw.start_date ?? null,
      end_date: raw.end_date ?? null,
    };
  }
}

class ApplicationResource extends JsonResource {
  override toArray(): Record<string, unknown> {
    const application = this.resource as {
      toArray?: () => Record<string, unknown>;
      id: unknown;
      user_id: unknown;
      position_id: unknown;
      status_id: unknown;
      attachment_text: string | null;
      attachment_file: string | null;
    };
    const raw = typeof application.toArray === "function" ? application.toArray() : application;
    const payload: Record<string, unknown> = {
      id: Number(raw.id),
      user_id: Number(raw.user_id),
      position_id:
        raw.position_id === null || raw.position_id === undefined ? null : Number(raw.position_id),
      status_id: Number(raw.status_id),
      attachment_text: raw.attachment_text,
      attachment_file: raw.attachment_file,
    };
    const position = this.whenLoaded("position", (value) => serializePosition(value as Position));
    const status = this.whenLoaded("status", (value) =>
      serializeNamed(value as { id: number; name: string }),
    );
    if (position !== undefined) {
      payload.position = position;
    }
    if (status !== undefined) {
      payload.status = status;
    }
    return payload;
  }
}

export { ApplicationResource, NamedResource, PositionResource, UserResource };
