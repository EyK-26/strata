import { rm } from "node:fs/promises";
import { CandidatePackageOwnershipError, prepareCandidatePackages } from "./candidate-packages";

/** Packer children are owned by candidate-packages, separately from profile command children. */
export class StarterQualificationRoot {
  private unresolvedPack = false;
  constructor(readonly root: string) {}

  async prepare(directory: string, prepare = prepareCandidatePackages): Promise<void> {
    try {
      await prepare(directory);
    } catch (error) {
      if (error instanceof CandidatePackageOwnershipError) this.unresolvedPack = true;
      throw error;
    }
  }

  async cleanup(unresolvedCommand: boolean): Promise<"retained" | "removed"> {
    if (this.unresolvedPack || unresolvedCommand) return "retained";
    await rm(this.root, { recursive: true, force: true });
    return "removed";
  }
}
