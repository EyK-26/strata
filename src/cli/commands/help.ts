function helpCommand(): void {
  console.log(
    `Available commands:\n- help\n- migrate\n- migrate:status\n- migrate:fresh [--seed]\n- rollback\n- seed\n- make:migration <name>\n- make:module <name>\n- make:policy <module>\n- make:job <name>\n- make:listener <name> [event]\n- make:request <module>\n- make:factory <name>\n- queue:work\n- queue:failed\n- queue:retry <id>\n- queue:flush-failed\n- route:list\n- openapi:generate\n- openapi:validate\n- sdk:generate\n- schedule:run`,
  );
}

export { helpCommand };
