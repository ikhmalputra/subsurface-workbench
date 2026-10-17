// Compact JWS with ES256, as the mock identity provider signs tokens and the mock OSDU verifies
// them: a few lines on node:crypto, no library. Only ES256 is accepted; an "alg" of anything else
// (none, HS256 with the public key as the secret) is refused before any key is touched.
import { createHash, createPublicKey, randomBytes, sign, verify } from "node:crypto";

export const b64url = (data) => Buffer.from(data).toString("base64url");
export const b64urlJson = (value) => b64url(JSON.stringify(value));
export const sha256b64url = (text) => createHash("sha256").update(text).digest("base64url");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** `claims` signed with an EC P-256 private key; `kid` names the key in the JWKS. */
export function signJwt(claims, privateKey, kid) {
  const signingInput = `${b64urlJson({ alg: "ES256", typ: "JWT", kid })}.${b64urlJson(claims)}`;
  const signature = sign("sha256", Buffer.from(signingInput), { key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${b64url(signature)}`;
}

/** The header and claims of a compact JWT, unverified, or null when it is not one. */
export function decodeJwt(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (!header || typeof header !== "object" || !claims || typeof claims !== "object") return null;
    return { header, claims, signingInput: `${parts[0]}.${parts[1]}`, signature: Buffer.from(parts[2], "base64url") };
  } catch {
    return null;
  }
}

/**
 * The claims of `token` when its ES256 signature checks against a key in `jwks` and it is in its
 * lifetime at `nowS` (with `leewayS` seconds of tolerance either way); otherwise a reason string.
 */
export function verifyJwt(token, jwks, { nowS = Math.floor(Date.now() / 1000), leewayS = 60, issuer } = {}) {
  const decoded = decodeJwt(token);
  if (!decoded) return { error: "malformed token" };
  const { header, claims, signingInput, signature } = decoded;
  if (header.alg !== "ES256") return { error: `alg ${String(header.alg)} not accepted` };
  const keys = Array.isArray(jwks?.keys) ? jwks.keys : [];
  const jwk = keys.find((key) => key.kid === header.kid && key.kty === "EC" && key.crv === "P-256") ?? (header.kid === undefined && keys.length === 1 ? keys[0] : undefined);
  if (!jwk) return { error: "unknown key" };
  let ok;
  try {
    ok = verify("sha256", Buffer.from(signingInput), { key: createPublicKey({ key: jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" }, signature);
  } catch {
    ok = false;
  }
  if (!ok) return { error: "bad signature" };
  if (typeof claims.exp !== "number" || claims.exp + leewayS < nowS) return { error: "token expired" };
  if (typeof claims.nbf === "number" && claims.nbf - leewayS > nowS) return { error: "token not yet valid" };
  if (typeof claims.iat === "number" && claims.iat - leewayS > nowS) return { error: "token issued in the future" };
  if (issuer && claims.iss !== issuer) return { error: "wrong issuer" };
  return { claims };
}
