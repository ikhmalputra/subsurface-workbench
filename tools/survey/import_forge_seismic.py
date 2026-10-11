"""Cut a well-path section from the Utah FORGE 3D anisotropic PSDM volume.

Source: GDR 1141 "Utah FORGE: Seismic Reflection Data", DOI 10.15121/1542059 (CC BY 4.0), member
`3D Survey/Forge3d_ANI_PSDM_Stack_UnEnh.segy` of `2018-19 Reflection Processing.zip`.
The member is fetched by HTTP range request using the zip central directory and
checked against its CRC-32 and size. (The enhanced volume's deflate stream is
corrupt in the published zip, so the unenhanced stack is used.)

Outputs
- apps/demo/public/data/forge-16a-psdm-section.sgy: SEG-Y rev 1, IBM float.
  Every trace is an unmodified copy of the nearest 25 m bin of the source
  volume, cropped to 0-4000 m below the 1800 m seismic datum.
- apps/demo/public/data/forge-16a-psdm-volume.i8: a well-centred sub-volume,
  the nearest 25 m bin at every (along, offset) node of a grid aligned with the
  section, 0-3200 m below datum at 5 m. Amplitudes are quantised to int8
  (amplitude = count * amplitudePerCount, clipped at the 99.9th percentile of
  |amplitude|); x = along fastest, then offset, then depth.
- packages/core/src/forge-seismic.json: section and sub-volume geometry,
  wellhead, datum and provenance metadata.
- packages/core/test-fixtures/forge3d-psdm-first3.segy: the source file's
  first three traces, verbatim, to test non-standard header byte locations.
"""

from __future__ import annotations

import hashlib
import json
import math
import struct
import sys
import urllib.request
import zlib
from pathlib import Path

import numpy as np
import segyio

ROOT = Path(__file__).resolve().parents[2]
ZIP_URL = "https://gdr.openei.org/files/1141/2018-19%20Reflection%20Processing.zip"
MEMBER = "2018-19 Reflection Processing/3D Survey/Forge3d_ANI_PSDM_Stack_UnEnh.segy"
LOCAL = Path("/tmp/subsurface-forge3d-psdm.segy")
SOURCE_SHA = "d1e07eb1c0bf27ea28ada3a5c30102cf92f3689083857f6d96031c4a1e39ad62"
PLAN_URL = "https://gdr.openei.org/files/1216/Well_16A(78)-32_points_depths.csv"

# Wellhead: GDR 1216 planned-trajectory CSV, row MD 0 (NAD83 UTM 12N, m).
WELLHEAD_E, WELLHEAD_N, GROUND_ELEV_M = 334637.9, 4263458.9, 1650.22
PLAN_TOE = {"mdM": 3289.55, "eastingM": 335781.19, "northingM": 4263152.56, "tvdM": 2584.32}
DATUM_ELEV_M = 1800.0  # textual header C10
TRACE_SPACING_M = 25.0
BEHIND_M, BEYOND_M = 750.0, 750.0
CROSS_HALF_M = 750.0
MAX_DEPTH_M = 4000.0
VOLUME_MAX_DEPTH_M = 3200.0


def fetch_member() -> None:
    def rng(a: int, b: int):
        return urllib.request.urlopen(urllib.request.Request(ZIP_URL, headers={"Range": f"bytes={a}-{b}"}))

    with rng(0, 0) as probe:
        size = int(probe.headers["Content-Range"].split("/")[1])
    with rng(size - 65557, size - 1) as tail_response:
        tail = tail_response.read()
    eocd = tail.rfind(b"PK\x05\x06")
    cd_size, cd_offset = struct.unpack("<LL", tail[eocd + 12:eocd + 20])
    with rng(cd_offset, cd_offset + cd_size - 1) as cd_response:
        cd = cd_response.read()
    p = 0
    while cd[p:p + 4] == b"PK\x01\x02":
        fields = struct.unpack("<4s6H3L5H2L", cd[p:p + 46])
        n, x, c = fields[10], fields[11], fields[12]
        if cd[p + 46:p + 46 + n].decode() == MEMBER:
            crc, compressed, uncompressed, offset = fields[7], fields[8], fields[9], fields[16]
            break
        p += 46 + n + x + c
    else:
        sys.exit(f"{MEMBER} not in archive")
    with rng(offset, offset + 29) as header_response:
        header = header_response.read()
    start = offset + 30 + sum(struct.unpack("<2H", header[26:30]))
    inflate, running, total = zlib.decompressobj(-15), 0, 0
    with rng(start, start + compressed - 1) as body, LOCAL.open("wb") as out:
        while chunk := body.read(1 << 20):
            data = inflate.decompress(chunk)
            running, total = zlib.crc32(data, running), total + len(data)
            out.write(data)
    if running != crc or total != uncompressed:
        sys.exit("CRC/size mismatch for downloaded member")


def ibm(raw: bytes) -> float:
    value = struct.unpack(">I", raw)[0]
    if value == 0:
        return 0.0
    sign = -1.0 if value >> 31 else 1.0
    return sign * (value & 0xFFFFFF) / 16777216.0 * 16.0 ** (((value >> 24) & 0x7F) - 64)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def ebcdic_card(lines: list[str]) -> bytes:
    assert len(lines) <= 40 and all(len(line) <= 76 for line in lines), "textual header overflow"
    cards = [f"C{i + 1:2d} {(lines[i] if i < len(lines) else '')}".ljust(80) for i in range(40)]
    return "".join(cards).encode("ascii")  # segyio converts to EBCDIC on write


if not LOCAL.exists():
    fetch_member()
if sha256(LOCAL) != SOURCE_SHA:
    sys.exit(f"unexpected source hash for {LOCAL}")

raw = LOCAL.read_bytes()
with segyio.open(LOCAL, ignore_geometry=True) as src:
    samples = len(src.samples)
    dz = float(src.samples[1] - src.samples[0])
    text_header = [raw[i:i + 80].decode("cp037").rstrip() for i in range(0, 3200, 80)]
    trace_bytes = 240 + samples * 4
    count = src.tracecount
    il = np.empty(count, int)
    xl = np.empty(count, int)
    xs = np.empty(count)
    ys = np.empty(count)
    for i in range(count):
        h = raw[3600 + i * trace_bytes: 3600 + i * trace_bytes + 240]
        il[i] = struct.unpack(">h", h[8:10])[0]
        xl[i] = struct.unpack(">h", h[12:14])[0]
        xs[i] = ibm(h[188:192])
        ys[i] = ibm(h[192:196])
    volume = src.trace.raw[:]

assert samples == 1001 and dz == 5.0, (samples, dz)
assert (il.min(), il.max(), xl.min(), xl.max()) == (1, 170, 1, 213), (il.min(), il.max(), xl.min(), xl.max())
index = {(int(a), int(b)): i for i, (a, b) in enumerate(zip(il, xl))}
assert len(index) == count == 170 * 213

# Affine (il, xl) -> (x, y) and its inverse, fitted to every trace header.
design = np.column_stack([np.ones(count), il, xl])
coef_x, *_ = np.linalg.lstsq(design, xs, rcond=None)
coef_y, *_ = np.linalg.lstsq(design, ys, rcond=None)
residual = float(np.max(np.hypot(design @ coef_x - xs, design @ coef_y - ys)))
assert residual < 2.0, residual
forward = np.array([[coef_x[1], coef_x[2]], [coef_y[1], coef_y[2]]])
inverse = np.linalg.inv(forward)

def to_grid(x: float, y: float) -> tuple[float, float]:
    a, b = inverse @ np.array([x - coef_x[0], y - coef_y[0]])
    return float(a), float(b)

forge = json.loads((ROOT / "packages/core/src/forge-data.json").read_text())
survey = forge["survey"]
last = survey[-1]
azimuth = math.degrees(math.atan2(last["eastingM"], last["northingM"])) % 360
reach = math.hypot(last["eastingM"], last["northingM"])
ue, un = math.sin(math.radians(azimuth)), math.cos(math.radians(azimuth))

# Check: planned toe (UTM) vs observed survey offsets interpolated at the same MD.
mds = [s["mdM"] for s in survey]
k = next(i for i, md in enumerate(mds) if md >= PLAN_TOE["mdM"])
f = (PLAN_TOE["mdM"] - mds[k - 1]) / (mds[k] - mds[k - 1])
obs_e = WELLHEAD_E + survey[k - 1]["eastingM"] + f * (survey[k]["eastingM"] - survey[k - 1]["eastingM"])
obs_n = WELLHEAD_N + survey[k - 1]["northingM"] + f * (survey[k]["northingM"] - survey[k - 1]["northingM"])
plan_vs_survey = math.hypot(obs_e - PLAN_TOE["eastingM"], obs_n - PLAN_TOE["northingM"])
assert plan_vs_survey < 100, plan_vs_survey

first_depth = int(MAX_DEPTH_M / dz) + 1
distances = np.arange(-BEHIND_M, reach + BEYOND_M + 0.01, TRACE_SPACING_M)
picked = []
for d in distances:
    x, y = WELLHEAD_E + d * ue, WELLHEAD_N + d * un
    gi, gx = to_grid(x, y)
    key = (int(round(gi)), int(round(gx)))
    assert key in index, (d, key)
    picked.append((float(d), x, y, key, index[key]))

def nearest_bin(alongM: float, offsetM: float) -> int:
    x = WELLHEAD_E + alongM * ue + offsetM * un
    y = WELLHEAD_N + alongM * un - offsetM * ue
    gi, gx = to_grid(x, y)
    key = (int(round(gi)), int(round(gx)))
    assert key in index, (alongM, offsetM, key)
    return index[key]


offsets = np.arange(-CROSS_HALF_M, CROSS_HALF_M + 0.01, TRACE_SPACING_M)

def write_section(path: Path, traces: list[tuple[float, float, float, tuple[int, int], int]], title: str, line_azimuth: float, origin_note: str) -> None:
  path.parent.mkdir(parents=True, exist_ok=True)
  spec = segyio.spec()
  spec.format = 1
  spec.samples = np.arange(first_depth) * dz
  spec.tracecount = len(traces)
  spec.sorting = 0
  with segyio.create(path, spec) as dst:
    dst.text[0] = ebcdic_card([
        title,
        "SOURCE GDR 1141 2018-19 REFLECTION PROCESSING",
        "MEMBER 3D SURVEY/FORGE3D_ANI_PSDM_STACK_UNENH.SEGY",
        f"SOURCE SHA256 {SOURCE_SHA[:32]}",
        f"              {SOURCE_SHA[32:]}",
        "PROCESSOR LAND SEISMIC NOISE SPECIALISTS 2019 FOR UTAH FORGE / UOFU EGI",
        "LICENCE CC BY 4.0 - ATTRIBUTE UTAH FORGE, GDR 1141",
        "",
        "TRACES ARE UNMODIFIED NEAREST 25 M BINS ALONG A STRAIGHT LINE THROUGH",
        f"WELLHEAD E {WELLHEAD_E} N {WELLHEAD_N} AZIMUTH {line_azimuth:.2f} DEG GRID",
        f"FROM {traces[0][0]:.0f} M TO {traces[-1][0]:.0f} M ALONG LINE, {TRACE_SPACING_M:.0f} M SPACING",
        *([origin_note] if origin_note else []),
        f"SAMPLES CROPPED TO 0-{MAX_DEPTH_M:.0f} M, 5 M INTERVAL (DEPTH IN SAMPLE INTERVAL FIELD)",
        f"DEPTH BELOW SEISMIC DATUM {DATUM_ELEV_M:.0f} M ASL, POSITIVE DOWN",
        "COORDINATES NAD83 UTM 12N METRES",
        "",
        "TRACE HEADER BYTES (SEG-Y REV 1 STANDARD LOCATIONS)",
        "  71 COORDINATE SCALAR (-100)   181/185 CDP X/Y (SCALED)",
        "  189 SOURCE INLINE   193 SOURCE CROSSLINE   21 CDP = OUTPUT TRACE NO",
        "  197 SHOTPOINT = DISTANCE ALONG LINE FROM WELLHEAD (M)",
        "",
        "NOT TIED TO WELL CHECK-SHOTS; PSDM DEPTHS CARRY VELOCITY-MODEL ERROR",
        "",
        "SEG Y REV1",
        "END TEXTUAL HEADER",
    ])
    dst.bin.update({
        segyio.BinField.Traces: 1,
        segyio.BinField.AuxTraces: 0,
        segyio.BinField.Samples: first_depth,
        segyio.BinField.Interval: int(dz * 1000),
        segyio.BinField.Format: 1,
        segyio.BinField.MeasurementSystem: 1,
        segyio.BinField.SEGYRevision: 1,
        segyio.BinField.SEGYRevisionMinor: 0,
        segyio.BinField.TraceFlag: 1,
    })
    for n, (d, x, y, (a, b), source) in enumerate(traces):
        dst.header[n] = {
            segyio.TraceField.TRACE_SEQUENCE_LINE: n + 1,
            segyio.TraceField.CDP: n + 1,
            segyio.TraceField.SourceGroupScalar: -100,
            segyio.TraceField.CDP_X: int(round(xs[source] * 100)),
            segyio.TraceField.CDP_Y: int(round(ys[source] * 100)),
            segyio.TraceField.INLINE_3D: a,
            segyio.TraceField.CROSSLINE_3D: b,
            segyio.TraceField.ShotPoint: int(round(d)),
            segyio.TraceField.TRACE_SAMPLE_COUNT: first_depth,
            segyio.TraceField.TRACE_SAMPLE_INTERVAL: int(dz * 1000),
        }
        dst.trace[n] = volume[source][:first_depth]

  # Verify the written file round-trips to the exact source samples.
  with segyio.open(path, ignore_geometry=True) as check:
    for n, (_, _, _, _, source) in enumerate(traces):
      assert np.array_equal(check.trace[n], volume[source][:first_depth])


out_path = ROOT / "apps/demo/public/data/forge-16a-psdm-section.sgy"
write_section(out_path, picked, "UTAH FORGE 16A(78)-32 WELL-PATH SECTION FROM 3D ANISO PSDM (UNENHANCED)", azimuth, "")

# Sub-volume: nearest bin at every (along, offset) node; offset is to the right of the section azimuth.
vol_samples = int(VOLUME_MAX_DEPTH_M / dz) + 1
bins = np.array([[nearest_bin(float(d), float(o)) for d in distances] for o in offsets])  # [offset, along]
cube = volume[bins][:, :, :vol_samples]  # [offset, along, depth]
assert np.array_equal(cube[len(offsets) // 2, :, :], np.stack([volume[p[4]][:vol_samples] for p in picked])), "offset-0 row must be the section"
vol_clip = float(np.percentile(np.abs(cube), 99.9))
per_count = vol_clip / 127.0
counts = np.clip(np.rint(cube / per_count), -127, 127).astype(np.int8)
vol_path = ROOT / "apps/demo/public/data/forge-16a-psdm-volume.i8"
vol_path.write_bytes(np.ascontiguousarray(counts.transpose(2, 0, 1)).tobytes())  # [depth, offset, along]
check = np.frombuffer(vol_path.read_bytes(), dtype=np.int8).reshape(vol_samples, len(offsets), len(distances)).transpose(1, 2, 0)
inside = np.abs(cube) <= vol_clip
assert np.all(np.abs(check[inside] * per_count - cube[inside]) <= per_count / 2 + 1e-6), "quantisation error above half a count"

fixture = ROOT / "packages/core/test-fixtures/forge3d-psdm-first3.segy"
fixture.parent.mkdir(parents=True, exist_ok=True)
fixture.write_bytes(raw[:3600 + 3 * trace_bytes])

finite = np.abs(np.stack([volume[p[4]][:first_depth] for p in picked]))
metadata = {
    "id": "forge-16a-psdm-section",
    "title": "Utah FORGE 3D anisotropic PSDM (unenhanced) — section along 16A(78)-32",
    "license": "CC-BY-4.0",
    "attribution": "Utah FORGE seismic reflection data, GDR 1141, DOI 10.15121/1542059 (processed 2019 by Land Seismic Noise Specialists); well location from GDR 1216.",
    "source": {"url": ZIP_URL, "member": MEMBER, "sha256": SOURCE_SHA, "title": "Utah FORGE: Seismic Reflection Data (GDR 1141)", "textHeader": text_header},
    "wellheadSource": {"url": PLAN_URL, "title": "Utah FORGE: Well 16A(78)-32 Planned Trajectory (GDR 1216)"},
    "crs": "NAD83 / UTM zone 12N (EPSG:26912)",
    "wellhead": {"eastingM": WELLHEAD_E, "northingM": WELLHEAD_N, "groundElevationM": GROUND_ELEV_M},
    "seismicDatumElevationM": DATUM_ELEV_M,
    "rkbElevationM": forge["referenceElevationMslM"],
    "volume": {"inlines": [1, 170], "crosslines": [1, 213], "binM": 25, "sampleIntervalM": dz, "samples": samples,
               "headerBytes": {"inline": [9, "int16"], "crossline": [13, "int16"], "cdpX": [189, "ibm"], "cdpY": [193, "ibm"]},
               "gridFitResidualM": round(residual, 3)},
    "section": {"file": "forge-16a-psdm-section.sgy", "sha256": sha256(out_path), "azimuthDeg": round(azimuth, 3),
                "fromM": -BEHIND_M, "toM": round(float(distances[-1]), 3), "traceSpacingM": TRACE_SPACING_M,
                "traces": len(picked), "samples": first_depth, "maxDepthM": MAX_DEPTH_M,
                "p99AbsAmplitude": float(np.percentile(finite, 99))},
    "subVolume": {"file": vol_path.name, "sha256": sha256(vol_path),
                  "encoding": "int8, x = along fastest, then offset (right of the section azimuth), then depth sample; amplitude = count * amplitudePerCount",
                  "azimuthDeg": round(azimuth, 3), "alongFromM": float(distances[0]), "alongToM": float(distances[-1]),
                  "offsetFromM": float(offsets[0]), "offsetToM": float(offsets[-1]), "spacingM": TRACE_SPACING_M,
                  "alongCount": len(distances), "offsetCount": len(offsets), "samples": vol_samples, "sampleIntervalM": dz,
                  "maxDepthM": VOLUME_MAX_DEPTH_M, "amplitudePerCount": per_count, "clipPercentile": 99.9,
                  "clippedFraction": round(float(1 - inside.mean()), 5)},
    "checks": {"planToeVsSurveyM": round(plan_vs_survey, 2), "surveyAzimuthReference": "assumed UTM grid; planned UTM toe and survey offsets agree within the check above"},
    "notes": [
        "Depth is metres below the 1800 m ASL seismic datum, positive down. Well TVD below RKB converts as z = TVD + (1800 - RKB elevation).",
        "PSDM depths come from the processor's velocity model and are not tied to well check-shots or sonic logs; expect depth misfit at the well.",
        "Each output trace is the nearest 25 m bin to the section line; samples are unmodified and the source inline/crossline is kept in the trace header.",
        "The published zip's enhanced PSDM member fails decompression, so the unenhanced stack is used.",
        "The sub-volume uses the same nearest-bin rule; its offset-0 row is the section. Its int8 quantisation is for display: error is at most half a count below the 99.9th-percentile clip.",
    ],
}
(ROOT / "packages/core/src/forge-seismic.json").write_text(json.dumps(metadata, indent=2) + "\n")
print(f"{len(picked)} traces x {first_depth} samples, azimuth {azimuth:.2f}, grid residual {residual:.2f} m, plan-vs-survey {plan_vs_survey:.1f} m, {out_path.stat().st_size} bytes")
