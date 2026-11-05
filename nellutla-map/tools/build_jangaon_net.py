"""Build jangaon-net.json: the full town road graph, inferred signals, street lamps and humps, and a height grid.
python3 tools/build_jangaon_net.py <dir> [outdir]   (run after build_jangaon.py)
Inputs in <dir>: segments.csv (Overture) and dem/z13_<x>_<y>.png (Mapzen/AWS Terrain Tiles, terrarium encoding).
OSM as pulled has no traffic_signals, traffic_calming or street_lamp tags here, so signals, humps and lamps are all inferred.
Heights: the DEM shape only. Regional slope removed, zero at the village edge and region edge, zero at every game site
(their floors and other modules' props sit at y 0), never below 0 (the village's far ground planes lie at y 0)."""
import csv, json, math, re, sys, os, glob, collections
import numpy as np
from PIL import Image
DATA = sys.argv[1]; OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
LAT0, LON0 = 17.70160, 79.19630
MX = 111320.0 * math.cos(math.radians(LAT0)); MZ = 110574.0
ll = lambda lon, lat: ((lon - LON0) * MX, -(lat - LAT0) * MZ)
R = json.load(open(f'{OUT}/jangaon-data.json')); B = R['bounds']; VB = R['v']
lite = open(f'{OUT}/jangaon-lite.js').read(); LT = json.loads(lite[lite.index('{'):lite.index('};') + 1]); sites = LT['sites']
inV = lambda x, z: VB[0] < x < VB[2] and VB[1] < z < VB[3]
inR = lambda x, z: B[0] <= x <= B[2] and B[1] <= z <= B[3] and not inV(x, z)
CLS = {'trunk': ('highway', 7.5), 'trunk_link': ('highway', 6), 'primary': ('tar', 9), 'primary_link': ('tar', 6), 'secondary': ('tar', 7.5), 'tertiary': ('tar', 6.5),
       'residential': ('cc', 5), 'unclassified': ('cc', 5), 'service': ('cc', 4), 'living_street': ('cc', 4.5)}
parts = lambda w: [[tuple(map(float, p.split())) for p in q.split(',')] for q in re.findall(r'\(([^()]+)\)', w)]
K = lambda p: (round(p[0]), round(p[1]))
lines = []; deg = collections.Counter()
for r in csv.DictReader(open(f'{DATA}/segments.csv')):
    if r['subtype'] == 'rail' or r['class'] not in CLS: continue
    t, w = CLS[r['class']]
    for line in parts(r['wkt']):
        run = []
        for p in (ll(*q) for q in line) :
            if inR(*p): run.append(p)
            else:
                if len(run) > 1: lines.append((t, w, run))
                run = []
        if len(run) > 1: lines.append((t, w, run))
for t, w, p in lines:
    ks = [K(q) for q in p]
    for a, b in zip(ks, ks[1:]):
        if a != b: deg[a] += 1; deg[b] += 1
    deg[ks[0]] += 10; deg[ks[-1]] += 10          # line ends are always nodes
nodes = {}; edges = []
nid = lambda k: nodes.setdefault(k, len(nodes))
for t, w, p in lines:
    cur = [p[0]]
    for q in p[1:]:
        if K(q) == K(cur[-1]): continue
        cur.append(q)
        if deg[K(q)] != 2:
            edges.append([K(cur[0]), K(cur[-1]), w, t, cur]); cur = [q]
    if len(cur) > 1: edges.append([K(cur[0]), K(cur[-1]), w, t, cur])
# keep the largest connected piece
par = {}
def find(a):
    par.setdefault(a, a)
    while par[a] != a: par[a] = par[par[a]]; a = par[a]
    return a
for e in edges: par[find(e[0])] = find(e[1])
size = collections.Counter(find(e[0]) for e in edges); main = size.most_common(1)[0][0]
edges = [e for e in edges if find(e[0]) == main and e[0] != e[1]]
plen = lambda p: sum(math.hypot(b[0]-a[0], b[1]-a[1]) for a, b in zip(p, p[1:]))
out = []
for e in edges:
    out.append([nid(e[0]), nid(e[1]), e[2], e[3], [[round(x, 1), round(z, 1)] for x, z in e[4]]])
N = [[k[0], k[1]] for k in nodes]; adj = collections.defaultdict(list)
for n, e in enumerate(out): adj[e[0]].append((n, 0)); adj[e[1]].append((n, 1))
# ---------- signals: real junctions of the arterial net, the busiest and spaced out; approaches paired by axis
def bearing(e, end):
    p = e[4] if end == 0 else e[4][::-1]; q = p[min(2, len(p) - 1)]
    return math.atan2(q[0] - p[0][0], q[1] - p[0][1])      # heading away from the node
cand = []
for n, l in adj.items():
    art = [q for q in l if out[q[0]][3] in ('tar', 'highway') and plen(out[q[0]][4]) > 30]
    if len(art) >= 2 and len(l) >= 3 and N[n][0] < -2200:
        cand.append((sum(out[q[0]][2] for q in l) + 3 * (len(art) - 2) + (4 if any(out[q[0]][3] == 'highway' for q in l) else 0), n))
sig = []; chosen = []
for s, n in sorted(cand, reverse=True):
    if any(math.hypot(N[n][0]-N[m][0], N[n][1]-N[m][1]) < 170 for m in chosen): continue
    chosen.append(n)
    if len(chosen) == 14: break
for n in chosen:
    ap = []; b0 = None
    for ei, end in adj[n]:
        e = out[ei]; L = plen(e[4])
        if L < 18: continue
        b = bearing(e, end)
        if b0 is None: b0 = b
        phase = 0 if abs(math.sin(b - b0)) < .6 else 1
        fx, fz = math.sin(b), math.cos(b)                  # away from the node; drivers come down it facing the node
        o = e[2] / 2 + 1.2; px = N[n][0] + fx * 8.5 + fz * o * -1; pz = N[n][1] + fz * 8.5 - fx * o * -1
        ap.append([ei, end, round(b, 3), phase, round(px, 1), round(pz, 1)])
    sig.append({'n': n, 'x': N[n][0], 'z': N[n][1], 'ap': ap})
# ---------- footprints for lamp clearance
def inside(x, z):
    i = int((x - B[0]) // R['T']); j = int((z - B[1]) // R['T']); t = R['tiles'].get(f'{i},{j}')
    if not t: return False
    for b in t['b']:
        p = b[:-1]; c = False
        for a, e in zip(p, p[1:] + p[:1]):
            if (a[1] > z) != (e[1] > z) and x < (e[0]-a[0]) * (z-a[1]) / (e[1]-a[1]) + a[0]: c = not c
        if c: return True
    return False
def walk(p, step, s0=0):
    d = s0
    for a, b in zip(p, p[1:]):
        L = math.hypot(b[0]-a[0], b[1]-a[1])
        while d <= L and L > 0:
            yield a[0]+(b[0]-a[0])*d/L, a[1]+(b[1]-a[1])*d/L, (b[0]-a[0])/L, (b[1]-a[1])/L
            d += step
        d -= L
lamps = []; side = 1
for e in out:
    if e[3] not in ('tar', 'highway'): continue
    for x, z, ux, uz in walk(e[4], 38, 12):
        if x > -2300 or z > -300: continue
        side = -side; o = (e[2] / 2 + 1.0) * side; px, pz = x + uz * o, z - ux * o
        if inside(px, pz) or any(abs(l[0]-px) + abs(l[1]-pz) < 14 for l in lamps[-40:]): continue
        lamps.append([round(px, 1), round(pz, 1), round(math.atan2(-uz * side, ux * side), 2)])
# ---------- humps: by schools and hospitals on the real road next to them, spaced (no source data: inferred)
humps = []
hot = [l for l in LT['landmarks'] if l['k'] in ('school', 'hospital', 'clinic', 'temple', 'busstand', 'market')]
for l in hot:
    best = None
    for e in out:
        if e[3] == 'highway': continue
        for x, z, ux, uz in walk(e[4], 12):
            d = math.hypot(x - l['x'], z - l['z'])
            if d < 60 and (not best or d < best[0]): best = (d, x, z, ux, uz, e[2])
    if best and min((math.hypot(best[1]-N[n['n']][0], best[2]-N[n['n']][1]) for n in sig), default=99) > 30 \
       and all(math.hypot(best[1]-h[0], best[2]-h[1]) > 45 for h in humps):
        humps.append([round(best[1], 1), round(best[2], 1), round(math.atan2(best[3], best[4]), 3), best[5], 1.5, .095])
# ---------- height grid, 40 m, lined up with the town ground mesh
def tile_xy(lon, lat, z=13):
    n = 2 ** z; return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
tilesd = {}
for f in glob.glob(f'{DATA}/dem/z13_*.png'):
    x, y = map(int, re.findall(r'\d+', os.path.basename(f))[1:3]); tilesd[(x, y)] = np.asarray(Image.open(f).convert('RGB'), dtype=float)
def elev(x, z):
    lon = x / MX + LON0; lat = -z / MZ + LAT0; tx, ty = tile_xy(lon, lat); a = tilesd[(int(tx), int(ty))]
    i = min(255, int((ty % 1) * 256)); j = min(255, int((tx % 1) * 256)); c = a[i, j]; return c[0] * 256 + c[1] + c[2] / 256 - 32768
NX = int((B[2] - B[0]) / 40) + 1; NZ = int((B[3] - B[1]) / 40) + 1
E0 = np.array([[elev(B[0] + i * 40, B[1] + j * 40) for i in range(NX)] for j in range(NZ)])
def blur(a, s):
    k = np.exp(-.5 * (np.arange(-int(3*s), int(3*s)+1) / s) ** 2); k /= k.sum()
    p = np.pad(a, len(k)//2, mode='edge')
    p = np.apply_along_axis(lambda m: np.convolve(m, k, 'valid'), 0, p); return np.apply_along_axis(lambda m: np.convolve(m, k, 'valid'), 1, p)
S = blur(E0, 3); L = blur(E0, 35); H = S - L; H -= np.percentile(H, 3); H = np.clip(H, 0, None); raw = float(H.max())
A = min(1, 5.0 / raw); H *= A
ss = lambda v: np.clip(v, 0, 1) ** 2 * (3 - 2 * np.clip(v, 0, 1))
X = B[0] + np.arange(NX) * 40.; Z = B[1] + np.arange(NZ) * 40.; XX, ZZ = np.meshgrid(X, Z)
dv = np.maximum(np.maximum(VB[0] - XX, VB[1] - ZZ), -1e9); dv = np.where((XX > VB[0]) & (ZZ > VB[1]), -1, dv)
W = ss((dv - 40) / 360) * ss(np.minimum.reduce([XX - B[0], ZZ - B[1]]) / 200 - .2)
for s in sites.values(): W = W * ss((np.hypot(XX - s['x'], ZZ - s['z']) - 70) / 130)
for l in R['lots']: W = W * ss((np.hypot(XX - l['x'], ZZ - l['z']) - 70) / 130)
H = H * W
print('DEM', E0.min(), E0.max(), 'local relief m', round(raw, 2), 'scaled by', round(A, 2), 'final max', round(float(H.max()), 2))
json.dump({'nodes': N, 'edges': out, 'sig': sig, 'lamps': lamps, 'humps': humps, 'H': {'nx': NX, 'nz': NZ, 'x0': B[0], 'z0': B[1], 'd': [int(v) for v in (H * 100).round().ravel()]},
           'note': {'demRelief': round(raw, 2), 'demScale': round(A, 3)}}, open(f'{OUT}/jangaon-net.json', 'w'), separators=(',', ':'))
kinds = collections.Counter(e[3] for e in out)
print('nodes', len(N), 'edges', len(out), kinds, 'km', round(sum(plen(e[4]) for e in out) / 1000), 'signals', len(sig), [len(s['ap']) for s in sig], 'lamps', len(lamps), 'humps', len(humps), 'KB', os.path.getsize(f'{OUT}/jangaon-net.json') // 1024)
