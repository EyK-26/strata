function isPublicReadsEnabled(): boolean {
  return (process.env.FEATURE_PUBLIC_READS ?? "true") !== "false";
}

function guestCanViewResource(): boolean {
  return isPublicReadsEnabled();
}

export { guestCanViewResource, isPublicReadsEnabled };
