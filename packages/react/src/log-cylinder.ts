import * as THREE from "three";
import { sampleWellLog, validateWellLogCurve, validateWellLogStyle } from "@ikhmalputra/subsurface-core";
import type { SubsurfaceWellLogCurve, WellLogStyle } from "@ikhmalputra/subsurface-core";

/** Display-only co-axial tube on exact MD stations. Does not change physical casing dimensions. */
export class LogCylinder {
  readonly mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true }));
  constructor(private readonly pointAt: (md: number) => THREE.Vector3, private readonly totalMd: number, private readonly radius: number) {
    this.mesh.name = "Log-mapped well cylinder";
    this.mesh.visible = false;
  }

  update(curve: SubsurfaceWellLogCurve | null, input: WellLogStyle | null): number {
    if (!curve || !input) { this.mesh.visible = false; return 0; }
    const style = validateWellLogStyle(input), log = validateWellLogCurve(curve);
    if (style.curveId !== log.id) throw new TypeError("Log style curveId does not match the supplied curve.");
    const rings = 512, sides = 12, positions: number[] = [], colors: number[] = [], indices: number[] = [], present: boolean[] = [];
    const low = new THREE.Color("#2d5fbb"), high = new THREE.Color("#e6ad30"), missing = new THREE.Color("#8a9399");
    let previousSide = new THREE.Vector3(1, 0, 0);
    for (let i = 0; i <= rings; i++) {
      const md = this.totalMd * i / rings, point = this.pointAt(md);
      const tangent = this.pointAt(Math.min(this.totalMd, md + 0.1)).sub(this.pointAt(Math.max(0, md - 0.1))).normalize();
      if (tangent.lengthSq() < 1e-12) throw new Error("Log cylinder cannot orient a zero-length trajectory segment.");
      let side = previousSide.clone().addScaledVector(tangent, -previousSide.dot(tangent));
      if (side.lengthSq() < 1e-12) side = new THREE.Vector3(0, 0, 1).addScaledVector(tangent, -tangent.z);
      side.normalize(); previousSide = side;
      const up = new THREE.Vector3().crossVectors(tangent, side).normalize();
      const value = sampleWellLog(log, md);
      present.push(value !== null);
      const fraction = value === null ? 0 : THREE.MathUtils.clamp((value - style.domain[0]) / (style.domain[1] - style.domain[0]), 0, 1);
      const color = value === null ? missing : low.clone().lerp(high, style.mode === "radius" ? 0.5 : fraction);
      const multiplier = style.mode === "color" ? 1 : style.radiusRange[0] + fraction * (style.radiusRange[1] - style.radiusRange[0]);
      for (let j = 0; j <= sides; j++) {
        const angle = j * Math.PI * 2 / sides;
        const at = point.clone().addScaledVector(side, Math.cos(angle) * this.radius * multiplier).addScaledVector(up, Math.sin(angle) * this.radius * multiplier);
        positions.push(at.x, at.y, at.z); colors.push(color.r, color.g, color.b);
        // Missing and out-of-domain MD samples create gaps rather than a misleading zero-value tube.
        if (i > 0 && j < sides && present[i] && present[i - 1]) {
          const a = (i - 1) * (sides + 1) + j, b = i * (sides + 1) + j;
          indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    this.mesh.geometry.dispose(); this.mesh.geometry = geometry;
    this.mesh.visible = indices.length > 0;
    return indices.length / 3;
  }
  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
