/** Explicit handler declarations shared by the controller and route renderers. */
export class ControllerActions {
  private readonly methods = new Map<string, string>();
  constructor(readonly className: string) {}

  add(name: string, handler: string): string {
    if (this.methods.has(name)) throw new Error(`Duplicate ${this.className}.${name}`);
    this.methods.set(name, handler);
    return `controller.${name}`;
  }

  render(construction = "", scope: readonly string[] = []): string {
    const methods = [...this.methods].map(([name, handler]) => {
      // Every declaration supplies a single arrow function. Split its signature
      // from its body; nested callbacks and their execution boundaries stay intact.
      const arrow = handler.indexOf("=>");
      if (arrow < 0) throw new Error(`Missing arrow for ${this.className}.${name}`);
      const signature = handler.slice(0, arrow).trim();
      const body = handler.slice(arrow + 2).trim();
      const statements = body.startsWith("{") ? body.slice(1, -1) : `return ${body};`;
      const lines = statements.replace(/^\n/, "").replace(/\s+$/, "").split("\n");
      const indentation = Math.min(
        ...lines.filter((line) => line.trim()).map((line) => line.match(/^\s*/)?.[0].length ?? 0),
      );
      const formatted = lines
        .map((line) => (line.trim() ? `    ${line.slice(indentation)}` : ""))
        .join("\n");
      const usedScope = scope.filter((binding) => new RegExp(`\\b${binding}\\b`).test(handler));
      return `  ${name}: BusinessRouteHandler = ${signature} => {${usedScope.length ? `\n    const { ${usedScope.join(", ")} } = this;` : ""}\n${formatted}\n  };`;
    });
    return `export class ${this.className} {\n${construction}\n${methods.join("\n\n")}\n}\n`;
  }
}

/** The legacy aggregate renderer remains useful for security characterization. */
export function renderAction(
  actions: ControllerActions | undefined,
  name: string,
  handler: string,
): string {
  return actions ? actions.add(name, handler) : handler;
}

export interface RenderedHttpFeature {
  readonly files: Readonly<Record<string, string>>;
  readonly api?: { readonly name: string; readonly source: string };
  readonly web?: { readonly name: string; readonly source: string };
}
