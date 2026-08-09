import type { Blueprint } from "../blueprint.ts";
import type { DatabaseDriver } from "../driver.ts";
import { compileBlueprint } from "./compileStatements.ts";
import type { Grammar } from "./grammar.ts";

function createGrammar(driver: DatabaseDriver): Grammar {
  return {
    driver,
    compile(blueprint: Blueprint): string[] {
      return compileBlueprint(driver, blueprint);
    },
  };
}

export { createGrammar };
