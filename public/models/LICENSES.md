# Model Licenses

## Vehicles

- Source: Quaternius "Basic Car Pack" (Jan 2017), mirrored at
  https://github.com/beep2bleep/FreeAssetsByKenneyNLandQuaternius
- License: Creative Commons Zero (CC0). Models were converted from FBX to GLB
  for this project with textures stripped and solid colors applied.
- Local files: `vehicles/sedan.glb`, `vehicles/coupe.glb`, `vehicles/suv.glb`,
  `vehicles/pickup.glb`, `vehicles/taxi.glb`, `vehicles/police.glb`.

## Pedestrians

- Source: three.js example models
  https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf
- `pedestrians/michelle.glb` - Michelle (realistic pedestrian model; each
  pedestrian spawn randomly selects one model from the realistic model list)
- `pedestrians/readyplayer.glb` - Ready Player Me avatar example (unused fallback)
- `pedestrians/soldier.glb` - Soldier (unused fallback)
- `pedestrians/robot.glb` - RobotExpressive (unused fallback)
- These files are redistributed with this project for the game's runtime
  assets; see the three.js repository for each model's original terms.

## Vehicle Runtime Notes

The vehicle GLBs above are kept as drop-in replacement assets. The default
runtime model is the procedural, part-based vehicle built in
`VehicleFactory.ts`, which exposes BodyMain, Hood, four doors, TrunkLid,
mirrors, lights, Windows and named wheels without extra redistribution
restrictions.
