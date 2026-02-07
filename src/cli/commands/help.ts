function helpCommand(): void {
  console.log(
    `Available commands:\n- help\n- migrate\n- migrate:status\n- migrate:fresh [--seed]\n- rollback\n- seed\n- make:migration <name>\n- make:module <name>`,
  );
}

export { helpCommand };
