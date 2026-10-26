# PostgreSQL failed-job JSONB persistence

Strata 2.2.60 restores PostgreSQL failed-job payload writes as JSONB objects. The 2.2.52 cross-driver storage mapping serialized the payload before handing it to Bun's PostgreSQL JSONB codec, producing a JSONB string containing JSON. SQLite and MySQL retain their existing JSON text mapping.

The public failed-job reader decodes JSON strings, so a service write/read round trip could hide the changed database representation. Independent SQL inspection with `jsonb_typeof(payload)` distinguishes objects from strings. Recovery observations and operator queries relying on object fields can detect the regression even when public service reads appear correct.

## Compatibility and existing records

Upgrade the installed published core package and aligned bootstrap/CLI packages. No schema migration or generated-source replacement is required for this correction. The framework retains its public repository/service APIs, timestamp mapping, literal projections and replay ordering: enqueue admission succeeds before the recovery record is removed.

Existing JSONB-string records remain readable by the public service. This correction changes new writes and does not rewrite history. Operators who use direct JSONB field queries should inventory affected records and decide separately whether they need a controlled repair. Do not automatically cast every string or rewrite malformed/unrelated historical records.

A read-only inventory for the default PostgreSQL recovery table is:

```sql
SELECT jsonb_typeof(payload) AS payload_type, COUNT(*)
FROM failed_job
GROUP BY jsonb_typeof(payload);
```

Use the intended administrative/observability identity; this query is not authorization to broaden runtime grants. Native JSONB strings and objects are valid PostgreSQL values, but they have different field-query behavior. Keep application writes and recovery verification on the same corrected release.

## Regression coverage

`tests/integration/failedJobPostgresPersistence.integration.test.ts` creates and removes its own database, separates migration and restricted runtime identities, records failures through the public repository/service and checks the actual JSONB type/value with an independent SQL connection. It also checks literal projections, replay admission before deletion and legacy-string read compatibility. The original SQLite persistence and failed-job service tests remain unchanged.

The regression was reproduced against installed 2.2.59 and the pre-fix source; the same installed-package probe stored objects on 2.2.42. PostgreSQL 16/18 failed-before/passed-after evidence established the correction before cumulative release validation. Local focused proof does not replace the exact release's full validation or published-consumer qualification.
