# Initial-admin provisioning

User-auth starters (cookie, token, JWT and their combinations) generate `auth:provision-admin`. Header-auth apps have no persisted user identity and do not get this command. This contract was merged after 2.2.0: use a published release containing the CLI helper and generated output. Existing applications must deliberately adopt the command, registration and migration; upgrading packages alone changes none of those application files.

## Operator procedure

1. Apply migrations separately with the deployment migration owner. The generated `0004_initial_admin_provisioning` migration uses the official Schema API. For an existing application, use its next available filename and matching migration name. Do not replace applied migration files or recreate the user schema.
2. Keep application/worker admission stopped during initial provisioning. Use the correct runtime database credentials and tenancy configuration; Postgres RLS applications require a restricted runtime role and `TENANCY_DRIVER=rls`. The command checks the live role and uses the official transactional migration bypass for this trusted cross-tenant administrative operation. Runtime roles need SELECT/INSERT on the claim table and SELECT/INSERT plus sequence access on users. Do not expose this bypass or command as an HTTP route.
3. For tenant-enabled applications, provision/approve the tenant through the application's administrative procedure first. Pass an existing positive safe-integer ID. The command creates neither tenants nor domain mappings and never silently assigns tenant 1. Omit `--tenant` for applications without tenant tables.
4. Provide a private password from your secret manager through a pipe or an ephemeral restricted secret mount. Use a unique secret of at least 16 Unicode code points and at most 72 UTF-8 bytes. One final LF/CRLF is accepted; embedded control characters, malformed UTF-8, the published demo password and oversized inputs are refused. The byte bound prevents bcrypt truncation. Do not put the password in command arguments, shell history, repository files or application environment defaults. Interactive terminal input is refused to avoid echoing it.

For example, with an operator-only secret-manager mount:

```sh
bunx strata auth:provision-admin \
  --email operator@example.test \
  --name "Initial Operator" \
  --tenant 1 \
  --password-stdin < /run/secrets/initial_admin_password
```

Replace the tenant ID with the approved existing tenant, or omit that flag for a non-tenant app. The command validates input before accessing SQL, hashes using the official asynchronous authentication helper, opens only database infrastructure, and closes its connection on success or failure. It does not start HTTP, queue workers or application providers, migrate schema, seed data, print credentials, or send mail.

Email is trimmed/lowercased; names are trimmed. The command does not set `email_verified_at`, enroll MFA, create API tokens, or mint a session/JWT. Complete verification and MFA through the application's normal flows, and resume admission after checking the account. Verification-enabled apps need their normal mail service and resend flow available. Restrict the secret mount to the operator and remove it according to the secret manager's lifecycle after provisioning.

## Atomic one-time claim

The application-generated command inserts singleton claim ID 1 into `initial_admin_provisioning` inside the same framework transaction as the user insert. Its primary key serializes competing provisioning commands across all tenants/processes. The command then checks for any existing admin, any case-insensitive matching account and, where applicable, the selected tenant. It inserts a new admin only when all checks pass. Existing accounts are never promoted or overwritten.

Any refusal or SQL failure rolls back both claim and account. After a successful commit, the claim records the normalized email and database timestamp and blocks subsequent provisioning, even if the account is later deleted. This is an application-global bootstrap operation, not a per-tenant admin management command. Run it before admission: the claim serializes these commands, not arbitrary custom admin writes or registration paths.

Driver errors can contain bound credentials, so the shared CLI helper reports a controlled failure without forwarding the underlying exception or its cause. A failed command exits unsuccessfully through the standard CLI. Diagnose schema, role, tenant and existing-account state through privileged administrative inspection; do not add password logging to the command.

A connection can fail after commit before the operator receives success. Inspect both the claim and account before retrying. If the claim exists, treat provisioning as committed and use normal account recovery rather than deleting it. A committed claim is intentionally permanent; the generated down migration refuses to discard it. Binary rollback can leave the additive table in place. This also blocks `migrate:fresh` when it invokes that down migration after provisioning. Recreating a deliberately disposable development database is an explicit reset, never a production recovery procedure.

## Adoption and supported customization

Keep the CLI's `runInitialAdminCommand` from `@getstrata/cli/initialAdmin` for bounded input validation and credential-safe failures. The generated application callback owns user columns, admin policy and the transactional claim. Adapt that callback for custom identity schemas or administrator policies; do not copy framework hashing, transaction or RLS mechanisms. If an application's deployment is invitation-only or uses external identity, supply its appropriate administrative flow instead of creating a password account.

Demo seeds stay development-only. This command does not audit, disable or rotate accounts already present in a legacy database. Additional administrators, lost-admin recovery, tenant lifecycle and session/token revocation remain explicit application administration with its own authorization/audit requirements. Provisioning does not substitute for deployment security review or provider qualification.

Verification covers generated command execution on SQLite, MySQL and Postgres with a real restricted RLS role, concurrent independent processes, existing-account/admin refusal, SQL failures after claim acquisition, rollback, hashed credentials, unchanged verification/MFA state, and permanent-claim replay refusal.
