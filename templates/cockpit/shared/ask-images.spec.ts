import { describe, expect, it } from "vitest";

import { ASK_AGENT_MAX_BODY_BYTES, MAX_ASK_IMAGE_BYTES, precheckImageFile, sniffImageType } from "./ask-images";

const b = (...x: number[]) => Uint8Array.from(x);

describe("ask-agent image limits", () => {
  it("knows the four image types by their magic bytes only", () => {
    expect(sniffImageType(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("image/png");
    expect(sniffImageType(b(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffImageType(new TextEncoder().encode("GIF89a...."))).toBe("image/gif");
    expect(sniffImageType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffImageType(new TextEncoder().encode("RIFF\0\0\0\0WAVEfmt "))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("<svg xmlns="))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("%PDF-1.7"))).toBeNull();
    expect(sniffImageType(b())).toBeNull();
  });

  it("refuses a fourth image, a non-image type and anything over 5 MB", () => {
    expect(precheckImageFile({ type: "image/png", size: 10 }, 0)).toBeNull();
    expect(precheckImageFile({ type: "image/png", size: 10 }, 3)).toMatch(/At most 3/);
    expect(precheckImageFile({ type: "application/pdf", size: 10 }, 0)).toMatch(/Only PNG/);
    expect(precheckImageFile({ type: "image/svg+xml", size: 10 }, 0)).toMatch(/Only PNG/);
    expect(precheckImageFile({ type: "image/jpeg", size: MAX_ASK_IMAGE_BYTES + 1 }, 0)).toMatch(/5 MB/);
    expect(precheckImageFile({ type: "image/jpeg", size: MAX_ASK_IMAGE_BYTES }, 0)).toBeNull();
  });

  it("bounds the request body at three full-size images plus the question", () => {
    expect(ASK_AGENT_MAX_BODY_BYTES).toBeGreaterThan(3 * MAX_ASK_IMAGE_BYTES * (4 / 3));
    expect(ASK_AGENT_MAX_BODY_BYTES).toBeLessThan(3 * MAX_ASK_IMAGE_BYTES * (4 / 3) + 128 * 1024);
  });
});
