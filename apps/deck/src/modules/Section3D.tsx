import { lazy, Suspense, useMemo } from "react";
import type { SiteFence, SiteSceneSurface, SiteSceneWell } from "@ikhmalputra/subsurface-react/3d";
import { LITHOLOGY, areaWells, busId, forceSite, mdOf, tvdssAt } from "../data/force.ts";
import type { ForceLogs, ForceWell } from "../data/force.ts";
import { topsOf } from "../data/force-model.ts";
import type { Top } from "../data/force-model.ts";
import type { Pick } from "../data/picks.ts";
import { Loading } from "./Empty.tsx";

const SiteScene = lazy(() => import("@ikhmalputra/subsurface-react/3d").then((module) => ({ default: module.SiteScene })));

/**
 * The correlation section standing in its field: a fence through the section's wells in their order,
 * each well's lithology as a column in the fence, the visible tops as lines joining them across it,
 * and each top as a surface between every well of the area that has it. Picking stays on the panel,
 * and wells join the section from the map; here a click on a well takes it off.
 */

/** A point down a well's path at a measured depth, interpolated between its stations. */
function pointAt(well: SiteSceneWell, md: number): [number, number, number] | null {
  const n = well.mdM.length;
  if (!n) return null;
  if (md <= well.mdM[0]!) return [well.xyz[0]!, well.xyz[1]!, well.xyz[2]!];
  for (let i = 1; i < n; i++) {
    const a = well.mdM[i - 1]!, b = well.mdM[i]!;
    if (md > b) continue;
    const f = b > a ? (md - a) / (b - a) : 0;
    return [0, 1, 2].map((k) => well.xyz[(i - 1) * 3 + k]! + (well.xyz[i * 3 + k]! - well.xyz[(i - 1) * 3 + k]!) * f) as [number, number, number];
  }
  return [well.xyz[(n - 1) * 3]!, well.xyz[(n - 1) * 3 + 1]!, well.xyz[(n - 1) * 3 + 2]!];
}

/** A CSS colour as the scene can take it: custom properties resolved on the page. */
const resolve = (colour: string) => {
  const name = /^var\((--[\w-]+)\)$/.exec(colour)?.[1];
  return name ? getComputedStyle(document.querySelector(".cor") ?? document.documentElement).getPropertyValue(name).trim() || "#60a5fa" : colour;
};
const topIn = (list: readonly Top[] | undefined, name: string) => list?.find((top) => top.name === name && top.kind === "yours") ?? list?.find((top) => top.name === name);

/** A well's lithology as intervals: runs of one class, merged where shorter than a metre. */
function lithologyIntervals(well: ForceWell, litho: Int8Array) {
  const out: { topMdM: number; baseMdM: number; color: string }[] = [];
  let start = 0;
  for (let k = 1; k <= litho.length; k++) {
    if (k < litho.length && litho[k] === litho[start]) continue;
    const code = litho[start]!;
    const top = mdOf(well, start), base = mdOf(well, k);
    const colour = code >= 0 ? LITHOLOGY[code]?.colour ?? "#8b95ad" : null;
    const last = out.at(-1);
    if (colour && last && (last.color === colour || base - top < 1) && Math.abs(last.baseMdM - top) < 1) last.baseMdM = base;
    else if (colour) out.push({ topMdM: top, baseMdM: base, color: colour });
    start = k;
  }
  return out;
}

export function Section3D({ area, wells, logs, names, colours, focus, picks, selectedId, onToggle }: {
  readonly area: string; readonly wells: readonly ForceWell[]; readonly logs: ReadonlyMap<string, ForceLogs>;
  readonly names: readonly string[]; readonly colours: ReadonlyMap<string, string>; readonly focus: string | null;
  readonly picks: Readonly<Record<string, readonly Pick[]>>; readonly selectedId: string | null; readonly onToggle: (id: string) => void;
}) {
  const site = forceSite(area);
  const sceneWell = useMemo(() => new Map(site?.wells.map((well) => [well.id, well]) ?? []), [site]);
  const placed = useMemo(() => areaWells(area).filter((well) => sceneWell.has(busId(well))), [area, sceneWell]);
  const tops = useMemo(() => new Map(placed.map((well) => [well.id, topsOf(well, picks[busId(well)] ?? [])])), [placed, picks]);
  const nameKey = names.join("|"), colourKey = names.map((name) => colours.get(name)).join("|");

  // Each visible top between every well of the area that has it, yours where you picked it.
  const surfaces = useMemo((): readonly SiteSceneSurface[] => {
    const sea: SiteSceneSurface = { id: "sea", label: "Sea level", provenance: "documented", role: "reference", color: "#3f8fc0", note: "0 m, the depth reference of the Directorate's TVDSS.", geometry: { kind: "plane", depthM: 0 } };
    return [sea, ...names.flatMap((name): SiteSceneSurface[] => {
      let yours = 0;
      const points = placed.flatMap((well) => {
        const top = topIn(tops.get(well.id), name), path = sceneWell.get(busId(well));
        if (!top || !path) return [];
        if (top.kind === "yours") yours++;
        const p = pointAt(path, top.md);
        return p ? [p] : [];
      });
      if (points.length < 3) return [];
      return [{ id: `top-${name}`, label: name, provenance: yours ? "user-authored" : "documented", role: "horizon", color: resolve(colours.get(name) ?? "#8b95ad"), geometry: { kind: "tin", points }, quiet: true,
        note: `${name} in ${points.length} wells${yours ? `, ${yours} of them your picks` : ""}, triangulated between them for display. Not a mapped surface.` }];
    })];
  }, [placed, tops, sceneWell, nameKey, colourKey]);

  const litho = wells.map((well) => logs.get(well.id)?.litho ? "1" : "0").join("");
  const fence = useMemo((): SiteFence | null => {
    const paths = wells.map((well) => sceneWell.get(busId(well))).filter((path): path is SiteSceneWell => !!path);
    if (!paths.length) return null;
    const topM = Math.min(...wells.map((well) => tvdssAt(well, well.mdTop))), baseM = Math.max(...wells.map((well) => tvdssAt(well, well.mdBase)));
    return {
      label: `Section · ${wells.length} wells`,
      stations: paths.map((path) => [path.xyz[0]!, path.xyz[1]!] as const),
      topM, baseM,
      columns: wells.flatMap((well) => { const l = logs.get(well.id)?.litho; return l ? [{ wellId: busId(well), intervals: lithologyIntervals(well, l) }] : []; }),
      lines: names.flatMap((name) => {
        const points = wells.flatMap((well) => { const top = topIn(tops.get(well.id), name), path = sceneWell.get(busId(well)); const p = top && path ? pointAt(path, top.md) : null; return p ? [p] : []; });
        return points.length >= 2 ? [{ label: name, color: resolve(colours.get(name) ?? "#8b95ad"), points, emphasis: name === focus }] : [];
      }),
    };
  }, [wells, sceneWell, tops, nameKey, colourKey, focus, litho]);

  // Only the section's wells stand in the scene: the rest of the field shows through the tops between them.
  const ids = wells.map((well) => busId(well)).join(",");
  // Their tops are the fence's lines, so the wells carry no marker labels of their own.
  const standing = useMemo(() => site?.wells.filter((well) => ids.split(",").includes(well.id)).map((well) => ({ ...well, markers: [] })) ?? [], [site, ids]);
  if (!site) return null;
  return <div className="cor-3d">
    <Suspense fallback={<Loading>Standing the section up…</Loading>}>
      <SiteScene key={area} title={`${site.map.label}: the section in 3D`} depthLabel={site.depthLabel} originLabel={site.originLabel} wells={standing} surfaces={surfaces}
        fence={fence} selectedWellId={selectedId} onSelectWell={onToggle} initialExaggeration={10} legend={false} focusSurfaceId={focus ? `top-${focus}` : null} />
    </Suspense>
  </div>;
}
