// Compresses the Blender-exported well-component models in place and rewrites their manifest
// digests. Blender's exporter writes float geometry with no compression; every catalogue model is
// pure geometry (no textures), so quantising it and packing it with meshoptimizer is the whole win.
//
//   node tools/compress-models.mjs            compress every model not already compressed
//   node tools/compress-models.mjs --check    report sizes, change nothing
//
// A model that already carries EXT_meshopt_compression is skipped: decoding and re-quantising it
// would lose precision on every run. Re-export from Blender (`pnpm render:catalog`) to start over.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { Logger, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, quantize, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

const folder = new URL("../packages/react/assets/well-components/", import.meta.url);
const check = process.argv.includes("--check");

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.WARN)).registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });

const manifestUrl = new URL("manifest.json", folder);
const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
let before = 0, after = 0, compressed = 0, skipped = 0;

for (const entry of manifest.components) {
  if (!entry.model) continue;
  const url = new URL(entry.model, folder);
  const input = await readFile(url);
  before += input.byteLength;
  const document = await io.readBinary(input);
  if (document.getRoot().listExtensionsUsed().some((extension) => extension.extensionName === "EXT_meshopt_compression")) {
    after += input.byteLength;
    skipped += 1;
    continue;
  }
  await document.transform(
    dedup(),
    weld(),
    // Positions at 14 bits hold a 1.2-unit component to a tenth of a millimetre at real scale;
    // normals at 10 bits are below what the eye resolves on a shaded surface.
    quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }),
    meshopt({ encoder: MeshoptEncoder, level: "medium" }),
    prune(),
  );
  const output = await io.writeBinary(document);
  after += output.byteLength;
  compressed += 1;
  if (check) continue;
  await writeFile(url, output);
  entry.modelSha256 = createHash("sha256").update(output).digest("hex");
}

if (!check && compressed) {
  manifest.modelCompression = "glTF-Transform: dedup, weld, quantize (position 14 bit, normal 10 bit), EXT_meshopt_compression. Decode with three.js GLTFLoader.setMeshoptDecoder.";
  await writeFile(manifestUrl, `${JSON.stringify(manifest, null, 2)}\n`);
}
const mb = (bytes) => `${(bytes / 1e6).toFixed(2)} MB`;
console.log(`${check ? "Would compress" : "Compressed"} ${compressed} models, ${skipped} already compressed: ${mb(before)} → ${mb(after)}`);
