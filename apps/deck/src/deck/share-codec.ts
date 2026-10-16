import type { DesignValue } from "../data/design.ts";
import type { WellRecordValue } from "../data/records.ts";

/**
 * A shared deck, as it travels in a link: the place, the tiles, the signals that were set and,
 * when the place is the sender's own well, that well itself, so the link opens on any browser.
 *
 * It rides in the URL's fragment (`#deck=…`), which browsers never send to a server: a well in a
 * link goes only to whoever is given the link. JSON, deflated, then base64url.
 */
export interface SharedDeck {
  readonly v: 1;
  readonly site: { readonly id: string; readonly well: string | null } | null;
  readonly tiles: Readonly<Record<string, { readonly col: number; readonly row: number; readonly w: number; readonly h: number }>>;
  readonly stage: string;
  readonly component: string | null;
  /** Pinned depth, m MD. Hover is transient and is not shared. */
  readonly md: number | null;
  readonly window: readonly [number, number] | null;
  readonly brush: readonly [number, number] | null;
  /** UTC Unix ms on the time rail; null is the well as finally recorded. */
  readonly time: number | null;
  readonly slices: { readonly inline: number | null; readonly crossline: number | null; readonly depth: number | null } | null;
  readonly sectionLine: readonly [readonly [number, number], readonly [number, number]] | null;
  readonly fusions: Readonly<Record<string, string>>;
  /** A what-if the sender had not applied: shown as a what-if on arrival, to apply or discard. */
  readonly whatIf: { readonly label: string; readonly value: DesignValue } | null;
  readonly carried: CarriedWell | null;
}

/** The sender's own well, when the place is one: a planned well, a recorded one, or edits over a well in the deck. */
export type CarriedWell =
  | { readonly kind: "design"; readonly builtIn: boolean; readonly value: DesignValue }
  | { readonly kind: "recorded"; readonly value: WellRecordValue }
  | { readonly kind: "edit"; readonly siteId: string; readonly wellId: string; readonly value: WellRecordValue };

export const SHARE_KEY = "deck";

const toBase64Url = (bytes: Uint8Array) => {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromBase64Url = (text: string) => {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new TypeError("The link has been cut or changed: it holds characters a deck link never has.");
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - text.length % 4) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodeSharedDeck(deck: SharedDeck): Promise<string> {
  return toBase64Url(await pipe(new TextEncoder().encode(JSON.stringify(deck)), new CompressionStream("deflate-raw")));
}

/** Reads a link's payload; throws with what is wrong, in words for the person who opened it. */
export async function decodeSharedDeck(text: string): Promise<SharedDeck> {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(await pipe(fromBase64Url(text), new DecompressionStream("deflate-raw"))));
  } catch (error) {
    if (error instanceof TypeError && /cut or changed/.test(error.message)) throw error;
    throw new TypeError("The link has been cut or changed: its deck could not be read. Ask for the link again.", { cause: error });
  }
  return validateSharedDeck(json);
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const num = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const pair = (value: unknown): value is readonly [number, number] => Array.isArray(value) && value.length === 2 && value.every(num);
const nullable = <T>(value: unknown, check: (value: unknown) => value is T): T | null => value === null || value === undefined ? null : check(value) ? value : bad();
function bad(): never { throw new TypeError("This link was made by a different version of the deck and cannot be opened here."); }

/** Shape checks only; whether the place, modules and depths exist here is decided when it is applied. */
export function validateSharedDeck(value: unknown): SharedDeck {
  if (!isObject(value)) bad();
  if (value.v !== 1) bad();
  const site = value.site === null ? null : isObject(value.site) && typeof value.site.id === "string" && (value.site.well === null || typeof value.site.well === "string") ? { id: value.site.id, well: value.site.well as string | null } : bad();
  if (!isObject(value.tiles) || typeof value.stage !== "string") bad();
  for (const rect of Object.values(value.tiles)) if (!isObject(rect) || ![rect.col, rect.row, rect.w, rect.h].every(Number.isInteger)) bad();
  const slices = value.slices === null || value.slices === undefined ? null : isObject(value.slices) && ["inline", "crossline", "depth"].every((key) => value.slices && ((value.slices as Record<string, unknown>)[key] === null || num((value.slices as Record<string, unknown>)[key])))
    ? value.slices as SharedDeck["slices"] : bad();
  const line = value.sectionLine === null || value.sectionLine === undefined ? null : Array.isArray(value.sectionLine) && value.sectionLine.length === 2 && value.sectionLine.every(pair) ? value.sectionLine as unknown as SharedDeck["sectionLine"] : bad();
  const fusions = value.fusions === undefined ? {} : isObject(value.fusions) && Object.values(value.fusions).every((entry) => typeof entry === "string") ? value.fusions as Record<string, string> : bad();
  const whatIf = value.whatIf === null || value.whatIf === undefined ? null : isObject(value.whatIf) && typeof value.whatIf.label === "string" && isDesignValue(value.whatIf.value) ? value.whatIf as unknown as SharedDeck["whatIf"] : bad();
  const carried = value.carried === null || value.carried === undefined ? null : isCarried(value.carried) ? value.carried : bad();
  return {
    v: 1, site, tiles: value.tiles as SharedDeck["tiles"], stage: value.stage,
    component: nullable(value.component, (entry): entry is string => typeof entry === "string"),
    md: nullable(value.md, (entry): entry is number => num(entry) && (entry as number) >= 0),
    window: nullable(value.window, pair), brush: nullable(value.brush, pair),
    time: nullable(value.time, (entry): entry is number => Number.isSafeInteger(entry)),
    slices, sectionLine: line, fusions, whatIf, carried,
  };
}

function isDesignValue(value: unknown): value is DesignValue {
  return isObject(value) && isObject(value.brief) && isObject(value.brief.identity) && Array.isArray(value.brief.sections) && isObject(value.hydraulics);
}
function isRecordValue(value: unknown): value is WellRecordValue {
  return isObject(value) && isObject(value.identity) && isObject(value.location) && Array.isArray(value.stations) && Array.isArray(value.tops) && Array.isArray(value.components) && num(value.totalDepthM);
}
function isCarried(value: unknown): value is CarriedWell {
  if (!isObject(value)) return false;
  if (value.kind === "design") return typeof value.builtIn === "boolean" && isDesignValue(value.value);
  if (value.kind === "recorded") return isRecordValue(value.value);
  if (value.kind === "edit") return typeof value.siteId === "string" && typeof value.wellId === "string" && isRecordValue(value.value);
  return false;
}

/** The fragment of a link that holds a deck, or null when the fragment holds none. */
export function sharedPayload(hash: string): string | null {
  const match = new RegExp(`^#?${SHARE_KEY}=([A-Za-z0-9_-]+)$`).exec(hash);
  return match ? match[1]! : null;
}
