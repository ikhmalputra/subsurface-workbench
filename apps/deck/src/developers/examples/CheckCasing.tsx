// Screen a casing design against burst, collapse and tension, and draw it. Raise the wear
// allowance: strings that are drilled through lose wall, and the ones that no longer pass are
// marked on the schematic.
import { useMemo, useState } from "react";
import {
  analyzeSection, defaultDesignBasis, defaultDesignFactors as factors, designToAssembly, exampleWellBrief,
  type WellDesignBrief,
} from "@ikhmalputra/subsurface-core/well-design";
import { AssemblySchematic } from "@ikhmalputra/subsurface-react/2d";

const example = exampleWellBrief();
const safety = (value: number, minimum: number) =>
  <td className={value < minimum ? "is-fail" : undefined}>{value.toFixed(2)}</td>;

export function CheckCasing() {
  const [wearPct, setWearPct] = useState(0);
  const brief = useMemo((): WellDesignBrief => ({
    ...example,
    basis: { ...(example.basis ?? defaultDesignBasis), casingWearPct: wearPct },
  }), [wearPct]);
  const results = brief.sections.map((section, index) => ({ section, analysis: analyzeSection(brief, index) }));
  const failing = results.filter(({ analysis }) => !analysis.passes);
  const assembly = useMemo(() => designToAssembly(brief), [brief]);

  return <div className="ex-casing">
    <div className="ex-controls">
      <label>Casing wear
        <input type="range" min={0} max={40} step={1} value={wearPct}
          onChange={(event) => setWearPct(Number(event.target.value))} />
        <output>{wearPct}% of wall</output>
      </label>
      <p className="ex-readout">
        {failing.length ? `${failing.length} of ${results.length} strings fail` : "Every string passes"}
        {` · design factors: burst ${factors.burst}, collapse ${factors.collapse}, tension ${factors.tension}`}
      </p>
    </div>
    <div className="ex-pair is-wide-left">
      <table className="ex-table">
        <thead><tr><th>String</th><th>Pipe</th><th>Burst</th><th>Collapse</th><th>Tension</th></tr></thead>
        <tbody>{results.map(({ section, analysis }) => <tr key={section.id}>
          <th scope="row">{section.label}</th>
          <td>{section.weightLbFt} lb/ft {section.grade}</td>
          {safety(analysis.safety.burst, factors.burst)}
          {safety(analysis.safety.collapse, factors.collapse)}
          {safety(analysis.safety.tension, factors.tension)}
        </tr>)}</tbody>
      </table>
      <div className="ex-schematic">
        <AssemblySchematic assembly={assembly} assetBaseUrl={`${import.meta.env.BASE_URL}well-components`} title="Kestrel A-7"
          highlights={failing.map(({ section }) => ({
            id: section.id, topM: section.topMdM, baseM: section.shoeMdM, label: `${section.label} fails`,
          }))} />
      </div>
    </div>
  </div>;
}
