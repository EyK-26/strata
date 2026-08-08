function helpCommand(): void {
  console.log(
    `Available commands:\n- help\n- migrate\n- migrate:status\n- migrate:fresh [--seed]\n- rollback\n- seed\n- make:migration <name>\n- make:module <name>\n- make:policy <module>\n- make:job <name>\n- make:listener <name> [event]\n- queue:work`,
  );
}

export { helpCommand };
