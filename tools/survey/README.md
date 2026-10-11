# Survey fixture generation

`generate.py` writes the two curved fixtures in `packages/core/src` with
Python/welleng 0.29.1 (minimum curvature, 25 m interpolated stations), after
checking welleng against analytical vertical and constant-60-degree courses:

- `s-profile-data.json`: synthetic build/hold/drop. MD 0/600/1100/1600/2100/2600 m,
  inclination 0/0/45/45/10/0 degrees, grid azimuth 90 degrees.
- `research-profile-data.json`: reproduced welleng example
  ([build_a_well_from_sections.py](https://github.com/jonnymaserati/welleng/blob/main/examples/build_a_well_from_sections.py),
  Apache-2.0, Jonathan Corcutt): vertical to 500 m, build to 30 degrees east,
  connect to NEV [-800, 300, 1800] at 88/315 degrees with 4 degrees/30 m, then
  500 m more to 90 degrees.

Both use an explicit synthetic RKB datum 30 m above MSL; TVD is positive down
below RKB. Geology and equipment on these wells are illustrative. Neither is a
surveyed real well. The core tests recompute each fixture with the SDK's own
minimum-curvature engine.

`import_forge.py` rebuilds `forge-data.json` and `import_forge_operations.py`
rebuilds `forge-operations.json` plus the decimated demo mud log;
`import_forge_seismic.py` cuts the 16A(78)-32 well-path SEG-Y section, a
well-centred int8 sub-volume and
`forge-seismic.json` from the FORGE 3D PSDM volume; see
[the FORGE source record](../../docs/FORGE_SOURCE_RECORD.md).

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r tools/survey/requirements.lock.txt
.venv/bin/python tools/survey/generate.py
```
