#!/usr/bin/env node
// Makes a release from a clean tree: the checks, the build, the npm tarballs, the static bundle,
// SBOMs, vulnerability gates, signatures and a signed manifest, all under output/release/<version>.
// Nothing is pushed unless --publish is given. It refuses to make an unsigned release unless told
// --unsigned (a development drop), and then says so in the manifest.
//
//   node tools/release/release.mjs                      # t1 checks, build, sign with $COSIGN_KEY
//   node tools/release/release.mjs --tier t0 --key awskms://alias/subsurface-release
//   node tools/release/release.mjs --unsigned --allow-dirty --tier none --no-build   # a local drop
//   node tools/release/release.mjs --publish --oci ghcr.io/ikhmalputra/subsurface-deck-bundle
//
// Needs on PATH for a signed release: syft (SBOM), grype (gate), cosign (signatures). Each is
// optional only with --unsigned, and the manifest records which were used.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const args = process.argv.slice(2);
const has = (name) => args.includes(name);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback; };
const tier = flag("--tier", "t1");
const unsigned = has("--unsigned");
const key = flag("--key", process.env.COSIGN_KEY);
const fail = (message) => { console.error(`\nrelease: ${message}`); process.exit(1); };
const run = (cmd, argv, options = {}) => { const result = spawnSync(cmd, argv, { cwd: ROOT, stdio: options.capture ? "pipe" : "inherit", encoding: "utf8", env: { ...process.env, ...options.env } }); if (result.status !== 0) fail(`${cmd} ${argv.join(" ")} failed (exit ${result.status})${result.stderr ? `\n${result.stderr.slice(0, 2000)}` : ""}`); return result.stdout ?? ""; };
const onPath = (cmd) => spawnSync(cmd, ["version"], { stdio: "ignore" }).status === 0 || spawnSync(cmd, ["--version"], { stdio: "ignore" }).status === 0;
const toolVersion = (cmd) => { for (const argv of [["version"], ["--version"]]) { const r = spawnSync(cmd, argv, { encoding: "utf8", stdio: "pipe" }); if (r.status === 0) return (r.stdout || r.stderr).trim().split("\n")[0].slice(0, 80); } return null; };
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const json = (path) => JSON.parse(readFileSync(resolve(ROOT, path), "utf8"));

// 1. A clean tree: what is released is what is committed.
const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).trim();
if (dirty && !has("--allow-dirty")) fail(`the tree is not clean; commit or stash first (or --allow-dirty for a local drop):\n${dirty.split("\n").slice(0, 12).join("\n")}`);
const commit = execFileSync("git", ["rev-parse", "--short=9", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();

// 2. One version across the fixed group.
const versions = { core: json("packages/core/package.json").version, react: json("packages/react/package.json").version, deck: json("apps/deck/package.json").version };
const version = versions.deck;
if (new Set(Object.values(versions)).size !== 1) fail(`the packages disagree on the version: ${JSON.stringify(versions)}; run pnpm version first`);

// 3. The checks, then the build.
if (tier !== "none") run("node", ["tools/ci/run.mjs", "--tier", tier]);
if (!has("--no-build")) run("corepack", ["pnpm", "build"]);
const builtVersion = json("apps/deck/out/version.json");
if (builtVersion.version !== version) fail(`apps/deck/out/version.json says ${builtVersion.version}, the packages say ${version}: rebuild`);
if (builtVersion.commit !== commit && !has("--allow-dirty")) fail(`the build is from commit ${builtVersion.commit}, the tree is at ${commit}: rebuild`);

// 4. The artifacts.
const out = resolve(ROOT, flag("--out", `output/release/${version}`));
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const artifacts = [];
for (const [name, dir] of [["@ikhmalputra/subsurface-core", "packages/core"], ["@ikhmalputra/subsurface-react", "packages/react"]]) {
  run("corepack", ["pnpm", "--filter", name, "pack", "--pack-destination", out]);
  const file = `${name.replace("@", "").replace("/", "-")}-${version}.tgz`;
  if (!existsSync(resolve(out, file))) fail(`${file} was not produced by pnpm pack`);
  artifacts.push({ name: file, kind: "npm", package: name, source: dir });
}
const bundle = `subsurface-deck-${version}.tgz`;
run("tar", ["-czf", resolve(out, bundle), "-C", resolve(ROOT, "apps/deck/out"), "."]);
artifacts.push({ name: bundle, kind: "static-bundle", source: "apps/deck/out" });

// 5. SBOMs and the vulnerability gate.
const tools = { syft: onPath("syft") ? toolVersion("syft") : null, grype: onPath("grype") ? toolVersion("grype") : null, cosign: onPath("cosign") ? toolVersion("cosign") : null };
const missing = Object.entries(tools).filter(([, v]) => v === null).map(([k]) => k);
if (missing.length && !unsigned) fail(`${missing.join(", ")} not on PATH: a release is signed and comes with SBOMs. Install them, or pass --unsigned for a development drop that says so.`);
for (const artifact of artifacts) {
  if (tools.syft) {
    const sbom = `${artifact.name}.sbom.cdx.json`;
    run("syft", [artifact.kind === "npm" ? `file:${resolve(out, artifact.name)}` : `dir:${resolve(ROOT, artifact.source)}`, "-o", `cyclonedx-json=${resolve(out, sbom)}`, "-q"]);
    artifact.sbom = sbom;
    if (tools.grype) run("grype", [`sbom:${resolve(out, sbom)}`, "--fail-on", "high", "-q"]);
  }
}
if (!tools.grype) run("corepack", ["pnpm", "audit", "--audit-level", "high"]);

// 6. Checksums, signatures, manifest.
for (const artifact of artifacts) {
  const path = resolve(out, artifact.name);
  artifact.sha256 = sha256(path);
  artifact.bytes = statSync(path).size;
  if (artifact.sbom) artifact.sbomSha256 = sha256(resolve(out, artifact.sbom));
}
const signed = Boolean(tools.cosign && key);
if (!signed && !unsigned) fail(`no signing key: pass --key <cosign key or KMS reference> or set COSIGN_KEY (or --unsigned for a development drop)`);
const sign = (name) => { run("cosign", ["sign-blob", "--yes", "--key", key, "--output-signature", resolve(out, `${name}.sig`), resolve(out, name)]); return `${name}.sig`; };
if (signed) for (const artifact of artifacts) { artifact.signature = sign(artifact.name); if (artifact.sbom) artifact.sbomSignature = sign(artifact.sbom); }
const manifest = {
  version, commit, builtAt: builtVersion.builtAt, schemas: builtVersion.schemas, minUpgradeFrom: builtVersion.minUpgradeFrom,
  signed, tools, artifacts,
  image: existsSync(resolve(ROOT, "deploy/Dockerfile")) ? { status: "not built here", note: "build and sign the image with tools/release/image.mjs" } : { status: "not packaged", note: "the container image arrives with the container phase (P1); this release is the static bundle and the npm packages" },
  madeAt: new Date().toISOString(),
};
writeFileSync(resolve(out, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
if (signed) sign("release-manifest.json");

// 7. Publishing, only when asked.
if (has("--publish")) {
  if (!signed) fail("an unsigned release is never published");
  for (const artifact of artifacts.filter((a) => a.kind === "npm")) run("corepack", ["pnpm", "--filter", artifact.package, "publish", "--no-git-checks", "--tag", "latest"]);
  const oci = flag("--oci");
  if (oci) {
    if (!onPath("oras")) fail("oras is needed to push the bundle, SBOMs and signatures as OCI artifacts");
    run("oras", ["push", `${oci}:${version}`, ...readdirSync(out).map((name) => `${name}:application/octet-stream`)], { env: { PWD: out } });
  }
}

console.log(`\nrelease ${version} (${commit}) → ${out}\n${artifacts.map((a) => `  ${a.name}  ${a.bytes} bytes  sha256 ${a.sha256.slice(0, 16)}…${a.signature ? "  signed" : ""}${a.sbom ? "  sbom" : ""}`).join("\n")}\n  release-manifest.json${signed ? " (signed)" : "  UNSIGNED development drop"}`);
