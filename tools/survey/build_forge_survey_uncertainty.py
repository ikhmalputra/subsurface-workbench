"""Build packages/core/src/forge-survey-uncertainty.json: position covariances for the FORGE wells.

No survey report gives a tool error model, but each names its tools. Each run of stations surveyed
with one tool gets the ISCWSA OWSG generic model for that tool type (welleng 0.29.1), tied on to the
covariance at the end of the run above it, so a well surveyed by gyro and then MWD carries both:

  16A(78)-32  the workbook's own tool codes per station (GDR 1283 16A(78)-32 Survey.xlsx):
              GYD_G003_GC+DROP+OH -> CB_Film_GMS; B001Mb_MWD+HRGM -> MWD+SRGM (no OWSG model is
              published for HRGM; the standard-model MWD claims less accuracy, never more)
  16B(78)-32  gyro to 10,400 ft, MWD below (the survey plot: "Tie onto gyro surveys", "Last MWD
              surveys") -> CB_Film_GMS, then MWD+SRGM

Gyro runs use the OWSG generic gyro multishot (CB_Film_GMS), not welleng 0.29.1's GYRO-NS family:
on these surveys those give 120-200 m 1-sigma at TD (against 15 m for MWD), with two terms they
cannot evaluate (a schema gap welleng documents). CB_Film_GMS evaluates cleanly and, being an older
camera-based gyro, claims less accuracy than the modern gyros used here, never more.
  58-32       each printed row's type: MSS -> CB_Film_MSS, MMS -> CB_Film_MMS, MWD -> MWD+SRGM

The magnetic field is the one the 16A workbook reports (49,966.2 nT, dip 64.01°, declination
11.29°). For the record, welleng's own ISCWSA separation factors (k 3.5, sigma_pa 0.5 m, Sm 0.3 m)
of 16A against each neighbour are kept, for the app's implementation to be checked against. Usage:

    .venv/bin/python -I tools/survey/build_forge_survey_uncertainty.py <folder for the 16A workbook (fetched if absent)>
"""

import hashlib
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
import openpyxl
from welleng.clearance import IscwsaClearance
from welleng.survey import Survey, SurveyHeader

ROOT = Path(__file__).resolve().parents[2]
CORE = ROOT / "packages/core/src"
OUT = CORE / "forge-survey-uncertainty.json"
WORKBOOK = {"name": "16a-survey.xlsx", "url": "https://gdr.openei.org/files/1283/16A(78)-32%20Survey.xlsx", "sha": "ad03773329769f702f748c96244a9e1cba16cd1d762d4e8b93b8c8fea9d36b8d"}
FT = 1200 / 3937
FIELD = {"b_total": 49966.2, "dip": 64.01, "declination": 11.29}
TOOLS_16A = {"GYD_G003_GC+DROP+OH": "CB_Film_GMS", "B001Mb_MWD+HRGM": "MWD+SRGM"}
TOOLS_58 = {"MSS": "CB_Film_MSS", "MMS": "CB_Film_MMS", "MWD": "MWD+SRGM", "TieIn": "CB_Film_MSS"}
K, SIGMA_PA, SM = 3.5, 0.5, 0.3
HOLE_8_75 = 8.75 * 0.0254 / 2


def runs(models):
    """Index ranges of consecutive stations with one model; each run after the first starts at the last station of the one above (its tie-on)."""
    out, start = [], 0
    for i in range(1, len(models) + 1):
        if i == len(models) or models[i] != models[start]:
            out.append((models[start] if start > 0 or models[0] != "UNDEFINED" else models[min(1, len(models) - 1)], max(0, start - 1) if out else 0, i - 1))
            start = i
    return out


def header(tie_on):
    return SurveyHeader(latitude=38.504, longitude=-112.896, altitude=1650, survey_date="2020-11-02", b_total=FIELD["b_total"], dip=FIELD["dip"], declination=FIELD["declination"], azi_reference="grid", tie_on=tie_on, depth_unit="meters", surface_unit="meters")


def covariances(md, inc, azi, models):
    """Covariance (N, E, V) at every station, each tool run tied on to the one above."""
    cov = np.zeros((len(md), 3, 3))
    start = None
    for model, i0, i1 in runs(models):
        idx = slice(i0, i1 + 1)
        if i1 <= i0:
            continue
        survey = Survey(md=md[idx], inc=inc[idx], azi=azi[idx], header=header(tie_on=i0 > 0), error_model=model, start_cov_nev=start)
        cov[idx] = survey.cov_nev
        start = survey.cov_nev[-1]
    return cov


def survey(md, inc, azi, cov, nev0, radius):
    return Survey(md=md, inc=inc, azi=azi, header=header(tie_on=False), cov_nev=cov, start_nev=nev0, radius=radius)


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    path = Path(sys.argv[1]) / WORKBOOK["name"]
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(WORKBOOK["url"], timeout=300) as response:
            path.write_bytes(response.read())
    if hashlib.sha256(path.read_bytes()).hexdigest() != WORKBOOK["sha"]:
        sys.exit(f"{path}: SHA-256 does not match the recorded {WORKBOOK['sha']}")
    sheet = openpyxl.load_workbook(path, data_only=True).worksheets[0]
    tool_at_row = {}
    for number, row in enumerate(sheet.iter_rows(values_only=True), start=1):
        values = [cell for cell in row if cell is not None]
        if len(values) >= 13 and isinstance(values[0], int):
            tool_at_row[number] = values[12]

    forge = json.loads((CORE / "forge-data.json").read_text())
    neighbours = json.loads((CORE / "forge-offset-wells.json").read_text())
    a = forge["survey"]
    md_a = np.array([s["mdM"] for s in a]); inc_a = np.array([s["inclinationDeg"] for s in a], float); azi_a = np.array([s["azimuthDeg"] for s in a], float)
    tools_a = [tool_at_row[s["sourceRow"]] for s in a]
    models_a = [TOOLS_16A.get(tool, "UNDEFINED") for tool in tools_a]
    models_a[0] = models_a[1]
    wells = {"forge": (md_a, inc_a, azi_a, models_a)}
    b, w58 = neighbours["wells"]
    md_b = np.array([s[0] for s in b["stations"]]) * FT
    wells["16b"] = (md_b, np.array([s[1] for s in b["stations"]], float), np.array([s[2] for s in b["stations"]], float), ["CB_Film_GMS" if s[0] <= 10400 else "MWD+SRGM" for s in b["stations"]])
    wells["58-32"] = (np.array([s[0] for s in w58["stations"]]) * FT, np.array([s[1] for s in w58["stations"]], float), np.array([s[2] for s in w58["stations"]], float), [TOOLS_58[t] for t in w58["stationTypes"]])

    record = {"source": {"workbook": WORKBOOK, "welleng": "0.29.1", "field": FIELD}, "rule": {"k": K, "sigmaPaM": SIGMA_PA, "surfaceMarginM": SM}, "wells": {}, "checks": {}}
    covs = {}
    for well_id, (md, inc, azi, models) in wells.items():
        cov = covariances(md, inc, azi, models)
        covs[well_id] = cov
        record["wells"][well_id] = {
            "models": [{"model": model, "fromMdM": round(float(md[i0]), 3), "toMdM": round(float(md[i1]), 3)} for model, i0, i1 in runs(models) if i1 > i0],
            "mdM": [round(float(value), 4) for value in md],
            # Upper triangle per station, metres squared: NN, NE, NV, EE, EV, VV.
            "cov": [[round(float(c[i, j]), 6) for i, j in ((0, 0), (0, 1), (0, 2), (1, 1), (1, 2), (2, 2))] for c in cov],
        }

    # welleng's ISCWSA separation factor, 16A against each neighbour, in one frame: north and east from
    # 16A's licensed wellhead, vertical down from 16A's RKB.
    head_a = neighbours["forge16aWellhead"]["asBuilt"]
    rkb_a = 5444 * FT
    hole_a = np.array([(17.5 if m <= 1629 * FT else 12.25 if m <= 5110 * FT else 8.75) * 0.0254 / 2 for m in md_a])
    ref = survey(md_a, inc_a, azi_a, covs["forge"], [0, 0, 0], hole_a)
    placements = {
        "16b": ([b["wellhead"]["asBuilt"]["northingM"] - head_a["northingM"], b["wellhead"]["asBuilt"]["eastingM"] - head_a["eastingM"], rkb_a - b["depthReference"]["elevationFt"] * FT]),
        "58-32": ([w58["wellhead"]["northingM"] - head_a["northingM"], w58["wellhead"]["eastingM"] - head_a["eastingM"], rkb_a - (w58["wellhead"]["groundElevationM"] + w58["depthReference"]["kbAboveGroundFt"] * FT)]),
    }
    for well_id, nev0 in placements.items():
        md, inc, azi, _ = wells[well_id]
        off = survey(md, inc, azi, covs[well_id], nev0, np.full(len(md), HOLE_8_75))
        clearance = IscwsaClearance(ref, off, k=K, sigma_pa=SIGMA_PA, Sm=SM, Rr=hole_a, Ro=np.full(len(md), HOLE_8_75), minimize_sf=False)
        sf = np.asarray(clearance.sf)
        i = int(np.nanargmin(sf))
        record["checks"][well_id] = {"minSf": round(float(sf[i]), 4), "atReferenceMdM": round(float(clearance.ref.md[i]), 2), "startNevM": [round(value, 3) for value in nev0]}
        print(f"16A vs {well_id}: welleng ISCWSA minimum SF {sf[i]:.3f} at 16A MD {clearance.ref.md[i]:.0f} m")
    OUT.write_text(json.dumps(record, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)}: {OUT.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
