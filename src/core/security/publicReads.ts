import { isFeatureEnabled } from "../../config/features";

function isPublicReadsEnabled(): boolean {
  return isFeatureEnabled("publicReads");
}

function guestCanViewResource(): boolean {
  return isPublicReadsEnabled();
}

export { guestCanViewResource, isPublicReadsEnabled };
