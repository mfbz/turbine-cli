// Node 24's OpenSSL offers a post-quantum hybrid key share (X25519MLKEM768) by default. It makes the
// TLS hello over a kilobyte, and some networks and gateways reset such a hello: Turbine's API then
// looks unreachable from Node while curl works. Classic curves keep TLS 1.3 and its forward secrecy;
// what they give up is protection against recording today's traffic to decrypt with a future
// quantum computer. Order flow is confidential, but its value is short-lived. It applies to every
// connection (Turbine, the SDK, an RPC endpoint): the same networks would reset those too.
const CLASSIC_KEY_SHARES = "X25519:P-256:P-384";

function preferClassicKeyShares(tls: { DEFAULT_ECDH_CURVE: string }): void {
  tls.DEFAULT_ECDH_CURVE = CLASSIC_KEY_SHARES;
}

export { preferClassicKeyShares };
