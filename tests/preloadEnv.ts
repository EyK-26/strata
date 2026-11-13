/** Core tests pin framework cookie names independently of a contributor's local .env. */
process.env.APP_KEY_PREFIX = "strata";
process.env.APP_NAME ??= "Strata";
