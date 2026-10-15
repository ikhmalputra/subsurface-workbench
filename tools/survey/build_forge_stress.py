"""Build packages/core/src/forge-58-32-stress.json: the calibrated stress profile of FORGE well 58-32.

Source: GDR 1032, "58-32 stress logging data.xlsx" (CC BY 4.0), sheet "logging": measured depth
(ft, from 58-32's KB) with SHmax and Shmin computed from the dipole sonic with a Biot coefficient
calibrated to the well's injection tests, and the vertical stress, all in psi, every 0.5 ft from
2,155 ft to TD. Each output row is the mean of the source rows in [depth, depth + 5) ft with empty
cells left out; nothing else is changed. The zone table beside it on the other sheet is hand-made
(one row reads "74122") and is not used. Usage:

    .venv/bin/python -I tools/survey/build_forge_stress.py <folder holding stress.xlsx>
"""

import hashlib
import json
import math
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "packages/core/src/forge-58-32-stress.json"
SOURCE = {"name": "stress.xlsx", "url": "https://gdr.openei.org/files/1032/58-32%20stress%20logging%20data.xlsx", "sha256": "ad34490ecfe2dc52cc432ba465c6e46fef2e2e7b424f795b89e2e876d79a8e3f", "gdr": 1032}
BIN_FT = 5


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    path = Path(sys.argv[1]) / SOURCE["name"]
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != SOURCE["sha256"]:
        sys.exit(f"{path}: SHA-256 {digest} does not match the recorded {SOURCE['sha256']}")
    rows = list(openpyxl.load_workbook(path, read_only=True, data_only=True)["logging"].iter_rows(values_only=True))
    header = [str(cell) for cell in rows[0][:4]]
    if header != ["MD", "Calibrated_SHMAX_using_calibrated_Biot", "SHMIN_PHS_using_calibrated_Biot", "SVERTICAL"]:
        sys.exit(f"Unexpected columns: {header}")
    bins: dict[int, list[list[float]]] = {}
    for row in rows[1:]:
        md, *values = row[:4]
        if not isinstance(md, (int, float)):
            continue
        cells = bins.setdefault(int(math.floor(md / BIN_FT) * BIN_FT), [[], [], []])
        for column, value in zip(cells, values):
            if isinstance(value, (int, float)):
                column.append(float(value))
    depths = sorted(bins)
    mean = lambda values: round(sum(values) / len(values), 1) if values else None
    record = {
        "source": SOURCE, "well": "58-32 (MU-ESW1)", "licence": "CC-BY-4.0",
        "note": "MD in ft from 58-32's KB (21.5 ft above ground, its log header); stresses in psi; mean of the source's 0.5 ft rows in each 5 ft bin.",
        "mdFt": depths,
        "shMaxPsi": [mean(bins[d][0]) for d in depths],
        "shMinPsi": [mean(bins[d][1]) for d in depths],
        "svPsi": [mean(bins[d][2]) for d in depths],
    }
    OUT.write_text(json.dumps(record, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)}: {len(depths)} rows {depths[0]}-{depths[-1]} ft, {OUT.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
