import assert from "node:assert/strict";
import test from "node:test";
import { CoordinateFrameRegistry } from "./frames.ts";
import type { AffineTransform3, CoordinateFrame } from "./frames.ts";

const metreFrame: CoordinateFrame = {
  id: "survey",
  crs: "local: survey east/north",
  lengthUnit: "m",
  verticalDatum: "RKB",
  verticalDirection: "down",
};
const sceneFrame: CoordinateFrame = {
  id: "scene",
  crs: "local: scene",
  lengthUnit: "m",
  verticalDatum: "RKB",
  verticalDirection: "up",
};

const rotatedAndTranslated: AffineTransform3 = [
  0, 1, 0, 0,
  -1, 0, 0, 0,
  0, 0, 1, 0,
  10, 20, 30, 1,
];

function close(actual: readonly number[], expected: readonly number[], tolerance = 1e-10) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]!) <= tolerance, `${value} differs from ${expected[index]}`));
}

test("frame registry transforms fiducial points forward, backward, and over explicit multi-frame paths", () => {
  const registry = new CoordinateFrameRegistry();
  registry.registerFrame(metreFrame);
  registry.registerFrame(sceneFrame);
  registry.registerFrame({ ...sceneFrame, id: "render", crs: "local: render" });
  registry.registerTransform("survey", "scene", rotatedAndTranslated);
  registry.registerTransform("scene", "render", [
    2, 0, 0, 0,
    0, 3, 0, 0,
    0, 0, 4, 0,
    1, -2, 5, 1,
  ]);

  close(registry.transformPoint([1, 2, 3], "survey", "scene"), [8, 21, 33]);
  close(registry.transformPoint([8, 21, 33], "scene", "survey"), [1, 2, 3]);
  close(registry.transformPoint([1, 2, 3], "survey", "render"), [17, 61, 137]);
  close(registry.transformPoint([1, 2, 3], "survey", "survey"), [1, 2, 3]);
});

test("frame registry transforms plane normals with inverse transpose under nonuniform scale", () => {
  const registry = new CoordinateFrameRegistry();
  registry.registerFrame(metreFrame);
  registry.registerFrame(sceneFrame);
  registry.registerTransform("survey", "scene", [
    2, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    10, 0, 0, 1,
  ]);

  const transformedOrigin = registry.transformPoint([0, 0, 0], "survey", "scene");
  const transformedNormal = registry.transformNormal([1, 1, 0], "survey", "scene");
  close(transformedOrigin, [10, 0, 0]);
  close(transformedNormal, [1 / Math.sqrt(5), 2 / Math.sqrt(5), 0]);
  const pointOnSourcePlane = [1, -1, 0] as const;
  const mappedPoint = registry.transformPoint(pointOnSourcePlane, "survey", "scene");
  close(
    [mappedPoint[0] * transformedNormal[0] + mappedPoint[1] * transformedNormal[1]],
    [10 * transformedNormal[0]],
  );
});

test("frame registry makes frame metadata, units, and transform paths explicit", () => {
  const registry = new CoordinateFrameRegistry();
  registry.registerFrame({ ...metreFrame, id: "feet", lengthUnit: "ft" });
  registry.registerFrame(metreFrame);
  registry.registerFrame(sceneFrame);
  close(registry.pointInMetres([100, -50, 10], "feet"), [30.48, -15.24, 3.048]);
  close(registry.pointInMetres([1, 2, 3], "survey"), [1, 2, 3]);
  assert.throws(() => registry.getTransform("feet", "survey"), /No registered transform/);
  registry.registerTransform("feet", "scene", [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
  registry.registerTransform("scene", "survey", [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);

  assert.throws(() => registry.registerFrame({ ...metreFrame, verticalDatum: "MSL" }), /different metadata/);
  assert.throws(() => registry.getFrame("missing"), /not registered/);
  assert.throws(() => registry.registerTransform("feet", "survey", rotatedAndTranslated), /conflicts/);
});

test("frame registry rejects invalid, singular, and perspective transforms", () => {
  const registry = new CoordinateFrameRegistry();
  registry.registerFrame(metreFrame);
  registry.registerFrame(sceneFrame);

  assert.throws(() => registry.registerTransform("survey", "scene", [1, 2, 3]), /16 finite/);
  assert.throws(() => registry.registerTransform("survey", "scene", [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 1,
  ]), /invertible/);
  assert.throws(() => registry.registerTransform("survey", "scene", [
    1, 0, 0, 0.1,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]), /affine/);
  assert.throws(() => registry.transformPoint([0, 0, 0], "unregistered", "scene"), /not registered/);
  assert.throws(() => registry.transformPoint([Number.NaN, 0, 0], "survey", "survey"), /finite/);
});

test("frame registry accepts well-conditioned transforms at small coordinate scales", () => {
  const registry = new CoordinateFrameRegistry();
  registry.registerFrame(metreFrame);
  registry.registerFrame(sceneFrame);
  registry.registerTransform("survey", "scene", [
    1e-6, 0, 0, 0,
    0, 1e-6, 0, 0,
    0, 0, 1e-6, 0,
    0, 0, 0, 1,
  ]);
  close(registry.transformPoint([1_000_000, -2_000_000, 3_000_000], "survey", "scene"), [1, -2, 3]);
  close(registry.transformPoint([1, -2, 3], "scene", "survey"), [1_000_000, -2_000_000, 3_000_000]);
});
