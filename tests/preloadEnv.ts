/** Dogfood identity. Framework defaults are `strata` / `Strata` when unset. */
const hiroapp =
  process.env.HIROAPP_TEST === "1" ||
  (process.env.DOGFOOD_APP ?? "").trim().toLowerCase() === "hiroapp";
process.env.APP_KEY_PREFIX ??= hiroapp ? "hiroapp" : "workhub";
process.env.APP_NAME ??= hiroapp ? "HiroApp" : "WorkHub";
