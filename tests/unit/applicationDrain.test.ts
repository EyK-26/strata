import { test } from 'bun:test';
import assert from 'node:assert/strict';

import { service } from '@getstrata/core/contracts/services';
import { createServiceToken } from '@getstrata/core/contracts/token';
import { createApplication } from '@getstrata/core/runtime/application';

import { bounded, deferred, pending, rejected } from '../fixtures/applicationOwnershipSupport';

test('normal stop closes new admission but admitted requests and their joined children drain', async () => {
	const entered = deferred();

	const release = deferred();

	let producerSignal: AbortSignal | undefined;

	const app = createApplication({
		providers: [
			{
				name: 'producer',
				setup(scope) {
					producerSignal = scope.signal;
				},
			},
		],
	});

	await app.start();
	const work = app.run({ kind: 'request' }, async (scope) => {
		entered.resolve();
		await release.promise;
		assert.equal(
			scope.signal.aborted,
			false,
			'normal producer stop must not cancel admitted bookkeeping',
		);
		const child = await scope.spawn((nested) => {
			assert.equal(nested.signal, scope.signal);

			return 42;
		});

		assert.deepEqual(child, { ok: true, value: 42 });

		return child;
	});

	void work.catch(() => {});
	try {
		await entered.promise;
		const stop = app.stop();

		assert.equal(
			producerSignal?.aborted,
			true,
			'producer/setup signal must still stop admission immediately',
		);
		assert.equal(app.state.phase, 'stopping');
		const admissionError = await rejected(app.run(() => assert.fail('new root admitted')));

		assert.ok(admissionError instanceof Error);
		assert.equal(Reflect.get(admissionError, 'code'), 'APPLICATION_NOT_READY');
		await pending(stop);
		release.resolve();
		assert.deepEqual(await bounded(work, 'admitted drain'), { ok: true, value: 42 });
		assert.equal((await bounded(stop, 'normal shutdown')).successful, true);
	} finally {
		release.resolve();
		await work.catch(() => {});
		await app.stop();
	}
});

test('stop before the actual body still cancels an unfinished execution initializer', async () => {
	const entered = deferred();

	const release = deferred();

	let bodies = 0;

	const Token = createServiceToken<number>('drain.initializer');

	const app = createApplication({
		providers: [],
		services: [
			service(Token, {
				lifetime: 'execution',
				dependencies: [],
				create: async () => {
					entered.resolve();
					await release.promise;

					return 1;
				},
			}),
		],
	});

	await app.start();
	const work = app.run(() => {
		bodies++;
	});

	void work.catch(() => {});
	try {
		await entered.promise;
		const stop = app.stop();

		release.resolve();
		const error = await rejected(work);

		assert.ok(error instanceof Error);
		assert.equal(Reflect.get(error, 'code'), 'APPLICATION_START_CANCELLED');
		assert.equal(bodies, 0);
		assert.equal((await bounded(stop, 'initializer shutdown')).successful, true);
	} finally {
		release.resolve();
		await work.catch(() => {});
		await app.stop();
	}
});

test('the hard cleanup deadline still cancels an admitted execution', async () => {
	const entered = deferred();

	const release = deferred();

	let signal: AbortSignal | undefined;

	const app = createApplication({ providers: [], shutdownTimeoutMs: 50 });

	await app.start();
	const work = app.run({ kind: 'request' }, async (scope) => {
		signal = scope.signal;
		entered.resolve();
		await release.promise;
	});

	void work.catch(() => {});
	try {
		await entered.promise;
		const stop = await bounded(app.stop(), 'hard deadline');

		assert.equal(stop.timedOut, true);
		assert.equal(stop.successful, false);
		assert.equal(signal?.aborted, true);
		assert.ok(signal);
		assert.equal(Reflect.get(signal.reason, 'code'), 'APPLICATION_CLEANUP_DEADLINE');
	} finally {
		release.resolve();
		await work.catch(() => {});
		await bounded(app.completion, 'late cleanup');
	}
});

test('external cancellation during normal drain retains its exact reason and blocks later child work', async () => {
	const entered = deferred();

	const release = deferred();

	const external = new AbortController();

	const reason = new Error('client cancelled during drain');

	let childEntered = false;

	const app = createApplication({ providers: [] });

	await app.start();
	const work = app.run({ kind: 'request', signal: external.signal }, async (scope) => {
		entered.resolve();
		await release.promise;
		assert.equal(scope.signal.reason, reason);
		const child = await scope.spawn(() => {
			childEntered = true;
		});

		assert.equal(child.ok, false);

		if (!child.ok) {
			assert.equal(child.error, reason);
		}
	});

	void work.catch(() => {});
	try {
		await entered.promise;
		const stop = app.stop();

		external.abort(reason);
		release.resolve();
		await work.catch((error) => assert.equal(error, reason));
		assert.equal(childEntered, false);
		assert.equal((await bounded(stop, 'cancelled drain')).successful, true);
	} finally {
		release.resolve();
		await work.catch(() => {});
		await app.stop();
	}
});

test('an explicitly supplied producer signal remains an independent caller cancellation source', async () => {
	const entered = deferred(),
		release = deferred();

	let producerSignal!: AbortSignal;

	const app = createApplication({
		providers: [
			{
				name: 'explicit-source',
				setup(scope) {
					producerSignal = scope.signal;
				},
			},
		],
	});

	await app.start();
	const work = app.run({ kind: 'request', signal: producerSignal }, async (scope) => {
		entered.resolve();
		await release.promise;
		assert.equal(scope.signal.aborted, true);
		assert.equal(scope.signal.reason, producerSignal.reason);
	});

	void work.catch(() => {});
	try {
		await entered.promise;
		const stop = app.stop();

		release.resolve();
		await bounded(work, 'explicit producer cancellation');
		assert.equal((await bounded(stop, 'explicit source shutdown')).successful, true);
	} finally {
		release.resolve();
		await work.catch(() => {});
		await app.stop();
	}
});
