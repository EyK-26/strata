function helpCommand(): void {
  console.log(
    `Available commands:\n- help\n- dev\n- start\n- run <file>\n- new [--template=api|server-htmx|spa-react] [--frontend=api|server-htmx|spa-react] [--env=.env]\n- tinker\n- shell\n- migrate\n- migrate:status\n- migrate:fresh [--seed]\n- rollback\n- seed\n- make:migration <name>\n- make:module <name> [--with-web]\n- make:policy <module>\n- make:job <name>\n- make:listener <name> [event]\n- make:request <module>\n- make:factory <name>\n- queue:work\n- queue:failed\n- queue:retry <id>\n- queue:flush-failed\n- route:list\n- openapi:generate\n- openapi:validate\n- openapi:check\n- sdk:generate\n- schedule:run\n- schedule:install\n- schedule:uninstall\n- secrets:check`,
  );
}

export { helpCommand };
