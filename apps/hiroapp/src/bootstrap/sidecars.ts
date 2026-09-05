import { createMysqlConnection } from "@getstrata/core/database/mysqlConnection";
import {
  hasNamedConnection,
  registerNamedConnection,
} from "@getstrata/core/database/namedConnections";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";

let bound = false;

export function bindSidecars() {
  if (bound) {
    return;
  }
  bound = true;

  const sqlitePath = process.env.HIROAPP_KIOSK_SQLITE?.trim();
  if (sqlitePath && !hasNamedConnection("kiosk")) {
    registerNamedConnection("kiosk", "sqlite", createSqliteConnection(sqlitePath));
  }

  const mysqlUrl = process.env.MYSQL_URL?.trim();
  if (mysqlUrl && !hasNamedConnection("job-board")) {
    registerNamedConnection("job-board", "mysql", createMysqlConnection(mysqlUrl));
  }
}
