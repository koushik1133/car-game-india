# Custom Innova Crysta model

Drop a **licensed** 3D model here as `crysta.glb` and reload the game. It replaces the built-in procedural Crysta automatically, and **G** switches between the two in game.

Only use a model you have the rights to: one you made, bought, commissioned, or one released under a licence that allows use in your game (for example Sketchfab models marked CC-BY or royalty-free). Models ripped from manufacturer websites or GTA/BeamNG mods aren't licensed for this.

## What the loader does
- Turns the model so its longest side runs front-to-back, scales it to the real Crysta length (4735 mm), centres it and sits it on the ground.
- **Wheels**: nodes whose names contain `wheel`, `tyre`, `tire` or `rim` spin with speed; front ones steer. When it finds 4, the built-in wheels are hidden.
- **Doors**: nodes named like `door_FL`, `door_front_left`, `DoorRR` and so on swing open with keys 1–4, hinged at their front edge.
- Adds the `TS 08 HN 1111` plates front and back.
- Headlights, brake lights, physics, collisions and sounds stay the same.

## Optional settings: `crysta.json`
```json
{
  "flip": false,
  "rotateY": 0,
  "yOffset": 0,
  "length": 4.735,
  "hideBuiltInWheels": "auto",
  "plates": true
}
```
- `flip`: set to `true` if the car drives backwards.
- `rotateY`: extra turn in degrees.
- `yOffset`: lift (+) or sink (−) the body in metres.
- `hideBuiltInWheels`: `true`, `false` or `"auto"`.
- `plates`: set to `false` if the model already has number plates.

Export from Blender with **File → Export → glTF 2.0 (.glb)**, with +Y up. Draco-compressed files aren't supported; turn compression off when exporting.
