# create-strata 0.1.10

Always-custom wizard: frontend, one database engine, auth, tenancy, cache, queue, mail, extras, then optional Docker Compose per selected tool. In-repo example apps are generated from the same script. The original hiring product is not the source of the generator.

## 0.1.10

- Cookie / cookie-* apps get a restyleable HTML auth kit: welcome, login, register, forgot/reset password (`views/` + `public/assets/site.css`).
- Token and JWT apps get JSON register and password reset.
- `--tenancy=column` writes a tenant table on any engine. sqlite/mysql `--tenancy=rls` becomes `column` instead of `none`.
- Selected extras emit MFA pages, email verification, and a SCIM `/Users` adapter (not env flags alone).
- `strata migrate` seeds empty tables (demo login after migrate).
- Seed and email-verify timestamps bind as ISO strings so SQLite parameter binding succeeds.
