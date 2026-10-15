"""Build packages/core/src/forge-string-weights.json: what 16A(78)-32's daily drilling reports say
about the string each day, for torque-and-drag calibration.

Source: GDR 1283, "16A(78)-32_Daily_Reports.zip" (CC BY 4.0), the drilling reports (WellEz PDFs
with a text layer), read with the small PDF text reader below (no third-party code). From each
report: its date and depth, mud weight, the rotating, pick-up and slack-off weights and torque, and
the BHA: each component's OD, ID and length, the BHA's length and its weight in air and mud; and
the date of the last BOP test it reports.

Nothing is corrected. Weights reported in klb ("200") and in lb ("200,000") are brought to lb; a
slack-off weight below 30 % of the rotating weight (two days: 18,000 and 15,000, by the look of
them a dropped zero) is kept as reported and flagged implausible, and calibration leaves it out.
Where a day has several report versions, the last one listed is kept. Usage:

    python3 -I tools/survey/build_forge_string_weights.py <folder for 16A(78)-32_Daily_Reports.zip>
"""

import hashlib
import io
import json
import re
import sys
import urllib.request
import zipfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "packages/core/src/forge-string-weights.json"
SOURCE = {"name": "16A(78)-32_Daily_Reports.zip", "url": "https://gdr.openei.org/files/1283/16A(78)-32_Daily_Reports.zip", "sha256": "d2b5bf21cc5b2ef3fe811f06f5bea7f88401c569d14513c5444fb0000e0ad66c", "gdr": 1283}


# ── A minimal PDF text reader: inflate the content streams, read the shown strings in order ──
def _decode(raw: bytes) -> str:
    raw = re.sub(rb"\\([nrtbf()\\])", lambda m: {b"n": b"\n", b"r": b"", b"t": b"\t", b"b": b"", b"f": b"", b"(": b"(", b")": b")", b"\\": b"\\"}[m.group(1)], raw)
    raw = re.sub(rb"\\(\d{1,3})", lambda m: bytes([int(m.group(1), 8) & 255]), raw)
    return raw.decode("latin-1")


def pdf_lines(data: bytes) -> list[str]:
    lines: list[str] = []
    for match in re.finditer(rb"<<(.*?)>>\s*stream\r?\n", data, re.S):
        start = match.end()
        body = data[start:data.find(b"endstream", start)]
        if b"FlateDecode" in match.group(1):
            try:
                body = zlib.decompressobj().decompress(body)
            except zlib.error:
                continue
        if b"Tj" not in body and b"TJ" not in body:
            continue
        line: list[str] = []
        for token in re.finditer(rb"\((?:\\.|[^\\)])*\)\s*Tj|\[(?:[^\]]*)\]\s*TJ|[-\d.]+\s+[-\d.]+\s+T[dD]|T\*|(?:[-\d.]+\s+){6}Tm|ET", body):
            text = token.group(0)
            if text.endswith(b"Tj"):
                line.append(_decode(text[text.index(b"(") + 1:text.rindex(b")")]))
            elif text.endswith(b"TJ"):
                word = ""
                for part in re.findall(rb"\((?:\\.|[^\\)])*\)|-?[\d.]+", text[1:text.rindex(b"]")]):
                    word += _decode(part[1:-1]) if part.startswith(b"(") else (" " if float(part) < -200 else "")
                line.append(word)
            elif line:
                lines.append(" ".join(line))
                line = []
        if line:
            lines.append(" ".join(line))
    return lines


NUMBER = re.compile(r"-?[\d,]*\.?\d+")
number = lambda text: float(text.replace(",", "")) if text is not None and NUMBER.fullmatch(text.strip()) else None


def value_after(lines: list[str], *labels: str) -> str | None:
    for label in labels:
        if label in lines:
            i = lines.index(label)
            following = lines[i + 1] if i + 1 < len(lines) else None
            # A blank field shows the next label instead of a value.
            if following is not None and not following.endswith(":") and following not in ("SURVEY DATA", "BHA", "PUMPS", "DRILL BITS"):
                return following
            return None
    return None


def weight_lb(text: str | None) -> float | None:
    value = number(text)
    return None if value is None else value * 1000 if value < 1000 else value


def bha(lines: list[str]):
    """The BHA table: rows of index, component, then OD [, ID], length, two rows side by side."""
    try:
        start = lines.index("BHA") + 11
        end = lines.index("DESCRIPTION:", start)
    except ValueError:
        return []
    tokens, rows, i = lines[start:end], [], 0
    while i < len(tokens):
        if re.fullmatch(r"\d+", tokens[i]) and i + 1 < len(tokens) and number(tokens[i + 1]) is None:
            index, name, values = int(tokens[i]), tokens[i + 1], []
            i += 2
            while i < len(tokens) and number(tokens[i]) is not None and not (re.fullmatch(r"\d+", tokens[i]) and i + 1 < len(tokens) and number(tokens[i + 1]) is None):
                values.append(number(tokens[i]))
                i += 1
            od, id_, length = (values + [None, None, None])[:3] if len(values) == 3 else (values[0], None, values[1]) if len(values) == 2 else (None, None, values[0] if values else None)
            rows.append({"index": index, "component": name, "odIn": od, "idIn": id_, "lengthFt": length})
        else:
            i += 1
    return sorted(rows, key=lambda row: row["index"])


def mud_weight(lines: list[str]) -> float | None:
    try:
        i = lines.index("HTHP")
    except ValueError:
        return None
    value = number(lines[i + 2]) if i + 2 < len(lines) else None
    return value if value is not None and 7 < value < 20 else None


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    path = Path(sys.argv[1]) / SOURCE["name"]
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(SOURCE["url"], timeout=600) as response:
            path.write_bytes(response.read())
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != SOURCE["sha256"]:
        sys.exit(f"{path}: SHA-256 {digest} does not match the recorded {SOURCE['sha256']}")
    days: dict[str, dict] = {}
    archive = zipfile.ZipFile(path)
    for info in sorted(archive.infolist(), key=lambda entry: entry.filename):
        name = info.filename
        if "__MACOSX" in name or "/drilling/" not in name or not name.endswith(".pdf"):
            continue
        lines = pdf_lines(archive.read(info))
        date = value_after(lines, "RPT DATE:")
        if not date:
            continue
        month, day, year = date.split("/")
        rot, pu, so = (weight_lb(value_after(lines, label)) for label in ("ROT. WT.:", "P.U. WT.:", "S.O. WT.:"))
        entry = {
            "date": f"{year}-{month}-{day}", "report": Path(name).name,
            "mdFt": number(value_after(lines, "MD/TVD:", "MD:")),
            "mudWeightPpg": mud_weight(lines),
            "rotLb": rot, "puLb": pu, "soLb": so,
            "torqueFtLbf": number(value_after(lines, "TORQUE:")),
            "lastBopTest": value_after(lines, "LAST BOP TEST:"),
            "bha": {"description": value_after(lines, "DESCRIPTION:"), "lengthFt": number(value_after(lines, "LENGTH:")), "weightAirLb": weight_lb(value_after(lines, "BHA WT. AIR:")), "weightMudLb": weight_lb(value_after(lines, "BHA WT. MUD:")), "components": bha(lines)},
            "flags": [],
        }
        if so is not None and rot is not None and so < 0.3 * rot:
            entry["flags"].append(f"slack-off {so:,.0f} lb is under 30 % of rotating {rot:,.0f} lb: implausible, left out of calibration")
        days[entry["date"]] = entry
    record = {
        "source": SOURCE, "licence": "CC-BY-4.0", "well": "16A(78)-32",
        "drillPipe": "5 in, 19.5 lb/ft nominal (the reports' BHA tables: \"Drill Pipe-5\\\" 19.5# DP\"); grade and tool joints not reported",
        "note": "Weights in lb, torque in ft-lbf, depths in ft MD, as each report gives them; the weights are taken as read at that day's reported depth.",
        "days": [days[key] for key in sorted(days)],
    }
    OUT.write_text(json.dumps(record, indent=1) + "\n", encoding="utf-8")
    usable = [d for d in record["days"] if d["mdFt"] and d["rotLb"] and d["puLb"] and d["soLb"]]
    print(f"{OUT.relative_to(ROOT)}: {len(record['days'])} days, {len(usable)} with depth and all three weights, {OUT.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
