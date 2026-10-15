"""Build packages/core/src/forge-offset-construction.json: how Utah FORGE's other deep wells were
built, from their end-of-well reports, for comparing them with 16A(78)-32.

Sources (GDR, CC BY 4.0), each pinned by SHA-256:
  16B(78)-32  GDR 1516  End of Well Report-16B78-32-May_2024.pdf
  58-32       GDR 1006  58-32_EOWR.zip -> 58-32_EOWR/58-32_EOWR_DOE.pdf and CasingReports_All.pdf
  56-32       GDR 1295  56-32 EOWR - Final 22 July 2021.pdf
  78-32       GDR 1153  Monitoring Wells  78-32 - EOWR.pdf
  78B-32      GDR 1330  78B-32 EOWR with appendices.zip -> 78B-32 EOWR with ref appendices.pdf

The casing programmes are transcribed by hand below, value by value, each with the words of the
page it comes from; the script reads every cited page's text layer (Apple PDFKit, through
tools/survey/pdf_pages.swift, so macOS) and refuses to write unless every quote is on its page.
Where a report contradicts itself the transcription keeps the as-constructed table and the note
quotes the other figure. A value no page gives is null, never filled in. The 56-32 and 78B-32
survey tables are parsed from the pages and checked by recomputing TVD by minimum curvature.

    python3 -I tools/survey/build_forge_construction.py <folder holding the five downloads>

The folder holds 16b.pdf, 58-32.zip, 56-32.pdf, 78-32.pdf and 78b-32.zip (any other names are
looked up by hash).
"""

import hashlib
import json
import math
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "packages/core/src/forge-offset-construction.json"
PAGES = Path(__file__).resolve().parent / "pdf_pages.swift"

SOURCES = {
    "16b": {"gdr": 1516, "name": "End of Well Report-16B78-32-May_2024.pdf", "url": "https://gdr.openei.org/files/1516/End%20of%20Well%20Report-16B78-32-May_2024.pdf", "sha256": "b35f25eda60fcec90a82a688c46ab4b4f30548876cc3cb0113a7cdb966f18f5d"},
    "58-32": {"gdr": 1006, "name": "58-32_EOWR.zip", "url": "https://gdr.openei.org/files/1006/58-32_EOWR.zip", "sha256": "b702fa9e7dba34b8abdd0ed184aeb27d66cd4307027fc953caf1b2c1f2337654",
              "members": {"eowr": "58-32_EOWR/58-32_EOWR_DOE.pdf", "casing": "58-32_EOWR/CasingReports_All.pdf"}},
    "56-32": {"gdr": 1295, "name": "56-32 EOWR - Final 22 July 2021.pdf", "url": "https://gdr.openei.org/files/1295/56-32%20EOWR%20-%20Final%2022%20July%202021.pdf", "sha256": "95be3fe8e669bc39bc1b0e688b565584032d3c8ac0c227870870c384552704b3"},
    "78-32": {"gdr": 1153, "name": "Monitoring Wells  78-32 - EOWR.pdf", "url": "https://gdr.openei.org/files/1153/Monitoring%20Wells%20%2078-32%20-%20EOWR.pdf", "sha256": "7dc4d3e9ab9ba396039105c4b89475c9f34fb00525cd49fbe652317add3efa46"},
    "78b-32": {"gdr": 1330, "name": "78B-32 EOWR with appendices.zip", "url": "https://gdr.openei.org/files/1330/78B-32%20EOWR%20with%20appendices.zip", "sha256": "e4d84ced665534463a0d742589d715e8fbee04c9adf760f0674ca1da29afcb17",
               "members": {"eowr": "78B-32 EOWR with ref appendices.pdf"}},
}


def q(page, text, doc="eowr"):
    """A quote that must stand on a page of a document of the well's source."""
    return {"doc": doc, "page": page, "quote": text}


# ── The transcription. Depths in feet MD from each well's own rotary table / kelly bushing. ──
WELLS = [
    {
        "id": "16b", "label": "16B(78)-32", "purpose": "Production well, the doublet partner of 16A(78)-32", "drilled": "2023",
        "datum": {"kind": "KB", "aboveGroundFt": None, "elevationFt": 5447.65, "groundElevationFt": 5415.65, "cite": [q(5, "KB Elevation 5447.65 ft (confirm)"), q(5, "GL Elevation 5415.65 ft"), q(5, "MD is relative to the rig's RT/KB")],
                  "note": "The report marks the KB elevation “(confirm)”."},
        "totalDepthFt": 10947, "tdCite": [q(14, "rotate and slide from 10,503 to 10,947 ft MD")],
        "survey": {"from": "forge-offset-wells", "id": "16b"},
        "strings": [
            {"role": "surface", "name": "Surface casing / 16 in", "odIn": 16, "idIn": None, "spec": "84 lb/ft · JFE110T", "topFt": 0, "shoeFt": 1136,
             "cite": [q(12, "16-inch surface casing was run, with the shoe at 1,136 ft MD"), q(163, "84 lb/ JFE110T @ 1,136")],
             "hole": {"sizeIn": 22, "bottomFt": 1146, "cite": [q(12, "drilling 22-inch surface hole"), q(12, "TD for the surface hole was reached at 1,146 ft MD")]},
             "cement": {"topFt": 0, "text": "Cemented with 144 bbl to surface; the annulus top stayed at surface", "cite": [q(12, "surface casing was successfully cemented with 144 bbl of cement to the surface"), q(29, "Cement top in the annulus remained at the surface")]}},
            {"role": "intermediate", "name": "Intermediate casing / 11 3/4 in", "odIn": 11.75, "idIn": None, "spec": "65 lb/ft · JFE110T · BTC", "topFt": 0, "shoeFt": 4837,
             "cite": [q(12, "ran 11-3/4-inch, 65 ppf, JFE110T BTC casing to a shoe depth of 4,837 ft MD")],
             "hole": {"sizeIn": 14.75, "bottomFt": 4845, "cite": [q(12, "start drilling the 14-3/4-inch intermediate section"), q(12, "reach intermediate TD at 4,845 ft MD")]},
             "cement": {"topFt": 0, "text": "The annulus top fell to ~578 ft; two top-out jobs brought it to surface", "cite": [q(45, "TOC in the annulus was at ~578 ft"), q(45, "got good cement to surface")]}},
            {"role": "production", "name": "Production casing / 7 in", "odIn": 7, "idIn": None, "spec": "38 lb/ft · P110EC", "topFt": 0, "shoeFt": 10208,
             "cite": [q(163, "38 lb/ P110EC @ 10,208"), q(14, "cased to 10, 208 ft MD")],
             "hole": {"sizeIn": 9.5, "bottomFt": 10947, "cite": [q(163, "9-1/2\" OH @ 10,947")]},
             "cement": {"topFt": 3000, "approximate": True, "text": "ThermaSTONE; the bond log shows no cement above ~3,000 ft inside the 11 3/4 in and extremely poor coverage through the build",
                        "cite": [q(163, "ThermaSTONE"), q(162, "QSLT CBL shows no cement from ~3,000 ft to surface inside the 11-3/4\" intermediate casing string and extremely poor cement coverage throughout the build section")]}},
        ],
        "openHole": {"fromFt": 10208, "toFt": 10947, "sizeIn": 9.5, "cite": [q(8, "final 760 ft of well 16B(78)-32 were uncased")]},
        "surface": [{"kind": "Wellhead", "name": "Wellhead (rating not given in the summary)", "cite": [q(14, "install wellhead and BOPE")]}],
        "notes": [
            {"text": "Intermediate grade: JFE110T in the operations summary (p. 12), JFE125T in the cement-job figures (pp. 45, 163).", "cite": [q(163, "65 lb/ JFE125T @ 4,837")]},
            {"text": "The report says the final 760 ft were uncased; the shoe (10,208 ft) to TD (10,947 ft) is 739 ft.", "cite": []},
            {"text": "Section II gives 10,700.97 ft MD at the toe: the plan, not the well drilled.", "cite": [q(5, "Total Measured Depth 10,700.97 ft")]},
            {"text": "No conductor is described on the summary pages read.", "cite": []},
        ],
    },
    {
        "id": "58-32", "label": "58-32 (MU-ESW1)", "purpose": "Vertical exploration and injection-test well", "drilled": "2017",
        "datum": {"kind": "RKB", "aboveGroundFt": 21.5, "elevationFt": 5557.5, "groundElevationFt": 5536, "cite": [q(5, "measured depths from the rotary Kelly bushing"), q(5, "(RKB) level of 21.5 ft. above ground level"), q(11, "5,536 ft ASL 5,557.5 ft ASL")], "note": None},
        "totalDepthFt": 7536, "tdCite": [q(11, "7,536 ft (2.30° inclination at TD)")],
        "survey": {"from": "forge-offset-wells", "id": "58-32"},
        "strings": [
            {"role": "conductor", "name": "Conductor / 20 in", "odIn": 20, "idIn": None, "spec": "A53B · 0.25 in wall · welded", "topFt": 0, "shoeFt": 83.5,
             "cite": [q(13, "Conductor n/a 20 A53B, 0.25\" WT, Welded"), q(13, "n/a 83.5 Preset")],
             "hole": {"sizeIn": 36, "bottomFt": None, "cite": [q(1, "Bit Diameter (ins): 36.000", "casing")]}, "cement": None},
            {"role": "surface", "name": "Surface casing / 13 3/8 in", "odIn": 13.375, "idIn": 12.615, "spec": "54.5 ppf · N-80 · BTC (non-API)", "topFt": 0, "shoeFt": 337.5,
             "cite": [q(13, "Surface 17-1/2 13-3/8 54.5 ppf, N-80, BTC (non-API) 12.615 / 12.459 / 14.375 337.5")],
             "hole": {"sizeIn": 17.5, "bottomFt": 342, "cite": [q(13, "The 17-1/2\" hole was drilled to 342 ft.")]},
             "cement": {"topFt": None, "text": "Top of cement fell to four feet below the cellar and was filled with gravel", "cite": [q(25, "Top of cement fell to four feet below the cellar and was filled with gravel")]}},
            {"role": "intermediate", "name": "Intermediate casing / 9 5/8 in", "odIn": 9.625, "idIn": 8.835, "spec": "40 ppf · L-80 · BTC", "topFt": 0, "shoeFt": 2172,
             "cite": [q(13, "Intermediate 12-1/4 9-5/8 40 ppf, L-80, BTC 8.835 / 8.750 (AD) / 10.625 2,172")],
             "hole": {"sizeIn": 12.25, "bottomFt": 2180, "cite": [q(13, "when the casing point of 2180' was reached")]},
             "cement": {"topFt": None, "text": "No top jobs were needed (the cement report is an image)", "cite": [q(31, "No top jobs were needed.")]}},
            {"role": "production", "name": "Injection casing / 7 in", "odIn": 7, "idIn": 6.276, "spec": "29 ppf · L-80 · BTC", "topFt": 0, "shoeFt": 7374,
             "cite": [q(13, "Injection 8-3/4 7 29 ppf, L-80, BTC 6.276 / 6.151 / 7.656 7,374")],
             "hole": {"sizeIn": 8.75, "bottomFt": 7536, "cite": [q(13, "total depth of 7,536 ft. was reached")]},
             "cement": {"topFt": None, "text": "Cemented; top not reported (the cementing report is an image)", "cite": [q(38, "The 7\" 29 ppf L-80 casing was run and cemented")]}},
        ],
        "openHole": {"fromFt": 7374, "toFt": 7536, "sizeIn": 8.75, "cite": [q(13, "The bottom 161' of the hole was cleaned and left open")]},
        "surface": [
            {"kind": "Wellhead", "name": "13-5/8 in 3M × 5M clamp-on wellhead", "cite": [q(25, "13-5/8\" 3M x 5M clamp-on well head")]},
            {"kind": "Valve", "name": "7-1/16 in 10M master valve", "cite": [q(39, "7-1/16\" 10 M master valve")]},
            {"kind": "Valve", "name": "3-1/16 in 10M crown valve", "cite": [q(39, "3-1/16\" 10M crown valve above the master valve")]},
        ],
        "notes": [
            {"text": "9 5/8 in grade: L-80 in Table 4, K-55 in the casing narrative (p. 31) and the RIMBase casing report.", "cite": [q(31, "The 9-5/8\", 40 ppf, K-55 casing")]},
            {"text": "7 in shoe: 7,374 ft in Table 4, 7,375 ft in the narrative (pp. 13, 38).", "cite": [q(38, "with the shoe set at 7375'")]},
            {"text": "Conductor bore: Table 4 gives 17.5 in; the RIMBase casing report gives 19.5 in. Neither is drawn.", "cite": [q(1, "String Nominal ID (ins): 19.500", "casing")]},
        ],
    },
    {
        "id": "56-32", "label": "56-32", "purpose": "Vertical seismic monitoring and testing well", "drilled": "2021",
        "datum": {"kind": "RKB", "aboveGroundFt": 30.40, "elevationFt": 5482.11, "groundElevationFt": 5451.71, "cite": [q(15, "Rotary Table Height: 30.40 ft. from ground level"), q(15, "Ground Level (GL): 5,451.71 ft. ASL"), q(15, "Rotary Table Elevation 5,482.11 ft. ASL")], "note": None},
        "totalDepthFt": 9145, "tdCite": [q(22, "the final Total Measured Depth 9,145 ft.")],
        "survey": {"from": "pages", "pages": [22, 23, 24, 25, 26], "format": "us"},
        "strings": [
            {"role": "conductor", "name": "Conductor / 20 in", "odIn": 20, "idIn": 19.124, "spec": "94 ppf · J-55 · welded", "topFt": 0, "shoeFt": 120.5,
             "cite": [q(17, "Conductor n/a 20 94 ppf, J-55, Welded 19.124 18.936 n/a 120.5 Preset")], "hole": None, "cement": None},
            {"role": "surface", "name": "Surface casing / 13 3/8 in", "odIn": 13.375, "idIn": 12.615, "spec": "54.5 ppf · J-55 · BTC", "topFt": 0, "shoeFt": 381,
             "cite": [q(17, "Surface 17-1/2 13-3/8 54.5 ppf, J-55, BTC 12.615 12.459 14.375 381")],
             "hole": {"sizeIn": 17.5, "bottomFt": 380.5, "cite": [q(29, "Drilling to the casing point at 380.5 ft.")]},
             "cement": {"topFt": 0, "text": "Good cement returns held at surface", "cite": [q(34, "Good cement returns held at surface")]}},
            {"role": "intermediate", "name": "Intermediate casing / 9 5/8 in", "odIn": 9.625, "idIn": 8.835, "spec": "36 ppf · J-55 · LTC", "topFt": 0, "shoeFt": 3494,
             "cite": [q(18, "Intermediate 12-1/4 9-5/8 36 ppf, J-55, LTC 8.835 8.765 10.625 3,494")],
             "hole": {"sizeIn": 12.25, "bottomFt": 3500, "cite": [q(3, "12-1/4 in. Hole to 3,500 ft.")]},
             "cement": {"topFt": None, "text": "No top jobs were needed (the cement report is an image)", "cite": [q(42, "No top jobs were needed.")]}},
            {"role": "production", "name": "Production casing / 5 1/2 in", "odIn": 5.5, "idIn": 4.892, "spec": "17 ppf · L-80 · BTC", "topFt": 0, "shoeFt": 9135,
             "cite": [q(18, "Production 8-3/4 5-1/2 17 ppf, L-80, BTC 4.892 4.767 6.3 9,135")],
             "hole": {"sizeIn": 8.75, "bottomFt": 9145, "cite": [q(20, "Drilling continued with 8-3/4 in. PDC to 9,145 ft.")]},
             "cement": {"topFt": None, "text": "Cemented without returns to surface, then a top squeeze; top not reported", "cite": [q(20, "without cement returns"), q(20, "top squeeze")]}},
        ],
        "openHole": None,
        "surface": [{"kind": "Wellhead", "name": "13-5/8 in 3M × 5M Sliplok wellhead", "cite": [q(34, "13-5/8 in. 3M x 5M Sliplok wellhead")]}],
        "notes": [
            {"text": "5 1/2 in shoe: 9,135 ft in Table 4, 9,105 ft in the summary (p. 8).", "cite": [q(8, "The well was cased with 5-1/2-inch casing to a depth of 9,105 ft.")]},
            {"text": "Depth: 9,145 ft in the survey and narrative, “Actual Depth: 9,105 ft” in the well data (p. 15).", "cite": [q(15, "Actual Depth: 9,105 ft.")]},
            {"text": "Conductor: 120.5 ft in Table 4, 128.5 ft where drilling began (p. 29).", "cite": [q(29, "conductor casing at 128.5 ft.")]},
            {"text": "13 3/8 in shoe: 381 ft in Table 4, 380.5 ft in the narrative (p. 34).", "cite": [q(34, "casing was set at 380.5 ft.")]},
        ],
    },
    {
        "id": "78-32", "label": "78-32", "purpose": "Intermediate-depth seismic monitoring well", "drilled": "2019",
        "datum": {"kind": "RKB", "aboveGroundFt": 5.70, "elevationFt": None, "groundElevationFt": None, "cite": [q(5, "(RKB), which is 5.70 ft above ground level"), q(5, "Elevation: 5509.5 ft ASL")],
                  "note": "The report gives “Elevation: 5509.5 ft ASL” without saying of what (ground or RKB), so no datum elevation is taken from it."},
        "totalDepthFt": 3280, "tdCite": [q(5, "Total Depth (ft): 3,280 ft.")],
        "survey": None,
        "surveyNote": "Single-shot inclinations only, no azimuths: no TVD is computed.",
        "strings": [
            {"role": "conductor", "name": "Conductor / 14 in", "odIn": 14, "idIn": 13.25, "spec": "welded", "topFt": 0, "shoeFt": 69,
             "cite": [q(6, "Conductor 24 14 Welded 13.25 69")], "hole": {"sizeIn": 24, "bottomFt": None, "cite": [q(6, "Conductor 24 14 Welded")]},
             "cement": {"topFt": None, "text": "Pre-set with a dry-hole digger and cemented in place; top not stated", "cite": [q(6, "Pre-set, with a dry hole digger and cemented in place")]}},
            {"role": "surface", "name": "Surface casing / 9 5/8 in", "odIn": 9.625, "idIn": 8.921, "spec": "36# · J-55 · LTC", "topFt": 0, "shoeFt": 704,
             "cite": [q(6, "Surface 12.25 9.625 36#, J-55, LTC 8.921/ 8.765/ 10.625 704")], "hole": {"sizeIn": 12.25, "bottomFt": None, "cite": [q(6, "Surface 12.25 9.625")]},
             "cement": {"topFt": 0, "text": "Cemented in place to surface", "cite": [q(6, "704 Cemented in place to surface")]}},
            {"role": "production", "name": "Production casing / 5 1/2 in", "odIn": 5.5, "idIn": 5.0, "spec": "17# · K-55 · BTC", "topFt": 0, "shoeFt": 3269,
             "cite": [q(6, "Production 8.75 5.5 17#, K-55, BTC 5.00/ 4.767/ 6.050 3269")], "hole": {"sizeIn": 8.75, "bottomFt": 3280, "cite": [q(6, "Production 8.75 5.5")]},
             "cement": {"topFt": 0, "text": "Cemented in place to surface; a secondary job brought it to surface from 68 ft", "cite": [q(6, "3269 Cemented in place to surface"), q(8, "bring cement to surface from 68 ft")]}},
        ],
        "openHole": None,
        "surface": [
            {"kind": "Wellhead", "name": "6 in 2M wellhead with a 3 in threaded shooting flange", "cite": [q(8, "A permanent wellhead was installed consisting of a 6\" 2M with a 3\" threaded shooting flange")]},
            {"kind": "Valve", "name": "3 in threaded crown valve", "cite": [q(8, "a 3\" threaded crown valve")]},
        ],
        "notes": [
            {"text": "5 1/2 in shoe: 3,269 ft in Table 1, float shoe at 3,268 ft in the narrative (p. 8).", "cite": [q(8, "float shoe set at 3268ft")]},
            {"text": "The daily reports say Hydro Resources measured from ground level; Table 1 and this transcription take the report's RKB statement.", "cite": []},
        ],
    },
    {
        "id": "78b-32", "label": "78B-32", "purpose": "Deep vertical seismic monitoring and testing well", "drilled": "2021",
        "datum": {"kind": "RKB", "aboveGroundFt": 30.40, "elevationFt": 5566.4, "groundElevationFt": 5536, "cite": [q(16, "Rotary Table Height: 30.40 ft. from ground level"), q(16, "Ground Level (GL): 5,536 ft. ASL"), q(16, "Rotary Table Elevation 5,566.4 ft. ASL")], "note": None},
        "totalDepthFt": 9500, "tdCite": [q(16, "Actual Depth: 9,500 ft.")],
        "survey": {"from": "pages", "pages": [21, 22, 23, 24], "format": "eu"},
        "strings": [
            {"role": "conductor", "name": "Conductor / 24 in", "odIn": 24, "idIn": 23.0, "spec": "0.5 in wall · butt welded", "topFt": 0, "shoeFt": 128.5,
             "cite": [q(18, "Conductor n/a 24 0.5 in. WT, Butt Welded 23.000 n/a n/a 128.5 Preset")], "hole": None, "cement": None},
            {"role": "surface", "name": "Surface casing / 16 in", "odIn": 16, "idIn": 15.25, "spec": "65 ppf · K-55 · BTC", "topFt": 0, "shoeFt": 416,
             "cite": [q(18, "Surface 22 16 65 ppf, K-55, BTC 15.250 15.062 17.000 416")],
             "hole": {"sizeIn": 22, "bottomFt": 421, "cite": [q(28, "Drilling to the casing point at 421 ft.")]},
             "cement": {"topFt": 0, "text": "Good cement returns held at surface", "cite": [q(30, "Good cement returns held at surface")]}},
            {"role": "intermediate", "name": "Intermediate casing / 11 3/4 in", "odIn": 11.75, "idIn": 10.88, "spec": "54 ppf · K-55 · BTC", "topFt": 0, "shoeFt": 2990,
             "cite": [q(18, "Intermediate 14-3/4 11-3/4 54 ppf, K-55, BTC 10.880 10.720 12.750 2,990")],
             "hole": {"sizeIn": 14.75, "bottomFt": 3009, "cite": [q(32, "14-3/4 in. Hole to 3,009 ft.")]},
             "cement": {"topFt": None, "text": "Cemented; top not reported in the text (the cement report is an image)", "cite": [q(18, "Cemented intermediate string.")]}},
            {"role": "production", "name": "Production casing / 7 in", "odIn": 7, "idIn": 5.82, "spec": "41 ppf · T-110 SS · Tenaris Blue", "topFt": 0, "shoeFt": 8509,
             "cite": [q(18, "Production 10-5/8 7 41 ppf, T-110 SS, Tenaris Blue 5.820 5.695 7.656 8,509")],
             "hole": {"sizeIn": 10.625, "bottomFt": None, "cite": [q(18, "Production 10-5/8 7")]},
             "cement": {"topFt": 95, "text": "Cement top fell to 95 ft from the rig floor, then a top fill of neat cement (its level not given)", "cite": [q(20, "cement top fell to 95 ft. from the rig floor. Waited on cement and top fill with neat cement")]}},
        ],
        "openHole": {"fromFt": 8509, "toFt": 9500, "sizeIn": 5.75, "cite": [q(8, "completed barefoot to 9,500 ft."), q(3, "5-3/4 in. Hole to 9,500 ft.")]},
        "surface": [{"kind": "Wellhead", "name": "13-5/8 in 3,000 × 5,000 psi wellhead", "cite": [q(30, "13-5/8 in. 3,000 psi x 5,000 psi wellhead")]}],
        "notes": [
            {"text": "7 in shoe: 8,509 ft in Table 4, 8,508 ft in the summary (p. 8).", "cite": [q(8, "The well was cased with 7 in. casing to a depth of 8,508 ft.")]},
        ],
    },
]


def sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def norm(text: str) -> str:
    text = text.replace("”", '"').replace("“", '"').replace("’", "'").replace("‘", "'").replace("�", "")
    return re.sub(r"\s+", " ", text).strip()


def pages_of(pdf: Path, work: Path) -> list[str]:
    out = work / pdf.stem
    subprocess.run(["swift", str(PAGES), str(pdf), str(out)], check=True, capture_output=True)
    return [norm(path.read_text(encoding="utf-8")) for path in sorted(out.glob("p*.txt"))]


def documents(key: str, folder: Path, work: Path) -> dict[str, list[str]]:
    source = SOURCES[key]
    path = next((candidate for candidate in folder.rglob("*") if candidate.is_file() and candidate.stat().st_size > 0 and sha(candidate) == source["sha256"]), None)
    if path is None:
        sys.exit(f"{key}: no file in {folder} has SHA-256 {source['sha256']} ({source['name']}, {source['url']})")
    if "members" not in source:
        return {"eowr": pages_of(path, work)}
    docs = {}
    with zipfile.ZipFile(path) as archive:
        for name, member in source["members"].items():
            target = work / f"{key}-{name}.pdf"
            target.write_bytes(archive.read(member))
            docs[name] = pages_of(target, work)
    return docs


def check(docs, cites, where):
    for cite in cites:
        page = docs[cite["doc"]][cite["page"] - 1]
        if norm(cite["quote"]) not in page:
            sys.exit(f"{where}: “{cite['quote']}” is not on {cite['doc']} p. {cite['page']}")


def number(text: str, euro: bool) -> float:
    return float(text.replace(".", "").replace(",", ".") if euro else text.replace(",", ""))


def survey_from_pages(docs, pages, fmt):
    """Rows MD, inclination, azimuth, TVD from a contractor's survey table, as printed."""
    euro = fmt == "eu"
    rows = []
    for page in pages:
        text = docs["eowr"][page - 1]
        full = re.findall(r"(?:MWD|\*\*TieIn) (-?[\d.,]+) (-?[\d.,]+) (-?[\d.,]+) (-?[\d.,]+)", text)
        if full:
            rows += [(number(md, euro), number(inc, euro), float(az), number(tvd, euro)) for md, inc, az, tvd in full]
            continue
        # Columns split by the text layer: the depths, then the inclinations, then the rest row by row.
        md = re.search(r"Measured Depth ([\d.,\s]+?) Inc \(deg\) ([\d.,\s]+?) End of Well", text)
        rest = re.findall(r"(-?[\d.]+) (-?[\d,]+\.\d) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (\d+\.\d{3})", text)
        if not md:
            sys.exit(f"survey p. {page}: no table found")
        mds, incs = md.group(1).split(), md.group(2).split()
        if not (len(mds) == len(incs) == len(rest)):
            sys.exit(f"survey p. {page}: {len(mds)} depths, {len(incs)} inclinations, {len(rest)} rows")
        rows += [(number(a, False), number(b, False), float(r[0]), number(r[1], False)) for a, b, r in zip(mds, incs, rest)]
    rows.sort()
    # Check: TVD by minimum curvature from MD, inclination and azimuth, against the printed TVD.
    tvd, worst = rows[0][3], 0.0
    for (md0, inc0, az0, _), (md1, inc1, az1, printed) in zip(rows, rows[1:]):
        i0, i1, a0, a1 = map(math.radians, (inc0, inc1, az0, az1))
        dogleg = math.acos(max(-1.0, min(1.0, math.cos(i1 - i0) - math.sin(i0) * math.sin(i1) * (1 - math.cos(a1 - a0)))))
        factor = 1.0 if dogleg < 1e-9 else 2 / dogleg * math.tan(dogleg / 2)
        tvd += (md1 - md0) / 2 * (math.cos(i0) + math.cos(i1)) * factor
        worst = max(worst, abs(tvd - printed))
    if worst > 0.6:
        sys.exit(f"survey: recomputed TVD differs from the printed TVD by {worst:.2f} ft")
    return [[md, inc, az] for md, inc, az, _ in rows], worst


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    folder = Path(sys.argv[1])
    wells = []
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for well in WELLS:
            docs = documents(well["id"], folder, work)
            where = well["label"]
            check(docs, well["datum"]["cite"] + well["tdCite"], where)
            for string in well["strings"]:
                check(docs, string["cite"], f"{where} {string['name']}")
                if string["hole"]:
                    check(docs, string["hole"]["cite"], f"{where} {string['name']} hole")
                if string["cement"]:
                    check(docs, string["cement"]["cite"], f"{where} {string['name']} cement")
            for item in (well["openHole"] and [well["openHole"]] or []) + well["surface"] + well["notes"]:
                check(docs, item["cite"], where)
            out = {key: value for key, value in well.items() if key != "survey"}
            survey = well["survey"]
            if survey and survey["from"] == "pages":
                stations, worst = survey_from_pages(docs, survey["pages"], survey["format"])
                out["survey"] = {"stations": stations, "pages": survey["pages"], "check": f"TVD recomputed by minimum curvature within {worst:.2f} ft of the printed TVD"}
            else:
                out["survey"] = survey
            wells.append(out)
            print(f"{where}: {len(well['strings'])} strings, every quote found" + (f", {len(out['survey']['stations'])} survey stations" if out["survey"] and "stations" in out["survey"] else ""))
    record = {
        "licence": "CC-BY-4.0",
        "note": "Depths in feet as each report gives them, measured from that well's rotary table / kelly bushing; diameters in inches. Each value carries the page it was read from (“cite”). Convert feet with 1200/3937 m per ft, as the 16A(78)-32 records are.",
        "sources": {key: {k: v for k, v in source.items()} for key, source in SOURCES.items()},
        "wells": wells,
    }
    OUT.write_text(json.dumps(record, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)}: {len(wells)} wells, {OUT.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
