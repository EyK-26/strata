import type { ModelAttributes } from './modelQuery';
import type { RelatedRecord } from './relationQuery';
import type { ModelWhere } from './types';

type RelationValue<V, M> = V extends RelatedRecord[] ? M[] : V extends RelatedRecord ? M : V;

type RelationQueryShape = { get(): Promise<RelatedRecord | RelatedRecord[] | null> };

type BuilderMethod = 'where' | 'orderBy' | 'limit' | 'withPivotValues' | 'snapshot';

type ModelMethod = 'get' | 'first' | 'create' | 'createMany' | 'save';

/** Class-reference relations retain the subclass through terminals and builder chaining. */
type ModelRelation<Q extends RelationQueryShape, M extends object> = Omit<
	Q,
	BuilderMethod | ModelMethod | 'then'
> & {
	[P in keyof Q as P extends BuilderMethod | ModelMethod ? P : never]: P extends 'where'
		? (where: ModelWhere<ModelAttributes<M>>) => ModelRelation<Q, M>
		: P extends 'create'
			? (values?: Partial<ModelAttributes<M>>) => Promise<M>
			: P extends 'createMany'
				? (values: readonly Partial<ModelAttributes<M>>[]) => Promise<M[]>
				: P extends 'save'
					? (model: M | Partial<ModelAttributes<M>>) => Promise<M>
					: Q[P] extends (...args: infer A) => infer R
						? P extends BuilderMethod
							? (...args: A) => ModelRelation<Q, M>
							: (...args: A) => Promise<RelationValue<Awaited<R>, M>>
						: never;
} & PromiseLike<RelationValue<Awaited<ReturnType<Q['get']>>, M>>;

export type { ModelRelation };
