import type { NodeSamlModule } from "./auth/saml/samlServiceProvider";

type DnsLookup = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<{ address: string; family: number }[]>;

/** Package-private test controls. Production resource ownership stays with each adapter. */
const testState = {
  throttleGeneration: 0,
  loginThrottleGeneration: 0,
  dnsLookup: undefined as DnsLookup | undefined,
  nodeSamlLoader: null as (() => Promise<NodeSamlModule>) | null,
};
/** Generations avoid retaining middleware instances in a global test registry. */
function resetMemoryThrottleForTests(): void {
  testState.throttleGeneration++;
}
function resetMemoryLoginThrottleForTests(): void {
  testState.loginThrottleGeneration++;
}
function setDnsLookupForTests(lookupFn: NonNullable<typeof testState.dnsLookup>): void {
  testState.dnsLookup = lookupFn;
}
function resetDnsLookupForTests(): void {
  testState.dnsLookup = undefined;
}
function setNodeSamlLoaderForTests(loader: typeof testState.nodeSamlLoader): void {
  testState.nodeSamlLoader = loader;
}

export {
  resetDnsLookupForTests,
  resetMemoryLoginThrottleForTests,
  resetMemoryThrottleForTests,
  setDnsLookupForTests,
  setNodeSamlLoaderForTests,
  testState,
};
