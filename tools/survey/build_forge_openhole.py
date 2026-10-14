"""Build packages/fixtures/data/forge-16a-openhole-1ft.las from the Utah FORGE 16A(78)-32 logs.

Sources (GDR submission 1292, CC BY 4.0), verified by SHA-256 before use. A source missing from the
folder is fetched into it first: 16A(78)-32 Schlumberger.zip (6.34 GB) is not downloaded whole, its
four members are read out of it by HTTP range requests (about 2 MB compressed); the spectral gamma-ray LAS
is a plain 5 MB download.

Each curve is the mean of the source's samples in [DEPTH, DEPTH + 1) ft with nulls excluded; no
curve is interpolated, smoothed or recomputed, and units are converted only where the source states
percent for a porosity. Usage:

    python3 -I tools/survey/build_forge_openhole.py <empty directory, or one holding the five sources>
"""

import hashlib
import io
import math
import re
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "packages/fixtures/data/forge-16a-openhole-1ft.las"
ZIP = "https://gdr.openei.org/files/1292/16A(78)-32%20Schlumberger.zip"
SOURCES = {
    "R08_TB_TCOM.las": {
        "sha": "65d81e34ebaf02570e270cbf9f664c928fc72e054bb0294445360445eecfc25e",
        "src": ZIP + " :: 16A(78)-32 Schlumberger/Wireline Field Data/A1008700.01_University_of_Utah_Forge_R08_L001Up_TB_TCOM.las",
    },
    "PNS.las": {
        "sha": "0918c3f07cf46d2a2bc4bf013e7114fd4d627e6b32f008393082b175464db44a",
        "src": ZIP + " :: 16A(78)-32 Schlumberger/Processed Deliverables/University_of_Utah_Forge_16A_78-32_ThrubitDipole_PNS_result_5000-10940ft.las",
    },
    "IsoMechPro.las": {
        "sha": "00d9160483224b46dda9dce387f23a12effaba087e63b722d1579e67bb7a868b",
        "src": ZIP + " :: 16A(78)-32 Schlumberger/Processed Deliverables/University_of_Utah_Forge_16A_78-32_ThrubitDipole_IsoMechPro_result_6000-10942ft.las",
    },
    "Spectral.las": {
        "sha": "77fcf0b6fb503310a33302ce8dcc3b79b072411b96dd690792d24d5bab989a80",
        "src": "https://gdr.openei.org/files/1292/UnivUtah_Forge-16A-78-32_Spectral.las",
    },
    "FMI_P32.las": {
        "sha": "c80244cfb5f98b6c4fe8d8f7e8eda19ac5d22d3b5ad0ee5e09ffc920f1d403fe",
        "src": ZIP + " :: 16A(78)-32 Schlumberger/Processed Deliverables/University_of_Utah_Forge_16A-78-32_TBFMI_Interpretation_5040-10870ft_FracAnalysis_P32.las",
    },
}

# (source file, source mnemonic, output mnemonic, output unit, scale, description)
CURVES = [
    ("R08_TB_TCOM.las", "GR_TMG", "GR", "gAPI", 1, "Gamma ray (thru-bit)"),
    ("Spectral.las", "HCGR", "CGR", "gAPI", 1, "Computed gamma ray, uranium-free (HNGS)"),
    ("Spectral.las", "HFK", "K", "%", 1, "Formation potassium (HNGS)"),
    ("Spectral.las", "HTHO", "TH", "ppm", 1, "Formation thorium (HNGS)"),
    ("Spectral.las", "HURA", "U", "ppm", 1, "Formation uranium (HNGS)"),
    ("R08_TB_TCOM.las", "TNPH_LIM", "NPHI", "v/v", 0.01, "Thermal neutron porosity, limestone matrix (percent / 100)"),
    ("R08_TB_TCOM.las", "TNPH_SAN", "NPHI_SAN", "v/v", 0.01, "Thermal neutron porosity, sandstone matrix (percent / 100)"),
    ("PNS.las", "DPHI", "DPHI", "v/v", 1, "Density porosity, sandstone matrix (as delivered)"),
    ("PNS.las", "SPHI", "SPHI", "v/v", 1, "Sonic total porosity (as delivered)"),
    ("PNS.las", "DTCO_MPS_final", "DTC", "us/ft", 1, "Compressional slowness"),
    ("PNS.las", "DTSH_PNS_final", "DTS", "us/ft", 1, "Shear slowness"),
    ("R08_TB_TCOM.las", "TBIT10", "RT10", "ohm.m", 1, "Array induction, 10 in depth of investigation"),
    ("R08_TB_TCOM.las", "TBIT90", "RT90", "ohm.m", 1, "Array induction, 90 in depth of investigation"),
    ("PNS.las", "C1_13", "C13", "in", 1, "Caliper, pads 1-3"),
    ("PNS.las", "C1_24", "C24", "in", 1, "Caliper, pads 2-4"),
    ("PNS.las", "BS_RM", "BS", "in", 1, "Bit size"),
    ("PNS.las", "DEVI", "DEVI", "deg", 1, "Hole deviation"),
    ("FMI_P32.las", "P32", "P32", "1/ft", 1, "Fracture intensity from the FMI interpretation"),
    ("IsoMechPro.las", "UCS", "UCS", "psi", 1, "Unconfined compressive strength (Schlumberger IsoMechPro)"),
    ("IsoMechPro.las", "YME_STA", "YME_STA", "Mpsi", 1, "Static Young's modulus (IsoMechPro)"),
    ("IsoMechPro.las", "PR", "PR", "", 1, "Poisson's ratio (IsoMechPro)"),
    ("IsoMechPro.las", "TZSG", "SV_G", "psi/ft", 1, "Vertical stress gradient (IsoMechPro)"),
    ("IsoMechPro.las", "TXSG_ISO", "SHMIN_G", "psi/ft", 1, "Minimum horizontal stress gradient (IsoMechPro)"),
    ("IsoMechPro.las", "PPGI", "PP_G", "psi/ft", 1, "Pore pressure gradient (IsoMechPro)"),
]
TOP, BASE = 5000, 10950
NULL = -999.25


class HttpRange(io.RawIOBase):
    """A read-only, seekable view of a remote file through HTTP Range requests."""

    def __init__(self, url: str):
        self.url, self.pos = url, 0
        with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=60) as response:
            self.size = int(response.headers["Content-Length"])

    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos

    def seek(self, offset, whence=0):
        self.pos = offset if whence == 0 else self.pos + offset if whence == 1 else self.size + offset
        return self.pos

    def readinto(self, buffer):
        if self.pos >= self.size or not len(buffer):
            return 0
        end = min(self.size, self.pos + len(buffer)) - 1
        request = urllib.request.Request(self.url, headers={"Range": f"bytes={self.pos}-{end}"})
        with urllib.request.urlopen(request, timeout=300) as response:
            data = response.read()
        buffer[:len(data)] = data
        self.pos += len(data)
        return len(data)


def fetch(folder: Path) -> None:
    """Fetch every source not already in the folder: zip members by range request, the rest whole."""
    archive = None
    for name, meta in SOURCES.items():
        target = folder / name
        if target.exists():
            continue
        url, _, member = meta["src"].partition(" :: ")
        if member:
            archive = archive or zipfile.ZipFile(io.BufferedReader(HttpRange(url), buffer_size=1 << 20))
            target.write_bytes(archive.read(member))
        else:
            with urllib.request.urlopen(url, timeout=300) as response:
                target.write_bytes(response.read())
        print(f"fetched {name}: {target.stat().st_size:,} bytes")


def read(path: Path):
    text = path.read_text(encoding="latin-1")
    lines = text.splitlines()
    null = None
    names = []
    section = ""
    data_start = None
    for index, line in enumerate(lines):
        if line.startswith("~"):
            section = line[1].upper()
            if section == "A":
                data_start = index + 1
                break
            continue
        if line.startswith("#") or not line.strip():
            continue
        if section == "W":
            match = re.match(r"\s*NULL\s*\.\S*\s+([-+\d.eE]+)", line)
            if match:
                null = float(match.group(1))
        if section == "C":
            names.append(line.split(".")[0].strip())
    columns = {name: [] for name in names}
    for line in lines[data_start:]:
        if not line.strip() or line.startswith("#"):
            continue
        values = line.split()
        for name, value in zip(names, values):
            number = float(value)
            columns[name].append(None if (null is not None and number == null) or not math.isfinite(number) else number)
    return columns


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    folder = Path(sys.argv[1])
    folder.mkdir(parents=True, exist_ok=True)
    fetch(folder)
    data = {}
    for name, meta in SOURCES.items():
        digest = hashlib.sha256((folder / name).read_bytes()).hexdigest()
        if digest != meta["sha"]:
            sys.exit(f"{name}: SHA-256 {digest} does not match the recorded {meta['sha']}")
        data[name] = read(folder / name)
    depths = list(range(TOP, BASE + 1))
    out = []
    for source, mnemonic, _, _, scale, _ in CURVES:
        columns = data[source]
        index = columns[next(key for key in columns if key in ("DEPT", "TDEP", "MD"))]
        values = columns[mnemonic]
        bins = {}
        for depth, value in zip(index, values):
            if depth is None or value is None:
                continue
            key = math.floor(depth)
            if TOP <= key <= BASE:
                bins.setdefault(key, []).append(value * scale)
        out.append([sum(bins[d]) / len(bins[d]) if d in bins else None for d in depths])
    header = [
        "~VERSION INFORMATION",
        " VERS.                 2.0 : CWLS LOG ASCII STANDARD - VERSION 2.0",
        " WRAP.                  NO : ONE LINE PER DEPTH STEP",
        "~WELL INFORMATION",
        f" STRT.ft {TOP:>16} : START DEPTH",
        f" STOP.ft {BASE:>16} : STOP DEPTH",
        " STEP.ft                 1 : STEP",
        f" NULL.            {NULL} : NULL VALUE",
        " COMP.           UtahForge : COMPANY",
        " WELL.         16A (78)-32 : WELL",
        " FLD.          Milford, UT : FIELD",
        " SRVC.        Schlumberger : SERVICE COMPANY",
        "~CURVE INFORMATION",
        " DEPTH.ft         : Measured depth (1 ft bin top)",
        *[f" {name}.{unit:<8} : {description}" for _, _, name, unit, _, description in CURVES],
        "~PARAMETER INFORMATION",
        *[line for name, meta in SOURCES.items() for line in (f" SRC_{name.split('.')[0].upper()}.  {meta['src']} : SOURCE FILE", f" SHA_{name.split('.')[0].upper()}.  {meta['sha']} : SOURCE SHA-256")],
        " DCM.  MEAN OF SOURCE SAMPLES IN [DEPTH, DEPTH+1) FT, NULLS EXCLUDED : DECIMATION",
        " LIC.  CC-BY-4.0 : LICENSE (GDR 1292, DOE Geothermal Data Repository)",
        "~A DEPTH " + " ".join(name for _, _, name, _, _, _ in CURVES),
    ]
    rows = []
    for row, depth in enumerate(depths):
        cells = [str(depth)]
        for column in out:
            value = column[row]
            cells.append(str(NULL) if value is None else f"{value:.5g}")
        rows.append(" ".join(cells))
    OUT.write_text("\n".join(header + rows) + "\n", encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)}: {len(depths)} depths, {len(CURVES)} curves, {OUT.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
