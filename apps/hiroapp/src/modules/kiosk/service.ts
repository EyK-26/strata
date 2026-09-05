import { getActiveDatabaseConnection } from "@getstrata/core/database/connectionContext";
import {
  hasNamedConnection,
  runOnNamedConnection,
} from "@getstrata/core/database/namedConnections";
import { ForbiddenError, UnprocessableEntityError } from "@getstrata/core/errors/http";
import { isStaff } from "../../lib/roles.ts";
import { Interview } from "../../models/Interview.ts";
import { scorecardService } from "../scorecards/service.ts";
import type { UserRecord } from "../users/table.ts";

export type KioskScorecardRow = {
  id: number;
  interview_id: number;
  user_id: number;
  overall_score: number;
  recommendation: string;
  notes: string | null;
  synced_at: string | null;
  created_at: string;
};

export type KioskScorecardInput = {
  interview_id: number;
  overall_score: number;
  recommendation: string;
  notes?: string | null;
};

function assertStaff(actor: UserRecord) {
  if (!isStaff(actor.role_id)) {
    throw new ForbiddenError("Only staff can use the interview kiosk.");
  }
}

function parseRecommendation(value: string) {
  if (value === "hire" || value === "no_hire" || value === "hold") {
    return value;
  }
  throw new UnprocessableEntityError("Recommendation must be hire, no_hire, or hold.");
}

function parseScore(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new UnprocessableEntityError("Score must be an integer from 1 to 5.");
  }
  return value;
}

function requireKiosk() {
  if (!hasNamedConnection("kiosk")) {
    throw new UnprocessableEntityError(
      "Interview kiosk SQLite is not configured. Set HIROAPP_KIOSK_SQLITE.",
    );
  }
}

async function kioskUnsafe<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
  return runOnNamedConnection("kiosk", () =>
    getActiveDatabaseConnection({ unsafe: async () => [] }).unsafe<T>(sql, params),
  );
}

async function ensureSchema() {
  await kioskUnsafe(`
    CREATE TABLE IF NOT EXISTS kiosk_scorecards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      interview_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      overall_score INTEGER NOT NULL,
      recommendation TEXT NOT NULL,
      notes TEXT,
      synced_at TEXT,
      created_at TEXT NOT NULL
    )
  `);
}

export class KioskService {
  async save(actor: UserRecord, input: KioskScorecardInput) {
    assertStaff(actor);
    requireKiosk();
    await ensureSchema();
    const overallScore = parseScore(Number(input.overall_score));
    const recommendation = parseRecommendation(String(input.recommendation ?? "").trim());
    const notes = input.notes?.trim() || null;
    const interviewId = Number(input.interview_id);
    if (!Number.isInteger(interviewId) || interviewId <= 0) {
      throw new UnprocessableEntityError("Interview is required.");
    }
    const rows = await kioskUnsafe<KioskScorecardRow>(
      `INSERT INTO kiosk_scorecards (
        interview_id, user_id, overall_score, recommendation, notes, synced_at, created_at
      ) VALUES (?, ?, ?, ?, ?, NULL, datetime('now')) RETURNING *`,
      [interviewId, actor.id, overallScore, recommendation, notes],
    );
    const saved = rows[0];
    if (!saved) {
      throw new UnprocessableEntityError("The kiosk could not store that scorecard.");
    }
    return saved;
  }

  async list(actor: UserRecord) {
    assertStaff(actor);
    requireKiosk();
    await ensureSchema();
    return kioskUnsafe<KioskScorecardRow>("SELECT * FROM kiosk_scorecards ORDER BY id DESC");
  }

  async listUnsynced(actor: UserRecord) {
    const rows = await this.list(actor);
    return rows.filter((row) => !row.synced_at);
  }

  async sync(actor: UserRecord) {
    assertStaff(actor);
    requireKiosk();
    const pending = await this.listUnsynced(actor);
    const synced: KioskScorecardRow[] = [];
    for (const row of pending) {
      const interview = await Interview.findOrFail(Number(row.interview_id));
      await scorecardService.submit(actor, interview, {
        overall_score: Number(row.overall_score),
        recommendation: row.recommendation,
        notes: row.notes,
      });
      await kioskUnsafe("UPDATE kiosk_scorecards SET synced_at = datetime('now') WHERE id = ?", [
        row.id,
      ]);
      synced.push({ ...row, synced_at: new Date().toISOString() });
    }
    return { synced: synced.length, data: synced };
  }
}

export const kioskService = new KioskService();
