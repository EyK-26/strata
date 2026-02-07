import type { Secret } from "./secret";

export interface Nemesis {
  is_alive: boolean;
  years: number;
  id: number;
  character_id: number;
  secrets?: Secret[];
}
