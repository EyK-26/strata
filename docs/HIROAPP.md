# Legacy HiroApp transition

HiroApp is no longer the framework runtime or contributor Docker application. Its directories are temporarily retained until the final removal PR. They are not workspaces or image inputs. Product dogfood lives in [strata-shop](https://github.com/EyK-26/strata-shop); framework acceptance generates isolated apps from the current starter and candidate packages.

See [GENERATED-APP-ACCEPTANCE](GENERATED-APP-ACCEPTANCE.md) for preserved assertion inventories and staged validation, and [TESTING](TESTING.md) for current contributor commands. The old `hiroapp:fresh`, `hiroapp:dev`, root `dev`/`start` and Compose app/worker commands are retired.
