import { TubeGeometry } from "three";
import type { Curve, Vector3 } from "three";

export function cutawayTube(curve: Curve<Vector3>, segments: number, radius: number, radial = 32) {
  const geometry = new TubeGeometry(curve, segments, radius, radial, false);
  const indices = geometry.getIndex()!;
  const kept: number[] = [];
  const cutFrom = Math.round(radial * 0.12);
  const cutTo = cutFrom + Math.round(radial * 0.3);
  for (let face = 0; face < indices.count; face += 6) {
    const segment = (face / 6) % radial;
    if (segment >= cutFrom && segment < cutTo) continue;
    for (let vertex = 0; vertex < 6; vertex++) kept.push(indices.getX(face + vertex));
  }
  geometry.setIndex(kept);
  return geometry;
}
