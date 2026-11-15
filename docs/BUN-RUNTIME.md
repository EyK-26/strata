# Bun runtime

Strata requires Bun **>=1.4.4**. `.bun-version`, CI and generated Docker images pin
1.4.4; package engines and type requirements declare the same minimum.

Changing a runtime pin requires validation against the supported database engines,
HTTP, streaming and image APIs. Installing a framework update does not rewrite an
existing application's runtime pin, Dockerfile or frontend lockfile. Update those
files deliberately and run the application's tests. External providers and managed
poolers need their own compatibility checks.
