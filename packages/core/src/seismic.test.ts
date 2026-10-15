import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { forgeDesign } from "./index.ts";
import { amplitudeClip, cubeAlongLine, cubeSection, ebcdicToText, forgePsdmVolumeLayout, forgeSeismicSection, ibmToFloat, parseSegy, projectOntoSection, seismicColour, seismicDepthToTvd, seismicImage, segyTrace, tvdToSeismicDepth, wellOnCubeSection } from "./seismic.ts";
import type { SeismicCube } from "./seismic.ts";

const bytes = (path: string) => {
  const buffer = readFileSync(new URL(path, import.meta.url));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
};

test("IBM floats decode to the textbook values", () => {
  assert.equal(ibmToFloat(0x42640000), 100);
  assert.equal(ibmToFloat(0xc276a000), -118.625);
  assert.equal(ibmToFloat(0x41100000), 1);
  assert.equal(ibmToFloat(0x00000000), 0);
  assert.equal(ibmToFloat(0x80000000), 0);
  assert.equal(ebcdicToText(new Uint8Array([0xc3, 0x40, 0xf1, 0x4b])), "C 1.");
});

test("parses a synthetic little-endian ASCII IEEE file", () => {
  const samples = 4;
  const buffer = new ArrayBuffer(3600 + 2 * (240 + samples * 4));
  const view = new DataView(buffer);
  new Uint8Array(buffer, 0, 3200).set(new TextEncoder().encode("C 1 SYNTHETIC".padEnd(3200, " ")));
  view.setUint16(3216, 2000, true);
  view.setUint16(3220, samples, true);
  view.setUint16(3224, 5, true);
  view.setUint8(3500, 2);
  for (let trace = 0; trace < 2; trace += 1) {
    const offset = 3600 + trace * (240 + samples * 4);
    view.setInt16(offset + 70, -10, true);
    view.setInt32(offset + 180, 12345, true);
    view.setInt32(offset + 188, 10 + trace, true);
    for (let sample = 0; sample < samples; sample += 1) view.setFloat32(offset + 240 + sample * 4, trace * 10 + sample + 0.5, true);
  }
  const file = parseSegy(buffer);
  assert.equal(file.byteOrder, "little");
  assert.equal(file.textEncoding, "ascii");
  assert.equal(file.textHeader[0], "C 1 SYNTHETIC");
  assert.equal(file.binary.revision, "2.0");
  assert.equal(file.binary.sampleInterval, 2000);
  assert.equal(file.traceCount, 2);
  assert.equal(file.traces[0]?.x, 1234.5);
  assert.equal(file.traces[1]?.inline, 11);
  assert.deepEqual([...segyTrace(file, 1)], [10.5, 11.5, 12.5, 13.5]);
  assert.throws(() => parseSegy(new ArrayBuffer(100)), /3600-byte/);
});

test("reads the FORGE volume's non-standard header bytes verbatim", () => {
  const raw = bytes("../test-fixtures/forge3d-psdm-first3.segy");
  const file = parseSegy(raw, { layout: forgePsdmVolumeLayout });
  assert.equal(file.textEncoding, "ebcdic");
  assert.match(file.textHeader[11] ?? "", /PRODUCT: Aniso PSDM UnEnhanced Stack/);
  assert.match(file.textHeader[9] ?? "", /DATUM: 1800 m\s+REPLACEMENT VELOCITY: 2500 m\/s/);
  assert.deepEqual(file.textHeader, forgeSeismicSection.source.textHeader);
  assert.equal(file.binary.samplesPerTrace, 1001);
  assert.equal(file.binary.sampleInterval, 5000);
  assert.equal(file.binary.format, 1);
  assert.equal(file.binary.measurementSystem, 1);
  assert.equal(file.traceCount, 3);
  assert.deepEqual(file.traces.map((trace) => [trace.inline, trace.crossline]), [[1, 1], [1, 2], [1, 3]]);
  assert.equal(file.traces[0]?.x, 332800.5);
  assert.equal(file.traces[0]?.y, 4260778);
  assert.ok(Math.abs((file.traces[1]?.x ?? 0) - 332800.5 - 25) < 0.5, "crossline step is 25 m east");
  // Without the layout the standard bytes 181/185 hold zero in this file.
  assert.equal(parseSegy(raw).traces[0]?.x, 0);
});

test("the bundled well-path section matches its pinned metadata", () => {
  const raw = bytes("../../fixtures/data/forge-16a-psdm-section.sgy");
  assert.equal(createHash("sha256").update(new Uint8Array(raw)).digest("hex"), forgeSeismicSection.section.sha256);
  const file = parseSegy(raw);
  const { section, wellhead } = forgeSeismicSection;
  assert.equal(file.binary.revision, "1.0");
  assert.equal(file.traceCount, section.traces);
  assert.equal(file.sampleCount, section.samples);
  assert.equal(file.traces[0]?.shotpoint, section.fromM);
  assert.equal(file.traces.at(-1)?.shotpoint, section.toM);
  assert.equal(file.traces[0]?.coordinateScalar, -100);
  assert.equal(file.traces[0]?.x, 333900.94);
  assert.deepEqual([file.traces[0]?.inline, file.traces[0]?.crossline], [117, 43]);
  // Trace positions lie within half a 25 m bin (diagonal) of the section line.
  const projected = projectOntoSection(file.traces.map((trace) => ({ mdM: trace.index, eastingM: trace.x, northingM: trace.y, depthM: 0 })), { originEastingM: wellhead.eastingM, originNorthingM: wellhead.northingM, azimuthDeg: section.azimuthDeg });
  projected.forEach((point, index) => {
    assert.ok(Math.abs(point.offsetM) <= 17.7, `trace ${index} off line by ${point.offsetM}`);
    assert.ok(Math.abs(point.alongM - file.traces[index]!.shotpoint) <= 17.7);
  });
  // Above ground (datum 1800 m, ground ~1650 m) the migrated image is near silent.
  const clip = amplitudeClip(file.data);
  assert.ok(Math.abs(clip - section.p99AbsAmplitude) / section.p99AbsAmplitude < 0.05);
  const shallow = amplitudeClip(file.data.filter((_, index) => index % file.sampleCount < 20), 99);
  assert.ok(shallow < clip / 20);
});

test("FORGE 16A trajectory converts to section depth and projects onto the line", () => {
  const { seismicDatumElevationM, rkbElevationM, wellhead, section } = forgeSeismicSection;
  assert.ok(Math.abs(tvdToSeismicDepth(0, rkbElevationM, seismicDatumElevationM) - 140.67) < 0.01);
  const survey = forgeDesign.survey ?? [];
  const projected = projectOntoSection(survey.map((point) => ({ mdM: point.mdM, eastingM: wellhead.eastingM + point.eastingM, northingM: wellhead.northingM + point.northingM, depthM: tvdToSeismicDepth(point.tvdM, rkbElevationM, seismicDatumElevationM) })), { originEastingM: wellhead.eastingM, originNorthingM: wellhead.northingM, azimuthDeg: section.azimuthDeg });
  const toe = projected.at(-1)!;
  assert.ok(Math.abs(toe.offsetM) < 0.01, "section azimuth passes through the toe");
  assert.ok(toe.alongM > 1200 && toe.alongM < section.toM);
  assert.ok(Math.max(...projected.map((point) => Math.abs(point.offsetM))) < 60);
});

test("seismic image is one RGBA pixel per trace sample, coloured by clipped amplitude", () => {
  const file = parseSegy(bytes("../../fixtures/data/forge-16a-psdm-section.sgy"));
  const image = seismicImage(file, { colorMap: "red-blue", clip: 1 });
  assert.equal(image.width, file.traceCount);
  assert.equal(image.height, file.sampleCount);
  assert.equal(image.data.length, file.traceCount * file.sampleCount * 4);
  const t = 37, s = 412, at = (s * image.width + t) * 4;
  assert.deepEqual([...image.data.slice(at, at + 4)], [...seismicColour("red-blue", file.data[t * file.sampleCount + s]!), 255]);
  assert.deepEqual(seismicColour("grey", 0), [128, 128, 128]);
  assert.deepEqual(seismicColour("red-blue", 0), [255, 255, 255]);
  assert.deepEqual(seismicColour("red-blue", 5), seismicColour("red-blue", 1));
  assert.ok(seismicColour("red-blue", -1)[2] > seismicColour("red-blue", -1)[0], "troughs are blue");
  assert.equal(seismicDepthToTvd(tvdToSeismicDepth(1234.5, 1659.33, 1800), 1659.33, 1800), 1234.5);
});

test("the bundled sub-volume is the same volume: its offset-0 row is the well-path section", () => {
  const { subVolume, section } = forgeSeismicSection;
  assert.ok(subVolume);
  const raw = bytes(`../../fixtures/data/${subVolume.file}`);
  assert.equal(createHash("sha256").update(new Uint8Array(raw)).digest("hex"), subVolume.sha256);
  const counts = new Int8Array(raw);
  const { alongCount, offsetCount, samples, amplitudePerCount } = subVolume;
  assert.equal(counts.length, alongCount * offsetCount * samples);
  assert.equal(subVolume.azimuthDeg, section.azimuthDeg);
  assert.equal(alongCount, section.traces);
  assert.equal(subVolume.alongFromM, section.fromM);
  assert.equal((subVolume.offsetToM - subVolume.offsetFromM) / subVolume.spacingM + 1, offsetCount);
  const inline = parseSegy(bytes(`../../fixtures/data/${section.file}`));
  const middle = (offsetCount - 1) / 2;
  const clip = 127 * amplitudePerCount;
  let compared = 0;
  for (let along = 0; along < alongCount; along += 7) for (let sample = 0; sample < samples; sample += 13) {
    const amplitude = inline.data[along * inline.sampleCount + sample]!;
    if (Math.abs(amplitude) > clip) continue;
    const count = counts[(sample * offsetCount + middle) * alongCount + along]!;
    assert.ok(Math.abs(count * amplitudePerCount - amplitude) <= amplitudePerCount / 2 + 1e-6, `along ${along} sample ${sample}`);
    compared += 1;
  }
  assert.ok(compared > 500);
  assert.ok(subVolume.clippedFraction <= 0.0011);
});

test("a cube slice takes the nearest bin's own samples, dequantised, and says which bin", () => {
  // 3 along × 2 offset × 2 samples; count = 100·sample + 10·offset + along.
  const counts = new Int8Array(12);
  for (let s = 0; s < 2; s++) for (let o = 0; o < 2; o++) for (let a = 0; a < 3; a++) counts[(s * 2 + o) * 3 + a] = 50 * s + 10 * o + a;
  const cube: SeismicCube = { counts, alongCount: 3, offsetCount: 2, sampleCount: 2, amplitudePerCount: 0.5, alongFromM: -25, offsetFromM: 0, spacingM: 25 };
  const inline = cubeSection(cube, "inline", 30);
  assert.equal(inline.bin, 1);
  assert.equal(inline.positionM, 25);
  assert.equal(inline.traces.traceCount, 3);
  assert.deepEqual(inline.traces.traces.map((trace) => trace.alongM), [-25, 0, 25]);
  assert.deepEqual([...inline.traces.data], [10, 60, 11, 61, 12, 62].map((count) => count * 0.5));
  const crossline = cubeSection(cube, "crossline", 900);
  assert.equal(crossline.bin, 2, "a position past the cube snaps to its last bin");
  assert.deepEqual(crossline.traces.traces.map((trace) => trace.offsetM), [0, 25]);
  assert.deepEqual([...crossline.traces.data], [2, 52, 12, 62].map((count) => count * 0.5));
  assert.throws(() => cubeSection({ ...cube, counts: new Int8Array(5) }, "inline", 0), /expected 3 × 2 × 2/);
});

test("a well re-projected onto a crossline is measured across it and off it", () => {
  const path = [{ mdM: 100, alongM: 400, offsetM: -12, depthM: 900 }];
  assert.deepEqual(wellOnCubeSection(path, { kind: "inline", positionM: 50 }), [{ mdM: 100, alongM: 400, offsetM: -62, depthM: 900 }]);
  assert.deepEqual(wellOnCubeSection(path, { kind: "crossline", positionM: 375 }), [{ mdM: 100, alongM: -12, offsetM: 25, depthM: 900 }]);
});

test("FORGE: the volume's inline through the well is the published section to within half a count", () => {
  const meta = forgeSeismicSection, cut = meta.subVolume!;
  const bytes = readFileSync(new URL("../../fixtures/data/forge-16a-psdm-volume.i8", import.meta.url));
  const cube: SeismicCube = { counts: new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), alongCount: cut.alongCount, offsetCount: cut.offsetCount, sampleCount: cut.samples, amplitudePerCount: cut.amplitudePerCount, alongFromM: cut.alongFromM, offsetFromM: cut.offsetFromM, spacingM: cut.spacingM };
  const inline = cubeSection(cube, "inline", 0);
  assert.equal(inline.positionM, 0);
  const sgy = readFileSync(new URL("../../fixtures/data/forge-16a-psdm-section.sgy", import.meta.url));
  const section = parseSegy(sgy.buffer.slice(sgy.byteOffset, sgy.byteOffset + sgy.byteLength));
  assert.equal(section.traceCount, inline.traces.traceCount);
  let worst = 0;
  for (let t = 0; t < section.traceCount; t++) for (let s = 0; s < cut.samples; s++) {
    const clip = 127 * cut.amplitudePerCount, value = Math.max(-clip, Math.min(clip, section.data[t * section.sampleCount + s]!));
    worst = Math.max(worst, Math.abs(value - inline.traces.data[t * cut.samples + s]!));
  }
  assert.ok(worst <= cut.amplitudePerCount / 2 + 1e-9, `worst difference ${worst}`);
});

test("a cut along any line takes the nearest bins and is clipped to the cube", () => {
  const counts = new Int8Array(12);
  for (let s = 0; s < 2; s++) for (let o = 0; o < 2; o++) for (let a = 0; a < 3; a++) counts[(s * 2 + o) * 3 + a] = 50 * s + 10 * o + a;
  const cube: SeismicCube = { counts, alongCount: 3, offsetCount: 2, sampleCount: 2, amplitudePerCount: 1, alongFromM: 0, offsetFromM: 0, spacingM: 10 };
  // From well outside the cube, diagonally across it: the cube spans along −5…25 m and offset −5…15 m.
  const line = cubeAlongLine(cube, { alongM: -20, offsetM: 0 }, { alongM: 40, offsetM: 0 }, 10);
  assert.equal(line.lengthM, 60);
  assert.deepEqual(line.inside, [15, 45]);
  assert.deepEqual(line.traces.traces.map((trace) => trace.distanceM), [20, 30, 40]);
  assert.deepEqual([...line.traces.data], [0, 50, 1, 51, 2, 52]);
  const missed = cubeAlongLine(cube, { alongM: 100, offsetM: 100 }, { alongM: 200, offsetM: 100 });
  assert.equal(missed.inside, null);
  assert.equal(missed.traces.traceCount, 0);
});
