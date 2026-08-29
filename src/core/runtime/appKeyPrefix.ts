function appKeyPrefix(): string {
  return process.env.APP_KEY_PREFIX?.trim() || "workhub";
}

function namespacedRedisKey(kind: string): string {
  return `${appKeyPrefix()}:${kind}`;
}

export { appKeyPrefix, namespacedRedisKey };
