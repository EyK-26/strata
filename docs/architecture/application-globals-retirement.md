# Application global retirement

Application and execution scopes own services. The process-wide application
registry and its facade helpers had no remaining production callers; they are
removed from source, root exports, package subpaths, and generated entries.
Applications retain explicit `createApplication`, service tokens, scoped service
resolution, and direct constructors such as `EventBus`.

The deleted facade type fixture and two facade surface tests asserted only the
retired contract. Existing application ownership, scope isolation, event delivery,
and cold-import tests retain their behavioral assertions. Runtime, Node export-map,
and type contracts now assert that the retired registry and facades are absent.
The application-boundary checker keeps its negative fixtures to prevent their
reintroduction. Coverage exclusions are removed only for deleted files.

This does not retire the remaining string service keys, provider adapter, global
route registry, or mail/storage adapters. Those remain separate migration work.
