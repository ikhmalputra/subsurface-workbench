// The release and verification scripts, end to end on this tree as an unsigned local drop: the
// artifacts, the manifest, and that verification fails on a changed byte or a wrong version.
// Needs a built deck (pnpm build): in the CI runner this step follows the build.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const node = (script, argv, cwd = ROOT) => spawnSync(process.execPath, [resolve(ROOT, "tools/release", script), ...argv], { cwd, encoding: "utf8", stdio: "pipe" });
const built = existsSync(resolve(ROOT, "apps/deck/out/version.json"));

test("an unsigned local drop is made, says so, verifies by checksum, and fails verification when touched", { skip: built ? false : "apps/deck/out is not built: run pnpm build first" }, () => {
  const out = mkdtempSync(resolve(tmpdir(), "subsurface-release-"));
  try {
    const made = node("release.mjs", ["--unsigned", "--allow-dirty", "--tier", "none", "--no-build", "--out", out]);
    assert.equal(made.status, 0, made.stderr || made.stdout);
    const manifest = JSON.parse(readFileSync(resolve(out, "release-manifest.json"), "utf8"));
    assert.equal(manifest.signed, false);
    assert.equal(manifest.version, JSON.parse(readFileSync(resolve(ROOT, "apps/deck/package.json"), "utf8")).version);
    assert.deepEqual(manifest.artifacts.map((a) => a.kind).sort(), ["npm", "npm", "static-bundle"]);
    for (const artifact of manifest.artifacts) { assert.match(artifact.sha256, /^[0-9a-f]{64}$/); assert.ok(artifact.bytes > 1000, `${artifact.name} is ${artifact.bytes} bytes`); assert.equal(artifact.signature, undefined); }
    assert.match(made.stdout, /UNSIGNED development drop/);

    // Verifies by checksum when told that is acceptable; refuses an unsigned drop otherwise.
    const accepted = node("verify-release.mjs", [out, "--allow-unsigned"]);
    assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
    assert.match(accepted.stdout, /version\.json names/);
    assert.match(accepted.stdout, /restricted access/);
    assert.doesNotMatch(accepted.stdout, /^FAIL/m);
    const refused = node("verify-release.mjs", [out]);
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /UNSIGNED/);

    // One byte changed in the bundle: the checksum check fails, and so does the run.
    const bundle = manifest.artifacts.find((a) => a.kind === "static-bundle");
    const original = readFileSync(resolve(out, bundle.name));
    const touched = Buffer.from(original);
    touched[touched.length - 20] ^= 0xff;
    writeFileSync(resolve(out, bundle.name), touched);
    const tampered = node("verify-release.mjs", [out, "--allow-unsigned"]);
    assert.equal(tampered.status, 1);
    assert.match(tampered.stdout, /FAIL .*sha256/);
    writeFileSync(resolve(out, bundle.name), original);

    // A manifest claiming another version than the bundle carries: refused.
    writeFileSync(resolve(out, "release-manifest.json"), JSON.stringify({ ...manifest, version: "9.9.9" }));
    const lying = node("verify-release.mjs", [out, "--allow-unsigned"]);
    assert.equal(lying.status, 1);
    assert.match(lying.stdout, /FAIL .*version\.json names 9\.9\.9/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("release.mjs refuses a dirty tree and disagreeing versions before doing anything", () => {
  const dirty = spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  if (dirty) {
    const refused = node("release.mjs", ["--unsigned", "--tier", "none", "--no-build", "--out", resolve(tmpdir(), "never-written")]);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /not clean/);
  }
  // A signed release needs the signing tools: without them and without --unsigned it stops with the names of what is missing.
  const unsignedNotAllowed = node("release.mjs", ["--allow-dirty", "--tier", "none", "--no-build", "--out", resolve(tmpdir(), "never-written")], ROOT);
  if (unsignedNotAllowed.status !== 0) assert.match(unsignedNotAllowed.stderr, /not on PATH|no signing key|version\.json/);
});
