import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { enableTenantRlsSql } from "../../src/core/tenant/enableTenantRls.ts";

/** Business data belongs to qualification fixtures, never the generated starter. */
export async function installQualificationNotes(
  app: string,
  database: "sqlite" | "mysql" | "postgres",
  tenancy: "none" | "column" | "rls",
  options: { seed?: boolean; webhook?: boolean } = {},
): Promise<string> {
  const tenant = tenancy !== "none";
  await mkdir(join(app, "src/models"), { recursive: true });
  await writeFile(
    join(app, "src/models/Note.ts"),
    `import {defineModel,field,type ModelAttributes} from '@getstrata/core/database/model';
export class Note extends defineModel({table:'notes',fields:{id:field.number(),body:field.string(),${tenant ? "tenant_id:field.number()," : ""}created_at:field.timestamp()},defaultOrderBy:{column:'id',direction:'ASC'}}){static $fillable=['body'${tenant ? ",'tenant_id'" : ""}] as const;static $timestamps=false;}
export type NoteRecord=ModelAttributes<Note>;
`,
  );
  const register = join(app, "src/models/register.ts");
  const source = await readFile(register, "utf8");
  await writeFile(
    register,
    `import {Note} from './Note.ts';\n${source.replace("Object.freeze([", "Object.freeze([Note,")}`,
  );
  const id =
    database === "postgres"
      ? "SERIAL PRIMARY KEY"
      : database === "mysql"
        ? "INT AUTO_INCREMENT PRIMARY KEY"
        : "INTEGER PRIMARY KEY AUTOINCREMENT";
  const timestamp =
    database === "postgres"
      ? "TIMESTAMPTZ NOT NULL DEFAULT NOW()"
      : database === "mysql"
        ? "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"
        : "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP";
  const statements = [
    `CREATE TABLE notes (id ${id}, body TEXT NOT NULL, ${tenant ? "tenant_id INTEGER NOT NULL DEFAULT 1," : ""} created_at ${timestamp})`,
  ];
  if (options.seed)
    statements.push(
      `INSERT INTO notes(body${tenant ? ",tenant_id" : ""}) VALUES ('Welcome to Strata!'${tenant ? ",1" : ""})`,
    );
  if (tenancy === "rls") statements.push(enableTenantRlsSql("notes"));
  const migration = join(app, "src/db/migrations/0002_qualification_notes.ts");
  await writeFile(
    migration,
    `import type {Migration} from '@getstrata/core/database/migrations/types';
export default {name:'0002_qualification_notes',async up(db){${statements.map((sql) => `await db.unsafe(${JSON.stringify(sql)});`).join("\n")}},async down(db){await db.unsafe('DROP TABLE IF EXISTS notes');}} satisfies Migration;\n`,
  );
  if (options.webhook) {
    await mkdir(join(app, "src/listeners"), { recursive: true });
    await writeFile(
      join(app, "src/listeners/qualificationNoteCreated.ts"),
      `import type {ListenerDeclarations} from '@getstrata/bootstrap/discoverListeners';
import {service} from '@getstrata/core/contracts/services';
import {createServiceToken} from '@getstrata/core/contracts/token';
import {modelEffects,type AfterCommitRepositoryListener} from '@getstrata/core/database/definitions';
import {APPLICATION_QUEUE,APPLICATION_WEBHOOKS} from '@getstrata/bootstrap/application';
import {Note,type NoteRecord} from '../models/Note.ts';
import {dispatchWebhook} from '../webhooks/dispatchWebhook.ts';
const created=createServiceToken<AfterCommitRepositoryListener<NoteRecord>>('qualification.notes.created');
export default {services:[service(created,{lifetime:'application',dependencies:[APPLICATION_QUEUE,APPLICATION_WEBHOOKS],create:(queue,options)=>async(data,{database})=>{await dispatchWebhook({database,queue,options},'notes.created',data);}})],repositoryEffects:[modelEffects(Note,[{action:'created',afterCommit:created}])]} satisfies ListenerDeclarations;
`,
    );
  }
  return migration;
}

export function qualificationNotesModule(tenant: boolean): string {
  return `import type {AppModule} from '@getstrata/bootstrap/contracts';
import {jsonResponse} from '@getstrata/core/http/response';
import {Note} from '../../models/Note.ts';
export default {name:'notes',routes({kernel}){return {'/api/v1/notes':{GET:kernel.wrapApi(async(_request,ports)=>{const rows=await ports.database.model(Note).query()${tenant ? ".where({tenant_id:ports.established.tenant.id})" : ""}.orderBy({column:'id',direction:'DESC'}).limit(100).get();return jsonResponse({data:rows.map(row=>row.toObject())});})}};}} satisfies AppModule;`;
}
