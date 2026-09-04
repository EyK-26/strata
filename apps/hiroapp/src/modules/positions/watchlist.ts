import { recordHiringEvent } from "../../lib/hiringEvents.ts";
import type { Position } from "../../models/Position.ts";
import { User } from "../../models/User.ts";
import { notifyUser } from "../notifications/service.ts";
import type { UserRecord } from "../users/table.ts";

export class WatchlistService {
  async list(user: UserRecord) {
    return User.newFromRecord(user).watching();
  }

  async ids(user: UserRecord) {
    const rows = await this.list(user);
    return rows.map((row) => Number(row.id));
  }

  async toggle(user: UserRecord, position: Position) {
    await User.newFromRecord(user).watching().toggle(position.id);
    const ids = await this.ids(user);
    const watching = ids.includes(Number(position.id));
    await recordHiringEvent(
      watching ? "position.watched" : "position.unwatched",
      {
        position_id: Number(position.id),
        user_id: user.id,
        watching,
      },
      { type: "position", id: Number(position.id) },
    );
    return { watching, count: ids.length, ids };
  }

  async alertPublished(position: Position, postingId: number) {
    const watchers = await position.watchers();
    const name = String(position.get("name") ?? "");
    for (const watcher of watchers) {
      await notifyUser({
        userId: Number(watcher.id),
        type: "App\\Notifications\\WatchlistCareerPublished",
        data: {
          from: "HiroApp",
          subject: "Watched role published",
          text: `${name} is now on the careers board.`,
          position_id: Number(position.id),
          career_posting_id: postingId,
        },
      });
    }
    await recordHiringEvent(
      "watchlist.alerted",
      {
        position_id: Number(position.id),
        career_posting_id: postingId,
        count: watchers.length,
      },
      { type: "position", id: Number(position.id) },
    );
    return { count: watchers.length };
  }
}

export const watchlistService = new WatchlistService();
