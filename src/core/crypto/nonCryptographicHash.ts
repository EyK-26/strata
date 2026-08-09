function nonCryptographicDigest(input: string): string {
  return Bun.hash(input).toString(16);
}

export { nonCryptographicDigest };
