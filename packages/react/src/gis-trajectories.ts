import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { CustomLayerInterface, Map as GeographicMap, MercatorCoordinate } from "maplibre-gl";
import { computeMinimumCurvature, positionAtMeasuredDepth } from "@ikhmalputra/subsurface-core";
import type { WellComponent, WellDesign } from "@ikhmalputra/subsurface-core";
import { reprojectGisXY } from "@ikhmalputra/subsurface-core/gis";
import type { GeographicGisModel, GisImportedLayer } from "@ikhmalputra/subsurface-core/gis";
import { makeGisBathymetry } from "./gis-bathymetry.js";
import { dlsColor } from "./trajectory-colour.js";
import { cutawayTube } from "./cutaway-tube.js";
import { makeOffshoreEnvironment, seabedDepthAt } from "./offshore-environment.js";
import type { OffshoreEnvironmentLayers } from "./offshore-environment.js";

export interface GisTrajectory3d {
  readonly design: WellDesign;
  /** Positive down from sea surface to the survey's seabed wellhead. */
  readonly waterDepthM: number;
  readonly markers?: readonly { readonly mdM: number; readonly label: string }[];
}

interface ScreenStation { x: number; y: number; z: number; mdM: number }

export function makeGisTrajectoryLayer(model: GeographicGisModel, trajectories: readonly GisTrajectory3d[], Mercator: typeof MercatorCoordinate, onError: (message: string) => void) {
  const scene = new THREE.Scene(), camera = new THREE.Camera();
  camera.matrixAutoUpdate = false;
  camera.matrixWorldAutoUpdate = false;
  const origin = Mercator.fromLngLat([...model.bounds[0]], 0);
  const scale = origin.meterInMercatorCoordinateUnits();
  const local = new THREE.Matrix4().makeTranslation(origin.x, origin.y, origin.z).scale(new THREE.Vector3(scale, scale, scale));
  let map: GeographicMap;
  let renderer: THREE.WebGLRenderer;
  let selectedId: string | null = null;
  let selectedMd: number | null = null;
  let selectedComponent: string | null = null;
  let constructionVisible = true;
  let diameterScale = 400;
  let focusedWell: string | null = null;
  let focusPoint: THREE.Vector3 | null = null;
  let focusSteps = 0;
  let focusedComponent: string | null = null;
  let fitId: string | null | undefined;
  let fitSteps = 0;
  if (new Set(trajectories.map((item) => item.design.id)).size !== trajectories.length) throw new TypeError("Embedded GIS trajectory IDs must be unique.");
  const labels: HTMLDivElement[] = [];
  const detailLabels: { element: HTMLDivElement; point: THREE.Vector3; wellId: string; componentId: string }[] = [];
  scene.add(new THREE.AmbientLight("#ffffff", 2));
  const light = new THREE.DirectionalLight("#ffffff", 3);
  light.position.set(-1000, -2000, 5000);
  scene.add(light);
  let maximumDepthM = 0;
  const entries = trajectories.map(({ design, waterDepthM, markers = [] }) => {
    const record = model.wells.find(({ well }) => well.id === design.id);
    if (!record || !design.survey || design.survey.length < 2 || !Number.isFinite(waterDepthM) || waterDepthM < 0) throw new TypeError("Embedded GIS trajectories require matching wells, surveys and non-negative water depths.");
    const head = record.stations[0]!.xyz;
    const survey = computeMinimumCurvature(design.survey, { tieIn: design.survey[0] });
    if (design.depthDatum !== record.well.depthDatum || design.totalDepthM !== record.well.depthsMdM.at(-1) || design.survey.length !== record.stations.length) throw new TypeError("Embedded trajectory datum and MD coverage must match the GIS source.");
    design.survey.forEach((point, index) => {
      const source = record.stations[index]!;
      if (point.mdM !== source.mdM || Math.abs(point.tvdM - source.xyz[2]) > 1e-6 || Math.abs(head[0] + point.eastingM - source.xyz[0]) > 1e-6 || Math.abs(head[1] + point.northingM - source.xyz[1]) > 1e-6) throw new TypeError("Embedded trajectory positions must match the GIS source and seabed datum.");
      maximumDepthM = Math.max(maximumDepthM, waterDepthM + point.tvdM);
    });
    for (const marker of markers) if (!marker.label.trim() || !Number.isFinite(marker.mdM) || marker.mdM < 0 || marker.mdM > design.totalDepthM) throw new TypeError("GIS trajectory markers require labels and in-range MD.");
    const point = (mdM: number) => {
      const position = positionAtMeasuredDepth(design, mdM);
      const xy = reprojectGisXY([head[0] + position.eastingM, head[1] + position.northingM], record.well.crs, "EPSG:4326");
      const mercator = Mercator.fromLngLat([...xy], -(waterDepthM + position.tvdM));
      return new THREE.Vector3((mercator.x - origin.x) / scale, (mercator.y - origin.y) / scale, mercator.z / scale);
    };
    class SurveyCurve extends THREE.Curve<THREE.Vector3> {
      constructor() { super(); }
      getPoint(t: number, target = new THREE.Vector3()) { return target.copy(point(Math.min(design.totalDepthM, Math.max(0, t * design.totalDepthM)))); }
    }
    const count = Math.min(600, Math.max(100, design.survey.length * 2));
    const geometry = new THREE.TubeGeometry(new SurveyCurve(), count, 22, 8, false);
    const colors: number[] = [];
    for (let ring = 0; ring <= count; ring++) {
      const mdM = design.totalDepthM * ring / count;
      const station = survey.find((item) => item.mdM >= mdM) ?? survey.at(-1)!;
      const color = dlsColor(station.dlsDegPer30m, 3);
      for (let side = 0; side <= 8; side++) colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    const construction = new THREE.Group();
    scene.add(construction);
    const components = design.components ?? [];
    const componentMeshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] = [];
    const componentColors: Partial<Record<WellComponent["kind"], string>> = { Casing: "#4a6fb0", Cement: "#cfc6ad", Tubular: "#b8734a", Packer: "#36423c", "Safety valve": "#d2a23a", Gauge: "#2f8f7a", Wellhead: "#5f6a72", Valve: "#b8452f" };
    const casingColors = ["#2f8f7a", "#4a6fb0", "#8a6bb5", "#c8643f"];
    let casingIndex = 0;
    for (const component of components) {
      if (!Number.isFinite(component.topDepthM) || !Number.isFinite(component.bottomDepthM) || component.topDepthM < 0 || component.bottomDepthM > design.totalDepthM || component.bottomDepthM < component.topDepthM || component.outerDiameterMm === null || component.outerDiameterMm <= 0) throw new TypeError("Embedded construction requires in-range MD and positive outside diameters.");
      const start = component.topDepthM, end = component.bottomDepthM;
      const shell = component.kind === "Cement" || component.kind === "Casing";
      const radius = component.outerDiameterMm / 2000;
      const points = [point(start), ...design.survey.filter((station) => station.mdM > start && station.mdM < end).map((station) => point(station.mdM)), point(end)];
      let geometry: THREE.BufferGeometry;
      if (component.kind === "Wellhead" || component.kind === "Valve") {
        const parts = [
          new THREE.CylinderGeometry(radius, radius * 1.1, radius * 2, 24),
          new THREE.CylinderGeometry(radius * 1.35, radius * 1.35, radius * 0.2, 24).translate(0, radius, 0),
          new THREE.CylinderGeometry(radius * 1.35, radius * 1.35, radius * 0.2, 24).translate(0, -radius, 0),
        ];
        geometry = mergeGeometries(parts);
        for (const part of parts) part.dispose();
        geometry.rotateX(Math.PI / 2);
        const location = point(0);
        location.z += component.kind === "Valve" ? 220 : 80;
        geometry.translate(location.x, location.y, location.z);
      } else {
        if (points[0]!.distanceTo(points.at(-1)!) < 1e-6) points[points.length - 1] = points[0]!.clone().add(new THREE.Vector3(0, 0, -1));
        const curve = new THREE.CurvePath<THREE.Vector3>();
        for (let index = 1; index < points.length; index++) curve.add(new THREE.LineCurve3(points[index - 1]!, points[index]!));
        const tool = !shell && component.kind !== "Tubular";
        if (tool) {
          const middle = (start + end) / 2;
          const tangent = point(Math.min(design.totalDepthM, middle + 1)).sub(point(Math.max(0, middle - 1))).normalize();
          const parts = [
            new THREE.CylinderGeometry(radius * 0.72, radius * 0.72, 120, 24),
            new THREE.CylinderGeometry(radius, radius, 16, 24).translate(0, 40, 0),
            new THREE.CylinderGeometry(radius, radius, 16, 24).translate(0, -40, 0),
          ];
          geometry = mergeGeometries(parts);
          for (const part of parts) part.dispose();
          geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent));
          const center = point(middle);
          geometry.translate(center.x, center.y, center.z);
        } else geometry = shell ? cutawayTube(curve, Math.min(420, Math.max(2, points.length * 2)), radius, 24) : new THREE.TubeGeometry(curve, Math.min(420, Math.max(2, points.length * 2)), radius, 16, false);
      }
      // Scale diameters about the trajectory, not the source positions or interval MD.
      const vertices = geometry.getAttribute("position");
      const centers = new Float32Array(vertices.count * 3);
      const axes = new Float32Array(vertices.count * 3);
      if (component.kind === "Wellhead" || component.kind === "Valve" || (!shell && component.kind !== "Tubular")) {
        const center = point((start + end) / 2);
        if (component.kind === "Wellhead" || component.kind === "Valve") center.z += component.kind === "Valve" ? 220 : 80;
        for (let at = 0; at < vertices.count; at++) centers.set([center.x, center.y, center.z], at * 3);
        if (component.kind !== "Wellhead" && component.kind !== "Valve") {
          const tangent = point(Math.min(design.totalDepthM, (start + end) / 2 + 1)).sub(point(Math.max(0, (start + end) / 2 - 1))).normalize();
          for (let at = 0; at < vertices.count; at++) axes.set([tangent.x, tangent.y, tangent.z], at * 3);
        }
      } else {
        if (!(geometry instanceof THREE.TubeGeometry)) throw new TypeError("Expected tubular geometry for construction intervals.");
        const rings = vertices.count / (shell ? 25 : 17);
        for (let ring = 0; ring < rings; ring++) {
          const center = geometry.parameters.path.getPointAt(ring / (rings - 1));
          for (let side = 0; side < (shell ? 25 : 17); side++) centers.set([center.x, center.y, center.z], (ring * (shell ? 25 : 17) + side) * 3);
        }
      }
      const original = Float32Array.from(vertices.array);
      const color = component.kind === "Casing" && !component.parentId ? casingColors[casingIndex++ % casingColors.length]! : componentColors[component.kind] ?? "#4768a5";
      const material = new THREE.MeshStandardMaterial({ color, metalness: component.kind === "Cement" ? 0 : 0.5, roughness: 0.4, side: THREE.DoubleSide, transparent: true, opacity: component.kind === "Cement" ? 0.22 : shell ? 0.68 : 1, depthWrite: !shell });
      const componentMesh = new THREE.Mesh(geometry, material);
      componentMesh.userData = { componentId: component.id, parentId: component.parentId, centers, axes, original, color, opacity: material.opacity, mdM: (start + end) / 2 };
      construction.add(componentMesh);
      componentMeshes.push(componentMesh);
    }
    const headMarker = new THREE.Mesh(new THREE.SphereGeometry(35, 12, 8), new THREE.MeshBasicMaterial({ color: "#147e85" }));
    headMarker.position.copy(point(0));
    scene.add(headMarker);
    const markerMeshes = markers.map((marker) => {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(28, 12, 8), new THREE.MeshBasicMaterial({ color: "#a05a22" }));
      mesh.position.copy(point(marker.mdM));
      scene.add(mesh);
      return { mesh, mdM: marker.mdM };
    });
    const samples = Array.from({ length: count + 1 }, (_, index) => {
      const mdM = design.totalDepthM * index / count;
      return { point: point(mdM), mdM };
    });
    return { design, waterDepthM, material, mesh, point, samples, headMarker, markerMeshes, construction, componentMeshes, screen: [] as ScreenStation[] };
  });
  const environmentAnchors = entries.map((entry) => {
    const head = entry.point(0);
    return { x: head.x, y: head.y, depthM: entry.waterDepthM };
  });
  const environment = makeOffshoreEnvironment(environmentAnchors, new THREE.Box3().setFromPoints(entries.flatMap((entry) => entry.samples.map((sample) => sample.point))));
  let bathymetry: ReturnType<typeof makeGisBathymetry> | null = null;
  let bathymetryId: string | null = null;
  let bathymetryLabel: HTMLDivElement | null = null;
  let environmentOptions: OffshoreEnvironmentLayers = { sea: true, water: true, seabed: true, subsurface: true };
  const environmentLabels: { element: HTMLDivElement; point: THREE.Vector3; key: keyof OffshoreEnvironmentLayers }[] = [];
  const probe = new THREE.Mesh(new THREE.SphereGeometry(38, 16, 12), new THREE.MeshBasicMaterial({ color: "#ff6a00", depthTest: false }));
  probe.visible = false;
  probe.renderOrder = 10;
  scene.add(probe);
  function projected(point: THREE.Vector3, mdM: number): ScreenStation {
    const clip = point.clone().project(camera);
    return { x: (clip.x + 1) * map.getCanvas().clientWidth / 2, y: (1 - clip.y) * map.getCanvas().clientHeight / 2, z: clip.z, mdM };
  }
  const layer: CustomLayerInterface = {
    id: "subsurface-trajectories", type: "custom", renderingMode: "3d",
    onAdd(instance, gl) {
      map = instance;
      renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;
      for (const entry of entries) {
        const label = document.createElement("div");
        label.className = "sw-gis-trajectory-label";
        label.textContent = entry.design.wellName ?? entry.design.id;
        label.setAttribute("aria-hidden", "true");
        map.getCanvasContainer().appendChild(label);
        labels.push(label);
        for (const component of entry.design.components ?? []) {
          if (component.kind === "Cement" || component.id === "pressure-gauge" || component.id === "tree-valve") continue;
          const label = document.createElement("div");
          label.className = "sw-gis-component-label";
          label.textContent = component.kind === "Casing" && !component.parentId ? `${component.name} shoe · ${component.bottomDepthM.toFixed(0)} m MD` : component.name;
          label.setAttribute("aria-hidden", "true");
          map.getCanvasContainer().appendChild(label);
          detailLabels.push({ element: label, point: entry.point(component.kind === "Casing" && !component.parentId ? component.bottomDepthM : (component.topDepthM + component.bottomDepthM) / 2), wellId: entry.design.id, componentId: component.id });
        }
      }
      const corner = environment.bounds.min;
      for (const [text, point, key] of [
        ["SEA SURFACE · 0 m", new THREE.Vector3(corner.x, corner.y, 0), "sea"],
        ["WATER COLUMN · assumed depths", new THREE.Vector3(corner.x, corner.y, -400), "water"],
        ["ILLUSTRATIVE SEABED", new THREE.Vector3(corner.x, corner.y, -seabedDepthAt(environmentAnchors, corner.x, corner.y)), "seabed"],
        ["SUBSURFACE CUTAWAY · not interpreted geology", new THREE.Vector3(corner.x, corner.y, environment.base + 400), "subsurface"],
      ] as const) {
        const element = document.createElement("div");
        element.className = "sw-gis-environment-label";
        element.textContent = text; element.setAttribute("aria-hidden", "true");
        map.getCanvasContainer().appendChild(element);
        environmentLabels.push({ element, point, key });
      }
    },
    render(_gl, args) {
      const projection = new THREE.Matrix4().fromArray(args.projectionMatrix);
      const view = projection.clone().invert().multiply(new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix));
      // MapLibre's far plane encloses the surface; extend only this layer for negative-altitude wells.
      const far = args.farZ + Math.max(maximumDepthM, -environment.base, -(bathymetry?.bounds.min.z ?? 0)) * scale * 512 * 2 ** map.getZoom() * 2;
      projection.elements[10] = -(far + args.nearZ) / (far - args.nearZ);
      projection.elements[14] = -2 * far * args.nearZ / (far - args.nearZ);
      camera.projectionMatrix.copy(projection);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      camera.matrixWorldInverse.copy(view).multiply(local);
      camera.matrixWorld.copy(camera.matrixWorldInverse).invert();
      const width = map.getCanvas().clientWidth, height = map.getCanvas().clientHeight;
      for (const [index, entry] of entries.entries()) {
        entry.screen = entry.samples.map((sample) => projected(sample.point, sample.mdM));
        const head = entry.screen[0]!;
        labels[index]!.style.display = (!focusedWell || focusedWell === entry.design.id) && head.z >= -1 && head.z <= 1 && head.x >= 0 && head.x <= width && head.y >= 0 && head.y <= height ? "block" : "none";
        labels[index]!.style.transform = `translate(${head.x + 10}px, ${head.y - 20}px)`;
      }
      map.getCanvas().dataset.visibleTrajectories = String(entries.filter((entry) => entry.screen.every((point) => point.z >= -1 && point.z <= 1 && point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height)).length);
      map.getCanvas().dataset.probeMd = selectedMd === null ? "" : String(selectedMd);
      map.getCanvas().dataset.centerElevation = String(map.getCenterElevation());
      map.getCanvas().dataset.selectedComponent = selectedComponent ?? "";
      map.getCanvas().dataset.componentCount = String(entries.reduce((sum, entry) => sum + entry.componentMeshes.length, 0));
      for (const label of environmentLabels) {
        const location = projected(label.point, 0);
        label.element.style.display = environment.groups[label.key].visible && location.x >= 0 && location.x <= width && location.y >= 0 && location.y <= height && location.z >= -1 && location.z <= 1 ? "block" : "none";
        label.element.style.transform = `translate(${location.x + 8}px, ${location.y}px)`;
      }
      if (bathymetryLabel && bathymetry) {
        const location = projected(bathymetry.bounds.getCenter(new THREE.Vector3()), 0);
        bathymetryLabel.style.display = bathymetry.mesh.visible && location.z >= -1 && location.z <= 1 ? "block" : "none";
        bathymetryLabel.style.transform = `translate(${location.x + 8}px, ${location.y}px)`;
      }
      for (const label of detailLabels) {
        const location = projected(label.point, 0);
        label.element.style.display = constructionVisible && label.wellId === selectedId && (!focusedComponent || focusedComponent === label.componentId) && map.getZoom() > 12 && location.x >= 0 && location.x <= width && location.y >= 0 && location.y <= height && location.z >= -1 && location.z <= 1 ? "block" : "none";
        label.element.style.transform = `translate(${location.x + 45}px, ${location.y}px)`;
      }
      renderer.resetState();
      renderer.render(environment.scene, camera);
      renderer.clearDepth();
      renderer.render(scene, camera);
      if (focusPoint) {
        const pixel = projected(focusPoint, 0);
        if (Math.hypot(pixel.x - width / 2, pixel.y - height / 2) < 2) {
          focusPoint = null;
          map.getCanvas().dataset.focusing = "false";
        } else if (++focusSteps > 20) {
          focusPoint = null;
          map.getCanvas().dataset.focusing = "false";
          onError("Unable to center the selected equipment. Use Fit field to reset the map.");
        } else {
          map.jumpTo({ center: map.unproject([pixel.x, pixel.y]) });
          map.triggerRepaint();
        }
      }
      if (fitId !== undefined) {
        const points = entries.filter((entry) => fitId === null || entry.design.id === fitId).flatMap((entry) => entry.screen);
        if (fitId === null && Object.values(environment.groups).some((group) => group.visible)) {
          const { min, max } = environment.bounds;
          for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) points.push(projected(new THREE.Vector3(x, y, z), 0));
        }
        if (fitId === null && bathymetry?.mesh.visible) {
          const { min, max } = bathymetry.bounds;
          for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) points.push(projected(new THREE.Vector3(x, y, z), 0));
        }
        const minX = Math.min(...points.map((point) => point.x)), maxX = Math.max(...points.map((point) => point.x));
        const minY = Math.min(...points.map((point) => point.y)), maxY = Math.max(...points.map((point) => point.y));
        const fill = Math.max((maxX - minX) / (width - 120), (maxY - minY) / (height - 120));
        const centered = Math.abs((minX + maxX) / 2 - width / 2) < 10 && Math.abs((minY + maxY) / 2 - height / 2) < 10;
        const fitted = minX >= 40 && minY >= 40 && maxX <= width - 40 && maxY <= height - 40 && points.every((point) => point.z >= -1 && point.z <= 1) && centered && (fill >= 0.9 || map.getZoom() >= 15);
        if (fitted && fitSteps > 0) {
          fitId = undefined;
          map.getCanvas().dataset.fitting = "false";
          return;
        }
        if (++fitSteps > 20 || ![minX, minY, maxX, maxY].every(Number.isFinite)) {
          fitId = undefined;
          map.getCanvas().dataset.fitting = "false";
          onError("Unable to frame the complete submerged trajectories. Zoom out or reset the map view.");
          return;
        }
        const center = map.unproject([(minX + maxX) / 2, (minY + maxY) / 2]);
        const zoom = map.getZoom() + Math.log2(Math.min((width - 120) / Math.max(1, maxX - minX), (height - 120) / Math.max(1, maxY - minY)));
        map.jumpTo({ center, zoom: Math.min(15, zoom) });
        map.triggerRepaint();
      }
    },
    onRemove() {
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) material.dispose();
        }
      });
      for (const label of labels) label.remove();
      for (const label of detailLabels) label.element.remove();
      for (const label of environmentLabels) label.element.remove();
      environment.dispose();
      bathymetry?.dispose();
      bathymetryLabel?.remove();
      renderer.dispose();
    },
  };
  return {
    layer,
    bathymetry(value: GisImportedLayer | null) {
      if (value?.id !== bathymetryId) {
        bathymetryLabel?.remove(); bathymetryLabel = null;
        if (bathymetry) { environment.scene.remove(bathymetry.mesh); bathymetry.dispose(); bathymetry = null; }
        bathymetryId = null;
        if (value?.raster) {
          try {
            bathymetry = makeGisBathymetry(value.raster, Mercator, origin, scale);
            environment.scene.add(bathymetry.mesh); bathymetryId = value.id;
            bathymetryLabel = document.createElement("div");
            bathymetryLabel.className = "sw-gis-environment-label";
            bathymetryLabel.textContent = `IMPORTED BATHYMETRY · ${value.label} · ${value.raster.verticalDatum}`;
            bathymetryLabel.setAttribute("aria-hidden", "true");
            map.getCanvasContainer().appendChild(bathymetryLabel);
          } catch (cause) { onError(`3D bathymetry: ${cause instanceof Error ? cause.message : String(cause)}`); }
        }
      }
      if (bathymetry && value) { bathymetry.mesh.visible = value.visible; bathymetry.mesh.material.opacity = value.opacity; }
      environment.layers(bathymetryId ? { ...environmentOptions, water: false, seabed: false, subsurface: false } : environmentOptions);
      map.getCanvas().dataset.bathymetryLayer = bathymetryId ?? "";
      map.getCanvas().dataset.bathymetryTriangles = String(bathymetry?.triangles ?? 0);
      map.triggerRepaint();
    },
    environment(value: OffshoreEnvironmentLayers) {
      environmentOptions = value;
      environment.layers(bathymetryId ? { ...value, water: false, seabed: false, subsurface: false } : value);
      map.getCanvas().dataset.environmentLayers = Object.entries(value).filter(([, visible]) => visible).map(([key]) => key).join(",");
      map.triggerRepaint();
    },
    select(wellId: string | null, mdM: number | null, componentId: string | null) {
      if (focusedWell && focusedWell !== wellId) focusedWell = null;
      if (focusedComponent !== componentId) focusedComponent = null;
      selectedId = wellId;
      selectedMd = mdM;
      selectedComponent = componentId;
      const entry = entries.find((entry) => entry.design.id === wellId);
      for (const item of entries) item.material.opacity = !wellId || item === entry ? 1 : 0.4;
      for (const item of entries) for (const mesh of item.componentMeshes) {
        const selected = item.design.id === wellId && mesh.userData.componentId === componentId;
        const record = item.design.components?.find((component) => component.id === componentId);
        mesh.visible = !focusedComponent || selected || mesh.userData.componentId === record?.parentId;
        mesh.material.color.set(selected ? "#ff6a00" : mesh.userData.color);
        mesh.material.emissive.set(selected ? "#281000" : "#000000");
        mesh.material.opacity = focusedComponent && !selected ? 0.12 : selected ? 1 : mesh.userData.opacity;
        mesh.material.depthTest = !selected;
        mesh.renderOrder = selected ? 20 : 0;
      }
      probe.visible = Boolean(entry && mdM !== null);
      if (entry && mdM !== null) probe.position.copy(entry.point(mdM));
      map.triggerRepaint();
    },
    colorBy(value: "dls" | "solid") {
      for (const entry of entries) {
        entry.material.vertexColors = value === "dls";
        entry.material.color.set(value === "dls" ? "#ffffff" : "#147e85");
        entry.material.needsUpdate = true;
      }
      map.triggerRepaint();
    },
    construction(visible: boolean, exaggeration: number) {
      constructionVisible = visible;
      if (![200, 400, 800].includes(exaggeration)) throw new RangeError("Construction diameter exaggeration must be 200, 400 or 800.");
      const changed = diameterScale !== exaggeration;
      diameterScale = exaggeration;
      for (const entry of entries) {
        const shown = !focusedWell || focusedWell === entry.design.id;
        entry.construction.visible = shown && visible;
        entry.mesh.visible = shown && (!visible || entry.componentMeshes.length === 0);
        entry.headMarker.visible = shown;
        for (const marker of entry.markerMeshes) marker.mesh.visible = shown;
        for (const mesh of entry.componentMeshes) {
          if (!changed && mesh.userData.scaled) continue;
          const vertices = mesh.geometry.getAttribute("position");
          const centers: Float32Array = mesh.userData.centers, axes: Float32Array = mesh.userData.axes, original: Float32Array = mesh.userData.original;
          for (let index = 0; index < vertices.count; index++) {
            const at = index * 3;
            const delta = new THREE.Vector3(original[at]! - centers[at]!, original[at + 1]! - centers[at + 1]!, original[at + 2]! - centers[at + 2]!);
            const axis = new THREE.Vector3(axes[at], axes[at + 1], axes[at + 2]);
            const along = axis.clone().multiplyScalar(delta.dot(axis));
            delta.sub(along).multiplyScalar(exaggeration).add(along);
            vertices.setXYZ(index, centers[at]! + delta.x, centers[at + 1]! + delta.y, centers[at + 2]! + delta.z);
          }
          vertices.needsUpdate = true;
          mesh.geometry.computeVertexNormals();
          mesh.geometry.computeBoundingSphere();
          mesh.userData.scaled = true;
        }
      }
      map.triggerRepaint();
    },
    focusComponent(wellId: string, componentId: string) {
      const entry = entries.find((entry) => entry.design.id === wellId);
      const component = entry?.design.components?.find((component) => component.id === componentId);
      if (!entry || !component) throw new TypeError("Cannot focus an unknown construction component.");
      focusedWell = wellId;
      focusedComponent = componentId;
      for (const mesh of entry.componentMeshes) {
        const selected = mesh.userData.componentId === componentId;
        mesh.visible = selected || mesh.userData.componentId === component.parentId;
        mesh.material.opacity = selected ? 1 : 0.12;
        mesh.material.depthTest = !selected;
        mesh.renderOrder = selected ? 20 : 0;
      }
      for (const item of entries) {
        item.construction.visible = item === entry && constructionVisible; item.mesh.visible = item === entry && !constructionVisible;
        item.headMarker.visible = item === entry;
        for (const marker of item.markerMeshes) marker.mesh.visible = item === entry;
      }
      const point = entry.point((component.topDepthM + component.bottomDepthM) / 2);
      focusPoint = point;
      focusSteps = 0;
      map.getCanvas().dataset.focusing = "true";
      const target = new Mercator(origin.x + point.x * scale, origin.y + point.y * scale, point.z * scale);
      const station = positionAtMeasuredDepth(entry.design, (component.topDepthM + component.bottomDepthM) / 2);
      map.setCenterClampedToGround(false);
      map.jumpTo({ center: target.toLngLat(), elevation: target.toAltitude(), zoom: 19, pitch: 75, bearing: station.azimuthDeg + 90 });
      map.triggerRepaint();
    },
    fit(wellId: string | null) {
      if (wellId !== null && !entries.some((entry) => entry.design.id === wellId)) throw new TypeError("Cannot focus an unknown GIS trajectory.");
      fitId = wellId;
      focusedWell = wellId;
      focusedComponent = null;
      for (const item of entries) for (const mesh of item.componentMeshes) { mesh.material.opacity = mesh.userData.opacity; mesh.visible = true; }
      focusPoint = null;
      for (const item of entries) {
        const visible = wellId === null || item.design.id === wellId;
        item.construction.visible = visible && constructionVisible;
        item.mesh.visible = visible && (!constructionVisible || item.componentMeshes.length === 0);
        item.headMarker.visible = visible;
        for (const marker of item.markerMeshes) marker.mesh.visible = visible;
      }
      fitSteps = 0;
      map.getCanvas().dataset.fitting = "true";
      map.jumpTo({ elevation: 0, pitch: 60, zoom: 11 });
      map.triggerRepaint();
    },
    pick(x: number, y: number) {
      if (constructionVisible) {
        const inverse = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse).invert();
        const ndc = new THREE.Vector3(x / map.getCanvas().clientWidth * 2 - 1, 1 - y / map.getCanvas().clientHeight * 2, -1);
        const near = ndc.clone().applyMatrix4(inverse);
        const far = ndc.setZ(1).applyMatrix4(inverse);
        const ray = new THREE.Raycaster(near, far.sub(near).normalize());
        const objects = entries.filter((entry) => entry.construction.visible).flatMap((entry) => entry.componentMeshes.filter((mesh) => mesh.visible));
        const hit = ray.intersectObjects(objects, false)[0];
        if (hit) {
          const entry = entries.find((entry) => entry.componentMeshes.some((mesh) => mesh === hit.object))!;
          const nearest = entry.samples.reduce((best, sample) => sample.point.distanceToSquared(hit.point) < best.point.distanceToSquared(hit.point) ? sample : best);
          return { wellId: entry.design.id, mdM: nearest.mdM, componentId: String(hit.object.userData.componentId), distance: 0 };
        }
      }
      let best: { wellId: string; mdM: number; componentId: string | null; distance: number } | null = null;
      for (const entry of [...entries].sort((a, b) => Number(b.design.id === selectedId) - Number(a.design.id === selectedId))) {
        if (focusedWell && focusedWell !== entry.design.id) continue;
        for (let index = 1; index < entry.screen.length; index++) {
          const a = entry.screen[index - 1]!, b = entry.screen[index]!;
          if (a.z < -1 || a.z > 1 || b.z < -1 || b.z > 1) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / Math.max(1e-12, dx * dx + dy * dy)));
          const distance = Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
          if (distance <= 10 && (!best || distance < best.distance)) best = { wellId: entry.design.id, mdM: a.mdM + t * (b.mdM - a.mdM), componentId: null, distance };
        }
      }
      return best;
    },
  };
}
