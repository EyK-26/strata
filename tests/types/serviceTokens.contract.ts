import { createServiceToken as bootstrapToken } from "@getstrata/bootstrap/contracts";
import { createServiceToken as rootToken } from "@getstrata/core";
/** Compiled by check; intentionally not executed. */
import {
  createServiceToken,
  ServiceContainer,
  type ServiceContainerLike,
  type ServiceToken,
} from "@getstrata/core/contracts/container";
import { type AppDependencies, resolveService } from "@getstrata/core/contracts/di";

export function serviceTokenContracts(dependencies: AppDependencies): void {
  const container = new ServiceContainer();
  const count = createServiceToken<number>("app.count");
  const rootValue: number = container.resolve(rootToken<number>("app.root"));
  const bootstrapValue: number = container.resolve(bootstrapToken<number>("app.bootstrap"));
  void rootValue;
  void bootstrapValue;
  const name = createServiceToken<string>("app.name");
  container.set(count, 1);
  container.singleton(count, () => 2);
  container.bind(count, () => 3);
  container.instance(count, 4);
  const values: number[] = [container.get(count), container.resolve(count), container.make(count)];
  const facade: ServiceContainerLike = container;
  values.push(facade.resolve(count), resolveService(dependencies, count));
  void values;
  // @ts-expect-error A typed token cannot register a different service.
  container.set(count, "wrong");
  // @ts-expect-error Factory results are checked against the token, not widened into a union.
  container.singleton(count, () => "wrong");
  // @ts-expect-error Transient factory results must match.
  container.bind(count, () => "wrong");
  // @ts-expect-error Instances must match.
  container.instance(count, "wrong");
  // @ts-expect-error An explicit generic cannot bypass the typed key through the legacy overload.
  container.resolve<string>(count);
  // @ts-expect-error Get preserves the service type.
  container.get<string>(count);
  // @ts-expect-error Make preserves the service type.
  container.make<string>(count);
  // @ts-expect-error Container-like contracts retain typed resolution.
  facade.resolve<string>(count);
  // @ts-expect-error Service resolution cannot bypass the token.
  resolveService<string>(dependencies, count);
  // @ts-expect-error Typed tokens are invariant even when the service is a subtype.
  const widened: ServiceToken<string | number> = name;
  void widened;
  // Existing string consumers remain supported during migration.
  container.set("legacy", "value");
  const legacy: string = container.resolve<string>("legacy");
  void legacy;
}
