import { renderSVG } from "uqr";

function otpauthQrDataUri(otpauthUrl: string): string {
  const svg = renderSVG(otpauthUrl, { ecc: "M", border: 2, pixelSize: 4 });

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export { otpauthQrDataUri };
