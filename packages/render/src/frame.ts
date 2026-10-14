import { Quaternion, Vector3 } from "three";
import { RAD } from "@ikhmalputra/subsurface-calc";

/**
 * The one place the well's frame becomes the scene's frame.
 *
 * A well is measured in northing, easting and true vertical depth, with depth counted downward.
 * three.js is right-handed with Y up. Those are different spaces, and the previous scene converted
 * between them inline at seven call sites, each spelling out `east / 100, -tvd / 100, -north / 100`
 * from memory. The architecture notes already listed "treating two of these as the same" as the
 * source of most visualisation errors, and seven hand-written copies is how that happens.
 *
 * The mapping, stated once:
 *
 *     scene.x = +easting        east is right
 *     scene.y = -tvd            depth counts down, the scene counts up
 *     scene.z = -northing       north is away from the camera
 *
 * and a scale, because a 3,339 m well in metres is far outside the near and far planes a camera can
 * work with comfortably. The scale is a property of the view, not of the well, so it travels here
 * rather than being divided in by hand.
 *
 * `toWell` is the exact inverse. Every pick, every probe and every camera position goes back through
 * it, so what a host receives is metres in its own frame and never an unexplained three.js vector.
 */

export interface WellPoint {
  readonly northingM: number;
  readonly eastingM: number;
  readonly tvdM: number;
}

export interface Frame {
  /** Scene units per metre. 1/100 keeps a 3 km well inside a comfortable camera range. */
  readonly unitsPerMetre: number;
}

export const defaultFrame: Frame = { unitsPerMetre: 1 / 100 };

export function toScene(point: WellPoint, frame: Frame = defaultFrame): Vector3 {
  const k = frame.unitsPerMetre;
  return new Vector3(point.eastingM * k, -point.tvdM * k, -point.northingM * k);
}

export function toWell(vector: Vector3, frame: Frame = defaultFrame): WellPoint {
  const k = frame.unitsPerMetre;
  return { eastingM: vector.x / k, tvdM: -vector.y / k, northingM: -vector.z / k };
}

/**
 * The direction the hole points, as a scene-space unit vector.
 *
 * Inclination is from vertical and azimuth is clockwise from north, which is the survey's
 * convention and not three.js's. Doing this once means a part is never pointed by eye.
 */
export function holeDirection(inclinationDeg: number, azimuthDeg: number): Vector3 {
  const inc = inclinationDeg * RAD, azi = azimuthDeg * RAD;
  const north = Math.sin(inc) * Math.cos(azi);
  const east = Math.sin(inc) * Math.sin(azi);
  const down = Math.cos(inc);
  // Same mapping as `toScene`, without the scale: a direction has no length in metres.
  return new Vector3(east, -down, -north).normalize();
}

/**
 * How to turn a catalogue model so it follows the hole.
 *
 * Every model hangs from its origin along -Y by the catalogue's convention, so this is the rotation
 * from -Y onto the hole's direction. A vertical hole returns the identity, which is what the model
 * was authored as.
 */
export function alignToHole(inclinationDeg: number, azimuthDeg: number): Quaternion {
  return new Quaternion().setFromUnitVectors(new Vector3(0, -1, 0), holeDirection(inclinationDeg, azimuthDeg));
}
