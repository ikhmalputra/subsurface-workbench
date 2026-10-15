// A Node script or a server route: no DOM, no React. Propose casing from the pore and fracture
// pressures, then screen every string and list what still fails.
import {
  analyzeSection, exampleWellBrief, proposeCasingScheme, validateDesign,
} from "@ikhmalputra/subsurface-core/well-design";

const brief = exampleWellBrief();
const sections = proposeCasingScheme(brief);
const proposed = { ...brief, sections };

console.table(sections.map((section, index) => {
  const { safety, passes } = analyzeSection(proposed, index);
  return { string: section.label, pipe: `${section.weightLbFt} lb/ft ${section.grade}`, ...safety, passes };
}));

const errors = validateDesign(proposed).filter((issue) => issue.severity === "error");
console.log(errors.map((issue) => issue.message));
