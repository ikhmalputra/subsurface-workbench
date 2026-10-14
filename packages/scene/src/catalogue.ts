import { type Known, absent, reported } from "@ikhmalputra/subsurface-kernel";

/**
 * The rendered component catalogue.
 *
 * Fifty-five well components modelled in Blender and exported as glTF, each with a thumbnail. They
 * are illustrative: nominal geometry for an assembly interface, not manufacturer CAD and not to
 * engineering scale. The manifest says so and so does every placement built from it.
 *
 * Two things make this a contract rather than a folder. Every file carries a SHA-256 of its bytes,
 * so a host can verify what it loaded is what was published. And every model obeys one convention,
 * which is what lets a renderer place a part it has never seen:
 *
 *   glTF Y-up; the top of the component sits at the origin and the body extends to -Y;
 *   the body's outer radius is normalised to 1.0.
 *
 * So a part is positioned by its top, pointed down the hole, and scaled by the radius it should
 * actually have. Nothing in the model itself claims a size.
 */

export interface Bounds {
  /** Outer radius in model units. 1.0 by convention for the body; fins and flanges exceed it. */
  readonly radius: number;
  /** Highest point, at or above the origin. */
  readonly top: number;
  /** Lowest point, below the origin. The model's own height is `top - bottom`. */
  readonly bottom: number;
}

/**
 * Two kinds of entry, because two kinds of thing are being drawn.
 *
 * **modelled** — a part someone sculpted: a wellhead, a packer, a float shoe. It ships as glTF and
 * a renderer loads it.
 *
 * **drawn** — a casing string, a liner, a hole section. These are tubes whose geometry follows from
 * two diameters and an interval, so generating them is both exact and cheaper than shipping a model
 * that would have to be stretched beyond recognition. Seven of the catalogue's fifty-five entries
 * are these, and they carry a thumbnail for the palette and nothing else.
 *
 * A renderer must handle both. Treating a drawn entry as a missing model would lose every casing
 * string in the well.
 */
export interface CatalogueEntry {
  readonly id: string;
  readonly kind: "modelled" | "drawn";
  /** The glTF file, for a modelled part. Absent for a drawn one. */
  readonly model?: string;
  readonly modelSha256?: string;
  readonly thumbnail: string;
  readonly thumbnailSha256: string;
  readonly bounds: Bounds;
}

export interface Catalogue {
  readonly id: string;
  readonly provenance: "synthetic" | "documented";
  readonly license: string;
  readonly author: string;
  readonly blenderVersion: string;
  readonly renderer: string;
  readonly modelConvention: string;
  /** What these models may and may not be used to claim. Shown, never hidden. */
  readonly compatibility: string;
  readonly components: readonly CatalogueEntry[];
}

const text = (value: unknown, at: string): string => {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${at}: expected text`);
  return value;
};
const finite = (value: unknown, at: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${at}: expected a finite number`);
  return value;
};

/** Check a manifest before anything is loaded from it. Throws on the first thing that is not right. */
export function readCatalogue(value: unknown): Catalogue {
  if (!value || typeof value !== "object") throw new TypeError("catalogue: expected an object");
  const raw = value as Record<string, unknown>;
  const components = raw.components;
  if (!Array.isArray(components) || components.length === 0) throw new TypeError("catalogue.components: expected a non-empty array");
  const seen = new Set<string>();
  const entries = components.map((entry, index) => {
    const at = `catalogue.components[${index}]`;
    const item = entry as Record<string, unknown>;
    const id = text(item.id, `${at}.id`);
    if (seen.has(id)) throw new TypeError(`${at}.id: "${id}" appears twice`);
    seen.add(id);
    const bounds = (item.bounds ?? {}) as Record<string, unknown>;
    const top = finite(bounds.top, `${at}.bounds.top`), bottom = finite(bounds.bottom, `${at}.bounds.bottom`);
    if (!(top > bottom)) throw new TypeError(`${at}.bounds: the top must be above the bottom`);
    // A model is optional; a half-declared one is not. An entry naming a file without its digest
    // could not be verified, which is the whole point of shipping digests.
    const modelled = item.model !== undefined || item.modelSha256 !== undefined;
    return {
      id,
      kind: modelled ? "modelled" : "drawn",
      ...(modelled ? { model: text(item.model, `${at}.model`), modelSha256: text(item.modelSha256, `${at}.modelSha256`) } : {}),
      thumbnail: text(item.thumbnail, `${at}.thumbnail`),
      thumbnailSha256: text(item.thumbnailSha256, `${at}.thumbnailSha256`),
      bounds: { radius: finite(bounds.radius, `${at}.bounds.radius`), top, bottom },
    } satisfies CatalogueEntry;
  });
  return {
    id: text(raw.id, "catalogue.id"),
    provenance: raw.provenance === "documented" ? "documented" : "synthetic",
    license: text(raw.license, "catalogue.license"),
    author: text(raw.author, "catalogue.author"),
    blenderVersion: text(raw.blenderVersion, "catalogue.blenderVersion"),
    renderer: text(raw.renderer, "catalogue.renderer"),
    modelConvention: text(raw.modelConvention, "catalogue.modelConvention"),
    compatibility: text(raw.compatibility, "catalogue.compatibility"),
    components: entries,
  };
}

export const find = (catalogue: Catalogue, id: string): Known<CatalogueEntry> => {
  const entry = catalogue.components.find((component) => component.id === id);
  return entry
    ? reported(entry, { document: catalogue.id, at: entry.model ?? entry.thumbnail, sha256: entry.modelSha256 ?? entry.thumbnailSha256 })
    : absent(`the catalogue has no entry for "${id}"`);
};

/** The model's own height in model units, which a stretched part is scaled against. */
export const modelHeight = (entry: CatalogueEntry): number => entry.bounds.top - entry.bounds.bottom;

/** Where a host should fetch a file from, given wherever it chose to host the catalogue. */
export const fileUrl = (baseUrl: string, name: string): string => `${baseUrl.replace(/\/$/, "")}/${name}`;
