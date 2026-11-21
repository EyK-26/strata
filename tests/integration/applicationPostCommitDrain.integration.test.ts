import { expect, test } from 'bun:test';

import { createDatabaseBindings } from '@getstrata/core/database/bindings';
import { defineModel, field } from '@getstrata/core/database/model';
import { DATABASE_SESSION_TOKEN } from '@getstrata/core/database/tokens';
import { createApplication } from '@getstrata/core/runtime/application';
import { grantPostgresAppRolePrivileges } from '@getstrata/core/tenant/enableTenantRls';

import { bounded, deferred } from '../fixtures/applicationOwnershipSupport';
import {
	postgresIdentity,
	withPostgresProvisioningFixture,
} from '../helpers/postgresProvisioningFixture';

class DrainItem extends defineModel({
	table: 'drain_items',
	fields: { id: field.number(), name: field.string() },
}) {
	static $fillable = ['name'] as const;
	static $timestamps = false;
}

test('restricted native Postgres request COMMIT and observers finish before application drain closes the pool', async () => {
	await withPostgresProvisioningFixture(async (fixture) => {
		await fixture.owner.unsafe(
			'CREATE TABLE drain_items(id SERIAL PRIMARY KEY,name TEXT NOT NULL)',
		);
		await fixture.owner.unsafe('CREATE TABLE drain_observer_effects(item_id INTEGER PRIMARY KEY)');
		await fixture.owner.unsafe(
			'CREATE FUNCTION qualification_drain_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(731247); RETURN NEW; END $$',
		);
		await fixture.owner.unsafe(
			'CREATE CONSTRAINT TRIGGER qualification_drain_commit AFTER INSERT ON drain_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qualification_drain_commit()',
		);
		await grantPostgresAppRolePrivileges(fixture.admin, {
			database: fixture.databases[0],
			role: fixture.runtimeRole,
		});
		const identity = await postgresIdentity(fixture.runtime);

		expect(identity).toMatchObject({
			current_user: fixture.runtimeRole,
			rolsuper: false,
			rolbypassrls: false,
			schema_create: false,
		});
		const migrationUrl = process.env.MIGRATION_DATABASE_URL;

		if (!migrationUrl) {
			throw new Error('An owned PostgreSQL administrator URL is required.');
		}

		const url = new URL(migrationUrl);

		url.pathname = `/${fixture.databases[0]}`;
		url.username = fixture.runtimeRole;
		url.password = fixture.password;
		const app = createApplication({
			providers: [],
			services: createDatabaseBindings({
				default: 'main',
				connections: { main: { driver: 'pgsql', url: url.href } },
				models: [DrainItem],
			}),
		});

		const entered = deferred(),
			release = deferred();

		let gate: Promise<unknown> | undefined;

		let stopping: ReturnType<typeof app.stop> | undefined;

		let work: Promise<number> | undefined;

		let observers = 0;

		try {
			gate = fixture.owner.begin(async (database) => {
				await database.unsafe('SELECT pg_advisory_xact_lock(731247)');
				entered.resolve();
				await release.promise;
			});
			await entered.promise;
			await app.start();
			work = app.run({ kind: 'request' }, (scope) => {
				const root = scope.resolve(DATABASE_SESSION_TOKEN);

				return root.transaction(async (database) => {
					const row = await database.model(DrainItem).create({ name: 'committed during drain' });

					database.afterCommit(async () => {
						await root.transaction((selected) =>
							selected.execute({
								text: 'INSERT INTO drain_observer_effects(item_id) VALUES ($1)',
								params: [row.get('id')],
							}),
						);
						observers++;
					});

					return row.get('id');
				});
			});
			void work.catch(() => {});
			const deadline = Date.now() + 10000;

			while (
				!(
					await fixture.admin.unsafe(
						"SELECT pid FROM pg_stat_activity WHERE datname=$1 AND usename=$2 AND query ILIKE 'COMMIT%' AND state='active' AND EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_stat_activity.pid AND locktype='advisory' AND NOT granted)",
						[fixture.databases[0], fixture.runtimeRole],
					)
				).length
			) {
				expect(Date.now()).toBeLessThan(deadline);
				await Bun.sleep(20);
			}

			stopping = app.stop();
			expect(app.state.phase).toBe('stopping');
			await expect(
				app.run(() => {
					throw new Error('new root admitted during drain');
				}),
			).rejects.toMatchObject({ code: 'APPLICATION_NOT_READY' });
			release.resolve();
			await gate;
			expect(await bounded(work, 'native COMMIT drain')).toBe(1);
			expect(observers).toBe(1);
			expect(
				Array.from(await fixture.owner.unsafe('SELECT item_id FROM drain_observer_effects')),
			).toEqual([{ item_id: 1 }]);
			expect(Array.from(await fixture.owner.unsafe('SELECT id,name FROM drain_items'))).toEqual([
				{ id: 1, name: 'committed during drain' },
			]);
			expect((await bounded(stopping, 'native pool shutdown')).successful).toBe(true);
		} finally {
			release.resolve();
			await gate;
			await work?.catch(() => {});
			await (stopping ?? app.stop());
		}
	});
}, 20000);
