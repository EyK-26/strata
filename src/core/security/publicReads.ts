function isPublicReadsEnabled(enabled = false): boolean {
  return enabled;
}

function guestCanViewResource(enabled = false): boolean {
  return isPublicReadsEnabled(enabled);
}

export { guestCanViewResource, isPublicReadsEnabled };
