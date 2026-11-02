# Nellutla — open-world village driving game (Telangana)

A browser open-world game set in a real-data recreation of **Nellutla village** (Lingala Ghanpur mandal, Jangaon district, Telangana), built with three.js r128 and plain JavaScript (no build step).

## Run it
```bash
python3 serve.py                                   # web server on :8093 (no caching)
python3 innova-nellutla/multiplayer/server.py      # optional multiplayer relay on :8094
```
Open http://127.0.0.1:8093/innova-nellutla/ — on a phone/tablet on the same Wi-Fi use your computer's IP instead of 127.0.0.1.

## What's in it
- **The map** (`nellutla-map/`): ~1,600 real building footprints (Overture Maps / OpenStreetMap), NH-365B, the Lingala Ghanpur road, village CC lanes and dirt tracks traced from satellite imagery, ~2,500 farm fields with bunds and crops, orchards, the lake and tanks, landmarks (Shivalayam, ZPSS school, Govt hospital, anganwadis, bus stop, water tank, petrol bunk, cotton factory, Kbr function hall).
- **Driving**: Toyota Innova Crysta with procedural model, arcade-tuned physics (D↔R like big open-world games), every traffic vehicle drivable — autos, bikes, cars, SUVs, tractors, lorries, buses, bullock carts. Carjacking, auto-rickshaw rides and taxi fares.
- **On foot**: walk, run, jump; character creator; villagers going about the village.
- **Safe house**: a house cloned from Street View with working gates, garage shutter, vehicle storage and a walkable interior.
- **Properties**: buy houses/shops, build on plots, garages and parking bays (saved locally).
- **Multiplayer**: chat (ALL/SQUAD), quick chat, squads, map pings, coordinates, smooth interpolation.
- **Everything else**: day/night cycle, street lights, layered engine and village ambience audio, touch controls on phones/tablets, Low/Medium/High graphics.

## Controls
Press **Controls** (or `I`) in game for the full list. Keyboard: W/S gas & brake/reverse, A/D steer, Space handbrake, Shift NOS, F get in/out, E interact, V camera, mouse-drag to look around, M map, H horn, L lights, G ride an auto, P properties, U character, Enter chat. Gamepads and touch are supported.

## Data and credits
Building footprints and roads: © OpenStreetMap contributors, Overture Maps Foundation (ODbL / CDLA). Field and lane tracing done by hand/algorithm from satellite imagery for reference; no imagery is redistributed. Vehicles, people and buildings are procedural models made for this project.
