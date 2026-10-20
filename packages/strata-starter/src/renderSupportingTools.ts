import {
  appDatabaseName,
  GENERATED_MYSQL_ROOT_PASSWORD,
  GENERATED_POSTGRES_SUPERUSER_PASSWORD,
} from "./databaseDefaults.ts";
import {
  DOCKER_SERVICE_LABELS,
  type DockerServiceName,
  dockerComposeUpCommand,
  neededDockerServices,
  type StarterLayers,
  selectedDockerServices,
} from "./types.ts";

function localEnvVars(services: DockerServiceName[]): string[] {
  const vars: string[] = [];
  for (const name of services) {
    if (name === "postgres" || name === "mysql") {
      vars.push("DATABASE_URL");
    } else if (name === "redis") {
      vars.push("REDIS_URL");
    } else if (name === "mailpit") {
      vars.push("MAIL_HOST");
    }
  }
  return [...new Set(vars)];
}

function renderSupportingToolsReadme(projectName: string, layers: StarterLayers): string {
  const needed = neededDockerServices(layers);
  if (needed.length === 0) {
    return "";
  }

  const dockerOn = selectedDockerServices(layers);
  const dockerSet = new Set(dockerOn);
  const localOn = needed.filter((name) => !dockerSet.has(name));
  const lines = ["## Supporting tools", ""];

  if (dockerOn.length > 0) {
    const names = dockerOn.map((name) => DOCKER_SERVICE_LABELS[name]).join(", ");
    lines.push(
      `Docker Compose includes ${names}.`,
      "",
      "```bash",
      dockerComposeUpCommand(layers),
      "```",
      "",
      "Wait for this command to succeed before migrating. It waits up to 180 seconds for selected services to be healthy; inspect `docker compose ps` and `docker compose logs` if it fails. Increasing `--wait-timeout` can accommodate a slow first initialization. These checks do not run application migrations.",
      "",
    );
    if (dockerSet.has("adminer")) {
      const mysql = layers.database === "mysql";
      const system = mysql ? "MySQL" : "PostgreSQL";
      const server = mysql ? "mysql" : "postgres";
      const username = mysql ? "root" : "postgres";
      const password = mysql
        ? GENERATED_MYSQL_ROOT_PASSWORD
        : GENERATED_POSTGRES_SUPERUSER_PASSWORD;
      lines.push(
        `Adminer: http://localhost:8080 (${system}, server \`${server}\`, username \`${username}\`, password \`${password}\`, database \`${appDatabaseName(projectName)}\`).`,
        "",
        "Adminer is optional development tooling in the `debug` profile; plain `docker compose up -d` does not start Adminer. Use the profile command above to start it with the database.",
        "",
      );
      if (!mysql) {
        lines.push(
          "Adminer uses the Compose `postgres` superuser, which skips FORCE RLS. Application traffic should use `strata_app`.",
          "",
        );
      }
    }
  }

  if (localOn.length > 0) {
    const names = localOn.map((name) => DOCKER_SERVICE_LABELS[name]).join(", ");
    const envVars = localEnvVars(localOn)
      .map((name) => `\`${name}\``)
      .join(", ");
    lines.push(
      `Use local installs for ${names}. Point ${envVars} in \`.env\` at services on this machine.`,
      "",
    );
  }

  return `${lines.join("\n")}\n`;
}

export { renderSupportingToolsReadme };
