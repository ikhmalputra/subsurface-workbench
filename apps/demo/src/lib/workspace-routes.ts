export const workspaces = [
  {
    id: "well", label: "Well", detail: "Inspect construction & records",
    icon: "M7 3v18M17 3v18M7 8h10M7 16h10",
    entry: "/view-well/",
    views: [
      { href: "/view-well/", label: "View well", independent: false },
      { href: "/trajectory/", label: "3D trajectory", independent: false },
    ],
    related: ["/edit-well/", "/well-report/"],
  },
  {
    id: "design", label: "Design", detail: "Plan, build & check",
    icon: "M4 5h16v14H4zM12 8v8M8 12h8",
    entry: "/builder/",
    views: [{ href: "/builder/", label: "Well builder", independent: false }],
    related: [],
  },
  {
    id: "field", label: "Field", detail: "Locate, compare & interpret",
    icon: "m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15",
    entry: "/map/",
    views: [
      { href: "/map/", label: "Field workspace", independent: false },
    ],
    related: ["/correlation/", "/cross-section/"],
  },
  {
    id: "analysis", label: "Analysis", detail: "Investigate evidence & findings",
    icon: "M3 4v16h18M5 15l4-5 4 3 6-8",
    entry: "/analysis/",
    views: [
      { href: "/analysis/", label: "Engineering studies", independent: false },
    ],
    related: [],
  },
] as const;

export const developerViews = [
  { href: "/petrophysics/", label: "Petrophysics components", independent: true },
  { href: "/production/", label: "Production components", independent: true },
  { href: "/linked-data/", label: "Linked data", independent: true },
  { href: "/sandbox/", label: "WebGPU sandbox", independent: true },
] as const;

export function workspaceForRoute(route: string) {
  return workspaces.find((workspace) =>
    workspace.views.some((view) => view.href === route) ||
    workspace.related.some((related) => related === route));
}

export function isIndependentExample(route: string): boolean {
  return [...workspaces.flatMap((workspace) => [...workspace.views]), ...developerViews]
    .some((view) => view.href === route && view.independent);
}
