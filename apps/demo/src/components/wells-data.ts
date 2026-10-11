import { forgeDesign, forgeOperations, forgeSeismicSection, researchDesign, sProfileDesign } from "@ikhmalputra/subsurface-core";
import type { SeismicSectionMetadata, WellDesign, WellOperations } from "@ikhmalputra/subsurface-core";

export const wells: readonly { id: string; label: string; design: WellDesign; operations?: WellOperations; logUrl?: string; seismic?: { url: string; meta: SeismicSectionMetadata } }[] = [
  { id: "forge", label: "Utah FORGE 16A(78)-32 · documented", design: forgeDesign, operations: forgeOperations, logUrl: "/data/forge-16a-mudlog-10ft.las", seismic: { url: `/data/${forgeSeismicSection.section.file}`, meta: forgeSeismicSection } },
  { id: "s-profile", label: "S-profile completion · synthetic", design: sProfileDesign },
  { id: "research", label: "Open research reference · synthetic", design: researchDesign },
];
