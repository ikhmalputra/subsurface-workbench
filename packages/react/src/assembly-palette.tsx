"use client";

/** MIME type carried by palette drags. A second `${WELL_COMPONENT_MIME}-<id>` type exposes the id during dragover. */
export const WELL_COMPONENT_MIME = "application/x-well-component";

export function catalogIdFromDrag(event: { dataTransfer: DataTransfer | null }): string | null {
  const types = Array.from(event.dataTransfer?.types ?? []);
  const typed = types.find((type) => type.startsWith(`${WELL_COMPONENT_MIME}-`));
  if (typed) return typed.slice(WELL_COMPONENT_MIME.length + 1);
  return types.includes(WELL_COMPONENT_MIME) ? event.dataTransfer?.getData(WELL_COMPONENT_MIME) || null : null;
}

export function assetUrl(assetBaseUrl: string, file: string) {
  return `${assetBaseUrl.replace(/\/$/, "")}/${file}`;
}
