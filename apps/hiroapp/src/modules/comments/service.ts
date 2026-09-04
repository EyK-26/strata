import { UnprocessableEntityError } from "@getstrata/core/errors/http";
import { recordHiringEvent } from "../../lib/hiringEvents.ts";
import type { Application } from "../../models/Application.ts";
import type { Position } from "../../models/Position.ts";
import type { UserRecord } from "../users/table.ts";

function requiredBody(body: string) {
  const text = body.trim();
  if (!text) {
    throw new UnprocessableEntityError("The comment is required.");
  }
  return text;
}

export class CommentService {
  async forApplication(application: Application) {
    return application.comments();
  }

  async forPosition(position: Position) {
    return position.comments();
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
