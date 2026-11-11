// player.js: GTA-style get out (F), walk around, take any vehicle.
// The Crysta keeps its own physics (updatePhysics in index.html); every other vehicle uses driveVehicle() below.
// carPos / carRot / carSpeed always describe whatever the player controls right now.
const Player = (function () {
  // per-kind tuning: top km/h, accel m/s², brake m/s², reverse m/s, turn (yaw gain), steerRate, offroad (1 = full grip anywhere), half width
  const PARAMS = {
    bike:        { name: 'BIKE',          top: 95,  accel: 6.0, brake: 9,   rev: 2.5, turn: 2.6, steerRate: 7,  turnFade: 14, offroad: 0.35, hw: 0.45, gears: 5, lean: true },
    auto:        { name: 'AUTO RICKSHAW', top: 60,  accel: 3.2, brake: 7,   rev: 3,   turn: 3.2, steerRate: 12, turnFade: 9,  offroad: 0.3,  hw: 0.75, gears: 4 },
    hatch:       { name: 'HATCHBACK',     top: 150, accel: 4.2, brake: 9,   rev: 4,   turn: 2.1, steerRate: 6,  turnFade: 18, offroad: 0.1,  hw: 0.85, gears: 5 },
    suv:         { name: 'SUV',           top: 160, accel: 3.8, brake: 8.5, rev: 4,   turn: 1.9, steerRate: 5,  turnFade: 18, offroad: 0.5,  hw: 0.95, gears: 5 },
    tractor:     { name: 'TRACTOR',       top: 30,  accel: 2.2, brake: 6,   rev: 2.5, turn: 1.5, steerRate: 4,  turnFade: 12, offroad: 1.0,  hw: 1.0,  gears: 3 },
    lorry:       { name: 'LORRY',         top: 85,  accel: 1.3, brake: 4.5, rev: 2.5, turn: 1.0, steerRate: 2.5, turnFade: 12, offroad: 0.4, hw: 1.2,  gears: 6 },
    bus:         { name: 'RTC BUS',       top: 90,  accel: 1.2, brake: 4.5, rev: 2.5, turn: 0.9, steerRate: 2.5, turnFade: 12, offroad: 0.3, hw: 1.3,  gears: 6 },
    // specific models (TrafficModels userData.type): parked two-wheelers arrive as model 'bike', the MPV as 'suv'
    splendor:    { name: 'SPLENDOR',      top: 90,  accel: 5.5, brake: 9,   rev: 2.5, turn: 2.6, steerRate: 7,  turnFade: 14, offroad: 0.35, hw: 0.4,  gears: 4, lean: true },
    scooter:     { name: 'SCOOTER',       top: 80,  accel: 5.8, brake: 9,   rev: 2.5, turn: 3.0, steerRate: 9,  turnFade: 12, offroad: 0.25, hw: 0.38, gears: 1, lean: true },
    classic:     { name: 'CLASSIC 350',   top: 110, accel: 6.5, brake: 8,   rev: 2.5, turn: 2.2, steerRate: 5.5, turnFade: 16, offroad: 0.45, hw: 0.45, gears: 5, lean: true },
    classic2:    { name: 'CLASSIC',       top: 110, accel: 6.5, brake: 8,   rev: 2.5, turn: 2.2, steerRate: 5.5, turnFade: 16, offroad: 0.45, hw: 0.45, gears: 5, lean: true },
    sport:       { name: 'SPORT BIKE',    top: 140, accel: 8.5, brake: 11,  rev: 2.5, turn: 2.9, steerRate: 9,  turnFade: 18, offroad: 0.3,  hw: 0.42, gears: 6, lean: true },
    cycle:       { name: 'BICYCLE',       top: 25,  accel: 1.6, brake: 6,   rev: 1.2, turn: 3.0, steerRate: 8,  turnFade: 8,  offroad: 0.5,  hw: 0.32, gears: 1, lean: true, pedal: true },
    mpv:         { name: 'MPV',           top: 165, accel: 4.0, brake: 9,   rev: 4,   turn: 2.0, steerRate: 5.5, turnFade: 18, offroad: 0.3, hw: 0.92, gears: 6 },
    // Fortuner-style 4x4: 2.8 L diesel (500 Nm), ~2.2 t, top ~180, low-range grip off the tarmac; sounds as 'suv' (diesel)
    fortuner:    { name: 'FORTUNER 4X4',  top: 180, accel: 5.0, brake: 8, rev: 4.5, turn: 1.85, steerRate: 5,  turnFade: 19, offroad: 0.8, hw: 0.95, gears: 6 },
    // double-cab pickup on the Fortuner's ladder frame and 2.8 diesel: longer wheelbase, light tail, good off the tarmac
    hilux:       { name: 'HILUX 4X4',     top: 175, accel: 4.9, brake: 8, rev: 4.5, turn: 1.75, steerRate: 4.8, turnFade: 19, offroad: 0.85, hw: 0.95, gears: 6 },
    // Indian car range (traffic-models.js): light petrol hatches, diesel utilities, mini truck, faired 155 cc sport bike
    swift:       { name: 'SWIFT',         top: 155, accel: 4.4, brake: 9,   rev: 4,   turn: 2.2, steerRate: 6.5, turnFade: 18, offroad: 0.1, hw: 0.85, gears: 5 },
    dzire:       { name: 'DZIRE',         top: 155, accel: 4.3, brake: 9,   rev: 4,   turn: 2.1, steerRate: 6,  turnFade: 18, offroad: 0.1,  hw: 0.87, gears: 5 },
    alto:        { name: 'ALTO',          top: 140, accel: 2.9, brake: 8, rev: 4,   turn: 2.4, steerRate: 7,  turnFade: 16, offroad: 0.1,  hw: 0.75, gears: 5 },
    bolero:      { name: 'BOLERO',        top: 125, accel: 2.9, brake: 7.5,   rev: 4,   turn: 1.7, steerRate: 4.5, turnFade: 17, offroad: 0.75, hw: 0.9, gears: 5 },
    scorpio:     { name: 'SCORPIO',       top: 150, accel: 4.1, brake: 8.2, rev: 4,   turn: 1.75, steerRate: 4.8, turnFade: 18, offroad: 0.7, hw: 0.97, gears: 5 },
    ace:         { name: 'MINI TRUCK',    top: 85,  accel: 2.4, brake: 7,   rev: 3,   turn: 2.0, steerRate: 5,  turnFade: 12, offroad: 0.4,  hw: 0.78, gears: 4 },
    faired:      { name: 'SPORT 155',     top: 155, accel: 8.8, brake: 11.5, rev: 2.5, turn: 2.7, steerRate: 8.5, turnFade: 19, offroad: 0.25, hw: 0.4, gears: 6, lean: true },
    // real Crysta copy parked at the safe house (2.4 D, ~2 t, 0-100 ~13 s, ~170 km/h)
    crysta:      { name: 'INNOVA CRYSTA', top: 170, accel: 4.3, brake: 8.5, rev: 4.5, turn: 1.9, steerRate: 5.5, turnFade: 18, offroad: 0.4, hw: 0.95, gears: 6 },
    crysta2023:  { name: 'INNOVA CRYSTA 2023', top: 170, accel: 4.3, brake: 8.5, rev: 4.5, turn: 1.9, steerRate: 5.5, turnFade: 18, offroad: 0.4, hw: 0.95, gears: 6 },   // facelift shell, same running gear
    // sports cars (accel ~ 2 x the real 0-100 average, the scale the rest of this table uses): light, low and grippy
    berlinetta:  { name: 'BERLINETTA V8', top: 320, accel: 19,  brake: 12,  rev: 4.5, turn: 2.6, steerRate: 7.5, turnFade: 30, offroad: 0.05, hw: 1.0, gears: 7 },   // 0-100 2.9 s, 1.4 t
    muscle:      { name: 'MUSCLE V8',     top: 250, accel: 12.9, brake: 10.5, rev: 4.5, turn: 2.2, steerRate: 6.5, turnFade: 26, offroad: 0.1, hw: 0.97, gears: 6 },   // 0-100 4.3 s, 1.75 t
    wedge:       { name: 'WEDGE V10',     top: 330, accel: 19,  brake: 12,  rev: 4.5, turn: 2.5, steerRate: 7.5, turnFade: 30, offroad: 0.05, hw: 0.99, gears: 7 },   // 0-100 2.9 s, 1.45 t
    coupe911:    { name: 'FLAT-SIX COUPE', top: 300, accel: 15.9, brake: 12.5, rev: 4.5, turn: 2.7, steerRate: 8, turnFade: 30, offroad: 0.08, hw: 0.93, gears: 8 },  // 0-100 3.5 s, 1.5 t
    // Indian additions, published figures: accel = 2 x real 0-100 average, as above
    safari:      { name: 'TATA SAFARI',   top: 165, accel: 4.2, brake: 8, rev: 4, turn: 1.7, steerRate: 4.5, turnFade: 18, offroad: 0.75, hw: 0.98, gears: 5 },   // 2.2 DICOR 156 PS, ~13 s
    sumo:        { name: 'TATA SUMO',     top: 125, accel: 2.6, brake: 7.5, rev: 4, turn: 1.7, steerRate: 4.5, turnFade: 16, offroad: 0.6, hw: 0.85, gears: 5 },    // 3.0 CR4 85 PS, 1820 kg, ~21 s
    scorpioN:    { name: 'SCORPIO-N',     top: 185, accel: 5.3, brake: 9, rev: 4.5, turn: 1.8, steerRate: 5, turnFade: 19, offroad: 0.75, hw: 0.96, gears: 6 },    // 2.2 mHawk 175 PS, ~10.5 s
    swiftNew:    { name: 'SWIFT (2024)',  top: 165, accel: 4.6, brake: 9.5, rev: 4, turn: 2.2, steerRate: 6.5, turnFade: 18, offroad: 0.1, hw: 0.87, gears: 5 },     // Z12E 82 PS, ~12 s
    activa:      { name: 'HONDA ACTIVA',  top: 85,  accel: 5.2, brake: 8.5, rev: 2.5, turn: 3.0, steerRate: 9, turnFade: 12, offroad: 0.25, hw: 0.35, gears: 1, lean: true },   // 109.5 cc 7.8 PS, 105 kg
    starCity:    { name: 'TVS STAR CITY+', top: 90, accel: 5.4, brake: 8.5, rev: 2.5, turn: 2.6, steerRate: 7, turnFade: 14, offroad: 0.35, hw: 0.38, gears: 4, lean: true },  // 109.7 cc 8.1 PS, 115 kg
    // accel = 2 x real 0-100 average, as above. Power, torque, weight published; 0-100 and top speed are magazine / recalled figures
    wagonR:      { name: 'WAGON R',       top: 150, accel: 4.1, brake: 8.5, rev: 4, turn: 2.2, steerRate: 6.5, turnFade: 17, offroad: 0.1, hw: 0.8, gears: 5 },       // 1.2, ~830 kg, ~13.5 s
    innova:      { name: 'INNOVA (2005)', top: 155, accel: 3.5, brake: 8.5, rev: 4, turn: 1.95, steerRate: 5.5, turnFade: 18, offroad: 0.3, hw: 0.88, gears: 5 },    // 2KD-FTV 102 hp, ~16 s
    defender:    { name: 'OVERLANDER 110', top: 191, accel: 7.6, brake: 9, rev: 4.5, turn: 1.75, steerRate: 4.8, turnFade: 20, offroad: 0.95, hw: 1.0, gears: 8 },
    gclass:      { name: 'G WAGON V8',    top: 220, accel: 12.5, brake: 10, rev: 4.5, turn: 1.75, steerRate: 4.8, turnFade: 20, offroad: 0.9, hw: 0.99, gears: 9 },
    landCruiser: { name: 'LAND CRUISER',  top: 210, accel: 8.3, brake: 9, rev: 4.5, turn: 1.8, steerRate: 4.8, turnFade: 20, offroad: 0.9, hw: 0.99, gears: 8 },       // 3.3 V6 diesel 305 bhp 700 Nm, ~6.7 s
    thar:        { name: 'THAR',          top: 155, accel: 5.0, brake: 8.5, rev: 4.5, turn: 2.0, steerRate: 5.2, turnFade: 17, offroad: 0.95, hw: 0.91, gears: 6 },   // 3-door convertible, 2.2 diesel 130 hp
    hector:      { name: 'MG HECTOR',     top: 190, accel: 5.2, brake: 9, rev: 4.5, turn: 1.95, steerRate: 5.2, turnFade: 19, offroad: 0.35, hw: 0.92, gears: 6 },   // 1.5 turbo petrol 143 ps
    tharRoxx:    { name: 'THAR ROXX',     top: 165, accel: 5.3, brake: 8.5, rev: 4.5, turn: 1.75, steerRate: 4.8, turnFade: 18, offroad: 0.9, hw: 0.94, gears: 6 },   // 2.2 diesel 175 hp, ~10.5 s
    hayabusa:    { name: 'HAYABUSA',      top: 299, accel: 17.4, brake: 12, rev: 2.5, turn: 2.3, steerRate: 7, turnFade: 30, offroad: 0.15, hw: 0.42, gears: 6, lean: true },   // 1340 cc 190 hp, 264 kg, ~3.2 s
    s1000rr:     { name: 'S 1000 RR',     top: 300, accel: 17.9, brake: 13, rev: 2.5, turn: 2.6, steerRate: 8, turnFade: 30, offroad: 0.12, hw: 0.42, gears: 6, lean: true },   // 999 cc 210 hp, 197 kg, ~3.1 s
    r1250gsa:    { name: 'R 1250 GS ADV', top: 200, accel: 13.5, brake: 10.5, rev: 2.5, turn: 2.4, steerRate: 6.5, turnFade: 22, offroad: 0.85, hw: 0.5, gears: 6, lean: true },   // 1254 cc 136 hp, 268 kg, ~4 s
    r1300gsa:    { name: 'R 1300 GS ADV', top: 220, accel: 15, brake: 10.5, rev: 2.5, turn: 2.4, steerRate: 6.5, turnFade: 24, offroad: 0.85, hw: 0.5, gears: 8, lean: true },     // 1300 cc 145 hp, 269 kg, ~3.7 s
    bullockCart: { name: 'BULLOCK CART',  top: 8,   accel: 0.8, brake: 3,   rev: 0.8, turn: 1.0, steerRate: 3,  turnFade: 4,  offroad: 0.9,  hw: 0.9,  gears: 1 },
  };
  VehicleDynamics.applySpecs(PARAMS);   // top speed and ratio count come from the published-data table in vehicle-dynamics.js
  const CRYSTA_HW = 0.95, CRYSTA_LEN = 4.7;
  // vehicle feel per kind (driving agent): body roll gain, pitch gain, max front-wheel steer (rad), tippy = lifts
  // the inside wheel in fast corners (auto rickshaw), spring rate (heavy = slow, wallowy)
  const FEEL = {
    bike: { rollK: 0, pitchK: 0.003, maxSteer: 0.45, w: 10 }, auto: { rollK: 0.016, pitchK: 0.006, maxSteer: 0.55, tippy: 1, w: 8 },
    hatch: { rollK: 0.008, pitchK: 0.005, maxSteer: 0.6, w: 10 }, suv: { rollK: 0.011, pitchK: 0.005, maxSteer: 0.55, w: 9 },
    tractor: { rollK: 0.009, pitchK: 0.007, maxSteer: 0.6, w: 7 }, lorry: { rollK: 0.018, pitchK: 0.007, maxSteer: 0.6, w: 6 },
    bus: { rollK: 0.02, pitchK: 0.007, maxSteer: 0.6, w: 6 }, bullockCart: { rollK: 0.004, pitchK: 0.003, maxSteer: 0, w: 8 },
    splendor: { rollK: 0, pitchK: 0.003, maxSteer: 0.45, w: 10 }, scooter: { rollK: 0, pitchK: 0.004, maxSteer: 0.5, w: 11 },
    classic: { rollK: 0, pitchK: 0.0025, maxSteer: 0.4, w: 8 }, classic2: { rollK: 0, pitchK: 0.0025, maxSteer: 0.4, w: 8 },
    sport: { rollK: 0, pitchK: 0.004, maxSteer: 0.4, w: 12 }, cycle: { rollK: 0, pitchK: 0.002, maxSteer: 0.55, w: 12 },
    mpv: { rollK: 0.009, pitchK: 0.005, maxSteer: 0.55, w: 9 },
    fortuner: { rollK: 0.0125, pitchK: 0.006, maxSteer: 0.55, w: 8 },   // tall body-on-frame: a bit more roll than the Crysta
    swift: { rollK: 0.008, pitchK: 0.005, maxSteer: 0.6, w: 10.5 }, dzire: { rollK: 0.008, pitchK: 0.005, maxSteer: 0.6, w: 10 },
    alto: { rollK: 0.009, pitchK: 0.006, maxSteer: 0.62, w: 10 }, ace: { rollK: 0.015, pitchK: 0.007, maxSteer: 0.6, w: 8 },
    bolero: { rollK: 0.011, pitchK: 0.007, maxSteer: 0.55, w: 7.5 }, scorpio: { rollK: 0.011, pitchK: 0.007, maxSteer: 0.55, w: 7.5 },   // soft ladder-frame utilities
    faired: { rollK: 0, pitchK: 0.004, maxSteer: 0.38, w: 12 },
    safari: { rollK: 0.011, pitchK: 0.007, maxSteer: 0.55, w: 7.5 }, sumo: { rollK: 0.012, pitchK: 0.008, maxSteer: 0.55, w: 7 }, scorpioN: { rollK: 0.012, pitchK: 0.006, maxSteer: 0.55, w: 8.5 },
    swiftNew: { rollK: 0.008, pitchK: 0.005, maxSteer: 0.6, w: 10.5 }, activa: { rollK: 0, pitchK: 0.004, maxSteer: 0.5, w: 11 }, starCity: { rollK: 0, pitchK: 0.003, maxSteer: 0.45, w: 10 },
    defender: { rollK: 0.012, pitchK: 0.005, maxSteer: 0.55, w: 8.5 }, gclass: { rollK: 0.012, pitchK: 0.006, maxSteer: 0.55, w: 8.5 },
    thar: { rollK: 0.016, pitchK: 0.007, maxSteer: 0.58, w: 8 }, hector: { rollK: 0.011, pitchK: 0.005, maxSteer: 0.55, w: 9 },
    crysta: { rollK: 0.01, pitchK: 0.005, maxSteer: 0.55, w: 9 }, crysta2023: { rollK: 0.01, pitchK: 0.005, maxSteer: 0.55, w: 9 },
    hilux: { rollK: 0.013, pitchK: 0.0065, maxSteer: 0.55, w: 8 },   // leaf-sprung pickup: Fortuner roll, a little more pitch
    wagonR: { rollK: 0.011, pitchK: 0.006, maxSteer: 0.6, w: 9.5 }, innova: { rollK: 0.011, pitchK: 0.005, maxSteer: 0.55, w: 8.5 }, landCruiser: { rollK: 0.011, pitchK: 0.005, maxSteer: 0.55, w: 8.5 }, tharRoxx: { rollK: 0.015, pitchK: 0.007, maxSteer: 0.55, w: 8 },
    hayabusa: { rollK: 0, pitchK: 0.004, maxSteer: 0.36, w: 12 }, s1000rr: { rollK: 0, pitchK: 0.004, maxSteer: 0.36, w: 13 }, r1250gsa: { rollK: 0, pitchK: 0.004, maxSteer: 0.42, w: 9 }, r1300gsa: { rollK: 0, pitchK: 0.004, maxSteer: 0.42, w: 9 },
    berlinetta: { rollK: 0.003, pitchK: 0.003, maxSteer: 0.55, w: 14 }, muscle: { rollK: 0.006, pitchK: 0.004, maxSteer: 0.55, w: 11 },
    wedge: { rollK: 0.003, pitchK: 0.003, maxSteer: 0.52, w: 14 }, coupe911: { rollK: 0.004, pitchK: 0.004, maxSteer: 0.58, w: 13 },
  };
  // specific model of a vehicle (userData.type from traffic-models.js), when we tune it
  const typeOf = v => { const t = (v.userData && v.userData.type) || (v.g && v.g.userData && v.g.userData.type) || v.type; return t && PARAMS[t] ? t : v.model; };
  const feelOf = v => FEEL[v._ty || v.model] || FEEL.hatch;
  // engine-audio.js voices for the player's two-wheeler (it reads Player.active._snd.type for model 'bike')
  const SND = { activa: 'scooter', starCity: 'bike', splendor: 'bike', scooter: 'scooter', classic: 'bullet', classic2: 'jawa', sport: 'ktm', faired: 'sportbike', hayabusa: 'i4sport', s1000rr: 'i4sport', r1250gsa: 'boxer', r1300gsa: 'boxer',
    berlinetta: 'v8flat', muscle: 'v8', wedge: 'v10', coupe911: 'flat6', thar: 'scorpioN', hector: 'innova', gclass: 'v8', hilux: 'fortuner', crysta2023: 'innova' };

  // where the driver sits in each TrafficModels vehicle (local x, seat height, local z, HumanModel.sit pose);
  // the same numbers traffic-models.js uses for its AI drivers
  const SEATS = {
    bike: [0, 0.9, -0.28, 'bike'], auto: [0, 0.9, 0.08, 'car'], hatch: [0.36, 0.62, -0.25, 'car'], suv: [0.38, 0.86, -0.2, 'car'],
    hilux: [0.42, 0.95, 0.15, 'car'], crysta2023: [0.4, 0.86, 0.0, 'car'],
    tractor: [0, 1.42, -0.5, 'car'], lorry: [-0.55, 1.5, 3.0, 'car'], bus: [-0.7, 1.3, 4.3, 'car'], bullockCart: [0, 1.1, 0.45, 'bench'],
  };
  const CAM_NAMES = ['CHASE', 'CLOSE CHASE', 'COCKPIT', 'HOOD', 'TOP-DOWN'];
  const FOOT_CAM_NAMES = ['SHOULDER', 'FAR', 'FIRST PERSON', 'LOW CLOSE', 'TOP-DOWN'];

  let mode = 'crysta';             // 'crysta' | 'vehicle' | 'foot' | 'passenger'
  let active = null;               // the non-Crysta vehicle being driven (or ridden in as a passenger)
  let lastLeft = null;             // the vehicle the player last got out of (lower priority for the next F)
  const parked = [];               // vehicles standing still with collision: { g, len, hw, rot, crysta?, wheels, tail, model }
  const crystaState = { rot: 0 };
  const fleeing = [];              // carjacked drivers running away: { h, t, vx, vz, phase }
  let passengerExit = null;        // auto-rides.js: called when the player leaves a ride with F / R

  // ---------------------------------------------------------------- on-foot villager
  const ped = { vy: 0, y: 0, phase: 0, speed: 0 };
  // villager built by people-models.js (HumanModel); parts are jointed groups we swing in walk()
  // Fixed default look (blue shirt, checked lungi, short hair, stubble, chappals). Only gender/outfit/colours used to
  // be passed, so normalize() re-rolled hair (incl. 'curly'), face, beard and lungi colour on every load; the look the
  // user liked is this one. A character saved in the creator still replaces it (character-creator.js).
  const human = HumanModel.create({ gender: 'm', top: 'shirt', bottom: 'lungi', topColor: 0x2f6fb3, bottomColor: 0xf4cccc, color: 0x2f6fb3,
    skin: 0x8d5a3b, hair: 'short', hairColor: 0x141210, facial: 'stubble', face: 'oval', brows: 'medium', eyes: 0x2a1a10,
    feet: 'chappals', feetColor: 0x5a3a24, acc: {}, height: 1, build: 1 });
  const body = human.group, hp = human.parts;
  body.visible = false;                                         // added to the scene on first exit

  // ---------------------------------------------------------------- helpers
  const fwdOf = r => ({ x: Math.sin(r), z: Math.cos(r) });
  // distance from point to a vehicle's long axis, and the closest axis point
  const NO_C = { x: 0, z: 0 };
  function fpCentre(v) {
    if (v._fp) return { x: v._fp.cx || 0, z: v._fp.cz || 0 };
    const uc = (v.userData && v.userData.center) || (v.g && v.g.userData && v.g.userData.center);
    return uc ? { x: uc.x || 0, z: uc.z || 0 } : NO_C;
  }
  function axisDist(x, z, v) {
    const len = v.len2 ? v.len2 * 2 : v.len;       // traffic items reuse .len for the route length
    const r = v.g.rotation.y, f = fwdOf(r), half = Math.max(0, len / 2 - v.hw);
    // footprint centre: models whose origin isn't their middle (tractor + trolley, cart) carry userData.center
    const c = fpCentre(v), ox = v.g.position.x + f.x * c.z + Math.cos(r) * c.x, oz = v.g.position.z + f.z * c.z - Math.sin(r) * c.x;
    const t = THREE.MathUtils.clamp((x - ox) * f.x + (z - oz) * f.z, -half, half);
    const cx = ox + f.x * t, cz = oz + f.z * t;
    return { d: Math.hypot(x - cx, z - cz), cx, cz };
  }
  // push a point {x,z} of radius r out of every parked vehicle; returns the push normal or null
  // veh: the pusher is a vehicle. A knocked-over bike doesn't stop a vehicle: checkBikeHits shoves it along instead.
  function pushOutParked(p, r, veh) {
    let hit = null;
    for (const v of parked) {
      if (veh && v._down) continue;
      const a = axisDist(p.x, p.z, v), min = v.hw + r;
      if (a.d < min) {
        const nx = a.d > 0.001 ? (p.x - a.cx) / a.d : 1, nz = a.d > 0.001 ? (p.z - a.cz) / a.d : 0;
        p.x = a.cx + nx * min; p.z = a.cz + nz * min; hit = { nx, nz };
      }
    }
    return hit;
  }
  function setHud() {
    const el = document.getElementById('veh');
    if (el) el.textContent = mode === 'foot' ? 'ON FOOT' : mode === 'crysta' ? 'CRYSTA' : mode === 'passenger' ? 'PASSENGER' : (active.p || PARAMS[active.model] || PARAMS.hatch).name;
  }
  // the AI driver is the first HumanModel added to a TrafficModels group (driver before passengers)
  function driverOf(v) { return v.g.children.find(o => o.userData && o.userData.human && o !== body) || null; }

  // ---------------------------------------------------------------- the player's own body in a seat
  function seatBody(v, seat) {
    const us = v.userData && v.userData.seat;
    const s = seat || (us && us.length >= 3 ? [us[0], us[1], us[2], us[3] || SEATS[v.model] && SEATS[v.model][3] || 'car'] : null) || SEATS[v.model] || SEATS.hatch;
    if (body.parent) body.parent.remove(body);
    v.g.add(body);
    body.position.set(s[0], s[1] - human.hipHeight, s[2]); body.rotation.set(0, 0, 0);
    body.userData.pose = s[3];
    HumanModel.sit(hp, s[3]);
    body.visible = true;
    if (s[3] === 'car' && !(v.userData && v.userData.twoWheeler) && TrafficModels.headLift) body.position.y += TrafficModels.headLift(v.g, body, s[0], s[2]);   // keeps the head under this car's roof
  }
  function unseatBody() {
    if (body.parent && body.parent !== scene) { body.parent.remove(body); }
    if (!body.parent) scene.add(body);
    body.userData.pose = null; body.rotation.set(0, 0, 0);
    HumanModel.animateIdle(hp, 0);
  }

  // ---------------------------------------------------------------- carjacking: the AI driver gets out and runs
  function shout() { const w = ['అరే!', 'అరే! ఏంటిది?!', 'దొంగ! దొంగ!', 'అయ్యో!']; return w[Math.random() * w.length | 0]; }
  function ejectDriver(v, run) {
    const d = driverOf(v); if (!d) return false;
    const h = d.userData.humanRef;
    v.g.updateMatrixWorld(true);
    const rot = v.g.rotation.y, side = { x: -Math.cos(rot), z: Math.sin(rot) }, off = (v.hw || 0.9) + 0.5;
    v.g.remove(d);
    if (!run || !h) return true;                        // parked / stored vehicles: nobody to animate
    scene.add(d);
    const x = v.g.position.x + side.x * off, z = v.g.position.z + side.z * off;
    d.position.set(x, 0, z); d.rotation.set(0, 0, 0);
    // run away from the vehicle, a bit backwards, with some randomness
    const a = Math.atan2(side.x, side.z) + (Math.random() - 0.5) * 0.9;
    fleeing.push({ g: d, h, t: 0, a, phase: 0 });
    HumanModel.animateIdle(h.parts, 0);
    showComboPopup(shout());
    return true;
  }
  function updateFleeing(dt) {
    for (let i = fleeing.length - 1; i >= 0; i--) {
      const f = fleeing[i]; f.t += dt;
      const spd = f.t < 0.6 ? 0.8 : 4.4;                // step out, then run
      if (f.t > 0.6 && f.t < 0.75) f.a += (Math.random() - 0.5) * 0.4;
      const p = { x: f.g.position.x + Math.sin(f.a) * spd * dt, z: f.g.position.z + Math.cos(f.a) * spd * dt };
      const c = world.collide(p, 0.3); if (c && c.hit) f.a += 0.8;
      f.g.position.set(p.x, 0, p.z); f.g.rotation.y = f.a;
      f.phase += spd * dt * 3.2; HumanModel.animateWalk(f.h.parts, f.phase, spd);
      if (f.t > 7) { scene.remove(f.g); fleeing.splice(i, 1); }
    }
  }
  // ---------------------------------------------------------------- lamps for whatever the player drives
  // head/tail lamp meshes come from traffic-models.js (v.head / v.tail); otherwise found by material colour, and if
  // a model has none, small lamp quads are added at its front / back from its bounding box. L (headlightsOn) and the
  // brake drive them; one shared SpotLight rides on the front of the active vehicle.
  let pSpot = null;
  function lampsOf(v) {
    if (v._lamps) return v._lamps;
    let head = (v.head || []).filter(m => m && m.material), tail = (v.tail || []).filter(m => m && m.material);
    if (!head.length || !tail.length) {
      const fh = [], ft = [];
      v.g.traverse(o => { if (!o.isMesh || !o.material || Array.isArray(o.material) || isHumanPart(o)) return;
        const n = (o.material.name || o.name || '').toLowerCase(), c = o.material.color;
        if (/head ?l(amp|ight)|headlamp/.test(n) || (c && c.getHex() === 0x777766)) fh.push(o);
        else if (/tail ?l(amp|ight)|brake/.test(n) || (c && c.getHex() === 0x661111)) ft.push(o); });
      if (!head.length) head = fh; if (!tail.length) tail = ft;
    }
    const bx = boxOf(v), mk = (front) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.08), new THREE.MeshBasicMaterial({ color: front ? 0x777766 : 0x661111, side: THREE.DoubleSide }));
      m.position.set(0, Math.max(0.5, bx.max.y * 0.5), front ? bx.max.z + 0.01 : bx.min.z - 0.01); m.name = front ? 'headlamp-added' : 'taillamp-added';
      v.g.add(m); return m; };
    if (!head.length) head = [mk(true)]; if (!tail.length) tail = [mk(false)];
    // the material is shared per vehicle kit, but clone if it is shared with other vehicles' lamps
    const own = arr => arr.forEach(m => { if (!m.userData._ownMat) { m.material = m.material.clone(); m.userData._ownMat = true; if (m.lens) m.lens.visible = true; } });
    own(head); own(tail);
    return (v._lamps = { head, tail, front: bx.max.z, y: Math.max(0.5, bx.max.y * 0.45) });
  }
  function setTail(v, on) {
    const L = lampsOf(v), lights = typeof headlightsOn !== 'undefined' && headlightsOn && v === active;
    L.tail.forEach(m => m.material.color.setHex(on ? 0xff1a1a : lights ? 0xb01818 : 0x661111));
    L.head.forEach(m => m.material.color.setHex(lights ? 0xfff6d8 : 0x777766));
  }
  function syncSpot() {}                                     // beams are decals now: vehicle-lights.js

  // ---------------------------------------------------------------- get in / out
  // a spot where the walker (radius WALK_R) can stand: no wall within reach, not in a building footprint, not
  // in any vehicle, and reachable from the vehicle without crossing a wall (so never the far side of a compound wall)
  const WALK_R = 0.4;
  function vehicleAt(x, z, r, skip) {
    for (const v of parked) if (v !== skip && v.g && axisDist(x, z, v).d < v.hw + r) return v;
    for (const v of traffic) if (v !== skip && v.g && v.hw && axisDist(x, z, v).d < v.hw + r) return v;
    const P = window.Parked && Parked.vehicles;
    if (P) for (const it of P) { if (it.claimed || Math.abs(it.x - x) > 8 || Math.abs(it.z - z) > 8) continue; if (pkDist(x, z, it) < r) return it; }
    return null;
  }
  function spotFree(x, z, fx, fz, skip) {
    const q = { x, z }, c = world.collide(q, WALK_R);
    if (c && c.hit) return false;
    if (world.insideBuilding && world.insideBuilding(x, z, 0.25)) return false;
    if (vehicleAt(x, z, WALK_R, skip)) return false;
    // line of sight from the seat to the spot: no wall segment or building edge in between
    const L = Math.hypot(x - fx, z - fz), n = Math.max(2, Math.ceil(L / 0.2));
    for (let i = 1; i < n; i++) {
      const k = i / n, s2 = { x: fx + (x - fx) * k, z: fz + (z - fz) * k }, c2 = world.collide(s2, 0.06);
      if (c2 && c2.hit) return false;
      if (world.insideBuilding && world.insideBuilding(s2.x, s2.z, 0)) return false;
    }
    return true;
  }
  // GTA order: driver door (right-hand drive = right side), passenger door, behind, in front, then hop over
  // the roof / slide out further away. null = nowhere to stand.
  function findExit(cx, cz, rot, hw, len, self) {
    const f = fwdOf(rot), rt = { x: -Math.cos(rot), z: Math.sin(rot) }, side = hw + WALK_R + 0.2, end = len / 2 + WALK_R + 0.25;
    const C = [];
    for (const sd of [1, -1]) for (const t of [0, -0.6, 0.6, -1.2]) C.push([sd * side, t]);
    for (const t of [-end, end]) for (const l of [0, 0.6, -0.6]) C.push([l, t]);
    for (const sd of [1, -1]) for (const t of [0, -0.8, 0.8]) C.push([sd * (side + 1.0), t]);   // roof-hop / further out
    for (const [l, t] of C) {
      const x = cx + rt.x * l + f.x * t, z = cz + rt.z * l + f.z * t;
      if (Math.abs(t) > 0.01 && Math.abs(l) > 0.01 && Math.abs(t) > len / 2) continue;
      if (spotFree(x, z, cx, cz, self)) return { x, z };
    }
    // boxed in (a row of parked bikes, a narrow lane): the nearest free spot on rings further out
    for (let r = Math.max(hw, len / 2) + WALK_R + 0.5; r < Math.max(hw, len / 2) + 4; r += 0.5)
      for (let k = 0; k < 16; k++) {
        const a = rot + Math.PI / 2 + k / 16 * Math.PI * 2, x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
        if (spotFree(x, z, cx, cz, self)) return { x, z };
      }
    return null;
  }
  function exitTo(rot, spot) {
    carPos.set(spot.x, 0, spot.z);
    carRot = rot; ped.dir = rot; carSpeed = 0; ped.vy = 0; ped.air = false; ped.jumpHeld = true; ped.crouch = 0; ped.land = 0; ped.buffer = 0;
    ped.y = groundAt(spot.x, spot.z); lastSafe.x = spot.x; lastSafe.z = spot.z;
    unseatBody();
    mode = 'foot'; body.visible = true; isReversing = false; currentGear = '-'; engineRPM = 800;
    camSnap = true;
    showComboPopup('ON FOOT');
  }
  function getOut() {
    if (mode === 'passenger') { const v = active; if (passengerExit) passengerExit(v); leavePassenger(); return; }
    if (Math.abs(carSpeed) > 15) { showComboPopup('SLOW DOWN TO GET OUT'); return; }
    if (mode === 'crysta') {
      const spot = findExit(playerCarGroup.position.x, playerCarGroup.position.z, carRot, CRYSTA_HW, CRYSTA_LEN, null);
      if (!spot) { showComboPopup('NO SPACE TO GET OUT'); return; }
      crystaState.rot = carRot; vel.x = vel.z = 0; yawRate = 0;
      const c = { g: playerCarGroup, len: CRYSTA_LEN, hw: CRYSTA_HW, crysta: true };
      parked.push(c); lastLeft = c;
      exitTo(carRot, spot);
      engineOff('crysta');
    } else {
      const v = active, spot = findExit(v.g.position.x, v.g.position.z, v.g.rotation.y, v.hw, v.len || 4, v);
      if (!spot) { showComboPopup('NO SPACE TO GET OUT'); return; }
      v.g.rotation.z = 0;
      parked.push(v); active = null; lastLeft = v;
      setTail(v, false); syncSpot(null);
      exitTo(v.g.rotation.y, spot);
      engineOff(v);
    }
    setHud();
  }
  // parked.js instanced vehicles (not yet in any list): distance from a point to their body
  // the real (visible) footprint of each parked.js kind, measured once from its instanced geometry: a tractor's
  // trolley or a cart's shafts sit well off the item's origin, so an origin-centred box misses half the vehicle
  const pkGeo = {};
  function pkShape(it) {
    let g = pkGeo[it.vk];
    if (g === undefined) {
      g = null;
      scene.traverse(o => { if (g || !o.isInstancedMesh || o.name !== 'parked-' + it.vk) return;
        o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox;
        g = { cz: (b.min.z + b.max.z) / 2, cx: (b.min.x + b.max.x) / 2, hl: (b.max.z - b.min.z) / 2, hw: (b.max.x - b.min.x) / 2 }; });
      pkGeo[it.vk] = g;
    }
    return g ? { cz: g.cz, cx: g.cx, hl: Math.max(it.hl, g.hl), hw: Math.max(it.hw, g.hw) } : { cz: 0, cx: 0, hl: it.hl, hw: it.hw };
  }
  function pkDist(x, z, it) {
    const S = pkShape(it), fx = Math.sin(it.rot), fz = Math.cos(it.rot), half = Math.max(0, S.hl - S.hw);
    const ox = it.x + fx * S.cz + Math.cos(it.rot) * S.cx, oz = it.z + fz * S.cz - Math.sin(it.rot) * S.cx;
    const t = THREE.MathUtils.clamp((x - ox) * fx + (z - oz) * fz, -half, half);
    return Math.hypot(x - ox - fx * t, z - oz - fz * t) - S.hw;
  }
  // ONE candidate search for both the on-screen hint and F: Player's parked list (Crysta, vehicles you left,
  // property garages), traffic (carjack) and parked.js's instanced vehicles. Anything within PICK_R of its
  // body counts; the one you face wins, the vehicle you just left only when nothing else is close.
  const PICK_R = 2.5;
  function pickVehicle() {
    let best = null;
    const fx = Math.sin(carRot), fz = Math.cos(carRot);
    const score = (d, cx, cz, extra) => {
      const dx = cx - carPos.x, dz = cz - carPos.z, n = Math.hypot(dx, dz) || 1;
      const facing = (dx * fx + dz * fz) / n;                 // 1 = straight ahead, -1 = behind
      // raw distance (not clamped at 0): side-by-side bikes all within reach still rank by which is nearest
      return d + (1 - facing) * 0.3 + extra;
    };
    const consider = (v, list) => {
      if (!v || !v.g) return;
      const a = axisDist(carPos.x, carPos.z, v), d = a.d - v.hw; if (d > PICK_R) return;
      const sc = score(d, a.cx, a.cz, v === lastLeft ? 1.2 : 0);
      if (!best || sc < best.score) best = { v, d, list, score: sc };
    };
    parked.forEach(v => consider(v, parked));
    traffic.forEach(t => { if (!t.g) return; if (!t.hw) t.hw = (PARAMS[t.model] || PARAMS.hatch).hw; if (t.noJack) return; consider(t, traffic); });
    // parked.js claims its own nearest item by plain distance on F, so rank those by plain distance (+ a
    // constant): whichever of them wins here is exactly the one parked.js hands over
    const P = window.Parked && Parked.vehicles;
    // nellutla-world.js street props: the red / black Splendors parked along village lanes (world.props.bike*)
    const PB = propBikesNear(carPos.x, carPos.z);
    for (const b of PB) {
      const d = pkDist(carPos.x, carPos.z, b);
      if (d < PICK_R) { const sc = score(d, b.x, b.z, 0); if (!best || sc < best.score) best = { v: null, prop: b, d, list: null, score: sc }; }
    }
    if (P) {
      let pb = null;
      for (const it of P) { if (it.claimed || Math.abs(it.x - carPos.x) > 16 || Math.abs(it.z - carPos.z) > 16) continue;
        const d = pkDist(carPos.x, carPos.z, it); if (d < PICK_R && (!pb || d < pb.d)) pb = { it, d }; }
      if (pb) { const sc = Math.max(0, pb.d) + 0.3; if (!best || sc < best.score) best = { v: null, pk: pb.it, d: pb.d, list: null, score: sc }; }
    }
    return best;
  }
  // ---- world prop bikes: instanced decoration in nellutla-world.js, swapped for a real rideable bike on F
  const propTaken = new Set(), _m0 = new THREE.Matrix4().makeScale(0, 0, 0), _pm = new THREE.Matrix4(), _pv = new THREE.Vector3();
  function propBikesNear(x, z) {
    const out = [], PR = world.props; if (!PR) return out;
    for (const kind of ['bike', 'bike2']) {
      const L = PR[kind]; if (!L) continue;
      for (let i = 0; i < L.length; i++) {
        const q = L[i]; if (Math.abs(q[0] - x) > 6 || Math.abs(q[1] - z) > 6 || propTaken.has(kind + i)) continue;
        out.push({ kind, i, x: q[0], z: q[1], rot: q[2], vk: 'propbike', hw: 0.42, hl: 0.98 });
      }
    }
    return out;
  }
  function hideProp(kind, i) {        // also called by multiplayer when another player takes this bike
    const L = world.props[kind], q = L && L[i]; if (!q) return;
    // hide that one instance (the world's InstancedMesh for this kind has exactly L.length instances)
    world.group.children.forEach(o => {
      if (!o.isInstancedMesh || o.count !== L.length) return;
      o.getMatrixAt(i, _pm); _pv.setFromMatrixPosition(_pm);
      if (Math.abs(_pv.x - q[0]) < 0.01 && Math.abs(_pv.z - q[1]) < 0.01) { o.setMatrixAt(i, _m0); o.instanceMatrix.needsUpdate = true; }
    });
    propTaken.add(kind + i);
  }
  function takePropBike(b) {
    hideProp(b.kind, b.i);
    if (typeof TrafficModels === 'undefined') return null;
    const m = TrafficModels.splendor ? TrafficModels.splendor() : TrafficModels.bike('splendor');
    if (b.kind === 'bike') m.g.traverse(o => { if (o.isMesh && o.material && o.material.isMeshPhongMaterial && o.material.shininess === 85) o.material = new THREE.MeshPhongMaterial({ color: 0xb71c1c, specular: 0x8a8a8a, shininess: 85 }); });
    m.g.position.set(b.x, 0, b.z); m.g.rotation.y = b.rot; scene.add(m.g);
    const t = { ...m, model: 'bike', type: 'splendor', parked: true, len2: (m.len || 2) / 2, r: null, speed: 0, cur: 0, s: 0, dir: 1, len: 0, hw: 0.42, wheelR: 0.33, wheels: m.wheels || [], tail: m.tail || [] };
    // the prop's small world collider (a 1.2 m bar) stays; it sits inside the bike's own footprint
    return t;
  }
  // parked.js's F hook turns the instanced vehicle into a traffic item; find it (or run the hooks ourselves when
  // F came from the gamepad / another path that skipped them)
  function claimedParked(it) {
    const find = () => traffic.find(t => t.parked && t.g && Math.abs(t.g.position.x - it.x) < 0.01 && Math.abs(t.g.position.z - it.z) < 0.01);
    let t = find();
    // parked.js's own F hook claims whatever is nearest to the player by ITS metric (origin-centred box, < 3 m),
    // which can be a different vehicle or nothing at all (long tractor / cart, F from the gamepad). Ask it for
    // exactly this one: stand it "on" the item's origin. Anything it claimed by itself and we don't take is put
    // back by its own microtask.
    if (!t && typeof GameHooks !== 'undefined') {
      const hook = GameHooks.key.find(f => /claimNearest/.test(String(f)));
      if (hook) { try { hook({ code: 'KeyF', key: 'f', repeat: false }, { playerMode: 'foot', carPos: { x: it.x, z: it.z }, traffic }); } catch (err) {} }
      t = find();
    }
    return t;
  }
  let hintPick = null, hintAt = 0;
  function getIn() {
    let best = pickVehicle();
    // the hint said a vehicle was there a moment ago: honour it (the player only shuffled a few cm since)
    if (!best && hintPick && performance.now() - hintAt < 1000) best = hintPick;
    if (best && best.pk) {
      const t = claimedParked(best.pk);
      best = t ? { v: t, list: traffic } : null;
    } else if (best && best.prop) {
      const t = takePropBike(best.prop);
      best = t ? { v: t, list: parked } : null;
    }
    if (!best || !best.v) { showComboPopup('NO VEHICLE NEARBY'); return; }
    hintPick = null;
    const v = best.v;
    // a vehicle can sit in both lists (properties.js stored vehicles): take it out of both
    for (const L of [parked, traffic]) { const i = L.indexOf(v); if (i >= 0) L.splice(i, 1); }
    lastLeft = null;
    if (v.crysta) {
      body.visible = false; unseatBody(); body.visible = false;
      mode = 'crysta';
      carPos.set(playerCarGroup.position.x, 0.44, playerCarGroup.position.z); carRot = crystaState.rot;
      vel.x = vel.z = 0; yawRate = 0; carSpeed = 0; lastSpeed = 0; gearIdx = 0; isReversing = false; currentGear = 1;
      snapCameraToCar();
    } else {
      // carjack: a traffic vehicle with an AI driver stops, the driver gets out and runs
      const jacked = best.list === traffic && !v.parked && !v._propSlot && !!driverOf(v);
      if (jacked) { ejectDriver(v, true); v.cur = 0; }
      else ejectDriver(v, false);                          // any leftover driver mesh goes; the player drives now
      mode = 'vehicle'; active = v;
      if (v.len2) { v.len = v.len2 * 2; delete v.len2; }               // body length, no longer the route length
      v._ty = typeOf(v); v.p = PARAMS[v._ty] || PARAMS[v.model] || PARAMS.hatch;
      if (SND[v._ty]) v._snd = Object.assign(v._snd || { pitch: 1, lastV: 0, stopT: 0 }, { type: SND[v._ty] });
      if (v._down) { v.g.rotation.z = 0; for (const R of v._down.riders) { scene.remove(R.h); } delete v._down; if (v._spd !== undefined) { v.speed = v._spd; delete v._spd; } }
      v.vF = jacked ? 0 : (v.vF || 0); v.vL = 0; v.yawRate = 0; v.steer = 0;
      carPos.set(v.g.position.x, 0, v.g.position.z); carRot = v.g.rotation.y;
      carSpeed = v.lastSpeed = v.vF * 3.6;
      seatBody(v);
      camSnap = true;
      if (v.onTaken) try { v.onTaken(v); } catch (e) {}
    }
    enterCard(mode === 'crysta' ? null : v); engineStart(mode === 'crysta' ? 'crysta' : v);
    setHud();
  }
  // ---------------------------------------------------------------- engine on/off + "now driving" card
  const kindOf = v => { if (!v) return 'foot'; if (v.crysta || v === 'crysta') return 'crysta'; const t = v._ty || typeOf(v) || v.model || 'car'; return SND[t] || t; };
  function engineOff(v) { try { window.SFX && SFX.engineOff && SFX.engineOff(kindOf(v)); } catch (e) {} }
  function engineStart(v) { try { window.SFX && SFX.engineStart && SFX.engineStart(kindOf(v)); } catch (e) {} }
  const NICE = { defender: 'Overlander 110', gclass: 'G Wagon V8', thar: 'Mahindra Thar', hector: 'MG Hector', safari: 'Tata Safari', sumo: 'Tata Sumo Gold', scorpioN: 'Mahindra Scorpio-N', swiftNew: 'Swift (2024)', activa: 'Honda Activa', starCity: 'TVS Star City+', fortuner: 'Fortuner 4x4', hilux: 'Hilux 4x4 Double Cab', crysta2023: 'Innova Crysta 2023', mpv: 'Crysta-style MPV', suv: 'SUV', hatch: 'Hatchback', swift: 'Swift (2010)', dzire: 'Dzire', alto: 'Alto 800',
    bolero: 'Bolero', scorpio: 'Scorpio Classic', ace: 'Tata Ace Mini Truck', tractor: 'Tractor', lorry: 'Lorry', bus: 'RTC Bus', auto: 'Auto Rickshaw',
    bike: 'Motorbike', splendor: 'Splendor', scooter: 'Scooter', classic: 'Classic 350', classic2: 'Jawa Classic', sport: 'Sport / Adventure Bike',
    faired: 'Faired Sport 155', cycle: 'Bicycle', bullockCart: 'Bullock Cart' };
  const COLS = [[0x111111, 'Black'], [0xf2f2f2, 'White'], [0xb8bcc2, 'Silver'], [0x6b6f75, 'Grey'], [0xb01c1c, 'Red'], [0x7a1420, 'Maroon'], [0x1c4fb0, 'Blue'],
    [0x13284f, 'Navy'], [0x1f7a3a, 'Green'], [0xf2c200, 'Yellow'], [0xe8761c, 'Orange'], [0x8a6a3c, 'Bronze'], [0xd8c8a0, 'Beige'], [0x4a2a6a, 'Purple']];
  function colourName(v) {
    const cnt = new Map();
    v.g.traverse(o => { if (!o.isMesh || isHumanPart(o) || !o.material || Array.isArray(o.material) || !o.material.isMeshPhongMaterial) return;
      const m = o.material; if (m.transparent || m.shininess !== 85) return; cnt.set(m, (cnt.get(m) || 0) + 1); });
    let best = null, n = 0; cnt.forEach((k, m) => { if (k > n) { n = k; best = m; } });
    if (!best) return '';
    const c = best.color; let nm = '', d = 1e9;
    for (const [h, name] of COLS) { const r = ((h >> 16) & 255) / 255 - c.r, g = ((h >> 8) & 255) / 255 - c.g, b = (h & 255) / 255 - c.b, dd = r * r + g * g + b * b; if (dd < d) { d = dd; nm = name; } }
    return nm;
  }
  function vehicleTitle(v) {
    if (!v || v.crysta || mode === 'crysta') return { name: 'Innova Crysta 2.4 V', sub: 'TS 08 HN 1111' };
    const t = v._ty || typeOf(v), base = NICE[t] || (v.p && v.p.name ? v.p.name.charAt(0) + v.p.name.slice(1).toLowerCase() : 'Vehicle');
    let col = ''; try { col = colourName(v); } catch (e) {}
    return { name: (col ? col + ' ' : '') + base, sub: v.p ? Math.round(v.p.top) + ' km/h top · ' + (v.p.gears > 1 ? v.p.gears + '-speed' : 'single speed') : '' };
  }
  function enterCard(v) {
    let el = document.getElementById('vehCard');
    if (!el) {
      const st = document.createElement('style');
      st.textContent = '#vehCard{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 18%);transform:translate(-50%,-12px) scale(.96);z-index:40;pointer-events:none;opacity:0;transition:opacity .35s,transform .35s cubic-bezier(.2,.8,.2,1);text-align:center;padding:12px 30px 14px;border-radius:14px;background:linear-gradient(135deg,rgba(12,16,28,.88),rgba(30,20,8,.82));border:1px solid rgba(251,191,36,.45);box-shadow:0 10px 40px rgba(0,0,0,.45),inset 0 0 0 1px rgba(255,255,255,.05);font-family:system-ui,sans-serif;color:#fff;min-width:220px}'
        + '#vehCard.on{opacity:1;transform:translate(-50%,0) scale(1)}#vehCard small{display:block;font:700 10px system-ui;letter-spacing:.32em;color:#fbbf24;text-transform:uppercase}'
        + '#vehCard b{display:block;font:800 clamp(20px,3.4vw,30px)/1.15 system-ui;letter-spacing:.02em;margin-top:4px}#vehCard i{display:block;font:500 12px system-ui;font-style:normal;color:#cbd5e1;margin-top:3px}'
        + '#vehCard:after{content:"";display:block;height:2px;margin:9px auto 0;width:60%;background:linear-gradient(90deg,transparent,#fbbf24,transparent)}';
      document.head.appendChild(st);
      el = document.createElement('div'); el.id = 'vehCard'; document.body.appendChild(el);
    }
    const t = vehicleTitle(v);
    el.innerHTML = '<small>Now driving</small><b></b><i></i>'; el.children[1].textContent = t.name; el.children[2].textContent = t.sub;
    el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 2000);
  }
  function toggle() { if (mode === 'foot') getIn(); else getOut(); hintT = 1; if (hintEl && mode !== 'foot') hintEl.style.display = 'none'; }

  // ---------------------------------------------------------------- riding as a passenger (auto-rides.js drives)
  function enterPassenger(v, seat) {
    if (mode !== 'foot') return false;
    for (const L of [parked, traffic]) { const i = L.indexOf(v); if (i >= 0) L.splice(i, 1); }
    mode = 'passenger'; active = v; v.p = PARAMS[v.model] || PARAMS.auto;
    if (!v.len || v.len > 20) v.len = v.len2 ? v.len2 * 2 : 2.8;
    seatBody(v, seat || [0.3, 0.88, -0.85, 'bench']);
    carPos.set(v.g.position.x, 0, v.g.position.z); carRot = v.g.rotation.y; carSpeed = 0;
    camSnap = true; setHud();
    return true;
  }
  function leavePassenger() {
    if (mode !== 'passenger') return;
    const v = active; active = null;
    const x = v.g.position.x, z = v.g.position.z, r = v.g.rotation.y;
    // auto-rides.js has already let us go: take the best free spot, else the kerb side (the safety net in walk()
    // then pushes us clear of anything solid)
    const spot = findExit(x, z, r, v.hw || 0.75, v.len && v.len < 20 ? v.len : 2.8, v) || { x: x - Math.cos(r) * ((v.hw || 0.75) + 0.6), z: z + Math.sin(r) * ((v.hw || 0.75) + 0.6) };
    exitTo(r, spot);
    setHud();
  }

  // ---------------------------------------------------------------- generic vehicle dynamics (everything except the Crysta)
  function driveVehicle(dt, v) {
    const P = v.p;
    if (!v._fp) initFootprint(v);
    // traffic crashes scale carSpeed from outside; mirror that onto our speed
    if (Math.abs(carSpeed - v.lastSpeed) > 0.01) { const k = Math.abs(v.lastSpeed) > 0.1 ? carSpeed / v.lastSpeed : 0; v.vF *= k; v.vL *= k; }
    surface = world.surfaceAt(carPos.x, carPos.z);
    if (typeof bundY === 'function' && bundY(carPos.x, carPos.z) > 0.05) v.vF *= 1 - 1.5 * dt;   // bump and scrub speed crossing a field bund
    const mu = MU[surface] + (1 - MU[surface]) * P.offroad;
    const top = P.top / 3.6 * (0.45 + 0.55 * mu);
    const PT = VehicleDynamics.ptFor(v, v._ty);
    const steerIn = (typeof padIn !== 'undefined' && Math.abs(padIn.steer) > 0.12) ? padIn.steer : (inputState.left ? 1 : 0) - (inputState.right ? 1 : 0);
    const VD = v._vd || (v._vd = VehicleDynamics.forVehicle(v, v._ty)); VD.limG = VD.limG || 8;
    if (!P.lean) { VehicleDynamics.steer(VD, steerIn, v.vF, dt); v.steer = VD.s; } else if (VD.phi === undefined) VD.phi = -v.g.rotation.z;
    const vF0 = v.vF;

    let braking = false;
    if (inputState.gas) {
      if (v.vF < -0.3) { v.vF = Math.min(0, v.vF + P.brake * dt); braking = true; }
      else if (PT) v.vF = Math.min(top, Math.max(0, v.vF) + VehicleDynamics.ptStep(PT, Math.max(0, v.vF), 1, mu, CRR[surface], v.trailer ? 2500 : 0, dt) * dt);
      else v.vF = Math.min(top, v.vF + P.accel * mu * Math.max(0.15, 1 - v.vF / top) * dt);
    } else if (inputState.brake) {
      if (v.vF > 0.3) { v.vF = Math.max(0, v.vF - P.brake * mu * dt); braking = true; }
      else v.vF = Math.max(-P.rev, v.vF - P.accel * 0.6 * dt);
    } else {
      const coast = PT && v.vF > 0 ? -VehicleDynamics.ptStep(PT, v.vF, 0, mu, CRR[surface], v.trailer ? 2500 : 0, dt) * dt : (0.8 + CRR[surface] * 20) * dt + v.vF * v.vF * 0.0008 * dt;
      v.vF -= Math.sign(v.vF) * Math.min(Math.abs(v.vF), Math.max(0, coast));
    }
    if (v.vF > top) v.vF -= (v.vF - top) * Math.min(1, dt * 2);       // too fast for this surface
    if (inputState.drift) { v.vF -= Math.sign(v.vF) * Math.min(Math.abs(v.vF), P.brake * 0.5 * dt); braking = true; }

    // yaw: kinematic bicycle + understeer + tyre curve + weight transfer (vehicle-dynamics.js); zero at standstill
    VD.r = v.yawRate;
    if (P.lean) { v.yawRate = VehicleDynamics.bike(VD, steerIn, v.vF, mu, (v.vF - vF0) / Math.max(dt, 1e-4), dt); v.steer = VD.delta / VD.deltaMax; }
    else v.yawRate = VehicleDynamics.cornering(VD, v.vF, mu, (v.vF - vF0) / Math.max(dt, 1e-4), dt, inputState.drift && Math.abs(v.vF) > 6 ? 1.6 : 0);
    carRot += v.yawRate * dt;
    // the body follows the kinematic / tyre-slip side velocity; collision shoves die off with grip
    { const lim = mu * 9.81 * dt * 1.5; v.vL += THREE.MathUtils.clamp(VD.vL - v.vL, -lim, lim); }

    const f = fwdOf(carRot), l = { x: Math.cos(carRot), z: -Math.sin(carRot) };
    let vx = f.x * v.vF + l.x * v.vL, vz = f.z * v.vF + l.z * v.vL;
    carPos.x += vx * dt; carPos.z += vz * dt;
    const [x0, z0, x1, z1] = world.bounds;
    carPos.x = Math.max(x0 + 5, Math.min(x1 - 5, carPos.x)); carPos.z = Math.max(z0 + 5, Math.min(z1 - 5, carPos.z));

    // collisions: a row of circles (radius = half width) covering the real oriented footprint
    let hitN = null;
    for (const s of v._fp.probes) {
      const cx = v._fp.cx || 0, p = { x: carPos.x + f.x * s + l.x * cx, z: carPos.z + f.z * s + l.z * cx }, px = p.x, pz = p.z;
      let c = typeof wallProbeRadius === 'function' ? (wallProbeRadius(p.x, p.z, v.hw + 0.1) ? world.collide(p, wallProbeRadius(p.x, p.z, v.hw + 0.1)) : { hit: false }) : world.collide(p, v.hw + 0.1);
      const pc = pushOutParked(p, v.hw * 0.8, true);
      if (!c.hit && pc) c = { hit: true, nx: pc.nx, nz: pc.nz };
      if (c.hit) {
        carPos.x += p.x - px; carPos.z += p.z - pz;
        if (c.nx !== undefined) hitN = { nx: c.nx, nz: c.nz }; else { const d = Math.hypot(p.x - px, p.z - pz); if (d > 1e-5) hitN = { nx: (p.x - px) / d, nz: (p.z - pz) / d }; }
        const vn = vx * c.nx + vz * c.nz;
        if (vn < 0) {
          if (-vn > 5) v._hit = { nx: c.nx, nz: c.nz, sp: -vn };   // showroom.js: visible damage
          // remove only the push into the wall; keep sliding along it, nose follows the wall on glancing hits.
          // Two-wheelers never throw the rider: a hard hit just bounces the bike back a little and kills its speed.
          const hard = P.lean && -vn > 4;
          vx -= (hard ? 1.25 : 1.2) * vn * c.nx; vz -= (hard ? 1.25 : 1.2) * vn * c.nz;
          const keep = hard ? 0.35 : 1 - Math.min(0.35, -vn * 0.025); vx *= keep; vz *= keep;
          const sp = Math.hypot(vx, vz);
          if (sp > 3) {
            let want = Math.atan2(vx, vz); if (vx * f.x + vz * f.z < 0) want += Math.PI;
            let d = want - carRot; d = Math.atan2(Math.sin(d), Math.cos(d));
            if (Math.abs(d) < 0.9) carRot += d * Math.min(1, -vn * 0.08 + 0.15);
          }
          const f2 = fwdOf(carRot), l2 = { x: Math.cos(carRot), z: -Math.sin(carRot) };
          v.vF = vx * f2.x + vz * f2.z; v.vL = vx * l2.x + vz * l2.z; v.yawRate *= 0.6;
          if (-vn > 8) showComboPopup(P.lean ? 'CRASH!' : 'BUMP!');
        }
      }
    }
    unstickVehicle(v, dt, hitN);
    // towed trolley: tractrix behind the hitch. Reversing folds it unless steered; at the stop the drawbar locks up
    if (v.trailer) {
      const T = VehicleDynamics.trail(v, carPos.x, carPos.z, carRot);
      if (T.jack && v.vF < 0) { if (v.vF < -0.4) showComboPopup('JACK-KNIFED'); v.vF = Math.max(v.vF, -0.2); }
      const c = v.vF < 0 ? world.collide({ x: T.ax - Math.sin(carRot + T.rel) * 1.5, z: T.az - Math.cos(carRot + T.rel) * 1.5 }, 1.0) : null;
      if (c && c.hit) v.vF = 0;
    }
    carSpeed = v.vF * 3.6; v.lastSpeed = carSpeed;

    // visuals: wheels, brake lights, bike lean
    v.g.position.set(carPos.x, typeof groundY === 'function' ? groundY(carPos.x, carPos.z) : 0, carPos.z);
    v.g.rotation.y = carRot;
    // bikes lean the whole machine about the tyre contact line (both wheels stay down); cars roll on springs
    const Fe = feelOf(v);
    let lean = P.lean ? -VD.phi : 0;
    // auto rickshaw: three wheels and a high roof, it lifts a rear wheel in quick corners
    if (Fe.tippy) { const la = v.yawRate * v.vF; lean = Math.abs(la) > 4.5 ? -Math.sign(la) * Math.min(0.22, (Math.abs(la) - 4.5) * 0.05) : 0; }
    v.g.rotation.z = P.lean ? lean : v.g.rotation.z + (lean - v.g.rotation.z) * Math.min(1, dt * 6);
    suspend(v, dt, !!P.lean);
    spinWheels(v, dt);
    setTail(v, braking || v.vF < -0.1); syncSpot(v);
    isReversing = v.vF < -0.1;
    if (PT) { if (!inputState.gas && (inputState.brake || v.vF <= 0)) VehicleDynamics.ptStep(PT, Math.max(0, v.vF), 0, mu, CRR[surface], 0, dt); else if (v.vF < 0) PT.gear = 0; currentGear = PT.gear + 1; engineRPM = PT.rpm; window.engineRpmNorm = PT.rpm / PT.s.red; }
    else { currentGear = 1 + Math.floor(Math.min(0.99, Math.abs(v.vF) / (P.top / 3.6)) * P.gears);
    engineRPM = 800 + (Math.abs(v.vF) / (P.top / 3.6) * P.gears % 1) * 2600 + (inputState.gas ? 400 : 0); }
  }

  // ---------------------------------------------------------------- driving agent: footprint, wheels, unstick, bikes falling
  // real footprint: userData.dims (traffic-models.js) or the bounding box of the body without people, in the
  // vehicle's own frame. Sets v.len / v.hw and the probe offsets used by the wall collision.
  const _bb = new THREE.Box3(), _bb2 = new THREE.Box3();
  function isHumanPart(o) { for (let p = o; p; p = p.parent) if (p.userData && p.userData.human) return true; return false; }
  function initFootprint(v) {
    const ud = (v.userData && v.userData.dims) || (v.g.userData && v.g.userData.dims);
    const uc = (v.userData && v.userData.center) || (v.g.userData && v.g.userData.center), solo = v.g.userData && v.g.userData.solo;
    let len, w, cz = 0, cx = 0;
    // models are not all centred on their origin (tractor+trolley z -1.77, cart +0.8): box = position + rot * center
    if (solo) { len = solo.length; w = solo.width; cz = solo.cz; v._fpSrc = 'solo'; }      // tractor alone: the trolley is hinged
    else if (ud && ud.length && ud.width) { len = ud.length; w = ud.width; if (uc) { cz = uc.z || 0; cx = uc.x || 0; } v._fpSrc = 'userData'; }
    else {
      const ry = v.g.rotation.y, rz = v.g.rotation.z, px = v.g.position.x, py = v.g.position.y, pz = v.g.position.z;
      v.g.rotation.set(0, 0, 0); v.g.position.set(0, 0, 0); v.g.updateMatrixWorld(true);
      _bb.makeEmpty();
      v.g.traverse(o => { if (!o.isMesh || !o.geometry || isHumanPart(o) || o === body) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        _bb2.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); _bb.union(_bb2); });
      v.g.rotation.set(0, ry, rz); v.g.position.set(px, py, pz); v.g.updateMatrixWorld(true);
      if (_bb.isEmpty()) { len = v.len || 4; w = (v.hw || 0.85) * 2; }
      else { len = _bb.max.z - _bb.min.z; w = _bb.max.x - _bb.min.x; cz = (_bb.max.z + _bb.min.z) / 2; }
      v._fpSrc = 'bbox';
    }
    len = THREE.MathUtils.clamp(len, 1.2, 14); w = THREE.MathUtils.clamp(w, 0.5, 2.8);
    v.len = len; v.hw = w / 2;
    // circles of radius hw every <= hw along the long axis, end circles flush with the bumpers
    const half = Math.max(0, len / 2 - v.hw), n = Math.max(1, Math.ceil((2 * half) / v.hw) + 1), probes = [];
    for (let i = 0; i < n; i++) probes.push(cz + (n === 1 ? 0 : -half + 2 * half * i / (n - 1)));
    v._fp = { len, w, cz, cx, probes };
  }
  // wheels: [{obj, r, front, ry0}] from userData.wheels if traffic-models.js provides it, else measured
  function initWheels(v) {
    const src = (v.userData && v.userData.wheels) || (v.g.userData && v.g.userData.wheels);
    const piv = (v.userData && v.userData.steer) || v.steer;
    v._steerPiv = Array.isArray(piv) ? piv.filter(o => o && o.isObject3D) : [];
    const out = [];
    if (src && src.length) src.forEach(w => w && w.mesh && out.push({ obj: w.mesh, r: w.radius || 0.35, front: !!w.front }));
    else {
      const ws = v.wheels || [];
      const zs = ws.map(w => w.position.z), zMax = zs.length ? Math.max(...zs) : 0, zMid = zMax - 0.4;   // front axle only (not a trolley's)
      for (const w of ws) {
        _bb.setFromObject(w); const sz = _bb.getSize(new THREE.Vector3());
        const r = THREE.MathUtils.clamp(Math.max(sz.y, Math.min(sz.x, sz.z)) / 2, 0.15, 1.0);
        out.push({ obj: w, r, front: ws.length > 1 && w.position.z > zMid + 0.05 });
      }
    }
    // with steering pivots the pivot turns (wheel is its child); otherwise the front wheel itself yaws
    out.forEach(w => { w.ry0 = w.obj.rotation.y; if (!v._steerPiv.length) w.obj.rotation.order = 'YXZ'; });
    v._steerPiv.forEach(o => { o.userData._ry0 = o.userData._ry0 !== undefined ? o.userData._ry0 : o.rotation.y; });
    v._whSrc = src && src.length ? 'userData' : 'measured';
    v._wh = out;
  }
  function spinWheels(v, dt) {
    if (!v._wh) initWheels(v);
    const Fe = feelOf(v);
    const VD = v._vd, ang = VD ? VD.delta : 0;
    for (const w of v._wh) {
      w.obj.rotation.x += v.vF * dt / w.r;
      if (w.front && !v._steerPiv.length) w.obj.rotation.y = w.ry0 + (VD ? VehicleDynamics.wheelAngle(VD, w.obj.position.x) : ang);
    }
    for (const o of v._steerPiv) o.rotation.y = o.userData._ry0 + (VD ? VehicleDynamics.wheelAngle(VD, o.position.x) : ang);          // wheel pivots / raked fork + bars
  }
  // never stuck: pressing throttle/brake while pinned against something for 1.5 s pushes the vehicle out along
  // the contact normal; a centre that ends up inside a building footprint goes back to the last clear spot
  function unstickVehicle(v, dt, hitN) {
    const S = v._stk || (v._stk = { t: 0, x: carPos.x, z: carPos.z, rot: carRot });
    const pressing = inputState.gas || inputState.brake;
    if (hitN) S.n = hitN;
    if (hitN && pressing && Math.abs(v.vF) < 0.6) S.t += dt; else S.t = Math.max(0, S.t - dt * 0.5);
    if (S.t > 1.5 && S.n) {
      carPos.x += S.n.nx * 0.7; carPos.z += S.n.nz * 0.7; v.vF = 0; v.vL = 0; v.yawRate = 0; S.t = 0;
      const now = performance.now(); if (!(now - (S.pop || 0) < 5000)) showComboPopup('UNSTUCK'); S.pop = now;
    }
    // only a fresh entry is undone: a vehicle that starts inside a footprint (garage, safehouse) drives out freely
    const inB = !!(world.insideBuilding && world.insideBuilding(carPos.x, carPos.z, 0)) && !(window.WALKABLES && floorAt(carPos.x, carPos.z, 0) > -1e8);
    if (inB && S.wasIn === false) { carPos.x = S.x; carPos.z = S.z; v.vF *= -0.2; v.vL = 0; }
    else { S.wasIn = inB; if (!hitN && !inB) { S.x = carPos.x; S.z = carPos.z; } }
  }

  // ---- bikes fall over
  const downed = [];          // { v, ang, angV, target, riders: [{h, parent, pos, rot, t}], t, perm }
  function knockBike(v, dirx, dirz, perm, kmh) {
    if (!v || !v.g || v._down) return;
    const r = v.g.rotation.y, lx = Math.cos(r), lz = -Math.sin(r);
    const s = dirx * lx + dirz * lz || (Math.random() - 0.5);
    const target = -Math.sign(s) * 1.32;                 // lies on its side (handlebar keeps it off flat)
    const riders = [];
    v.g.children.filter(o => o.userData && o.userData.human && o !== body).forEach(h => {
      const wp = new THREE.Vector3(); h.getWorldPosition(wp);
      riders.push({ h, pos: h.position.clone(), rot: h.rotation.clone(), parent: v.g });
      v.g.remove(h); scene.add(h);
      const d = 1.2 + Math.random() * 0.8;
      h.position.set(wp.x + dirx * d, typeof groundY === 'function' ? groundY(wp.x, wp.z) : 0, wp.z + dirz * d);
      h.rotation.set(0, Math.atan2(dirx, dirz), 0); h.userData._fall = 0;
    });
    if (v.speed !== undefined && !perm) { v._spd = v.speed; v.speed = 0; v.cur = 0; }
    // shoved along the impact: ~1.2x the hitter's speed for a light bike, then ground friction (sliding on its side)
    const sv = Math.min(9, (kmh || 10) / 3.6 * 1.2), dl = Math.hypot(dirx, dirz) || 1;
    v._down = { ang: v.g.rotation.z, angV: 0, target, riders, t: 0, perm, vx: dirx / dl * sv, vz: dirz / dl * sv, yawV: (Math.random() - 0.5) * 2.5 };
    downed.push(v);
    showComboPopup(riders.length ? 'RIDER DOWN!' : 'BIKE KNOCKED OVER');
  }
  function updateDowned(dt) {
    for (let i = downed.length - 1; i >= 0; i--) {
      const v = downed[i], D = v._down;
      if (!D || v === active) { downed.splice(i, 1); continue; }
      D.t += dt;
      const up = !D.perm && D.t > 6;                       // traffic bikes get picked back up
      const tgt = up ? 0 : D.target;
      // gravity-like fall: accelerate towards the ground, small bounce when it lands
      if (!up) { D.angV += Math.sign(tgt - D.ang) * (3 + 9 * Math.abs(Math.sin(D.ang))) * dt; D.ang += D.angV * dt;
        if (Math.abs(D.ang) >= Math.abs(tgt)) { D.ang = tgt; D.angV = -D.angV * 0.25; if (Math.abs(D.angV) < 0.3) D.angV = 0; } }
      else D.ang += (0 - D.ang) * Math.min(1, dt * 2.5);
      v.g.rotation.z = D.ang;
      if (v.speed !== undefined && !D.perm) { v.speed = 0; v.cur = 0; }
      slideDowned(v, D, dt);
      for (const R of D.riders) {
        const h = R.h; h.userData._fall += dt;
        const ft = h.userData._fall;
        // thrown: lies flat for ~3.5 s, then sits up and stands
        const lie = ft < 3.5 ? Math.min(1, ft * 4) : Math.max(0, 1 - (ft - 3.5) * 1.5);
        h.rotation.x = -lie * Math.PI / 2 * 0.95;
        if (h.position) h.position.y = (typeof groundY === 'function' ? groundY(h.position.x, h.position.z) : 0) + lie * 0.15;
      }
      if (up && Math.abs(D.ang) < 0.02) {
        v.g.rotation.z = 0;
        for (const R of D.riders) { scene.remove(R.h); R.h.position.copy(R.pos); R.h.rotation.copy(R.rot); R.parent.add(R.h); }
        if (v._spd !== undefined) { v.speed = v._spd; delete v._spd; }
        delete v._down; downed.splice(i, 1);
      }
    }
  }
  // slide a knocked bike: friction (on its side ~0.7 g, still upright ~0.35 g), a little spin, stops at world colliders
  function slideDowned(v, D, dt) {
    const sp = Math.hypot(D.vx || 0, D.vz || 0);
    if (sp < 0.02) { D.vx = D.vz = 0; D.yawV = 0; return; }
    const mu = Math.abs(D.ang) > 0.8 ? 0.7 : 0.35, k = Math.max(0, sp - mu * 9.81 * dt) / sp;
    D.vx *= k; D.vz *= k; D.yawV *= Math.max(0, 1 - 3 * dt);
    const p = v.g.position, q = { x: p.x + D.vx * dt, z: p.z + D.vz * dt };
    if (world.collide) { const c = world.collide(q, 0.4); if (c && c.hit) { D.vx *= 0.3; D.vz *= 0.3; } }
    if (world.insideBuilding && world.insideBuilding(q.x, q.z, 0.2) && !world.insideBuilding(p.x, p.z, 0.2)) { q.x = p.x; q.z = p.z; D.vx *= -0.2; D.vz *= -0.2; }
    p.x = q.x; p.z = q.z; v.g.rotation.y += D.yawV * dt;
  }
  // parked.js instanced bike: let parked.js hand it over as a real model (its own F hook, as if on foot beside it)
  function claimParkedBike(it) {
    if (typeof GameHooks === 'undefined' || !window.GAME) return null;
    const hook = GameHooks.key.find(f => /claimNearest/.test(String(f)));
    if (!hook) return null;
    const n0 = traffic.length;
    const g = { playerMode: 'foot', carPos: { x: it.x, z: it.z }, traffic };
    try { hook({ code: 'KeyF', repeat: false }, g); } catch (e) { return null; }
    const t = traffic.length > n0 ? traffic[traffic.length - 1] : null;
    if (!t || !t.parked) return null;
    traffic.splice(traffic.indexOf(t), 1);              // taken: parked.js frees its collider in a microtask
    t.len = t.len2 ? t.len2 * 2 : 2; delete t.len2; t.wheels = t.wheels || []; t.tail = t.tail || [];
    parked.push(t);
    return t;
  }
  // the player's vehicle (Crysta or driven) sweeping through a bike above ~8 km/h knocks it over
  let recentKmh = 0;          // speed just before an impact (the collision itself kills carSpeed in the same step)
  function checkBikeHits(dt) {
    if (mode !== 'crysta' && mode !== 'vehicle') { recentKmh = 0; return; }
    recentKmh = Math.max(Math.abs(carSpeed), recentKmh - dt * 40);
    if (recentKmh < 5) return;
    const len = mode === 'crysta' ? CRYSTA_LEN : (active.len || 4), hw = mode === 'crysta' ? CRYSTA_HW : active.hw;
    const me = { g: { position: carPos, rotation: { y: carRot } }, len, hw };
    const f = fwdOf(carRot), sg = Math.sign(carSpeed) || 1;
    const hit = (x, z, r) => axisDist(x, z, me).d < hw + r;
    const dirTo = (x, z) => { const dx = x - carPos.x, dz = z - carPos.z, d = Math.hypot(dx, dz) || 1; return [(dx / d + f.x * sg) / 2, (dz / d + f.z * sg) / 2]; };
    // traffic bikes: index.html's updateTraffic pushes the player off at 1.7 + len2, so contact is that circle
    for (const t of traffic) if (t.model === 'bike' && t.g && !t._down && t !== active &&
      (hit(t.g.position.x, t.g.position.z, 0.6) || Math.hypot(t.g.position.x - carPos.x, t.g.position.z - carPos.z) < 1.85 + Math.min(t.len2 || 1, 2.5))) {
      const [dx, dz] = dirTo(t.g.position.x, t.g.position.z); knockBike(t, dx, dz, !!t.parked, recentKmh);
    }
    for (const t of parked) if (t.model === 'bike' && !t._down && t !== active && hit(t.g.position.x, t.g.position.z, (t.hw || 0.4) + 0.4)) {
      const [dx, dz] = dirTo(t.g.position.x, t.g.position.z); knockBike(t, dx, dz, true, recentKmh);
    }
    // already down (or a claimed parked car): driving into it shoves it along the bumper instead of stopping the vehicle
    const vF = carSpeed / 3.6;
    for (const t of parked) if (t.g && t !== active && (t._down || t.model !== 'bike')) {
      const a = axisDist(t.g.position.x, t.g.position.z, me), r = t._down ? 0.5 : (t.hw || 0.8);
      if (a.d >= hw + r) continue;
      const d = a.d || 0.01, nx = (t.g.position.x - a.cx) / d, nz = (t.g.position.z - a.cz) / d;
      if (t._down) {
        const D = t._down, push = hw + r - a.d;
        t.g.position.x += nx * push; t.g.position.z += nz * push;
        const want = Math.max(0, f.x * vF * nx + f.z * vF * nz) * 1.1 + 0.4, cur = D.vx * nx + D.vz * nz;
        if (cur < want) { D.vx += nx * (want - cur) + f.x * vF * 0.1; D.vz += nz * (want - cur) + f.z * vF * 0.1; }
      } else if (recentKmh > 8) {   // a car (~1 t) only gets nudged a few cm; pushOutParked still stops the hitter
        const k = Math.min(0.06, recentKmh * 0.002);
        t.g.position.x += nx * k; t.g.position.z += nz * k;
      }
    }
    const PV = window.Parked && Parked.vehicles;
    if (PV) for (const it of PV) {
      if (it.claimed || it.kind !== 'bike' || Math.abs(it.x - carPos.x) > 8 || Math.abs(it.z - carPos.z) > 8) continue;
      if (!hit(it.x, it.z, (it.hw || 0.4) + 0.9)) continue;     // its static collider stops us a little short
      const key = api.onKnock ? api.onKnock(it) : null;     // multiplayer: everyone sees this bike go down
      const t = claimParkedBike(it); if (t) { const [dx, dz] = dirTo(it.x, it.z); knockBike(t, dx, dz, true, recentKmh); if (key) key(dx, dz); }
      break;
    }
  }
  // ---------------------------------------------------------------- walking
  // floors you can stand on: feature modules (safehouse.js interiors, steps, plinths) push meshes into
  // window.WALKABLES; the walker steps up to STEP_UP and falls down to anything lower. Ground is groundY().
  const STEP_UP = 0.25, rayDown = new THREE.Raycaster(), DOWN = new THREE.Vector3(0, -1, 0), rayO = new THREE.Vector3();
  function floorAt(x, z, y) {
    const W = window.WALKABLES; if (!W || !W.length) return -1e9;
    const near = W.filter(m => m && m.parent && (!m.userData.bx || Math.abs(m.userData.bx - x) + Math.abs(m.userData.bz - z) < 60));
    if (!near.length) return -1e9;
    rayO.set(x, y + STEP_UP + 0.05, z); rayDown.set(rayO, DOWN); rayDown.far = y + STEP_UP + 0.6;
    const h = rayDown.intersectObjects(near, true)[0];
    return h ? h.point.y : -1e9;
  }
  function groundAt(x, z) { return typeof groundY === 'function' ? groundY(x, z) : 0; }
  // Jumping onto low things. The world's colliders are 2-D (no height), so only geometry in WALKABLES (steps, plinths,
  // the safe-house walls / furniture / low walls) has a height we can test. Every world collider (buildings, compound
  // walls >= 1.25 m, gates, trees, poles) stays solid at any jump height: the jump peaks at ~1.08 m.
  // The walker's centre may cross a collider only when (1) nothing walkable is at foot height in the way, and (2) it is
  // above a walkable top that is higher than the ground (crossing / standing on / stepping off the low thing).
  // Each walkable mesh gets a 10 cm grid (in its own frame) of the vertical extents [y0, y1] of the triangles over
  // every cell (bbox-conservative), built once: "is anything solid between knee and head here" is then exact for
  // thin rods, rails and wall tops, with no per-frame ray casts.
  const HM = 0.1, _hv = new THREE.Vector3(), _hinv = new THREE.Matrix4();
  function walkablesNear(x, z) {
    const W = window.WALKABLES; if (!W || !W.length) return null;
    const near = W.filter(m => m && m.parent && (!m.userData.bx || Math.abs(m.userData.bx - x) + Math.abs(m.userData.bz - z) < 60));
    return near.length ? near : null;
  }
  function heightGrid(m) {
    if (m.userData._hm) return m.userData._hm;
    const cells = new Map(), K = (i, j) => (i + 32768) * 65536 + (j + 32768);
    const add = (mesh) => {
      const g = mesh.geometry; if (!g || !g.attributes || !g.attributes.position) return;
      // into m's frame (child meshes of a group are folded in)
      mesh.updateMatrixWorld(true); _hinv.copy(m.matrixWorld).invert().multiply(mesh.matrixWorld);
      const P = g.attributes.position, I = g.index, n = I ? I.count : P.count, v = new THREE.Vector3();
      for (let t = 0; t + 2 < n; t += 3) {
        let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
        for (let k = 0; k < 3; k++) {
          const j = I ? I.getX(t + k) : t + k; v.fromBufferAttribute(P, j).applyMatrix4(_hinv);
          if (v.x < x0) x0 = v.x; if (v.x > x1) x1 = v.x; if (v.y < y0) y0 = v.y; if (v.y > y1) y1 = v.y; if (v.z < z0) z0 = v.z; if (v.z > z1) z1 = v.z;
        }
        const i0 = Math.floor(x0 / HM), i1 = Math.floor(x1 / HM), j0 = Math.floor(z0 / HM), j1 = Math.floor(z1 / HM);
        if ((i1 - i0 + 1) * (j1 - j0 + 1) > 4000) continue;         // big floor / roof sheets: not obstacles
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = K(i, j); let c = cells.get(k); if (!c) cells.set(k, c = []); c.push(y0, y1); }
      }
    };
    m.traverse(o => { if (o.isMesh && !o.isInstancedMesh) add(o); });
    return (m.userData._hm = { cells, K });
  }
  // anything solid in the walker's body (disc of radius r) between heights yLo..yHi at x, z?
  function solidIn(near, x, z, yLo, yHi, r) {
    for (const m of near) {
      const H = heightGrid(m); m.updateMatrixWorld();
      _hinv.copy(m.matrixWorld).invert(); _hv.set(x, 0, z).applyMatrix4(_hinv);
      const lo = yLo + _hv.y, hi = yHi + _hv.y, R = Math.ceil(r / HM);
      const ci = Math.floor(_hv.x / HM), cj = Math.floor(_hv.z / HM);
      for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
        if ((i * i + j * j) * HM * HM > r * r) continue;
        const c = H.cells.get(H.K(ci + i, cj + j)); if (!c) continue;
        for (let k = 0; k < c.length; k += 2) if (c[k] < hi && c[k + 1] > lo) return true;
      }
    }
    return false;
  }
  function topBelow(near, x, z) {
    rayO.set(x, ped.y + 0.03, z); rayDown.set(rayO, DOWN); rayDown.far = ped.y + 3;
    const h = rayDown.intersectObjects(near, true)[0];
    return h ? h.point.y : -1e9;
  }
  function overObstacle(x0, z0, x, z) {
    const g = groundAt(x, z);
    if (ped.y < g + 0.12) return false;
    const near = walkablesNear(x, z); if (!near) return false;
    // the body at the new spot (feet + 3 cm .. head) must be clear of everything walkable (walls, rails, rods)
    if (solidIn(near, x, z, ped.y + 0.03, ped.y + 1.7, WALK_R * 0.9)) return false;
    // and it must be over a low walkable thing (crossing / standing on / stepping off it), never a bare world collider
    return topBelow(near, x, z) > g + 0.1 || topBelow(near, x0, z0) > groundAt(x0, z0) + 0.1;
  }

  // safety net: standing in a building footprint (bad exit, teleport, reload, glitch) -> out through the nearest
  // wall; otherwise remember the spot as the last good one
  const lastSafe = { x: 0, z: 0 };
  function unstick(p) {
    if (!world.insideBuilding) return false;
    let moved = false;
    for (let k = 0; k < 4; k++) {
      const b = world.insideBuilding(p.x, p.z, 0); if (!b || !b.p) break;
      // a walkable interior (safehouse) is meant to be walked in
      if (ped.y > groundAt(p.x, p.z) + 0.08 || floorAt(p.x, p.z, ped.y) > -1e8) break;
      let best = null;
      for (let i = 0; i < b.p.length; i++) {
        const A = b.p[i], B = b.p[(i + 1) % b.p.length], dx = B[0] - A[0], dz = B[1] - A[1], L2 = dx * dx + dz * dz || 1e-6;
        const t = Math.max(0, Math.min(1, ((p.x - A[0]) * dx + (p.z - A[1]) * dz) / L2));
        const ex = A[0] + dx * t, ez = A[1] + dz * t, d = Math.hypot(p.x - ex, p.z - ez);
        if (!best || d < best.d) { const L = Math.sqrt(L2); best = { d, ex, ez, nx: dz / L, nz: -dx / L }; }
      }
      // outward = away from the inside point; fall back to the edge normal pointing away from the centroid
      let ox = best.ex - p.x, oz = best.ez - p.z, ol = Math.hypot(ox, oz);
      if (ol < 1e-3) { let cx = 0, cz = 0; b.p.forEach(q => { cx += q[0]; cz += q[1]; }); cx /= b.p.length; cz /= b.p.length;
        ox = best.nx; oz = best.nz; if ((best.ex - cx) * ox + (best.ez - cz) * oz < 0) { ox = -ox; oz = -oz; } ol = 1; }
      p.x = best.ex + ox / ol * (WALK_R + 0.15); p.z = best.ez + oz / ol * (WALK_R + 0.15);
      world.collide(p, WALK_R); moved = true;
    }
    if (moved && (lastSafe.x || lastSafe.z) && world.insideBuilding(p.x, p.z, 0) && !(floorAt(p.x, p.z, ped.y) > -1e8)) { p.x = lastSafe.x; p.z = lastSafe.z; }
    return moved;
  }

  // jump: edge-triggered (holding Space doesn't bunny-hop), a short jump buffer and coyote time like GTA
  // ~1.08 m peak (enough for steps, plinths, beds, walls under ~1 m), 0.8 s in the air, 0.09 s crouch before take-off
  const JUMP_V = 5.4, GRAV = 13.5, COYOTE = 0.1, BUFFER = 0.15, CROUCH = 0.09;
  // latch the key press itself, so a tap shorter than a frame still jumps (inputState only shows held keys)
  addEventListener('keydown', e => {
    if (e.code !== 'Space' || e.repeat || mode !== 'foot') return;
    const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    ped.buffer = BUFFER; ped.jumpHeld = true;
  });
  // split a traffic-model vehicle into wheels + sprung body (once), then run the shared suspension
  function suspend(v, dt, bike) {
    if (typeof VehicleSuspension === 'undefined' || typeof groundY !== 'function') return;
    if (!v.susp) {
      // a steered wheel hangs from a pivot (steer_N): it is the pivot that must stay unsprung, or the front axle rides
      // inside the body, is never sampled, and the car can't pitch
      const ws = []; for (const w of v.wheels || []) { let q = w; while (q && q.parent && q.parent !== v.g) q = q.parent; if (q && q.parent === v.g && !ws.includes(q)) ws.push(q); }
      const sb = new THREE.Group(); sb.name = 'sprung';
      [...v.g.children].forEach(ch => { if (!ws.includes(ch) && ch !== v.trailer) sb.add(ch); });
      v.g.add(sb);
      v.susp = { body: sb, st: {}, lastV: v.vF || 0, acc: 0, wheels: ws.map(w => ({ obj: w, x: w.position.x, z: w.position.z, baseY: w.position.y })) };
    }
    const S = v.susp, a = ((v.vF || 0) - S.lastV) / Math.max(dt, 1e-4); S.lastV = v.vF || 0;
    S.acc += (THREE.MathUtils.clamp(a, -12, 12) - S.acc) * Math.min(1, dt * 10);
    if (!S.wheels.length) return;
    const Fe = feelOf(v);
    VehicleSuspension.step(S.st, v.g, S.body, S.wheels, { dt, speed: v.vF || 0, longAcc: S.acc, latAcc: (v.yawRate || 0) * (v.vF || 0),
      ground: groundY, rough: VehicleSuspension.roughAt, bike, pitchK: Fe.pitchK, rollK: Fe.rollK, w: Fe.w, zeta: Fe.zeta, travel: Fe.travel });
  }
  // ---------------------------------------------------------------- doors, hood, boot, sunroof, top of the driven vehicle
  // Parts are traffic-models.js plain data ({ mesh, axis, open } etc.) moved by TrafficModels.setPart(part, t). A car whose
  // model has none (or a clone that lost them) gets plain hinged panels of the same form, sized from its box, hidden until opened.
  const NO_PANELS = { auto: 1, tractor: 1, bullockCart: 1, cart: 1 }, moving = new Set(), usable = q => (q && q.mesh ? q : null);
  function panel(par, paint, px, py, pz, w, h, d, oz, axis, open) {
    const pv = new THREE.Group(); pv.position.set(px, py, pz);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshPhongMaterial({ color: paint, shininess: 85 })); m.position.z = oz; m.castShadow = true; m.userData.noLOD = true;
    pv.add(m); pv.visible = false; par.add(pv); return { mesh: pv, axis, open, gen: true };
  }
  function bodyColour(v) {                                   // the commonest paint material, as colourName() reads it
    const cnt = new Map(); v.g.traverse(o => { const m = o.isMesh && o.material; if (m && m.isMeshPhongMaterial && !m.transparent && m.shininess === 85) cnt.set(m, (cnt.get(m) || 0) + 1); });
    let best = null, n = 0; cnt.forEach((k, m) => { if (k > n) { n = k; best = m; } });
    return best ? best.color.getHex() : window.Cockpit ? Cockpit.paintOf(v) : 0x888888;
  }
  function partsOf(v) {
    if (v._prt) return v._prt;
    const ud = v.userData || {}, P = v.g._parts || {}, pick = k => usable(ud[k]) || usable(P[k]) || usable(v.g.userData && v.g.userData[k]);
    const R = v._prt = { doors: {}, hood: pick('hood'), boot: pick('boot'), sunroof: pick('sunroof'), top: pick('top') };
    // FL/FR are the front doors on the -x / +x side (keys 1/2, the Crysta's convention); the rear pair follows
    const D = ((ud.doors && ud.doors.length ? ud.doors : P.doors) || []).filter(usable);
    [[-1, 'FL', 'RL'], [1, 'FR', 'RR']].forEach(([sd, f, r]) => {
      const on = D.filter(q => (q.side || Math.sign(q.mesh.position.x)) === sd).sort((a, b) => b.mesh.position.z - a.mesh.position.z);
      if (on[0]) R.doors[f] = on[0]; if (on[1]) R.doors[r] = on[1];
    });
    if (v.p.lean || NO_PANELS[v.model]) return R;
    const B = boxOf(v), par = (v.susp && v.susp.body) || v.g, paint = bodyColour(v), e = seatEye(v), hw = Math.min(B.max.x, -B.min.x) * 0.9, y0 = B.max.y * 0.27, h = B.max.y * 0.42, big = v.model === 'lorry' || v.model === 'bus', ids = ['FL', 'FR', 'RL', 'RR'];
    if (!D.length) (big ? ids.slice(0, 2) : ids).forEach((id, i) => {
      const sd = i % 2 ? 1 : -1; R.doors[id] = panel(par, paint, sd * hw, y0 + h / 2, e.z + 0.55 - (i > 1 ? 1 : 0), 0.05, h, 0.95, -0.475, 'y', sd < 0 ? 0.95 : -0.95);
    });
    if (!R.hood && !big) { const L = Math.max(0.5, B.max.z * 0.5); R.hood = panel(par, paint, 0, B.max.y * 0.6, B.max.z - L, hw * 1.8, 0.04, L, L / 2, 'x', -0.85); }
    if (!R.boot && !big) R.boot = panel(par, paint, 0, B.max.y * 0.8, B.min.z + 0.5, hw * 1.7, 0.04, 0.6, -0.3, 'x', 1.1);
    return R;
  }
  function vehiclePart(kind, id) {
    if (mode !== 'vehicle' || !active) return false;
    const R = partsOf(active), q = kind === 'door' ? R.doors[id] : R[kind];
    if (!q) { showComboPopup(active.p.lean ? 'NOT ON A TWO-WHEELER' : 'NOT ON THIS VEHICLE'); return true; }
    q._to = q._to ? 0 : 1; q._t = q._t || 0; if (q.gen) q.mesh.visible = true; moving.add(q);
    if (!partsOf._hook && window.GameHooks) { partsOf._hook = true; GameHooks.update.push(animParts); }
    if (typeof playMechanicalClick === 'function') playMechanicalClick();
    return true;
  }
  function animParts(dt) {
    const k = Math.min(1, dt * 7);
    moving.forEach(q => {
      q._t += (q._to - q._t) * k; if (Math.abs(q._to - q._t) < 0.004) { q._t = q._to; moving.delete(q); if (q.gen && !q._to) q.mesh.visible = false; }
      TrafficModels.setPart(q, q._t);
    });
  }
  function walk(dt) {
    surface = world.surfaceAt(carPos.x, carPos.z);
    const held = !!(ped.act && ped.act.lock);       // eating, picking up, sleeping: stands still until it's done
    const turn = held ? 0 : (typeof padIn !== 'undefined' && Math.abs(padIn.steer) > 0.12) ? padIn.steer : (inputState.left ? 1 : 0) - (inputState.right ? 1 : 0);
    const move = held ? 0 : (inputState.gas ? 1 : 0) - (inputState.brake ? 1 : 0);
    let want, f;
    if (rigView()) {
      // PUBG: W/A/S/D relative to the camera; the body turns smoothly to face where it's going
      // ix = LEFT component (A = +1): the camera's left is yaw + 90 deg (its right is (-cos, sin) = yaw - 90 deg),
      // so the world heading is yaw + atan2(left, forward). (Was -turn: A/D were mirrored.)
      const ix = turn, iz = move, m = Math.min(1, Math.hypot(ix, iz));
      // velocity is a vector that accelerates toward the wanted one (smooth starts, stops and direction changes);
      // a wall slide (ped.speed cut below) or an exit/teleport (speed reset) scales it down
      if (ped.vx === undefined || !isFinite(ped.vx)) { ped.vx = 0; ped.vz = 0; ped.yawRate = 0; }
      const vm = Math.hypot(ped.vx, ped.vz);
      if (vm > 1e-4 && Math.abs(ped.speed) < vm - 1e-3) { const k = Math.abs(ped.speed) / vm; ped.vx *= k; ped.vz *= k; }
      // body yaw: an angular-velocity spring toward the move direction (no snapping); slower at a sprint
      let dd = 0;
      if (m > 0.01) {
        ped.dir = wrap(moveYaw() + Math.atan2(ix, iz));
        // shortest arc; an exact 180 deg reversal picks one side and keeps it (no flip-flop at +-pi)
        dd = wrap(ped.dir - carRot);
        if (Math.abs(dd) > Math.PI - 0.05) dd = (ped.turnSide || 1) * Math.abs(dd); else ped.turnSide = Math.sign(dd) || 1;
        const maxRate = vm > 4.5 ? 6.5 : 10, wantRate = THREE.MathUtils.clamp(dd * 11, -maxRate, maxRate);
        ped.yawRate += (wantRate - ped.yawRate) * (1 - Math.exp(-dt * 16));
      } else ped.yawRate *= Math.exp(-dt * 14);
      carRot = wrap(carRot + ped.yawRate * dt);
      ped.dd = dd;
      // walk (gentle stick) / jog (default) / sprint (run key); a sharp reversal pivots first, then sets off
      const facing = m > 0.01 ? Math.cos(wrap(ped.dir - carRot)) : 1;
      const tSpeed = m > 0.01 ? (inputState.nos ? 5.8 : m < 0.55 ? 1.5 : 3.0) * Math.min(1, m / 0.55 * 0.5 + 0.5) : 0;
      want = tSpeed * (0.3 + 0.7 * THREE.MathUtils.clamp((facing + 0.4) / 1.2, 0, 1)) * (ped.land > 0 ? 0.5 : 1);
      const md = m > 0.01 ? ped.dir : carRot, tvx = Math.sin(md) * want, tvz = Math.cos(md) * want;
      const rate = ped.air ? 1.5 : want > vm ? (inputState.nos ? 5 : 7) : 9;   // accelerate a little slower than you stop
      const ka = 1 - Math.exp(-dt * rate);
      ped.vx += (tvx - ped.vx) * ka; ped.vz += (tvz - ped.vz) * ka;
      const nv = Math.hypot(ped.vx, ped.vz);
      ped.acc = (nv - vm) / Math.max(dt, 1e-4);
      ped.speed = nv; ped.velMode = true;
      f = nv > 1e-4 ? { x: ped.vx / nv, z: ped.vz / nv } : fwdOf(carRot);
    } else {
      // first person / low / top-down: tank controls
      ped.turn = (ped.turn || 0) + (turn - (ped.turn || 0)) * (1 - Math.exp(-dt * 12));
      carRot += ped.turn * 2.6 * dt; ped.dir = carRot;
      want = move * (inputState.nos ? 5.6 : 2.2) * (move < 0 ? 0.6 : 1) * (ped.land > 0 ? 0.5 : 1);
      f = fwdOf(carRot); ped.velMode = false; ped.vx = undefined; ped.dd = 0; ped.yawRate = 0; ped.acc = 0;
    }
    if (!ped.velMode) ped.speed += (want - ped.speed) * (1 - Math.exp(-dt * (ped.air ? 3 : want ? 10 : 12)));   // little air control
    // move in slices no longer than half the walker radius: a thin compound wall can never be skipped
    const sx = f.x * ped.speed * dt, sz = f.z * ped.speed * dt, n = Math.max(1, Math.ceil(Math.hypot(sx, sz) / (WALK_R * 0.5)));
    const p = { x: carPos.x, z: carPos.z };
    for (let i = 0; i < n; i++) {
      const ox = p.x, oz = p.z; p.x += sx / n; p.z += sz / n; const tx = p.x, tz = p.z;
      const c = world.collide(p, WALK_R);
      // in the air above a low wall / step (or standing on it): the 2-D collider doesn't apply
      if (c.hit && ped.y > 0.1 && overObstacle(ox, oz, tx, tz)) { p.x = tx; p.z = tz; }
      pushOutParked(p, WALK_R);
      // people (visitors.js Crowd: grandma, visitors, friends, villagers, procession walkers): the walker can't pass
      // through anyone; movable NPCs are nudged aside a little, then re-checked against walls on their side
      if (window.Crowd && Crowd.pushPlayer) { try { Crowd.pushPlayer(p, WALK_R, dt / n); world.collide(p, WALK_R); } catch (e) {} }
    }
    unstick(p);
    if (!world.insideBuilding || !world.insideBuilding(p.x, p.z, 0)) { lastSafe.x = p.x; lastSafe.z = p.z; }
    // against a wall: keep only the actual movement so the walk cycle and camera don't jitter
    const moved = Math.hypot(p.x - carPos.x, p.z - carPos.z) / Math.max(dt, 1e-4);
    if (moved < Math.abs(ped.speed) * 0.5) ped.speed *= 0.8;
    carPos.x = p.x; carPos.z = p.z;

    // vertical: ground (road / bund height) or the highest walkable under the feet
    const floor = Math.max(groundAt(carPos.x, carPos.z), floorAt(carPos.x, carPos.z, ped.y));
    if (!ped.air && ped.y < floor && floor - ped.y <= STEP_UP + 0.02) ped.y = floor;          // step up onto plinths / stairs
    const grounded = !ped.air && ped.y <= floor + 0.03;
    ped.coyote = grounded ? COYOTE : (ped.coyote || 0) - dt;
    const jumpKey = !!inputState.drift;
    ped.buffer = jumpKey && !ped.jumpHeld ? BUFFER : (ped.buffer || 0) - dt;
    ped.jumpHeld = jumpKey;
    // take-off: a short crouch (anticipation) on the ground, then the impulse; walking off an edge and pressing
    // jump inside the coyote window jumps at once. No jumping again in the air, nor during a hard landing.
    if (ped.crouch > 0) {
      ped.crouch -= dt; ped.buffer = 0;
      if (ped.crouch <= 0) { ped.crouch = 0; if (grounded || ped.coyote > 0) { ped.vy = JUMP_V; ped.air = true; ped.coyote = 0; } }
    } else if (ped.buffer > 0 && ped.coyote > 0 && !(ped.land > 0.08)) {
      ped.buffer = 0;
      if (grounded) ped.crouch = CROUCH; else { ped.vy = JUMP_V; ped.air = true; ped.coyote = 0; }
    }
    if (grounded && !ped.air) { ped.y = floor; ped.vy = 0; }
    else {
      ped.vy -= GRAV * dt; ped.y += ped.vy * dt; ped.air = true;
      if (ped.y <= floor && ped.vy <= 0) {                                   // land (on the ground, a step, a roof)
        if (ped.vy < -2) ped.land = Math.min(0.55, 0.06 + -ped.vy * 0.035);
        if (ped.vy < -9) { ped.speed *= 0.3; if (ped.vx !== undefined) { ped.vx *= 0.3; ped.vz *= 0.3; } }   // big drop: stumble
        ped.y = floor; ped.vy = 0; ped.air = false;
      } else if (ped.y < floor) ped.y = floor;                               // brushing a step edge on the way up
    }
    if (ped.land > 0) ped.land -= dt;
    carPos.y = ped.y;
    carSpeed = ped.speed * 3.6;
    // walk cycle, then the jump / landing pose on top
    ped.phase += Math.abs(ped.speed) * dt * 3.2;
    if (ped.air) jumpPose(ped.vy);
    else if (Math.abs(ped.speed) > 0.05) HumanModel.animateWalk(hp, ped.phase, ped.speed);
    else {
      // turning in place: shuffle the feet round with the body (rate from the heading change)
      const tr = wrap(carRot - (ped.lastRot === undefined ? carRot : ped.lastRot)) / Math.max(dt, 1e-4);
      if (Math.abs(tr) > 0.6 && HumanModel.animateTurn) HumanModel.animateTurn(hp, performance.now() / 1000, tr);
      else HumanModel.animateIdle(hp, performance.now() / 1000);
    }
    ped.lastRot = carRot;
    if (!ped.air && ped.land > 0) landPose(ped.land);
    else if (!ped.air && ped.crouch > 0) landPose(0.15 * 0.85 * (1 - ped.crouch / CROUCH));
    // posture on top of the gait: roll into turns (centripetal), pitch with acceleration / speed, and the head then
    // torso turn toward the move direction before the hips get there
    {
      const sp = Math.abs(ped.speed), cen = (ped.yawRate || 0) * sp;
      const rollT = ped.air ? 0 : THREE.MathUtils.clamp(-cen * 0.035, -0.22, 0.22);
      const pitchT = ped.air ? 0 : THREE.MathUtils.clamp((ped.acc || 0) * 0.02 + sp * 0.012, -0.08, 0.16);
      const kk = 1 - Math.exp(-dt * 8);
      ped.roll = (ped.roll || 0) + (rollT - (ped.roll || 0)) * kk; ped.pitch = (ped.pitch || 0) + (pitchT - (ped.pitch || 0)) * kk;
      const look = THREE.MathUtils.clamp(ped.dd || 0, -1, 1);
      ped.look = (ped.look || 0) + (look - (ped.look || 0)) * (1 - Math.exp(-dt * 12));
      if (hp.head) hp.head.rotation.y += ped.look * 0.55;
      if (hp.torso) hp.torso.rotation.y += ped.look * 0.25;
    }
    if (ped.act) actPose(dt);
    body.position.set(carPos.x, ped.y + (ped.air ? 0 : Math.abs(Math.sin(ped.phase)) * 0.04 * Math.min(1, Math.abs(ped.speed))), carPos.z);
    body.rotation.order = 'YXZ'; body.rotation.set(ped.pitch || 0, carRot, ped.roll || 0);
    engineRPM = 800; currentGear = '-'; isReversing = false;
  }
  // upper-body actions over the gait (actions.js, phone.js): Player.act(kind, { dur, lock, onEnd }), Player.act(null) ends
  // phone: hand at the ear (call) · text: phone held in front · carry: both arms under a load · eat: hand to mouth, repeated
  // pickup / putdown: bend down and back up · sleep: lying flat
  const ACT_KINDS = ['phone', 'text', 'carry', 'eat', 'pickup', 'putdown', 'sleep'];
  function act(kind, o) {
    o = o || {};
    if (!kind) { const a = ped.act; ped.act = null; if (hp.torso) hp.torso.rotation.x = 0; if (a && a.onEnd) a.onEnd(); return true; }
    if (mode !== 'foot' || !ACT_KINDS.includes(kind)) return false;
    ped.act = { kind, t: 0, dur: o.dur || 0, lock: !!o.lock, onEnd: o.onEnd || null };
    return true;
  }
  function actPose(dt) {
    const a = ped.act, P = hp; a.t += dt;
    if (a.dur && a.t >= a.dur) { act(null); return; }
    const k = Math.min(1, a.t * 6) * (a.dur ? Math.min(1, (a.dur - a.t) * 6) : 1), t = a.t;
    if (a.kind === 'phone') { P.armR.rotation.set(-0.75 * k, 0, -0.5 * k); P.foreR.rotation.x = -2.35 * k; P.head.rotation.z += -0.12 * k; }
    else if (a.kind === 'text') { P.armR.rotation.set(-0.45 * k, 0, 0.12 * k); P.foreR.rotation.x = -1.35 * k; P.head.rotation.x += 0.28 * k; }
    else if (a.kind === 'carry') { P.armL.rotation.set(-1.05 * k, 0, 0.1 * k); P.armR.rotation.set(-1.05 * k, 0, -0.1 * k); P.foreL.rotation.x = P.foreR.rotation.x = -0.75 * k; }
    else if (a.kind === 'eat') { P.armR.rotation.set(-0.7 * k, 0, 0.18 * k); P.foreR.rotation.x = (-1.85 - 0.45 * Math.sin(t * 6)) * k; P.head.rotation.x += 0.05 * Math.sin(t * 6) * k; }
    else if (a.kind === 'pickup' || a.kind === 'putdown') { const b = Math.sin(Math.PI * Math.min(1, t / a.dur)); P.torso.rotation.x = 1.05 * b; P.armL.rotation.set(-1.2 * b, 0, 0); P.armR.rotation.set(-1.2 * b, 0, 0); }
    else if (a.kind === 'sleep') { P.armL.rotation.set(0, 0, 0.1); P.armR.rotation.set(0, 0, -0.1); ped.pitch = -1.5; ped.air = false; }
  }
  // airborne: knees tucked on the way up, legs reaching for the ground on the way down, arms out for balance
  function jumpPose(vy) {
    const up = THREE.MathUtils.clamp(vy / JUMP_V, -1, 1), tuck = 0.5 + up * 0.35;
    hp.hips.position.set(0, 0.92, 0); hp.hips.rotation.set(0, 0, 0);
    hp.legL.rotation.set(-0.35 - tuck * 0.5, 0, 0.05); hp.legR.rotation.set(-0.1 - tuck * 0.2, 0, -0.05);
    hp.shinL.rotation.x = 0.5 + tuck * 0.9; hp.shinR.rotation.x = 0.3 + tuck * 0.6;
    hp.armL.rotation.set(-0.5 - up * 0.4, 0, 0.45); hp.armR.rotation.set(-0.3 - up * 0.3, 0, -0.45);
    hp.foreL.rotation.x = -0.6; hp.foreR.rotation.x = -0.6;
    hp.torso.rotation.set(0.12 - up * 0.08, 0, 0); hp.head.rotation.set(-0.08, 0, 0);
  }
  // landing: a short knee bend that springs back
  function landPose(t) {
    const k = Math.min(1, t / 0.15);
    hp.hips.position.y = 0.92 - 0.14 * k;
    hp.legL.rotation.x = -0.55 * k; hp.legR.rotation.x = -0.55 * k;
    hp.shinL.rotation.x = 1.0 * k; hp.shinR.rotation.x = 1.0 * k;
    hp.torso.rotation.x = 0.3 * k; hp.armL.rotation.x = -0.3 * k; hp.armR.rotation.x = -0.3 * k;
  }

  // ---------------------------------------------------------------- cameras for walking and non-Crysta vehicles
  // cameraIndex (V / gamepad Y) is shared with the Crysta: 0 chase, 1 close chase, 2 cockpit, 3 hood, 4 top-down.
  // On foot: 0 shoulder, 1 far, 2 first person, 3 low close, 4 top-down.
  let camSnap = false, lastCamIdx = -1;
  const camT = new THREE.Vector3(), look = new THREE.Vector3();
  function seatEye(v) {
    const s = body.userData.pose && (body.parent === v.g || (v.susp && body.parent === v.susp.body)) ? [body.position.x, body.position.y + human.hipHeight, body.position.z] : (SEATS[v.model] || SEATS.hatch);
    return { x: s[0], y: s[1] + (s[3] === 'bike' ? 0.72 : 0.68), z: s[2] };
  }
  // local bounding box of a vehicle (without the player's body), cached
  const _bx = new THREE.Box3();
  function boxOf(v) {
    if (v._box) return v._box;
    const g = v.g, pos = g.position.clone(), rot = g.rotation.clone(), vis = body.visible;
    let par = null; for (let q = body.parent; q; q = q.parent) if (q === g) { par = body.parent; break; }   // may sit in the sprung group
    if (par) par.remove(body);
    g.position.set(0, 0, 0); g.rotation.set(0, 0, 0); g.updateMatrixWorld(true);
    _bx.setFromObject(g); v._box = _bx.clone();
    g.position.copy(pos); g.rotation.copy(rot); g.updateMatrixWorld(true);
    if (par) par.add(body); body.visible = vis;
    if (!isFinite(v._box.max.z)) v._box = new THREE.Box3(new THREE.Vector3(-1, 0, -2), new THREE.Vector3(1, 1.5, 2));
    return v._box;
  }
  function updateCam(dt) {
    if (rigView() && (mode === 'foot' || active)) { lastCamIdx = (typeof cameraIndex === 'number' ? cameraIndex : 0) % 5; rig(dt, lastCamIdx === 1); return; }
    const f = fwdOf(carRot), r = { x: Math.cos(carRot), z: -Math.sin(carRot) };   // r = model local +x
    const idx = typeof cameraIndex === 'number' ? cameraIndex % 5 : 0;
    if (idx !== lastCamIdx) { lastCamIdx = idx; camSnap = true; }
    let firstPerson = false, smooth = mode === 'foot' ? 8 : 7;
    if (mode === 'foot') {
      const y = ped.y;
      if (idx === 1) { camT.set(carPos.x - f.x * 6.5, y + 3.2, carPos.z - f.z * 6.5); look.set(carPos.x + f.x * 2, y + 1.3, carPos.z + f.z * 2); }
      else if (idx === 2) { firstPerson = true; camT.set(carPos.x + f.x * 0.15, y + 1.58, carPos.z + f.z * 0.15); look.set(carPos.x + f.x * 10, y + 1.45, carPos.z + f.z * 10); smooth = 30; }
      else if (idx === 3) { camT.set(carPos.x - f.x * 2.0 - f.z * 0.4, y + 0.9, carPos.z - f.z * 2.0 + f.x * 0.4); look.set(carPos.x + f.x * 3, y + 1.5, carPos.z + f.z * 3); }
      else if (idx === 4) { camT.set(carPos.x, y + 32, carPos.z - 6); look.set(carPos.x, y, carPos.z); }
      else { camT.set(carPos.x - f.x * 3.4 - f.z * 0.5, y + 2.0, carPos.z - f.z * 3.4 + f.x * 0.5); look.set(carPos.x + f.x * 2, y + 1.4, carPos.z + f.z * 2); }
    } else {
      const L = active.len || 4, gy = active.g.position.y;
      if (idx === 1) {
        const d = 2.2 + L * 0.6, h = 1.2 + L * 0.2;
        camT.set(carPos.x - f.x * d, gy + h, carPos.z - f.z * d); look.set(carPos.x, gy + 1.0 + L * 0.07, carPos.z);
      } else if (idx === 2) {
        // the driver gets the full cockpit (cockpit.js); passengers look out of their own seat
        if (mode === 'vehicle' && window.Cockpit && Cockpit.camera(dt)) { body.visible = false; return; }
        const e = seatEye(active); firstPerson = true; smooth = 40;
        camT.set(carPos.x + r.x * e.x + f.x * (e.z + 0.12), gy + e.y, carPos.z + r.z * e.x + f.z * (e.z + 0.12));
        look.set(camT.x + f.x * 30, camT.y - 1.2, camT.z + f.z * 30);
      } else if (idx === 3) {
        // bike: over the handlebars at rider eye level; everything else: on the bonnet / front, scaled to its height
        const bx = boxOf(active), e = seatEye(active);
        const front = active.model === 'bike' ? e.z + 0.55 : bx.max.z - 0.25, h = active.model === 'bike' ? e.y - 0.05 : Math.max(1.0, bx.max.y * 0.62);
        camT.set(carPos.x + f.x * front, gy + h, carPos.z + f.z * front);
        look.set(camT.x + f.x * 30, camT.y - 1.6, camT.z + f.z * 30); smooth = 40;
      } else if (idx === 4) {
        camT.set(carPos.x, gy + 40 + L, carPos.z - 9); look.set(carPos.x, gy, carPos.z);
      } else {
        const d = 3.5 + L * 0.85, h = 1.6 + L * 0.28;
        camT.set(carPos.x - f.x * d, gy + h, carPos.z - f.z * d); look.set(carPos.x, gy + 1.2 + L * 0.08, carPos.z);
      }
    }
    // the player's own body would fill a first-person view
    body.visible = mode !== 'crysta' && !firstPerson;
    const back = typeof lookBack !== 'undefined' && !!lookBack;   // C / RB: look behind
    if (back) {
      if (firstPerson || idx === 3) { look.set(2 * camT.x - look.x, look.y, 2 * camT.z - look.z); }
      else { camT.set(2 * carPos.x - camT.x, camT.y, 2 * carPos.z - camT.z); look.set(2 * carPos.x - look.x, look.y, 2 * carPos.z - look.z); }
    }
    if (back !== !!updateCam.back) { updateCam.back = back; camSnap = true; }
    if (!firstPerson && idx !== 4) clipCam(mode === 'foot' ? carPos.x : carPos.x, (mode === 'foot' ? ped.y + 1.45 : look.y), carPos.z, camT, dt);
    if (camSnap) { camera.position.copy(camT); camSnap = false; }
    else camera.position.lerp(camT, 1 - Math.exp(-dt * smooth));
    if (camera.fov !== 65) { camera.fov = 65; camera.updateProjectionMatrix(); }
    camera.lookAt(look);
  }
  // camera collision: probe the ray pivot -> camera against wall segments (world.collide); pull the camera in
  // fast when something is in the way, ease it back out slowly, so it never jitters at a wall edge
  let clipK = 1;
  function clipCam(px, py, pz, cam, dt) {
    let lim = 1;
    const dx = cam.x - px, dz = cam.z - pz, L = Math.hypot(dx, dz);
    if (L > 0.5) for (let k = 0.08; k <= 1.0001; k += 0.08) {
      const q = { x: px + dx * k, z: pz + dz * k }, c = world.collide(q, 0.3);
      if (c && c.hit) { lim = Math.max(0.12, k - 0.1); break; }
    }
    clipK += (lim - clipK) * (1 - Math.exp(-dt * (lim < clipK ? 18 : 3)));
    if (clipK < 0.999) { cam.x = px + dx * clipK; cam.z = pz + dz * clipK; cam.y = py + (cam.y - py) * Math.max(clipK, 0.35); }
  }
  function cameraName() { const i = (typeof cameraIndex === 'number' ? cameraIndex : 0) % 5; return (mode === 'foot' ? FOOT_CAM_NAMES : CAM_NAMES)[i]; }

  // ---------------------------------------------------------------- PUBG-style third-person camera rig (all modes)
  // R.yaw / R.pitch are the camera's own world angles (yaw = the direction the camera looks along, like carRot;
  // pitch > 0 = looking down from above). Mouse (pointer lock), drag fallback and touch drag set them directly.
  // On foot the camera sits over the right shoulder and WASD moves relative to it; in vehicles it orbits freely
  // and eases back behind the direction of travel 1.5 s after the last input. The pivot is the FINAL position
  // after physics (no lag, no jitter); only the jump height and collision distance are spring-smoothed.
  const DEG = Math.PI / 180, PITCH_MIN = -60 * DEG, PITCH_MAX = 70 * DEG, SENS = 0.0022;
  const R = { yaw: 0, pitch: 0.15, yv: 0, pv: 0, idle: 99, zoom: 1, altYaw: null, ret: false, init: false, py: 0, pyv: 0, dist: 0, dv: 0,
    lx: 0, lz: 0, vx: 0, vz: 0, fov: 65, key: '', ptrs: new Map(), pinch0: 0, zoom0: 1 };
  const FL = { get on() { return R.idle < 1.5; } };
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  // critically damped spring (exact for constant target): x toward t with angular frequency w
  function spring(x, v, t, w, dt) { const d = x - t, e = Math.exp(-w * dt), nx = t + (d + (v + w * d) * dt) * e, nv = (v - w * (v + w * d) * dt) * e; return [nx, nv]; }
  function lookInput(dx, dy) { if (mode !== 'foot' && window.Cockpit && Cockpit.seated) { Cockpit.look(dx, dy); return; } R.yaw -= dx; R.pitch = THREE.MathUtils.clamp(R.pitch + dy, PITCH_MIN, PITCH_MAX); R.idle = 0; R.yv = R.pv = 0; R.ret = false; }
  const canvasEl = () => (typeof renderer !== 'undefined' && renderer.domElement) || document.getElementById('gl');
  function isView(t) { return t && t.tagName === 'CANVAS' && (t === canvasEl() || t.id === 'gl'); }
  const playing = () => typeof isPlaying === 'undefined' || isPlaying;
  // anything that needs the cursor: map, help, settings, chat / creator / property panels (anything covering the
  // middle of the screen), a focused text field, the start menu
  function uiOpen() {
    if (!playing()) return true;
    if (document.body.classList.contains('map-open')) return true;
    const ae = document.activeElement; if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable)) return true;
    for (const id of ['info', 'settings']) { const el = document.getElementById(id); if (el && el.classList.contains('open')) return true; }
    const c = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return !!c && !isView(c) && c !== document.body && c !== document.documentElement;
  }
  const locked = () => document.pointerLockElement === canvasEl();
  addEventListener('pointerdown', e => {
    if (!isView(e.target) || !playing()) return;
    if (e.pointerType === 'mouse') {
      if (e.button !== 0 && e.button !== 2) return;                          // middle = multiplayer ping
      if (!locked() && !uiOpen() && e.target.requestPointerLock) { try { const r = e.target.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (err) {} }
    }
    R.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { e.target.setPointerCapture(e.pointerId); } catch (err) {}
    if (R.ptrs.size === 2) { const [a, b] = [...R.ptrs.values()]; R.pinch0 = Math.hypot(a.x - b.x, a.y - b.y) || 1; R.zoom0 = R.zoom; }
  });
  addEventListener('pointermove', e => {
    if (e.pointerType === 'mouse' && locked()) { lookInput(e.movementX * SENS, e.movementY * SENS); return; }   // no drag needed
    const p = R.ptrs.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (R.ptrs.size >= 2) { const [a, b] = [...R.ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y) || 1; R.zoom = THREE.MathUtils.clamp(R.zoom0 * R.pinch0 / d, 0.5, 2.5); R.idle = 0; return; }
    if (Math.abs(dx) + Math.abs(dy) < 0.5) return;
    const k = e.pointerType === 'touch' ? 0.009 : 0.005;                       // drag fallback / touch
    lookInput(dx * k, dy * k * 0.8);
  });
  const flUp = e => { R.ptrs.delete(e.pointerId); };
  addEventListener('pointerup', flUp); addEventListener('pointercancel', flUp);
  addEventListener('wheel', e => {
    if (!isView(e.target) || !playing()) return;
    e.preventDefault(); R.zoom = THREE.MathUtils.clamp(R.zoom * (e.deltaY > 0 ? 1.1 : 1 / 1.1), 0.5, 2.5);
  }, { passive: false });
  addEventListener('contextmenu', e => { if (isView(e.target)) e.preventDefault(); });
  // Alt: free-look that doesn't steer the walker; on release the view swings back
  addEventListener('keydown', e => { if ((e.code === 'AltLeft' || e.code === 'AltRight') && !e.repeat) { e.preventDefault(); if (R.altYaw === null) R.altYaw = R.yaw; } });
  addEventListener('keyup', e => { if ((e.code === 'AltLeft' || e.code === 'AltRight') && R.altYaw !== null) { e.preventDefault(); R.ret = R.altYaw; R.altYaw = null; } });
  addEventListener('blur', () => { if (R.altYaw !== null) { R.ret = R.altYaw; R.altYaw = null; } });

  // the direction WASD moves toward (camera yaw, or the held yaw during Alt free-look)
  function moveYaw() { return R.altYaw !== null ? R.altYaw : (typeof R.ret === 'number' ? R.ret : R.yaw); }
  // which views use the rig: chase (0) and close chase (1) everywhere
  // on foot every view but top-down orbits (shoulder, close, first-person look-around, low) so the drag always turns the camera 360
  const rigView = () => { const i = (typeof cameraIndex === 'number' ? cameraIndex : 0) % 5; return i === 0 || i === 1 || (mode === 'foot' && i !== 4); };
  const footIdx = () => (typeof cameraIndex === 'number' ? cameraIndex : 0) % 5;

  // the rig itself: called after physics with the final position
  function rig(dt, close) {
    dt = Math.min(dt, 0.1);
    let px, gy, L, h, dist, side, sprint = false, roof = 1.6, cr = 0;
    if (mode === 'foot') {
      px = { x: carPos.x, z: carPos.z }; gy = ped.y; L = 0; h = 1.55;
      sprint = !!inputState.nos && Math.abs(ped.speed) > 3;
      dist = (close ? 1.9 : 2.55) + (sprint ? 0.35 : 0); side = close ? 0.45 : 0.55;
      const fi = footIdx();
      if (fi === 2) { dist = 0.05; side = 0; h = 1.6; }                       // first person: look around from the eyes
      else if (fi === 3) { dist = 1.6; side = 0.4; h = 1.0; }                  // low shoulder
    } else {
      const g = mode === 'crysta' ? playerCarGroup : active.g;
      px = { x: g.position.x, z: g.position.z }; gy = g.position.y;
      const bx = mode === 'crysta' ? null : boxOf(active);
      L = mode === 'crysta' ? CRYSTA_LEN : Math.max(1.8, (active.len && active.len < 30 ? active.len : 4));
      roof = bx ? bx.max.y : 1.85; cr = mode === 'crysta' ? CRYSTA_LEN / 2 : Math.max(bx.max.z, -bx.min.z, 1);
      h = roof * 0.55 + 0.9 + L * 0.06; dist = (close ? 0.7 : 1) * (3.2 + L * 0.85); side = 0;
    }
    const key = mode + ':' + (active ? active.model : '');
    if (key !== R.key || !R.init) {                                            // entered / left something: start behind it
      R.key = key; R.init = true; R.yaw = carRot; R.pitch = mode === 'foot' ? 0.12 : 0.2; R.yv = R.pv = 0; R.idle = 99; R.ret = false; R.altYaw = null;
      R.py = gy + h; R.pyv = 0; R.dist = dist; R.dv = 0; R.lx = px.x; R.lz = px.z; R.vx = R.vz = 0;
    }
    R.idle += dt;
    // travel velocity: the Crysta's physics velocity directly; other vehicles from the final positions (smoothed,
    // and reset on a teleport / respawn so a jump never swings the view)
    if (mode === 'crysta' && typeof vel !== 'undefined') { R.vx = vel.x; R.vz = vel.z; }
    else if (dt > 0) {
      const ix = (px.x - R.lx) / dt, iz = (px.z - R.lz) / dt;
      if (Math.hypot(px.x - R.lx, px.z - R.lz) > 15) { R.vx = R.vz = 0; }
      else { const k = 1 - Math.exp(-dt * 12); R.vx += (ix - R.vx) * k; R.vz += (iz - R.vz) * k; }
    }
    R.lx = px.x; R.lz = px.z;
    const spd = Math.hypot(R.vx, R.vz);
    if (typeof R.ret === 'number') {                                           // Alt released: swing back
      [R.yaw, R.yv] = spring(R.yaw, R.yv, R.yaw + wrap(R.ret - R.yaw), 14, dt);
      if (Math.abs(wrap(R.ret - R.yaw)) < 0.01) { R.yaw = R.ret; R.ret = false; R.yv = 0; }
    } else if (mode !== 'foot' && R.idle > 1.0 && R.ptrs.size === 0) {
      // follow behind the direction of travel (velocity, so a drift shows the slide) with a slight, constant lag:
      // steady-state lag of a critically damped spring = 2 * turn rate / w, i.e. ~6 deg at 30 deg/s.
      // Reversing / crawling keeps the current angle (no swing). The pull fades in over 0.6 s after mouse input.
      const fx = Math.sin(carRot), fz = Math.cos(carRot), fwdV = R.vx * fx + R.vz * fz;
      const ease = Math.min(1, (R.idle - 1.0) / 0.6);
      if (fwdV > 1.0) {
        // heading at walking pace, velocity direction once moving; a slide is followed up to 50 deg off the nose
        const a = Math.min(1, Math.max(0, (spd - 2) / 4));
        const slip = THREE.MathUtils.clamp(wrap(Math.atan2(R.vx, R.vz) - carRot), -0.87, 0.87);
        const tgt = carRot + slip * a, w = (7 + Math.min(3, spd * 0.12)) * ease;
        [R.yaw, R.yv] = spring(R.yaw, R.yv, R.yaw + wrap(tgt - R.yaw), w, dt);
        [R.pitch, R.pv] = spring(R.pitch, R.pv, 0.2, w * 0.6, dt);
      } else if (R.idle > 1.6) {
        // stopped / reversing: the look-around still springs back behind the vehicle (after a short pause)
        const w = 5 * Math.min(1, (R.idle - 1.6) / 0.6);
        [R.yaw, R.yv] = spring(R.yaw, R.yv, R.yaw + wrap(carRot - R.yaw), w, dt);
        [R.pitch, R.pv] = spring(R.pitch, R.pv, 0.2, w * 0.6, dt);
      } else { R.yv *= Math.exp(-dt * 8); R.pv *= Math.exp(-dt * 8); }
    }
    R.yaw = wrap(R.yaw);
    const back = typeof lookBack !== 'undefined' && !!lookBack;
    const yaw = R.yaw + (back ? Math.PI : 0), pitch = back ? 0.2 : R.pitch;
    // only the vertical (jumps, kerbs) is smoothed; horizontal follows exactly
    const sus = mode === 'crysta' ? (typeof crystaSusp !== 'undefined' ? crystaSusp : null) : (active && active.susp && active.susp.st);   // the chase view rides the body a little
    [R.py, R.pyv] = spring(R.py, R.pyv, gy + h + (sus && sus.dh ? sus.dh * 0.8 : 0), mode === 'foot' ? 14 : 10, dt);
    [R.dist, R.dv] = spring(R.dist, R.dv, dist * R.zoom, 6, dt);
    const fwd = { x: Math.sin(yaw) * Math.cos(pitch), y: -Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch) };
    const rt = { x: -Math.cos(yaw), z: Math.sin(yaw) };                       // camera right
    const pv = { x: px.x + rt.x * side, y: R.py, z: px.z + rt.z * side };     // over the right shoulder
    const cam = new THREE.Vector3(pv.x - fwd.x * R.dist, pv.y - fwd.y * R.dist, pv.z - fwd.z * R.dist);
    clipCam(pv.x, pv.y, pv.z, cam, dt);
    cam.y = Math.max(cam.y, gy + 0.3, (typeof groundY === 'function' ? groundY(cam.x, cam.z) : 0) + 0.25);
    // never inside the vehicle body: pulled in closer than its half length -> go over the roof
    if (mode !== 'foot') { const dh = Math.hypot(cam.x - px.x, cam.z - px.z); if (dh < cr + 0.4) cam.y = Math.max(cam.y, gy + roof + 0.5); }
    camera.position.copy(cam);
    const nod = sus && sus.p ? sus.p * 0.6 : 0;
    camera.lookAt(cam.x + fwd.x * 10, cam.y + fwd.y * 10 - nod, cam.z + fwd.z * 10);
    // FOV: a little wider with speed / sprint
    const kmh = Math.abs(carSpeed), fovT = 65 + (mode === 'foot' ? (sprint ? 5 : 0) : Math.min(12, kmh * 0.07)) + (typeof isNosActive !== 'undefined' && isNosActive && mode === 'crysta' ? 6 : 0);
    R.fov += (fovT - R.fov) * (1 - Math.exp(-dt * 3));
    if (Math.abs(camera.fov - R.fov) > 0.01) { camera.fov = R.fov; camera.updateProjectionMatrix(); }
    if (mode !== 'crysta') body.visible = !(mode === 'foot' && footIdx() === 2);
    if (typeof updateCamera !== 'undefined') updateCamera.yaw = yaw;
    camSnap = false;
  }
  // per frame (after the camera): release the pointer when a menu / map / chat opens
  function freeLook(dt) {
    if (locked() && uiOpen()) { try { document.exitPointerLock(); } catch (e) {} }
  }
  // the Crysta's chase views (crysta.js updateCamera) use the same rig
  function crystaRig(dt) { if (mode !== 'crysta' || !rigView()) return false; rig(dt, ((typeof cameraIndex === 'number' ? cameraIndex : 0) % 5) === 1); return true; }

  function update(dt) {
    if (ped.act && mode !== 'foot') act(null);
    const n = Math.max(1, Math.ceil(dt / (1 / 120) - 1e-6)), h = dt / n;   // sub-steps: frame-rate independent, no tunnelling
    for (let i = 0; i < n; i++) { if (mode === 'foot') walk(h); else if (mode === 'vehicle') driveVehicle(h, active); }
    if (mode === 'passenger' && active) {
      // auto-rides.js moves the auto; the player just goes along
      carPos.set(active.g.position.x, 0, active.g.position.z); carRot = active.g.rotation.y;
      carSpeed = active.kmh || 0; isReversing = false; currentGear = '-'; engineRPM = 800;
    }
    if ((mode === 'vehicle' || mode === 'passenger') && body.userData.pose) {
      // re-apply the seated pose (the character creator can rebuild the body), lean into the steering
      HumanModel.sit(hp, body.userData.pose);
      if (mode === 'vehicle' && active) { const s = active.steer || 0; hp.torso.rotation.y = s * 0.12; hp.head.rotation.y = s * 0.25;
        // bicycle: legs turn the cranks (crank angle follows the rear wheel through the gearing)
        if (active.p && active.p.pedal) {
          active._crank = (active._crank || 0) + (active.vF || 0) * dt / 0.34 * 0.45;
          const c = active._crank;
          hp.legL.rotation.x = -1.05 + Math.sin(c) * 0.38; hp.legR.rotation.x = -1.05 + Math.sin(c + Math.PI) * 0.38;
          hp.shinL.rotation.x = 1.35 - Math.cos(c) * 0.35; hp.shinR.rotation.x = 1.35 - Math.cos(c + Math.PI) * 0.35;
        } }
    }
  }
  // every frame, whatever the mode: carjacked drivers keep running
  let hintT = 0, hintEl = null;
  function tick(dt) {
    if (active && active.g && !active.g.visible) active.g.visible = true;   // last word before the render: distance culling never hides what the player drives
    if (fleeing.length) updateFleeing(dt);
    try { checkBikeHits(dt); if (downed.length) updateDowned(dt); } catch (e) { console.error(e); }
    // on foot: say which vehicle F will take
    if ((hintT += dt) < 0.25) return; hintT = 0;
    if (!hintEl) { hintEl = document.createElement('div'); hintEl.id = 'enterHint'; hintEl.style.cssText = 'position:fixed;left:50%;bottom:calc(120px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:6;padding:6px 12px;border-radius:8px;background:rgba(10,15,25,.75);color:#e5e7eb;font:600 13px system-ui,sans-serif;pointer-events:none;display:none;white-space:nowrap'; document.body.appendChild(hintEl); }
    const b = mode === 'foot' && (typeof isPlaying === 'undefined' || isPlaying) ? pickVehicle() : null;
    hintPick = b; hintAt = performance.now();
    if (!b) { hintEl.style.display = 'none'; return; }
    const v = b.v, name = b.prop ? PARAMS.splendor.name : b.pk ? (PARAMS[b.pk.kind] || PARAMS.hatch).name : v.crysta ? 'INNOVA CRYSTA' : (PARAMS[v.model] || PARAMS.hatch).name;
    const jack = !!v && traffic.includes(v) && !v.parked && !v._propSlot && !!driverOf(v);
    hintEl.innerHTML = '<b style="color:#fbbf24">F</b> ' + (jack ? 'Take' : 'Get in') + ' · ' + name;
    hintEl.style.display = 'block';
  }
  // R key: whatever you are doing, go back to the Crysta (respawnCar then moves it)
  function resetToCrysta() {
    if (mode === 'crysta') return;
    if (mode === 'passenger') { if (passengerExit) passengerExit(active); unseatBody(); active = null; }
    if (mode === 'vehicle') { const v0 = active; active.g.rotation.z = 0; unseatBody(); parked.push(active); active = null; setTail(v0, false); syncSpot(null); engineOff(v0); }
    const i = parked.findIndex(v => v.crysta); if (i >= 0) parked.splice(i, 1);
    body.visible = false; mode = 'crysta'; lastLeft = null; setHud();
  }
  // the Crysta also bumps into parked vehicles
  function crystaCollide() {
    const p = { x: carPos.x, z: carPos.z };
    const h = pushOutParked(p, 1.1, true);
    if (h) {
      carPos.x = p.x; carPos.z = p.z;
      // remove only the velocity into the parked vehicle (old code halved carSpeed every frame = stuck)
      const vn = vel.x * h.nx + vel.z * h.nz;
      if (vn < 0) { vel.x -= 1.2 * vn * h.nx; vel.z -= 1.2 * vn * h.nz; if (-vn > 6) showComboPopup('BUMP!'); }
      carSpeed = lastSpeed = (vel.x * Math.sin(carRot) + vel.z * Math.cos(carRot)) * 3.6;
    }
  }

  // external modules (properties.js garages) register a parked vehicle: collision + enterable with F
  function addParked(v) {
    if (!v || !v.g || parked.includes(v)) return;
    if (v.len2) { v.len = v.len2 * 2; delete v.len2; }
    if (!v.len) v.len = 4;
    if (!v.hw) v.hw = (PARAMS[v.model] || PARAMS.hatch).hw;
    if (!v.wheels) v.wheels = [];
    if (!v.tail) v.tail = [];
    parked.push(v);
  }
  // multiplayer: seat change while riding, and another player's knock arriving here
  function moveSeat(seat) { if (mode === 'passenger' && active) { seatBody(active, seat); return true; } return false; }
  function knockItem(it, dx, dz) { const t = claimParkedBike(it); if (t) knockBike(t, dx, dz, true, 20); }
  const api = { act, get action() { return ped.act; }, bodyColour, hideProp, moveSeat, knockItem, onKnock: null, get ped() { return ped; }, vehiclePart, partsOf, boxOf, seatEye, get bodyRef() { return body; }, _pick: () => pickVehicle(), addParked, pushOutParked, get parkedList() { return parked; }, toggle, crystaRig, update, updateCam, resetToCrysta, crystaCollide, setHud, tick, freeLook, cameraName, enterPassenger, leavePassenger, PARAMS, SEATS,
    set onPassengerExit(f) { passengerExit = f; }, get freeLookOn() { return FL.on; }, get fleeing() { return fleeing; }, get body() { return human; }, get mode() { return mode; }, get active() { return active; } };
  return api;
})();
