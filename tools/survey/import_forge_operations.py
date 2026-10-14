"""Rebuild FORGE 16A(78)-32 operational records from pinned public sources.

Writes packages/core/src/forge-operations.json and the 10 ft mud-log LAS used
by the demo. Every service-run figure must appear in the cited report section;
daily records are parsed from the daily-operations PDF text without editing.
"""
import hashlib
import json
import re
from datetime import date, datetime
from pathlib import Path

from pypdf import PdfReader

root = Path(__file__).resolve().parents[2]
summary_path = Path("/tmp/subsurface-forge16a-summary.pdf")
daily_path = Path("/tmp/subsurface-forge16a-daily.pdf")
mudlog_path = Path("/tmp/subsurface-forge16a-mudlog.las")
HASHES = {
    summary_path: "2b1886f8fceb8c83cbbb524bc27beaeb2e832116b4496bdf53cfa26bc65cdceb",
    daily_path: "12f911d3b2092671ac054fb4b14fb3f23a9aff485d8c3016a9d834d929391531",
    mudlog_path: "3883add7fe1a6ab745b32b059f191ff519b895be2008409bf87fec60ec84acde",
}
for path, digest in HASHES.items():
    assert hashlib.sha256(path.read_bytes()).hexdigest() == digest, path

SUMMARY_URL = "https://gdr.openei.org/files/1296/Drilling%20Summary%20Well%2016A(78)-32.pdf"
DAILY_URL = "https://gdr.openei.org/files/1283/Composite-C%20(1).pdf"
MUDLOG_URL = "https://gdr.openei.org/files/1283/16A(78)-32%20Final%20mud%20log.las"
FT = 0.3048


def norm(text):
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r" (['\"°%])", r"\1", text)
    text = re.sub(r"([#(]) ", r"\1", text)
    text = re.sub(r" ([,.;:)])", r"\1", text)
    return text.replace("’", "'")


# --- Service runs (drilling summary, GDR 1296) --------------------------------
summary_pages = [page.extract_text() or "" for page in PdfReader(summary_path).pages]
summary_text = ""
page_starts = []
for number, text in enumerate(summary_pages, 1):
    page_starts.append((len(summary_text), number))
    summary_text += text + "\n"
body_start = summary_text.find("III.1 Drilling BHA 01", summary_text.find("III.1 Drilling BHA 01") + 1)
assert body_start > 0


def locate(heading):
    index = summary_text.find(heading, body_start)
    assert index >= 0, heading
    page = [number for offset, number in page_starts if offset <= index][-1]
    return index, page


def section(heading, length=3200):
    index, page = locate(heading)
    return norm(summary_text[index:index + length]), page


# (id, kind, hole section, heading, top ft, base ft, footage ft, avg ROP fph, outcome, summary, evidence)
RUNS = [
    ("BHA 01", "drilling", "surface", "III.1 Drilling BHA 01", 28, 1629, 1601, 134, "completed", "17 1/2 in surface hole drilled; 13 3/8 in casing run and cemented, floats failed.", ["134", "1,629"]),
    ("BHA 02", "drilling", "intermediate", "IV.1 Drilling BHA 02", 1605, 1605, None, None, "failed", "Could not drill the surface float equipment with the PDC/RSS assembly.", ["1,605"]),
    ("BHA 03", "drilling", "intermediate", "IV.2 Drilling BHA 03", 1605, 1644, 39, None, "completed", "Drilled out the shoe track and new formation; FIT 9.5 ppg.", ["1,644", "9.5"]),
    ("BHA 04", "drilling", "intermediate", "IV.3 Drilling BHA 04", 1644, 4552, 2908, 49, "completed", "12 1/4 in intermediate hole; pulled for low ROP.", ["2,908", "49"]),
    ("BHA 05", "drilling", "intermediate", "IV.4 Drilling BHA 05", 4552, 4964, 412, 14, "completed", "Entered granitoid basement; pulled for progressively lower ROP.", ["412", "14"]),
    ("BHA 06", "drilling", "intermediate", "IV.5 Drilling BHA 06", 4964, 5113, 149, 9, "completed", "Drilled to intermediate casing point.", ["149", "9 fph"]),
    ("BHA 07", "survey", "intermediate", "IV.6 BHA 07: Gyro BHA", None, 5113, None, None, "completed", "Gyro survey; 9 5/8 in casing then run to 5,110 ft (plug not bumped).", ["Gyro"]),
    ("BHA 09", "drilling", "production", "V.1 Drilling BHA 09", 5113, 5345, 232, 13, "completed", "Shoe drilled out with BHA 08; 8 3/4 in production hole begun, FIT 9.6 ppg EMW.", ["232", "9.6"]),
    ("BHA 10", "drilling", "production", "V.2 Drilling BHA 10", 5345, 5473, 124, 13, "completed", "Vertical production hole ahead of coring.", ["124 ft", "13 fph"]),
    ("BHA 11", "coring", "production", "V.4 Coring BHA 11", 5473, 5494, 21, None, "completed", "Core 1: 21 ft cut, 15.5 ft recovered.", ["15.5"]),
    ("BHA 12", "coring", "production", "V.5 Coring BHA 12", 5494, 5504, 10, None, "problem", "Core 2: 10 ft cut, 1.2 ft recovered.", ["1.2"]),
    ("BHA 13", "survey", "production", "V.6 Temperature Survey BHA 13", None, 5504, None, None, "completed", "Temperature build-up survey near bottom.", ["5,499"]),
    ("BHA 14", "drilling", "production", "V.7 Drilling BHA 14", 5504, 5846, 342, 8.7, "problem", "Vertical granite drilling; bit severely damaged.", ["342", "8.7"]),
    ("BHA 15", "coring", "production", "V.8 Coring BHA 15", 5846, 5856, 10, None, "completed", "Core 3: 10 ft cut, 8.8 ft recovered.", ["8.8"]),
    ("BHA 16", "cleanout", "production", "V.9 Drilling BHA 16", 5856, 5858, 2, None, "completed", "Cleaned out the hole for the next core run.", ["5,858"]),
    ("BHA 17", "coring", "production", "V.10 Coring BHA 17", 5858, 5892, 34, None, "completed", "Core 4: 34 ft cut, 31.5 ft recovered; kickoff point at 5,892 ft.", ["31.5"]),
    ("BHA 18", "drilling", "production", "VI.1 Drilling BHA 18", 5892, 6360, 468, 34, "completed", "Kicked off and built the curve.", ["468", "34"]),
    ("BHA 19", "cooldown", "production", "VI.2 Cooldown BHA 19", None, None, None, None, "completed", "Cooldown trip.", ["BHA 19"]),
    ("BHA 20", "cooldown", "production", "VI.3 Cooldown BHA 20", None, None, None, None, "completed", "Cooldown trip.", ["BHA 20"]),
    ("BHA 21", "drilling", "production", "VI.4 Drilling BHA 21", 6360, 6526, 166, 33, "problem", "Curve drilling; became geometrically stuck while sliding.", ["166", "geometrically stuck"]),
    ("BHA 22", "drilling", "production", "VI.5 Drilling BHA 22", 6526, 6945, 419, 23, "completed", "Curve drilling.", ["419", "23"]),
    ("BHA 23", "drilling", "production", "VI.6 Drilling BHA 23", 6945, 7390, 444, 27, "completed", "Curve drilling to 7,262 ft, continued to 7,390 ft (report section VII.1).", ["444 ft", "27 fph"]),
    ("BHA 24", "reaming", "production", "VII.2 Reaming BHA 24", 5634, 7390, None, None, "completed", "Reamed the curve.", ["5,634"]),
    ("BHA 25", "survey", "production", "VII.3 BHA 25 Gyro Assembly", None, 7390, None, None, "completed", "Gyro survey.", ["Gyro"]),
    ("BHA 26", "cooldown", "production", "VII.4 BHA 26 Cooldown", None, None, None, None, "completed", "Cooldown before logging.", ["BHA 26"]),
    ("BHA 27", "cooldown", "production", "VII.5 BHA 27 Cooldown", None, None, None, None, "completed", "Cooldown before the extended leak-off test.", ["BHA 27"]),
    ("BHA 28", "test", "production", "VII.6 BHA 28 XLOT", None, 7325, None, None, "problem", "XLOT 1: packer at 7,325 ft would not shift.", ["7,325"]),
    ("BHA 29", "cleanout", "production", "VII.7 BHA 29 Cleanout", 7389, 7390, 1, None, "completed", "Cleaned out packer debris.", ["7390"]),
    ("BHA 30", "drilling", "production", "VII.8 Drilling BHA 30", 7390, 8024, 634, 31, "completed", "Tangent drilling.", ["634", "31"]),
    ("BHA 31", "cooldown", "production", "VII.8 BHA 31: Cooldown", None, None, None, None, "completed", "Cooldown trip.", ["BHA 31"]),
    ("BHA 32", "test", "production", "VII.9 BHA 32. XLOT Run 2", None, 7974, None, None, "failed", "XLOT 2: packer at 7,974 ft failed; elements lost in hole.", ["7,974"]),
    ("BHA 33", "fishing", "production", "VII.9 BHA 33. Milling/Fishing", None, None, None, None, "completed", "Milled and fished packer debris.", ["BHA 33"]),
    ("BHA 34", "drilling", "production", "VII.10 Drilling BHA 34", 8024, 8241, 217, 41, "completed", "Tangent drilling.", ["217", "41"]),
    ("BHA 35", "drilling", "production", "VII.11 Drilling BHA 35", 8241, 8535, 294, 55, "completed", "Tangent drilling.", ["294", "55"]),
    ("BHA 36", "test", "production", "VII.12  BHA 36 XLOT Run 3", None, 8458, None, None, "failed", "XLOT 3: packer at 8,458 ft did not seal.", ["8,458"]),
    ("BHA 37", "cooldown", "production", "VII.13  Cooldown BHA 37", None, 8535, None, None, "completed", "Two cooldown runs; UBI conveyed to 8,535 ft.", ["BHA 37"]),
    ("BHA 38", "drilling", "production", "VII.15 Drilling BHA 38", 8535, 9064, 529, 48, "completed", "Tangent drilling.", ["529", "48"]),
    ("BHA 39", "drilling", "production", "VII.16  Drilling BHA 39", 9064, 9748, 684, 41, "completed", "Tangent drilling.", ["684", "41"]),
    ("BHA 40", "reaming", "production", "VII.17 BHA 40: Reamer Run", 7225, 9748, None, None, "completed", "Reamer run; lubricant beads removed.", ["7,225"]),
    ("BHA 41", "drilling", "production", "VII.18 Drilling BHA 41", 9748, 10490, 742, 47, "completed", "Tangent drilling.", ["742", "47"]),
    ("BHA 42", "drilling", "production", "Drilling BHA 42: 10,490", 10490, 10955, 465, 53, "completed", "Drilled to directional TD.", ["465", "53"]),
    ("BHA 43", "survey", "production", "VII.20 Gyro BHA 43", None, 10955, None, None, "completed", "Gyro survey from TD.", ["Gyro"]),
    ("BHA 44", "coring", "production", "VII.21  Coring BHA 44", None, 10955, None, None, "failed", "Tripped out for torque and hole drag; no core cut.", ["Torque"]),
    ("BHA 45", "reaming", "production", "VII.22  Reamer BHA 45", None, None, None, None, "completed", "Clean-out reamer run.", ["BHA 45"]),
    ("BHA 46", "cleanout", "production", "VII.23 Reamer BHA 46", 8648, 9350, None, None, "completed", "Clean-out run.", ["BHA 46"]),
    ("BHA 47", "coring", "production", "VII.24  Coring BHA 47", 10955, 10971, 16, None, "completed", "Core 5: 16 ft cut, 7.2 ft recovered.", ["7.2"]),
    ("BHA 48", "cleanout", "production", "VII.25 Clean Out BHA 48", 10971, 10973, 2, None, "completed", "Cleaned out to bottom.", ["10,973"]),
    ("BHA 49", "coring", "production", "VII.26 Coring BHA 49", 10973, 10987, 14, None, "completed", "Core 6: 14 ft cut, 10.2 ft recovered; well TD 10,987 ft.", ["10.2"]),
    ("BHA 50", "reaming", "production", "VII.27 Reamer BHA 50", None, None, None, None, "completed", "Clean-out reamer run with gyro.", ["BHA 50"]),
    ("BHA 51", "cooldown", "production", "VII.29 Cool Down BHA 51", None, None, None, None, "completed", "Cooldown and drift run before logging.", ["BHA 51"]),
    ("BHA 52-53", "logging", "production", "VII.30 Log Well with Schlumberger BHA 52 and 53", None, 10987, None, None, "problem", "ThruBit quad-combo and FMI; density failed, FMI rerun on BHA 53.", ["FMI"]),
    ("BHA 54", "plugback", "production", "VII.31 BHA 54: Plug Back", 10787, 10987, None, None, "completed", "Sand plug back to 10,787 ft; 7 in casing run and cemented.", ["10,787"]),
    ("BHA 55", "milling", "production", "VIII.1 Drill Out BHA 55", None, None, None, None, "completed", "Drilled out after cementing.", ["BHA 55"]),
    ("BHA 56", "milling", "production", "VIII.2 Mill BHA 56", None, None, None, None, "completed", "Tapered mill run before DFIT.", ["Tapered"]),
]

runs = []
for run_id, kind, hole, heading, top, base, footage, rop, outcome, summary, evidence in RUNS:
    text, page = section(heading)
    for needle in evidence:
        assert needle in text, (run_id, needle)
    runs.append({
        "id": run_id, "kind": kind, "holeSection": hole, "page": page, "sourceHeading": norm(heading),
        "topFt": top, "baseFt": base,
        "topM": None if top is None else round(top * FT, 2), "baseM": None if base is None else round(base * FT, 2),
        "footageFt": footage, "avgRopFph": rop, "outcome": outcome, "summary": summary,
    })

# --- Daily operations (GDR 1283) ----------------------------------------------
daily_pages = [page.extract_text() or "" for page in PdfReader(daily_path).pages]
daily_text = ""
daily_starts = []
for number, text in enumerate(daily_pages, 1):
    daily_starts.append((len(daily_text), number))
    daily_text += re.sub(r"^WELL:\nFORGE 16A \[78\]-32\n", "", text) + "\n"
day_pattern = re.compile(r"(?:^|\n)((?:Oct|Nov|Dec|Jan) +\d{1,2} 20\d\d)\nMD:\n")
matches = list(day_pattern.finditer(daily_text))


def number(text):
    text = text.strip().replace(",", "")
    return float(text) if re.fullmatch(r"\d+(\.\d+)?", text) else None


CATEGORY_RULES = [
    ("casing", r"CASING|LINER|CEMENT|WAITING ON CEMENT|PLACE SAND|CASING POINT"),
    ("logging", r"LOG"),
    ("coring", r"COR(E|ING)"),
    ("testing", r"TEST|PACKER|LEAK ?OFF|XLOT|DFIT"),
    ("rig", r"RIGGING UP|RIG UP|MOVE IN|MOVING IN|RIGGING DOWN"),
    ("drilling", r"DRILL(ING)? (AHEAD|\d|12|8|TANGENT|CURVE)|BUILDING CURVE|DRILLING \d|DRILLING CURVE|DRILLING$|DRILLING AT"),
    ("tripping", r"TRIP|PIPE FREE|BHA|LAYING DOWN"),
    ("circulating", r"CIRCULAT|COOL|REAM|WASH|CLEAN"),
    ("rig", r"RIG|MOVE IN|NIPPL|NUBOPE|BOP|MUD|PRESSURE MUD|PREPARE TO SPUD|SURFACE CASING ON PIPE"),
    ("repair", r"REPAIR"),
]


def category(headline):
    upper = headline.upper()
    for name, pattern in CATEGORY_RULES:
        if re.search(pattern, upper):
            return name
    return "other"


days = []
for i, match in enumerate(matches):
    end = matches[i + 1].start() if i + 1 < len(matches) else len(daily_text)
    body = daily_text[match.end():end]
    page = [n for offset, n in daily_starts if offset <= match.start() + 1][-1]
    head = re.match(r"(.*?)TVD:\n(.*?)FOOTAGE:\n(.*?)MW:\n(.*?)\nLB", body, re.S)
    ops = re.search(r"PRESENT OPERATIONS:\n(.*?)(?:\nACTIVITY PLANNED:\n(.*))?$", body, re.S)
    lines = ops.group(1).split("\n")
    headline_lines = [lines[0]]
    k = 1
    while k < len(lines) and (headline_lines[-1].endswith(" ") or re.fullmatch(r"[\d,.' \"°]+", lines[k].strip())):
        headline_lines.append(lines[k])
        k += 1
    headline = norm(" ".join(headline_lines))
    activities = [re.sub(r"^PJSM,? pre job safety meeting[ .,]*", "", norm(a), flags=re.I) for a in " ".join(lines[k:]).split(";")]
    activities = [a for a in activities if a]
    planned = norm(re.sub(r"=== P\d+.*", "", ops.group(2) or "", flags=re.S))
    when = datetime.strptime(norm(match.group(1)), "%b %d %Y").date()
    md = number(head.group(1))
    days.append({
        "date": when.isoformat(), "page": page,
        "mdFt": md, "mdM": None if md is None else round(md * FT, 2),
        "tvdFt": number(head.group(2)), "footageFt": number(head.group(3)), "mudWeightPpg": number(head.group(4)) or None,
        "category": category(headline), "headline": headline, "activities": activities, "planned": planned,
    })
assert len(days) == 76 and days[0]["date"] == "2020-10-20" and days[-1]["date"] == "2021-01-03", (len(days), days[-1]["date"])
assert len({d["date"] for d in days}) == 76
spud = date(2020, 10, 30)
for day in days:
    day["dayFromSpud"] = (date.fromisoformat(day["date"]) - spud).days

# --- Milestones (drilling summary) --------------------------------------------
milestones = []
for event_id, label, when, md, needle in [
    ("spud", "Spud", "2020-10-30", 28, "October 30, 2020"),
    ("rig-release", "Rig released", "2021-01-12", None, "January 12, 2021"),
]:
    page = 7
    assert needle in norm(summary_pages[page - 1]), needle
    milestones.append({"id": event_id, "label": label, "date": when, "mdFt": md, "page": page, "source": "summary"})
for event_id, label, when, md in [
    ("surface-casing", "Surface casing point", "2020-10-31", 1629),
    ("intermediate-casing", "Intermediate casing point", "2020-11-11", 5113),
    ("kickoff", "Kickoff (curve begins)", "2020-11-24", 5892),
    ("directional-td", "Directional TD", "2020-12-19", 10955),
    ("well-td", "Well TD after final core", "2020-12-24", 10987),
]:
    day = next(d for d in days if d["date"] == when)
    milestones.append({"id": event_id, "label": label, "date": when, "mdFt": md, "page": day["page"], "source": "daily"})

# --- Hole sections ------------------------------------------------------------
SECTIONS = [
    ("surface", "Surface", 17.5, 28, 1629, "13 3/8 in L80 68 lb/ft BTC to 1,629 ft", "surface-hole", "surface-casing"),
    ("intermediate", "Intermediate", 12.25, 1629, 5113, "9 5/8 in HCL80 40 lb/ft to 5,110 ft", "intermediate-hole", "intermediate-casing"),
    ("production", "Production", 8.75, 5113, 10987, "7 in T95 38 lb/ft JFELION to 10,787 ft", "production-hole", "production-casing"),
]
sections = []
for section_id, name, bit, top, base, casing, hole_component, casing_component in SECTIONS:
    in_section = [r for r in runs if r["holeSection"] == section_id]
    drilled = [r for r in in_section if r["kind"] in ("drilling", "coring") and r["footageFt"]]
    hours = [r["footageFt"] / r["avgRopFph"] for r in drilled if r["avgRopFph"]]
    timed = sum(r["footageFt"] for r in drilled if r["avgRopFph"])
    dated = [d for d in days if d["mdFt"] and top < d["mdFt"] <= base]
    sections.append({
        "id": section_id, "name": name, "bitSizeIn": bit, "topFt": top, "baseFt": base,
        "topM": round(top * FT, 2), "baseM": round(base * FT, 2), "casing": casing,
        "holeComponentId": hole_component, "casingComponentId": casing_component,
        "runCount": len(in_section), "problemRuns": sum(r["outcome"] != "completed" for r in in_section),
        "drilledFt": sum(r["footageFt"] for r in drilled),
        "avgRopFph": round(timed / sum(hours), 1) if hours else None,
        "firstDate": dated[0]["date"] if dated else None, "lastDate": dated[-1]["date"] if dated else None,
    })

# --- Mud log: 10 ft bin means -------------------------------------------------
raw = mudlog_path.read_text(encoding="latin-1")
rows = []
for line in raw.split("~A", 1)[1].splitlines()[1:]:
    values = line.split()
    if values:
        rows.append([float(v) for v in values])
KEEP = [("DEPTH", "ft", "Depth (10 ft bin top)", 0), ("ROP", "ft/h", "Penetration rate", 1), ("WOB", "klbf", "Weight on bit", 2),
        ("RPM", "rev/min", "Rotary speed", 13), ("TORQUE", "lbf.ft", "Torque", 14), ("PP", "psi", "Pump pressure", 6),
        ("FLOWIN", "gal/min", "Flow in", 10), ("TEMPIN", "", "Temperature in (unit not declared)", 4), ("TEMPOUT", "", "Temperature out (unit not declared)", 5)]
bins = {}
for row in rows:
    bins.setdefault(int(row[0] // 10 * 10), []).append(row)
out_rows = []
for top in sorted(bins):
    group = bins[top]
    record = [top]
    for _, _, _, column in KEEP[1:]:
        values = [r[column] for r in group if r[column] != -999.25]
        record.append(round(sum(values) / len(values), 1) if values else -999.25)
    out_rows.append(record)
las = [
    "~VERSION INFORMATION",
    " VERS.                 2.0 : CWLS LOG ASCII STANDARD - VERSION 2.0",
    " WRAP.                  NO : ONE LINE PER DEPTH STEP",
    "~WELL INFORMATION",
    f" STRT.ft          {out_rows[0][0]:>8} : START DEPTH",
    f" STOP.ft          {out_rows[-1][0]:>8} : STOP DEPTH",
    " STEP.ft                10 : STEP",
    " NULL.             -999.25 : NULL VALUE",
    " COMP.           UtahForge : COMPANY",
    " WELL.         16A (78)-32 : WELL",
    " FLD.          Milford, UT : FIELD",
    " SRVC.  Horizon Well Logging, Inc. : SERVICE COMPANY",
    " DATE.          2020-12-24 : SOURCE PREPARED",
    "~CURVE INFORMATION",
    *[f" {m}.{u:<10} : {d}" for m, u, d, _ in KEEP],
    "~PARAMETER INFORMATION",
    f" SRC.  {MUDLOG_URL} : SOURCE FILE",
    f" SHA.  {HASHES[mudlog_path]} : SOURCE SHA-256",
    " DCM.  MEAN OF 1 FT SAMPLES IN [DEPTH, DEPTH+10) FT, NULLS EXCLUDED : DECIMATION",
    " LIC.  CC-BY-4.0 : LICENSE",
    "~A " + " ".join(m for m, _, _, _ in KEEP),
    *[" ".join(str(int(v)) if i == 0 else f"{v:g}" for i, v in enumerate(r)) for r in out_rows],
]
las_path = root / "packages/fixtures/data/forge-16a-mudlog-10ft.las"
las_path.parent.mkdir(parents=True, exist_ok=True)
las_path.write_text("\n".join(las) + "\n")

data = {
    "wellId": "utah-forge-16a-2021",
    "license": "CC-BY-4.0",
    "attribution": "Winkler, Swearingen and McLennan (2021), GDR 1296; Utah FORGE daily operations and Horizon Well Logging mud log, GDR 1283. Energy and Geoscience Institute, University of Utah.",
    "sources": {
        "summary": {"url": SUMMARY_URL, "sha256": HASHES[summary_path], "title": "Drilling Summary Well 16A(78)-32"},
        "daily": {"url": DAILY_URL, "sha256": HASHES[daily_path], "title": "Summary of Daily Operations, 20 Oct 2020 to 3 Jan 2021"},
        "mudlog": {"url": MUDLOG_URL, "sha256": HASHES[mudlog_path], "title": "16A(78)-32 Final mud log (LAS 2.0)"},
    },
    "notes": [
        "Daily records are machine-extracted from the PDF text layer; wording is the operator's, whitespace normalised and PJSM-only items dropped.",
        "Daily categories are derived from the headline by keyword rules in tools/survey/import_forge_operations.py.",
        "Service-run figures are text-stated values; each was checked against the cited report section. Bit grades and per-run dates sit in report images and are not transcribed.",
        "Run footage is the stated value; where none is stated it is base minus top. Section average ROP is footage-weighted over runs with a stated ROP.",
    ],
    "milestones": sorted(milestones, key=lambda m: m["date"]),
    "days": days,
    "runs": runs,
    "sections": sections,
}
(root / "packages/core/src/forge-operations.json").write_text(json.dumps(data, indent=1) + "\n")
print(len(days), "days", len(runs), "runs", len(out_rows), "log rows")
