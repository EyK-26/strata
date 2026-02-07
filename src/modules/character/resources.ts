import { serializeDate, toResourceCollection } from "../../core/http";
import type { CharacterRecord, JSONTree } from "../../types/JSONTree";
import type { Character } from "../../types/character";
import {
  toNemesisResource,
  toNemesisResourceCollection,
  type NemesisResource,
  type NemesisTreeRecordResource,
} from "../nemesis/resources";
import {
  toSecretResource,
  type SecretResource,
} from "../secret/resources";

interface CharacterResource {
  id: number;
  name: string;
  gender: string;
  ability: string;
  minimal_distance: string;
  weight: number;
  born: string;
  in_space_since: string;
  beer_consumption: number;
  knows_the_answer: boolean;
  nemeses?: NemesisResource[];
}

function toCharacterResource(character: Character): CharacterResource {
  return {
    id: character.id,
    name: character.name,
    gender: character.gender,
    ability: character.ability,
    minimal_distance: character.minimal_distance,
    weight: character.weight,
    born: serializeDate(character.born),
    in_space_since: serializeDate(character.in_space_since),
    beer_consumption: character.beer_consumption,
    knows_the_answer: character.knows_the_answer,
    ...(character.nemeses
      ? { nemeses: toNemesisResourceCollection(character.nemeses) }
      : {}),
  };
}

function toCharacterResourceCollection(
  characters: readonly Character[],
): CharacterResource[] {
  return toResourceCollection(characters, toCharacterResource);
}

interface CharacterTreeRecordResource {
  data: CharacterResource;
  children: {
    has_nemesis: {
      records: NemesisTreeRecordResource[];
    };
  };
}

interface JSONTreeResource {
  characters_count: number;
  average_age: number;
  average_weight: number;
  genders: JSONTree["genders"];
  characters: CharacterTreeRecordResource[];
}

function toCharacterTreeRecordResource(
  record: CharacterRecord,
): CharacterTreeRecordResource {
  return {
    data: toCharacterResource(record.data),
    children: {
      has_nemesis: {
        records: record.children.has_nemesis.records.map((nemesisRecord) => ({
          data: toNemesisResource(nemesisRecord.data),
          children: {
            has_secret: {
              records: nemesisRecord.children.has_secret.records.map(
                (secretRecord): { data: SecretResource } => ({
                  data: toSecretResource(secretRecord.data),
                }),
              ),
            },
          },
        })),
      },
    },
  };
}

function toJSONTreeResource(tree: JSONTree): JSONTreeResource {
  return {
    characters_count: tree.characters_count,
    average_age: tree.average_age,
    average_weight: tree.average_weight,
    genders: tree.genders,
    characters: tree.characters.map(toCharacterTreeRecordResource),
  };
}

export {
  toCharacterResource,
  toCharacterResourceCollection,
  toCharacterTreeRecordResource,
  toJSONTreeResource,
};
export type { CharacterResource, CharacterTreeRecordResource, JSONTreeResource };
