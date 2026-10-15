"""Build packages/fixtures/data/sodir-field-production.json: monthly production of every field on the
Norwegian continental shelf, from the Norwegian Offshore Directorate (Sodir) FactPages.

Source: the FactPages table "field_production_monthly" as CSV (NLOD, the Norwegian Licence for
Open Government Data; credit Sodir). Net saleable volumes per field and month: oil, NGL and
condensate in million Sm³, gas in billion Sm³, oil equivalents in million Sm³, produced water in
million Sm³. Every reported month is kept as given; a month the table does not list is not
invented (no zero is filled in). The file is verified by SHA-256: the table is updated daily, so a
newer download changes the hash and the script says so rather than building from it silently.
Usage:

    python3 -I tools/survey/build_sodir_production.py <folder for field_production_monthly.csv> [--accept-new]
"""

import csv
import hashlib
import json
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "packages/fixtures/data/sodir-field-production.json"
URL = "https://factpages.sodir.no/public?/Factpages/external/tableview/field_production_monthly&rs:Command=Render&rc:Toolbar=false&rc:Parameters=f&IpAddress=not_used&CultureCode=en&rs:Format=CSV&Top100=false"
SHA = "583818227ca0a3d073d77fcf65553c0b2098aa8f0fa80900b9f48972ca8280f9"
RETRIEVED = "2026-10-15"
COLUMNS = {
    "oil": "prfPrdOilNetMillSm3", "gas": "prfPrdGasNetBillSm3", "ngl": "prfPrdNGLNetMillSm3",
    "condensate": "prfPrdCondensateNetMillSm3", "oe": "prfPrdOeNetMillSm3", "water": "prfPrdProducedWaterInFieldMillSm3",
}


def main() -> None:
    args = [arg for arg in sys.argv[1:] if not arg.startswith("--")]
    if len(args) != 1:
        sys.exit(__doc__)
    path = Path(args[0]) / "field_production_monthly.csv"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(URL, timeout=300) as response:
            path.write_bytes(response.read())
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != SHA and "--accept-new" not in sys.argv:
        sys.exit(f"{path}: SHA-256 {digest} is not the recorded {SHA}. The table is updated daily; rerun with --accept-new to build from this copy, and record its hash.")
    fields: dict[str, dict] = defaultdict(lambda: {"rows": []})
    with open(path, newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            entry = fields[row["prfInformationCarrier"]]
            entry["npdid"] = int(row["prfNpdidInformationCarrier"])
            month = int(row["prfYear"]) * 12 + int(row["prfMonth"]) - 1
            entry["rows"].append((month, {key: (float(row[column]) if row[column] not in ("", None) else None) for key, column in COLUMNS.items()}))
    out = []
    for name in sorted(fields):
        rows = sorted(fields[name]["rows"])
        out.append({"name": name, "npdid": fields[name]["npdid"], "month": [month for month, _ in rows], **{key: [values[key] for _, values in rows] for key in COLUMNS}})
    record = {
        "source": {"url": URL, "sha256": digest, "retrieved": RETRIEVED, "publisher": "Norwegian Offshore Directorate (Sodir), FactPages", "table": "field_production_monthly"},
        "licence": "NLOD (Norwegian Licence for Open Government Data); the FactPages do not state the version",
        "units": {"oil": "MSm3", "gas": "GSm3", "ngl": "MSm3", "condensate": "MSm3", "oe": "MSm3 o.e.", "water": "MSm3"},
        "note": "Net saleable volume per calendar month; month = year * 12 + (month - 1).",
        "fields": out,
    }
    OUT.write_text(json.dumps(record, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)}: {len(out)} fields, {sum(len(f['month']) for f in out):,} field-months, {OUT.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
