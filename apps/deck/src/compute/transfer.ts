/** What a worker message can hand over instead of copying. */
/** The ArrayBuffers under typed arrays in a value, a few levels deep, each once. */
export function transferables(value: unknown, depth = 0, found = new Set<ArrayBuffer>()): ArrayBuffer[] {
  if (value instanceof ArrayBuffer) found.add(value);
  else if (ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer && value.byteLength === value.buffer.byteLength) found.add(value.buffer);
  else if (depth < 4 && value && typeof value === "object") for (const item of Array.isArray(value) ? value : Object.values(value)) transferables(item, depth + 1, found);
  return [...found];
}
