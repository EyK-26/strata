/** Explicit replay authority is separate from pure environment metadata; never executed. */
import {
  createSamlServiceProvider,
  InMemorySamlAssertionReplayStore,
  type SamlServiceProviderConfig,
  type SamlServiceProviderOptions,
} from "@getstrata/core/auth/saml/samlServiceProvider";
export function samlReplayContracts(config: SamlServiceProviderConfig) {
  const options: SamlServiceProviderOptions = {
    ...config,
    replayStore: new InMemorySamlAssertionReplayStore(),
  };
  createSamlServiceProvider(options);
  // @ts-expect-error A provider always requires explicit options and a replay owner.
  createSamlServiceProvider();
  // @ts-expect-error Pure metadata alone grants no replay authority.
  createSamlServiceProvider(config);
  // @ts-expect-error A malformed store has no consume operation.
  createSamlServiceProvider({ ...config, replayStore: {} });
}
