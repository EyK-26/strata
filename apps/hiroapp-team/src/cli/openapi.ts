async function bootstrap() {
  const { createApp } = await import("../bootstrap/createApp.ts");
  return createApp({ migrate: false });
}

async function openapiGenerateCommand(): Promise<void> {
  const { createOpenApiGenerateCommand } = await import("@getstrata/cli/openapi");
  await createOpenApiGenerateCommand(bootstrap)();
}

async function openapiValidateCommand(): Promise<void> {
  const { createOpenApiValidateCommand } = await import("@getstrata/cli/openapi");
  await createOpenApiValidateCommand(bootstrap)();
}

async function openapiCheckCommand(): Promise<void> {
  const { createOpenApiCheckCommand } = await import("@getstrata/cli/openapi");
  await createOpenApiCheckCommand(bootstrap)();
}

export { openapiCheckCommand, openapiGenerateCommand, openapiValidateCommand };
