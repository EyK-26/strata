function missingOptionalPeer(packageName: string, reason: string, error: unknown): Error {
  return new Error(`Install ${packageName} ${reason} (\`bun add ${packageName}\`).`, {
    cause: error,
  });
}

export { missingOptionalPeer };
