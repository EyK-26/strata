import { UnprocessableEntityError } from "@getstrata/core/errors/http";
import { recordHiringEvent } from "../../lib/hiringEvents.ts";
import { iso } from "../../lib/serialize.ts";
import type { Application } from "../../models/Application.ts";
import type { Comment } from "../../models/Comment.ts";
import type { Position } from "../../models/Position.ts";
import { users } from "../users/repository.ts";
import type { UserRecord } from "../users/table.ts";

function requiredBody(body: string) {
  const text = body.trim();
  if (!text) {
    throw new UnprocessableEntityError("The comment is required.");
  }
  return text;
}

export function serializeComment(row: Comment, author?: UserRecord | null) {
  const record = row.toObject();
  return {
    id: Number(record.id),
    user_id: Number(record.user_id),
    body: record.body,
    commentable_type: record.commentable_type,
    commentable_id: Number(record.commentable_id),
    created_at: iso(record.created_at),
    updated_at: iso(record.updated_at),
    author: author
      ? {
          id: author.id,
          first_name: author.first_name,
          last_name: author.last_name,
        }
      : null,
  };
}

async function withAuthors(rows: Comment[]) {
  const ids = [...new Set(rows.map((row) => Number(row.get("user_id"))))];
  const authors = await Promise.all(ids.map((id) => users.findById(id)));
  const byId = new Map(
    authors.filter((user): user is UserRecord => Boolean(user)).map((user) => [user.id, user]),
  );
  return rows.map((row) => serializeComment(row, byId.get(Number(row.get("user_id"))) ?? null));
}

export class CommentService {
  async forApplication(application: Application) {
    return application.comments();
  }

  async forPosition(position: Position) {
    return position.comments();
  }

  async serializedForApplication(application: Application) {
    return withAuthors(await this.forApplication(application));
  }

  async serializedForPosition(position: Position) {
    return withAuthors(await this.forPosition(position));
  }

  async addToApplication(user: UserRecord, application: Application, body: string) {
    const text = requiredBody(body);
    const created = await application.comments().create({
      user_id: user.id,
      body: text,
    });
    await recordHiringEvent(
      "application.commented",
      {
        application_id: Number(application.id),
        user_id: user.id,
        comment_id: Number(created.id),
      },
      { type: "application", id: Number(application.id) },
    );
    return created;
  }

  async addToPosition(user: UserRecord, position: Position, body: string) {
    const text = requiredBody(body);
    const created = await position.comments().create({
      user_id: user.id,
      body: text,
    });
    await recordHiringEvent(
      "position.commented",
      {
        position_id: Number(position.id),
        user_id: user.id,
        comment_id: Number(created.id),
      },
      { type: "position", id: Number(position.id) },
    );
    return created;
  }
}

export const commentService = new CommentService();
