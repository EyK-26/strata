import type { CacheLike } from '@getstrata/core/cache/tokens';
import { service, type ServiceDeclaration } from '@getstrata/core/contracts/services';
import { createServiceToken, type ServiceToken } from '@getstrata/core/contracts/token';
import type { BaseRepository } from '@getstrata/core/database/baseRepository';
import {
	type AfterCommitRepositoryListener,
	type AnyModelDefinition,
	type AnyRepositoryDefinition,
	type RepositoryDefinition,
	repositoryEffects,
	type RepositoryEffectsDeclaration,
} from '@getstrata/core/database/definitions';
import { type AnyModelClass, modelEffects, modelTable } from '@getstrata/core/database/model';
import type { DurableListener } from '@getstrata/core/events/outbox';
import { InvalidateCacheTagsJob } from '@getstrata/core/jobs/invalidateCacheTagsJob';
import type { Queue } from '@getstrata/core/queue';

import { cacheTagsForModelWrite } from '../cache/modelCacheTags';
import type { AppModule } from '../contracts';
import type { ListenerDeclarations } from '../discoverListeners';

const ACTIONS = ['created', 'updated', 'deleted', 'restored', 'force-deleted'] as const;

const CACHE_EVENT = 'strata.cache.invalidate-tags';

/** Immutable effect graph; declared dependencies prepare before database pool effects. */
export function createModelCacheInvalidationEffects<C extends CacheLike>(
	repositories: readonly AnyRepositoryDefinition[],
	modules: readonly AppModule[],
	tokens: { readonly cache: ServiceToken<C>; readonly queue: ServiceToken<Queue> },
	models: readonly (AnyModelDefinition | AnyModelClass)[] = [],
): ListenerDeclarations {
	const services: ServiceDeclaration[] = [];

	const effects: RepositoryEffectsDeclaration[] = [];

	const classes = models.filter((model): model is AnyModelClass => typeof model === 'function');

	for (const definition of [...repositories, ...classes]) {
		const model = typeof definition === 'function' ? (definition as AnyModelClass) : undefined;

		const repository = definition as AnyRepositoryDefinition;

		const table = model ? modelTable(model) : repository.table;

		for (const action of ACTIONS) {
			const tags = Object.freeze(cacheTagsForModelWrite(table.name, action, modules));

			if (!tags.length) {
				continue;
			}

			const listener = createServiceToken<AfterCommitRepositoryListener<object>>(
				`cache.${table.name}.${action}`,
			);

			services.push(
				service(listener, {
					lifetime: 'application',
					dependencies: [tokens.cache, tokens.queue] as const,
					create: (cache, queue) => async () => {
						await queue.dispatch(new InvalidateCacheTagsJob(cache), { tags: [...tags] });
					},
				}),
			);
			// Composition erases row types only; helper still validates the original definition identity.
			type Erased = RepositoryDefinition<object, never, BaseRepository<object, never>>;

			effects.push(
				model
					? modelEffects(model, [{ action, afterCommit: listener }])
					: repositoryEffects(repository as unknown as Erased, [{ action, afterCommit: listener }]),
			);
		}
	}

	return Object.freeze({
		services: Object.freeze(services),
		repositoryEffects: Object.freeze(effects),
	});
}

export function createModelCacheInvalidationListener(cache: CacheLike): DurableListener {
	return {
		name: 'strata.cache.invalidate-tags.v1',
		event: CACHE_EVENT,
		async handle(event, { signal }) {
			const payload = event.payload as { tags?: unknown } | null;

			const tags = payload?.tags;

			if (
				event.version !== 1 ||
				!Array.isArray(tags) ||
				!tags.length ||
				tags.length > 128 ||
				!tags.every((tag) => typeof tag === 'string' && tag.length > 0 && tag.length <= 256)
			) {
				throw new Error('Invalid durable cache invalidation payload.');
			}

			signal.throwIfAborted();
			await new InvalidateCacheTagsJob(cache).handle({ tags });
			signal.throwIfAborted();
		},
	};
}
