#!/usr/bin/env node
// Verifies a release from its manifest, as a client does on a clean machine before deploying:
// every checksum and size, every signature (cosign, with the public key), that each SBOM belongs
// to the artifact beside it, and that the bundle's version.json and each package's package.json
// name the release. Exit 0 when everything holds; 1 when something does not; 2 when the release is
// an unsigned development drop and --allow-unsigned was not given.
//
//   node tools/release/verify-release.mjs output/release/0.4.0/release-manifest.json --key subsurface.pub
//   node tools/release/verify-release.mjs output/release/0.4.0 --allow-unsigned
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith("--"));
if (!target) { console.error("usage: verify-release.mjs <release-manifest.json | release dir> [--key pub.pem] [--allow-unsigned]"); process.exit(1); }
const manifestPath = statSync(target).isDirectory() ? resolve(target, "release-manifest.json") : resolve(target);
const dir = dirname(manifestPath);
const keyIndex = args.indexOf("--key");
const key = keyIndex >= 0 ? args[keyIndex + 1] : process.env.COSIGN_PUBLIC_KEY;
const allowUnsigned = args.includes("--allow-unsigned");
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const failures = [];
const check = (ok, message) => { console.log(`${ok ? "ok  " : "FAIL"} ${message}`); if (!ok) failures.push(message); };
const tarRead = (archive, member) => { const r = spawnSync("tar", ["-xOzf", archive, member], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); return r.status === 0 ? r.stdout : null; };

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
console.log(`release ${manifest.version} (${manifest.commit}), ${manifest.signed ? "signed" : "UNSIGNED"}, ${manifest.artifacts.length} artifacts\n`);

const verifyBlob = (name, signature) => {
  if (!key) { check(false, `${name}: a public key is needed to verify ${signature} (--key)`); return; }
  const r = spawnSync("cosign", ["verify-blob", "--key", key, "--signature", resolve(dir, signature), resolve(dir, name)], { encoding: "utf8", stdio: "pipe" });
  check(r.status === 0, `${name}: signature ${signature}${r.status === 0 ? "" : ` (${(r.stderr || "cosign failed").trim().split("\n")[0]})`}`);
};
if (manifest.signed && spawnSync("cosign", ["version"], { stdio: "ignore" }).status !== 0) check(false, "cosign is not on PATH: the signatures cannot be verified");

for (const artifact of manifest.artifacts) {
  const path = resolve(dir, artifact.name);
  if (!existsSync(path)) { check(false, `${artifact.name}: missing`); continue; }
  check(statSync(path).size === artifact.bytes, `${artifact.name}: ${artifact.bytes} bytes`);
  check(sha256(path) === artifact.sha256, `${artifact.name}: sha256 ${artifact.sha256.slice(0, 16)}…`);
  if (artifact.sbom) {
    const sbomPath = resolve(dir, artifact.sbom);
    check(existsSync(sbomPath) && sha256(sbomPath) === artifact.sbomSha256, `${artifact.name}: SBOM ${artifact.sbom} present and unchanged`);
    if (existsSync(sbomPath)) {
      const sbom = JSON.parse(readFileSync(sbomPath, "utf8"));
      const names = JSON.stringify(sbom.metadata?.component ?? {});
      check(sbom.bomFormat === "CycloneDX" && (artifact.kind === "npm" ? names.includes(artifact.name) || names.includes(artifact.package) : true), `${artifact.name}: SBOM is CycloneDX for this artifact`);
    }
  }
  if (manifest.signed) { verifyBlob(artifact.name, artifact.signature); if (artifact.sbom) verifyBlob(artifact.sbom, artifact.sbomSignature); }
  if (artifact.kind === "static-bundle") {
    const text = tarRead(path, "./version.json");
    const built = text ? JSON.parse(text) : null;
    check(built !== null, `${artifact.name}: holds version.json`);
    if (built) {
      check(built.version === manifest.version && built.commit === manifest.commit, `${artifact.name}: version.json names ${manifest.version} (${manifest.commit}); it says ${built.version} (${built.commit})`);
      check(tarRead(path, "./deck/index.html") !== null && tarRead(path, "./config.json") !== null, `${artifact.name}: holds deck/index.html and config.json`);
    }
  }
  if (artifact.kind === "npm") {
    const text = tarRead(path, "package/package.json");
    const pkg = text ? JSON.parse(text) : null;
    check(pkg !== null && pkg.name === artifact.package && pkg.version === manifest.version, `${artifact.name}: package.json names ${artifact.package}@${manifest.version}`);
    check(pkg !== null && pkg.publishConfig?.access === "restricted", `${artifact.name}: restricted access`);
  }
}
if (manifest.signed) verifyBlob("release-manifest.json", "release-manifest.json.sig");
if (manifest.image?.digest) console.log(`note image ${manifest.image.digest}: verify with cosign verify --key <pub> <ref>@${manifest.image.digest}`);
else console.log(`note no image in this release: ${manifest.image?.note ?? ""}`);

if (failures.length) { console.error(`\n${failures.length} check${failures.length === 1 ? "" : "s"} failed. Do not deploy this release.`); process.exit(1); }
if (!manifest.signed && !allowUnsigned) { console.error("\nThis is an UNSIGNED development drop. It verifies by checksum only; pass --allow-unsigned to accept that knowingly."); process.exit(2); }
console.log(`\nrelease ${manifest.version} verified${manifest.signed ? "" : " (unsigned, accepted)"}.`);
