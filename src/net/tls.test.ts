import { describe, expect, it } from "vitest";

import { preferClassicKeyShares } from "./tls.ts";

describe("TLS key shares", () => {
  it("offers only classic curves, so a post-quantum hello too big for some networks isn't sent", () => {
    const tls = { DEFAULT_ECDH_CURVE: "auto" };
    preferClassicKeyShares(tls);
    expect(tls.DEFAULT_ECDH_CURVE).toBe("X25519:P-256:P-384");
    expect(tls.DEFAULT_ECDH_CURVE).not.toMatch(/MLKEM/i);
  });
});
