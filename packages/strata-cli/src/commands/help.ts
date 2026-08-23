function printHelp(commandNames: string[]): void {
  const unique = [...new Set(commandNames)].sort();
  const list = unique.map((name) => `- ${name}`).join("\n");
  console.log(`Available commands:\n${list}`);
}

export { printHelp };
