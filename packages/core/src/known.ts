/**
 * What is known, and how it came to be known.
 *
 * The rule this project will not bend is that nothing is invented: an unknown casing diameter stays
 * unknown, and a view says "not reported" rather than drawing a plausible tube. In the previous
 * design that rule lived in every view. A dimension was `number | null`, and each drawing, each
 * table and each calculator had to remember to check the null and to say the right thing about it.
 * Dozens of places, each able to forget.
 *
 * Here it is in the type instead. A value is `Known<T>`, and reading it means saying what happens
 * when it is absent. A view cannot render an absence as a number by forgetting, because there is no
 * bare number to reach for.
 *
 * Three states, because "we don't have it" and "we worked it out" are different claims:
 *
 * - **reported** — a source said so, and the citation travels with the value.
 * - **derived** — this package computed it, and `from` names what it was computed out of.
 * - **absent** — nobody said, and `why` is the sentence a view shows in its place.
 */

/** Where a reported value came from, precisely enough to check it. */
export interface Source {
  /** What stated it: a document title, a file name, a service. */
  readonly document: string;
  /** Where in that document — a page, a row, a mnemonic. */
  readonly at?: string;
  /** A resolvable link, when one exists. */
  readonly url?: string;
  /** Digest of the exact bytes this was read from, when the import pinned one. */
  readonly sha256?: string;
}

export type Known<T> =
  | { readonly state: "reported"; readonly value: T; readonly source: Source }
  | { readonly state: "derived"; readonly value: T; readonly from: string }
  | { readonly state: "absent"; readonly why: string };

export const reported = <T>(value: T, source: Source): Known<T> => ({ state: "reported", value, source });
export const derived = <T>(value: T, from: string): Known<T> => ({ state: "derived", value, from });
export const absent = <T>(why = "not reported"): Known<T> => ({ state: "absent", why });

/** True when there is a value to read. Narrows, so `known.value` is reachable after it. */
export const isKnown = <T>(known: Known<T>): known is Extract<Known<T>, { value: T }> => known.state !== "absent";

/**
 * Read a value, saying what an absence becomes. There is deliberately no `unwrap` that throws and
 * no `?? 0`: a zero that means "we don't know" is the exact failure this type exists to prevent.
 */
export const orElse = <T>(known: Known<T>, fallback: T): T => (isKnown(known) ? known.value : fallback);

/** Map the value and keep the provenance, so a conversion cannot quietly become a measurement. */
export function mapKnown<T, U>(known: Known<T>, change: (value: T) => U): Known<U> {
  return known.state === "absent" ? known : known.state === "reported"
    ? { state: "reported", value: change(known.value), source: known.source }
    : { state: "derived", value: change(known.value), from: known.from };
}

/**
 * Combine two values. The result is only as strong as its weakest input: anything computed from a
 * derived value is derived, and anything computed from an absence is absent. This is what stops a
 * calculation from presenting an estimate with the authority of a measurement.
 */
export function combine<A, B, C>(a: Known<A>, b: Known<B>, change: (a: A, b: B) => C, from: string): Known<C> {
  if (a.state === "absent") return a as Known<C>;
  if (b.state === "absent") return b as Known<C>;
  return { state: "derived", value: change(a.value, b.value), from };
}

/** Every value at once, or the first absence. Written because the alternative, at each call site,
 *  was a cast per input — which is the kernel failing to carry its weight rather than the caller
 *  being careless. */
export function all<T extends readonly unknown[]>(
  ...parts: { readonly [K in keyof T]: Known<T[K]> }
): Known<T> {
  const values = [] as unknown[];
  for (const part of parts) {
    if (part.state === "absent") return part as Known<T>;
    values.push(part.value);
  }
  return { state: "derived", value: values as unknown as T, from: "every input present" };
}

/** `all`, then compute, labelling the result with the formula or reasoning that produced it. */
export function fromAll<T extends readonly unknown[], R>(
  parts: { readonly [K in keyof T]: Known<T[K]> },
  change: (...values: T) => R,
  from: string,
): Known<R> {
  const together = all<T>(...(parts as never));
  return together.state === "absent" ? (together as Known<R>) : { state: "derived", value: change(...together.value), from };
}

/** The sentence a view shows when there is nothing to draw. Never invent a different one. */
export const sayWhy = (known: Known<unknown>): string => (known.state === "absent" ? known.why : "");
