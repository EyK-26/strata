# Deployment

Create an application with `bunx create-strata` and follow its generated README, Dockerfile and Compose configuration. The framework repository is a library/test workspace; its root Dockerfile builds a disposable acceptance app from current generator output and candidate tarballs. It is not the shop or a production reference deployment.

Product deployment guidance is in [PRODUCTION](docs/PRODUCTION.md), [security](docs/SECURITY.md) and [disaster recovery](docs/DR.md). The external [strata-shop](https://github.com/EyK-26/strata-shop) owns commerce deployment and operational qualification.

The root Compose file starts contributor infrastructure. The optional `docker-compose.prod.yml` and staging overlay are manual acceptance-image configurations. Supply explicit rotated credentials, run the administrative migration service separately, then start HTTP/workers; no demo seeding occurs at startup. HTTP/workers receive only restricted database URLs. They are not qualified product deployment manifests.

`bun run test:e2e` includes a real generated-image runtime check: it builds the image, creates an owned temporary Postgres container, runs explicit migrations/fixture seeding, starts HTTP with production secret checks and a restricted live role, verifies HTTP/metrics/CSRF and clean native CLI shutdown, then removes its owned containers/image. The unchanged smoke scripts run against the real published Docker port. Required infrastructure or Docker failures fail the test, rather than skip it.

The CLI and Docker retirement evidence is recorded in [GENERATED-APP-ACCEPTANCE](docs/GENERATED-APP-ACCEPTANCE.md). This acceptance does not prove production capacity, external provider credentials, restore objectives or a security audit.
