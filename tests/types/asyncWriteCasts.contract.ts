/** Compiled against source and packed declarations; not executed. */
import { applyCasts, dehydrateValue, Model } from "@getstrata/core/database/model";

type Attributes = Record<string, unknown>;
class LegacyWriteOverride extends Model<{ id: number; name: string }, "id"> {
  protected static override dehydrateAttributes(attributes: Attributes): Attributes {
    return attributes;
  }
}
class AsyncWriteOverride extends Model<{ id: number; name: string }, "id"> {
  protected static override async dehydrateAttributes(attributes: Attributes): Promise<Attributes> {
    return await Model.dehydrateAttributes(attributes);
  }
}

export async function asyncWriteCastContracts(): Promise<void> {
  const values = { password: "plain" };
  const hydrated: Attributes = applyCasts(values, { password: "hashed" }, "hydrate");
  const pending: Promise<Attributes> = applyCasts(values, { password: "hashed" }, "dehydrate");
  const written: Attributes = await pending;
  const hash: Promise<unknown> = dehydrateValue("plain", "hashed");
  // @ts-expect-error Write casting must finish before a record is used.
  const early: Attributes = applyCasts(values, { password: "hashed" }, "dehydrate");
  // @ts-expect-error A password hash is asynchronous.
  const earlyHash: string = dehydrateValue("plain", "hashed");
  await LegacyWriteOverride.create({ name: "legacy" });
  await AsyncWriteOverride.create({ name: "async" });
  void [hydrated, written, hash, early, earlyHash];
}
