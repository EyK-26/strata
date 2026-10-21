import type BaseRepository from "./baseRepository.ts";
import type { Model } from "./model.ts";

type AnyModel = Model<Record<string, unknown>, "id">;

const modelRepositories = new WeakMap<object, BaseRepository<Record<string, unknown>, "id">>();
const modelRepositoryFactories = new WeakMap<object, () => object>();
const namedModels = new Map<string, object>();
const modelObservers = new WeakMap<object, ModelObserver[]>();

type ModelObserver = {
  retrieved?: (model: AnyModel) => unknown;
  creating?: (model: AnyModel) => unknown;
  created?: (model: AnyModel) => unknown;
  updating?: (model: AnyModel) => unknown;
  updated?: (model: AnyModel) => unknown;
  saving?: (model: AnyModel) => unknown;
  saved?: (model: AnyModel) => unknown;
  deleting?: (model: AnyModel) => unknown;
  deleted?: (model: AnyModel) => unknown;
};

async function runObservers(model: AnyModel, hook: keyof ModelObserver): Promise<boolean> {
  const observers = modelObservers.get(model.constructor) ?? [];

  for (const observer of observers) {
    const handler = observer[hook];

    if (handler && (await handler(model)) === false) {
      return false;
    }
  }

  return true;
}

function nameModel(model: object): void {
  const { name, $morphClass } = model as { name?: string; $morphClass?: string };
  if (name) namedModels.set(name, model);
  if ($morphClass) namedModels.set($morphClass, model);
}

function resolveModelRepository(model: object): BaseRepository<Record<string, unknown>, "id"> {
  const existing = modelRepositories.get(model);
  if (existing) return existing;

  // Inherit the definition, but cache a separate repository for each concrete class.
  for (let current: object | null = model; current; current = Object.getPrototypeOf(current)) {
    const factory = modelRepositoryFactories.get(current);
    if (!factory) continue;
    const repository = factory() as BaseRepository<Record<string, unknown>, "id">;
    modelRepositories.set(model, repository);
    nameModel(model);
    return repository;
  }
  throw new Error(`${(model as { name: string }).name}.repository() is not implemented.`);
}

/** Alias for `hasMany("Name")` when `Name` is not `constructor.name` or `$morphClass`. */
function registerModelClass(name: string, model: object): void {
  namedModels.set(name, model);
}

function registerModelRepositoryFactory(model: object, factory: () => object): void {
  modelRepositoryFactories.set(model, factory);
}

function bindModelRepository(
  model: object,
  repository: BaseRepository<Record<string, unknown>, "id">,
): void {
  modelRepositories.set(model, repository);
}

function findNamedModel(name: string): object | undefined {
  return namedModels.get(name);
}

function getModelObservers(model: object): ModelObserver[] | undefined {
  return modelObservers.get(model);
}

function restoreModelObservers(model: object, observers: ModelObserver[] | undefined): void {
  if (observers) modelObservers.set(model, observers);
  else modelObservers.delete(model);
}

function observeModel(model: object, observer: ModelObserver): void {
  const existing = modelObservers.get(model) ?? [];
  modelObservers.set(model, [...existing, observer]);
}

export type { ModelObserver };
export {
  bindModelRepository,
  findNamedModel,
  getModelObservers,
  nameModel,
  observeModel,
  registerModelClass,
  registerModelRepositoryFactory,
  resolveModelRepository,
  restoreModelObservers,
  runObservers,
};
