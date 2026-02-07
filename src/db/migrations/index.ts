import createCharacter from "./0001_create_character";
import createNemesis from "./0002_create_nemesis";
import createSecret from "./0003_create_secret";
import type { Migration } from "./types";

const migrations: Migration[] = [createCharacter, createNemesis, createSecret];

export { migrations };
export type { Migration };
