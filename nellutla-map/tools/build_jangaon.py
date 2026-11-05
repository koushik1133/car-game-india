"""Build the streamed Jangaon town from open data.  python3 tools/build_jangaon.py <dir> [outdir]
Inputs in <dir> (Overture 2026-10-21, bbox 79.09-79.215 E, 17.68-17.77 N, DuckDB; OSM Overpass same bbox):
  buildings.csv segments.csv water.csv places.csv osm.json
Outputs (next to map-data.js):
  jangaon-lite.js   always loaded, small: tiles grid, sites, landmarks, arterial net, sign names
  jangaon-data.json fetched by jangaon-worker.js only near town: footprints, roads, rail, water, per-tile
  jangaon-map.png / jangaon-map-lo.png  minimap layers
World frame is the same as map-data.js. Every generated thing carries inferred=true / is listed in `notes`.
No imagery is used: only Overture and OSM."""
import csv, json, math, re, sys, os, random, heapq, collections
from PIL import Image, ImageDraw
csv.field_size_limit(10**9)
DATA = sys.argv[1]; OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
LAT0, LON0 = 17.70160, 79.19630
MX = 111320.0 * math.cos(math.radians(LAT0)); MZ = 110574.0
ll = lambda lon, lat: ((lon - LON0) * MX, -(lat - LAT0) * MZ)
r1 = lambda v: round(v, 1)
txt = open(f'{OUT}/map-data.js').read(); D = json.loads(txt[txt.index('{'):txt.rindex('}') + 1]); del txt
VB = D['bounds']; T = 320.0
X0 = VB[0] - 15 * T; Z0 = VB[1] - 9 * T; X1, Z1 = VB[2], VB[3]
NX = math.ceil((X1 - X0) / T); NZ = math.ceil((Z1 - Z0) / T)
RB = [r1(X0), r1(Z0), r1(X0 + NX * T), r1(Z0 + NZ * T)]
inV = lambda x, z, p=0: VB[0] + p < x < VB[2] - p and VB[1] + p < z < VB[3] - p
inR = lambda x, z: RB[0] <= x <= RB[2] and RB[1] <= z <= RB[3]
tile = lambda x, z: (min(NX - 1, max(0, int((x - X0) // T))), min(NZ - 1, max(0, int((z - Z0) // T))))
def parts(w): return [[tuple(map(float, p.split())) for p in q.split(',')] for q in re.findall(r'\(([^()]+)\)', w)]
def segd(x, z, a, b):
    dx, dz = b[0]-a[0], b[1]-a[1]; L = dx*dx+dz*dz or 1e-9; t = max(0, min(1, ((x-a[0])*dx+(z-a[1])*dz)/L))
    return math.hypot(x-a[0]-t*dx, z-a[1]-t*dz), t
# existing world road hash: pieces already drawn by nellutla-world.js only enter the surface raster (ns=1)
EX = collections.defaultdict(list)
for r in D['roads']:
    for a, b in zip(r['p'], r['p'][1:]):
        L = max(1, int(math.hypot(b[0]-a[0], b[1]-a[1]) / 40))
        for k in range(L + 1):
            x, z = a[0]+(b[0]-a[0])*k/L, a[1]+(b[1]-a[1])*k/L
            EX[(int(x//50), int(z//50))].append((a, b))
def existing(x, z):
    return any(segd(x, z, a, b)[0] < 2.5 for a, b in EX.get((int(x//50), int(z//50)), []))
CLS = {'trunk': ('highway', 7.5), 'trunk_link': ('highway', 6), 'primary': ('tar', 9), 'primary_link': ('tar', 6), 'secondary': ('tar', 7.5),
       'tertiary': ('tar', 6.5), 'residential': ('cc', 5), 'unclassified': ('cc', 5), 'service': ('cc', 4), 'living_street': ('cc', 4.5)}
roads = []; rail_ov = 0
graph = collections.defaultdict(list); RK = lambda p: (round(p[0], 0), round(p[1], 0))
for r in csv.DictReader(open(f'{DATA}/segments.csv')):
    if r['subtype'] == 'rail': rail_ov += 1; continue
    t, w = CLS.get(r['class'], ('dirt', 4))
    for line in parts(r['wkt']):
        pts = [ll(*p) for p in line]
        L = sum(math.hypot(b[0]-a[0], b[1]-a[1]) for a, b in zip(pts, pts[1:]))
        for a, b in zip([pts[0]], [pts[-1]]): graph[RK(a)].append((RK(b), L, r['class'], pts)); graph[RK(b)].append((RK(a), L, r['class'], pts[::-1]))
        if not any(inR(*p) for p in pts): continue
        # split into pieces <=35 m, tag ones already in the village world
        pc = [pts[0]]
        for a, b in zip(pts, pts[1:]):
            n = max(1, int(math.hypot(b[0]-a[0], b[1]-a[1]) / 35))
            for k in range(1, n + 1): pc.append((a[0]+(b[0]-a[0])*k/n, a[1]+(b[1]-a[1])*k/n))
        roads.append({'t': t, 'w': w, 'c': r['class'], 'p': pc, 'n': r['name'] or None})
# ---------- rail, platforms from OSM
osm = json.load(open(f'{DATA}/osm.json'))['elements']
rail = []; plats = []
for e in osm:
    tg = e.get('tags', {})
    if e['type'] == 'way' and tg.get('railway') == 'rail':
        p = [ll(q['lon'], q['lat']) for q in e['geometry']]
        if any(inR(*q) for q in p): rail.append([[r1(a), r1(b)] for a, b in p])
    if e['type'] == 'way' and tg.get('railway') == 'platform':
        p = [ll(q['lon'], q['lat']) for q in e['geometry']]
        if any(inR(*q) for q in p): plats.append([[r1(a), r1(b)] for a, b in p])
# ---------- water
water = []
for r in csv.DictReader(open(f'{DATA}/water.csv')):
    for ring in parts(r['wkt']):
        p = [ll(*q) for q in ring]
        if r['subtype'] in ('lake', 'reservoir', 'pond', 'water') and len(p) > 3 and all(inR(*q) for q in p) and not any(inV(*q) for q in p):
            water.append([[r1(a), r1(b)] for a, b in p])
# ---------- places: OSM first, Overture for what OSM lacks
places = [(ll(float(r['lon']), float(r['lat'])), r['name'], json.loads(r['cat'] or '{}').get('primary') or '', float(r['confidence'] or 0)) for r in csv.DictReader(open(f'{DATA}/places.csv'))]
def P(sub):
    b = [p for p in places if sub.lower() in p[1].lower()]; return max(b, key=lambda p: p[3]) if b else None
arter = [r for r in roads if r['t'] in ('tar', 'highway') and r['c'] != 'trunk_link']
# ---------- buildings
rings = []
for r in csv.DictReader(open(f'{DATA}/buildings.csv')):
    q = parts(r['wkt'])[0]; p = [ll(*c) for c in q]
    if p[0] == p[-1]: p = p[:-1]
    if len(p) < 3: continue
    cx, cz = sum(c[0] for c in p)/len(p), sum(c[1] for c in p)/len(p)
    if not inR(cx, cz) or inV(cx, cz): continue
    a = .5*sum(p[i][0]*p[(i+1)%len(p)][1]-p[(i+1)%len(p)][0]*p[i][1] for i in range(len(p)))
    if abs(a) < 8: continue
    if a < 0: p = p[::-1]
    rings.append({'p': p, 'a': abs(a), 'x': cx, 'z': cz, 'cl': r['class']})
print('footprints in region', len(rings))
RH = collections.defaultdict(list)
for r in roads:
    if r['t'] == 'dirt': continue
    for a, b in zip(r['p'], r['p'][1:]): RH[(int(a[0]//40), int(a[1]//40))].append((a, b, r['w'], r['t']))
def near_segs(x, z, R=1):
    i, j = int(x//40), int(z//40)
    for u in range(i-R, i+R+1):
        for v in range(j-R, j+R+1): yield from RH.get((u, v), [])
def clip(poly, ax, az, nx, nz, off):
    out = []
    for i in range(len(poly)):
        P_, Q = poly[i], poly[(i+1) % len(poly)]
        dp = (P_[0]-ax)*nx+(P_[1]-az)*nz-off; dq = (Q[0]-ax)*nx+(Q[1]-az)*nz-off
        if dp >= 0: out.append(P_)
        if (dp >= 0) != (dq >= 0):
            t = dp/(dp-dq); out.append((P_[0]+(Q[0]-P_[0])*t, P_[1]+(Q[1]-P_[1])*t))
    return out
def area(p): return abs(.5*sum(p[i][0]*p[(i+1)%len(p)][1]-p[(i+1)%len(p)][0]*p[i][1] for i in range(len(p))))
keep = []; dropped = trimmed = 0
for b in rings:
    p = b['p']; dead = False
    for a, c, w, t in near_segs(b['x'], b['z'], 2):
        half = w/2 + .5
        if segd(b['x'], b['z'], a, c)[0] < w/2: dead = True; break
        if not any(segd(q[0], q[1], a, c)[0] < half for q in p): continue
        L = math.hypot(c[0]-a[0], c[1]-a[1]) or 1; ux, uz = (c[0]-a[0])/L, (c[1]-a[1])/L
        s = 1 if ((b['x']-a[0])*-uz+(b['z']-a[1])*ux) >= 0 else -1
        p = clip(p, a[0], a[1], -uz*s, ux*s, half)
        if len(p) < 3: dead = True; break
    if dead or area(p) < 8: dropped += 1; continue
    if len(p) != len(b['p']) or area(p) < b['a'] - .1: trimmed += 1
    b['p'] = p; b['a'] = area(p); keep.append(b)
rings = keep; print('dropped in road', dropped, 'trimmed', trimmed)
# ---------- sites: real named business -> nearest arterial frontage; lot clears footprints it overlaps (replaced, so flagged)
def frontage(tx, tz, w, d, classes):
    best = None
    for r in roads:
        if r['c'] not in classes: continue
        for a, b in zip(r['p'], r['p'][1:]):
            L = math.hypot(b[0]-a[0], b[1]-a[1])
            if L < 1: continue
            ux, uz = (b[0]-a[0])/L, (b[1]-a[1])/L
            mx, mz = (a[0]+b[0])/2, (a[1]+b[1])/2
            if math.hypot(mx-tx, mz-tz) > 220: continue
            for s in (1, -1):
                nx, nz = -uz*s, ux*s; o = r['w']/2 + 1.2 + d/2
                cx, cz = mx+nx*o, mz+nz*o
                if any(segd(cx+ux*i*w/2+nx*j*d/2, cz+uz*i*w/2+nz*j*d/2, q[0], q[1])[0] < q[2]/2+.5 for i in (-1, 0, 1) for j in (-.9, 0, 1) for q in near_segs(cx, cz, 2) if not (q[0] is a and q[1] is b)): continue
                lost = sum(1 for g in rings if abs((g['x']-cx)*ux+(g['z']-cz)*uz) < w/2+4 and abs((g['x']-cx)*nx+(g['z']-cz)*nz) < d/2+4)
                sc = math.hypot(cx-tx, cz-tz) + lost*18
                if best is None or sc < best[0]:
                    best = (sc, cx, cz, math.atan2(-nx, -nz), lost, mx+nx*(r['w']/2), mz+nz*(r['w']/2), r['c'], ux, uz, nx, nz)
    return best
M = ('primary', 'secondary', 'tertiary', 'trunk')
SITE = [ # key, label, sign, source name (place), lot w,d, GameLocations type, roads
 ('showroom', 'Maruti Suzuki Arena', 'MARUTI SUZUKI ARENA', 'Maruti Suzuki Arena', 34, 28, 'car_showroom'),
 ('showroom2', 'Tata Motors Cars', 'TATA MOTORS', 'Tata Motors Cars', 30, 26, 'car_showroom'),
 ('showroom3', 'Hema Hyundai', 'HEMA HYUNDAI', 'Hema Hyundai', 30, 26, 'car_showroom'),
 ('bikeShowroom', 'Yamaha Showroom', 'YAMAHA', 'Yamaha Showroom', 22, 18, 'bike_showroom'),
 ('bikeShowroom2', 'Royal Enfield Showroom', 'ROYAL ENFIELD', 'Royal Enfield Showroom', 22, 18, 'bike_showroom'),
 ('autoShowroom', 'Piaggio Auto', 'PIAGGIO AUTO', 'Piaggio Auto', 22, 20, 'auto_showroom'),
 ('upgrade', 'Sai Krishna Mechanic Works', 'SAI KRISHNA MECHANIC WORKS', 'Sai Krishna Mechanic', 24, 22, 'upgrade_shop'),
 ('seedShop', 'JKS Agri Mall', 'JKS AGRI MALL - SEEDS FERTILISER', 'JKS Agri Mall', 18, 16, 'seed_shop'),
 ('taxiStand', 'Taxi Stand', 'TAXI STAND', None, 26, 14, 'taxi_stand'),
]
sites = {}; lots = []
for key, label, sign, src, w, d, ty in SITE:
    pl = P(src) if src else None
    tx, tz = pl[0] if pl else (-3560, -1925)
    f = frontage(tx, tz, w, d, M)
    if not f: print('NO FRONTAGE', key); continue
    _, cx, cz, ang, lost, ex, ez, cl, ux, uz, nx, nz = f
    sites[key] = {'name': label, 'type': ty, 'x': r1(cx), 'z': r1(cz), 'rot': round(ang, 3), 'w': w, 'd': d, 'entry': [r1(ex), r1(ez)], 'road': cl,
                  'source': ('Overture place "%s" at %d,%d, snapped %d m to the road frontage' % (pl[1], tx, tz, math.hypot(cx-tx, cz-tz))) if pl else 'inferred: no taxi stand mapped; beside the bus station', 'replaced': lost, 'inferred': not pl}
    lots.append({'x': cx, 'z': cz, 'ux': ux, 'uz': uz, 'nx': nx, 'nz': nz, 'w': w, 'd': d, 'sign': sign, 'k': key})
    rings = [g for g in rings if not (abs((g['x']-cx)*ux+(g['z']-cz)*uz) < w/2+1 and abs((g['x']-cx)*nx+(g['z']-cz)*nz) < d/2+1)]
# ---------- landmarks: real points
LM = []
def lm(name, k, x, z, src, sign=None, te=None): LM.append({'name': name, 'k': k, 'x': r1(x), 'z': r1(z), 'src': src, 'sign': sign or name.upper(), 'te': te})
def gx(e):
    if 'lat' in e: return e['lat'], e['lon']
    if e.get('geometry'): return sum(q['lat'] for q in e['geometry'])/len(e['geometry']), sum(q['lon'] for q in e['geometry'])/len(e['geometry'])
    b = e['bounds']; return (b['minlat']+b['maxlat'])/2, (b['minlon']+b['maxlon'])/2
KM = {'hospital': 'hospital', 'clinic': 'hospital', 'school': 'school', 'college': 'school', 'place_of_worship': 'temple', 'bank': 'bank', 'police': 'police', 'theatre': 'theatre', 'post_office': 'civic', 'courthouse': 'civic', 'library': 'civic', 'fuel': 'fuel', 'bus_station': 'busstand', 'marketplace': 'market'}
seen = set()
for e in osm:
    tg = e.get('tags', {}); k = KM.get(tg.get('amenity'))
    if not k: continue
    la, lo = gx(e); x, z = ll(lo, la)
    if not inR(x, z) or inV(x, z): continue
    nm = tg.get('name') or {'fuel': 'Petrol Bunk'}.get(k)
    if not nm or (nm, k) in seen: continue
    seen.add((nm, k))
    if k == 'temple':
        lown = nm.lower(); k = 'church' if ('church' in lown or 'chearch' in lown) else 'mosque' if 'mosque' in lown else 'temple'
    lm(nm.title() if nm.islower() else nm, k, x, z, 'OSM')
for (x, z), nm, c, cf in places:
    if inV(x, z) or not inR(x, z) or cf < .45: continue
    if c == 'gas_station' and not any(l['k'] == 'fuel' and math.hypot(l['x']-x, l['z']-z) < 40 for l in LM): lm(nm, 'fuel', x, z, 'Overture')
    elif c in ('movie_theater',) and not any(l['k'] == 'theatre' and math.hypot(l['x']-x, l['z']-z) < 40 for l in LM): lm(nm, 'theatre', x, z, 'Overture')
    elif c == 'hindu_place_of_worship' and not any(l['k'] == 'temple' and math.hypot(l['x']-x, l['z']-z) < 40 for l in LM): lm(nm, 'temple', x, z, 'Overture')
    elif c in ('school', 'high_school') and not any(l['k'] == 'school' and math.hypot(l['x']-x, l['z']-z) < 40 for l in LM): lm(nm, 'school', x, z, 'Overture')
S0 = next(e for e in osm if e.get('tags', {}).get('railway') == 'station' and e['tags'].get('name') == 'Jangaon')
sx, sz = ll(S0['lon'], S0['lat']); lm('Jangaon Railway Station', 'station', sx, sz, 'OSM node', 'JANGAON RAILWAY STATION', 'జనగామ')
for key, nm, k, ty in (('busStand', 'TGSRTC Bus Station , Janagaon', 'busstand', 'bus_stand'), ('market', 'Grain market', 'market', 'market_yard'), ('vegetableMarket', 'Vegitable market', 'market', 'market'), ('areaHospital', 'Area Hospital, Jangaon', 'hospital', 'hospital'), ('station', 'Jangaon Railway Station', 'station', 'railway_station')):
    l = next(q for q in LM if q['name'].lower() == nm.lower())
    n2 = min((seg for r in arter for seg in zip(r['p'], r['p'][1:])), key=lambda s_: segd(l['x'], l['z'], *s_)[0])
    sites[key] = {'name': {'busStand': 'Jangaon RTC Bus Stand', 'market': 'Agricultural Market Yard (Grain Market)', 'vegetableMarket': 'Vegetable Market', 'areaHospital': 'Government Area Hospital', 'station': 'Jangaon Railway Station'}[key], 'type': ty, 'x': l['x'], 'z': l['z'], 'rot': 0, 'w': 30, 'd': 30, 'entry': [r1(n2[0][0]), r1(n2[0][1])], 'road': 'arterial', 'source': l['src'] + ' exact point', 'replaced': 0, 'inferred': False}
# nearest footprint is the landmark's building, marked for paint
for l in LM:
    best = None
    for g in rings:
        d = math.hypot(g['x']-l['x'], g['z']-l['z'])
        if d < 45 and (best is None or d < best[0]) and 'lm' not in g: best = (d, g)
    l['bld'] = bool(best)
    if best: best[1]['lm'] = l['k']; best[1]['sg'] = l['sign']
names = {}
def sid(s):
    return names.setdefault(s, len(names))
for l in LM: l['s'] = sid(l['sign'])
for x in lots: x['s'] = sid(x['sign'])
# ---------- per-tile output
tiles = collections.defaultdict(lambda: {'b': [], 'r': []})
rng = random.Random(1707)
for g in rings:
    i, j = tile(g['x'], g['z'])
    dist = min((segd(g['x'], g['z'], a, c)[0] - w/2 for a, c, w, t in near_segs(g['x'], g['z'], 1) if t in ('tar', 'highway')), default=99)
    tiles[(i, j)]['b'].append([[r1(q[0]), r1(q[1])] for q in g['p']] + [{'f': 1 if dist < 14 else 0, 'l': g.get('lm'), 's': sid(g['sg']) if g.get('sg') else None}])
for r in roads:
    for a, b in zip(r['p'], r['p'][1:]):
        m = ((a[0]+b[0])/2, (a[1]+b[1])/2)
        if inV(*m): continue
        tiles[tile(*m)]['r'].append([r1(a[0]), r1(a[1]), r1(b[0]), r1(b[1]), r['t'], r['w'], 1 if existing(*m) else 0])
data = {'bounds': RB, 'T': T, 'NX': NX, 'NZ': NZ, 'v': VB, 'rail': rail, 'plats': plats, 'water': water, 'lots': lots,
        'lm': [{k: l[k] for k in ('k', 'x', 'z', 's')} for l in LM], 'tiles': {f'{i},{j}': v for (i, j), v in tiles.items()}}
json.dump(data, open(f'{OUT}/jangaon-data.json', 'w'), separators=(',', ':'))
# ---------- arterial net for traffic and pedestrians; route check
nodes = {}; edges = []
for r in roads:
    if r['t'] not in ('tar', 'highway') and not (r['c'] == 'residential' and False): continue
    pc = [q for q in r['p'] if not inV(*q)]
    if len(pc) < 2: continue
    nid = lambda p: nodes.setdefault(RK(p), len(nodes))
    edges.append([nid(pc[0]), nid(pc[-1]), r['w'], [[r1(q[0]), r1(q[1])] for q in pc[::2] + ([pc[-1]] if len(pc) % 2 == 0 else [])]])
def route(a, b):
    sa = min(graph, key=lambda k: math.hypot(k[0]-a[0], k[1]-a[1])); sb = min(graph, key=lambda k: math.hypot(k[0]-b[0], k[1]-b[1]))
    d = {sa: 0}; pv = {}; pq = [(0, sa)]
    while pq:
        c, u = heapq.heappop(pq)
        if u == sb: break
        if c > d[u]: continue
        for v, L, cl, pts in graph[u]:
            if c+L < d.get(v, 1e12): d[v] = c+L; pv[v] = (u, cl, L); heapq.heappush(pq, (c+L, v))
    if sb not in pv: return None
    u = sb; cl = collections.Counter()
    while u != sa: u, c_, L = pv[u]; cl[c_] += L
    return round(d[sb]), {k: round(v) for k, v in cl.items()}
rt = route((-78, 51), (sites['taxiStand']['x'], sites['taxiStand']['z'])); print('village junction -> bus stand', rt)
lite = {'bounds': RB, 'T': T, 'NX': NX, 'NZ': NZ, 'v': VB, 'sites': sites, 'signs': sorted(names, key=names.get),
        'landmarks': [{k: l[k] for k in ('name', 'k', 'x', 'z', 'src', 'te')} for l in LM],
        'net': {'nodes': [list(k) for k in nodes], 'edges': edges}, 'route': rt,
        'coverage': {'footprints': len(rings), 'roads': len(roads), 'rail': len(rail), 'platforms': len(plats), 'water': len(water), 'heightsInData': 0,
                     'trimmed': trimmed, 'droppedInRoad': dropped, 'osmNamed': sum(1 for l in LM if 'OSM' in l['src'])}}
open(f'{OUT}/jangaon-lite.js', 'w').write('window.JANGAON_LITE=' + json.dumps(lite, separators=(',', ':'), ensure_ascii=False) + ';\nwindow.Jangaon={sites:JANGAON_LITE.sites,bounds:JANGAON_LITE.bounds,landmarks:JANGAON_LITE.landmarks,ready:false};\n')
# ---------- minimap layers
def render(ppm, path):
    W, H = int((RB[2]-RB[0])*ppm), int((RB[3]-RB[1])*ppm)
    im = Image.new('RGB', (W, H), (201, 185, 142)); dr = ImageDraw.Draw(im)
    q = lambda p: (( p[0]-RB[0])*ppm, (p[1]-RB[1])*ppm)
    for w_ in water: dr.polygon([q(p) for p in w_], fill=(111, 176, 220))
    for g in rings: dr.polygon([q(p) for p in g['p']], fill=(191, 178, 162))
    C = {'dirt': (217, 191, 143), 'cc': (255, 255, 255), 'tar': (255, 211, 107), 'highway': (255, 157, 59)}
    for t in ('dirt', 'cc', 'tar', 'highway'):
        for r in roads:
            if r['t'] == t: dr.line([q(p) for p in r['p']], fill=C[t], width=max(1, int(r['w']*ppm*1.1)))
    for rl in rail: dr.line([q(p) for p in rl], fill=(70, 70, 80), width=max(1, int(3*ppm)))
    for l in LM:
        if l['k'] in ('station', 'busstand', 'market', 'hospital'): x, y = q((l['x'], l['z'])); dr.rectangle([x-2, y-2, x+2, y+2], fill=(200, 60, 40))
    im.save(path, optimize=True)
render(.4, f'{OUT}/jangaon-map.png'); render(.1, f'{OUT}/jangaon-map-lo.png')
print('tiles', len(tiles), 'of', NX*NZ, 'buildings', len(rings), 'landmarks', len(LM), 'signs', len(names), 'net edges', len(edges))
for k, s in sites.items(): print(k, s['x'], s['z'], s['road'], s['replaced'], s['source'])
print(collections.Counter(l['k'] for l in LM), 'rail', len(rail), rail_ov, 'plats', len(plats), 'water', len(water))
for f in ('jangaon-data.json', 'jangaon-lite.js', 'jangaon-map.png', 'jangaon-map-lo.png'): print(f, os.path.getsize(f'{OUT}/{f}'))
