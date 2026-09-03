# Laravel design parity

The API catalog score in `docs/PARITY-AUDIT.md` only checks that a Laravel doc section has a Strata export and a test. That is not Laravel similarity.

**Design parity** is the goal: same concepts and call shape as Laravel, routed to TypeScript and Bun. PHP magic (`__get`, facades as statics that hide IO) becomes explicit JS (`applications()`, `await`, `load()` / `loaded()`). Horizon, Nova, and Artisan stay Bun-native stand-ins, not PHP clones.

| Design status | Meaning |
|---------------|---------|
| `laravel` | Call shape matches Laravel for that section, with only language-required differences |
| `partial` | Primary Laravel methods exist; notable Eloquent/Laravel APIs still missing |
| `stand-in` | A Strata API covers the problem area but is not Laravel-shaped |

WorkHub, HiroApp, and published starters are how gaps get found. Fix `@getstrata/core` (and bootstrap/cli when needed). Do not paper over a missing design with an app-only workaround.

Horizon, Nova, and the Artisan CLI stay Bun-native stand-ins. Stripe webhooks and Prometheus metrics are partial: they cover the job, not Laravel Cashier/Telescope.

## Current Eloquent shape

```ts
class User extends Model<UserRecord, "id"> {
  applications() {
    return this.hasMany(Application);
  }
}

const open = await user.applications().where({ status_id: 1 }).get();
await user.applications().create({ position_id: 4, status_id: 1 });
await user.load("applications");
user.loaded("applications");
await User.with("applications").get();

await User.whereHas("applications", (query) => query.where?.({ status_id: 1 })).get();
await User.firstOrCreate({ email: "ada@example.com" }, { name: "Ada" });

class Image extends Model<ImageRecord, "id"> {
  imageable() {
    return this.morphTo({ users: User }, "imageable");
  }
}

await new UserFactory().count(3).state({ role: "admin" }).create();
await new ApplicationFactory().for(user, "user_id").recycle(user, "user_id").create();
await new UserFactory().has(new ApplicationFactory(), "user_id").create();

class UserResource extends JsonResource<User> {
  override toArray() {
    return { name: this.resource.get("name"), role: this.whenLoaded("role") };
  }
}
```
