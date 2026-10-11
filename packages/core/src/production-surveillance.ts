import { array, fail, literal, number, object, text } from "./contract-validation.ts";
import { validateInteractionDataset } from "./dataset.ts";
import type { InteractionDataset } from "./dataset.ts";

export type ProductionEventKind =
  | "production"
  | "injection"
  | "shut-in"
  | "workover"
  | "production-test"
  | "injection-test"
  | "completion"
  | "surveillance"
  | "other";

export interface ProductionSurveillanceEvent {
  readonly id: string;
  readonly kind: ProductionEventKind;
  /** Exact UTC Unix milliseconds. */
  readonly startTimeMs: number;
  readonly endTimeMs: number | null;
  /** Optional measured depth in metres MD. */
  readonly mdM: number | null;
  /** Optional ID of a host-supplied well construction component. */
  readonly componentId: string | null;
  readonly summary: string;
  readonly source: string | null;
}

export interface ProductionSurveillanceDocument {
  readonly version: 1;
  readonly id: string;
  readonly wellId: string;
  readonly wellLabel: string;
  readonly provenance: "documented" | "synthetic" | "user-authored";
  readonly source: string | null;
  /** Observations are UTC-time keyed; column units remain host-declared. */
  readonly dataset: InteractionDataset;
  readonly events: readonly ProductionSurveillanceEvent[];
}

function utcMilliseconds(value: unknown, path: string): number {
  const milliseconds = number(value, path);
  if (!Number.isSafeInteger(milliseconds) || Math.abs(milliseconds) > 8.64e15) {
    fail(path, "expected exact, valid UTC Unix epoch milliseconds");
  }
  return milliseconds;
}

function validateEventKind(value: unknown, path: string): ProductionEventKind {
  const kinds: readonly ProductionEventKind[] = [
    "production", "injection", "shut-in", "workover", "production-test",
    "injection-test", "completion", "surveillance", "other",
  ];
  if (typeof value !== "string" || !kinds.includes(value as ProductionEventKind)) {
    fail(path, "unknown production event kind");
  }
  return value as ProductionEventKind;
}

/** Validate time/depth semantics and alignment to the shared interaction dataset. */
export function validateProductionSurveillanceDocument(input: unknown): ProductionSurveillanceDocument {
  const record = object(input, "$", [
    "version", "id", "wellId", "wellLabel", "provenance", "source", "dataset", "events",
  ]);
  const version = literal(record.version, 1, "$.version");
  const id = text(record.id, "$.id");
  const wellId = text(record.wellId, "$.wellId");
  const wellLabel = text(record.wellLabel, "$.wellLabel");
  const provenance = record.provenance;
  if (provenance !== "documented" && provenance !== "synthetic" && provenance !== "user-authored") {
    fail("$.provenance", "expected documented, synthetic, or user-authored");
  }
  const source = record.source === null ? null : text(record.source, "$.source");
  const dataset = validateInteractionDataset(record.dataset);
  if (dataset.key.kind !== "time") fail("$.dataset.key.kind", "production observations must use UTC time keys");
  if (dataset.wellId !== wellId) fail("$.dataset.wellId", "dataset wellId must match the production document wellId");

  const eventIds = new Set<string>();
  const events = array(record.events, "$.events").map((item, index): ProductionSurveillanceEvent => {
    const path = `$.events[${index}]`;
    const event = object(item, path, [
      "id", "kind", "startTimeMs", "endTimeMs", "mdM", "componentId", "summary", "source",
    ]);
    const eventId = text(event.id, `${path}.id`);
    if (eventIds.has(eventId)) fail(`${path}.id`, "duplicate production event identifier");
    eventIds.add(eventId);
    const startTimeMs = utcMilliseconds(event.startTimeMs, `${path}.startTimeMs`);
    const endTimeMs = event.endTimeMs === null ? null : utcMilliseconds(event.endTimeMs, `${path}.endTimeMs`);
    if (endTimeMs !== null && endTimeMs < startTimeMs) fail(`${path}.endTimeMs`, "event end must not precede its start");
    const mdM = event.mdM === null ? null : number(event.mdM, `${path}.mdM`);
    if (mdM !== null && mdM < 0) fail(`${path}.mdM`, "measured depth must be non-negative");
    return {
      id: eventId,
      kind: validateEventKind(event.kind, `${path}.kind`),
      startTimeMs,
      endTimeMs,
      mdM,
      componentId: event.componentId === null ? null : text(event.componentId, `${path}.componentId`),
      summary: text(event.summary, `${path}.summary`),
      source: event.source === null ? null : text(event.source, `${path}.source`),
    };
  });
  events.sort((a, b) => a.startTimeMs - b.startTimeMs || a.id.localeCompare(b.id));
  return Object.freeze({
    version,
    id,
    wellId,
    wellLabel,
    provenance,
    source,
    dataset,
    events: Object.freeze(events.map((event) => Object.freeze(event))),
  });
}
