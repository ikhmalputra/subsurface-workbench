"""Build packages/core/src/forge-offset-wells.json: the FORGE wells near 16A(78)-32, for anti-collision.

Sources (all CC BY 4.0, DOE Geothermal Data Repository), verified by SHA-256 before use. A source
missing from the folder is downloaded into it first:

  GDR 1516  16B(78)-32 Well Survey.zip            16B(78)-32 final gyro survey, text report
  GDR 1006  Directional_Survey_well_58_32.zip     58-32 (MU-ESW1) directional survey, PDF only
  GDR 1358  Utah FORGE Well and Seismic Locations.csv   GPS-surveyed wellheads (UGS)
  GDR 1283  U OF U WELL No. FORGE 16A (78)-32 SURVEY FINAL.pdf   licensed as-built wellhead of 16A
  GDR 1516  WELL 16B (78)-32 LOCATION Survey.pdf      licensed as-located wellhead of 16B
  GDR 1006  58-32 DSI sonic LAS, first 16 KB only     its header: drilling measured from KB, KB and GL

The 58-32 survey exists only as a PDF report; its 61 rows are transcribed below exactly as printed.
Every survey is checked by recomputing minimum curvature from MD, inclination and azimuth and
comparing with the TVD and N/E the report prints: a mistyped row cannot pass. Values are kept in the
units the sources give (US survey feet); the app converts with 1200/3937. Usage:

    .venv/bin/python -I tools/survey/build_forge_offset_wells.py <empty directory, or one holding the sources>

pyproj (tools/survey/requirements.lock.txt) converts the licensed NAD83 latitude/longitude to NAD83 /
UTM 12N, the frame every other FORGE position here is in.
"""

import csv
import hashlib
import io
import json
import math
import re
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "packages/core/src/forge-offset-wells.json"
SOURCES = {
    "16b-survey.zip": {
        "url": "https://gdr.openei.org/files/1516/16B(78)-32%20Well%20Survey.zip",
        "sha": "38c59c9452da709fa971448699eb46fb13f452d2aa8c08fbe88fe73f08ce5302",
        "gdr": 1516,
    },
    "58-32-survey.zip": {
        "url": "https://gdr.openei.org/files/1006/Directional_Survey_well_58_32.zip",
        "sha": "b705a123a89ef619c305ee25d42dfbebd34ed2a51f1b39e914acd9f5e14b518d",
        "gdr": 1006,
    },
    "locations.csv": {
        "url": "https://gdr.openei.org/files/1358/Utah%20FORGE%20Well%20and%20Seismic%20Locations.csv",
        "sha": "7bfc9cf730b8521a71a878ab38381a772ea06821e20f07c06c7ee5e3a5351471",
        "gdr": 1358,
    },
    "16a-survey-final.pdf": {
        "url": "https://gdr.openei.org/files/1283/U%20OF%20U%20WELL%20No.%20FORGE%2016A%20(78)-32%20SURVEY%20FINAL.pdf",
        "sha": "15a051818f36be9d3d95d56472151326221fcf52003871961ba425b7c60979ae",
        "gdr": 1283,
    },
    "16b-location.pdf": {
        "url": "https://gdr.openei.org/files/1516/WELL%2016B%20(78)-32%20LOCATION%20Survey.pdf",
        "sha": "23378e6a0dec9f52c1358498ce51e5fce381a978c8a357f44161ada7cae251f5",
        "gdr": 1516,
    },
    "58-32-sonic-head.las": {
        "url": "https://gdr.openei.org/files/1006/D5RL-00187_University%20of%20%20Utah_ME-ESW1_Run1_DSI%20Sonic.las",
        "range": "bytes=0-16383",
        "sha": "c7d6edd538b155b6056519cd438b69fe50e0b44e0c435d513160910eab12bab0",
        "gdr": 1006,
    },
}

# The two licensed surveys (Woolsey Land Surveying, P.L.S. 4938769, 23 Mar 2023), transcribed:
# latitude and longitude in degrees, minutes, seconds (NAD83: 16B's agrees with its NAD83 HARN
# survey report to 1 mm), and NAVD88 elevation in US survey feet.
AS_BUILT = {
    "16A": {"lat": (38, 30, 14.44783), "lon": (112, 53, 47.06681), "elevationFt": 5420.367, "of": "top of the steel wellhead", "source": "16a-survey-final.pdf"},
    "16B": {"lat": (38, 30, 15.64238), "lon": (112, 53, 46.96896), "elevationFt": 5415.65, "of": "top of the steel plate", "source": "16b-location.pdf"},
}
MEMBER_16B = "16B(78)-32 Final Survey Report.txt"
MEMBER_58 = "DirectionalSurveyRpt_171027103004.pdf"

# 58-32 (MU-ESW1), Geothermal Resource Group directional survey report printed 27 Oct 2017, pages 1-2.
# type, MD ft, inclination deg, azimuth deg, TVD ft, N/S ft, E/W ft — as printed.
SURVEY_58_32 = """
TieIn 0.0 0.00 0 0.0 0.0 0.0
MSS 278.0 0.30 20.59 278.0 0.7 0.3
MSS 582.0 0.30 205.9 582.0 0.7 0.2
MSS 868.0 0.40 1 868.0 1.0 -0.1
MSS 1185.0 1.00 346 1185.0 4.8 -0.8
MSS 1471.0 1.00 347 1470.9 9.7 -1.9
MSS 1789.0 1.30 334 1788.9 15.6 -4.1
MSS 2138.0 1.90 24.5 2137.7 24.4 -3.5
MSS 2398.0 1.20 83.8 2397.7 28.7 1.0
MSS 2768.0 0.70 8.7 2767.6 31.3 5.2
MMS 3085.0 1.20 311.6 3084.6 35.4 3.0
MMS 3380.0 1.20 123.4 3379.6 35.8 3.3
MMS 3697.0 1.70 220 3696.5 30.4 3.0
MMS 3976.0 3.80 253.9 3975.2 24.6 -8.5
MMS 4293.0 6.30 255.8 4290.9 17.4 -35.5
MMS 4569.0 6.80 253.8 4565.1 9.2 -65.8
MWD 4603.0 7.56 272.33 4598.9 8.7 -70.0
MWD 4667.0 6.90 275.84 4662.3 9.3 -78.0
MWD 4739.0 6.95 272.2 4733.8 9.9 -86.7
MWD 4771.0 6.90 271.98 4765.6 10.0 -90.5
MWD 4803.0 7.21 271.45 4797.3 10.1 -94.5
MWD 4833.0 7.16 274.26 4827.1 10.3 -98.2
MWD 4865.0 6.68 276.37 4858.9 10.7 -102.1
MWD 4897.0 5.85 277.34 4890.7 11.1 -105.5
MWD 4928.0 5.27 278.13 4921.5 11.5 -108.5
MWD 4960.0 4.62 273.91 4953.4 11.8 -111.2
MWD 4992.0 3.82 265.82 4985.3 11.8 -113.6
MWD 5024.0 2.99 260.37 5017.3 11.6 -115.5
MWD 5055.0 2.11 250.53 5048.2 11.2 -116.8
MWD 5087.0 1.54 251.5 5080.2 10.9 -117.8
MWD 5119.0 1.76 267.32 5112.2 10.8 -118.7
MWD 5151.0 1.76 281.9 5144.2 10.8 -119.6
MWD 5183.0 1.63 295.97 5176.2 11.1 -120.5
MWD 5214.0 1.49 295.97 5207.2 11.5 -121.3
MWD 5246.0 1.01 277.51 5239.2 11.7 -122.0
MWD 5278.0 1.01 251.7 5271.2 11.7 -122.5
MWD 5310.0 1.49 241.83 5303.2 11.4 -123.1
MWD 5341.0 1.63 243.5 5334.1 11.0 -123.9
MWD 5373.0 1.27 231.37 5366.1 10.6 -124.6
MWD 5405.0 0.62 203.24 5398.1 10.2 -124.9
MSS 5679.0 0.70 136.6 5672.1 7.6 -124.3
MSS 5872.0 1.50 316.2 5865.1 8.6 -125.3
MSS 6062.0 1.80 346.6 6055.0 13.3 -127.7
MSS 6345.0 2.40 350 6337.8 23.4 -129.8
MSS 6478.0 2.50 334.9 6470.7 28.8 -131.5
MSS 6605.0 2.60 287.3 6597.6 32.2 -135.4
MSS 6730.0 3.80 274.1 6722.4 33.3 -142.2
MWD 6767.0 3.87 279.53 6759.3 33.6 -144.7
MWD 6798.0 4.18 276.37 6790.2 33.9 -146.8
MWD 6830.0 3.69 281.12 6822.2 34.2 -149.0
MWD 6862.0 3.12 280.59 6854.1 34.6 -150.9
MWD 6894.0 2.24 277.16 6886.1 34.8 -152.4
MWD 6926.0 1.58 265.03 6918.1 34.9 -153.4
MWD 6989.0 0.92 260.81 6981.0 34.7 -154.8
MWD 7021.0 1.14 281.2 7013.0 34.7 -155.3
MWD 7053.0 1.10 295.1 7045.0 34.9 -155.9
MWD 7084.0 1.19 276.11 7076.0 35.1 -156.5
MWD 7116.0 1.14 274.88 7108.0 35.1 -157.2
MWD 7357.0 1.80 274 7348.9 35.6 -163.3
"""


def fetch(folder: Path) -> None:
    for name, meta in SOURCES.items():
        target = folder / name
        if not target.exists():
            request = urllib.request.Request(meta["url"], headers={"Range": meta["range"]} if "range" in meta else {})
            with urllib.request.urlopen(request, timeout=300) as response:
                target.write_bytes(response.read())
            print(f"fetched {name}: {target.stat().st_size:,} bytes")
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        if digest != meta["sha"]:
            sys.exit(f"{name}: SHA-256 {digest} does not match the recorded {meta['sha']}")


def minimum_curvature(rows):
    """TVD, north, east at each station from MD, inclination, azimuth (same length unit as MD)."""
    out = [(0.0, 0.0, 0.0)]
    for (md0, i0, a0), (md1, i1, a1) in zip(rows, rows[1:]):
        i0, a0, i1, a1 = map(math.radians, (i0, a0, i1, a1))
        cos_dl = math.cos(i1 - i0) - math.sin(i0) * math.sin(i1) * (1 - math.cos(a1 - a0))
        dl = math.acos(max(-1.0, min(1.0, cos_dl)))
        rf = 1.0 if dl < 1e-9 else 2 / dl * math.tan(dl / 2)
        half = (md1 - md0) / 2
        tvd, n, e = out[-1]
        out.append((
            tvd + half * (math.cos(i0) + math.cos(i1)) * rf,
            n + half * (math.sin(i0) * math.cos(a0) + math.sin(i1) * math.cos(a1)) * rf,
            e + half * (math.sin(i0) * math.sin(a0) + math.sin(i1) * math.sin(a1)) * rf,
        ))
    return out


def check(label, rows, reported, tolerance):
    computed = minimum_curvature([(md, inc, azi) for md, inc, azi, *_ in rows])
    worst = max(max(abs(c - r) for c, r in zip(point, report)) for point, report in zip(computed, reported))
    if worst > tolerance:
        sys.exit(f"{label}: recomputed survey differs from the report by {worst:.3f} ft (> {tolerance})")
    return worst


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    folder = Path(sys.argv[1])
    folder.mkdir(parents=True, exist_ok=True)
    fetch(folder)

    # 16B(78)-32: the text report, header and stations.
    text = zipfile.ZipFile(folder / "16b-survey.zip").read(MEMBER_16B).decode("latin-1")
    header = dict((key.strip(), value.strip()) for key, value in re.findall(r"^([A-Z][A-Z ]+?)\s*:\s*(.+)$", text, re.M))
    feet = lambda key: float(header[key].rstrip("ft").strip())
    rows_16b = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) == 11 and re.fullmatch(r"-?\d+\.\d+", parts[0]):
            md, inc, azi, tvd, _sstvd, ns, _northing, ew = map(float, parts[:8])
            rows_16b.append((md, inc, azi, tvd, ns, ew))
    worst_16b = check("16B(78)-32", rows_16b, [(tvd, ns, ew) for *_, tvd, ns, ew in rows_16b], 0.06)

    # 58-32: the transcribed PDF table.
    rows_58 = []
    types_58 = []
    for line in SURVEY_58_32.strip().splitlines():
        kind, *values = line.split()
        md, inc, azi, tvd, ns, ew = map(float, values)
        rows_58.append((md, inc, azi, tvd, ns, ew))
        types_58.append(kind)
    worst_58 = check("58-32", rows_58, [(tvd, ns, ew) for *_, tvd, ns, ew in rows_58], 0.16)

    # Wellheads: the UGS GPS survey of the pads.
    with open(folder / "locations.csv", newline="", encoding="utf-8-sig") as handle:
        table = list(csv.reader(handle))
    crs_note = table[0][0]
    heads = {row[0]: row for row in table[3:] if row and row[0].endswith("-WELL")}
    gps = lambda pid: {"eastingM": float(heads[pid][1]), "northingM": float(heads[pid][2]), "groundElevationM": float(heads[pid][5]), "source": f"GDR 1358 GPS survey, point {pid}"}

    # 58-32's depth reference, from its log header: drilling measured from KB; KB and GL elevations.
    las = (folder / "58-32-sonic-head.las").read_text(encoding="latin-1")
    field = lambda key: re.search(rf"^{key}\s*\.\S*\s+(\S+)", las, re.M).group(1)
    if field("DMF") != "KB":
        sys.exit(f"58-32: drilling measured from {field('DMF')}, expected KB")
    kb_58, gl_58 = float(field("EKB")), float(field("EGL"))
    dms = lambda d, m, s: d + m / 60 + s / 3600
    from pyproj import Transformer
    to_utm = Transformer.from_crs("EPSG:4269", "EPSG:26912", always_xy=True)
    utm = lambda value: to_utm.transform(-dms(*value["lon"]), dms(*value["lat"]))
    as_built = {key: {"eastingM": round(utm(value)[0], 3), "northingM": round(utm(value)[1], 3), "latitude": dms(*value["lat"]), "longitude": -dms(*value["lon"]), "elevationFt": value["elevationFt"], "of": value["of"], "source": f"GDR {SOURCES[value['source']]['gdr']} · {value['source']} (Woolsey Land Surveying, 23 Mar 2023)"} for key, value in AS_BUILT.items()}

    record = {
        "licence": "CC-BY-4.0",
        "note": "Survey values are as reported, in US survey feet and degrees; convert with 1200/3937 m per ft.",
        "sources": {name: {"url": meta["url"], "sha256": meta["sha"], "gdr": meta["gdr"]} for name, meta in SOURCES.items()},
        "gpsCrs": crs_note,
        "forge16aWellhead": {"gps": gps("16A-32-WELL"), "asBuilt": as_built["16A"]},
        "wells": [
            {
                "id": "16b", "label": "16B(78)-32",
                "source": f"GDR 1516 · {MEMBER_16B}",
                "surveyDate": header.get("DATE"), "surveyKind": "post-drilling gyro survey (submission description); tool error model not reported",
                "crs": f"{header['GEODIC DATUM']} · {header['MAP SYSTEM']} · {header['MAP ZONE']}", "north": header["NORTH REF"].lower(),
                "wellhead": {"eastingFt": feet("WELL EASTING"), "northingFt": feet("WELL NORTHING"), "source": "GDR 1516 survey report header", "asBuilt": as_built["16B"]},
                "depthReference": {"kind": "KB", "elevationFt": feet("KB ELEV"), "groundElevationFt": feet("GL ELEV")},
                "check": f"minimum curvature recomputed within {worst_16b:.3f} ft of the reported TVD, N and E",
                "stations": [[md, inc, azi] for md, inc, azi, *_ in rows_16b],
            },
            {
                "id": "58-32", "label": "58-32 (MU-ESW1)",
                "source": f"GDR 1006 · {MEMBER_58}, transcribed from the printed table",
                "surveyDate": "report printed 27 Oct 2017", "surveyKind": "MSS, MMS and MWD stations as typed per row; tool error model not reported",
                "crs": "not reported (local N/E offsets from the wellhead)", "north": "not reported",
                "wellhead": gps("58-32-WELL"),
                "depthReference": {"kind": "KB", "kbAboveGroundFt": round(kb_58 - gl_58, 3), "headerKbFt": kb_58, "headerGlFt": gl_58, "source": "GDR 1006 DSI sonic LAS header (DMF KB, EKB, EGL)"},
                "check": f"minimum curvature recomputed within {worst_58:.3f} ft of the printed TVD, N and E (printed to 0.1 ft)",
                "stationTypes": types_58,
                "stations": [[md, inc, azi] for md, inc, azi, *_ in rows_58],
            },
        ],
    }
    OUT.write_text(json.dumps(record, indent=1) + "\n", encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)}: 16B {len(rows_16b)} stations (worst {worst_16b:.3f} ft), 58-32 {len(rows_58)} stations (worst {worst_58:.3f} ft), {OUT.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
