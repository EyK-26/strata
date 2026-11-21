import { expect, test } from 'bun:test';
import { ok } from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { SQL } from 'bun';

import { createGeneratedSecurityApp } from '../helpers/generatedSecurityApp';

test('installed RLS module scopes generated CRUD and requires app authorization', async () => {
	const fixture = await createGeneratedSecurityApp('postgres', [
		'--frontend=api',
		'--auth=token',
		'--tenancy=rls',
		'--cache=array',
		'--queue=sync',
		'--mail=log',
		'--no-docker',
		'--no-scim',
		'--no-mfa',
		'--no-email-verification',
		'--no-metrics',
	]);

	const admin = new SQL(fixture.migrationUrl);

	const runtime = new SQL(fixture.runtimeUrl);

	const pepper = 'module-acceptance-only-token-hash-pepper';

	const env = {
		PATH: process.env.PATH,
		HOME: process.env.HOME,
		TMPDIR: process.env.TMPDIR,
		APP_ENV: 'local',
		APP_URL: 'http://127.0.0.1:3000',
		DATABASE_URL: fixture.runtimeUrl,
		APP_DATABASE_URL: fixture.runtimeUrl,
		MIGRATION_DATABASE_URL: '',
		TOKEN_HASH_PEPPER: pepper,
		SESSION_SECRET: 'owned-module-session-secret-at-least-32-characters',
		SIGNED_URL_SECRET: 'owned-module-signing-secret-at-least-32-characters',
		TENANCY_DRIVER: 'rls',
		AUTH_DEV_HEADERS: 'false',
		TENANT_DEV_HEADERS: 'false',
		OTEL_SDK_DISABLED: 'true',
	};

	const cli = join(fixture.app, 'node_modules/@getstrata/cli/cli.ts');

	async function run(args: string[], environment = env) {
		const child = Bun.spawn([process.execPath, '--no-env-file', ...args], {
			cwd: fixture.app,
			env: environment,
			stdout: 'pipe',
			stderr: 'pipe',
			timeout: 30000,
			killSignal: 'SIGKILL',
		});

		const [code, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);

		return { code, output: stdout + stderr };
	}

	async function pass(args: string[], environment = env) {
		const { code, output } = await run(args, environment);

		expect(code, output).toBe(0);
	}

	try {
		const migrateEnv = { ...env, MIGRATION_DATABASE_URL: fixture.migrationUrl };

		await pass([cli, 'migrate'], migrateEnv);
		const registry = join(fixture.app, 'src/models/register.ts');

		const registration = await readFile(registry, 'utf8');

		await pass([cli, 'make:module', 'Ticket', '--rls']);
		expect(await readFile(registry, 'utf8')).toBe(registration);
		await writeFile(
			registry,
			'import { Ticket } from "../modules/ticket/models/Ticket.ts";\n' +
				registration.replace('Object.freeze([', 'Object.freeze([Ticket, '),
		);

		await admin`CREATE TABLE module_ticket (marker TEXT NOT NULL)`;
		await admin`INSERT INTO module_ticket VALUES ('existing table')`;
		const collision = await run([cli, 'migrate'], migrateEnv);

		expect(collision.code, collision.output).not.toBe(0);
		expect(collision.output).toContain('already exists');
		expect(await admin`SELECT marker FROM module_ticket`).toEqual([{ marker: 'existing table' }]);
		expect(await admin`
			SELECT relrowsecurity FROM pg_class WHERE oid = 'module_ticket'::regclass
		`).toEqual([{ relrowsecurity: false }]);
		await admin`DROP TABLE module_ticket`;

		await admin`ALTER FUNCTION app_current_tenant_id() RENAME TO module_fixture_tenant_id`;
		try {
			const failedMigration = await run([cli, 'migrate'], migrateEnv);

			expect(failedMigration.code, failedMigration.output).not.toBe(0);
			expect(failedMigration.output).toContain('app_current_tenant_id');
			expect(await admin`SELECT to_regclass('module_ticket') AS table_name`).toEqual([
				{ table_name: null },
			]);
		} finally {
			await admin`ALTER FUNCTION module_fixture_tenant_id() RENAME TO app_current_tenant_id`;
		}

		await pass([cli, 'migrate'], migrateEnv);
		expect(await runtime`
			SELECT current_user, rolsuper, rolbypassrls
			FROM pg_roles WHERE rolname = current_user
		`).toEqual([{ current_user: new URL(fixture.runtimeUrl).username, rolsuper: false, rolbypassrls: false }]);
		expect(await admin`
			SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'module_ticket'::regclass
		`).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
		await admin`INSERT INTO tenant (id, slug) VALUES (1, 'default'), (2, 'second')`;

		const abilities = ['list', 'view', 'create', 'update', 'delete'].map((action) => `tickets:${action}`);

		async function issue(tenant: number, permitted: string[]) {
			const token = crypto.randomUUID();

			const [user] = await admin<{ id: number }[]>`
				INSERT INTO users (name, email, password, tenant_id)
				VALUES ('Test user', ${`${token}@example.test`}, 'unused-password', ${tenant}) RETURNING id
			`;

			ok(user, 'Expected the fixture account to be created');
			const hash = createHmac('sha256', pepper).update(token).digest('hex');

			await admin`
				INSERT INTO api_tokens (user_id, name, token_hash, abilities)
				VALUES (${user.id}, 'module test', ${hash}, ${JSON.stringify(permitted)})
			`;

			return token;
		}

		const firstToken = await issue(1, abilities);

		const secondToken = await issue(2, abilities);

		const ungrantedToken = await issue(1, []);

		const probe = join(fixture.app, 'src/rlsModuleProbe.ts');

		await writeFile(
			probe,
			await readFile(new URL('../fixtures/generated-rls-module.ts.template', import.meta.url), 'utf8'),
		);
		await pass(['run', 'check']);
		const [blocked] = await admin<{ id: number }[]>`
			INSERT INTO module_ticket (tenant_id, name) VALUES (1, 'Protected') RETURNING id
		`;

		ok(blocked);
		await pass(['src/rlsModuleProbe.ts', 'default', firstToken, secondToken, ungrantedToken, String(blocked.id)]);
		expect(await admin`SELECT name FROM module_ticket WHERE id = ${blocked.id}`).toEqual([
			{ name: 'Protected' },
		]);
		await admin`DELETE FROM module_ticket WHERE id = ${blocked.id}`;
		await writeFile(
			join(fixture.app, 'src/modules/ticket/policies/TicketPolicy.ts'),
			`import { Policy } from '@getstrata/core/auth/policy';
export class TicketPolicy extends Policy {
	override view() { return true; }
	override create() { return true; }
	override update() { return true; }
	override delete() { return true; }
}
`,
		);
		await pass(['src/rlsModuleProbe.ts', 'authorized', firstToken, secondToken, ungrantedToken]);
		expect(await admin`SELECT tenant_id, name FROM module_ticket ORDER BY tenant_id`).toEqual([
			{ tenant_id: 2, name: 'Second' },
		]);
		await expect(
			runtime.begin(async (tx) => {
				await tx`SELECT set_config('app.tenant_id', '1', true)`;
				await tx`INSERT INTO module_ticket (tenant_id, name) VALUES (2, 'Outside scope')`;
			}),
		).rejects.toThrow('row-level security');
		const populatedRollback = await run([cli, 'migrate:rollback'], migrateEnv);

		expect(populatedRollback.code, populatedRollback.output).not.toBe(0);
		expect(populatedRollback.output).toContain('contains data');
		expect(await admin`SELECT tenant_id, name FROM module_ticket`).toEqual([
			{ tenant_id: 2, name: 'Second' },
		]);
		await admin`DELETE FROM module_ticket WHERE tenant_id = 2`;
		await pass([cli, 'migrate:rollback'], migrateEnv);
		expect(await admin`
			SELECT to_regclass('module_ticket') AS module_table, to_regclass('tenant')::text AS tenant_table
		`).toEqual([{ module_table: null, tenant_table: 'tenant' }]);
		await pass([cli, 'make:module', 'Form', '--rls']);
		await pass([cli, 'make:module', 'Not Found Error', '--rls']);
		await pass(['run', 'check']);
	} finally {
		try {
			await Promise.all([admin.close(), runtime.close()]);
		} finally {
			await fixture.close();
		}
	}
}, 150000);
