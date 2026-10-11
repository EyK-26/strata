function printHelp(commandNames: string[]): void {
  const unique = [...new Set(commandNames)].sort();
  const descriptions: Record<string, string> = {
    dev: "HTTP development server; workers run separately",
    start: "HTTP server; workers run separately",
    "queue:work": "Poll Redis for queued jobs; requires REDIS_URL",
    "outbox:work":
      "Poll SQL for durable listener deliveries; requires migrations and registered listeners",
  };
  const list = unique
    .map(
      (name) => `- ${name}${Object.hasOwn(descriptions, name) ? ` — ${descriptions[name]}` : ""}`,
    )
    .join("\n");
  const workers = unique.filter((name) => name === "queue:work" || name === "outbox:work");
  const guidance = workers.length
    ? `\n\nBackground workers are explicit. Run ${workers.map((name) => `strata ${name}`).join(" and ")} in separate terminals when your app uses those mechanisms. Use the same application configuration as HTTP. dev/start do not start workers. Idle polling is normal; startup output is not a dependency health check.`
    : "";
  console.log(`Available commands:\n${list}${guidance}`);
}

export { printHelp };
