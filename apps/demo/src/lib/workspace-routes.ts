export const workspaces = [
  {
    id: "well", label: "Well", detail: "Inspect construction & records",
    icon: "M7 3v18M17 3v18M7 8h10M7 16h10",
    entry: "/view-well/",
    views: [
      { href: "/view-well/", label: "View well", independent: false },
      { href: "/view-well/?tool=trajectory", label: "3D trajectory", independent: false },
    ],
    related: ["/view-well/?tool=edit-well", "/view-well/?tool=report"],
  },
  {
    id: "design", label: "Design", detail: "Plan, build & check",
    icon: "M4 5h16v14H4zM12 8v8M8 12h8",
    entry: "/view-well/?tool=brief",
    views: [{ href: "/view-well/?tool=brief", label: "Well builder", independent: false }],
    related: [],
  },
  {
    id: "field", label: "Field", detail: "Locate, compare & interpret",
    icon: "m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15",
    entry: "/view-well/?tool=field",
    views: [
      { href: "/view-well/?tool=field", label: "Field workspace", independent: false },
    ],
    related: ["/view-well/?tool=correlation", "/view-well/?tool=cross-section"],
  },
  {
    id: "analysis", label: "Analysis", detail: "Investigate evidence & findings",
    icon: "M3 4v16h18M5 15l4-5 4 3 6-8",
    entry: "/view-well/?tool=study",
    views: [
      { href: "/view-well/?tool=study", label: "Engineering studies", independent: false },
    ],
    related: [],
  },
] as const;

export const developerViews = [
  { href: "/view-well/?tool=petrophysics", label: "Petrophysics components", independent: true },
  { href: "/view-well/?tool=production", label: "Production components", independent: true },
  { href: "/view-well/?tool=linked-data", label: "Linked data", independent: true },
  { href: "/view-well/?tool=sandbox", label: "WebGPU sandbox", independent: true },
] as const;

/**
 * The routes the documents used to have. Each forwards to the sheet now, and anything that still
 * names the old route — a link, a test, a bookmark — means the document it became.
 */
export const legacyRoutes: Readonly<Record<string, string>> = {
  "/trajectory/": "/view-well/?tool=trajectory", "/analysis/": "/view-well/?tool=study", "/builder/": "/view-well/?tool=brief",
  "/well-report/": "/view-well/?tool=report", "/map/": "/view-well/?tool=field", "/correlation/": "/view-well/?tool=correlation",
  "/cross-section/": "/view-well/?tool=cross-section", "/edit-well/": "/view-well/?tool=edit-well", "/petrophysics/": "/view-well/?tool=petrophysics",
  "/production/": "/view-well/?tool=production", "/linked-data/": "/view-well/?tool=linked-data", "/sandbox/": "/view-well/?tool=sandbox",
};
const canonical = (route: string) => legacyRoutes[route] ?? route;

export function workspaceForRoute(route: string) {
  const href = canonical(route);
  return workspaces.find((workspace) =>
    workspace.views.some((view) => view.href === href) ||
    workspace.related.some((related) => related === href));
}

export function isIndependentExample(route: string): boolean {
  const href = canonical(route);
  return [...workspaces.flatMap((workspace) => [...workspace.views]), ...developerViews]
    .some((view) => view.href === href && view.independent);
}
