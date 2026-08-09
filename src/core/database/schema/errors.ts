class UnsupportedSchemaFeatureError extends Error {
  constructor(feature: string, driver: string) {
    super(`${feature} is not supported for the ${driver} driver`);
    this.name = "UnsupportedSchemaFeatureError";
  }
}

export { UnsupportedSchemaFeatureError };
