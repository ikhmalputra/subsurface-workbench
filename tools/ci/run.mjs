// The local CI runner: every check the repository has, in tiers, with a report that says what ran,
// what passed and what was skipped. It exists because the hosted CI is not always available, and
// because a release must be gated by the same steps whoever runs them.
//
//   node tools/ci/run.mjs --tier t0            # every commit: under 5 minutes
//   node tools/ci/run.mjs --tier t1            # nightly and before a release: the browser suites too
//   node tools/ci/run.mjs --tier t2            # before a release: the soak, the drills, the deployment matrix
//   node tools/ci/run.mjs --tier t1 --only overlaps,budget   # a subset by name
//   node tools/ci/run.mjs --tier t0 --skip audit             # e.g. offline
//
// Writes output/reports/<timestamp>/summary.json and summary.md, and exits non-zero when any
// required step fails. A step whose script does not exist yet is reported as "not present" and
// does not fail the run, so suites can be added to the tiers before they are written.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback = null) => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] ?? fallback : fallback; };
const tier = option("tier", "t0");
const only = option("only")?.split(",").filter(Boolean) ?? null;
const skip = new Set(option("skip")?.split(",").filter(Boolean) ?? []);
const TIERS = ["t0", "t1", "t2"];
if (!TIERS.includes(tier)) { console.error(`Unknown tier "${tier}": one of ${TIERS.join(", ")}.`); process.exit(2); }
const rank = TIERS.indexOf(tier);

/** A free TCP port for the served build the browser suites run against. */
const freePort = () => new Promise((resolve, reject) => { const server = createServer(); server.unref(); server.on("error", reject); server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); }); });
const port = await freePort();
const base = `http://127.0.0.1:${port}/`;

/**
 * Every step, in order. `tier` is the lowest tier that runs it. `script` names a file that must
 * exist for the step to run; without it the step is "not present". `needsServer` steps run against
 * the built site, served once for the whole run. `network` steps are skipped with `--skip network`.
 */
const STEPS = [
  { name: "test", tier: "t0", cmd: ["pnpm", "test"] },
  { name: "test-asset", tier: "t0", cmd: ["pnpm", "test:asset"] },
  { name: "lint", tier: "t0", cmd: ["pnpm", "lint"] },
  { name: "typecheck", tier: "t0", cmd: ["pnpm", "typecheck"] },
  { name: "test-deck", tier: "t0", cmd: ["pnpm", "test:deck"] },
  { name: "notices", tier: "t0", cmd: ["node", "tools/release/notices.mjs", "--check"], script: "tools/release/notices.mjs" },
  { name: "crs-defs", tier: "t0", cmd: ["node", "tools/build-crs-defs.mjs", "--check"], script: "tools/build-crs-defs.mjs" },
  { name: "mock-osdu", tier: "t0", cmd: ["node", "--test", "tools/mock-osdu/mock.test.mjs"], script: "tools/mock-osdu/mock.test.mjs" },
  { name: "render-config", tier: "t0", cmd: ["node", "--test", "deploy/render.test.mjs"], script: "deploy/render.test.mjs" },
  { name: "fuzz", tier: "t0", cmd: ["node", "tools/fuzz/run.mjs", "--runs", "500"], script: "tools/fuzz/run.mjs" },
  { name: "audit", tier: "t0", cmd: ["pnpm", "audit", "--audit-level", "high"], network: true },
  { name: "build", tier: "t0", cmd: ["pnpm", "build"] },
  { name: "render-adapters", tier: "t0", cmd: ["pnpm", "test:render-adapters"] },
  { name: "packages", tier: "t0", cmd: ["pnpm", "test:packages"], network: true },
  { name: "budget", tier: "t0", cmd: ["pnpm", "test:budget"] },
  { name: "fuzz-long", tier: "t1", cmd: ["node", "tools/fuzz/run.mjs", "--runs", "10000"], script: "tools/fuzz/run.mjs" },
  { name: "bench", tier: "t1", cmd: ["node", "tools/bench-deck.mjs", base], needsServer: true },
  { name: "overlaps", tier: "t1", cmd: ["node", "tools/audit-overlaps.mjs", base], needsServer: true },
  { name: "e2e-base-path", tier: "t1", cmd: ["node", "tools/e2e/base-path.mjs"], script: "tools/e2e/base-path.mjs" },
  { name: "e2e-auth", tier: "t1", cmd: ["node", "tools/e2e/auth.mjs"], script: "tools/e2e/auth.mjs" },
  { name: "e2e-csp-egress", tier: "t1", cmd: ["node", "tools/e2e/csp-egress.mjs"], script: "tools/e2e/csp-egress.mjs" },
  { name: "e2e-xss", tier: "t1", cmd: ["node", "tools/e2e/xss.mjs"], script: "tools/e2e/xss.mjs" },
  { name: "e2e-a11y", tier: "t1", cmd: ["node", "tools/e2e/a11y.mjs", base], script: "tools/e2e/a11y.mjs", needsServer: true },
  { name: "stress-faults", tier: "t1", cmd: ["node", "tools/stress/faults.mjs"], script: "tools/stress/faults.mjs" },
  { name: "stress-throttle", tier: "t1", cmd: ["node", "tools/stress/throttle.mjs"], script: "tools/stress/throttle.mjs" },
  { name: "soak-lite", tier: "t1", cmd: ["node", "tools/stress/soak.mjs", "--minutes", "30"], script: "tools/stress/soak.mjs" },
  { name: "soak", tier: "t2", cmd: ["node", "tools/stress/soak.mjs", "--minutes", "480"], script: "tools/stress/soak.mjs" },
  { name: "drill", tier: "t2", cmd: ["node", "tools/release/drill.mjs"], script: "tools/release/drill.mjs" },
  { name: "deploy-matrix", tier: "t2", cmd: ["node", "tools/e2e/deploy-matrix.mjs"], script: "tools/e2e/deploy-matrix.mjs" },
];

const chosen = STEPS.filter((step) => TIERS.indexOf(step.tier) <= rank && (!only || only.includes(step.name)));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportDir = `${root}output/reports/${stamp}/`;
mkdirSync(reportDir, { recursive: true });

/** Runs one command, capturing its output; resolves with the exit code and the last lines. */
function run(cmd, extraEnv = {}) {
  return new Promise((resolve) => {
    const [bin, ...rest] = cmd;
    const env = { ...process.env, ...extraEnv, PLAYWRIGHT: process.env.PLAYWRIGHT ?? "@playwright/test" };
    const child = spawn(bin === "pnpm" ? "corepack" : bin, bin === "pnpm" ? ["pnpm", ...rest] : rest, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const keep = (chunk) => { out += chunk; if (out.length > 200_000) out = out.slice(-150_000); process.stdout.write(chunk); };
    child.stdout.on("data", keep); child.stderr.on("data", keep);
    child.on("close", (code) => resolve({ code: code ?? 1, tail: out.trim().split("\n").slice(-40).join("\n") }));
    child.on("error", (error) => resolve({ code: 1, tail: String(error) }));
  });
}

let server = null;
const startServer = () => new Promise((resolve) => {
  server = spawn("node", ["tools/serve.mjs"], { cwd: root, env: { ...process.env, PORT: String(port), SERVE_APP: "deck" }, stdio: "ignore" });
  const tryOnce = async () => { try { const r = await fetch(`${base}deck/`); if (r.ok) return resolve(true); } catch { /* not up yet */ } setTimeout(tryOnce, 300); };
  tryOnce();
  setTimeout(() => resolve(false), 20_000);
});

const results = [];
let failed = false;
const started = Date.now();
for (const step of chosen) {
  const t = Date.now();
  const line = (status, note = "") => { results.push({ name: step.name, tier: step.tier, status, ms: Date.now() - t, note }); console.log(`\n== ${step.name}: ${status}${note ? ` (${note})` : ""} [${((Date.now() - t) / 1000).toFixed(1)} s]`); };
  if (skip.has(step.name) || (step.network && skip.has("network"))) { line("skipped", "by --skip"); continue; }
  if (step.script && !existsSync(`${root}${step.script}`)) { line("not present", step.script); continue; }
  if (step.needsServer && !server) { if (!(await startServer())) { line("failed", "the built site could not be served; run build first"); failed = true; continue; } }
  console.log(`\n>> ${step.name}: ${step.cmd.join(" ")}`);
  const { code, tail } = await run(step.cmd);
  if (code === 0) line("passed"); else { line("failed", `exit ${code}`); failed = true; results.at(-1).tail = tail; }
}
server?.kill();

const summary = { tier, base, startedAt: new Date(started).toISOString(), ms: Date.now() - started, passed: !failed, steps: results };
writeFileSync(`${reportDir}summary.json`, JSON.stringify(summary, null, 2));
const md = [`# CI ${tier} · ${summary.passed ? "PASSED" : "FAILED"} · ${(summary.ms / 60000).toFixed(1)} min`, "", "| Step | Tier | Status | Time |", "|---|---|---|---|",
  ...results.map((r) => `| ${r.name} | ${r.tier} | ${r.status}${r.note ? ` (${r.note})` : ""} | ${(r.ms / 1000).toFixed(1)} s |`),
  ...results.filter((r) => r.tail).flatMap((r) => ["", `## ${r.name}`, "", "```", r.tail, "```"])];
writeFileSync(`${reportDir}summary.md`, md.join("\n") + "\n");
console.log(`\n${md.slice(0, results.length + 4).join("\n")}\n\nReport: ${reportDir}summary.md`);
process.exit(failed ? 1 : 0);
