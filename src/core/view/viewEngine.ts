interface ViewEngine {
  render(
    name: string,
    data?: Record<string, unknown>,
    options?: { layout?: string | false },
  ): Promise<string>;
}

export type { ViewEngine };
