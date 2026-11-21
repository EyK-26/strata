import { describe, expect, test } from 'bun:test';

import { ServiceContainer } from '@getstrata/core/contracts/container';
import {
	isServiceDeclaration,
	resourceService,
	valueService,
} from '@getstrata/core/contracts/services';
import { createServiceToken } from '@getstrata/core/contracts/token';

import { compileServiceGraph } from '../../src/core/runtime/serviceGraph';

test('concurrent initialization of one token shares its factory and published value', async () => {
	const token = createServiceToken<object>('shared initialization');

	const container = new ServiceContainer();

	const signal = new AbortController().signal;

	const value = {};

	const initial = container.initialize(token, () => value, signal);

	const duplicate = container.initialize(
		token,
		() => {
			throw new Error('The pending factory already owns initialization');
		},
		signal,
	);

	expect(duplicate).toBe(initial);
	expect(await duplicate).toBe(value);
	expect(container.resolve(token)).toBe(value);
});

test('aborted initialization never publishes a service at any admission checkpoint', async () => {
	const reason = new Error('Initialization cancelled');

	for (const phase of ['before-factory', 'after-factory', 'during-reflection'] as const) {
		const token = createServiceToken<object>(phase);

		const container = new ServiceContainer();

		const cancellation = new AbortController();

		let calls = 0;

		if (phase === 'before-factory') {
			cancellation.abort(reason);
		}

		const outcome = container.initialize(
			token,
			() => {
				calls++;

				if (phase === 'after-factory') {
					cancellation.abort(reason);
				}

				return new Proxy(
					{},
					{
						getOwnPropertyDescriptor(target, property) {
							cancellation.abort(reason);

							return Reflect.getOwnPropertyDescriptor(target, property);
						},
					},
				);
			},
			cancellation.signal,
		);

		await expect(outcome).rejects.toBe(reason);
		expect(container.has(token)).toBe(false);
		expect(calls).toBe(phase === 'before-factory' ? 0 : 1);
	}
});

test('the service graph rejects malformed records, unknown overrides and repeated overrides', () => {
	const token = createServiceToken<string>('configured value');

	const original = valueService(token, 'original');

	const override = valueService(token, 'override');

	const invalid = 'SERVICE_GRAPH_INVALID_DECLARATION';

	expect(() => compileServiceGraph(null as never)).toThrow(invalid);
	expect(() => compileServiceGraph([null as never])).toThrow(invalid);
	expect(() => compileServiceGraph([{ ...original, kind: 'unknown' } as never])).toThrow(invalid);
	expect(() => compileServiceGraph([{ ...original, lifetime: 'execution' } as never])).toThrow(
		'SERVICE_GRAPH_INVALID_LIFETIME',
	);
	expect(() => compileServiceGraph([], [override])).toThrow('SERVICE_GRAPH_UNKNOWN_OVERRIDE');
	expect(() => compileServiceGraph([original], [override, override])).toThrow(
		'SERVICE_GRAPH_DUPLICATE_OVERRIDE',
	);
});

test('an execution graph observes cancellation before publishing services or acquiring resources', async () => {
	const reason = new Error('Assembly cancelled');

	const token = createServiceToken<object>('cancelled resource');

	const notAcquired = () => {
		throw new Error('Cancelled resource must not open');
	};

	const alreadyCancelled = new AbortController();

	alreadyCancelled.abort(reason);
	await expect(
		compileServiceGraph().startExecution(new ServiceContainer(), alreadyCancelled.signal),
	).rejects.toBe(reason);

	const cancellation = new AbortController();

	const graph = compileServiceGraph([
		resourceService(token, {
			lifetime: 'execution',
			dependencies: [],
			create() {
				cancellation.abort(reason);

				return { name: 'cancelled resource', open: notAcquired, close: notAcquired };
			},
		}),
	]);

	const container = new ServiceContainer();

	await expect(graph.startExecution(container, alreadyCancelled.signal)).rejects.toBe(reason);
	await expect(
		graph.startExecution(container, cancellation.signal, undefined, { acquire: notAcquired }),
	).rejects.toBe(reason);
	expect(container.has(token)).toBe(false);
});

test('service values reject a proxy that reports a cyclic prototype', () => {
	const token = createServiceToken<object>('cyclic payload');

	const value: object = new Proxy({}, { getPrototypeOf: () => value });

	expect(() => valueService(token, value)).toThrow('Unsupported service payload prototype shape.');
});

test('service declaration detection rejects scalars and accepts the original declaration', () => {
	const token = createServiceToken<number>('scalar value');

	expect(isServiceDeclaration(1)).toBe(false);
	expect(isServiceDeclaration(null)).toBe(false);
	expect(isServiceDeclaration(valueService(token, 1))).toBe(true);
});

describe('synchronous service factory dependency paths', () => {
	test.each(['singleton', 'bind'] as const)('reports self resolution for %s', (registration) => {
		const container = new ServiceContainer();

		container[registration](Self, (services) => services.resolve(Self));
		expect(() => container.resolve(Self)).toThrow('Circular service dependency: self -> self.');
	});

	test('reports mixed singleton/transient cycles with the requesting path', () => {
		const container = new ServiceContainer();

		container.singleton(Root, (services) => services.get(First));
		container.bind(First, (services) => services.make(Second));
		container.singleton(Second, (services) => services.get(First));
		expect(() => container.get(Root)).toThrow(
			'Circular service dependency: root -> first -> second -> first.',
		);
		container.set(Second, 'repaired');
		expect(container.get(Root)).toBe('repaired');
	});

	test('clears factory resolution state on failure without caching failures', () => {
		const container = new ServiceContainer();

		const failure = new Error('Dependency temporarily unavailable');

		let attempts = 0;

		container.singleton(Retry, () => {
			if (++attempts === 1) {
				throw failure;
			}

			return { ready: true };
		});
		expect(() => container.get(Retry)).toThrow(failure);
		const value = container.get(Retry);

		expect(container.get(Retry)).toBe(value);
		expect(attempts).toBe(2);
	});

	test('preserves acyclic singleton identity and transient factory behavior', () => {
		const container = new ServiceContainer();

		let attempts = 0;

		container.singleton(Shared, () => ({ shared: true }));
		container.bind(Transient, (services) => ({
			sequence: ++attempts,
			shared: services.get(Shared),
		}));
		const first = container.get<{ sequence: number; shared: object }>(Transient);

		const second = container.get<typeof first>(Transient);

		expect(first).not.toBe(second);
		expect([first.sequence, second.sequence]).toEqual([1, 2]);
		expect(first.shared).toBe(second.shared);
	});

	test('resolution paths belong to each container and retain undefined singleton values', () => {
		const first = new ServiceContainer();

		const second = new ServiceContainer();

		let attempts = 0;

		second.singleton(SharedKey, () => {
			attempts++;

			return undefined;
		});
		first.singleton(SharedKey, () => second.get(SharedKey));
		expect(first.get(SharedKey)).toBeUndefined();
		expect(first.get(SharedKey)).toBeUndefined();
		expect(attempts).toBe(1);
	});
});

const Self = createServiceToken<string>('self');

const Root = createServiceToken<string>('root');

const First = createServiceToken<string>('first');

const Second = createServiceToken<string>('second');

const Retry = createServiceToken<{ ready: boolean }>('retry');

const Shared = createServiceToken<{ shared: boolean }>('shared');

const Transient = createServiceToken<{ sequence: number; shared: object }>('transient');

const SharedKey = createServiceToken<undefined>('shared-key');

test('untyped string service keys reject before changing existing registrations', () => {
	const container = new ServiceContainer();

	const token = createServiceToken<number>('stable');

	container.set(token, 7);
	for (const operation of [
		() => container.set('legacy' as never, 1),
		() => container.singleton('legacy' as never, () => 1),
		() => container.bind('legacy' as never, () => 1),
		() => container.instance('legacy' as never, 1),
		() => container.initialize('legacy' as never, () => 1, new AbortController().signal),
		() => container.get('legacy' as never),
		() => container.resolve('legacy' as never),
		() => container.make('legacy' as never),
		() => container.has('legacy' as never),
		() => container.alias(token, 'legacy' as never),
		() => container.alias<number>('legacy' as never, token),
	]) {
		expect(operation).toThrow('Expected an opaque service token.');
		expect(container.resolve(token)).toBe(7);
	}
});
