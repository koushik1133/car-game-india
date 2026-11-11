// vehicle-dynamics.js: shared steering / cornering model for the Crysta and every driveable vehicle, trailer kinematics
// and the audio bus levels. No per-frame allocation; everything is plain arithmetic on a small state object.
//
// Method (standard vehicle-dynamics results, simplified for a game):
//  - Low speed: kinematic bicycle model. Yaw rate = v tan(delta) / L, reference point the rear axle, so nothing can
//    yaw at standstill and the tail follows the nose. Full lock comes from the published minimum turning radius.
//  - Published radii are kerb-to-kerb: the path of the OUTER FRONT wheel. R^2 = (Rr + T/2)^2 + L^2, where Rr is the
//    rear-axle centre radius, L the wheelbase and T the track. Bicycle lock = atan(L / Rr).
//  - Front wheels follow Ackermann geometry: inner tan(d) = L / (Rr - T/2), outer tan(d) = L / (Rr + T/2).
//  - Speed: linear understeer, r = v delta / (L + K v^2) (K: understeer gradient), then a Magic-Formula-shaped lateral
//    tyre curve that saturates and falls off past its peak. Steering lock is limited to what the tyres can use.
//  - Weight transfer: dF = -ax h / (g L) moves load between axles. Throttle lightens the front (more understeer),
//    braking loads it (sharper turn-in). A friction circle shares grip between cornering and braking/driving.
//  - Body slip: the centre of the car moves sideways by r * lr at low speed; rear tyre slip takes over at high speed.
window.VehicleDynamics = (function () {
  const g = 9.81, AUTO_T = 1.15;
  // L wheelbase m, R published min turning radius m, T track m, us understeer deg/g, grip lateral grip factor,
  // lock lock-to-centre time at rest s, h CG height m. src: 'pub' = published figure used, 'est' = estimated.
  const S = {
    crysta: { L: 2.75, R: 5.4, T: 1.54, us: 3.0, grip: 0.86, lock: 0.75, h: 0.72, src: 'pub' }, mpv: { L: 2.75, R: 5.4, T: 1.54, us: 3.0, grip: 0.86, lock: 0.75, h: 0.72, src: 'pub' },
    swift: { L: 2.43, R: 4.8, T: 1.47, us: 2.2, grip: 0.9, lock: 0.6, h: 0.56, src: 'pub' }, swiftNew: { L: 2.45, R: 4.8, T: 1.52, us: 2.2, grip: 0.92, lock: 0.6, h: 0.55, src: 'pub' },
    dzire: { L: 2.45, R: 4.8, T: 1.5, us: 2.4, grip: 0.9, lock: 0.6, h: 0.56, src: 'pub' }, alto: { L: 2.36, R: 4.6, T: 1.3, us: 2.6, grip: 0.82, lock: 0.6, h: 0.56, src: 'est' }, hatch: { L: 2.43, R: 4.8, T: 1.47, us: 2.4, grip: 0.88, lock: 0.6, h: 0.56, src: 'est' },
    bolero: { L: 2.68, R: 5.8, T: 1.48, us: 4.5, grip: 0.72, lock: 0.9, h: 0.85, src: 'est' }, scorpio: { L: 2.68, R: 5.4, T: 1.5, us: 4.2, grip: 0.74, lock: 0.85, h: 0.85, src: 'pub' }, scorpioN: { L: 2.75, R: 5.5, T: 1.6, us: 3.4, grip: 0.84, lock: 0.8, h: 0.75, src: 'pub' },
    safari: { L: 2.65, R: 5.4, T: 1.56, us: 4.4, grip: 0.74, lock: 0.9, h: 0.86, src: 'pub' }, sumo: { L: 2.425, R: 5.0, T: 1.42, us: 4.8, grip: 0.68, lock: 0.9, h: 0.9, src: 'pub' },
    suv: { L: 2.7, R: 5.6, T: 1.52, us: 4, grip: 0.76, lock: 0.85, h: 0.8, src: 'est' }, fortuner: { L: 2.745, R: 5.8, T: 1.54, us: 3.8, grip: 0.8, lock: 0.85, h: 0.8, src: 'pub' },
    hilux: { L: 3.085, R: 6.4, T: 1.54, us: 3.8, grip: 0.8, lock: 0.85, h: 0.8, src: 'pub' }, crysta2023: { L: 2.75, R: 5.4, T: 1.54, us: 3.0, grip: 0.86, lock: 0.75, h: 0.72, src: 'pub' },
    ace: { L: 2.1, R: 4.3, T: 1.3, us: 3.8, grip: 0.66, lock: 0.8, h: 0.75, src: 'est' }, auto: { L: 2.0, R: 3.0, T: 1.15, us: 3, grip: 0.55, lock: 0.45, h: 0.6, src: 'est' },
    tractor: { L: 1.95, R: 3.2, T: 1.5, us: 3, grip: 0.55, lock: 1.1, h: 0.9, src: 'est' }, lorry: { L: 4.8, R: 8.0, T: 1.85, us: 6, grip: 0.5, lock: 1.4, h: 1.3, src: 'est' }, bus: { L: 5.5, R: 10, T: 1.9, us: 6, grip: 0.5, lock: 1.4, h: 1.2, src: 'est' },
    bike: { L: 1.27, R: 2.1, T: 0, us: 0.8, grip: 0.85, lock: 0.3, h: 0.55, src: 'est' }, splendor: { L: 1.26, R: 2.0, T: 0, us: 0.8, grip: 0.85, lock: 0.3, h: 0.55, src: 'est' }, starCity: { L: 1.26, R: 2.0, T: 0, us: 0.8, grip: 0.85, lock: 0.3, h: 0.55, src: 'est' },
    scooter: { L: 1.26, R: 1.9, T: 0, us: 0.8, grip: 0.8, lock: 0.25, h: 0.5, src: 'est' }, activa: { L: 1.26, R: 1.9, T: 0, us: 0.8, grip: 0.8, lock: 0.25, h: 0.5, src: 'est' },
    classic: { L: 1.39, R: 2.5, T: 0, us: 0.9, grip: 0.85, lock: 0.35, h: 0.6, src: 'est' }, classic2: { L: 1.37, R: 2.4, T: 0, us: 0.9, grip: 0.85, lock: 0.35, h: 0.6, src: 'est' },
    sport: { L: 1.35, R: 2.5, T: 0, us: 0.7, grip: 0.95, lock: 0.3, h: 0.58, src: 'est' }, faired: { L: 1.33, R: 2.7, T: 0, us: 0.7, grip: 1.0, lock: 0.3, h: 0.55, src: 'est' }, cycle: { L: 1.05, R: 1.8, T: 0, us: 0.6, grip: 0.7, lock: 0.25, h: 0.7, src: 'est' },
    berlinetta: { L: 2.65, R: 5.6, T: 1.63, us: 1.5, grip: 1.15, lock: 0.5, h: 0.46, src: 'est' }, muscle: { L: 2.72, R: 5.8, T: 1.6, us: 2.2, grip: 1.0, lock: 0.6, h: 0.52, src: 'est' }, wedge: { L: 2.62, R: 5.8, T: 1.65, us: 1.4, grip: 1.2, lock: 0.5, h: 0.46, src: 'est' }, coupe911: { L: 2.45, R: 5.5, T: 1.55, us: 1.5, grip: 1.15, lock: 0.5, h: 0.46, src: 'est' },
    // additions. src 'pub': wheelbase and radius published; 'est': radius / handling figures estimated
    wagonR: { L: 2.435, R: 4.7, T: 1.4, us: 2.8, grip: 0.82, lock: 0.6, h: 0.62, src: 'pub' }, innova: { L: 2.75, R: 5.4, T: 1.51, us: 3.2, grip: 0.82, lock: 0.75, h: 0.72, src: 'pub' },
    defender: { L: 3.02, R: 6.4, T: 1.7, us: 2.8, grip: 0.84, lock: 0.85, h: 0.82, src: 'est' }, gclass: { L: 2.89, R: 6.8, T: 1.65, us: 2.6, grip: 0.88, lock: 0.85, h: 0.84, src: 'est' },
    landCruiser: { L: 2.85, R: 5.9, T: 1.65, us: 3.6, grip: 0.84, lock: 0.85, h: 0.84, src: 'est' }, tharRoxx: { L: 2.85, R: 5.75, T: 1.6, us: 4, grip: 0.78, lock: 0.85, h: 0.85, src: 'est' },
    hayabusa: { L: 1.48, R: 3.2, T: 0, us: 0.7, grip: 1.05, lock: 0.34, h: 0.55, src: 'est' }, s1000rr: { L: 1.457, R: 3.0, T: 0, us: 0.6, grip: 1.15, lock: 0.3, h: 0.56, src: 'est' },
    r1250gsa: { L: 1.51, R: 2.9, T: 0, us: 0.9, grip: 0.9, lock: 0.34, h: 0.68, src: 'est' }, r1300gsa: { L: 1.53, R: 2.9, T: 0, us: 0.9, grip: 0.92, lock: 0.34, h: 0.68, src: 'est' },
    thar: { L: 2.45, R: 5.3, T: 1.52, us: 2.8, grip: 0.82, lock: 0.6, h: 0.82, src: 'est' }, hector: { L: 2.75, R: 5.6, T: 1.57, us: 2.6, grip: 0.86, lock: 0.58, h: 0.72, src: 'est' },
    bullockCart: { L: 2.0, R: 4.0, T: 1.2, us: 2, grip: 0.4, lock: 2, h: 0.9, src: 'est' },
  };
  // handling pass: predictable road cars (little understeer growth, quick racks) and per-model two-wheeler lean.
  // Figures are game tuning, not published data. lean: max deg; leanW: servo rad/s; leanRate: rad/s cap
  const tune = (keys, o) => keys.forEach(k => Object.assign(S[k], o));
  tune(['safari', 'bolero', 'scorpio'], { us: 2.8, grip: 0.82, lock: 0.62 }); tune(['sumo'], { us: 3, grip: 0.8, lock: 0.65 });
  tune(['suv', 'tharRoxx'], { us: 2.8, grip: 0.82, lock: 0.6 }); tune(['fortuner', 'hilux', 'landCruiser', 'scorpioN'], { us: 2.6, grip: 0.86, lock: 0.58 });
  tune(['crysta', 'crysta2023', 'mpv', 'innova'], { us: 2.4, grip: 0.88, lock: 0.55 }); tune(['swift', 'swiftNew', 'dzire', 'hatch', 'alto', 'wagonR'], { us: 1.9, lock: 0.46 });
  tune(['ace'], { us: 3, grip: 0.74, lock: 0.65 });
  tune(['bike', 'splendor', 'starCity'], { lean: 36, leanW: 7, leanRate: 1.25 }); tune(['scooter', 'activa'], { lean: 33, leanW: 8, leanRate: 1.3 });
  tune(['classic', 'classic2'], { lean: 34, leanW: 5.5, leanRate: 1.05 }); tune(['sport'], { lean: 42, leanW: 7.5, leanRate: 1.6 }); tune(['faired'], { lean: 45, leanW: 8, leanRate: 1.7 });
  tune(['hayabusa'], { lean: 45, leanW: 6, leanRate: 1.5 }); tune(['s1000rr'], { lean: 48, leanW: 7.5, leanRate: 1.9 }); tune(['r1250gsa', 'r1300gsa'], { lean: 40, leanW: 5.5, leanRate: 1.25 }); tune(['cycle'], { lean: 28, leanW: 6, leanRate: 1.1 });
  const usRad = deg => (deg * Math.PI / 180) / g;   // deg/g -> rad/(m/s^2)
  function make(spec, lr) {
    const L = spec.L, T = spec.T, Rr = Math.sqrt(Math.max(0.1, spec.R * spec.R - L * L)) - T / 2;
    return { spec, L, T, K: usRad(spec.us), grip: spec.grip, lock: spec.lock, h: spec.h, deltaMax: Math.atan(L / Rr), lr, s: 0, sv: 0, delta: 0, r: 0 };
  }
  // state for a vehicle: rear axle offset from the model origin comes from the model's real axles
  function forVehicle(v, type) {
    const ax = v.g && v.g.userData && v.g.userData.axles, spec = S[type] || S[v.model] || S.hatch;
    return make(spec, ax ? -ax.zr : spec.L / 2);
  }
  // steering rack: smooth second-order ramp, slew limited; slower with speed, self-centres faster than it turns in
  function steer(st, target, v, dt) {
    const sp = Math.abs(v), centring = !target || (st.s && Math.sign(target) !== Math.sign(st.s));
    const rate = (centring ? 1.7 : 1) / (st.lock * (1 + sp / 30));
    const want = Math.max(-rate, Math.min(rate, (target - st.s) * 9));
    st.sv += (want - st.sv) * Math.min(1, dt * 16);
    st.s += st.sv * dt;
    if (!target && Math.abs(st.s) < 0.002 && Math.abs(st.sv) < 0.01) { st.s = 0; st.sv = 0; }
    st.s = Math.max(-1, Math.min(1, st.s));
    // speed-sensitive lock: no more angle than the tyres can use (kinematic angle for the peak lateral g + peak slip)
    // 1.3 = the tyre curve's peak, so full lock at speed corners flat out instead of washing past the limit
    const lim = sp > 2 ? 1.3 * Math.atan(st.limG * (st.L + st.K * sp * sp) / (sp * sp)) : st.deltaMax;
    st.delta = st.s * Math.min(st.deltaMax, lim);
    return st.delta;
  }
  // one yaw step. mu: surface friction; ax: longitudinal accel m/s^2. Writes st.r (yaw rate), st.ay, st.vL (body side
  // velocity the tyres pull towards) and returns st.r
  function cornering(st, v, mu, ax, dt, boost) {
    const peak0 = mu * st.grip * g; st.limG = peak0;
    const dF = -ax * st.h / (g * st.L);                        // + = load onto the front axle
    const K = st.K * Math.max(0.3, 1 - 3.5 * dF);
    const rLin = v * Math.tan(st.delta) / (st.L + K * v * v), aLin = Math.abs(rLin * v);
    const circle = Math.sqrt(Math.max(0.08, 1 - (ax * ax) / (peak0 * peak0)));
    const peak = peak0 * circle * (1 - Math.min(0.3, Math.abs(dF) * 0.5));
    // Magic-Formula shape with unit initial slope: linear, then rolls over at the limit and sags past it
    const x = aLin / peak, fy = x > 1e-4 ? Math.sin(1.4 * Math.atan(0.714 * x)) / (0.714 * 1.4 * x) : 1;
    let rT = rLin * fy; if (boost) rT *= boost;
    const tau = 0.03 + Math.min(0.07, Math.abs(v) * 0.005);    // yaw inertia: instant at parking speed, a little lag at speed
    st.r += (rT - st.r) * Math.min(1, dt / tau);
    st.ay = st.r * v;
    st.vL = st.r * st.lr - Math.sign(v) * Math.abs(v) * st.ay * (0.0015 + 0.006 * Math.max(0, x - 1.35));   // kinematic + rear slip, real slide only past the limit
    st.slip = x;
    return st.r;
  }
  // Two-wheeler: the rider commands a LEAN, and a coordinated turn follows from it: r = g tan(lean) / v. At walking pace
  // lean has no authority, so yaw blends to the kinematic bicycle (bars). Lean is a critically damped servo, slower with
  // speed (gyroscopic stiffness), limited by the lock radius, the model's clearance and the friction circle, so hard
  // braking stands the bike up. No side slip: the tyres stay on the arc. The bars show the steady angle plus a brief
  // counter-steer proportional to lean rate (visual only: it cannot feed back, so it cannot wobble).
  function bike(st, target, v, mu, ax, dt) {
    const sp = Math.abs(v), sv = st.spec, peak = mu * sv.grip * g, Rmin = st.L / Math.tan(st.deltaMax), a = ax < 0 ? -ax : ax * 0.35;
    const lat = peak * Math.sqrt(Math.max(0.15, 1 - a * a / (peak * peak)));
    const leanMax = Math.min((sv.lean || 36) * Math.PI / 180, Math.atan(lat / g), Math.atan(sp * sp / (Rmin * g)));
    const want = v > 0 ? target * leanMax : 0, w = (sv.leanW || 7) / (1 + sp / 30), lim = sv.leanRate || 1.25;
    st.phi = st.phi || 0; st.phiV = st.phiV || 0;
    const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;   // stiff at low speed: keep the servo stable at any frame rate
    for (let i = 0; i < n; i++) {
      st.phiV = Math.max(-lim, Math.min(lim, st.phiV + (w * w * (want - st.phi) - 2 * w * st.phiV) * h));
      st.phi += st.phiV * h;
    }
    const d = target - st.s, m = dt / st.lock; st.s += Math.max(-m, Math.min(m, d));
    const rKin = v * Math.tan(st.s * st.deltaMax) / st.L;
    const t = Math.max(0, Math.min(1, (sp - 2) / 3)), b = v > 0 ? t * t * (3 - 2 * t) : 0, cap = sp / Rmin;
    const rLean = Math.max(-cap, Math.min(cap, g * Math.tan(st.phi) / Math.max(sp, 0.5)));
    st.r = rKin + (rLean - rKin) * b;
    st.ay = st.r * v; st.vL = st.r * st.lr; st.slip = Math.abs(st.ay) / peak;
    const steady = sp > 1 ? Math.atan(st.L * st.r / v) : st.s * st.deltaMax;
    st.delta = Math.max(-st.deltaMax, Math.min(st.deltaMax, steady - st.phiV * 0.05 * Math.min(1, sp / 8)));
    if (v < 0) st.delta = st.s * st.deltaMax;
    return st.r;
  }
  // Ackermann: road-wheel angle at lateral offset x (+x is the inside of a +delta turn)
  function wheelAngle(st, x) {
    const d = st.delta; if (Math.abs(d) < 1e-4 || !st.T) return d;
    const Rr = st.L / Math.tan(Math.abs(d)), side = Math.sign(x) * Math.sign(d);
    return Math.sign(d) * Math.atan(st.L / Math.max(0.2, Rr - side * st.T / 2));
  }

  // ---------------------------------------------------------------- powertrain (every driveable vehicle except the Crysta, which keeps its own model in index.html)
  // Longitudinal model, per step at full throttle:
  //   engine rpm = v / R * 60 / 2pi * gear * final, floored at the launch rpm while the clutch / converter slips
  //   torque T(rpm): rises to the peak, flat over the published band, then follows Pmax / rpm through the power peak
  //   F = T * gear * final * eff / R, limited by the driven tyres, less aero (0.5 rho CdA v^2) and rolling (Crr m g)
  //   a = F / (m + rider + 4% wheels + Ie (gear final / R)^2); the shift point is where the next gear pulls harder
  // No grade term: the map is effectively flat where cars drive.
  // Row: [ps, @rpm, Nm, band from, band to, redline, kerb kg, gears (or [lo, hi] for a CVT), final (0 = derived from
  //       the top speed), tyre radius m, CdA m2, drive f/r/a/b(ike), box mt/at/dct/cvt, 0-100 s, top km/h, limiter?,
  //       tank L, fuel P/D, seats, src]
  // src is three letters for [power+torque+weight, gearing+CdA, 0-100+top]:
  //   v = found online (SRC below, with links), e = ESTIMATED, no source. Generic models are 'e' throughout, and the
  //   sports cars are invented cars given the figures of the real car they resemble. Gearing and CdA are estimated for all.
  const G5 = [3.55, 1.9, 1.28, 0.97, 0.76], D5 = [3.9, 2.1, 1.4, 1.0, 0.8], D6 = [4.35, 2.35, 1.45, 1.0, 0.78, 0.63], B4 = [2.9, 1.8, 1.3, 1.0], B5 = [2.6, 1.8, 1.4, 1.15, 0.96], B6 = [2.6, 1.9, 1.5, 1.27, 1.13, 1.03];
  const PW = {
    alto:     [47, 6000, 69, 3500, 3500, 6500, 740, G5, 4.53, 0.27, 0.62, 'f', 'mt', 19, 140, 0, 35, 'P', 4, 'ppt'],
    hatch:    [69, 6000, 95, 4000, 4000, 6500, 900, G5, 4.17, 0.28, 0.66, 'f', 'mt', 14.5, 150, 0, 35, 'P', 5, 'eee'],
    wagonR:   [90, 6000, 113, 4400, 4400, 6500, 850, G5, 4.17, 0.28, 0.76, 'f', 'mt', 13, 155, 0, 32, 'P', 5, 'ppt'],
    swift:    [86, 6000, 114, 4000, 4000, 6500, 965, [3.545, 1.904, 1.28, 0.966, 0.757], 4.39, 0.29, 0.65, 'f', 'mt', 12.6, 165, 0, 42, 'P', 5, 'ppt'],
    swiftNew: [82, 5700, 112, 4300, 4300, 6300, 925, [3.545, 1.904, 1.28, 0.966, 0.757], 4.29, 0.29, 0.64, 'f', 'mt', 12.3, 170, 0, 37, 'P', 5, 'ppt'],
    dzire:    [82, 5700, 112, 4300, 4300, 6300, 960, [3.545, 1.904, 1.28, 0.966, 0.757], 4.29, 0.29, 0.63, 'f', 'mt', 12.9, 170, 0, 37, 'P', 5, 'ppt'],
    innova:   [102, 3600, 200, 1400, 3400, 4400, 1680, D5, 4.3, 0.34, 0.95, 'r', 'mt', 16.5, 155, 0, 55, 'D', 8, 'pet'],
    crysta:   [150, 3400, 343, 1400, 2800, 4200, 1800, [3.6, 2.09, 1.49, 1, 0.73, 0.58], 3.909, 0.36, 1.05, 'r', 'mt', 12.8, 175, 0, 65, 'D', 7, 'ppt'],
    bolero:   [76, 3600, 210, 1600, 2200, 4200, 1615, D5, 4.1, 0.36, 1.4, 'r', 'mt', 21, 125, 0, 60, 'D', 7, 'pet'],
    scorpio:  [132, 3750, 300, 1600, 2800, 4400, 1850, D6, 3.73, 0.37, 1.32, 'r', 'mt', 13.5, 160, 0, 60, 'D', 7, 'pet'],
    scorpioN: [175, 3750, 400, 1750, 2750, 4500, 1980, D6, 3.73, 0.39, 1.18, 'r', 'mt', 10.8, 185, 0, 57, 'D', 7, 'pet'],
    safari:   [156, 4000, 400, 1700, 2700, 4600, 2050, D5, 3.54, 0.38, 1.26, 'r', 'mt', 13, 165, 0, 63, 'D', 7, 'pet'],
    sumo:     [85, 3000, 250, 1600, 2000, 3600, 1820, D5, 3.9, 0.36, 1.45, 'r', 'mt', 21, 125, 0, 65, 'D', 9, 'pet'],
    suv:      [140, 3750, 320, 1600, 2800, 4400, 1750, D6, 3.73, 0.37, 1.2, 'r', 'mt', 12.5, 165, 0, 60, 'D', 7, 'eee'],
    fortuner: [204, 3400, 500, 1600, 2800, 4400, 2150, [3.6, 2.09, 1.49, 1.2, 1, 0.79], 3.727, 0.39, 1.25, 'a', 'at', 10.4, 190, 0, 80, 'D', 7, 'ppt'],
    defender: [350, 4000, 700, 1500, 3000, 4800, 2400, [4.71, 3.14, 2.11, 1.67, 1.29, 1, 0.84, 0.67], 3.31, 0.39, 1.3, 'a', 'at', 6.4, 191, 1, 90, 'D', 7, 'ppt'],
    gclass: [585, 6000, 850, 2500, 3500, 6800, 2560, [5.35, 3.24, 2.25, 1.64, 1.21, 1, 0.87, 0.72, 0.6], 3.15, 0.41, 1.25, 'a', 'at', 4.5, 220, 1, 100, 'P', 5, 'pet'],
    landCruiser: [309, 4000, 700, 1600, 2600, 4600, 2630, [4.92, 3.15, 2.35, 1.88, 1.46, 1.19, 1, 0.79, 0.64, 0.6], 3.31, 0.41, 1.3, 'a', 'at', 6.9, 210, 1, 110, 'D', 7, 'ppt'],
    thar:     [132, 3750, 300, 1600, 2800, 4400, 1750, D6, 3.73, 0.38, 1.4, 'a', 'mt', 12.9, 155, 0, 57, 'D', 4, 'pet'],
    tharRoxx: [175, 3500, 370, 1750, 2500, 4400, 1950, D6, 3.73, 0.39, 1.42, 'a', 'mt', 10.8, 165, 1, 57, 'D', 5, 'pet'],
    hector:   [143, 5000, 250, 1600, 3600, 6000, 1560, [3.73, 2.05, 1.32, 0.97, 0.76, 0.63], 4.4, 0.36, 0.98, 'f', 'mt', 11.8, 190, 0, 60, 'P', 5, 'pet'],
    ace:      [20, 3200, 45, 1800, 2200, 3800, 900, [4.9, 2.5, 1.5, 1], 4.4, 0.28, 1.5, 'r', 'mt', 0, 85, 1, 30, 'D', 2, 'pee'],
    auto:     [11, 5000, 19, 4000, 4000, 6000, 360, [4.1, 2.4, 1.6, 1.1], 5.5, 0.21, 1.4, 'r', 'mt', 0, 65, 0, 8, 'P', 3, 'pee'],
    tractor:  [47, 2100, 200, 1400, 1400, 2300, 2100, [10, 5, 2.6], 5.2, 0.68, 2.8, 'r', 'mt', 0, 30, 1, 60, 'D', 1, 'pee'],
    lorry:    [160, 2400, 590, 1400, 1700, 2700, 11000, [7.3, 4.2, 2.6, 1.6, 1.0, 0.78], 4.9, 0.5, 6.5, 'r', 'mt', 0, 85, 1, 200, 'D', 2, 'eee'],
    bus:      [150, 2500, 500, 1400, 1800, 2800, 9500, [6.7, 3.8, 2.3, 1.4, 1, 0.8], 5.3, 0.5, 6.2, 'r', 'mt', 0, 90, 1, 180, 'D', 50, 'eee'],
    // two-wheelers: "final" folds in the primary reduction and the chain. kg is the kerb figure, a 75 kg rider is added
    bike:     [8, 8000, 8.05, 6000, 6000, 8800, 112, B4, 0, 0.3, 0.55, 'b', 'mt', 0, 90, 0, 10, 'P', 2, 'pee'],
    splendor: [8, 8000, 8.05, 6000, 6000, 8800, 112, B4, 0, 0.3, 0.55, 'b', 'mt', 0, 90, 0, 10, 'P', 2, 'pee'],
    starCity: [8.2, 7350, 8.7, 4500, 4500, 8500, 116, B4, 0, 0.3, 0.55, 'b', 'mt', 0, 90, 0, 10, 'P', 2, 'pee'],
    scooter:  [7.9, 7500, 8.8, 5500, 5500, 8500, 108, [3.0, 1.0], 0, 0.23, 0.52, 'b', 'cvt', 0, 82, 0, 6, 'P', 2, 'eee'],
    activa:   [7.8, 8000, 9, 5500, 5500, 8500, 106, [3.0, 1.0], 0, 0.23, 0.52, 'b', 'cvt', 0, 85, 0, 5.3, 'P', 2, 'pee'],
    classic:  [20.2, 6100, 27, 4000, 4000, 7000, 195, B5, 0, 0.32, 0.62, 'b', 'mt', 15, 114, 0, 13, 'P', 2, 'pee'],
    classic2: [19.8, 5250, 28, 4000, 4000, 6000, 192, B5, 0, 0.32, 0.62, 'b', 'mt', 15.5, 112, 0, 13.5, 'P', 2, 'pee'],
    sport:    [20.9, 8500, 18.5, 7000, 7000, 9800, 155, [2.83, 1.875, 1.36, 1.14, 0.955], 0, 0.31, 0.44, 'b', 'mt', 9.5, 135, 0, 15, 'P', 2, 'eee'],
    faired:   [18.4, 10000, 14.2, 7500, 7500, 11500, 142, [2.83, 1.875, 1.36, 1.14, 0.955, 0.84], 0, 0.3, 0.34, 'b', 'mt', 10.5, 140, 0, 11, 'P', 2, 'pet'],
    hayabusa: [190, 9700, 150, 7000, 7000, 10800, 264, [2.615, 1.937, 1.526, 1.285, 1.136, 1.043], 3.82, 0.32, 0.36, 'b', 'mt', 3.2, 299, 1, 20, 'P', 2, 'ppp'],
    s1000rr:  [210, 13750, 113, 11000, 11000, 14600, 197, [2.647, 2.091, 1.727, 1.5, 1.36, 1.261], 4.37, 0.32, 0.32, 'b', 'mt', 3.1, 300, 1, 16.5, 'P', 2, 'ppp'],
    r1250gsa: [136, 7750, 143, 6250, 6250, 9000, 268, B6, 0, 0.34, 0.72, 'b', 'mt', 3.9, 200, 1, 30, 'P', 2, 'pep'],
    r1300gsa: [145, 7750, 149, 6500, 6500, 9000, 269, B6, 0, 0.34, 0.7, 'b', 'mt', 3.7, 220, 1, 30, 'P', 2, 'pep'],
    // invented cars carrying the figures of the real class leader they resemble
    berlinetta: [720, 7000, 770, 3250, 3250, 8000, 1435, [3.08, 2.19, 1.63, 1.29, 1.03, 0.84, 0.63], 5.0, 0.35, 0.75, 'r', 'dct', 2.9, 320, 1, 78, 'P', 2, 'eee'],
    muscle:   [486, 7000, 556, 4250, 4250, 7500, 1750, [3.66, 2.43, 1.69, 1.32, 1, 0.65], 3.73, 0.35, 0.86, 'r', 'mt', 4.4, 250, 1, 61, 'P', 4, 'eee'],
    wedge:    [640, 8000, 600, 6500, 6500, 8500, 1422, [3.13, 2.05, 1.5, 1.2, 0.97, 0.8, 0.65], 4.75, 0.35, 0.72, 'a', 'dct', 2.9, 325, 1, 90, 'P', 2, 'eee'],
    coupe911: [450, 6500, 530, 2300, 5000, 7500, 1515, [3.91, 2.29, 1.65, 1.3, 1.0, 0.84, 0.72, 0.62], 3.36, 0.35, 0.66, 'r', 'dct', 3.6, 300, 0, 64, 'P', 4, 'eee'],
  };
  // Figures below were read online for this build (Nov 2026 session). Each row overrides the table above; urls are shown in
  // the showroom. A group not found stays from the table and is tagged ESTIMATED: memory figures no longer count as sources.
  // price: ex-showroom rupees, usually the bottom of a model-wide range or a launch price, so still approximate.
  // g: 1 if power+torque were found, kg/t100/vmax: the found values only. d: date or scope note on the price.
  const SRC = {
    alto: { ps: 48, nm: 69, kg: 730, tank: 35, t100: 19, vmax: 140, d: 'Alto 800, price not found', u: ['https://www.cardekho.com/details/Maruti_Alto_800_LXI', 'https://motorbeam.com/?p=57934'] },
    wagonR: { ps: 90, rp: 6000, nm: 113, rt0: 4400, rt1: 4400, kg: 845, price: 499000, d: 'model range from, New Delhi', u: ['https://www.cardekho.com/maruti/wagon-r/specs'] },
    swift: { ps: 85, rp: 6000, nm: 113, rt0: 4500, rt1: 4500, d: 'forum source only, discontinued', u: ['https://www.team-bhp.com/forum/indian-car-scene/66147-swift-k-series-engine-update-launched-8.html'] },
    swiftNew: { ps: 83, rp: 5700, nm: 112.4, rt0: 4500, rt1: 4500, kg: 925, tank: 37, t100: 13, vmax: 160, price: 584000, d: 'model range from, New Delhi', u: ['https://www.cardekho.com/maruti/swift/specs', 'https://autocarindia.com/car-reviews-amp/maruti-swift-road-test-review-432976/tech-specs', 'https://thecarjury.pages.dev/reviews/maruti/swift/'] },
    dzire: { ps: 83, rp: 5700, nm: 112.4, rt0: 4500, rt1: 4500, kg: 960, tank: 37, price: 631000, d: 'model range from, New Delhi', u: ['https://www.zigwheels.com/maruti-suzuki-cars/dzire/specifications', 'https://www.cardekho.com/maruti/dzire/specs'] },
    innova: { ps: 102, rp: 3600, nm: 200, kg: 1665, tank: 55, d: 'torque sources conflict, 200 vs 260 Nm', u: ['https://auto-data.net/en/toyota-innova-i-2.5-d-4d-102hp-3436'] },
    crysta: { ps: 150, rp: 3400, nm: 343, rt0: 1400, rt1: 2800, tank: 55, vmax: 170, price: 1995000, d: 'model range from, New Delhi', u: ['https://www.cardekho.com/toyota/innova-crysta/specs', 'https://autocarindia.com/car-reviews/2020-toyota-innova-crysta-24d-at-review-test-drive-418153'] },
    bolero: { ps: 76, rp: 3600, nm: 210, rt0: 1600, rt1: 2200, kg: 1620, tank: 60, vmax: 125, price: 857000, d: 'model range from, New Delhi', u: ['https://www.cardekho.com/mahindra/bolero/specs', 'https://www.team-bhp.com/new-cars/mahindra/bolero/specifications/', 'https://www.bajajfinserv.in/mahindra-bolero-top-speed'] },
    scorpio: { ps: 132, rp: 3750, nm: 300, rt0: 1600, rt1: 2800, tank: 60, t100: 14, vmax: 165, price: 1343000, d: 'model range from, New Delhi', u: ['https://www.cardekho.com/mahindra/scorpio/specs'] },
    scorpioN: { ps: 175, rp: 3500, nm: 400, rt0: 1750, rt1: 2750, kg: 1885, tank: 57, t100: 11.2, vmax: 165, price: 1369000, d: 'range from includes petrol; 0-100 may be mixed up with the Roxx test', u: ['https://www.cardekho.com/mahindra/scorpio-n/specs', 'https://www.team-bhp.com/new-cars/mahindra/scorpio-n/specifications/', 'https://zigwheels.com/news-features/general-news/mahindra-thar-roxx-vs-scorpio-n-which-diesel-4x2-mahindra-suv-is-quicker/54329/?is_amp=1'] },
    safari: { ps: 156, nm: 400, price: 1352000, d: 'launch price, discontinued; 6-speed per source', u: ['https://www.cartrade.com/news/tata-safari-storme-varicor-400-launched-for-rs-13-52-lakh-130662.html'] },
    sumo: { ps: 85, nm: 250, rt0: 1000, rt1: 2000, tank: 65, price: 752000, d: 'last listed, discontinued; weight sources conflict', u: ['https://www.cardekho.com/overview/Tata_Sumo/Tata_Sumo_Gold_CX.htm'] },
    fortuner: { ps: 204, rp: 3400, nm: 500, rt0: 1620, rt1: 2820, tank: 80, t100: 13.25, vmax: 190, price: 3511000, d: 'model range from, New Delhi; 0-100 from a 2021 listing', u: ['https://www.cardekho.com/toyota/fortuner/specs'] },
    landCruiser: { ps: 309, rp: 4000, nm: 700, rt0: 1600, rt1: 2600, tank: 110, price: 21800000, d: 'source weight 2900 and top speed 165 look wrong, not used', u: ['https://www.cardekho.com/toyota/land-cruiser-300/specs'] },
    thar: { ps: 152, rp: 3750, nm: 330, rt0: 1500, rt1: 3000, tank: 55, price: 1032000, d: 'Thar OG listing, may be a newer tune than this model', u: ['https://www.cardekho.com/mahindra/thar/specs'] },
    tharRoxx: { ps: 174, rp: 3500, nm: 400, rt0: 1750, rt1: 2750, kg: 1888, tank: 57, t100: 11.2, vmax: 155, price: 1252000, d: '0-100 from the 4x2 diesel AT', u: ['https://www.cardekho.com/mahindra/thar-roxx/specs', 'https://zigwheels.com/news-features/general-news/real-world-performance-test-how-quick-is-the-mahindra-thar-roxx-4x2-diesel-automatic/54309/?is_amp=1'] },
    hector: { ps: 143, rp: 5200, nm: 250, tank: 60, t100: 11.9, price: 1214000, d: 'model range from; tested car is a CVT, game car a manual', u: ['https://www.cardekho.com/mg/hector/specs', 'https://www.autocarindia.com/car-reviews/mg-hector-cvt-review-real-world-fuel-economy-tested-425246'] },
    ace: { ps: 20, rp: 3600, nm: 45, rt0: 1800, rt1: 2000, kg: 930, vmax: 60, price: 399000, d: 'listing, mixed variants', u: ['https://ace.tatamotors.com/mr/specifications/tata-ace-gold-diesel-brochure.pdf', 'https://trucksbuses.com/scv/pickups-and-mini-trucks/tata-ace-gold/specifications'] },
    auto: { ps: 10.3, nm: 19.2, rt0: 3250, rt1: 3250, kg: 355, tank: 8, vmax: 65, price: 227000, d: 'petrol, listing sites', u: ['https://www.trucksbuses.com/web-stories/bajaj-re-petrol-auto-rickshaw-specifications', 'https://tractorkarvan.com/commercial-vehicle/bajaj/auto-rickshaw/re/petrol'] },
    tractor: { ps: 46, nm: 179, kg: 1860, tank: 47, price: 665000, d: '2023 Delhi', u: ['https://merikheti.com/en/tractor/mahindra-575-di', 'https://www.drivespark.com/tractors/mahindra/575-di/'] },
    splendor: { ps: 8, rp: 8000, nm: 8.05, rt0: 6000, rt1: 6000, kg: 112, tank: 9.8, vmax: 87, price: 76180, d: 'Delhi', u: ['https://www.autocarindia.com/bikes/hero-motocorp/splendor-plus/specifications', 'https://carhp.in/bikes/hero/splendor-plus/price-in-delhi'] },
    starCity: { ps: 8.2, rp: 7350, nm: 8.7, rt0: 4500, rt1: 4500, kg: 115, tank: 10, vmax: 90, price: 74813, d: 'BikeWale mono tone', u: ['https://www.team-bhp.com/new-bikes/tvs/star-city-plus/specifications/', 'https://bikewale.com/tvs-bikes/star-city-plus'] },
    activa: { ps: 8, rp: 8000, nm: 9.05, rt0: 5500, rt1: 5500, kg: 105, tank: 5.3, price: 75960, d: 'range from, Delhi', u: ['https://www.autocarindia.com/bikes/honda-bikes/activa-6g/specifications', 'https://www.autocarindia.com/bikes/honda-bikes/activa-6g/price-in-delhi'] },
    classic: { ps: 20.5, rp: 6100, nm: 27, rt0: 4000, rt1: 4000, kg: 195, tank: 13, vmax: 120, price: 197000, d: 'range from, Chennai', u: ['https://motorbeam.com/?p=313963', 'https://www.91wheels.com/bikes/royalenfield/classic-350/specifications'] },
    classic2: { ps: 19.4, rp: 5250, nm: 28, rt0: 4000, rt1: 4000, d: '2020 listing, sources differ on power', u: ['https://bikewale.com/royalenfield-bikes/classic-350/specifications-features'] },
    sport: { ps: 21.2, rp: 8500, nm: 18.55, rt0: 7000, rt1: 7000, kg: 160, tank: 15, vmax: 136, price: 128000, d: 'Pulsar 220F', u: ['https://www.autocarindia.com/bikes/bajaj/pulsar-220f/specifications'] },
    faired: { ps: 18.4, rp: 10000, nm: 14.2, rt0: 7500, rt1: 7500, kg: 141, tank: 11, price: 171100, d: 'range from, Delhi', u: ['https://www.autocarindia.com/bikes/yamaha/yzf-r15-v4/specifications', 'https://www.bajajfinserv.in/hindi/bmall/bikes/yamaha-r15-v4'] },
    hayabusa: { ps: 190, rp: 9700, nm: 150, rt0: 7000, rt1: 7000, kg: 266, vmax: 299, price: 1899000, d: 'Delhi, latest report', u: ['https://bikedekho.com/suzuki/hayabusa/specifications?amp=1', 'https://www.1000ps.com/en-gb/comparison/419617/bmw-s-1000-rr-2025-vs-suzuki-hayabusa-2025'] },
    s1000rr: { ps: 209, rp: 13750, nm: 113, rt0: 11000, rt1: 11000, kg: 197, tank: 16.5, t100: 3.2, vmax: 303, price: 2325000, d: 'other listings 20.75-27.62 lakh', u: ['https://www.autocarindia.com/bikes/bmw-bikes/s-1000-rr/standard', 'https://www.91wheels.com/bikes/bmw/s-1000-rr/specifications'] },
    r1250gsa: { ps: 136, rp: 7750, nm: 143, kg: 268, tank: 30, price: 2250000, d: 'Delhi, marked discontinued on one listing', u: ['https://91wheels.com/bikes/bmw/r-1250-gs-adventure/specifications'] },
    r1300gsa: { ps: 145.5, rp: 7750, nm: 149, rt0: 6500, rt1: 6500, kg: 269, tank: 30, vmax: 220, price: 2575000, d: 'range from', u: ['https://bmw-motorrad.in/en/models/adventure/r1300gs-adventure/technicaldata.html', 'https://www.zigwheels.com/bmw-bikes/r-1300-gs-adventure/specifications'] },
    berlinetta: { ps: 720, rp: 7000, nm: 770, rt0: 3250, rt1: 3250, tank: 78, t100: 2.9, vmax: 340, price: 40200000, d: 'reference car, launch-era price', u: ['https://www.carwale.com/ferrari-cars/f8-tributo/', 'https://www.motorbeam.com/ferrari-f8-tributo-launched-priced-at-rs-4-08-crores/'] },
    muscle: { ps: 401, nm: 515, kg: 1770, t100: 4.8, vmax: 250, price: 6500000, d: 'reference car, 2016 launch', u: ['https://www.drivespark.com/four-wheelers/2016/ford-mustang-india-launch-price-specifications-015751.html'] },
    wedge: { ps: 640, rp: 8000, nm: 600, kg: 1422, tank: 83, t100: 2.9, vmax: 325, price: 37300000, d: 'reference car, 2019 launch', u: ['https://ultimatespecs.com/car-specs/Lamborghini/131144/Lamborghini-Huracan-Evo-52-V10.html', 'https://autocarindia.com/car-news/lamborghini-huracan-evo-launched-in-india-priced-at-rs-373-crore-411433'] },
    coupe911: { ps: 450, nm: 530, kg: 1515, t100: 3.7, vmax: 308, price: 18200000, d: 'reference car, 2019 launch', u: ['https://www.autocarindia.com/car-news-amp/new-porsche-911-launched-in-india-at-rs-182-crore-412293'] },
  };
  SRC.bike = SRC.splendor;
  const FIELD = { ps: 0, rp: 1, nm: 2, rt0: 3, rt1: 4, kg: 6, t100: 13, vmax: 14, tank: 16 };
  for (const k in SRC) if (PW[k]) { for (const f in FIELD) if (SRC[k][f] !== undefined) PW[k][FIELD[f]] = SRC[k][f]; const q = SRC[k];
    PW[k][19] = ((q.ps && q.nm) ? 'v' : 'e') + 'e' + ((q.t100 || q.vmax) ? 'v' : 'e'); PW[k].kgOK = q.kg !== undefined; }
  PW.safari[7] = D6;                                  // source: 6-speed
  for (const k in PW) if (!SRC[k]) { PW[k][19] = 'eee'; PW[k].kgOK = false; }
  const ALIAS = { mpv: 'innova', fortunerBlack: 'fortuner', hilux: 'fortuner', crysta2023: 'crysta' };   // hilux: same 2.8 diesel and gearbox
  const srcName = { v: 'sourced online', e: 'ESTIMATED' };
  const PS_KW = 0.7355, RHO = 1.2, kmh = 3.6;
  function ptSpec(type) {
    const key = PW[type] ? type : ALIAS[type]; if (!key) return null;
    const c = ptSpec.cache || (ptSpec.cache = {}); if (c[key]) return c[key];
    const r = PW[key], two = r[11] === 'b', gears = r[7], cvt = r[12] === 'cvt';
    const s = { key, ps: r[0], kw: r[0] * PS_KW, rp: r[1], nm: r[2], rt0: r[3], rt1: r[4], red: r[5], kg: r[6], gears, final: r[8], R: r[9], cda: r[10], drv: r[11], box: r[12], t100: r[13] || null, vmax: r[14], lim: !!r[15], tank: r[16], fuel: r[17], seats: r[18], src: { engine: srcName[r[19][0]], gearing: srcName[r[19][1]], perf: srcName[r[19][2]], weight: r.kgOK ? 'sourced online' : 'ESTIMATED', links: (SRC[key] && SRC[key].u) || [], note: (SRC[key] && SRC[key].d) || '', price: SRC[key] && SRC[key].price }, two, cvt, diesel: r[17] === 'D', idle: r[5] > 7000 ? 1300 : r[17] === 'D' ? 750 : 850 };
    s.Ie = 0.00012 * s.nm * (two ? 0.1 : 1) + 0.008;
    if (!s.final) { const last = cvt ? gears[1] : gears[gears.length - 1]; s.final = (s.rp * 1.06 * 2 * Math.PI / 60 * s.R) / (s.vmax / kmh) / last; }
    s.eff = { mt: 0.88, at: 0.8, dct: 0.89, cvt: 0.78 }[s.box];
    s.shiftT = two ? 0.11 : { mt: 0.48, at: 0.14, dct: 0.04, cvt: 0 }[s.box];
    const toTon = s.ps / (s.kg / 1000);
    s.mu = two ? (s.cda > 0.6 && toTon > 300 ? 1.0 : toTon > 300 ? 1.2 : 1.05) : toTon > 200 ? 1.3 : toTon > 120 ? 1.12 : 1;   // performance tyres
    s.axle = { f: 0.54, r: toTon > 400 ? 0.97 : toTon > 280 ? 0.8 : toTon > 200 ? 0.68 : 0.6, a: 0.98, b: 0.9 }[s.drv];              // weight on the driven tyres under power
    return c[key] = s;
  }
  // full-throttle torque; mods.pw scales the whole curve (a tune lifts the band, it does not move it)
  function torque(s, rpm) {
    const pk = s.nm, Tp = s.kw * 9549 / s.rp;
    let T;
    if (rpm < s.rt0) T = pk * (0.62 + 0.38 * Math.max(0, (rpm - s.idle) / Math.max(1, s.rt0 - s.idle)));
    else if (rpm <= s.rt1) T = pk;
    else if (rpm <= s.rp) T = pk + (Math.min(pk, Tp) - pk) * (rpm - s.rt1) / Math.max(1, s.rp - s.rt1);
    else T = Math.min(pk, Tp) * (1 - 0.32 * Math.min(1, (rpm - s.rp) / Math.max(1, s.red - s.rp)));
    return T;
  }
  const newPT = s => ({ s, gear: 0, rpm: s.idle, shift: 0, throttle: 0, mods: { pw: 1, mass: 0, grip: 1, top: 1 }, cond: 1, fuel: 0.72, slip: false });
  function ptFor(v, type) {
    if (v._pt) return v._pt;
    const s = ptSpec(type); return s ? (v._pt = newPT(s)) : null;
  }
  // one step. input: gas 0..1, mu surface friction seen by the tyres, crr rolling resistance, extraKg towed mass.
  // Returns the longitudinal acceleration (m/s^2) for forward travel, v >= 0. Writes rpm / gear / slip.
  function ptStep(P, v, gas, mu, crr, extraKg, dt) {
    const s = P.s, M = P.mods, m = s.kg + (s.two ? 75 : 80) + M.mass + (extraKg || 0), ws = v / s.R * 60 / (2 * Math.PI);
    P.throttle += (gas - P.throttle) * Math.min(1, dt * (gas > P.throttle ? 8 : 12));
    const th = P.throttle > 0.02 ? P.throttle : 0;
    let ratio, launch = Math.min(s.rt0 * (s.diesel ? 1.05 : 0.95), s.rp * 0.78), slipping;
    if (s.cvt) {
      const want = (s.rp * 0.92) / Math.max(1, ws * s.final);
      ratio = th ? Math.max(s.gears[1], Math.min(s.gears[0], want)) : s.gears[1];
    } else {
      P.shift = Math.max(0, P.shift - dt);
      const g = s.gears, n = g.length;
      if (P.gear >= n) P.gear = n - 1;
      if (P.shift === 0) {
        const r0 = ws * g[P.gear] * s.final;
        if (P.gear < n - 1) {
          const r1 = ws * g[P.gear + 1] * s.final;
          // wheel force in this gear against the next: change up where the next one pulls harder, or at the limiter
          const up = th ? (r0 >= s.red - 40 || (r0 > s.rt1 && torque(s, r1) * g[P.gear + 1] > torque(s, r0) * g[P.gear])) : r0 > Math.max(s.rt0 * 1.3, s.idle * 2.6);
          if (up) { P.gear++; P.shift = s.shiftT; }
        }
        if (P.gear > 0 && P.shift === 0) {
          const dn = ws * g[P.gear - 1] * s.final;
          if (dn < s.red * 0.9 && r0 < (th ? Math.max(s.rt0 * 0.85, s.idle * 1.6) : s.idle * 1.4)) { P.gear--; P.shift = s.shiftT * 0.6; }
        }
      }
      ratio = g[P.gear];
    }
    const wheelRpm = ws * ratio * s.final;
    slipping = wheelRpm < launch && th > 0;
    let rpm = Math.max(s.idle, slipping ? launch + (wheelRpm - launch) * 0.25 : wheelRpm);
    if (s.box === 'at' && !slipping && P.gear === 0 && th) rpm = Math.max(rpm, s.rt0 * 1.1);
    P.rpm += (Math.min(s.red, rpm) - P.rpm) * Math.min(1, dt * 14);
    let T = torque(s, Math.min(s.red, rpm)) * th * M.pw;
    if (wheelRpm >= s.red - 10) T = 0;                                             // rev limiter
    if (P.cond < 1) T *= 0.6 + 0.4 * P.cond;                                       // a battered engine down on power
    if (P.fuel <= 0) T *= 0.15;                                                    // tank dry: reserve limp home, no soft lock
    if (s.box === 'at' && slipping) T *= 1.35;                                      // torque converter multiplication
    const shifting = P.shift > (s.box === 'at' ? 0.09 : 0) && !s.cvt;
    let F = shifting ? 0 : T * ratio * s.final * s.eff / s.R;
    // engine braking off throttle, in gear above a walking pace
    if (!th && v > 2) F -= 0.14 * s.nm * (0.35 + 0.65 * Math.min(1, wheelRpm / s.red)) * ratio * s.final / s.R;
    // tyres: a wheelie / stoppie limit on two-wheelers, weight transfer is folded into the axle share
    const limit = mu * s.mu * M.grip * m * g * s.axle;
    P.slip = F > limit; if (F > limit) F = limit;
    const drag = 0.5 * RHO * s.cda * v * v + (crr === undefined ? 0.014 : crr) * m * g * (v > 0.05 ? 1 : 0);
    const mEff = m * 1.03 + s.Ie * Math.pow(ratio * s.final / s.R, 2);
    let a = (F - drag) / mEff;
    const cap = (M.limit || (s.lim ? s.vmax : 0)) / kmh;
    if (cap && v >= cap) a = Math.min(a, 0);
    // fuel at the real rate: engine work over thermal efficiency, plus idle
    const Pe = Math.max(0, F > 0 ? F * v : 0) / s.eff + s.kw * 25;
    P.fuel = Math.max(0, P.fuel - Pe / (s.diesel ? 0.36 : 0.29) / (s.diesel ? 36e6 : 32e6) / s.tank * dt);
    return a;
  }
  // bench run on a flat tarmac road: figures for the showroom card and the regression test
  function bench(type, mods) {
    const s = ptSpec(type); if (!s) return null;
    const P = newPT(s); if (mods) Object.assign(P.mods, mods);
    let v = 0, t = 0, t60 = null, t100 = null, q = null, x = 0, best = 0, stall = 0; const h = 1 / 120;
    for (let i = 0; i < 120 * 200; i++) {
      const a = ptStep(P, v, 1, 0.95, 0.014, 0, h); P.fuel = 1;
      v = Math.max(0, v + a * h); x += v * h; t += h;
      if (t60 === null && v * kmh >= 60) t60 = t; if (t100 === null && v * kmh >= 100) t100 = t; if (q === null && x >= 402) q = t;
      if (v > best + 0.001) { best = v; stall = 0; } else if ((stall += h) > 6) break;
    }
    const r1 = n => n === null ? null : Math.round(n * 10) / 10;
    return { t60: r1(t60), t100: r1(t100), q: r1(q), top: Math.round(best * kmh) };
  }
  // The one gauge source: HUD, needles, LCDs and engine sound all read window.Drive, filled once a frame from the real
  // gearbox state (powertrain, or the Crysta's own model in index.html). Needles smooth here, so they all agree.
  const Drive = window.Drive = { speed: 0, rawSpeed: 0, gear: '-', rpm: 0, rawRpm: 0, idle: 0, red: 0, range: 0, shifting: false, engine: false };
  function readout(dt, mode, active, crysta, kmh, reversing) {
    const P = mode === 'vehicle' && active ? active._pt : null, s = P && P.s, isC = mode === 'crysta';
    let raw = 0, idle = 0, red = 0, gear = '-', shifting = false;
    if (isC) { raw = crysta.rpm; idle = crysta.idle; red = crysta.red; gear = reversing ? 'R' : String(crysta.gear); shifting = crysta.shifting; }
    else if (s) {
      idle = s.idle; red = s.red; shifting = !s.cvt && P.shift > 0; raw = P.rpm; gear = reversing ? 'R' : s.cvt ? 'D' : String(P.gear + 1);
      if (reversing) raw = Math.max(idle, Math.min(red, Math.abs(kmh) / 3.6 / s.R * 60 / (2 * Math.PI) * (s.cvt ? s.gears[0] : s.gears[0]) * s.final));
    }
    const k = Math.min(1, dt * 16), sp = Math.abs(kmh);
    Drive.rawRpm = raw; Drive.rawSpeed = sp; Drive.rpm += (raw - Drive.rpm) * k; Drive.speed += (sp - Drive.speed) * k;
    if (!red) Drive.rpm = 0;
    Drive.idle = idle; Drive.red = red; Drive.gear = gear; Drive.shifting = shifting; Drive.engine = !!red;
    Drive.range = red ? Math.max(0, Math.min(1, (raw - idle) / (red - idle))) : 0;
    return Drive;
  }
  // PARAMS rows take name-independent numbers from the table: top speed, ratio count
  function applySpecs(PARAMS) {
    for (const k in PARAMS) { const s = ptSpec(k); if (!s) continue; PARAMS[k].top = s.vmax; PARAMS[k].gears = s.cvt ? 1 : s.gears.length; PARAMS[k].ps = s.ps; }
    return PARAMS;
  }

  // ---------------------------------------------------------------- pin-hitch trailer (exact tractrix, no sideways tyre slip)
  // The trailer axle is dragged by the hitch along the drawbar direction. Going forward the angle decays; in reverse
  // the same equation is unstable, so a trailer folds up unless the driver steers it: that IS the real behaviour.
  const JACK = 1.4;     // about 80 deg: drawbar meets the tractor's mudguards
  function hitchState(v) {
    const tg = v.trailer; if (!tg) return null;
    return v._tr || (v._tr = { hz: tg.position.z, bar: tg.userData.bar || 2.55, ax: null, az: 0, rel: 0, jack: false });
  }
  function trail(v, x, z, rot) {
    const T = hitchState(v); if (!T) return null;
    const sn = Math.sin(rot), cs = Math.cos(rot), hx = x + sn * T.hz, hz = z + cs * T.hz;
    if (T.ax === null || Math.hypot(hx - T.ax, hz - T.az) > T.bar * 1.6) { T.ax = hx - sn * T.bar; T.az = hz - cs * T.bar; }   // first frame / teleport
    let dx = hx - T.ax, dz = hz - T.az; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    T.ax = hx - dx * T.bar; T.az = hz - dz * T.bar;
    let rel = Math.atan2(dx, dz) - rot; rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    T.jack = Math.abs(rel) >= JACK;
    if (T.jack) { rel = Math.sign(rel) * JACK; const th = rot + rel; T.ax = hx - Math.sin(th) * T.bar; T.az = hz - Math.cos(th) * T.bar; }
    T.rel = rel; v.trailer.rotation.y = rel;
    return T;
  }

  // ---------------------------------------------------------------- audio levels (Settings sliders)
  const load = (k, d) => { try { const n = parseFloat(localStorage.getItem(k)); return isFinite(n) ? n : d; } catch (e) { return d; } };
  const ENGINE_TRIM = 0.5;                         // about -6 dB on every engine voice: the mix was too loud
  const Audio = { master: load('nellutla.volMaster', 0.85), engine: load('nellutla.volEngine', 0.7), listeners: [],
    get engineGain() { return ENGINE_TRIM * this.engine * this.master / 0.595; },   // default sliders = exactly ENGINE_TRIM
    get fxGain() { return this.master / 0.85; },
    set(k, val) { this[k] = val; try { localStorage.setItem(k === 'master' ? 'nellutla.volMaster' : 'nellutla.volEngine', val); } catch (e) {} this.listeners.forEach(f => f()); } };
  window.GameAudio = Audio;

  return { SPEC: S, make, forVehicle, steer, cornering, bike, wheelAngle, trail, hitchState, JACK, POWER: PW, readout, ptSpec, ptFor, ptStep, torque, bench, applySpecs };
})();
