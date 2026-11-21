import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ensureDirectory } from '../../../src/cli/commands/utils';

import { captureConsole, repoRoot } from './helpers';

const tempDirectories: string[] = [];

async function withTempWorkspace(run: (workspace: string) => Promise<void>): Promise<void> {
	const workspace = await realpath(await mkdtemp(join(tmpdir(), 'strata-cli-scaffold-')));

	tempDirectories.push(workspace);
	const previousCwd = process.cwd();

	process.chdir(workspace);

	try {
		await run(workspace);
	} finally {
		process.chdir(previousCwd);
	}
}

afterEach(async () => {
	process.chdir(repoRoot);

	while (tempDirectories.length > 0) {
		const directory = tempDirectories.pop();

		if (directory) {
			await rm(directory, { recursive: true, force: true });
		}
	}
});

describe('makeModuleCommand', () => {
	test('creates a module scaffold in a temp directory', async () => {
		await withTempWorkspace(async (workspace) => {
			const { makeModuleCommand } = await import('../../../src/cli/commands/makeModule');

			const output = captureConsole();

			try {
				await makeModuleCommand('billing widget');
			} finally {
				output.restore();
			}

			const moduleDirectory = join(workspace, 'src', 'modules', 'billing-widget');

			expect(await Bun.file(join(moduleDirectory, 'index.ts')).exists()).toBe(true);
			expect(
				await Bun.file(
					join(moduleDirectory, 'http/controllers/BillingWidgetController.ts'),
				).exists(),
			).toBe(true);
			expect(
				await Bun.file(join(moduleDirectory, 'policies/BillingWidgetPolicy.ts')).exists(),
			).toBe(true);
			expect(output.logs.some((line) => line.includes('Created module scaffold in:'))).toBe(true);
			expect(output.logs.some((line) => line.includes(moduleDirectory))).toBe(true);
		});
	});

	test('creates web scaffolds when --with-web is passed', async () => {
		await withTempWorkspace(async (workspace) => {
			const { makeModuleCommand } = await import('../../../src/cli/commands/makeModule');

			const output = captureConsole();

			try {
				await makeModuleCommand('--with-web', 'release note');
			} finally {
				output.restore();
			}

			const moduleDirectory = join(workspace, 'src', 'modules', 'release-note');

			expect(await Bun.file(join(moduleDirectory, 'webRoutes.ts')).exists()).toBe(true);
			expect(
				await Bun.file(join(workspace, 'resources/views/release-notes/index.eta')).exists(),
			).toBe(true);
			expect(output.logs.some((line) => line.includes('Created web view scaffold'))).toBe(true);
		});
	});

	test('writes --with-web views under views/ when that directory exists', async () => {
		await withTempWorkspace(async (workspace) => {
			await ensureDirectory(join(workspace, 'views'));
			const { makeModuleCommand } = await import('../../../src/cli/commands/makeModule');

			const output = captureConsole();

			try {
				await makeModuleCommand('--with-web', 'catalog item');
			} finally {
				output.restore();
			}

			expect(await Bun.file(join(workspace, 'views/catalog-items/index.eta')).exists()).toBe(true);
		});
	});

	test('preserves application-owned definition arrays and emits explicit registration guidance', async () => {
		await withTempWorkspace(async (workspace) => {
			const registerPath = join(workspace, 'src', 'models', 'register.ts');

			await ensureDirectory(join(workspace, 'src', 'models'));
			await writeFile(
				registerPath,
				`import { Note, NoteRepository } from "./Note.ts";
export const modelDefinitions = [Note];
export const repositoryDefinitions = [NoteRepository];
`,
			);
			const { makeModuleCommand } = await import('../../../src/cli/commands/makeModule');

			const output = captureConsole();

			try {
				await makeModuleCommand('invoice');
			} finally {
				output.restore();
			}

			const register = await Bun.file(registerPath).text();

			expect(register).toBe(`import { Note, NoteRepository } from "./Note.ts";
export const modelDefinitions = [Note];
export const repositoryDefinitions = [NoteRepository];
`);
			const repository = await Bun.file(
				join(workspace, 'src/modules/invoice/models/Invoice.ts'),
			).text();

			expect(repository).toContain('class Invoice extends defineModel({');
			expect(repository).not.toContain('Repository');
			expect(repository).not.toContain('registerModelClass');
			expect(output.logs).toContain(
				'Add the generated model class to src/models/register.ts modelDefinitions (passed to defineApp({ models })).',
			);
		});
	});

	test('requires a module name', async () => {
		const { makeModuleCommand } = await import('../../../src/cli/commands/makeModule');

		await expect(makeModuleCommand()).rejects.toThrow('make:module requires a name.');
	});

	test('rejects duplicate modules', async () => {
		await withTempWorkspace(async () => {
			const { makeModuleCommand } = await import('../../../src/cli/commands/makeModule');

			await makeModuleCommand('duplicate-module');
			await expect(makeModuleCommand('duplicate-module')).rejects.toThrow('Module already exists:');
		});
	});

	test('opt-in RLS mode writes a tenant-owned API module and a separate migration', async () => {
		await withTempWorkspace(async (workspace) => {
			const { makeModuleCommand } = await import('../../../src/cli/commands/makeModule');

			await ensureDirectory(join(workspace, 'src/config'));
			await writeFile(join(workspace, 'src/config/app.ts'), 'export default { tenancy: "rls" };');
			await expect(makeModuleCommand('Ticket')).rejects.toThrow('does not implement rls tenancy');
			await expect(makeModuleCommand('Ticket', '--rls', '--with-web')).rejects.toThrow('API-only');
			await makeModuleCommand('Ticket', '--rls');
			const module = join(workspace, 'src/modules/ticket');

			expect(await Bun.file(join(module, 'models/Ticket.ts')).text()).toContain('tenant_id');
			expect(await Bun.file(join(module, 'webRoutes.ts')).exists()).toBe(false);
			const migrations = join(workspace, 'src/db/migrations');

			const files = await Array.fromAsync(new Bun.Glob('*_create_ticket.ts').scan(migrations));

			expect(files).toHaveLength(1);
			expect(await Bun.file(join(migrations, files[0] ?? '')).text()).toContain(
				'enableTenantRlsSql',
			);
		});
	});

	test('RLS mode requires an app configured for RLS before writing output', async () => {
		await withTempWorkspace(async (workspace) => {
			const { makeModuleCommand } = await import('../../../src/cli/commands/makeModule');

			await expect(makeModuleCommand('Ticket', '--rls')).rejects.toThrow('PostgreSQL RLS');
			await ensureDirectory(join(workspace, 'src/config'));
			await writeFile(
				join(workspace, 'src/config/app.ts'),
				'export default { tenancy: "column" };',
			);
			await expect(makeModuleCommand('Ticket', '--rls')).rejects.toThrow('PostgreSQL RLS');
			expect(await Bun.file(join(workspace, 'src/modules/ticket/index.ts')).exists()).toBe(false);
		});
	});

	test('RLS mode leaves a retryable workspace when the migration cannot be written', async () => {
		await withTempWorkspace(async (workspace) => {
			const { makeModuleCommand } = await import('../../../src/cli/commands/makeModule');

			await ensureDirectory(join(workspace, 'src/config'));
			await writeFile(join(workspace, 'src/config/app.ts'), 'export default { tenancy: "rls" };');
			await ensureDirectory(join(workspace, 'src/db'));
			const destination = join(workspace, 'src/db/migrations');

			await writeFile(destination, 'existing file');
			await expect(makeModuleCommand('Ticket', '--rls')).rejects.toThrow('not a directory');
			expect(await Bun.file(destination).text()).toBe('existing file');
			expect(await Bun.file(join(workspace, 'src/modules/ticket/index.ts')).exists()).toBe(false);
			await rm(destination);
			await makeModuleCommand('Ticket', '--rls');
			expect(await Bun.file(join(workspace, 'src/modules/ticket/index.ts')).exists()).toBe(true);
		});
	});

	test('rejects invalid module names', async () => {
		const { makeModuleCommand } = await import('../../../src/cli/commands/makeModule');

		await expect(makeModuleCommand('!!!')).rejects.toThrow(
			'make:module requires a valid relative name',
		);
	});
});

describe('makeMigrationCommand', () => {
	test('creates a migration file in the temp migrations directory', async () => {
		await withTempWorkspace(async (workspace) => {
			const { makeMigrationCommand } = await import('../../../src/cli/commands/makeMigration');

			const output = captureConsole();

			try {
				await makeMigrationCommand('add widgets table');
			} finally {
				output.restore();
			}

			const migrationsRoot = join(workspace, 'src', 'db', 'migrations');

			const files = await Array.fromAsync(new Bun.Glob('*.ts').scan(migrationsRoot));

			expect(files).toHaveLength(1);
			expect(files[0]).toMatch(/_add_widgets_table\.ts$/);
			const source = await Bun.file(join(migrationsRoot, files[0] ?? '')).text();

			expect(source).toContain('from "@getstrata/core/database/migrations"');
			expect(source).toContain('defineMigration({');
			expect(source).toContain('up(schema, db)');
			expect(source).toMatch(/_add_widgets_table",\n\n  up\(schema, db\) \{/);
			expect(source).toContain('  },\n\n  down(schema, db) {');
			expect(source).not.toContain('SELECT 1');
			expect(output.logs[0]).toMatch(/^Created migration: /);
		});
	});

	test('requires a migration name', async () => {
		const { makeMigrationCommand } = await import('../../../src/cli/commands/makeMigration');

		await expect(makeMigrationCommand()).rejects.toThrow('make:migration requires a name.');
	});

	test('rejects invalid migration names', async () => {
		const { makeMigrationCommand } = await import('../../../src/cli/commands/makeMigration');

		await expect(makeMigrationCommand('!!!')).rejects.toThrow(
			'make:migration requires a valid relative name',
		);
	});
});

describe('makeFactoryCommand', () => {
	test('creates a factory file for an existing module', async () => {
		await withTempWorkspace(async (workspace) => {
			const { makeModuleCommand } = await import('../../../src/cli/commands/makeModule');

			const { makeFactoryCommand } = await import('../../../src/cli/commands/makeFactory');

			await makeModuleCommand('widget');

			const output = captureConsole();

			try {
				await makeFactoryCommand('widget');
			} finally {
				output.restore();
			}

			const factoryPath = join(workspace, 'src', 'db', 'factories', 'WidgetFactory.ts');

			expect(await Bun.file(factoryPath).exists()).toBe(true);
			const factorySource = await Bun.file(factoryPath).text();

			expect(factorySource).toContain('from "@getstrata/core/database/factory"');
			expect(factorySource).toContain('definition: () => WidgetRecord');
			expect(factorySource).toContain('persist?: FactoryPersist<WidgetRecord>');
			expect(factorySource).toContain(
				'function createWidgetFactory(definition: () => WidgetRecord, persist?: FactoryPersist<WidgetRecord>)',
			);
			expect(factorySource).toContain('createFactory({ definition, persist })');
			expect(factorySource).not.toContain('extends Factory');
			expect(factorySource).not.toContain('as WidgetRecord');
			await expect(makeFactoryCommand('widget')).rejects.toThrow(
				`Factory already exists: ${factoryPath}`,
			);
			expect(await Bun.file(factoryPath).text()).toBe(factorySource);
			expect(output.logs[0]).toBe(`Created factory: ${factoryPath}`);
		});
	});

	test('requires a model name', async () => {
		const { makeFactoryCommand } = await import('../../../src/cli/commands/makeFactory');

		await expect(makeFactoryCommand()).rejects.toThrow('make:factory requires a model name.');
	});
});

describe('makeJobCommand', () => {
	test('creates a job file under src/jobs', async () => {
		await withTempWorkspace(async (workspace) => {
			const { makeJobCommand } = await import('../../../src/cli/commands/makeJob');

			const output = captureConsole();

			try {
				await makeJobCommand('send invoice');
			} finally {
				output.restore();
			}

			const jobPath = join(workspace, 'src/jobs/send-invoiceJob.ts');

			expect(await Bun.file(jobPath).exists()).toBe(true);
			const jobSource = await Bun.file(jobPath).text();

			expect(jobSource).toContain('from "@getstrata/core/queue"');
			expect(jobSource).toContain('static override readonly jobName = "send-invoice"');
			expect(output.logs[0]).toBe(`Created job in: ${jobPath}`);
		});
	});

	test('requires a job name', async () => {
		const { makeJobCommand } = await import('../../../src/cli/commands/makeJob');

		await expect(makeJobCommand()).rejects.toThrow('make:job requires a job name.');
	});
});

describe('makePolicyCommand', () => {
	test('creates a named policy without requiring a module', async () => {
		await withTempWorkspace(async (workspace) => {
			const { makePolicyCommand } = await import('../../../src/cli/commands/makePolicy');

			await makePolicyCommand('InventoryPolicy');
			const path = join(workspace, 'src/policies/InventoryPolicy.ts');

			const source = await Bun.file(path).text();

			expect(source).toContain('from "@getstrata/core/auth/policy"');
			expect(source).toContain('class InventoryPolicy extends Policy');
			expect(source).toContain('return false;');
			await expect(makePolicyCommand('InventoryPolicy')).rejects.toThrow('already exists');
			expect(await Bun.file(path).text()).toBe(source);
		});
	});

	test('requires a policy name', async () => {
		const { makePolicyCommand } = await import('../../../src/cli/commands/makePolicy');

		await expect(makePolicyCommand()).rejects.toThrow('make:policy requires a policy name.');
	});
});

describe('makeRequestCommand', () => {
	test('creates a named FormRequest without requiring a module', async () => {
		await withTempWorkspace(async (workspace) => {
			const { makeRequestCommand } = await import('../../../src/cli/commands/makeRequest');

			await makeRequestCommand('StoreCatalogRequest');
			const path = join(workspace, 'src/http/requests/StoreCatalogRequest.ts');

			const source = await Bun.file(path).text();

			expect(source).toContain('from "@getstrata/core/http/formRequest"');
			expect(source).toContain(
				'class StoreCatalogRequest extends FormRequest<StoreCatalogRequestData>',
			);
			await expect(makeRequestCommand('StoreCatalogRequest')).rejects.toThrow('already exists');
			expect(await Bun.file(path).text()).toBe(source);
		});
	});

	test('requires a request name', async () => {
		const { makeRequestCommand } = await import('../../../src/cli/commands/makeRequest');

		await expect(makeRequestCommand()).rejects.toThrow('make:request requires a request name.');
	});
});

describe('makeListenerCommand', () => {
	test('creates a listener file under src/listeners', async () => {
		await withTempWorkspace(async (workspace) => {
			const { makeListenerCommand } = await import('../../../src/cli/commands/makeListener');

			const output = captureConsole();

			try {
				await makeListenerCommand('invoice paid', 'invoice.paid');
			} finally {
				output.restore();
			}

			const listenerPath = join(workspace, 'src/listeners/invoice-paid.ts');

			expect(await Bun.file(listenerPath).exists()).toBe(true);
			expect(output.logs.some((line) => line.includes('Listening for event: invoice.paid'))).toBe(
				true,
			);
		});
	});

	test('requires a listener name', async () => {
		const { makeListenerCommand } = await import('../../../src/cli/commands/makeListener');

		await expect(makeListenerCommand()).rejects.toThrow('make:listener requires a listener name.');
	});
});

test('make:model emits an executable class usable through session registration alone', async () => {
	await withTempWorkspace(async (workspace) => {
		const { makeModelCommand } =
			await import('../../../packages/strata-cli/src/scaffold/makeModel');

		await makeModelCommand('Contact', '--key-type=string');
		const path = join(workspace, 'src/models/Contact.ts');

		const source = await Bun.file(path).text();

		expect(source).toContain('class Contact extends defineModel({');
		expect(source).not.toContain('construct:');
		// Point this temporary consumer at the real source, independent of installed workspace links.
		await writeFile(
			path,
			source
				.replace('@getstrata/core/database/model', join(repoRoot, 'src/core/database/model.ts'))
				.replace('@getstrata/core/database/table', join(repoRoot, 'src/core/database/table.ts')),
		);
		const { defineModel, field } = await import('../../../src/core/database/model');

		class ContactContract extends defineModel({
			table: 'contacts',
			fields: { id: field.string() },
		}) {}

		const { Contact } = (await import(path)) as { Contact: typeof ContactContract };

		const { withBoundDatabase } = await import('../../helpers/boundRepositoryHarness');

		await withBoundDatabase(
			{
				definition: {
					default: 'main',
					connections: { main: { driver: 'sqlite', filename: ':memory:' } },
					models: [Contact],
				},
			},
			async (db) => {
				await db.execute({ text: 'CREATE TABLE contacts (id TEXT PRIMARY KEY)', params: [] });
				const contact = await db.model(Contact).create({ id: 'generated' });

				expect(contact.id).toBe('generated');
				expect((await db.model(Contact).findOrFail('generated')).id).toBe('generated');
			},
		);
	});
});

test('job names with a Job suffix do not repeat it', async () => {
	await withTempWorkspace(async (workspace) => {
		const { makeJobCommand } = await import('../../../src/cli/commands/makeJob');

		await makeJobCommand('SendInvoiceJob');
		const source = await Bun.file(join(workspace, 'src/jobs/send-invoiceJob.ts')).text();

		expect(source).toContain('class SendInvoiceJob extends Job<SendInvoicePayload>');
		expect(source).toContain('jobName = "send-invoice"');
		expect(source).not.toContain('JobJob');
	});
});

test('model listeners reference existing standalone and module model classes', async () => {
	await withTempWorkspace(async (workspace) => {
		const { makeModelCommand } =
			await import('../../../packages/strata-cli/src/scaffold/makeModel');

		const { makeModuleCommand } = await import('../../../src/cli/commands/makeModule');

		const { makeListenerCommand } = await import('../../../src/cli/commands/makeListener');

		await expect(makeListenerCommand('missing', 'contacts.created')).rejects.toThrow(
			'Model Contact was not found',
		);
		expect(await Bun.file(join(workspace, 'src/listeners/missing.ts')).exists()).toBe(false);
		await makeModelCommand('Contact');
		await makeListenerCommand('welcome', 'contacts.created');
		const source = await Bun.file(join(workspace, 'src/listeners/welcome.ts')).text();

		expect(source).toContain('import { Contact } from "../models/Contact.ts"');
		expect(source).toContain('defineModelListener(Contact, "created"');
		expect(source).not.toContain('Repository');
		await makeModuleCommand('invoice');
		await makeListenerCommand('invoice created', 'invoices.created');
		expect(await Bun.file(join(workspace, 'src/listeners/invoice-created.ts')).text()).toContain(
			'import { Invoice } from "../modules/invoice/models/Invoice.ts"',
		);
	});
});

test('module compatibility checks selected app choices before writes or boot', async () => {
	for (const choices of [
		{ views: false, tenancy: 'none' },
		{ views: true, tenancy: 'column' },
		{ views: true, tenancy: 'rls' },
	]) {
		await withTempWorkspace(async (workspace) => {
			await ensureDirectory(join(workspace, 'src/config'));
			await writeFile(
				join(workspace, 'src/config/app.ts'),
				`export default ${JSON.stringify(choices)};`,
			);
			await ensureDirectory(join(workspace, 'src/bootstrap'));
			await writeFile(
				join(workspace, 'src/bootstrap/createApp.ts'),
				'throw new Error("Must not boot while scaffolding");',
			);
			const { makeModuleCommand } = await import('../../../src/cli/commands/makeModule');

			await expect(makeModuleCommand('Product', '--with-web')).rejects.toThrow(
				choices.views ? 'tenancy' : 'server view renderer',
			);
			expect(await Bun.file(join(workspace, 'src/modules/product/index.ts')).exists()).toBe(false);
			expect(await Bun.file(join(workspace, 'resources/views/products/index.eta')).exists()).toBe(
				false,
			);

			if (choices.tenancy !== 'none') {
				await expect(makeModuleCommand('Product')).rejects.toThrow('tenant scoping');
			}
		});
	}
});
