/**
 * The trigonometry every directional calculation needs, written once.
 *
 * `Math.PI / 180` was inlined in seven modules of the previous core while an eighth defined a
 * constant for it. That is not a style problem: a conversion written inline is a place where the
 * next reader cannot tell whether an angle arriving in radians was converted, and there is nothing
 * to grep for when one was missed.
 */
export const RAD = Math.PI / 180;
export const DEG = 180 / Math.PI;

/** Any bearing expressed in [0, 360). Surveys arrive with negatives and with values past 360. */
export const normalizeAzimuth = (azimuthDeg: number): number => ((azimuthDeg % 360) + 360) % 360;

/** The shortest signed turn from one bearing to another, in (-180, 180]. */
export const signedAzimuthChange = (fromDeg: number, toDeg: number): number => ((toDeg - fromDeg + 540) % 360) - 180;

/** The unit vector a survey station points along: north, east, down. */
export function tangent(inclinationDeg: number, azimuthDeg: number): readonly [number, number, number] {
  const inc = inclinationDeg * RAD, azi = azimuthDeg * RAD;
  return [Math.sin(inc) * Math.cos(azi), Math.sin(inc) * Math.sin(azi), Math.cos(inc)];
}

/**
 * The angle between two survey directions, in degrees.
 *
 * Carried unchanged from the previous core, where it is checked against the Utah FORGE 16A(78)-32
 * survey: 422 observed stations whose published positions the result has to reproduce.
 */
export function doglegAngleDeg(
  from: { readonly inclinationDeg: number; readonly azimuthDeg: number },
  to: { readonly inclinationDeg: number; readonly azimuthDeg: number },
): number {
  const i1 = from.inclinationDeg * RAD, i2 = to.inclinationDeg * RAD;
  const cosine = Math.cos(i2 - i1) - Math.sin(i1) * Math.sin(i2) * (1 - Math.cos((to.azimuthDeg - from.azimuthDeg) * RAD));
  return Math.acos(Math.min(1, Math.max(-1, cosine))) * DEG;
}

/**
 * Minimum curvature's ratio factor for a dogleg in radians.
 *
 * The series expansion below 1e-7 rad is not an optimisation: `tan(x/2) / x` is 0/0 at zero, and a
 * straight course is the commonest case in a survey. It tends to 1, as it must.
 */
export const ratioFactor = (doglegRad: number): number =>
  doglegRad < 1e-7 ? 1 + (doglegRad * doglegRad) / 12 : (2 / doglegRad) * Math.tan(doglegRad / 2);
