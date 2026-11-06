/**
 * The flat map wrapping onto the globe and back.
 *
 * The map is a sheet 2π wide and π tall. At `s` = 1 it lies on the unit
 * sphere; at `s` = 0 it is flat. In between it lies on a sphere of radius
 * 1/s that touches the same front point, so the sheet curls round the globe
 * without stretching: distances along the equator and the central meridian
 * stay the same throughout.
 *
 * Coordinates are the earth's own frame: the front point (longitude 0,
 * latitude 0) is +x, north is +y and east is -z, matching three's sphere.
 */

/** Below this the sheet is drawn as exactly flat. */
const FLAT = 1e-4;

/**
 * Position and normal of the sheet point with texture coordinates (u, v),
 * u 0..1 west to east, v 0..1 south to north (three's sphere UVs).
 * Writes x, y, z, nx, ny, nz into `out` at `i`.
 */
export function wrapPoint(u: number, v: number, s: number, radius: number, out: Float32Array | number[], i = 0, normals?: Float32Array | number[]): void {
  const du = u - 0.5;
  const dv = v - 0.5;
  if (s < FLAT) {
    out[i] = radius;
    out[i + 1] = dv * Math.PI * radius;
    out[i + 2] = -du * Math.PI * 2 * radius;
    if (normals) {
      normals[i] = 1;
      normals[i + 1] = 0;
      normals[i + 2] = 0;
    }
    return;
  }
  const r = 1 / s;
  const lon = du * Math.PI * 2 * s;
  const lat = dv * Math.PI * s;
  const cl = Math.cos(lat);
  const nx = cl * Math.cos(lon);
  const ny = Math.sin(lat);
  const nz = -cl * Math.sin(lon);
  // Centre of the curl sits on the axis behind the front point.
  out[i] = radius * (1 - r + r * nx);
  out[i + 1] = radius * r * ny;
  out[i + 2] = radius * r * nz;
  if (normals) {
    normals[i] = nx;
    normals[i + 1] = ny;
    normals[i + 2] = nz;
  }
}

/** Smooth start and stop. */
export function easeInOut(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}
