import json
import math
from importlib.metadata import version
from pathlib import Path

from welleng.survey import Survey, SurveyHeader
from welleng.connector import Connector
from welleng.survey import from_connections


header = SurveyHeader(name="Synthetic well 01", azi_reference="grid")
vertical = Survey(md=[0, 1000], inc=[0, 0], azi=[90, 90], header=header, error_model=None)
inclined = Survey(md=[0, 1000], inc=[60, 60], azi=[90, 90], header=header, error_model=None)
assert math.isclose(float(vertical.tvd[-1]), 1000, abs_tol=1e-8)
assert math.isclose(float(inclined.tvd[-1]), 500, abs_tol=1e-8)
assert math.isclose(float(inclined.e[-1]), 866.0254037844386, abs_tol=1e-8)
print("Analytical vertical and 60-degree straight-course checks passed.")
output = Path(__file__).resolve().parents[2] / "packages/core/src"

def export_survey(value, filename, shape, source, provenance):
    interpolated = value.interpolate_survey(step=25)
    points = [{
        "mdM": round(float(measured_depth), 6),
        "tvdM": round(float(interpolated.tvd[index]), 6),
        "eastingM": round(float(interpolated.e[index]), 6),
        "northingM": round(float(interpolated.n[index]), 6),
        "inclinationDeg": round(float(interpolated.inc_deg[index]), 6),
        "azimuthDeg": round(float(interpolated.azi_grid_deg[index]), 6),
    } for index, measured_depth in enumerate(interpolated.md)]
    (output / filename).write_text(json.dumps({
        "provenance": provenance,
        "method": "minimum curvature",
        "engine": f"welleng {version('welleng')}",
        "shape": shape,
        "source": source,
        "stations": points,
    }, indent=2) + "\n")
    print(f"{shape}: MD {points[-1]['mdM']:.3f} m / TVD {points[-1]['tvdM']:.3f} m / {len(points)} stations")

source = "https://github.com/jonnymaserati/welleng/blob/main/examples/build_a_well_from_sections.py"
s_profile = Survey(md=[0, 600, 1100, 1600, 2100, 2600], inc=[0, 0, 45, 45, 10, 0], azi=[90] * 6, header=header, error_model=None)
export_survey(s_profile, "s-profile-data.json", "Build / hold / drop (S-profile)", source, "Synthetic adaptation; not measured field data")
first = Connector(pos1=[0, 0, 0], vec1=[0, 0, 1], md2=500, vec2=[0, 0, 1])
second = Connector(pos1=first.pos_target, vec1=first.vec_target, md1=first.md_target, inc2=30, azi2=90)
third = Connector(pos1=second.pos_target, vec1=second.vec_target, md1=second.md_target, pos2=[-800, 300, 1800], inc2=88, azi2=315, dls_design=4)
fourth = Connector(pos1=third.pos_target, vec1=third.vec_target, md1=third.md_target, md2=third.md_target + 500, inc2=90)
reference = from_connections([first, second, third, fourth], step=25)
export_survey(reference, "research-profile-data.json", "Published curved design example", source, "Reproduced open design example; not measured field data")