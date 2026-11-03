"""Build nellutla-map/map-data.js from real geodata.

Inputs (in DATA_DIR, see tools/README.md for how they were fetched):
  buildings.csv  - Overture Maps building footprints (WKT, lon/lat)
  segments.csv   - Overture Maps transportation segments (OSM + ML roads)
  water.csv      - Overture Maps water features
  mosaic18.jpg   - satellite reference mosaic, zoom 18, tiles X0..,Y0..
  traced.json    - lanes/tracks hand-traced from the imagery (mosaic pixel coords)

World frame: 1 unit = 1 metre, +x = east, +z = south, origin = village junction.
"""
import base64, csv, io, json, math, random, re, sys
import numpy as np
import cv2
from PIL import Image

csv.field_size_limit(10**9)
DATA = sys.argv[1]
OUT = sys.argv[2]

Z, X0, Y0 = 18, 188731, 117963
LAT0, LON0 = 17.70160, 79.19630          # NH-365B / Lingala Ghanpur road junction
MX = 111320.0 * math.cos(math.radians(LAT0))
MZ = 110574.0

def ll2w(lon, lat):
    return ((lon - LON0) * MX, -(lat - LAT0) * MZ)

def px2ll(px, py):
    n = 2 ** Z * 256
    lon = (X0 * 256 + px) / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (Y0 * 256 + py) / n))))
    return lon, lat

def ll2px(lon, lat):
    n = 2 ** Z * 256
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x - X0 * 256, y - Y0 * 256

def px2w(px, py):
    return ll2w(*px2ll(px, py))

def parts(wkt):
    return [[tuple(map(float, p.split())) for p in part.split(',')]
            for part in re.findall(r'\(([^()]+)\)', wkt)]

def r1(v):
    return round(v, 1)

mosaic = cv2.imread(f'{DATA}/mosaic18.jpg')       # BGR
H, W = mosaic.shape[:2]
xmin, zmin = px2w(0, 0)
xmax, zmax = px2w(W, H)
bounds = [r1(xmin), r1(zmin), r1(xmax), r1(zmax)]

def inside(x, z, pad=0):
    return xmin - pad <= x <= xmax + pad and zmin - pad <= z <= zmax + pad

rng = random.Random(1707)

# ---------------------------------------------------------------- roads
roads = []
for r in csv.DictReader(open(f'{DATA}/segments.csv')):
    cls = r['class']
    for line in parts(r['wkt']):
        pts = [ll2w(*p) for p in line]
        if not any(inside(x, z) for x, z in pts):
            continue
        if cls == 'trunk':
            t, w = 'highway', 7.5
        elif cls == 'trunk_link':
            t, w = 'highway', 6.0
        elif cls == 'tertiary':
            t, w = 'tar', 6.0
        elif cls in ('residential', 'unclassified'):
            t, w = 'cc', 5.0
        else:
            t, w = 'dirt', 4.0
        roads.append({'t': t, 'w': w, 'p': [[r1(x), r1(z)] for x, z in pts]})

import os
TOOLS = os.path.dirname(os.path.abspath(__file__))
traced = json.load(open(f'{TOOLS}/traced.json'))      # source of truth lives next to this script
for name, tr in traced.items():
    roads.append({'t': tr['t'], 'w': tr['w'], 'n': name,
                  'p': [[r1(c) for c in px2w(*p)] for p in tr['p']]})

# NH-365B through the village is one two-way carriageway; widen those pieces.
for rd in roads:
    if rd['t'] == 'highway':
        xs = [p[0] for p in rd['p']]
        if min(xs) > -1200:
            rd['w'] = 7.5

# ---------------------------------------------------------------- water
river, lakes = [], []
for r in csv.DictReader(open(f'{DATA}/water.csv')):
    for ring in parts(r['wkt']):
        pts = [ll2w(*p) for p in ring]
        if not any(inside(x, z) for x, z in pts):
            continue
        q = [[r1(x), r1(z)] for x, z in pts]
        if r['subtype'] == 'river':
            river.append(q)
        elif r['subtype'] == 'lake':
            lakes.append(q)

# Two tanks on the west edge (mosaic px x<600, y 1600-2500) are missing from Overture: trace them from the
# imagery (dark, smooth water surface) and add them to the lakes.
_win = mosaic[1600:2500, 0:600]
_hsv = cv2.cvtColor(cv2.GaussianBlur(_win, (9, 9), 0), cv2.COLOR_BGR2HSV)
_L = cv2.cvtColor(_win, cv2.COLOR_BGR2GRAY).astype(np.float32)
_tex = cv2.blur(np.abs(_L - cv2.GaussianBlur(_L, (0, 0), 2)), (15, 15))
_w = ((_hsv[..., 2] < 72) & (_tex < 2.2)).astype(np.uint8)
_w = cv2.morphologyEx(cv2.morphologyEx(_w, cv2.MORPH_OPEN, np.ones((7, 7), np.uint8)), cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
for _c in cv2.findContours(_w, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[0]:
    if cv2.contourArea(_c) * 0.57 ** 2 < 3000: continue
    _a = cv2.approxPolyDP(_c, 2.0, True).reshape(-1, 2)
    lakes.append([[r1(v) for v in px2w(px_ + 0.0, py_ + 1600.0)] for px_, py_ in _a])
print('lakes (incl. traced west tanks):', len(lakes))

# ---------------------------------------------------------------- road raster (for masks)
SCALE = 0.5   # metres per mask pixel? no: mask in mosaic pixels
def wpoly_to_px(pts):
    out = []
    for x, z in pts:
        lon = x / MX + LON0
        lat = -z / MZ + LAT0
        out.append(ll2px(lon, lat))
    return np.array(out, np.float32)

road_mask = np.zeros((H, W), np.uint8)
mpp = 156543.03392 * math.cos(math.radians(LAT0)) / 2 ** Z   # metres per mosaic px
for rd in roads:
    p = wpoly_to_px(rd['p']).astype(np.int32)
    cv2.polylines(road_mask, [p], False, 255, max(1, int(rd['w'] / mpp)))

# ---------------------------------------------------------------- buildings
WALL_COLS = ['#f2efe6', '#efe8d6', '#e9dcc4', '#f5d7d0', '#d9ecd9', '#d6e6f2', '#f3e9b5',
             '#ffffff', '#e8d0e8', '#cfe7e0', '#f0c9a0', '#e6e6e6', '#bfe0c0', '#f7f0c8']
bld_mask = np.zeros((H, W), np.uint8)
buildings = []
rings = [parts(r['wkt'])[0] for r in csv.DictReader(open(f'{DATA}/buildings.csv'))]
# hand-added footprints for roofs that are clearly visible in the imagery but missing from Overture
extra = json.load(open(f'{TOOLS}/extra_buildings.json'))['buildings']
rings += [[px2ll(*q) for q in e['p']] for e in extra]
for ring in rings:
    if True:
        pts = [ll2w(*p) for p in ring]
        if pts[0] == pts[-1]:
            pts = pts[:-1]
        if len(pts) < 3 or not all(inside(x, z, -5) for x, z in pts):
            continue
        a = 0.5 * sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1]
                      for i in range(len(pts)))
        area = abs(a)
        if area < 6:
            continue
        if a < 0:
            pts = pts[::-1]     # consistent winding
        pp = wpoly_to_px(pts)
        cv2.fillPoly(bld_mask, [pp.astype(np.int32)], 255)
        m = np.zeros((H, W), np.uint8)
        x0, y0, bw, bh = cv2.boundingRect(pp.astype(np.int32))
        sub = np.zeros((bh + 2, bw + 2), np.uint8)
        cv2.fillPoly(sub, [(pp - [x0 - 1, y0 - 1]).astype(np.int32)], 1)
        patch = mosaic[max(0, y0 - 1):y0 + bh + 1, max(0, x0 - 1):x0 + bw + 1]
        sub = sub[:patch.shape[0], :patch.shape[1]]
        mean = patch[sub > 0].mean(axis=0) if sub.sum() else np.array([150, 150, 150])
        # roof colour: median of the footprint's inner pixels (edges pick up walls and shadow)
        inner = cv2.erode(sub.astype(np.uint8), np.ones((3, 3), np.uint8)) if min(sub.shape) > 4 else sub
        px_in = patch[inner > 0] if inner.sum() >= 4 else patch[sub > 0]
        med = np.median(px_in, axis=0) if len(px_in) else mean
        roof_hex = '#%02x%02x%02x' % (int(med[2]), int(med[1]), int(med[0]))
        b, g, rr = mean
        if b > rr + 6 and b >= g - 2:
            roof = 'sheet'       # blue tin / asbestos sheet
        elif rr > b + 35 and rr > g + 12:
            roof = 'tile'        # Mangalore tiles
        else:
            roof = 'rcc'         # flat concrete slab
        if area > 600:
            h = 7.5 if roof == 'sheet' else 6.5
        elif roof == 'sheet':
            h = 3.4 if area > 40 else 2.6
        elif area < 25:
            h = 2.6
        else:
            h = 3.2 * (2 if rng.random() < (0.45 if area > 120 else 0.22) else 1)
        buildings.append({'p': [[r1(x), r1(z)] for x, z in pts], 'h': h, 'r': roof, 'rc': roof_hex,
                          'c': rng.choice(WALL_COLS), 'a': round(area)})

# ---------------------------------------------------------------- footprint fixes (tools/map_fixes.json)
# 1. remove footprints that are not in the imagery (matched by centroid), 2. reserve hand-built plots (safe house),
# 3. keep every footprint out of the carriageways: ML footprints are often 1-2 m too big or offset, so where one
#    reaches into a road corridor (half width + clearance) it is trimmed back along the road edge; a footprint whose
#    centre lies on the carriageway (or that keeps < 6 m2) is standing in the road and is dropped.
fixes = json.load(open(f'{TOOLS}/map_fixes.json'))
def _cen(p):
    return sum(q[0] for q in p) / len(p), sum(q[1] for q in p) / len(p)
def _area(p):
    return abs(0.5 * sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p))))
def _inpoly(x, z, poly):
    c = False
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        if (a[1] > z) != (b[1] > z) and x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]:
            c = not c
    return c
reserved = [r['poly'] for r in fixes.get('reserve', [])]
n_rm = n_res = n_trim = n_drop = 0
keep = []
for b in buildings:
    cx, cz = _cen(b['p'])
    if any(math.hypot(cx - f['x'], cz - f['z']) < f.get('r', 1.5) for f in fixes.get('remove_buildings', [])):
        n_rm += 1; continue
    if any(_inpoly(cx, cz, rp) for rp in reserved):
        n_res += 1; continue
    keep.append(b)
buildings = keep
CLR = fixes.get('clearance', 0.6)
_rsegs = [(rd['p'][i], rd['p'][i + 1], rd['w']) for rd in roads if rd['t'] != 'dirt' for i in range(len(rd['p']) - 1)]
def _clip(poly, ax, az, nx, nz, off):
    # keep the part of poly with (p - a) . n >= off
    out = []
    for i in range(len(poly)):
        P, Q = poly[i], poly[(i + 1) % len(poly)]
        dp = (P[0] - ax) * nx + (P[1] - az) * nz - off
        dq = (Q[0] - ax) * nx + (Q[1] - az) * nz - off
        if dp >= 0: out.append(P)
        if (dp >= 0) != (dq >= 0):
            t = dp / (dp - dq); out.append([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t])
    return out
keep = []
for b in buildings:
    p0 = [list(q) for q in b['p']]; p = p0; a0 = _area(p0)
    cx, cz = _cen(p0)
    for _ in range(2):          # second pass catches corners exposed by the first
        for a, c, w in _rsegs:
            if min(a[0], c[0]) - 30 > cx or max(a[0], c[0]) + 30 < cx or min(a[1], c[1]) - 30 > cz or max(a[1], c[1]) + 30 < cz:
                continue
            dx, dz = c[0] - a[0], c[1] - a[1]; L = math.hypot(dx, dz)
            if L < 0.5: continue
            ux, uz = dx / L, dz / L
            half = w / 2 + CLR
            hit = False
            for q in p:
                t = (q[0] - a[0]) * ux + (q[1] - a[1]) * uz
                if 0 < t < L and abs((q[0] - a[0]) * -uz + (q[1] - a[1]) * ux) < half: hit = True; break
            if not hit:     # also a road edge crossing the footprint between its corners
                for k in range(0, 11):
                    t = L * k / 10; x_, z_ = a[0] + ux * t, a[1] + uz * t
                    for s in (-half, 0, half):
                        if _inpoly(x_ - uz * s, z_ + ux * s, p): hit = True; break
                    if hit: break
            if not hit: continue
            pc = _cen(p)
            side = 1 if ((pc[0] - a[0]) * -uz + (pc[1] - a[1]) * ux) >= 0 else -1
            p = _clip(p, a[0], a[1], -uz * side, ux * side, half)
            if len(p) < 3: break
        if len(p) < 3: break
    def _in_carriageway(x, z):
        for a, c, w in _rsegs:
            dx, dz = c[0] - a[0], c[1] - a[1]; L2 = dx * dx + dz * dz or 1e-9
            t = max(0, min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2))
            if math.hypot(x - a[0] - t * dx, z - a[1] - t * dz) < w / 2: return True
        return False
    if len(p) < 3 or _area(p) < 6 or _in_carriageway(cx, cz):
        n_drop += 1; continue
    if _area(p) < a0 - 0.05:
        n_trim += 1
        b['p'] = [[r1(q[0]), r1(q[1])] for q in p]; b['a'] = round(_area(p))
    keep.append(b)
buildings = keep
print(f'footprint fixes: removed {n_rm}, reserved-plot {n_res}, trimmed off roads {n_trim}, dropped (in road) {n_drop}')

# ---------------------------------------------------------------- compound walls
def seg_nearest(px_, pz_, ax, az, bx, bz):
    dx, dz = bx - ax, bz - az
    L2 = dx * dx + dz * dz or 1e-9
    t = max(0, min(1, ((px_ - ax) * dx + (pz_ - az) * dz) / L2))
    return ax + t * dx, az + t * dz, t

village_roads = [rd for rd in roads if rd['t'] in ('cc', 'lane')]
segs = []
for rd in village_roads:
    for i in range(len(rd['p']) - 1):
        segs.append((rd['p'][i], rd['p'][i + 1], rd['w']))

walls = []
for b in buildings:
    if b['a'] > 400:
        continue
    cx = sum(p[0] for p in b['p']) / len(b['p'])
    cz = sum(p[1] for p in b['p']) / len(b['p'])
    best = None
    for a, c, w in segs:
        nx, nz, t = seg_nearest(cx, cz, a[0], a[1], c[0], c[1])
        d = math.hypot(cx - nx, cz - nz)
        if best is None or d < best[0]:
            best = (d, a, c, w, nx, nz)
    if best is None or best[0] > 20:
        continue
    d, a, c, w, nx, nz = best
    dx, dz = c[0] - a[0], c[1] - a[1]
    L = math.hypot(dx, dz)
    if L < 1:
        continue
    ux, uz = dx / L, dz / L
    side = 1 if ((cx - nx) * -uz + (cz - nz) * ux) > 0 else -1
    nxv, nzv = -uz * side, ux * side            # normal pointing toward building
    off = w / 2 + 0.9
    near = min((p[0] - nx) * nxv + (p[1] - nz) * nzv for p in b['p'])
    if near < off + 0.6 or near > off + 9:
        continue                                 # building sits on the road edge or far back
    proj = [(p[0] - nx) * ux + (p[1] - nz) * uz for p in b['p']]
    s0, s1 = min(proj) - 1.2, max(proj) + 1.2
    bx_, bz_ = nx + nxv * off, nz + nzv * off
    gate = rng.uniform(s0 + 1.0, max(s0 + 1.0, s1 - 4.0))
    for u0, u1 in ((s0, gate), (gate + 3.0, s1)):
        if u1 - u0 > 0.8:
            walls.append([r1(bx_ + ux * u0), r1(bz_ + uz * u0), r1(bx_ + ux * u1), r1(bz_ + uz * u1)])

# ---------------------------------------------------------------- keep walls off the roads
# Walls are placed relative to the nearest village lane, so near junctions and curves they can cut across
# another road. Split each wall into ~1 m pieces and drop the pieces that sit on any carriageway.
all_segs = [(rd['p'][i], rd['p'][i + 1], rd['w']) for rd in roads for i in range(len(rd['p']) - 1)]
def on_road(x, z):
    for a, c, w in all_segs:
        if abs(a[0] - x) > 60 and abs(c[0] - x) > 60:
            continue
        nx, nz, _ = seg_nearest(x, z, a[0], a[1], c[0], c[1])
        if math.hypot(x - nx, z - nz) < w / 2 + 0.6:
            return True
    return False
clean, dropped = [], 0
for x0, z0, x1, z1 in walls:
    L = math.hypot(x1 - x0, z1 - z0); n = max(1, int(L))
    run = None
    for i in range(n):
        ta, tb = i / n, (i + 1) / n
        mx, mz = x0 + (x1 - x0) * (ta + tb) / 2, z0 + (z1 - z0) * (ta + tb) / 2
        if on_road(mx, mz):
            dropped += 1
            if run: clean.append(run); run = None
            continue
        ax, az, bx, bz = x0 + (x1 - x0) * ta, z0 + (z1 - z0) * ta, x0 + (x1 - x0) * tb, z0 + (z1 - z0) * tb
        run = [run[0], run[1], r1(bx), r1(bz)] if run else [r1(ax), r1(az), r1(bx), r1(bz)]
    if run: clean.append(run)
walls = [w for w in clean if math.hypot(w[2] - w[0], w[3] - w[1]) > 0.8]
walls = [w for w in walls if not any(_inpoly((w[0] + w[2]) / 2, (w[1] + w[3]) / 2, rp) or _inpoly(w[0], w[1], rp) or _inpoly(w[2], w[3], rp) for rp in reserved)]
print('walls on roads: dropped', dropped, 'm; kept', len(walls), 'segments')

# ---------------------------------------------------------------- land cover (3 m cells)
cloud_rgb = mosaic.astype(np.float32)
hsv = cv2.cvtColor(mosaic, cv2.COLOR_BGR2HSV)
v = hsv[..., 2].astype(np.float32)
s = hsv[..., 1].astype(np.float32)
cloud = ((v > 150) & (s < 55)).astype(np.uint8) * 255
near_bld = cv2.dilate(bld_mask, np.ones((25, 25), np.uint8))
cloud[near_bld > 0] = 0
cloud = cv2.morphologyEx(cloud, cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))
cloud = cv2.dilate(cloud, np.ones((31, 31), np.uint8))
cloud = cv2.GaussianBlur(cloud, (61, 61), 0)
cloud = (cloud > 40).astype(np.uint8) * 255

CELL = 3.0
LW = int(round(W * mpp / CELL)); LH = int(round(H * mpp / CELL))
small = cv2.resize(mosaic, (LW, LH), interpolation=cv2.INTER_AREA)
csmall = cv2.resize(cloud, (LW, LH), interpolation=cv2.INTER_AREA) > 60
filled = cv2.inpaint(small, csmall.astype(np.uint8) * 255, 9, cv2.INPAINT_TELEA)
hs = cv2.cvtColor(filled, cv2.COLOR_BGR2HSV).astype(np.int32)
Hh, Ss, Vv = hs[..., 0], hs[..., 1], hs[..., 2]
B, G, R = [filled[..., i].astype(np.int32) for i in range(3)]
exg = 2 * G - R - B
# 0 dry fallow, 1 red soil, 2 green crop, 3 dark trees/orchard, 4 bare sand, 5 village earth, 6 water
lc = np.zeros((LH, LW), np.uint8)
lc[(R > G + 18) & (Ss > 95)] = 1
lc[(exg > 14) & (Vv >= 80)] = 2
lc[(exg > 6) & (Vv < 80)] = 3
lc[(Vv > 165) & (Ss < 75)] = 4
vil = cv2.resize(cv2.dilate(bld_mask, np.ones((31, 31), np.uint8)), (LW, LH), interpolation=cv2.INTER_AREA) > 100
lc[vil & (lc != 3)] = 5
lc = cv2.medianBlur(lc, 3)
lc[csmall & (lc == 4)] = 0          # inpainted cloud reads as bright sand; it is farmland under the cloud
for lk in lakes:
    p = wpoly_to_px(lk) * (mpp / CELL)
    cv2.fillPoly(lc, [p.astype(np.int32)], 6)
img = Image.fromarray(lc, 'L')
buf = io.BytesIO(); img.save(buf, 'PNG', optimize=True)
lc_cols = []
for k in range(7):
    sel = lc == k
    med = np.median(filled[sel], 0) if sel.any() else np.array([110, 130, 160])
    lc_cols.append([int(med[2]), int(med[1]), int(med[0])])        # median imagery colour of each class (RGB)
landcover = {'w': LW, 'h': LH, 'cell': CELL, 'png': base64.b64encode(buf.getvalue()).decode(), 'cols': lc_cols}

# ---------------------------------------------------------------- field parcels (tools/fields.py)
sys.path.insert(0, TOOLS)
import fields as _fields
np.savez_compressed(f'{DATA}/fields_inputs.npz', cloud=cloud, bld=bld_mask, road=road_mask, mpp=mpp,
                    river=np.array([wpoly_to_px(rv) for rv in river], dtype=object), lakes=np.array([wpoly_to_px(lk) for lk in lakes], dtype=object))
fields, field_counts = _fields.extract(mosaic, cloud, bld_mask, road_mask,
                                       [wpoly_to_px(rv) for rv in river], [wpoly_to_px(lk) for lk in lakes],
                                       px2w, mpp, overlay_path=f'{DATA}/fields_overlay.jpg')

# ---------------------------------------------------------------- trees
bgr = cv2.GaussianBlur(mosaic, (5, 5), 0).astype(np.int32)
b_, g_, r_ = bgr[..., 0], bgr[..., 1], bgr[..., 2]
val = bgr.max(axis=2)
treem = ((val < 92) & (g_ >= r_) & (2 * g_ - r_ - b_ > 4)).astype(np.uint8)
treem[cloud > 0] = 0
treem[cv2.dilate(road_mask, np.ones((5, 5), np.uint8)) > 0] = 0
treem[cv2.dilate(bld_mask, np.ones((5, 5), np.uint8)) > 0] = 0
TC = 12                                       # ~7 m grid in mosaic px
trees = []
for ty in range(0, H - TC, TC):
    for tx in range(0, W - TC, TC):
        blk = treem[ty:ty + TC, tx:tx + TC]
        f = blk.mean()
        if f > 0.5:
            ys, xs = np.nonzero(blk)
            px_ = tx + xs.mean() + rng.uniform(-2, 2)
            py_ = ty + ys.mean() + rng.uniform(-2, 2)
            x, z = px2w(px_, py_)
            trees.append([r1(x), r1(z), round(3.0 + f * 4 + rng.uniform(0, 1.5), 1)])
# thin out orchards so the instance count stays sane
trees = [t for t in trees if not any(_inpoly(t[0], t[1], rp) for rp in reserved)]
if len(trees) > 9000:
    rng.shuffle(trees); trees = trees[:9000]

# ---------------------------------------------------------------- landmarks
def L(name, lat, lon, kind, te=None):
    x, z = ll2w(lon, lat)
    d = {'name': name, 'k': kind, 'x': r1(x), 'z': r1(z)}
    if te: d['te'] = te
    return d

landmarks = [
    L('Nellutla', 17.7016013, 79.196277, 'village', 'నెల్లుట్ల'),
    L('Shivalayam Temple', 17.7045605, 79.1967879, 'temple', 'శివాలయం'),
    L('Government Hospital, Nellutla', 17.7041184, 79.1959865, 'hospital'),
    L('Sub Centre (BC Colony)', 17.7030644, 79.1957805, 'clinic'),
    L('ZPSS School', 17.7012744, 79.1959099, 'school', 'జి.ప.ఉ.పాఠశాల'),
    # Anganwadi 2: the OSM point sits on the lane; moved onto the blue-roof building beside it (mosaic px 2268,1972)
    L('Anganwadi Nellutla 4', 17.7019988, 79.1969682, 'anganwadi'),
    L('Anganwadi Nellutla 5', 17.7003929, 79.1944917, 'anganwadi'),
    L('Lingala Ghanpur Road', 17.7001432, 79.1957238, 'sign'),
    L('Nellutla Petrol Bunk', 17.707994, 79.184416, 'fuel'),
    L('Cotton Factory', 17.6982609, 79.2068307, 'factory'),
]
# From Google Earth labels (approximate, matched by eye against the imagery)
# Re-checked against the z18 imagery (2026-11-02): Ganesh temple moved off the lane onto the small shrine at
# the north end of the junction plaza; bus stop moved from inside the school-side compound to the NH north
# verge, 33 m east of the Lingala Ghanpur road junction.
for name, (px_, py_), kind in [('Anganwadi Nellutla 2', (2268, 1972), 'anganwadi'),
                               ('Ganesh Temple (Borra Venkanna)', (2838, 1421), 'temple'),
                               ('Golla Kuruma Community Hall', (2346, 1760), 'hall'),
                               ('Overhead Water Tank', (2575, 1710), 'tank'),
                               ('Bus Stop', (2469, 2412), 'busstop'),
                               # Google Maps label ~17.6965 N 79.2045 E; placed on the large building compound by the NH there
                               ('Kbr Function Hall', (4214, 3090), 'funchall'),
                               # hamlet label ~17.713 N 79.198 E: the few roofs at the north edge of the imagery
                               ('Haliya', (2790, 40), 'hamlet')]:
    x, z = px2w(px_, py_)
    landmarks.append({'name': name, 'k': kind, 'x': r1(x), 'z': r1(z)})

data = {
    'meta': {'name': 'Nellutla, Lingala Ghanpur mandal, Jangaon district, Telangana',
             'origin': [LAT0, LON0], 'unitsPerMetre': 1,
             'sources': ['Overture Maps 2026-10-21 (OpenStreetMap, Microsoft/Google ML buildings)',
                         'hand-traced lanes and tracks from satellite imagery']},
    'bounds': bounds, 'roads': roads, 'buildings': buildings, 'walls': walls,
    'river': river, 'lakes': lakes, 'trees': trees, 'landmarks': landmarks,
    'landcover': landcover, 'fields': fields,
}
js = 'window.NELLUTLA_MAP = ' + json.dumps(data, separators=(',', ':')) + ';\n'
open(OUT, 'w').write(js)
print('bounds', bounds)
print('roads', len(roads), 'buildings', len(buildings), 'walls', len(walls), 'trees', len(trees),
      'river', len(river), 'lakes', len(lakes), 'landcover', LW, LH, 'bytes', len(js))
from collections import Counter
print(Counter(b['r'] for b in buildings), Counter(r['t'] for r in roads))
