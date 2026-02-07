import type { Nemesis } from "./nemesis";

export interface Character {
  id: number;
  name: string;
  gender: string;
  ability: string;
  minimal_distance: string;
  weight: number;
  born: Date;
  in_space_since: Date;
  beer_consumption: number;
  knows_the_answer: boolean;
  nemeses?: Nemesis[];
}
