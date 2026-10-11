import * as THREE from "three";

export interface SeabedAnchor { readonly x: number; readonly y: number; readonly depthM: number }

export function seabedDepthAt(anchors: readonly SeabedAnchor[], x: number, y: number) {
  if (!anchors.length || ![x, y].every(Number.isFinite)) throw new TypeError("Seabed interpolation requires anchors and finite coordinates.");
  if (anchors.some((anchor) => ![anchor.x, anchor.y, anchor.depthM].every(Number.isFinite) || anchor.depthM < 0)) throw new TypeError("Seabed anchors require finite coordinates and non-negative depths.");
  let sum = 0, weights = 0;
  for (const anchor of anchors) {
    const distance = (x - anchor.x) ** 2 + (y - anchor.y) ** 2;
    if (distance < 1e-12) return anchor.depthM;
    const weight = 1 / distance;
    sum += weight * anchor.depthM; weights += weight;
  }
  return sum / weights;
}

export interface OffshoreEnvironmentLayers {
  readonly sea: boolean; readonly water: boolean; readonly seabed: boolean; readonly subsurface: boolean;
}

export function makeOffshoreEnvironment(anchors: readonly SeabedAnchor[], bounds: THREE.Box3) {
  seabedDepthAt(anchors, 0, 0);
  if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) throw new TypeError("Offshore environment requires finite non-empty spatial bounds.");
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight("#ffffff", 2));
  const sun = new THREE.DirectionalLight("#ffffff", 2);
  sun.position.set(-2000, -3000, 6000); scene.add(sun);
  const extent = bounds.clone().expandByScalar(1000);
  const minX = extent.min.x, maxX = extent.max.x, minY = extent.min.y, maxY = extent.max.y;
  const base = Math.min(bounds.min.z - 500, -Math.max(...anchors.map((anchor) => anchor.depthM)) - 1000);
  const groups = { sea: new THREE.Group(), water: new THREE.Group(), seabed: new THREE.Group(), subsurface: new THREE.Group() };
  for (const group of Object.values(groups)) scene.add(group);
  const material = (color: string, opacity: number) => new THREE.MeshStandardMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, roughness: 0.9 });
  const width = maxX - minX, height = maxY - minY;
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material("#238eb5", 0.2));
  sea.position.set((minX + maxX) / 2, (minY + maxY) / 2, 0); groups.sea.add(sea);
  const grid: number[] = [];
  for (let x = Math.ceil(minX / 500) * 500; x <= maxX; x += 500) grid.push(x, minY, 2, x, maxY, 2);
  for (let y = Math.ceil(minY / 500) * 500; y <= maxY; y += 500) grid.push(minX, y, 2, maxX, y, 2);
  groups.sea.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(grid, 3)), new THREE.LineBasicMaterial({ color: "#33849e", transparent: true, opacity: 0.45 })));
  const floor = new THREE.PlaneGeometry(width, height, 48, 48);
  floor.translate((minX + maxX) / 2, (minY + maxY) / 2, 0);
  const positions = floor.getAttribute("position");
  for (let index = 0; index < positions.count; index++) positions.setZ(index, -seabedDepthAt(anchors, positions.getX(index), positions.getY(index)));
  floor.computeVertexNormals();
  groups.seabed.add(new THREE.Mesh(floor, material("#bca77f", 0.5)));
  const wire = new THREE.WireframeGeometry(floor);
  groups.seabed.add(new THREE.LineSegments(wire, new THREE.LineBasicMaterial({ color: "#706b4e", transparent: true, opacity: 0.08 })));
  function curtain(a: THREE.Vector2, b: THREE.Vector2, water: boolean) {
    const vertices: number[] = [], indices: number[] = [], segments = 48;
    for (let index = 0; index <= segments; index++) {
      const point = a.clone().lerp(b, index / segments);
      const seabed = -seabedDepthAt(anchors, point.x, point.y);
      vertices.push(point.x, point.y, water ? 0 : seabed, point.x, point.y, water ? seabed : base);
      if (index < segments) { const at = index * 2; indices.push(at, at + 1, at + 2, at + 1, at + 3, at + 2); }
    }
    const geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, material(water ? "#1684ab" : "#8b7154", water ? 0.16 : 0.45));
  }
  // Open the south/east sides: a cutaway, not an opaque enclosing block.
  for (const [a, b] of [
    [new THREE.Vector2(minX, minY), new THREE.Vector2(maxX, minY)],
    [new THREE.Vector2(minX, minY), new THREE.Vector2(minX, maxY)],
  ] as const) {
    groups.water.add(curtain(a, b, true));
    groups.subsurface.add(curtain(a, b, false));
  }
  const bands: number[] = [];
  for (let depth = 1500; -depth > base; depth += 500) {
    bands.push(minX, minY, -depth, maxX, minY, -depth, minX, minY, -depth, minX, maxY, -depth);
  }
  groups.subsurface.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(bands, 3)), new THREE.LineBasicMaterial({ color: "#6a513d", transparent: true, opacity: 0.45 })));
  return {
    scene, groups, base,
    bounds: new THREE.Box3(new THREE.Vector3(minX, minY, base), new THREE.Vector3(maxX, maxY, 0)),
    layers(value: OffshoreEnvironmentLayers) {
      groups.sea.visible = value.sea; groups.water.visible = value.water;
      groups.seabed.visible = value.seabed; groups.subsurface.visible = value.subsurface;
    },
    dispose() {
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) material.dispose();
        }
      });
    },
  };
}
