"""Builds the globe's imagery: NASA Blue Marble Next Generation (December 2004, with topography and
bathymetry), public domain, reprojected from plate carree to Web Mercator so the map can lay it
over the world between latitudes +-85.0511.

    python3 tools/build-world-imagery.py <world.topo.bathy.200412.3x5400x2700.jpg>

Source: https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x5400x2700.jpg
(NASA Earth Observatory, Reto Stockli). Needs numpy and macOS `sips` (JPEG to and from BMP).
Writes packages/react/assets/gis/world-imagery.jpg.
"""
import hashlib
import os
import struct
import subprocess
import sys
import tempfile

import numpy as np

SIZE = 4096
MAX_LAT = 85.0511287798066


def read_bmp(path):
    data = open(path, "rb").read()
    offset, = struct.unpack_from("<I", data, 10)
    width, height, _, bits = struct.unpack_from("<iiHH", data, 18)
    if bits != 24 and bits != 32:
        raise SystemExit(f"Unexpected BMP depth {bits}")
    step = bits // 8
    stride = (width * step + 3) & ~3
    rows = np.frombuffer(data, dtype=np.uint8, offset=offset, count=stride * abs(height)).reshape(abs(height), stride)[:, : width * step]
    pixels = rows.reshape(abs(height), width, step)[:, :, :3][:, :, ::-1]
    return pixels[::-1] if height > 0 else pixels


def write_bmp(path, rgb):
    height, width, _ = rgb.shape
    stride = (width * 3 + 3) & ~3
    body = np.zeros((height, stride), dtype=np.uint8)
    body[:, : width * 3] = rgb[::-1, :, ::-1].reshape(height, width * 3)
    header = struct.pack("<2sIHHI", b"BM", 54 + body.size, 0, 0, 54) + struct.pack("<IiiHHIIiiII", 40, width, height, 1, 24, 0, body.size, 2835, 2835, 0, 0)
    open(path, "wb").write(header + body.tobytes())


def main(source):
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
    with tempfile.TemporaryDirectory() as work:
        bmp = os.path.join(work, "in.bmp")
        subprocess.run(["sips", "-s", "format", "bmp", source, "--out", bmp], check=True, capture_output=True)
        src = read_bmp(bmp).astype(np.float32)
        h, w, _ = src.shape
        # Each output row is a latitude on the Mercator grid; each column a longitude, as in the source.
        y = (np.arange(SIZE) + 0.5) / SIZE
        lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * y))))
        sy = np.clip((90 - lat) / 180 * h - 0.5, 0, h - 1)
        sx = np.clip((np.arange(SIZE) + 0.5) / SIZE * w - 0.5, 0, w - 1)
        y0, x0 = np.floor(sy).astype(int), np.floor(sx).astype(int)
        y1, x1 = np.minimum(y0 + 1, h - 1), np.minimum(x0 + 1, w - 1)
        fy, fx = (sy - y0)[:, None, None], (sx - x0)[None, :, None]
        out = (src[y0][:, x0] * (1 - fy) * (1 - fx) + src[y0][:, x1] * (1 - fy) * fx + src[y1][:, x0] * fy * (1 - fx) + src[y1][:, x1] * fy * fx)
        mid = os.path.join(work, "out.bmp")
        write_bmp(mid, np.clip(out + 0.5, 0, 255).astype(np.uint8))
        target = os.path.join(root, "packages/react/assets/gis/world-imagery.jpg")
        subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "72", mid, "--out", target], check=True, capture_output=True)
    digest = hashlib.sha256(open(source, "rb").read()).hexdigest()
    print(f"World imagery -> {target} ({os.path.getsize(target) // 1024} KB, {SIZE} x {SIZE} Web Mercator); source SHA-256 {digest}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
