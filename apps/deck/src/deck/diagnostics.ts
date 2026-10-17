import type { DeckConfig } from "@ikhmalputra/subsurface-core/deck-config";
import type { DataProblem } from "@ikhmalputra/subsurface-core/data-contract";
import type { DeckVersion } from "./version.ts";

/**
 * What a person copies into a support ticket: the build, the browser, the sources and how far
 * each was read, sign-in state, storage use and the last errors. It names counts and kinds, never a
 * well, a token, a person or a URL beyond its origin, so it can leave the tenant's cloud.
 *
 * `diagnosticsBundle` is pure and tested; `collectDiagnostics` gathers the browser's part.
 */
export interface DiagnosticsSource { readonly id: string; readonly type: string; readonly label: string; readonly standard: string; readonly origin: string | null; readonly wells: number; readonly total: number | null; readonly reading: boolean; readonly truncated: boolean; readonly error: string | null }
/** `error` fields and `errors[].kind` are kinds from `errorKind`, never a message. */
export interface DiagnosticsBundle {
  readonly kind: "subsurface-deck-diagnostics";
  readonly at: string;
  readonly build: { readonly version: string; readonly commit: string; readonly builtAt: string; readonly schemas: DeckVersion["schemas"] } | null;
  readonly page: { readonly origin: string; readonly base: string };
  readonly browser: { readonly userAgent: string; readonly language: string; readonly cores: number | null; readonly memoryGiB: number | null; readonly webgl2: boolean; readonly webgpu: boolean; readonly viewport: string; readonly dpr: number; readonly online: boolean | null };
  readonly config: { readonly version: number; readonly sources: number; readonly authProfiles: number; readonly shareMode: string | null; readonly problems: readonly string[] };
  readonly sources: readonly DiagnosticsSource[];
  readonly catalogue: { readonly wells: number; readonly loading: boolean; readonly fields: number; readonly fieldsReading: number; readonly fieldsFailed: number; readonly problems: Readonly<Record<string, number>> };
  readonly auth: readonly { readonly profile: string; readonly issuerOrigin: string | null; readonly status: string; readonly signedIn: boolean; readonly expiresInS: number | null; readonly error: string | null }[];
  readonly storage: { readonly usedMiB: number | null; readonly quotaMiB: number | null; readonly deckKeys: number; readonly deckBytes: number };
  readonly errors: readonly { readonly at: string; readonly kind: string }[];
}

export interface DiagnosticsInput {
  readonly now: Date;
  readonly version: DeckVersion | null;
  readonly origin: string;
  readonly base: string;
  readonly browser: DiagnosticsBundle["browser"];
  readonly config: DeckConfig;
  readonly configProblems: readonly string[];
  readonly sources: readonly { readonly id: string; readonly label: string; readonly standard: string; readonly wells: number; readonly total?: number; readonly reading: boolean; readonly truncated?: boolean; readonly error: string | null }[];
  readonly fields: ReadonlyMap<string, { readonly reading: boolean; readonly error: string | null }>;
  readonly wellCount: number;
  readonly loading: boolean;
  readonly problems: readonly (DataProblem & { readonly sourceId: string })[];
  readonly auth: { readonly profiles: Readonly<Record<string, { readonly status: string; readonly sub: string | null; readonly name: string | null; readonly expiresAt: number | null; readonly error: string | null }>> };
  readonly storage: DiagnosticsBundle["storage"];
  readonly errors: readonly { readonly at: number; readonly message: string }[];
}

const originOf = (url: string | undefined): string | null => { if (!url) return null; try { return new URL(url).origin; } catch { return null; } };
/** Our own config messages name keys, never data: credentials and long tokens are still taken out. */
const scrub = (text: string): string => text.replace(/\b(bearer|token|secret|password|code|state|nonce)[=: ]+\S+/gi, "$1=…").replace(/[A-Za-z0-9_-]{40,}/g, "…").slice(0, 300);
/**
 * An error as a kind, not its text: a backend's or a browser's message may carry a well's name, a
 * person's address or a URL with a token, so only what kind of trouble it was travels.
 */
export function errorKind(text: string | null | undefined): string | null {
  if (!text) return null;
  if (/cursor.*expired|expired.*cursor/i.test(text)) return "cursor-expired";
  if (/sign-?in|\b401\b|expired/i.test(text)) return "sign-in";
  if (/\b403\b|no access|entitle|forbidden/i.test(text)) return "access";
  if (/cut short|too large|byte|limit|quota/i.test(text)) return "too-large";
  if (/timed? ?out|timeout/i.test(text)) return "timeout";
  if (/cors|could not reach|failed to fetch|network|connect-src|refused/i.test(text)) return "unreachable";
  const status = /\b([45]\d\d)\b/.exec(text);
  if (status) return `http-${status[1]}`;
  if (/not in the data contract|shape|format|parse|json|unexpected token/i.test(text)) return "bad-format";
  const name = /^([A-Z][A-Za-z]*Error)\b/.exec(text.trim());
  return name ? name[1]! : "other";
}

export function diagnosticsBundle(input: DiagnosticsInput): DiagnosticsBundle {
  const sources = input.sources.map((source): DiagnosticsSource => {
    // The catalogue names a source `<type>-<index in config.sources>`.
    const at = /^(.+)-(\d+)$/.exec(source.id);
    const config = at ? input.config.sources[Number(at[2])] : input.config.sources.find((entry) => entry.type === source.id);
    return { id: source.id, type: config?.type ?? source.standard, label: source.label, standard: source.standard, origin: originOf(config && "url" in config ? config.url : undefined), wells: source.wells, total: source.total ?? null, reading: source.reading, truncated: source.truncated ?? false, error: errorKind(source.error) };
  });
  const problems: Record<string, number> = {};
  for (const problem of input.problems) { const key = `${problem.object}/${problem.severity}`; problems[key] = (problems[key] ?? 0) + 1; }
  const fields = [...input.fields.values()];
  return {
    kind: "subsurface-deck-diagnostics",
    at: input.now.toISOString(),
    build: input.version ? { version: input.version.version, commit: input.version.commit, builtAt: input.version.builtAt, schemas: input.version.schemas } : null,
    page: { origin: input.origin, base: input.base },
    browser: input.browser,
    config: { version: input.config.version, sources: input.config.sources.length, authProfiles: Object.keys(input.config.auth ?? {}).length, shareMode: input.config.share?.mode ?? null, problems: input.configProblems.map(scrub) },
    sources,
    catalogue: { wells: input.wellCount, loading: input.loading, fields: fields.length, fieldsReading: fields.filter((f) => f.reading).length, fieldsFailed: fields.filter((f) => f.error !== null).length, problems },
    // Who is signed in is a status, never a subject, a name or a token.
    auth: Object.entries(input.auth.profiles).map(([profile, view]) => ({ profile, issuerOrigin: originOf(input.config.auth?.[profile]?.issuer), status: view.status, signedIn: view.status === "signed-in", expiresInS: view.expiresAt === null ? null : Math.max(0, Math.round((view.expiresAt - input.now.getTime()) / 1000)), error: errorKind(view.error) })),
    storage: input.storage,
    errors: input.errors.slice(-10).map((error) => ({ at: new Date(error.at).toISOString(), kind: errorKind(error.message) ?? "other" })),
  };
}

export const formatDiagnostics = (bundle: DiagnosticsBundle): string => `${JSON.stringify(bundle, null, 2)}\n`;

// ── The browser's part ────────────────────────────────────────────────────────────────────────
const recent: { at: number; message: string }[] = [];
/** Keeps the last errors for the bundle; main.tsx hooks window errors and unhandled rejections to it. */
export function recordError(message: string): void { recent.push({ at: Date.now(), message: message.slice(0, 300) }); if (recent.length > 20) recent.shift(); }
export const recentErrors = (): readonly { readonly at: number; readonly message: string }[] => recent;

export function browserFacts(): DiagnosticsBundle["browser"] {
  const nav = navigator as Navigator & { deviceMemory?: number; gpu?: unknown };
  const webgl2 = (() => { try { return typeof WebGL2RenderingContext !== "undefined" && document.createElement("canvas").getContext("webgl2") !== null; } catch { return false; } })();
  return { userAgent: nav.userAgent, language: nav.language, cores: nav.hardwareConcurrency ?? null, memoryGiB: nav.deviceMemory ?? null, webgl2, webgpu: "gpu" in nav && nav.gpu !== undefined, viewport: `${window.innerWidth}×${window.innerHeight}`, dpr: window.devicePixelRatio, online: typeof nav.onLine === "boolean" ? nav.onLine : null };
}

/** Storage use: the browser's estimate, and the deck's own localStorage keys by count and size (never their contents). */
export async function storageFacts(): Promise<DiagnosticsBundle["storage"]> {
  let usedMiB: number | null = null, quotaMiB: number | null = null;
  try { const estimate = await navigator.storage?.estimate?.(); if (estimate) { usedMiB = Math.round((estimate.usage ?? 0) / 1048576 * 10) / 10; quotaMiB = Math.round((estimate.quota ?? 0) / 1048576); } } catch { /* not available */ }
  let deckKeys = 0, deckBytes = 0;
  try { for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key?.startsWith("deck")) { deckKeys += 1; deckBytes += (localStorage.getItem(key) ?? "").length; } } } catch { /* blocked storage */ }
  return { usedMiB, quotaMiB, deckKeys, deckBytes };
}
