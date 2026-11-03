# Asset licenses

Every file in this folder is **CC0 1.0 Universal (public domain)**: https://creativecommons.org/publicdomain/zero/1.0/
Files were downscaled/re-encoded (1K JPG, ARM maps at 512 px, GLB textures at 512 px); no other changes except where noted.

## Textures (Poly Haven, CC0) — `textures/<key>_col.jpg` (sRGB colour), `_nrm.jpg` (OpenGL normal), `_arm.jpg` (R=AO, G=roughness, B=metalness)

| key | Poly Haven asset | author(s) | source | license |
|---|---|---|---|---|
| plaster | Painted Plaster Wall (`painted_plaster_wall`) | Amal Kumar (All) | https://polyhaven.com/a/painted_plaster_wall | CC0 |
| concrete | Concrete Wall 008 (`concrete_wall_008`) | Dario Barresi (Processing ), Charlotte Baglioni (Photography) | https://polyhaven.com/a/concrete_wall_008 | CC0 |
| brick | Red Brick (`red_brick`) | Rob Tuytel (All) | https://polyhaven.com/a/red_brick | CC0 |
| granite | Granite Wall (`granite_wall`) | Dimitrios Savva (All) | https://polyhaven.com/a/granite_wall | CC0 |
| ccroad | Brushed Concrete  (`brushed_concrete`) | Dario Barresi (Processing), Dimitrios Savva (Photography) | https://polyhaven.com/a/brushed_concrete | CC0 |
| asphalt | Asphalt 02 (`asphalt_02`) | Rob Tuytel (All) | https://polyhaven.com/a/asphalt_02 | CC0 |
| dirt | Red Dirt Mud 01 (`red_dirt_mud_01`) | Rob Tuytel (All) | https://polyhaven.com/a/red_dirt_mud_01 | CC0 |
| drygrass | Dry Ground 01 (`dry_ground_01`) | Rob Tuytel (All) | https://polyhaven.com/a/dry_ground_01 | CC0 |
| grass | Leafy Grass (`leafy_grass`) | Charlotte Baglioni (All) | https://polyhaven.com/a/leafy_grass | CC0 |
| roof | Clay Roof Tiles (`clay_roof_tiles`) | Amal Kumar (All) | https://polyhaven.com/a/clay_roof_tiles | CC0 |
| corrugated | Corrugated Iron (`corrugated_iron`) | Jenelle van Heerden (Processing), Dimitrios Savva (Photography) | https://polyhaven.com/a/corrugated_iron | CC0 |
| planks | Brown Planks 05 (`brown_planks_05`) | Rob Tuytel (All) | https://polyhaven.com/a/brown_planks_05 | CC0 |
| fabric | Cotton Jersey (`cotton_jersey`) | colormass (Photography), Rico Cilliers (Processing) | https://polyhaven.com/a/cotton_jersey | CC0 |

Note: `plaster_col.jpg` is converted to light grey so `material.color` can tint it.

## Foliage (ambientCG, CC0) — `textures/leafNN_col.jpg`, `_alpha.jpg` (opacity), `_nrm.jpg`

| key | asset | author | source | license |
|---|---|---|---|---|
| leaf09 | Leaf Set 009 | ambientCG.com | https://ambientcg.com/view?id=LeafSet009 | CC0 |
| leaf10 | Leaf Set 010 | ambientCG.com | https://ambientcg.com/view?id=LeafSet010 | CC0 |

## HDRI (Poly Haven, CC0)

| file | asset | author | source | license |
|---|---|---|---|---|
| hdri/kloofendal_overcast_puresky_1k.hdr | Kloofendal Overcast (Pure Sky) | Greg Zaal | https://polyhaven.com/a/kloofendal_overcast_puresky | CC0 |

## Models (Poly Haven, CC0) — glTF repacked as a single .glb, no Draco

| file | asset | author(s) | source | license |
|---|---|---|---|---|
| models/plastic_monobloc_chair_01.glb | Plastic Monobloc Chair 01 | Kuutti Siitonen (All) | https://polyhaven.com/a/plastic_monobloc_chair_01 | CC0 |
| models/barrel_03.glb | Barrel 03 | Serhii Khromov (All) | https://polyhaven.com/a/barrel_03 | CC0 |
| models/hand_truck.glb | Hand Truck | Mutanzom3D (All) | https://polyhaven.com/a/hand_truck | CC0 |
| models/industrial_pastic_container.glb | Industrial Plastic Container | Galo Benivegna (All) | https://polyhaven.com/a/industrial_pastic_container | CC0 |

## Audio

No audio sample files are used. Every sound (engines, horns, skids, impacts, doors, footsteps, animals, ambience) is synthesized at runtime with the WebAudio API in `engine-audio.js`, `sfx.js`, `ambient.js` and `animals.js` (original code, no third-party recordings).
