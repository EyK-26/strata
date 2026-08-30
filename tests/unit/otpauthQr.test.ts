import { describe, expect, test } from "bun:test";
import { otpauthQrDataUri } from "../../src/modules/user/otpauthQr";

describe("otpauthQr", () => {
  test("renders an svg data uri for an otpauth URL", () => {
    const uri = otpauthQrDataUri(
      "otpauth://totp/WorkHub:admin@workhub.test?secret=JBSWY3DPEHPK3PXP&issuer=WorkHub",
    );

    expect(uri.startsWith("data:image/svg+xml;utf8,")).toBe(true);
    const svg = decodeURIComponent(uri.slice("data:image/svg+xml;utf8,".length));
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });
});
