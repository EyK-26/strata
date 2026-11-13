/** Emit a planning inventory. Never generates, installs, starts or qualifies an app. */
import { createStarterPairwiseInventory } from "../tests/helpers/starterPairwiseProfiles";

const inventory = createStarterPairwiseInventory();
console.log(
  JSON.stringify(
    {
      ...inventory,
      summary: {
        caseCount: inventory.profiles.length,
        riskSeeds: inventory.profiles.filter((profile) => profile.source === "risk-seed").length,
        dimensionCount: inventory.dimensions.length,
        totalPairs: inventory.totalPairs,
        feasiblePairs: inventory.feasiblePairs,
        coveredPairs: inventory.coveredPairs,
        unsupportedPairs: inventory.unsupportedPairs.length,
        profileSha256: new Bun.CryptoHasher("sha256")
          .update(JSON.stringify(inventory.profiles))
          .digest("hex"),
      },
      qualification: "Not executed: compiler-valid planning inventory only.",
      referenceApplication:
        "GenerateOptions.reference='work-tracker' is separate from StarterLayers; qualify its stable integration explicitly.",
    },
    null,
    2,
  ),
);
