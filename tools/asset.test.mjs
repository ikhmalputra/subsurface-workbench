import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("every packaged well component matches its manifest hash", async () => {
  const folder = new URL("../packages/react/assets/well-components/", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("manifest.json", folder), "utf8"));
  assert.ok(manifest.components.length >= 55);
  for (const entry of manifest.components) {
    const files = [[entry.thumbnail, entry.thumbnailSha256], ...(entry.model ? [[entry.model, entry.modelSha256]] : [])];
    for (const [file, sha256] of files) assert.equal(createHash("sha256").update(await readFile(new URL(file, folder))).digest("hex"), sha256, file);
  }
});
