interface ViewEngine {
  render(
    name: string,
    data?: Record<string, unknown>,
    options?: { layout?: string | false; request?: Request },
  ): Promise<string>;
}

export type { ViewEngine };
