import { getActiveDatabaseConnection } from "@getstrata/core/database/connectionContext";
import {
  hasNamedConnection,
  runOnNamedConnection,
} from "@getstrata/core/database/namedConnections";

export type JobBoardPostInput = {
  careerPostingId: number;
  positionId: number;
  title: string;
  description: string | null;
  pinned: boolean;
};

async function mysqlUnsafe<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
  return runOnNamedConnection("job-board", () =>
    getActiveDatabaseConnection({ unsafe: async () => [] }).unsafe<T>(sql, params),
  );
}

async function ensureSchema() {
  await mysqlUnsafe(`
    CREATE TABLE IF NOT EXISTS job_board_posts (
      id INT NOT NULL AUTO_INCREMENT,
      career_posting_id INT NOT NULL,
      position_id INT NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT NULL,
      status VARCHAR(32) NOT NULL,
      pinned TINYINT(1) NOT NULL DEFAULT 0,
      published_at DATETIME NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_job_board_career (career_posting_id)
    )
  `);
}

export class JobBoardService {
  async upsertPublished(input: JobBoardPostInput) {
    if (!hasNamedConnection("job-board")) {
      return;
    }
    try {
      await ensureSchema();
      await mysqlUnsafe(
        `INSERT INTO job_board_posts
          (career_posting_id, position_id, title, description, status, pinned, published_at)
         VALUES (?, ?, ?, ?, 'published', ?, ?)
         ON DUPLICATE KEY UPDATE
           position_id = VALUES(position_id),
           title = VALUES(title),
           description = VALUES(description),
           status = VALUES(status),
           pinned = VALUES(pinned),
           published_at = VALUES(published_at)`,
        [
          input.careerPostingId,
          input.positionId,
          input.title,
          input.description,
          input.pinned ? 1 : 0,
          new Date(),
        ],
      );
    } catch {
      // Mirror is best-effort. Postgres hiring stays up if MySQL is down.
    }
  }

  async remove(careerPostingId: number) {
    if (!hasNamedConnection("job-board")) {
      return;
    }
    try {
      await ensureSchema();
      await mysqlUnsafe("DELETE FROM job_board_posts WHERE career_posting_id = ?", [
        careerPostingId,
      ]);
    } catch {
      // Mirror is best-effort. Postgres hiring stays up if MySQL is down.
    }
  }
}

export const jobBoardService = new JobBoardService();
