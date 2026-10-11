import hashlib
import json
from pathlib import Path

from openpyxl import load_workbook


root = Path(__file__).resolve().parents[2]
survey_path = Path("/tmp/subsurface-forge16a-survey.xlsx")
report_path = Path("/tmp/subsurface-forge16a-summary.pdf")
assert hashlib.sha256(survey_path.read_bytes()).hexdigest() == "ad03773329769f702f748c96244a9e1cba16cd1d762d4e8b93b8c8fea9d36b8d"
assert hashlib.sha256(report_path.read_bytes()).hexdigest() == "2b1886f8fceb8c83cbbb524bc27beaeb2e832116b4496bdf53cfa26bc65cdceb"
survey_url = "https://gdr.openei.org/files/1283/16A(78)-32%20Survey.xlsx"
report_url = "https://gdr.openei.org/files/1296/Drilling%20Summary%20Well%2016A(78)-32.pdf"
usft = 1200 / 3937
ft = 0.3048
stations = []
for row_number, row in enumerate(load_workbook(survey_path, data_only=True).active.values, start=1):
    if isinstance(row[1], (int, float)) and isinstance(row[2], (int, float)) and isinstance(row[6], (int, float)):
        stations.append({"mdM": row[2] * usft, "tvdM": row[6] * usft, "northingM": row[8] * usft, "eastingM": row[9] * usft, "inclinationDeg": row[3], "azimuthDeg": row[4], "sourceRow": row_number, "rawMdFt": row[2], "rawTvdFt": row[6]})
assert len(stations) == 422
assert stations[0]["rawMdFt"] == 0 and stations[-1]["rawMdFt"] == 10955
assert stations[-1]["rawTvdFt"] == 8558.83
assert all(right["mdM"] > left["mdM"] for left, right in zip(stations, stations[1:]))
coverage = stations[-1]["mdM"]

def record(id, name, kind, outside, inside, top_ft, bottom_ft, material, page, description):
    return {"id": id, "name": name, "kind": kind, "outerDiameterMm": outside, "innerDiameterMm": inside, "topDepthM": top_ft * ft, "bottomDepthM": min(bottom_ft * ft, coverage), "material": material, "description": description, "sourceUrl": report_url, "sourcePage": page, "rawBottomDepthFt": None if kind in ("Wellhead", "Valve") else bottom_ft, "dataStatus": "reported", "topDepthReported": kind == "Hole"}

components = [
    record("surface-casing", "Surface casing / 13 3/8 in", "Casing", 13.375 * 25.4, None, 0, 1629, "L80 / 68 lb/ft / BTC", 10, "Reported casing string. ID and joint tally are not supplied; surface end is depicted at reference zero, not a measured stick-up."),
    record("intermediate-casing", "Intermediate casing / 9 5/8 in", "Casing", 9.625 * 25.4, None, 0, 5110, "HCL80 / 40 lb/ft", 21, "Ran to 5113 ft, then picked up to 5110 ft before cementing. Source wording is retained; ID is unreported."),
    record("production-casing", "Production casing / 7 in", "Casing", 7 * 25.4, None, 0, 10787, "T95 / 38 lb/ft / JFELION", 67, "Installed full casing string after the planned liner hanger was retrieved. No production tubing string is documented here."),
    record("surface-hole", "Surface hole / 17 1/2 in", "Hole", 17.5 * 25.4, None, 28, 1629, "Drilled borehole", 10, "Reported drilled interval, not a steel component."),
    record("intermediate-hole", "Intermediate hole / 12 1/4 in", "Hole", 12.25 * 25.4, None, 1629, 5113, "Drilled borehole", 12, "Intermediate drilled hole before running casing."),
    record("production-hole", "Production hole / 8 3/4 in", "Hole", 8.75 * 25.4, None, 5113, 10987, "Granitic reservoir borehole", 22, "Reported drilling TD is 10987 ft; plotted path is limited to the workbook's last survey at 10955 ft."),
    record("surface-cement", "Surface cement interval", "Cement", 17.5 * 25.4, 13.375 * 25.4, 0, 1629, "Cement formulation not reported", 10, "Cemented to surface; floats failed. Nominal annular bounds use reported hole and casing diameters, not a cement bond measurement."),
    record("production-cement", "Production cement interval", "Cement", None, 7 * 25.4, 0, 10787, "RC ThermaLite-HT / 12.97 ppg", 67, "433 bbl pumped, 15 bbl returned; cemented from 10787 ft to surface. Outer annular bounds are unreported in the upper cased section, so no cement envelope is inferred."),
    record("wellhead", "Thread-on wellhead", "Wellhead", None, None, 0, 0, "Not reported", 71, "Reported installed on 7-inch casing. Manufacturer geometry and dimensions are unavailable; shown as a location marker only."),
    record("master-valve", "Master valve", "Valve", None, None, 0, 0, "Not reported", 71, "Reported installed when securing the well. No pressure rating or dimensions are inferred."),
]
contact_md = 4700 * ft
lower = max((point for point in stations if point["mdM"] <= contact_md), key=lambda point: point["mdM"])
upper = min((point for point in stations if point["mdM"] >= contact_md), key=lambda point: point["mdM"])
fraction = (contact_md - lower["mdM"]) / (upper["mdM"] - lower["mdM"])
contact_tvd = lower["tvdM"] + fraction * (upper["tvdM"] - lower["tvdM"])
layers = [
    {"id": "sediments", "name": "Sedimentary overburden", "lithology": "Sediments", "topTvdM": 30 * usft, "bottomTvdM": contact_tvd, "densityKgM3": None, "porosityPct": None, "color": "#d9c9a7", "sourceUrl": "https://gdr.openei.org/submissions/1283", "interpretation": "Approximate contact at 4700 ft MD projected through the observed survey; planar regional extent is conceptual."},
    {"id": "granite", "name": "Crystalline granite reservoir", "lithology": "Granite / metamorphic basement", "topTvdM": contact_tvd, "bottomTvdM": stations[-1]["tvdM"], "densityKgM3": None, "porosityPct": None, "color": "#b4bec4", "sourceUrl": "https://gdr.openei.org/submissions/1283", "interpretation": "Reported crystalline host rock. No density, porosity, regional fault geometry or lateral contact surface is inferred."},
]
data = {"id": "utah-forge-16a-2021", "revision": 1, "units": "m", "provenance": "documented", "trajectoryName": "Utah FORGE 16A(78)-32 / observed survey", "trajectorySource": "https://gdr.openei.org/submissions/1283", "totalDepthM": coverage, "casingBottomM": 10787 * ft, "depthDatum": "GE + RKB / MSL", "referenceElevationMslM": 5444 * usft, "groundTvdM": 30 * usft, "reportedTotalDepthFt": 10987, "surveyCoverageFt": 10955, "survey": stations, "formations": layers, "components": components, "license": "CC-BY-4.0", "attribution": "McLennan et al. (2021), DOI 10.15121/1776602; Winkler, Swearingen and McLennan (2021), GDR 1296, Energy and Geoscience Institute, University of Utah.", "sourceUnits": "Survey metadata declares US survey feet (1200/3937 m); report drilling depths are labelled feet, converted using 0.3048 m and preserved verbatim.", "coverageNote": "Observed survey ends at 10955 ft; reported drilled TD is 10987 ft. No extrapolation. Planned liner hanger and temporary DFIT packer were retrieved; not shown as installed equipment.", "hashes": {"surveyXlsx": hashlib.sha256(survey_path.read_bytes()).hexdigest(), "drillingReportPdf": hashlib.sha256(report_path.read_bytes()).hexdigest()}}
(root / "packages/core/src/forge-data.json").write_text(json.dumps(data, indent=2) + "\n")
print(f"Imported {len(stations)} observed survey stations and {len(components)} documented records. No synthetic joint or tool tally added.")