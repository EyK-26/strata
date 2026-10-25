import { expect, test } from "bun:test";
import { verifyFormMultiplicity } from "../helpers/formMultiplicityContract";

test("public form multiplicity supports app-owned rejection over real HTTP", async () => {
  expect(await verifyFormMultiplicity()).toEqual({
    preservedForms: true,
    rejectedAmbiguity: true,
    legacyLastText: true,
  });
});
