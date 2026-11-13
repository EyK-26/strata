import type { StarterLayers } from "./types.ts";

export function renderWorkTrackerModels(): string {
  return `import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineRepository } from "@getstrata/core/database/definitions";
import { defineTable } from "@getstrata/core/database/table";
export interface ProjectRecord { id:string; tenant_id:number; organization_id:string; name:string; }
export interface TaskRecord { id:string; tenant_id:number; organization_id:string; project_id:string; title:string; status:"open"|"done"; }
const projects=defineTable<ProjectRecord,"id">({name:"work_projects",primaryKey:"id",columns:["id","tenant_id","organization_id","name"]});
const tasks=defineTable<TaskRecord,"id">({name:"work_tasks",primaryKey:"id",columns:["id","tenant_id","organization_id","project_id","title","status"]});
export const ProjectRepository=defineRepository<ProjectRecord,"id",BaseRepository<ProjectRecord,"id">,readonly []>({name:"WorkProject",table:projects,dependencies:[],create:binding=>new BaseRepository(binding)});
export const TaskRepository=defineRepository<TaskRecord,"id",BaseRepository<TaskRecord,"id">,readonly []>({name:"WorkTask",table:tasks,dependencies:[],create:binding=>new BaseRepository(binding)});
export const workTrackerRepositories=Object.freeze([ProjectRepository,TaskRepository]);
`;
}

export function renderWorkTrackerDomain(): string {
  return `import { Policy, PolicyGate } from "@getstrata/core/auth/policy";
import { createServiceToken } from "@getstrata/core/contracts/token";
import type { SelectedSession } from "@getstrata/core/contracts/persistence";
import type { TransactionSession } from "@getstrata/core/database/session";
import type { DurableListener, SqlOutbox } from "@getstrata/core/events/outbox";
import { ProjectRepository, TaskRepository } from "../models/workTracker.ts";

export class WorkValidationError extends Error {}
export class WorkNotFoundError extends Error {}
export type WorkRole="owner"|"member"|"viewer";
export interface WorkActor { readonly tenantId:number; readonly userId:number; }
export type WorkPublisher=Readonly<Pick<SqlOutbox,"publish">>;
export const WORK_TRACKER_OUTBOX=createServiceToken<WorkPublisher>("starter.workTracker.outbox");
function actor(input:WorkActor):WorkActor {
  if(!Number.isSafeInteger(input.tenantId)||input.tenantId<1||!Number.isSafeInteger(input.userId)||input.userId<1)throw new TypeError("Established tenant and authenticated user are required.");
  return Object.freeze({tenantId:input.tenantId,userId:input.userId});
}
function text(value:unknown):string {
  if(typeof value!=="string"||!value.trim()||value.length>200)throw new WorkValidationError("Expected text between 1 and 200 characters.");
  return value.trim();
}
function sql<Row>(db:SelectedSession,template:string,params:readonly unknown[]=[]):Promise<readonly Row[]> {
  let index=0;
  return db.execute<Row>({text:template.replace(/\\?/g,()=>db.dialect.placeholder(++index)),params});
}
class WorkPolicy extends Policy {
  constructor(private readonly db:SelectedSession){super();}
  private async role(user:WorkActor|undefined,organization:string|undefined):Promise<WorkRole|null>{
    if(!user||!organization)return null;
    const [row]=await sql<{role:WorkRole}>(this.db,"SELECT m.role FROM work_members m JOIN work_organizations o ON o.id=m.organization_id AND o.tenant_id=m.tenant_id WHERE m.tenant_id=? AND m.organization_id=? AND m.user_id=?",[user.tenantId,organization,user.userId]);
    return row?.role??null;
  }
  override async view(user?:WorkActor,organization?:string):Promise<boolean>{return ["owner","member","viewer"].includes(await this.role(user,organization)??"");}
  async manage(user:WorkActor,organization:string):Promise<boolean>{return await this.role(user,organization)==="owner";}
  async mutateTask(user:WorkActor,organization:string):Promise<boolean>{return ["owner","member"].includes(await this.role(user,organization)??"");}
}
function gate(db:SelectedSession){return new PolicyGate({work:new WorkPolicy(db)});}

/** Same domain service for HTTP, commands and workers; it accepts established identity only. */
export function createWorkTracker(database:SelectedSession,publisher:WorkPublisher,identity:WorkActor){
  const principal=actor(identity);
  async function record(tx:TransactionSession,organizationId:string,action:string,entityId:string):Promise<void>{
    const id=crypto.randomUUID();
    await sql(tx,"INSERT INTO work_audit (id,tenant_id,organization_id,actor_id,action,entity_id,created_at) VALUES (?,?,?,?,?,?,?)",[id,principal.tenantId,organizationId,principal.userId,action,entityId,Date.now()]);
    await publisher.publish(tx,"work.changed",{organizationId,action,entityId,actorId:principal.userId},{tenantId:principal.tenantId,id});
  }
  return Object.freeze({
    async organizations(){
      return database.transaction(tx=>sql<{id:string;name:string}>(tx,"SELECT o.id,o.name FROM work_organizations o JOIN work_members m ON m.organization_id=o.id AND m.tenant_id=o.tenant_id WHERE m.tenant_id=? AND m.user_id=? ORDER BY o.name",[principal.tenantId,principal.userId]));
    },
    async createOrganization(name:string){
      const title=text(name);
      return database.transaction(async tx=>{
        const id=crypto.randomUUID();
        await sql(tx,"INSERT INTO work_organizations (id,tenant_id,name) VALUES (?,?,?)",[id,principal.tenantId,title]);
        await sql(tx,"INSERT INTO work_members (tenant_id,organization_id,user_id,role) VALUES (?,?,?,?)",[principal.tenantId,id,principal.userId,"owner"]);
        await record(tx,id,"organization.created",id);
        return {id,name:title};
      });
    },
    async addMember(organizationId:string,userId:number,role:Exclude<WorkRole,"owner">){
      if(!Number.isSafeInteger(userId)||userId<1||!["member","viewer"].includes(role))throw new WorkValidationError("Invalid member.");
      return database.transaction(async tx=>{
        await gate(tx).authorize("work","manage",principal,organizationId);
        const [user]=await sql<{id:number}>(tx,"SELECT id FROM users WHERE id=? AND tenant_id=?",[userId,principal.tenantId]);
        if(!user)throw new WorkNotFoundError("Member must belong to the established tenant.");
        await sql(tx,"INSERT INTO work_members (tenant_id,organization_id,user_id,role) VALUES (?,?,?,?)",[principal.tenantId,organizationId,userId,role]);
        await record(tx,organizationId,"member.added",String(userId));
      });
    },
    async createProject(organizationId:string,name:string){
      const title=text(name);
      return database.transaction(async tx=>{
        await gate(tx).authorize("work","manage",principal,organizationId);
        const project=await tx.repository(ProjectRepository).create({id:crypto.randomUUID(),tenant_id:principal.tenantId,organization_id:organizationId,name:title});
        await record(tx,organizationId,"project.created",project.id);
        return project;
      });
    },
    async projects(organizationId:string){
      return database.transaction(async tx=>{
        await gate(tx).authorize("work","view",principal,organizationId);
        return tx.repository(ProjectRepository).query({tenant_id:principal.tenantId,organization_id:organizationId}).get();
      });
    },
    async createTask(organizationId:string,projectId:string,title:string){
      const name=text(title);
      return database.transaction(async tx=>{
        await gate(tx).authorize("work","mutateTask",principal,organizationId);
        const project=await tx.repository(ProjectRepository).query({id:projectId,tenant_id:principal.tenantId,organization_id:organizationId}).first();
        if(!project)throw new WorkNotFoundError("Project not found in this organization.");
        const task=await tx.repository(TaskRepository).create({id:crypto.randomUUID(),tenant_id:principal.tenantId,organization_id:organizationId,project_id:project.id,title:name,status:"open"});
        await record(tx,organizationId,"task.created",task.id);
        return task;
      });
    },
    async tasks(organizationId:string){
      return database.transaction(async tx=>{
        await gate(tx).authorize("work","view",principal,organizationId);
        return tx.repository(TaskRepository).query({tenant_id:principal.tenantId,organization_id:organizationId}).get();
      });
    },
    async completeTask(organizationId:string,taskId:string){
      return database.transaction(async tx=>{
        await gate(tx).authorize("work","mutateTask",principal,organizationId);
        const count=await tx.repository(TaskRepository).query({id:taskId,tenant_id:principal.tenantId,organization_id:organizationId}).update({status:"done"});
        if(count!==1)throw new WorkNotFoundError("Task not found in this organization.");
        await record(tx,organizationId,"task.completed",taskId);
      });
    },
  });
}

/** A real idempotent durable consumer; a worker can run outbox:work after commit. */
export const workTrackerListener:DurableListener={name:"work.notification",event:"work.changed",async handle(event,{database}){
  const payload=event.payload as {organizationId:string;action:string;entityId:string};
  await sql(database,"INSERT INTO work_notifications (event_id,tenant_id,organization_id,action,entity_id) VALUES (?,?,?,?,?)"+database.dialect.upsertSuffix(["event_id"],[]),[event.id,event.tenantId,payload.organizationId,payload.action,payload.entityId]);
}};
`;
}

export function renderWorkTrackerMigration(layers: StarterLayers): string {
  const statements = [
    "CREATE TABLE work_organizations (id VARCHAR(64) PRIMARY KEY, tenant_id INTEGER NOT NULL, name VARCHAR(200) NOT NULL, UNIQUE (tenant_id,id))",
    "CREATE TABLE work_members (tenant_id INTEGER NOT NULL, organization_id VARCHAR(64) NOT NULL, user_id INTEGER NOT NULL, role VARCHAR(16) NOT NULL CHECK (role IN ('owner','member','viewer')), PRIMARY KEY (tenant_id,organization_id,user_id), FOREIGN KEY (tenant_id,organization_id) REFERENCES work_organizations(tenant_id,id))",
    "CREATE TABLE work_projects (id VARCHAR(64) PRIMARY KEY, tenant_id INTEGER NOT NULL, organization_id VARCHAR(64) NOT NULL, name VARCHAR(200) NOT NULL, UNIQUE (tenant_id,organization_id,id), FOREIGN KEY (tenant_id,organization_id) REFERENCES work_organizations(tenant_id,id))",
    "CREATE TABLE work_tasks (id VARCHAR(64) PRIMARY KEY, tenant_id INTEGER NOT NULL, organization_id VARCHAR(64) NOT NULL, project_id VARCHAR(64) NOT NULL, title VARCHAR(200) NOT NULL, status VARCHAR(16) NOT NULL CHECK (status IN ('open','done')), FOREIGN KEY (tenant_id,organization_id,project_id) REFERENCES work_projects(tenant_id,organization_id,id))",
    "CREATE TABLE work_audit (id VARCHAR(64) PRIMARY KEY, tenant_id INTEGER NOT NULL, organization_id VARCHAR(64) NOT NULL, actor_id INTEGER NOT NULL, action VARCHAR(64) NOT NULL, entity_id VARCHAR(64) NOT NULL, created_at BIGINT NOT NULL)",
    "CREATE TABLE work_notifications (event_id VARCHAR(64) PRIMARY KEY, tenant_id INTEGER NOT NULL, organization_id VARCHAR(64) NOT NULL, action VARCHAR(64) NOT NULL, entity_id VARCHAR(64) NOT NULL)",
  ];
  const tables = [
    "work_notifications",
    "work_audit",
    "work_tasks",
    "work_projects",
    "work_members",
    "work_organizations",
  ];
  if (layers.tenancy === "rls") {
    for (const table of tables) {
      statements.push(
        `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`,
        `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`,
        `CREATE POLICY work_tenant_scope ON ${table} USING (current_setting('app.bypass_rls',true)='true' OR tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::integer)`,
      );
    }
  }
  return `import type { Migration } from "@getstrata/core/database/migrations/types";
const migration:Migration={name:"0007_work_tracker",async up(db){
${statements.map((sql) => `await db.unsafe(${JSON.stringify(sql)});`).join("\n")}
},async down(db){
${tables.map((table) => `await db.unsafe("DROP TABLE ${table}");`).join("\n")}
}};
export default migration;
`;
}

export function renderWorkTrackerModule(): string {
  return `import type { AppModule, BusinessRequestPorts } from "@getstrata/bootstrap/contracts";
import { BadRequestError, NotFoundError, UnauthorizedError } from "@getstrata/core/errors/http";
import { jsonResponse } from "@getstrata/core/http/response";
import { currentRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { createWorkTracker, WORK_TRACKER_OUTBOX, WorkValidationError, WorkNotFoundError, type WorkPublisher } from "../../domain/workTracker.ts";
function identity(ports:BusinessRequestPorts){
  const user=ports.established.auth.user;
  if(!user)throw new UnauthorizedError();
  return {tenantId:ports.established.tenant.id,userId:Number(user.id)};
}
async function fields(request:Request):Promise<Record<string,unknown>>{
  const content=request.headers.get("content-type")??"";
  if(content.includes("application/json")){
    const value:unknown=await request.json();
    if(!value||typeof value!=="object"||Array.isArray(value))throw new BadRequestError("Expected an object.");
    return value as Record<string,unknown>;
  }
  return Object.fromEntries(await request.formData());
}
async function mutate(input:Record<string,unknown>,ports:BusinessRequestPorts,publisher:WorkPublisher){
  try {
  const service=createWorkTracker(ports.database,publisher,identity(ports));
  const organization=String(input.organization??"");
  switch(input.action){
    case "organization":return await service.createOrganization(String(input.name??""));
    case "member":await service.addMember(organization,Number(input.userId),input.role as "member"|"viewer");return {ok:true};
    case "project":return await service.createProject(organization,String(input.name??""));
    case "task":return await service.createTask(organization,String(input.project??""),String(input.title??""));
    case "complete":await service.completeTask(organization,String(input.task??""));return {ok:true};
    default:throw new BadRequestError("Unknown work action.");
  }
  } catch(error){
    if(error instanceof WorkValidationError)throw new BadRequestError(error.message);
    if(error instanceof WorkNotFoundError)throw new NotFoundError(error.message);
    throw error;
  }
}
function escape(value:string){return value.replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]!);}
const module:AppModule={name:"work-tracker",order:5,
  routes({kernel,dependencies}){
    const publisher=dependencies.container.resolve(WORK_TRACKER_OUTBOX);
    return {"/api/v1/work":{
      GET:kernel.wrapApi(async(request,ports)=>{
        const service=createWorkTracker(ports.database,publisher,identity(ports));
        const organization=new URL(request.url).searchParams.get("organization");
        return jsonResponse(organization?await service.tasks(organization):await service.organizations());
      }),
      POST:kernel.wrapApi(async(request,ports)=>jsonResponse(await mutate(await fields(request),ports,publisher))),
    }};
  },
  webRoutes({kernel,dependencies}){
    const publisher=dependencies.container.resolve(WORK_TRACKER_OUTBOX);
    return {"/work":{
      GET:kernel.wrapWebAuthenticated(async(request,ports)=>{
        const service=createWorkTracker(ports.database,publisher,identity(ports));
        const organization=new URL(request.url).searchParams.get("organization")??"";
        const organizations=await service.organizations();
        const tasks=organization?await service.tasks(organization):[];
        const projects=organization?await service.projects(organization):[];
        const hidden='<input type="hidden" name="_token" value="'+escape(currentRequestMeta().csrfToken??"")+'"><input type="hidden" name="organization" value="'+escape(organization)+'">';
        const form=(content:string)=>'<form method="post" action="/work">'+hidden+content+'</form>';
        const html='<!doctype html><title>Work tracker</title><h1>Work tracker</h1><nav>'+organizations.map(org=>'<a href="/work?organization='+encodeURIComponent(org.id)+'">'+escape(org.name)+'</a> ').join('')+'</nav>'+form('<input name="name" required maxlength="200" placeholder="Organization name"><button name="action" value="organization">Create organization</button>')+(organization?'<h2>Projects</h2>'+form('<input name="name" required maxlength="200" placeholder="Project name"><button name="action" value="project">Create project (owner)</button>')+projects.map(project=>'<h3>'+escape(project.name)+'</h3>'+form('<input type="hidden" name="project" value="'+escape(project.id)+'"><input name="title" required maxlength="200" placeholder="Task title"><button name="action" value="task">Create task</button>')).join('')+'<h2>Tasks</h2><ul>'+tasks.map(task=>'<li>'+escape(task.title)+' ('+escape(task.status)+')'+form('<input type="hidden" name="task" value="'+escape(task.id)+'"><button name="action" value="complete">Complete task</button>')+'</li>').join('')+'</ul>':'');
        return new Response(html,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"private, no-store"}});
      }),
      POST:kernel.wrapWebAuthenticated(async(request,ports)=>{
        const input=await fields(request);
        const result=await mutate(input,ports,publisher);
        const organization=input.action==="organization"?(result as {id:string}).id:String(input.organization??"");
        return new Response(null,{status:303,headers:{location:"/work?organization="+encodeURIComponent(organization)}});
      }),
    }};
  },
};
export default module;
`;
}

export function renderWorkTrackerGuide(): string {
  return `# Work tracker reference

Start the generated app and register or sign in through its selected authentication flow.
Cookie/server applications expose /work: create an organization, create a project as its owner,
then create and complete tasks. Choose an organization from the navigation to see its projects
and tasks. Forms include the same CSRF protection used by the starter's account forms.

The same domain is available at GET/POST /api/v1/work. Send the regular Bearer credential for
an API application, or the authenticated cookie and CSRF token for a cookie application.
GET without an organization query lists the caller's organizations; GET with
?organization=<id> lists tasks after checking membership.

POST accepts JSON with one action:

| action | fields | allowed role |
| --- | --- | --- |
| organization | name | any authenticated tenant user; becomes owner |
| member | organization, userId, role (member or viewer) | owner |
| project | organization, name | owner |
| task | organization, project, title | owner or member |
| complete | organization, task | owner or member |

Viewers can list projects/tasks. Only existing users in the same tenant can be added.
The established request supplies the tenant and actor; payload fields cannot replace either.
The reference includes creation, listing and task completion, rather than full edit/delete CRUD.

Every accepted mutation commits a work_audit record and a standard SQL outbox event together.
Run bun run outbox:work to consume events through the included work.notification listener;
work_notifications records each event once even when the listener receives it again.
If audit or outbox persistence fails, the organization/project/task mutation rolls back.

PostgreSQL/RLS uses a restricted runtime role and adds RLS policies to every work table.
Column-tenancy drivers use explicit tenant/organization predicates and composite foreign keys.
Schema commands use the migration connection; keep privileged credentials out of the runtime.
`;
}
