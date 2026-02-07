import type { CharacterRecord, NemesisRecord } from "../../types/JSONTree";
import type { Character } from "../../types/character";
import type {
  CharacterRepositoryLike,
  NemesisRepositoryLike,
  SecretRepositoryLike,
} from "../../types/repositories";

class CharacterService {
  constructor(
    private readonly characterRepository: CharacterRepositoryLike,
    private readonly nemesisRepository: NemesisRepositoryLike,
    private readonly secretRepository: SecretRepositoryLike,
  ) {}

  async getCharactersWithNemesisAndSecrets(): Promise<Character[]>;
  async getCharactersWithNemesisAndSecrets(options: {
    asTree: false;
  }): Promise<Character[]>;
  async getCharactersWithNemesisAndSecrets(options: {
    asTree: true;
  }): Promise<CharacterRecord[]>;
  async getCharactersWithNemesisAndSecrets(
    options: {
      asTree?: boolean;
    } = {},
  ): Promise<Character[] | CharacterRecord[]> {
    const { asTree = false } = options;

    const characters = await this.characterRepository.findAll();
    const nemesesByCharacterId =
      await this.nemesisRepository.loadByCharacters(characters);
    const nemeses = characters.flatMap(
      (character) => nemesesByCharacterId.get(character.id) ?? [],
    );
    const secretsByNemesisId =
      await this.secretRepository.loadByNemeses(nemeses);

    if (asTree) {
      return characters.map((character) => ({
        data: character,
        children: {
          has_nemesis: {
            records: (nemesesByCharacterId.get(character.id) ?? []).map(
              (nemesis): NemesisRecord => ({
                data: nemesis,
                children: {
                  has_secret: {
                    records: (secretsByNemesisId.get(nemesis.id) ?? []).map(
                      (secret) => ({ data: secret }),
                    ),
                  },
                },
              }),
            ),
          },
        },
      }));
    }

    return characters.map((character) => ({
      ...character,
      nemeses: (nemesesByCharacterId.get(character.id) ?? []).map(
        (nemesis) => ({
          ...nemesis,
          secrets: secretsByNemesisId.get(nemesis.id) ?? [],
        }),
      ),
    }));
  }
}

export default CharacterService;
