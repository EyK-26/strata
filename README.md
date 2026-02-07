# 42 API with Bun

Docker-only Bun + PostgreSQL app.

Pinned versions:

- Bun `1.3.14`
- PostgreSQL `18.4`
- Adminer `5.4.2`

The database source of truth is now:

- `src/db/migrations`
- `src/db/seeders`

## Start

```bash
docker compose up -d --wait
```

Startup automatically runs:

- `bun run cli migrate`
- `bun run cli seed`
- `bun run start`

Optional runtime config:

- `PORT`
- `CACHE_TTL_MS`
- `CACHE_MAX_ENTRIES`

Some list endpoints also accept validated query params, for example:

- `/characters?limit=1&gender=male`
- `/nemesis?limit=2&isAlive=true`
- `/secrets?limit=1`

Open:

- App: `http://localhost:3000`
- API: `http://localhost:3000/characters`
- Adminer: `http://localhost:8080`

Adminer login:

- System: `PostgreSQL`
- Server: `postgres`
- Username: `postgres`
- Password: `postgres`
- Database: `bun_testing_test`

## Run tests

```bash
docker compose exec app bun run test:all
```

## Enter the app container

```bash
docker compose exec app sh
```

Useful commands inside:

```bash
bun run test:all
bun run check
bun run cli help
```

## CLI

Show commands:

```bash
bun run cli help
```

Run migrations:

```bash
bun run cli migrate
```

Check migration status:

```bash
bun run cli migrate:status
```

Rebuild the schema from migrations:

```bash
bun run cli migrate:fresh
```

Rebuild the schema and seed it:

```bash
bun run cli migrate:fresh --seed
```

Run seeders:

```bash
bun run cli seed
```

Rollback the latest migration batch:

```bash
bun run cli rollback
```

Create a migration file:

```bash
bun run cli make:migration create_users
```

Create a module scaffold:

```bash
bun run cli make:module user
```

Generated modules include:

- `provider.ts`
- `controller.ts`
- `requests.ts`
- `resources.ts`
- `table.ts`
- `repository.ts`
- `service.ts`
- `routes.ts`

`requests.ts` is where query/body DTO parsing and validation should live.

## After code or dependency changes

```bash
docker compose restart app
```

## Stop

```bash
docker compose down -v --remove-orphans
```

## Main endpoints

- `GET /characters`
- `GET /nemesis`
- `GET /secrets`
- `GET /characters-formatted`
- `GET /statistics`
- `GET /final-json-tree`
