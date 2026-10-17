// The slice of OSDU Search's Lucene syntax the adapter sends, and nothing more:
//   *                                   every record
//   (empty)                             every record
//   id:("a" OR "b")                     records whose id is one of the values
//   data.WellID:("x:" OR "y")           records whose data.WellID is one of the values
//   data.WellboreID:(...)               likewise
// Values may be quoted or bare, and may carry OSDU's trailing colon or not: "x:" and "x" name the
// same record. Anything else is a 400, as the real Search answers a query it cannot parse. The
// adapter's queries are built from ids, so an unknown operator in one is a bug worth a loud answer.

export class LuceneError extends Error {}

const FIELDS = new Set(["id", "data.WellID", "data.WellboreID"]);
/** OSDU references end in ":"; a versioned one in ":<version>:". The bare id is what both name. */
export const stripRef = (value) => value.replace(/:\d+:$/, "").replace(/:$/, "");

/** `{ all: true }`, or `{ field, values: Set<string> }` with the values stripped of their reference colon. */
export function parseQuery(text) {
  if (text === undefined || text === null) return { all: true };
  if (typeof text !== "string") throw new LuceneError("query must be a string");
  const query = text.trim();
  if (query === "" || query === "*" || query === "*:*") return { all: true };
  const match = /^([A-Za-z_][\w.]*)\s*:\s*(\(([\s\S]*)\)|"([^"]*)"|([^\s()"]+))$/.exec(query);
  if (!match) throw new LuceneError(`unsupported query syntax: ${query.slice(0, 80)}`);
  const field = match[1];
  if (!FIELDS.has(field)) throw new LuceneError(`unsupported field: ${field}`);
  const values = new Set();
  if (match[3] !== undefined) {
    // A parenthesised list: quoted or bare terms joined by OR.
    const inner = match[3].trim();
    if (!inner) throw new LuceneError("empty term list");
    const terms = inner.split(/\s+OR\s+/);
    for (const term of terms) {
      const quoted = /^"([^"]*)"$/.exec(term.trim());
      const bare = /^[^\s()"]+$/.test(term.trim());
      if (!quoted && !bare) throw new LuceneError(`unsupported term: ${term.trim().slice(0, 80)}`);
      const value = quoted ? quoted[1] : term.trim();
      if (!value) throw new LuceneError("empty term");
      values.add(stripRef(value));
    }
  } else {
    values.add(stripRef(match[4] ?? match[5]));
  }
  return { field, values };
}

/** A kind pattern (`*:*:master-data--Well:1.*.*`) as a test on full kind strings. */
export function kindMatcher(pattern) {
  if (typeof pattern !== "string" || !pattern.trim()) throw new LuceneError("kind is required");
  const parts = pattern.trim().split(":");
  if (parts.length !== 4) throw new LuceneError(`kind must have four parts: ${pattern.slice(0, 80)}`);
  const regex = new RegExp(`^${parts.map((part) => part.split("*").map((literal) => literal.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^:]*")).join(":")}$`);
  return (kind) => regex.test(kind);
}
