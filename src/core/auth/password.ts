async function hashPassword(password: string): Promise<string> {
  return await Bun.password.hash(password, {
    algorithm: "bcrypt",
    cost: 10,
  });
}

async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  return await Bun.password.verify(password, passwordHash);
}

export { hashPassword, verifyPassword };
