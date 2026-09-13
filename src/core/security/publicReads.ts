function isPublicReadsEnabled(): boolean {
  return (process.env.FEATURE_PUBLIC_READS ?? "false") === "true";
}

function guestCanViewResource(): boolean {
  return isPublicReadsEnabled();
}

export { guestCanViewResource, isPublicReadsEnabled };
