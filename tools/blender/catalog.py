"""Render the illustrative well-component catalog.

Every catalog entry produces a transparent Cycles thumbnail (PNG) and, for
equipment that is placed at a point, a GLB model consumed by the 3D assembler.
Models are normalised: axis along +Z (glTF +Y), top at the origin, body outside
radius 1.0. Consumers scale by the entered outside diameter. Geometry is
illustrative only; it is not manufacturer CAD.
"""

import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

root = Path(__file__).resolve().parents[2]
output = root / "packages/react/assets/well-components"
output.mkdir(parents=True, exist_ok=True)
only = set(sys.argv[sys.argv.index("--") + 1:]) if "--" in sys.argv else set()
SIZE = 360
TAU = math.tau


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.resolution_x = SIZE
    scene.render.resolution_y = SIZE
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    world = bpy.data.worlds.new("Studio")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.82, 0.86, 0.88, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.55
    scene.world = world
    return scene


def material(name, color, metallic=0.0, roughness=0.32, coat=0.0, noise=0.0):
    value = bpy.data.materials.new(name)
    value.use_nodes = True
    nodes = value.node_tree.nodes
    shader = nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1.0)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Coat Weight"].default_value = coat
    if noise:
        texture = nodes.new("ShaderNodeTexNoise")
        texture.inputs["Scale"].default_value = 38
        texture.inputs["Detail"].default_value = 8
        bump = nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = noise
        value.node_tree.links.new(texture.outputs["Fac"], bump.inputs["Height"])
        value.node_tree.links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    value.diffuse_color = (*color, 1.0)
    return value


def materials():
    return {
        "steel": material("Machined steel", (0.52, 0.56, 0.58), 0.9, 0.24),
        "dark": material("Forged steel", (0.16, 0.18, 0.2), 0.85, 0.36),
        "conductor": material("Conductor paint", (0.24, 0.27, 0.29), 0.55, 0.42, 0.2),
        "surface": material("Surface casing paint", (0.05, 0.42, 0.36), 0.5, 0.34, 0.4),
        "intermediate": material("Intermediate casing paint", (0.16, 0.3, 0.58), 0.5, 0.34, 0.4),
        "production": material("Production casing paint", (0.68, 0.27, 0.15), 0.5, 0.34, 0.4),
        "liner": material("Liner paint", (0.47, 0.25, 0.55), 0.5, 0.34, 0.4),
        "tubing": material("Tubing paint", (0.75, 0.55, 0.12), 0.55, 0.3, 0.4),
        "cement": material("Cement", (0.62, 0.64, 0.62), 0.0, 0.9, 0.0, 0.35),
        "rubber": material("Elastomer", (0.03, 0.03, 0.035), 0.0, 0.62),
        "brass": material("Brass", (0.8, 0.58, 0.24), 1.0, 0.25),
        "red": material("Actuator red", (0.72, 0.08, 0.06), 0.2, 0.3, 0.6),
        "glass": material("Gauge housing", (0.14, 0.42, 0.5), 0.7, 0.18, 0.6),
        "sand": material("Gravel pack sand", (0.58, 0.43, 0.24), 0.0, 0.88, 0.0, 0.45),
        "yellow": material("BOP safety yellow", (0.86, 0.62, 0.08), 0.25, 0.38, 0.35),
    }


def link(obj, finish):
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(finish)
    return obj


def lathe(name, profile, finish, segments=96, span=TAU, start=0.0, bevel=0.0):
    """Revolve a closed (radius, z) polygon around Z; span < tau leaves a cutaway."""
    closed = span >= TAU - 1e-6
    steps = segments if closed else segments + 1
    count = len(profile)
    verts = []
    for step in range(steps):
        angle = start + span * step / segments
        c, s = math.cos(angle), math.sin(angle)
        verts.extend((r * c, r * s, z) for r, z in profile)
    faces = []
    for step in range(segments):
        a = step * count
        b = ((step + 1) % steps) * count
        for index in range(count):
            nxt = (index + 1) % count
            faces.append((a + index, a + nxt, b + nxt, b + index))
    if not closed:
        faces.append(tuple(range(count))[::-1])
        last = (steps - 1) * count
        faces.append(tuple(last + index for index in range(count)))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    mesh.update()
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    obj = link(bpy.data.objects.new(name, mesh), finish)
    if bevel:
        modifier = obj.modifiers.new("Edge", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
        modifier.limit_method = "ANGLE"
    return obj


def sleeve_profile(outside, inside, top, bottom):
    return [(outside, top), (outside, bottom), (inside, bottom), (inside, top)]


def sleeve(name, outside, inside, top, bottom, finish, cut=True, bevel=0.012):
    span = TAU * 0.72 if cut else TAU
    return lathe(name, sleeve_profile(outside, inside, top, bottom), finish, span=span, start=TAU * 0.07 if cut else 0, bevel=bevel)


def box(name, size, location, finish, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(scale=True)
    obj.data.materials.append(finish)
    modifier = obj.modifiers.new("Edge", "BEVEL")
    modifier.width = min(size) * 0.08
    modifier.segments = 3
    return obj


def cylinder(name, radius, depth, location, finish, rotation=(0, 0, 0), vertices=48):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, location=location, rotation=rotation, vertices=vertices)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(finish)
    bpy.ops.object.shade_smooth()
    return obj


def torus(name, major, minor, location, finish, rotation=(0, 0, 0), minor_segments=12):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, location=location, rotation=rotation, major_segments=48, minor_segments=minor_segments)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(finish)
    bpy.ops.object.shade_smooth()
    return obj


def bolt_ring(prefix, radius, z, count, finish, bolt=0.06, height=0.5):
    return [cylinder(f"{prefix} bolt {i}", bolt, height, (radius * math.cos(TAU * i / count), radius * math.sin(TAU * i / count), z), finish, vertices=12) for i in range(count)]


def handwheel(prefix, location, axis, finish, size=0.45):
    rotation = (0, math.pi / 2, 0) if axis == "x" else (math.pi / 2, 0, 0) if axis == "y" else (0, 0, 0)
    wheel = torus(f"{prefix} wheel", size, size * 0.09, location, finish, rotation)
    spokes = []
    for i in range(3):
        angle = TAU * i / 3
        if axis == "x":
            spoke_rot = (angle, 0, 0)
            spoke = cylinder(f"{prefix} spoke {i}", size * 0.05, size * 2, location, finish, (spoke_rot[0], 0, 0), 8)
        else:
            spoke = cylinder(f"{prefix} spoke {i}", size * 0.05, size * 2, location, finish, (0, angle, 0), 8)
        spokes.append(spoke)
    return [wheel, *spokes]


# ---------------------------------------------------------------- builders

def build_casing(m, finish):
    body = sleeve("Pipe body", 1.0, 0.86, -0.6, -5.2, m[finish])
    coupling = sleeve("Coupling", 1.12, 0.86, 0.0, -0.75, m[finish])
    stencil = sleeve("Pin thread band", 1.005, 0.99, -0.75, -0.95, m["steel"], bevel=0)
    return [body, coupling, stencil]


def build_tubing(m):
    body = sleeve("Tubing body", 1.0, 0.8, -0.8, -6.0, m["tubing"])
    upset = sleeve("Upset coupling", 1.28, 0.8, 0.0, -0.95, m["tubing"])
    thread = sleeve("Thread band", 1.01, 0.99, -0.95, -1.12, m["steel"], bevel=0)
    return [body, upset, thread]


def build_cement(m):
    sheath = sleeve("Cement sheath", 1.0, 0.7, 0.0, -4.2, m["cement"], bevel=0.0)
    pipe = sleeve("Casing ghost", 0.69, 0.6, 0.25, -4.5, m["steel"])
    return [sheath, pipe]


def build_liner(m):
    hanger = lathe("Liner hanger", [(1.06, 0.0), (1.06, -0.4), (1.16, -0.55), (1.16, -1.35), (1.0, -1.55), (1.0, -5.0), (0.86, -5.0), (0.86, 0.0)], m["liner"], span=TAU * 0.72, start=TAU * 0.07, bevel=0.01)
    parts = [hanger]
    for i in range(6):
        angle = TAU * 0.07 + TAU * 0.72 * (i + 0.5) / 6
        slip = box(f"Slip {i}", (0.16, 0.34, 0.7), (1.2 * math.cos(angle), 1.2 * math.sin(angle), -0.95), m["dark"], (0, 0, angle))
        parts.append(slip)
    parts.append(sleeve("Packoff", 1.1, 1.0, -1.6, -1.95, m["rubber"], bevel=0.02))
    return parts


def build_packer(m):
    mandrel = sleeve("Mandrel", 0.55, 0.42, 0.4, -5.4, m["steel"])
    upper = lathe("Upper cone", [(0.55, 0.0), (0.8, 0.0), (0.98, -0.5), (0.98, -0.9), (0.55, -0.9)], m["dark"], span=TAU * 0.72, start=TAU * 0.07, bevel=0.015)
    lower = lathe("Lower cone", [(0.55, -3.6), (0.98, -3.6), (0.98, -4.0), (0.8, -4.5), (0.55, -4.5)], m["dark"], span=TAU * 0.72, start=TAU * 0.07, bevel=0.015)
    parts = [mandrel, upper, lower]
    for i, z in enumerate((-1.05, -1.75, -2.45)):
        parts.append(lathe(f"Element {i}", [(0.56, z), (0.96, z - 0.05), (1.0, z - 0.3), (0.96, z - 0.55), (0.56, z - 0.6)], m["rubber"], span=TAU * 0.72, start=TAU * 0.07))
    for i in range(8):
        angle = TAU * 0.07 + TAU * 0.72 * (i + 0.5) / 8
        parts.append(box(f"Slip {i}", (0.12, 0.3, 0.42), (0.92 * math.cos(angle), 0.92 * math.sin(angle), -3.3), m["brass"], (0, 0, angle)))
    return parts


def build_sssv(m):
    profile = [(0.62, 0.3), (0.82, 0.0), (0.98, -0.4), (1.0, -0.7), (1.0, -3.9), (0.98, -4.2), (0.82, -4.6), (0.62, -4.9), (0.5, -4.9), (0.5, 0.3)]
    body = lathe("Valve body", profile, m["steel"], span=TAU * 0.72, start=TAU * 0.07, bevel=0.01)
    band = sleeve("Hydraulic chamber", 1.02, 0.9, -1.2, -2.1, m["red"])
    flapper = cylinder("Flapper", 0.48, 0.08, (0, 0, -3.0), m["brass"], (0.45, 0, 0))
    line = cylinder("Control line", 0.06, 6.4, (1.12, 0, -1.2), m["brass"], vertices=12)
    port = cylinder("Control port", 0.11, 0.3, (1.06, 0, -1.6), m["dark"], (0, math.pi / 2, 0), 16)
    return [body, band, flapper, line, port]


def build_nipple(m):
    profile = [(0.8, 0.0), (1.0, -0.3), (1.0, -2.2), (0.8, -2.5), (0.72, -2.5), (0.72, -1.7), (0.6, -1.55), (0.6, -1.15), (0.72, -1.0), (0.72, 0.0)]
    body = lathe("Nipple body", profile, m["steel"], span=TAU * 0.72, start=TAU * 0.07, bevel=0.01)
    seal = sleeve("Seal bore", 0.6, 0.57, -1.18, -1.52, m["brass"], bevel=0)
    return [body, seal]


def build_glm(m):
    mandrel = sleeve("Mandrel", 0.62, 0.5, 0.4, -6.0, m["tubing"])
    pocket = cylinder("Side pocket", 0.42, 3.6, (0.78, 0, -2.8), m["tubing"])
    pocket.scale = (1.0, 0.82, 1.0)
    top_cap = bpy.ops.mesh.primitive_uv_sphere_add(radius=0.42, location=(0.78, 0, -1.0))
    cap_top = bpy.context.object
    cap_top.scale = (1, 0.82, 0.9)
    cap_top.data.materials.append(m["tubing"])
    bpy.ops.object.shade_smooth()
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.42, location=(0.78, 0, -4.6))
    cap_bottom = bpy.context.object
    cap_bottom.scale = (1, 0.82, 0.9)
    cap_bottom.data.materials.append(m["tubing"])
    bpy.ops.object.shade_smooth()
    valve = cylinder("Gas lift valve", 0.16, 1.6, (1.02, -0.18, -2.8), m["brass"], vertices=24)
    latch = torus("Latch", 0.17, 0.04, (1.02, -0.18, -2.0), m["dark"])
    del top_cap
    return [mandrel, pocket, cap_top, cap_bottom, valve, latch]


def build_gauge(m):
    carrier = sleeve("Carrier", 0.68, 0.52, 0.2, -4.4, m["steel"])
    housing = cylinder("Gauge housing", 0.26, 2.6, (0.86, 0, -2.0), m["glass"], vertices=32)
    nose = cylinder("Sensor nose", 0.16, 0.5, (0.86, 0, -0.45), m["brass"], vertices=24)
    clamps = [sleeve(f"Clamp {i}", 1.2, 0.69, z, z - 0.25, m["dark"], cut=False) for i, z in enumerate((-0.9, -3.0))]
    cable = cylinder("Cable", 0.05, 2.0, (0.86, 0, 0.6), m["dark"], vertices=10)
    return [carrier, housing, nose, *clamps, cable]


def build_centralizer(m):
    pipe = sleeve("Casing", 0.62, 0.52, 0.6, -5.6, m["production"])
    top = sleeve("Top collar", 0.72, 0.62, 0.0, -0.45, m["steel"], cut=False)
    bottom = sleeve("Bottom collar", 0.72, 0.62, -4.55, -5.0, m["steel"], cut=False)
    parts = [pipe, top, bottom]
    for i in range(6):
        angle = TAU * i / 6
        curve = bpy.data.curves.new(f"Bow {i}", "CURVE")
        curve.dimensions = "3D"
        curve.bevel_depth = 0.035
        curve.bevel_resolution = 2
        spline = curve.splines.new("BEZIER")
        spline.bezier_points.add(2)
        for point, (radius, z) in zip(spline.bezier_points, ((0.7, -0.4), (1.0, -2.5), (0.7, -4.6))):
            point.co = (radius * math.cos(angle), radius * math.sin(angle), z)
            point.handle_left_type = point.handle_right_type = "AUTO"
        obj = bpy.data.objects.new(f"Bow {i}", curve)
        bpy.context.scene.collection.objects.link(obj)
        obj.data.materials.append(m["steel"])
        obj.scale = (1.0, 1.0, 1.0)
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.convert(target="MESH")
        obj.select_set(False)
        parts.append(obj)
    return parts


def build_shoe(m):
    profile = [(1.0, 0.0), (1.0, -2.2)]
    for i in range(1, 13):
        angle = math.pi / 2 * i / 12
        profile.append((math.cos(angle) * 1.0, -2.2 - math.sin(angle) * 1.1))
    profile[-1] = (0.18, -3.28)
    profile += [(0.18, -2.1), (0.62, -1.7), (0.62, -1.0), (0.86, -0.7), (0.86, 0.0)]
    body = lathe("Shoe body", profile, m["cement"], span=TAU * 0.72, start=TAU * 0.07)
    collar = sleeve("Steel collar", 1.04, 0.86, 0.0, -1.4, m["dark"])
    ball = bpy.ops.mesh.primitive_uv_sphere_add(radius=0.32, location=(0, 0, -1.3))
    valve = bpy.context.object
    valve.data.materials.append(m["brass"])
    bpy.ops.object.shade_smooth()
    del ball
    return [body, collar, valve]


def build_wellhead(m):
    parts = []
    parts.append(lathe("A-section casing head", [(0.68, 0.0), (1.42, 0.0), (1.42, -0.3), (1.08, -0.44), (1.0, -1.32), (1.42, -1.48), (1.42, -1.82), (0.86, -1.82), (0.6, -1.55), (0.6, 0.0)], m["dark"], bevel=0.02))
    parts.append(sleeve("Surface casing stub", 0.86, 0.68, -1.82, -3.25, m["surface"], cut=False))
    parts.append(sleeve("Landing base flange", 1.5, 0.86, -1.72, -2.05, m["steel"], cut=False))
    parts += bolt_ring("Top casing head", 1.2, -0.12, 12, m["brass"], 0.06, 0.34)
    parts += bolt_ring("Base casing head", 1.28, -1.88, 12, m["brass"], 0.065, 0.38)
    for side in (1, -1):
        parts.append(cylinder(f"Casing head outlet {side}", 0.28, 0.92, (side * 1.36, 0, -0.95), m["dark"], (0, math.pi / 2, 0), 32))
        parts.append(cylinder(f"Casing head flange {side}", 0.46, 0.16, (side * 1.85, 0, -0.95), m["steel"], (0, math.pi / 2, 0), 32))
        parts.append(box(f"Casing head valve {side}", (0.5, 0.62, 0.56), (side * 2.22, 0, -0.95), m["red"]))
        parts += handwheel(f"Casing head valve {side}", (side * 2.22, -0.76, -0.95), "y", m["dark"], 0.25)
    return parts


def build_tree(m):
    parts = []
    parts.append(lathe("Tubing head adapter", [(0.4, 0.0), (1.3, 0.0), (1.3, 0.3), (0.7, 0.45), (0.7, 0.7), (0.4, 0.7)], m["steel"], bevel=0.02))
    for i, z in enumerate((1.25, 2.55)):
        parts.append(box(f"Master valve {i}", (1.2, 1.1, 1.0), (0, 0, z), m["red"]))
        parts.append(cylinder(f"Master stem {i}", 0.08, 0.9, (0, -0.95, z), m["steel"], (math.pi / 2, 0, 0), 12))
        parts += handwheel(f"Master {i}", (0, -1.45, z), "y", m["dark"], 0.42)
        parts.append(cylinder(f"Master flange {i}", 0.62, 0.16, (0, 0, z + 0.6), m["steel"]))
    parts.append(box("Cross", (1.1, 1.1, 1.0), (0, 0, 3.75), m["dark"]))
    parts.append(cylinder("Wing", 0.32, 1.7, (1.35, 0, 3.75), m["steel"], (0, math.pi / 2, 0), 32))
    parts.append(box("Wing valve", (0.9, 0.95, 0.9), (2.0, 0, 3.75), m["red"]))
    parts += handwheel("Wing", (2.0, -0.9, 3.75), "y", m["dark"], 0.34)
    parts.append(cylinder("Choke", 0.26, 1.0, (2.95, 0, 3.75), m["brass"], (0, math.pi / 2, 0), 24))
    parts.append(box("Swab valve", (1.0, 0.95, 0.9), (0, 0, 4.85), m["red"]))
    parts += handwheel("Swab", (0, -0.9, 4.85), "y", m["dark"], 0.36)
    parts.append(lathe("Tree cap", [(0.3, 5.3), (0.66, 5.3), (0.66, 5.7), (0.42, 5.95), (0.3, 5.95)], m["steel"], bevel=0.02))
    parts.append(cylinder("Pressure gauge", 0.22, 0.12, (-0.62, 0, 5.75), m["glass"], (0, math.pi / 2, 0), 32))
    return parts


def sphere(name, radius, location, finish, scale=(1, 1, 1), segments=32):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=max(8, segments // 2), radius=radius, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(finish)
    bpy.ops.object.shade_smooth()
    return obj


def side_gate(prefix, x, z, m, stem_axis="x", red=True, wheel=True):
    side = 1 if x >= 0 else -1
    parts = [
        cylinder(f"{prefix} neck", 0.22, 0.95, (x - side * 0.32, 0, z), m["steel"], (0, math.pi / 2, 0), 32),
        cylinder(f"{prefix} flange", 0.38, 0.18, (x + side * 0.15, 0, z), m["steel"], (0, math.pi / 2, 0), 32),
        box(f"{prefix} gate", (0.58, 0.68, 0.62), (x + side * 0.48, 0, z), m["red" if red else "dark"]),
        cylinder(f"{prefix} stem", 0.055, 0.62, (x + side * 0.48, -0.58, z), m["steel"], (math.pi / 2, 0, 0), 12),
    ]
    if wheel:
        parts += handwheel(prefix, (x + side * 0.48, -0.98, z), "y", m["dark"], 0.28)
    return parts


def lock_screws(prefix, radius, z, count, m, size=0.055, length=0.34):
    parts = []
    for i in range(count):
        a = TAU * i / count
        parts.append(cylinder(f"{prefix} lock screw {i}", size, length, (radius * math.cos(a), radius * math.sin(a), z), m["brass"], (0, math.pi / 2, a), 10))
    return parts


def slip_blocks(prefix, radius, z, count, m, height=0.48, finish="brass"):
    parts = []
    for i in range(count):
        a = TAU * 0.07 + TAU * 0.72 * (i + 0.5) / count
        parts.append(box(f"{prefix} slip {i}", (0.12, 0.28, height), (radius * math.cos(a), radius * math.sin(a), z), m[finish], (0, 0, a)))
    return parts


def port_ring(prefix, radius, z, count, m, finish="dark", size=0.075):
    parts = []
    for i in range(count):
        a = TAU * 0.07 + TAU * 0.72 * (i + 0.5) / count
        parts.append(cylinder(f"{prefix} port {i}", size, 0.08, (radius * math.cos(a), radius * math.sin(a), z), m[finish], (0, math.pi / 2, a), 16))
    return parts


def build_casing_spool(m):
    parts = [lathe("Casing spool", [(0.72, 0.0), (1.34, 0.0), (1.34, -0.28), (0.98, -0.42), (0.98, -1.75), (1.34, -1.9), (1.34, -2.18), (0.72, -2.18)], m["steel"], bevel=0.018)]
    parts += bolt_ring("Top spool", 1.17, -0.14, 12, m["brass"], 0.055, 0.36)
    parts += bolt_ring("Bottom spool", 1.17, -2.04, 12, m["brass"], 0.055, 0.36)
    for side in (1, -1):
        parts += side_gate(f"Casing outlet {side}", side * 1.22, -1.1, m, red=False)
    return parts


def build_tubing_head(m):
    body = lathe("Tubing head bowl", [(0.5, 0.0), (1.28, 0.0), (1.28, -0.3), (0.96, -0.45), (0.96, -1.92), (1.2, -2.08), (1.2, -2.38), (0.64, -2.38), (0.64, -1.65), (0.38, -0.55), (0.38, 0.0)], m["dark"], span=TAU * 0.72, start=TAU * 0.07, bevel=0.016)
    bowl = lathe("Polished bowl", [(0.4, -0.2), (0.74, -0.5), (0.58, -1.38), (0.44, -1.72)], m["brass"], span=TAU * 0.72, start=TAU * 0.07, bevel=0)
    parts = [body, bowl]
    parts += bolt_ring("Tubing head upper", 1.1, -0.12, 12, m["brass"], 0.05, 0.32)
    parts += lock_screws("Tubing head", 1.1, -0.52, 10, m)
    for side in (1, -1):
        parts += side_gate(f"Tubing outlet {side}", side * 1.12, -1.3, m, red=True, wheel=True)
    return parts


def build_tubing_hanger(m):
    parts = [lathe("Mandrel hanger", [(0.42, 0.0), (0.82, 0.0), (0.92, -0.28), (0.82, -0.62), (0.68, -1.35), (0.52, -1.58), (0.42, -1.58)], m["steel"], span=TAU * 0.82, start=TAU * 0.02, bevel=0.012)]
    for i, z in enumerate((-0.46, -0.76, -1.06)):
        parts.append(sleeve(f"Seal ring {i}", 0.86, 0.68, z, z - 0.12, m["rubber"], cut=False, bevel=0.01))
    parts.append(sleeve("Lift thread neck", 0.46, 0.32, 0.32, 0.0, m["steel"], cut=False))
    parts.append(sleeve("Tubing pup", 0.46, 0.34, -1.58, -3.1, m["tubing"], cut=False))
    parts.append(cylinder("Control line port", 0.08, 0.5, (0.82, 0, -0.55), m["brass"], (0, math.pi / 2, 0), 16))
    return parts


def build_horizontal_tree(m):
    parts = [box("Horizontal tree block", (1.2, 1.05, 1.45), (0, 0, -1.0), m["dark"]), cylinder("Vertical bore", 0.34, 2.5, (0, 0, -1.0), m["steel"], vertices=48)]
    parts.append(lathe("Crown plug cap", [(0.35, 0.0), (0.72, 0.0), (0.72, -0.26), (0.48, -0.42), (0.35, -0.42)], m["steel"], bevel=0.015))
    parts.append(cylinder("Production wing", 0.32, 2.4, (1.45, 0, -1.0), m["steel"], (0, math.pi / 2, 0), 40))
    parts.append(box("Wing gate", (0.85, 0.92, 0.86), (2.2, 0, -1.0), m["red"]))
    parts += handwheel("Horizontal wing", (2.2, -0.85, -1.0), "y", m["dark"], 0.32)
    parts.append(box("Side choke body", (0.58, 0.58, 0.5), (2.95, 0, -1.0), m["brass"]))
    parts.append(cylinder("Flowline hub", 0.28, 0.8, (3.45, 0, -1.0), m["steel"], (0, math.pi / 2, 0), 32))
    parts.append(box("Crossover valve", (0.82, 0.88, 0.78), (0, -1.05, -1.55), m["red"]))
    parts += handwheel("Crossover", (0, -1.7, -1.55), "y", m["dark"], 0.3)
    return parts


def build_bop_stack(m):
    parts = [lathe("Annular preventer", [(0.48, 0.0), (0.9, 0.0), (1.08, -0.28), (1.0, -0.78), (0.78, -1.05), (0.42, -1.18), (0.34, -1.18), (0.34, 0.0)], m["yellow"], bevel=0.018)]
    for j, z in enumerate((-1.55, -2.55, -3.55)):
        parts.append(box(f"Ram body {j}", (1.75, 1.1, 0.62), (0, 0, z), m["red" if j != 1 else "dark"]))
        for side in (1, -1):
            parts.append(box(f"Ram bonnet {j} {side}", (0.72, 0.82, 0.48), (side * 1.2, 0, z), m["dark"]))
            parts.append(cylinder(f"Bonnet cap {j} {side}", 0.2, 0.18, (side * 1.63, 0, z), m["steel"], (0, math.pi / 2, 0), 24))
    parts.append(sleeve("BOP bore", 0.42, 0.28, 0.08, -4.0, m["steel"]))
    parts.append(cylinder("Choke line", 0.09, 2.7, (1.42, 0.48, -2.1), m["steel"], vertices=16))
    parts.append(cylinder("Kill line", 0.09, 2.7, (-1.42, -0.48, -2.6), m["steel"], vertices=16))
    return parts


def build_tieback_casing(m):
    parts = build_casing(m, "production")
    parts.append(lathe("Tieback seal stem", [(0.56, -4.35), (0.76, -4.35), (0.76, -5.45), (0.62, -5.95), (0.5, -5.95), (0.5, -4.35)], m["steel"], span=TAU * 0.72, start=TAU * 0.07, bevel=0.01))
    for z in (-4.65, -5.0, -5.35):
        parts.append(sleeve("Tieback seal", 0.78, 0.63, z, z - 0.1, m["rubber"], cut=False))
    return parts


def build_drilling_liner(m):
    parts = [lathe("Drilling liner hanger", [(0.82, 0.0), (1.06, 0.0), (1.16, -0.45), (1.12, -1.35), (0.96, -1.62), (0.96, -5.0), (0.78, -5.0), (0.78, 0.0)], m["intermediate"], span=TAU * 0.72, start=TAU * 0.07, bevel=0.012)]
    parts += slip_blocks("Hydraulic hanger", 1.18, -0.9, 8, m, height=0.58, finish="dark")
    parts.append(sleeve("Hydraulic piston band", 1.06, 0.92, -1.4, -1.85, m["steel"]))
    return parts


def build_guide_shoe(m):
    parts = [lathe("Guide shoe nose", [(0.86, 0.0), (1.0, 0.0), (1.0, -1.55), (0.92, -2.0), (0.62, -2.55), (0.18, -2.92), (0.12, -2.98), (0.12, -1.9), (0.6, -1.2), (0.78, -0.6), (0.78, 0.0)], m["cement"], span=TAU * 0.72, start=TAU * 0.07, bevel=0.01), sleeve("Guide collar", 1.04, 0.86, 0.0, -1.0, m["steel"])]
    parts += port_ring("Side jet", 0.88, -1.55, 6, m, "dark", 0.06)
    return parts


def build_float_collar(m):
    parts = [sleeve("Float collar", 1.0, 0.68, 0.0, -2.4, m["steel"]), sleeve("Cement fill", 0.66, 0.26, -0.25, -2.15, m["cement"], bevel=0.0)]
    parts.append(cylinder("Flapper plate", 0.42, 0.08, (0, 0, -1.22), m["brass"], (0.7, 0.15, 0), 32))
    parts.append(torus("Valve seat", 0.37, 0.035, (0, 0, -1.18), m["dark"]))
    return parts


def build_landing_collar(m):
    parts = [sleeve("Landing collar", 1.0, 0.7, 0.0, -2.35, m["steel"]), lathe("Baffle seat", [(0.35, -1.0), (0.72, -1.0), (0.72, -1.3), (0.45, -1.55), (0.35, -1.55)], m["brass"], span=TAU * 0.72, start=TAU * 0.07)]
    parts.append(sleeve("Plug bore", 0.48, 0.35, -1.05, -1.5, m["cement"], bevel=0.0))
    return parts


def build_rigid_centralizer(m):
    parts = [sleeve("Casing joint", 0.6, 0.5, 0.4, -5.2, m["production"]), sleeve("Rigid top ring", 0.72, 0.6, 0.0, -0.35, m["steel"], cut=False), sleeve("Rigid bottom ring", 0.72, 0.6, -4.45, -4.8, m["steel"], cut=False)]
    for i in range(6):
        a = TAU * i / 6
        parts.append(box(f"Spiral blade {i}", (0.16, 0.42, 3.8), (0.88 * math.cos(a), 0.88 * math.sin(a), -2.4), m["steel"], (0.28, 0.0, a + 0.45)))
    return parts


def build_stage_tool(m):
    parts = [sleeve("Stage tool body", 1.0, 0.66, 0.0, -3.4, m["steel"]), sleeve("Shift sleeve", 0.68, 0.5, -0.55, -2.35, m["brass"])]
    parts += port_ring("Circulating", 0.88, -1.55, 10, m, "dark", 0.09)
    parts.append(lathe("Opening seat", [(0.34, -2.55), (0.62, -2.55), (0.62, -2.85), (0.42, -3.05), (0.34, -3.05)], m["dark"], span=TAU * 0.72, start=TAU * 0.07))
    return parts


def build_cement_basket(m):
    parts = [sleeve("Basket casing", 0.46, 0.36, 0.35, -3.5, m["production"], cut=False), sleeve("Basket collar", 0.62, 0.46, -1.7, -2.05, m["steel"], cut=False)]
    for i in range(12):
        a = TAU * i / 12
        parts.append(box(f"Basket petal {i}", (0.18, 0.03, 1.45), (0.82 * math.cos(a), 0.82 * math.sin(a), -1.55), m["cement"], (0.72, 0, a)))
        parts.append(cylinder(f"Basket rib {i}", 0.018, 1.45, (0.82 * math.cos(a), 0.82 * math.sin(a), -1.55), m["steel"], (0.72, 0, a), 8))
    return parts


def build_liner_top_packer(m):
    parts = [sleeve("Liner hanger mandrel", 0.58, 0.44, 0.25, -4.2, m["liner"]), sleeve("Packer element", 0.98, 0.58, -1.05, -1.85, m["rubber"]), sleeve("Hold-down cone", 0.82, 0.58, -0.55, -1.0, m["dark"]), sleeve("Hanger body", 0.88, 0.58, -2.05, -3.2, m["liner"])]
    parts += slip_blocks("Hold down", 1.0, -0.45, 8, m, height=0.34, finish="brass")
    parts += slip_blocks("Liner hanger", 0.94, -2.7, 8, m, height=0.42, finish="dark")
    return parts


def build_no_go_nipple(m):
    parts = build_nipple(m)
    parts.append(lathe("No-go shoulder", [(0.42, -2.05), (0.78, -2.05), (0.78, -2.28), (0.46, -2.46), (0.42, -2.46)], m["brass"], span=TAU * 0.72, start=TAU * 0.07))
    return parts


def build_chemical_injection_mandrel(m):
    parts = [sleeve("Injection mandrel", 0.62, 0.5, 0.25, -5.2, m["tubing"]), cylinder("Injection valve", 0.22, 1.1, (0.82, 0, -2.0), m["brass"], vertices=24), cylinder("Capillary line", 0.035, 5.4, (1.05, 0.12, -2.4), m["steel"], vertices=8), cylinder("Check port", 0.08, 0.32, (0.62, 0, -2.0), m["dark"], (0, math.pi / 2, 0), 12)]
    parts += [sleeve("Line clamp top", 1.08, 0.64, -0.7, -0.85, m["dark"], cut=False), sleeve("Line clamp bottom", 1.08, 0.64, -3.7, -3.85, m["dark"], cut=False)]
    return parts


def build_sliding_sleeve(m):
    parts = [sleeve("Sliding sleeve housing", 0.88, 0.56, 0.0, -3.6, m["steel"]), sleeve("Inner sleeve", 0.56, 0.44, -0.35, -3.2, m["brass"])]
    for z in (-1.25, -1.55, -1.85):
        parts += port_ring("Side door", 0.78, z, 8, m, "dark", 0.08)
    return parts


def build_flow_coupling(m):
    return [sleeve("Heavy wall flow coupling", 1.0, 0.54, 0.0, -2.4, m["tubing"]), sleeve("Thread relief", 0.9, 0.54, -0.28, -2.12, m["steel"])]


def build_blast_joint(m):
    parts = [sleeve("Tubing core", 0.56, 0.44, 0.25, -4.3, m["tubing"]), sleeve("Hardened blast jacket", 0.92, 0.58, -0.4, -3.8, m["dark"])]
    for z in (-0.45, -3.75):
        parts.append(sleeve("Brass wear band", 0.96, 0.58, z, z - 0.18, m["brass"], cut=False))
    return parts


def build_expansion_joint(m):
    parts = [sleeve("Outer barrel", 0.92, 0.62, 0.0, -3.0, m["steel"]), sleeve("Inner mandrel", 0.58, 0.44, -2.15, -5.0, m["tubing"]), sleeve("Travel polished bore", 0.64, 0.5, -0.45, -2.6, m["brass"])]
    for z in (-2.75, -3.0, -3.25):
        parts.append(sleeve("Travel seal", 0.72, 0.58, z, z - 0.11, m["rubber"], cut=False))
    return parts


def build_seal_assembly(m):
    parts = [sleeve("Seal mandrel", 0.46, 0.34, 0.2, -3.7, m["steel"]), sleeve("Locator shoulder", 0.78, 0.46, -2.9, -3.18, m["dark"])]
    for i, z in enumerate([-0.45, -0.7, -0.95, -1.2, -1.45, -1.7]):
        parts.append(lathe(f"Chevron {i}", [(0.46, z), (0.82, z - 0.06), (0.7, z - 0.2), (0.46, z - 0.25)], m["rubber" if i % 2 == 0 else "brass"], span=TAU * 0.72, start=TAU * 0.07))
    return parts


def build_permanent_packer(m):
    parts = [sleeve("Polished bore receptacle", 0.74, 0.48, 0.25, -5.0, m["dark"]), sleeve("Seal element upper", 0.98, 0.58, -1.25, -1.85, m["rubber"]), sleeve("Seal element lower", 0.98, 0.58, -2.0, -2.6, m["rubber"])]
    parts += slip_blocks("Upper permanent", 1.02, -0.75, 10, m, height=0.38, finish="brass")
    parts += slip_blocks("Lower permanent", 1.02, -3.0, 10, m, height=0.38, finish="brass")
    parts.append(sleeve("Cast body", 0.86, 0.58, -3.35, -4.45, m["steel"]))
    return parts


def build_wireline_entry_guide(m):
    return [sleeve("Tubing tail", 0.56, 0.44, 0.0, -2.8, m["tubing"]), lathe("Bell mouth guide", [(0.36, -2.25), (0.88, -2.55), (0.96, -3.05), (0.66, -3.46), (0.28, -3.65), (0.28, -2.25)], m["steel"], span=TAU * 0.62, start=TAU * 0.16, bevel=0.012)]


def build_esp(m):
    parts = [sleeve("ESP motor", 0.5, 0.38, -3.8, -7.2, m["dark"]), sleeve("Seal protector", 0.48, 0.36, -2.65, -3.7, m["steel"]), sleeve("Intake", 0.52, 0.36, -1.75, -2.55, m["steel"]), sleeve("Pump", 0.5, 0.36, 0.0, -1.65, m["brass"]), box("Power cable", (0.12, 0.08, 7.0), (0.58, 0.0, -3.6), m["rubber"])]
    for z in [x * -0.25 - 0.15 for x in range(6)]:
        parts.append(sleeve("Pump stage rib", 0.57, 0.5, z, z - 0.05, m["steel"], cut=False, bevel=0))
    for z in (-2.0, -2.25):
        parts += port_ring("Intake slot", 0.48, z, 8, m, "dark", 0.05)
    for z in (-4.3, -5.0, -5.7, -6.4):
        parts.append(sleeve("Motor rib", 0.56, 0.5, z, z - 0.08, m["steel"], cut=False, bevel=0))
    return parts


def build_rod_pump(m):
    parts = [sleeve("Pump barrel", 0.72, 0.48, 0.0, -5.0, m["steel"]), sleeve("Plunger", 0.42, 0.28, -1.1, -3.1, m["brass"]), cylinder("Sucker rod", 0.07, 1.2, (0, 0, 0.25), m["steel"], vertices=16)]
    parts.append(sphere("Traveling ball", 0.16, (0, 0, -1.45), m["brass"]))
    parts.append(sphere("Standing ball", 0.18, (0, 0, -4.35), m["brass"]))
    parts.append(torus("Standing seat", 0.26, 0.035, (0, 0, -4.35), m["dark"]))
    return parts


def build_pcp(m):
    parts = [sleeve("PCP stator", 0.74, 0.48, 0.0, -5.2, m["rubber"]), sleeve("Steel stator shell", 0.82, 0.74, 0.0, -5.2, m["steel"])]
    for i in range(28):
        z = -0.2 - i * 0.17
        a = i * 0.72
        parts.append(cylinder(f"Helical rotor lobe {i}", 0.18, 0.22, (0.18 * math.cos(a), 0.18 * math.sin(a), z), m["brass"], vertices=20))
    return parts


def build_jet_pump(m):
    return [sleeve("Jet pump housing", 0.82, 0.54, 0.0, -3.7, m["steel"]), lathe("Nozzle", [(0.18, -0.55), (0.48, -0.72), (0.32, -1.25), (0.16, -1.45)], m["brass"], span=TAU * 0.72, start=TAU * 0.07), lathe("Throat diffuser", [(0.16, -1.55), (0.34, -1.8), (0.46, -2.7), (0.22, -2.9)], m["dark"], span=TAU * 0.72, start=TAU * 0.07)]


def build_perforations(m):
    parts = [sleeve("Cement sheath", 1.15, 0.82, 0.0, -4.8, m["cement"]), sleeve("Perforated casing", 0.82, 0.64, 0.15, -4.95, m["production"])]
    for i in range(15):
        z = -0.55 - i * 0.27
        a = TAU * (i % 6) / 6
        parts.append(cylinder(f"Perf tunnel {i}", 0.055, 0.88, (0.98 * math.cos(a), 0.98 * math.sin(a), z), m["dark"], (0, math.pi / 2, a), 12))
    return parts


def build_wire_wrap_screen(m):
    parts = [sleeve("Screen base pipe", 0.55, 0.42, 0.2, -4.7, m["steel"]), sleeve("End ring top", 0.76, 0.56, -0.05, -0.3, m["dark"], cut=False), sleeve("End ring bottom", 0.76, 0.56, -4.2, -4.45, m["dark"], cut=False)]
    for i in range(32):
        z = -0.4 - i * 0.115
        # A 12 mm wire reads as round with five sides at any size the viewer draws it; twelve sides
        # put 37,000 of the screen's 44,000 triangles into wire nobody can see the facets of.
        parts.append(torus("Wire wrap", 0.64, 0.012, (0, 0, z), m["steel"], minor_segments=5))
    return parts


def build_premium_screen(m):
    parts = [sleeve("Base pipe", 0.5, 0.38, 0.15, -4.6, m["steel"]), sleeve("Mesh layer", 0.62, 0.52, -0.25, -4.25, m["brass"]), sleeve("Perforated shroud", 0.78, 0.64, -0.2, -4.3, m["dark"])]
    for z in (-0.75, -1.25, -1.75, -2.25, -2.75, -3.25, -3.75):
        parts += port_ring("Shroud hole", 0.74, z, 10, m, "steel", 0.045)
    return parts


def build_gravel_pack(m):
    parts = build_wire_wrap_screen(m)
    parts.insert(0, sleeve("Gravel annulus", 1.0, 0.72, 0.0, -4.8, m["sand"], bevel=0.0))
    return parts


def build_icd_screen(m):
    parts = build_wire_wrap_screen(m)
    parts.append(sleeve("ICD housing", 0.9, 0.56, -0.15, -0.9, m["dark"]))
    parts += port_ring("ICD nozzle", 0.82, -0.5, 6, m, "brass", 0.06)
    return parts


def build_swell_packer(m):
    return [sleeve("Base pipe", 0.48, 0.36, 0.2, -4.7, m["steel"]), sleeve("Swelling elastomer", 1.0, 0.5, -0.65, -3.85, m["rubber"]), sleeve("End ring top", 0.72, 0.5, -0.35, -0.62, m["steel"], cut=False), sleeve("End ring bottom", 0.72, 0.5, -3.88, -4.15, m["steel"], cut=False)]


def build_frac_sleeve(m):
    parts = [sleeve("Frac sleeve", 0.9, 0.54, 0.0, -3.6, m["steel"]), sleeve("Inner shifting sleeve", 0.58, 0.42, -0.4, -2.4, m["brass"]), lathe("Ball seat", [(0.28, -2.45), (0.56, -2.45), (0.56, -2.75), (0.36, -3.0), (0.28, -3.0)], m["dark"], span=TAU * 0.72, start=TAU * 0.07), sphere("Frac ball", 0.28, (0, 0, -2.25), m["red"])]
    parts += port_ring("Frac port", 0.82, -1.35, 8, m, "dark", 0.11)
    return parts


def build_slotted_liner(m):
    parts = [sleeve("Slotted liner", 0.82, 0.64, 0.0, -4.8, m["liner"])]
    for z in (-0.75, -1.2, -1.65, -2.1, -2.55, -3.0, -3.45, -3.9):
        for i in range(5):
            a = TAU * (i / 5 + (0.1 if int(abs(z)*10) % 2 else 0))
            parts.append(box("Longitudinal slot", (0.04, 0.08, 0.28), (0.8 * math.cos(a), 0.8 * math.sin(a), z), m["dark"], (0, 0, a)))
    return parts


def build_icv(m):
    parts = [sleeve("ICV housing", 0.88, 0.52, 0.0, -4.0, m["steel"]), sleeve("Actuator section", 0.96, 0.58, -0.4, -1.3, m["red"]), cylinder("Hydraulic line", 0.035, 4.4, (1.02, 0, -2.0), m["brass"], vertices=8)]
    parts += port_ring("Choke port", 0.8, -2.2, 8, m, "dark", 0.085)
    parts.append(sleeve("Flow trim", 0.58, 0.36, -1.65, -2.7, m["brass"]))
    return parts


def build_bridge_plug(m):
    parts = [sleeve("Bridge plug mandrel", 0.42, 0.26, 0.15, -3.4, m["steel"]), sleeve("Rubber element", 0.96, 0.42, -1.25, -1.95, m["rubber"])]
    parts += slip_blocks("Upper bridge", 1.0, -0.75, 8, m, height=0.36, finish="brass")
    parts += slip_blocks("Lower bridge", 1.0, -2.45, 8, m, height=0.36, finish="brass")
    parts.append(lathe("Plug nose", [(0.2, -3.1), (0.55, -3.1), (0.3, -3.62), (0.0, -3.72)], m["dark"], span=TAU * 0.72, start=TAU * 0.07))
    return parts


def build_cement_plug(m):
    return [sleeve("Thin casing ghost", 0.92, 0.84, 0.2, -4.4, m["steel"]), cylinder("Solid cement plug", 0.78, 3.4, (0, 0, -2.1), m["cement"], vertices=64)]


def build_cement_retainer(m):
    parts = [sleeve("Cast iron retainer", 0.72, 0.34, 0.15, -3.8, m["dark"]), sleeve("Retainer element", 0.95, 0.48, -1.55, -2.1, m["rubber"]), lathe("Stinger receptacle", [(0.32, 0.0), (0.62, 0.0), (0.62, -0.55), (0.42, -0.75), (0.32, -0.75)], m["steel"], span=TAU * 0.72, start=TAU * 0.07)]
    parts += slip_blocks("Retainer", 1.0, -2.65, 8, m, height=0.42, finish="brass")
    return parts


CATALOG = [
    {"id": "wellhead", "build": build_wellhead, "model": True},
    {"id": "casing-spool", "build": build_casing_spool, "model": True},
    {"id": "tubing-head", "build": build_tubing_head, "model": True},
    {"id": "tubing-hanger", "build": build_tubing_hanger, "model": True},
    {"id": "christmas-tree", "build": build_tree, "model": True},
    {"id": "horizontal-tree", "build": build_horizontal_tree, "model": True},
    {"id": "bop-stack", "build": build_bop_stack, "model": True},
    {"id": "conductor", "build": lambda m: build_casing(m, "conductor"), "model": False},
    {"id": "surface-casing", "build": lambda m: build_casing(m, "surface"), "model": False},
    {"id": "intermediate-casing", "build": lambda m: build_casing(m, "intermediate"), "model": False},
    {"id": "production-casing", "build": lambda m: build_casing(m, "production"), "model": False},
    {"id": "tieback-casing", "build": build_tieback_casing, "model": False},
    {"id": "liner", "build": build_liner, "model": True},
    {"id": "drilling-liner", "build": build_drilling_liner, "model": True},
    {"id": "float-shoe", "build": build_shoe, "model": True},
    {"id": "guide-shoe", "build": build_guide_shoe, "model": True},
    {"id": "float-collar", "build": build_float_collar, "model": True},
    {"id": "landing-collar", "build": build_landing_collar, "model": True},
    {"id": "centralizer", "build": build_centralizer, "model": True},
    {"id": "rigid-centralizer", "build": build_rigid_centralizer, "model": True},
    {"id": "stage-tool", "build": build_stage_tool, "model": True},
    {"id": "cement-basket", "build": build_cement_basket, "model": True},
    {"id": "liner-top-packer", "build": build_liner_top_packer, "model": True},
    {"id": "cement", "build": build_cement, "model": False},
    {"id": "tubing", "build": build_tubing, "model": False},
    {"id": "safety-valve", "build": build_sssv, "model": True},
    {"id": "landing-nipple", "build": build_nipple, "model": True},
    {"id": "no-go-nipple", "build": build_no_go_nipple, "model": True},
    {"id": "chemical-injection-mandrel", "build": build_chemical_injection_mandrel, "model": True},
    {"id": "gauge", "build": build_gauge, "model": True},
    {"id": "sliding-sleeve", "build": build_sliding_sleeve, "model": True},
    {"id": "flow-coupling", "build": build_flow_coupling, "model": True},
    {"id": "blast-joint", "build": build_blast_joint, "model": True},
    {"id": "expansion-joint", "build": build_expansion_joint, "model": True},
    {"id": "seal-assembly", "build": build_seal_assembly, "model": True},
    {"id": "packer", "build": build_packer, "model": True},
    {"id": "permanent-packer", "build": build_permanent_packer, "model": True},
    {"id": "wireline-entry-guide", "build": build_wireline_entry_guide, "model": True},
    {"id": "gas-lift-mandrel", "build": build_glm, "model": True},
    {"id": "esp", "build": build_esp, "model": True},
    {"id": "rod-pump", "build": build_rod_pump, "model": True},
    {"id": "pcp", "build": build_pcp, "model": True},
    {"id": "jet-pump", "build": build_jet_pump, "model": True},
    {"id": "perforations", "build": build_perforations, "model": True},
    {"id": "wire-wrap-screen", "build": build_wire_wrap_screen, "model": True},
    {"id": "premium-screen", "build": build_premium_screen, "model": True},
    {"id": "gravel-pack", "build": build_gravel_pack, "model": True},
    {"id": "icd-screen", "build": build_icd_screen, "model": True},
    {"id": "swell-packer", "build": build_swell_packer, "model": True},
    {"id": "frac-sleeve", "build": build_frac_sleeve, "model": True},
    {"id": "slotted-liner", "build": build_slotted_liner, "model": True},
    {"id": "icv", "build": build_icv, "model": True},
    {"id": "bridge-plug", "build": build_bridge_plug, "model": True},
    {"id": "cement-plug", "build": build_cement_plug, "model": True},
    {"id": "cement-retainer", "build": build_cement_retainer, "model": True},
]



def bounds(objects):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    points = []
    for obj in objects:
        evaluated = obj.evaluated_get(depsgraph)
        points.extend(evaluated.matrix_world @ Vector(corner) for corner in evaluated.bound_box)
    low = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    high = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return low, high


def stage(scene, objects):
    low, high = bounds(objects)
    center = (low + high) / 2
    extent = high - low
    direction = Vector((0.62, -1.0, 0.34)).normalized()
    distance = max(extent) * 4 + 10
    bpy.ops.object.camera_add(location=center + direction * distance)
    camera = bpy.context.object
    camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = max(extent.z * 1.08, math.hypot(extent.x, extent.y) * 1.2) + 0.4
    camera.data.clip_end = distance * 3
    scene.camera = camera
    for offset, energy, size in (((4, -6, 6), 900, 5), ((-6, -2, 2), 420, 6), ((2, 7, 5), 700, 4)):
        bpy.ops.object.light_add(type="AREA", location=center + Vector(offset) * max(1.0, max(extent) / 5))
        light = bpy.context.object
        light.data.energy = energy * max(1.0, max(extent) / 5) ** 2
        light.data.size = size * max(1.0, max(extent) / 5)
        light.rotation_euler = (center - light.location).to_track_quat("-Z", "Y").to_euler()
    return low, high


def export_model(objects, path):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", use_selection=True, export_apply=True, export_yup=True, export_cameras=False, export_lights=False)


entries = []
for spec in CATALOG:
    if only and spec["id"] not in only:
        continue
    scene = reset_scene()
    objects = spec["build"](materials())
    objects = [obj for obj in objects if obj is not None]
    low, high = bounds(objects)
    model_name = None
    if spec["model"]:
        model_name = f"{spec['id']}.glb"
        export_model(objects, output / model_name)
    stage(scene, objects)
    thumbnail = output / f"{spec['id']}.png"
    scene.render.filepath = str(thumbnail)
    bpy.ops.render.render(write_still=True)
    entry = {
        "id": spec["id"],
        "thumbnail": thumbnail.name,
        "thumbnailSha256": hashlib.sha256(thumbnail.read_bytes()).hexdigest(),
        "bounds": {"radius": round(max(abs(low.x), abs(high.x), abs(low.y), abs(high.y)), 4), "top": round(high.z, 4), "bottom": round(low.z, 4)},
    }
    if model_name:
        entry["model"] = model_name
        entry["modelSha256"] = hashlib.sha256((output / model_name).read_bytes()).hexdigest()
    entries.append(entry)

manifest_path = output / "manifest.json"
previous = json.loads(manifest_path.read_text())["components"] if manifest_path.exists() and only else []
merged = {entry["id"]: entry for entry in previous}
merged.update({entry["id"]: entry for entry in entries})
order = [spec["id"] for spec in CATALOG]
manifest = {
    "id": "well-component-catalog-v1",
    "provenance": "synthetic",
    "license": "MIT",
    "author": "Ikhmal Putra Manan",
    "blenderVersion": bpy.app.version_string,
    "renderer": "Cycles",
    "thumbnailSize": SIZE,
    "modelConvention": "glTF Y-up; top of component at origin extending to -Y; body outside radius normalised to 1.0.",
    "compatibility": "Illustrative component renders for assembly UIs. Not manufacturer CAD, not to engineering scale.",
    "components": [merged[i] for i in order if i in merged],
}
manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
print(f"Rendered {len(entries)} catalog components to {output}")
