/** Test controls share the same package-private state as every production entry.
 * Advanced module subpaths retain explicitly named hooks for compatibility.
 */
export { resetMysqlLoaderForTests } from "#strata-mysql-native";
export {
  resetDnsLookupForTests,
  resetMemoryLoginThrottleForTests,
  resetMemoryThrottleForTests,
  setDnsLookupForTests,
  setNodeSamlLoaderForTests,
} from "#strata-test-state";
