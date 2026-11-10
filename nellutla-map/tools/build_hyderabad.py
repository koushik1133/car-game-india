"""Build the streamed corridor Jangaon -> Bhongir -> Ghatkesar -> Uppal -> Habsiguda -> Tarnaka -> Secunderabad at real scale.
    python3 tools/build_hyderabad.py <dir> [outdir]        (run from a checkout; needs numpy and Pillow)

SOURCES (open data only, no imagery, no game assets)
  Overture Maps release 2026-10-21, read with DuckDB from s3://overturemaps-us-west-2:
    <dir>/x/seg2.csv        transportation/segment, bbox 78.47-79.145 E, 17.36-17.78 N, with subclass, routes, road_flags,
                            level_rules, access_restrictions, connectors
    <dir>/buildings_city.csv  buildings/building, box 78.485-78.605 E, 17.385-17.465 N: every footprint is kept
    <dir>/buildings_all.csv   same type, 78.47-79.12 E: only footprints near the arterial corridor are kept
    <dir>/x/bld_gap.csv       same type, 79.115-79.145 E strip that closes the gap to the Jangaon region
    <dir>/water.csv, <dir>/places.csv
  OpenStreetMap (contributors, ODbL) via the Overpass mirror maps.mail.ru/osm/tools/overpass/api/interpreter, 2026-11-05:
    <dir>/x/osm_extra.json  railways, Hyderabad Metro, platforms, stations, stadiums, forts, named amenities
World frame is the frame of map-data.js: x east, z south, origin 17.70160 N 79.19630 E.

OUTPUTS next to map-data.js
    hyd-lite.js     always loaded, small: grid, tile occupancy, landmarks, report
    hyd-net.json    arterial graph: nav, traffic, nearestRoad. Fetched after page load
    hyd/<i>_<j>.bin one Int16 record file per 640 m tile, coordinates local to that tile (0.1 m), fetched near the player

INFERRED, and marked so: building heights (bit in each tile record; hyd-lite coverage counts real ones), road widths (class defaults),
deck heights (OSM/Overture give a level, not metres: 6.4 m per level), ramp lengths (5.5 percent from the deck to grade over the real
connected roads), metro structure dimensions, the Bhongir rock shape. Terrain is flat at y 0: no DEM is used here."""
import csv, json, math, re, sys, os, heapq, collections, struct, pickle, time
import numpy as np
csv.field_size_limit(10**9)
DATA = sys.argv[1]; OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
LAT0, LON0 = 17.70160, 79.19630
MX = 111320.0 * math.cos(math.radians(LAT0)); MZ = 110574.0
ll = lambda lon, lat: ((lon - LON0) * MX, -(lat - LAT0) * MZ)
_t0 = time.time()
def log(*a): print(f'[{time.time()-_t0:6.1f}]', *a, flush=True)
t = open(f'{OUT}/jangaon-lite.js').read(); JL = json.loads(t[t.index('{'):t.index('};') + 1]); del t
RX0, RZ0, RX1, RZ1 = JL['bounds']
T = 640.0
NX = math.ceil((RX0 - ll(78.47, 0)[0]) / T); HX0 = RX0 - NX * T
HZ0 = math.floor(ll(0, 17.78)[1] / T) * T; NZ = math.ceil((ll(0, 17.36)[1] - HZ0) / T); HZ1 = HZ0 + NZ * T
GRADE = .055; DECK = 6.4
CITY = (ll(78.485, 0)[0], ll(0, 17.465)[1], ll(78.605, 0)[0], ll(0, 17.385)[1])
inCity = lambda x, z: CITY[0] <= x <= CITY[2] and CITY[1] <= z <= CITY[3]
tile_of = lambda x, z: (int((x - HX0) // T), int((z - HZ0) // T))
def parts(w): return [[tuple(map(float, p.split())) for p in q.split(',')] for q in re.findall(r'\(([^()]+)\)', w)]
def plen(p): return sum(math.hypot(b[0]-a[0], b[1]-a[1]) for a, b in zip(p, p[1:]))
def segd(x, z, a, b):
    dx, dz = b[0]-a[0], b[1]-a[1]; L = dx*dx+dz*dz or 1e-9; t_ = max(0, min(1, ((x-a[0])*dx+(z-a[1])*dz)/L))
    return math.hypot(x-a[0]-t_*dx, z-a[1]-t_*dz), t_

# ---------------------------------------------------------------------------------------- 1. roads as graph pieces split at connectors
#        type, two-way width, one-way width, km/h
CLS = {'motorway': ('highway', 11, 10.5, 90), 'trunk': ('highway', 11, 9.5, 75), 'primary': ('tar', 10, 8, 50), 'secondary': ('tar', 8, 7, 40), 'tertiary': ('tar', 7, 6, 35),
       'residential': ('cc', 5, 4.5, 22), 'unclassified': ('cc', 5, 4.5, 25), 'living_street': ('cc', 4.5, 4, 18), 'service': ('cc', 4, 4, 15), 'track': ('dirt', 3.5, 3.5, 14), 'unknown': ('dirt', 3.6, 3.6, 16)}
def between(rule, f): b = rule.get('between'); return b is None or b[0] <= f <= b[1]
pieces = []      # dict(t,c,w,kmh,one,name,ref,pts,lv[per subsegment],a,b)
segs_raw = 0; skipped = collections.Counter()
cache = f'{DATA}/x/pieces.pkl'
if os.path.exists(cache) and os.path.getmtime(cache) > os.path.getmtime(f'{DATA}/x/seg2.csv'):
    pieces = pickle.load(open(cache, 'rb'))
else:
    for r in csv.DictReader(open(f'{DATA}/x/seg2.csv')):
        if r['subtype'] != 'road': continue
        segs_raw += 1
        if r['class'] not in CLS: skipped[r['class']] += 1; continue
        flags = json.loads(r['flags']) if r['flags'] else []
        if any('is_under_construction' in f.get('values', []) for f in flags): skipped['construction'] += 1; continue
        ty, w2, w1, kmh = CLS[r['class']]
        acc = json.loads(r['acc']) if r['acc'] else []
        one = any(a.get('access_type') == 'denied' and (a.get('when') or {}).get('heading') == 'backward' and not (a.get('when') or {}).get('mode') for a in acc)
        fwd_only_denied = any(a.get('access_type') == 'denied' and not (a.get('when') or {}).get('heading') and not (a.get('when') or {}).get('mode') and not (a.get('when') or {}).get('using') and not a.get('between') for a in acc)
        if fwd_only_denied and r['class'] in ('service', 'track', 'unknown'): skipped['private'] += 1; continue
        link = r['subclass'] == 'link' or any('is_link' in f.get('values', []) for f in flags)
        w = (w1 if one else w2); w = min(w, 6.5) if link else w
        routes = json.loads(r['routes']) if r['routes'] else []
        ref = next((('NH-' + q['ref']) for q in routes if q.get('network') == 'IN:NH' and q.get('ref')), None) or next((q.get('name') for q in routes if q.get('ref') in ('ORR', 'IRR')), None)
        lvr = json.loads(r['lv']) if r['lv'] else []
        tun = [f for f in flags if 'is_tunnel' in f.get('values', [])]
        br = [f for f in flags if 'is_bridge' in f.get('values', [])]
        for line in parts(r['wkt']):
            P = [ll(*q) for q in line]
            cum = [0]
            for a, b in zip(P, P[1:]): cum.append(cum[-1] + math.hypot(b[0]-a[0], b[1]-a[1]))
            L = cum[-1] or 1
            cuts = set()
            for q in lvr + tun + br:
                if q.get('between'): cuts.update(q['between'])
            # densify at rule ends so a level change sits at its true place
            Q = [P[0]]; C = [0.]
            for i in range(1, len(P)):
                for f in sorted(c for c in cuts if cum[i-1] < c*L < cum[i]):
                    u = (f*L-cum[i-1])/(cum[i]-cum[i-1]); Q.append((P[i-1][0]+(P[i][0]-P[i-1][0])*u, P[i-1][1]+(P[i][1]-P[i-1][1])*u)); C.append(f*L)
                Q.append(P[i]); C.append(cum[i])
            con = sorted((c['at'] if c.get('at') is not None else 0, c['connector_id']) for c in json.loads(r['con'] or '[]'))
            if len(con) < 2: con = [(0., r['id'] + 'a'), (1., r['id'] + 'b')]
            idx = []
            for at, cid in con:
                k = min(range(len(Q)), key=lambda i: abs(C[i] - at*L))
                if idx and idx[-1][0] == k: continue
                idx.append((k, cid))
            if idx[0][0] != 0: idx.insert(0, (0, r['id'] + 'a'))
            if idx[-1][0] != len(Q)-1: idx.append((len(Q)-1, r['id'] + 'b'))
            for (i0, a), (i1, b) in zip(idx, idx[1:]):
                pts = Q[i0:i1+1]; lv = []
                for k in range(i0, i1):
                    f = (C[k]+C[k+1])/2/L; v = 0
                    for q in lvr:
                        if between(q, f): v = q['value']
                    isb = any(between(q, f) for q in br); ist = any(between(q, f) for q in tun)
                    lv.append((v, isb, ist))
                pieces.append(dict(t=ty, c=r['class'], w=w, kmh=kmh, one=one, link=link, name=r['name'] or '', ref=ref, pts=pts, lv=lv, a=a, b=b, sid=r['id']))
    pickle.dump(pieces, open(cache, 'wb'))
    log('segments', segs_raw, 'skipped', skipped.most_common())
log('pieces', len(pieces))
# ---------------------------------------------------------------------------------------- 2. join to the Jangaon net at its west edge
jn = json.load(open(f'{OUT}/jangaon-net.json'))
pieces = [p for p in pieces if any(q[0] < RX0 for q in p['pts'])]
CUT = RX0 + 66                      # draw past the Jangaon edge a little: the Jangaon net stops up to 55 m inside its own edge
joins = []
JV = {}                              # Jangaon net vertices by 200 m cell
for e in jn['edges']:
    for q in (e[4][0], e[4][-1]):
        JV.setdefault((int(q[0]//200), int(q[1]//200)), []).append((q, e[3]))
def jnear(x, z, R):
    best = None
    for i in range(-1, 2):
        for j in range(-1, 2):
            for q, t_ in JV.get((int(x//200)+i, int(z//200)+j), []):
                d = math.hypot(q[0]-x, q[1]-z)
                if d < R and (not best or d < best[0]): best = (d, q)
    return best
kept = []
for p in pieces:
    P = p['pts']
    if all(q[0] < CUT for q in P): kept.append(p); continue
    # keep each run of the polyline west of the cut; the new end is a join node
    run = 0; runs = []
    for k in range(1, len(P)+1):
        if k == len(P) or (P[k][0] >= CUT) != (P[k-1][0] >= CUT):
            if P[run][0] < CUT: runs.append((run, k-1))
            run = k
    for u, v in runs:
        pts = list(P[u:v+1]); lv = list(p['lv'][u:v]); a = p['a'] if u == 0 else p['sid']+f'/c{u}'; b = p['b'] if v == len(P)-1 else p['sid']+f'/c{v}'
        if v < len(P)-1:
            A, B = P[v], P[v+1]; f_ = (CUT-A[0])/(B[0]-A[0]); pts.append((CUT, A[1]+(B[1]-A[1])*f_)); lv.append(p['lv'][v])
        if u > 0:
            A, B = P[u-1], P[u]; f_ = (CUT-A[0])/(B[0]-A[0]); pts.insert(0, (CUT, A[1]+(B[1]-A[1])*f_)); lv.insert(0, p['lv'][u-1])
        q = dict(p); q.update(pts=pts, lv=lv, a=a, b=b)
        kept.append(q)
        for nm, c in ((a, pts[0]), (b, pts[-1])):
            if c[0] == CUT and p['t'] in ('highway', 'tar'):
                jn_ = jnear(c[0], c[1], 90)
                if jn_: joins.append((nm, jn_[1], round(jn_[0], 1), p['c'], p['ref']))
pieces = kept
log('pieces', len(pieces), 'joins to the Jangaon net', [(j[1], j[2], j[3], j[4]) for j in joins])
# ---------------------------------------------------------------------------------------- 3. route on the real graph
G = collections.defaultdict(list)
for n, p in enumerate(pieces):
    L = plen(p['pts']); s = L / (p['kmh'] / 3.6)
    G[p['a']].append((p['b'], L, s, n))
    if not p['one']: G[p['b']].append((p['a'], L, s, n))
PT = {}
for p in pieces: PT[p['a']] = p['pts'][0]; PT[p['b']] = p['pts'][-1]
def nearest_node(x, z, cl=None):
    best = None
    for p in pieces:
        if cl and p['c'] not in cl: continue
        for k in ('a', 'b'):
            c = PT[p[k]]
            if abs(c[0]-x) > 800 or abs(c[1]-z) > 800: continue
            d = math.hypot(c[0]-x, c[1]-z)
            if not best or d < best[0]: best = (d, p[k])
    return best[1]
def route(src, dst):
    d = {s: 0 for s in src}; pv = {}; pq = [(0, s) for s in src]; heapq.heapify(pq)
    while pq:
        c, u = heapq.heappop(pq)
        if u == dst: break
        if c > d[u]: continue
        for v, L, s, n in G[u]:
            if c+s < d.get(v, 1e15): d[v] = c+s; pv[v] = (u, n); heapq.heappush(pq, (c+s, v))
    if dst not in d: return None
    path = []; u = dst
    while u in pv: u, n = pv[u]; path.append(n)
    return path[::-1], d[dst]
def describe(path):
    cl = collections.Counter(); rf = collections.Counter()
    for n in path:
        p = pieces[n]; L = plen(p['pts']); cl[p['c']] += L; rf[p['ref'] or p['name'] or '-'] += L
    return {'km': round(sum(cl.values())/1000, 1), 'classes_km': {k: round(v/1000, 1) for k, v in cl.most_common()}, 'names_km': {k: round(v/1000, 1) for k, v in rf.most_common(10)}}
SEC = ll(78.50112, 17.43370)   # station building entrance, audit coordinate; OSM node Secunderabad Junction is 95 m east
secN = nearest_node(SEC[0], SEC[1], ('primary', 'secondary', 'tertiary', 'trunk', 'unclassified', 'residential', 'service'))
src = [j[0] for j in joins if j[3] == 'trunk']
R1 = route(src, secN); assert R1, 'no route from the Jangaon edge to Secunderabad'
rep = {'jangaon_edge_to_secunderabad': describe(R1[0]), 'minutes_at_class_speeds': round(R1[1]/60)}
log('route', rep)
# corridor raster, 25 m cells
CS = 25.
RW, RH_ = int((RX0+200-HX0)/CS)+1, int((HZ1-HZ0)/CS)+1
def raster(lines):
    a = np.zeros((RH_, RW), bool)
    for P in lines:
        for u, v in zip(P, P[1:]):
            n = max(1, int(math.hypot(v[0]-u[0], v[1]-u[1])/20))
            for k in range(n+1):
                i = int((u[0]+(v[0]-u[0])*k/n-HX0)/CS); j = int((u[1]+(v[1]-u[1])*k/n-HZ0)/CS)
                if 0 <= i < RW and 0 <= j < RH_: a[j, i] = True
    return a
def dilate(a, R):
    r = int(R/CS); I = np.zeros((a.shape[0]+1, a.shape[1]+1), np.int32); I[1:, 1:] = a.astype(np.int32).cumsum(0).cumsum(1)
    h, w = a.shape; y0 = np.clip(np.arange(h)-r, 0, h); y1 = np.clip(np.arange(h)+r+1, 0, h); x0 = np.clip(np.arange(w)-r, 0, w); x1 = np.clip(np.arange(w)+r+1, 0, w)
    return (I[y1[:, None], x1[None, :]]-I[y0[:, None], x1[None, :]]-I[y1[:, None], x0[None, :]]+I[y0[:, None], x0[None, :]]) > 0
routeL = [pieces[n]['pts'] for n in R1[0]]
near2k = dilate(raster(routeL), 2000); near6k = dilate(raster(routeL), 6000)
at = lambda A, x, z: 0 <= int((x-HX0)/CS) < RW and 0 <= int((z-HZ0)/CS) < RH_ and A[int((z-HZ0)/CS), int((x-HX0)/CS)]
def keepp(p):
    c = p['pts'][len(p['pts'])//2]
    if inCity(*c) or at(near2k, *c): return True
    return p['c'] in ('motorway', 'trunk', 'primary', 'secondary') and at(near6k, *c)
kp = [p for p in pieces if keepp(p)]
# largest connected piece only, so nothing dead floats on the map
par = {}
def find(a):
    par.setdefault(a, a)
    while par[a] != a: par[a] = par[par[a]]; a = par[a]
    return a
for p in kp: par[find(p['a'])] = find(p['b'])
main = find(secN); kp = [p for p in kp if find(p['a']) == main]
pieces = kp
log('pieces kept', len(pieces), 'km', round(sum(plen(p['pts']) for p in pieces)/1000), collections.Counter(p['c'] for p in pieces).most_common())
# ---------------------------------------------------------------------------------------- 4. rail and metro from OSM
osm = json.load(open(f'{DATA}/x/osm_extra.json'))['elements']
major = json.load(open(f'{DATA}/major.json'))['elements']
def way(e): return [ll(q['lon'], q['lat']) for q in e.get('geometry', []) if q]
rail = []; metro = []; plats = []
for e in osm:
    tg = e.get('tags', {})
    if e['type'] != 'way': continue
    if tg.get('railway') == 'rail':
        P = way(e)
        if any(q[0] < RX0+40 and (inCity(*q) or at(near2k, *q)) for q in P): rail.append(dict(p=P, br=tg.get('bridge') not in (None, 'no'), layer=int(tg.get('layer', 0) or 0) if str(tg.get('layer', '0')).lstrip('-').isdigit() else 0))
    if tg.get('railway') == 'subway':
        P = way(e)
        if any(inCity(*q) for q in P): metro.append(dict(p=P, name=tg.get('name') or '', tun=tg.get('tunnel') not in (None, 'no'), one=tg.get('oneway')))
    if tg.get('railway') == 'platform':
        P = way(e)
        if P and any(inCity(*q) or at(near2k, *q) for q in P): plats.append(P)
log('rail ways', len(rail), 'km', round(sum(plen(r['p']) for r in rail)/1000), 'metro ways', len(metro), 'km', round(sum(plen(r['p']) for r in metro)/1000), 'tunnel km', round(sum(plen(r['p']) for r in metro if r['tun'])/1000), 'platforms', len(plats))
# ---------------------------------------------------------------------------------------- 5. levels: which spans really pass over something
def isect(a, b, c, d):
    r = (b[0]-a[0], b[1]-a[1]); s = (d[0]-c[0], d[1]-c[1]); de = r[0]*s[1]-r[1]*s[0]
    if abs(de) < 1e-9: return None
    t_ = ((c[0]-a[0])*s[1]-(c[1]-a[1])*s[0])/de; u = ((c[0]-a[0])*r[1]-(c[1]-a[1])*r[0])/de
    return t_ if 0 < t_ < 1 and 0 < u < 1 else None
GRID = collections.defaultdict(list)
def seg_cells(a, b):
    n = max(1, int(math.hypot(b[0]-a[0], b[1]-a[1])/40))
    return {(int((a[0]+(b[0]-a[0])*k/n)//60), int((a[1]+(b[1]-a[1])*k/n)//60)) for k in range(n+1)}
for n, p in enumerate(pieces):
    if p['t'] == 'dirt': continue
    for k, (a, b) in enumerate(zip(p['pts'], p['pts'][1:])):
        for c in seg_cells(a, b): GRID[c].append((n, k))
for n, r in enumerate(rail):
    for k, (a, b) in enumerate(zip(r['p'], r['p'][1:])):
        for c in seg_cells(a, b): GRID[c].append((-1-n, k))
def seg_of(q):
    n, k = q
    if n >= 0: P = pieces[n]['pts']
    else: P = rail[-1-n]['p']
    return P[k], P[k+1]
for p in pieces: p['lvl'] = [0]*len(p['lv'])
cand = [(n, k) for n, p in enumerate(pieces) for k, l in enumerate(p['lv']) if (l[0] > 0 or l[1])]
under = [(n, k) for n, p in enumerate(pieces) for k, l in enumerate(p['lv']) if ((l[0] < 0 or l[2]) and p['t'] != 'dirt')]
log('bridge subsegments', len(cand), 'tunnel subsegments', len(under))
# clusters of touching bridge subsegments
vid = {}
def vkey(n, i):
    p = pieces[n]
    return p['a'] if i == 0 else p['b'] if i == len(p['pts'])-1 else (n, i)
cp = {}
def cf(a):
    cp.setdefault(a, a)
    while cp[a] != a: cp[a] = cp[cp[a]]; a = cp[a]
    return a
for n, k in cand: cp[cf(vkey(n, k))] = cf(vkey(n, k+1))
clusters = collections.defaultdict(list)
for n, k in cand: clusters[cf(vkey(n, k))].append((n, k))
over = 0; flat = 0; raised_rail = collections.defaultdict(list)
for p in pieces: p['xp'] = []            # (x, z, level): a real crossing. The deck spans these points only; a long tagged bridge is not a long flyover
for cid, L in clusters.items():
    mine = set(L); hit = False; lev = max(max(1, pieces[n]['lv'][k][0]) for n, k in L)
    for n, k in L:
        a, b = pieces[n]['pts'][k], pieces[n]['pts'][k+1]
        for c in seg_cells(a, b):
            for q in GRID.get(c, []):
                if q in mine or (q[0] >= 0 and q[0] == n): continue
                if q[0] >= 0:
                    m = pieces[q[0]]
                    if m['lv'][q[1]][0] >= lev and m['lv'][q[1]][0] > 0: continue      # the other one is the higher
                    if {vkey(q[0], q[1]), vkey(q[0], q[1]+1)} & {vkey(n, k), vkey(n, k+1)}: continue
                    if m['c'] in ('service', 'track', 'unknown'): continue            # a track across a tagged span does not make it a flyover
                c0, c1 = seg_of(q); t_ = isect(a, b, c0, c1)
                if t_ is not None: hit = True; pieces[n]['xp'].append((a[0]+(b[0]-a[0])*t_, a[1]+(b[1]-a[1])*t_, min(3, lev)))
    if hit: over += 1
    else: flat += 1
# known structures the geometry test cannot see (their crossing roads are not in the data): (lon0, lat0, lon1, lat1, level, name)
FORCE = [(78.5560, 17.3695, 78.5595, 17.3815, 1, 'Nagole Flyover')]
# Musi bridge: all four carriageways, deck over the river polygon, which crosses this road between 17.38253 and 17.3835 N (Overture water)
MUSI = (ll(78.5570, 0)[0], ll(0, 17.3840)[1], ll(78.5597, 0)[0], ll(0, 17.3820)[1])
forced = 0
for lo0, la0, lo1, la1, lv_, nm in FORCE:
    x0, z1 = ll(lo0, la0); x1, z0 = ll(lo1, la1)
    for n, p in enumerate(pieces):
        if p['t'] not in ('highway', 'tar') or p['c'] == 'tertiary': continue
        for k, (a, b) in enumerate(zip(p['pts'], p['pts'][1:])):
            m_ = ((a[0]+b[0])/2, (a[1]+b[1])/2)
            if x0 < m_[0] < x1 and z0 < m_[1] < z1 and (p['lv'][k][0] > 0 or p['lv'][k][1]): p['lvl'][k] = lv_; p['name'] = nm; forced += 1
log('forced structure subsegments', forced)
log('bridge spans that pass over a road or rail', over, 'bridges over water or nothing kept at grade', flat)
# an underpass cannot be dug into the flat ground: the road or railway above it is raised instead
u_road = 0
for n, k in under:
    a, b = pieces[n]['pts'][k], pieces[n]['pts'][k+1]
    for c in seg_cells(a, b):
        for q in GRID.get(c, []):
            if q[0] >= 0:
                m = pieces[q[0]]
                if m['lv'][q[1]][0] < 0 or m['lv'][q[1]][2] or q[0] == n: continue
                t2 = isect(a, b, *seg_of(q))
                if t2 is not None and m['c'] not in ('service', 'track', 'unknown'): m['xp'].append((a[0]+(b[0]-a[0])*t2, a[1]+(b[1]-a[1])*t2, 1)); u_road += 1
            else:
                t_ = isect(a, b, *seg_of(q))
                if t_ is not None: raised_rail[-1-q[0]].append(q[1])
log('over-road spans raised above tunnels', u_road, 'rail ways raised', len(raised_rail))
# ---------------------------------------------------------------------------------------- 6. heights on a densified copy
def dens(P, L_, step=28):
    out = [P[0]]; ol = []
    for k, (a, b) in enumerate(zip(P, P[1:])):
        n = max(1, int(math.hypot(b[0]-a[0], b[1]-a[1])/step))
        for i in range(1, n+1): out.append((a[0]+(b[0]-a[0])*i/n, a[1]+(b[1]-a[1])*i/n)); ol.append(L_[k])
    return out, ol
H = {}                       # vertex -> height
adj = collections.defaultdict(list)
heads = []
for n, p in enumerate(pieces):
    elev_near = True
    P, L_ = dens(p['pts'], p['lvl']); p['dp'] = P; p['dl'] = L_
    keys = [p['a']] + [(n, i) for i in range(1, len(P)-1)] + [p['b']] if len(P) > 1 else [p['a']]
    p['dk'] = keys
    for i, (a, b) in enumerate(zip(P, P[1:])):
        d = math.hypot(b[0]-a[0], b[1]-a[1]); adj[keys[i]].append((keys[i+1], d)); adj[keys[i+1]].append((keys[i], d))
        if L_[i] > 0:
            for k in (keys[i], keys[i+1]): H[k] = max(H.get(k, 0), L_[i]*DECK)
    for x_, z_, l_ in p['xp']:
        for i, q in enumerate(P):
            if math.hypot(q[0]-x_, q[1]-z_) < 34: H[keys[i]] = max(H.get(keys[i], 0), l_*DECK)
    if p['t'] in ('highway', 'tar'):
        for i, q in enumerate(P):
            if MUSI[0] < q[0] < MUSI[2] and MUSI[1] < q[1] < MUSI[3]: H[keys[i]] = max(H.get(keys[i], 0), DECK); p['name'] = p['name'] if p['c'] == 'tertiary' else 'Musi Bridge'
    if len(p['xp']) > 1:                 # two crossings on one span under 420 m apart are one deck, not two humps
        idx = sorted({min(range(len(P)), key=lambda i: math.hypot(P[i][0]-x_, P[i][1]-z_)) for x_, z_, l_ in p['xp']})
        for u, v in zip(idx, idx[1:]):
            if plen(P[u:v+1]) < 420:
                for i in range(u, v+1): H[keys[i]] = max(H.get(keys[i], 0), min(l_ for _, _, l_ in p['xp'])*DECK)
ADJ = adj
def relax():
    tick = 0; pq = []
    for k, v in H.items(): tick += 1; pq.append((-v, tick, k))
    heapq.heapify(pq)
    while pq:
        v, _, k = heapq.heappop(pq); v = -v
        if v < H.get(k, 0): continue
        for m, d in ADJ[k]:
            w_ = v - GRADE*d
            if w_ > H.get(m, 0) and w_ > 0: H[m] = w_; tick += 1; heapq.heappush(pq, (-w_, tick, m))
    for p in pieces: p['dh'] = [H.get(k, 0.) for k in p['dk']]
relax()
lifted = 0
# clearance check at every crossing without a shared node; a ramp that still sits low over a road is raised and the heights solved again
def crossings():
    GRID2 = collections.defaultdict(list); bad = []; okc = 0; seen = set()
    for n, p in enumerate(pieces):
        if p['t'] == 'dirt' or p['c'] in ('service',) or max(p['dh']) < .5: continue
        for k, (a, b) in enumerate(zip(p['dp'], p['dp'][1:])):
            for c in seg_cells(a, b): GRID2[c].append((n, k))
    for n, p in enumerate(pieces):
        if p['t'] == 'dirt' or p['c'] in ('service',): continue
        for k, (a, b) in enumerate(zip(p['dp'], p['dp'][1:])):
            for c in seg_cells(a, b):
                for m, j in GRID2.get(c, []):
                    if m == n or (m, j, n, k) in seen or (n, k, m, j) in seen: continue
                    q = pieces[m]; c0, c1 = q['dp'][j], q['dp'][j+1]; t_ = isect(a, b, c0, c1)
                    if t_ is None: continue
                    seen.add((n, k, m, j))
                    if {q['dk'][j], q['dk'][j+1]} & {p['dk'][k], p['dk'][k+1]}: continue
                    h1 = p['dh'][k]+(p['dh'][k+1]-p['dh'][k])*t_; h2 = (q['dh'][j]+q['dh'][j+1])/2
                    if abs(h1-h2) >= 4.2: okc += 1
                    else: bad.append((h1, h2, n, k, m, j))
    return okc, bad
for it in range(4):
    okc, bad = crossings()
    if not bad: break
    for h1, h2, n, k, m, j in bad:
        if max(h1, h2) < .3: continue                      # both at grade: an at-grade crossing, left as one
        n_, k_, lo = (n, k, h2) if h1 >= h2 else (m, j, h1)
        for key_ in (pieces[n_]['dk'][k_], pieces[n_]['dk'][k_+1]): H[key_] = max(H.get(key_, 0), lo+5.0)
    relax()
okc, bad = crossings()
lifted = sum(plen(p['dp'])*(sum(1 for h in p['dh'] if h > .3)/len(p['dh'])) for p in pieces)
bad = [(round(pieces[n]['dp'][k][0]), round(pieces[n]['dp'][k][1]), round(h1, 1), round(h2, 1), pieces[n]['c'], pieces[m]['c']) for h1, h2, n, k, m, j in bad]
CORR = (ll(78.515, 0)[0], ll(0, 17.445)[1], ll(78.572, 0)[0], ll(0, 17.392)[1])
for p in pieces:
    m_ = p['dp'][len(p['dp'])//2]
    if p['t'] in ('highway', 'tar') and p['c'] in ('trunk', 'primary') and not p['link'] and CORR[0] < m_[0] < CORR[2] and CORR[1] < m_[1] < CORR[3]: p['w'] = 12. if p['one'] else 15.
# ---------- dual carriageways: real gap between the centrelines sets the width, so two ribbons never overlap; median down the gap
OW = collections.defaultdict(list)
for n, p in enumerate(pieces):
    if p['one'] and p['t'] == 'highway':
        for k, (a, b) in enumerate(zip(p['dp'], p['dp'][1:])): OW[(int(a[0]//60), int(a[1]//60))].append((n, a, b))
MED = []; narrowed = 0
for n, p in enumerate(pieces):
    if not (p['one'] and p['t'] == 'highway') or p['link']: continue
    gaps = []
    for k, (a, b) in enumerate(zip(p['dp'], p['dp'][1:])):
        L = math.hypot(b[0]-a[0], b[1]-a[1]) or 1; ux, uz = (b[0]-a[0])/L, (b[1]-a[1])/L; best = None
        for i in range(-1, 2):
            for j in range(-1, 2):
                for m, c, e in OW.get((int(a[0]//60)+i, int(a[1]//60)+j), []):
                    if m == n: continue
                    Lc = math.hypot(e[0]-c[0], e[1]-c[1]) or 1
                    if ((e[0]-c[0])*ux+(e[1]-c[1])*uz)/Lc > -.7: continue
                    d, t_ = segd(a[0], a[1], c, e)
                    if not best or d < best[0]: best = (d, c[0]+(e[0]-c[0])*t_, c[1]+(e[1]-c[1])*t_, m)
        if best and best[0] < 45: gaps.append(best[0]); p.setdefault('gap', {})[k] = best
    if gaps:
        gaps.sort(); g = gaps[len(gaps)//8]
        w = max(6., min(p['w'], g-1.1))
        if w < p['w']: p['w'] = round(w, 1); narrowed += 1
for n, p in enumerate(pieces):
    for k, b in p.get('gap', {}).items():
        a = p['dp'][k]
        if n < b[3] and p['dh'][k] < .1 and b[0] > (p['w']+pieces[b[3]]['w'])/2+.5: MED.append(((a[0]+b[1])/2, (a[1]+b[2])/2, k, n))
log('carriageway widths narrowed to their real gap', narrowed, 'median points', len(MED))
log('lifted km', round(lifted/1000, 1), 'crossings with clearance', okc, 'crossings with less than 4.2 m (ramp over a road)', len(bad), bad[:12])
rep.update(bridge_spans=over, bridges_at_grade=flat, lifted_km=round(lifted/1000, 1), crossings_ok=okc, crossings_low=len(bad))
pickle.dump(dict(pieces=pieces, rail=rail, metro=metro, plats=plats, joins=joins, rep=rep, raised_rail=dict(raised_rail), routeN=None, routeL=routeL), open(f'{DATA}/x/stage6.pkl', 'wb'))
# ---------------------------------------------------------------------------------------- 7. which Jangaon net highways are really NH-163
east = []
for r in csv.DictReader(open(f'{DATA}/x/trunk_east.csv')):
    rs = json.loads(r['routes']) if r['routes'] else []
    rf = next((('NH-' + q['ref']) for q in rs if q.get('network') == 'IN:NH' and q.get('ref')), None)
    for l in parts(r['wkt']): east.append(([ll(*q) for q in l], rf))
jnames = {}
for n, e in enumerate(jn['edges']):
    if e[3] != 'highway': continue
    m = e[4][len(e[4])//2]; best = (1e9, None)
    for P, rf in east:
        for a, b in zip(P, P[1:]):
            d = segd(m[0], m[1], a, b)[0]
            if d < best[0]: best = (d, rf)
    if best[0] < 30 and best[1]: jnames[n] = best[1]
log('Jangaon highway edges by ref', collections.Counter(jnames.values()))
# ---------------------------------------------------------------------------------------- 8. buildings
RS = 30.
RH = collections.defaultdict(list)
for p in pieces:
    for a, b, h0 in zip(p['dp'], p['dp'][1:], p['dh']):
        RH[(int(a[0]//RS), int(a[1]//RS))].append((a, b, p['w'], p['t'], h0))
for r in rail:
    for a, b in zip(r['p'], r['p'][1:]):
        n = max(1, int(math.hypot(b[0]-a[0], b[1]-a[1])/28)); u = a
        for k in range(1, n+1):
            v = (a[0]+(b[0]-a[0])*k/n, a[1]+(b[1]-a[1])*k/n); RH[(int(u[0]//RS), int(u[1]//RS))].append((u, v, 4.4, 'rail', 0)); u = v
def near_segs(x, z, R=1):
    i, j = int(x//RS), int(z//RS)
    for u in range(i-R, i+R+1):
        for v in range(j-R, j+R+1):
            q = RH.get((u, v))
            if q: yield from q
def clip(poly, ax, az, nx, nz, off):
    out = []
    for i in range(len(poly)):
        P_, Q = poly[i], poly[(i+1) % len(poly)]
        dp = (P_[0]-ax)*nx+(P_[1]-az)*nz-off; dq = (Q[0]-ax)*nx+(Q[1]-az)*nz-off
        if dp >= 0: out.append(P_)
        if (dp >= 0) != (dq >= 0):
            t_ = dp/(dp-dq); out.append((P_[0]+(Q[0]-P_[0])*t_, P_[1]+(Q[1]-P_[1])*t_))
    return out
def area(p): return .5*sum(p[i][0]*p[(i+1) % len(p)][1]-p[(i+1) % len(p)][0]*p[i][1] for i in range(len(p)))
near250 = dilate(raster([p['dp'] for p in pieces if p['c'] in ('motorway', 'trunk', 'primary', 'secondary')]), 250)
aiims = ll(78.7832, 17.4776)
inAiims = lambda x, z: abs(x-aiims[0]) < 750 and abs(z-aiims[1]) < 750      # the campus lies past the 250 m road buffer
stadiumW = next(e for e in osm if e.get('tags', {}).get('name') == 'Rajiv Gandhi International Cricket Stadium' and e['type'] == 'way')
stP = way(stadiumW)[:-1]
def pinp(x, z, p):
    c = False
    for i in range(len(p)):
        a, b = p[i], p[(i+1) % len(p)]
        if (a[1] > z) != (b[1] > z) and x < (b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0]: c = not c
    return c
STC = ll(78.55054, 17.40657); SA, SB = 115., 125.     # stadium bowl, audit outline; the OSM way is the grounds compound
inBowl = lambda x, z, m=8: ((x-STC[0])/(SA+m))**2+((z-STC[1])/(SB+m))**2 < 1
FORT = next(e for e in osm if e.get('tags', {}).get('name') == 'Bhongir fort' and e['type'] == 'way')
fort0 = ll((FORT['bounds']['minlon']+FORT['bounds']['maxlon'])/2, (FORT['bounds']['minlat']+FORT['bounds']['maxlat'])/2)
RA, RB_ = 275., 162.5           # rock base semi-axes, E-W long
def rock_cost(cx, cz):
    c = 0.
    for p in pieces:
        for q in p['dp'][::2]:
            if abs(q[0]-cx) < RA+25 and abs(q[1]-cz) < RB_+25 and ((q[0]-cx)/(RA+10))**2+((q[1]-cz)/(RB_+10))**2 < 1: c += 8 if p['t'] in ('tar', 'highway') or p['name'] else 1 if p['t'] != 'dirt' else .2
    return c+math.hypot(cx-fort0[0], cz-fort0[1])/200
fortP = min(((fort0[0]+i*40, fort0[1]+j*40) for i in range(-8, 9) for j in range(-8, 9)), key=lambda c: rock_cost(*c))
inRock = lambda x, z: ((x-fortP[0])/(RA+10))**2+((z-fortP[1])/(RB_+10))**2 < 1
log('rock centre', fortP, 'moved', round(math.hypot(fortP[0]-fort0[0], fortP[1]-fort0[1])), 'cost', round(rock_cost(*fortP), 1), 'roads inside', [(p['c'], p['name']) for p in pieces if any(inRock(*q) for q in p['dp'])][:10])
rings = []; seen = set(); hreal = 0; nraw = 0
bc = f'{DATA}/x/rings.pkl'
if os.path.exists(bc) and os.path.getmtime(bc) > os.path.getmtime(f'{DATA}/x/stage6.pkl'):
    rings, dropped, trimmed = pickle.load(open(bc, 'rb'))
else:
    for f in ('buildings_city.csv', 'x/bld_gap.csv', 'buildings_all.csv'):
        for r in csv.DictReader(open(f'{DATA}/{f}')):
            if r['id'] in seen: continue
            w = r['wkt']; m = re.search(r'\(\(([^()]+)\)', w)
            if not m: continue
            c0 = m.group(1); k = c0.find(','); lo, la = map(float, c0[:k].split())
            x0, z0 = ll(lo, la); nraw += 1
            if x0 >= RX0 or not (inCity(x0, z0) or at(near250, x0, z0) or inAiims(x0, z0)): continue
            seen.add(r['id'])
            p = [ll(*map(float, q.split())) for q in c0.split(',')]
            if p[0] == p[-1]: p = p[:-1]
            if len(p) < 3 or len(p) > 400: continue
            a = area(p)
            if abs(a) < 12: continue
            if a < 0: p = p[::-1]
            cx = sum(c[0] for c in p)/len(p); cz = sum(c[1] for c in p)/len(p)
            if cx >= RX0: continue
            if inBowl(cx, cz) or inRock(cx, cz): continue      # replaced by the stadium bowl and the rock
            rings.append(dict(p=p, a=abs(a), x=cx, z=cz, cl=r['class'], h=float(r['height']) if r['height'] else None, fl=int(float(r['num_floors'])) if r['num_floors'] else None))
    log('footprints read', nraw, 'in city box or near arterials', len(rings))
    keep = []; dropped = trimmed = 0
    for b in rings:
        p = b['p']; dead = False; a0 = b['a']
        R = 1 if a0 < 2000 else 3
        xs = [q[0] for q in p]; zs = [q[1] for q in p]; bx0, bx1, bz0, bz1 = min(xs), max(xs), min(zs), max(zs)
        for a, c, w, t_, h0 in near_segs(b['x'], b['z'], R):
            half = w/2 + .7
            if max(a[0], c[0])+half < bx0 or min(a[0], c[0])-half > bx1 or max(a[1], c[1])+half < bz0 or min(a[1], c[1])-half > bz1: continue
            if segd(b['x'], b['z'], a, c)[0] < w/2: dead = True; break
            if not any(segd(q[0], q[1], a, c)[0] < half for q in p): continue
            L = math.hypot(c[0]-a[0], c[1]-a[1]) or 1; ux, uz = (c[0]-a[0])/L, (c[1]-a[1])/L
            s = 1 if ((b['x']-a[0])*-uz+(b['z']-a[1])*ux) >= 0 else -1
            p = clip(p, a[0], a[1], -uz*s, ux*s, half)
            if len(p) < 3: dead = True; break
        if dead or abs(area(p)) < 10: dropped += 1; continue
        if len(p) != len(b['p']): trimmed += 1
        b['p'] = p; b['a'] = abs(area(p)); keep.append(b)
    rings = keep
    pickle.dump((rings, dropped, trimmed), open(bc, 'wb'))
log('footprints kept', len(rings), 'dropped in road', dropped, 'trimmed', trimmed)
# footprint gaps: OSM buildings Overture lacks, then inferred plots where a built-up block has a hole. Both flagged, heights inferred
green = json.load(open(f'{DATA}/x/osm_green.json'))['elements']
RC = collections.defaultdict(list)
def addc(g):
    for q in g['p']: RC[(int(q[0]//40), int(q[1]//40))].append(g)
for g in rings: addc(g)
WP = collections.defaultdict(list); WL = collections.defaultdict(list)
for r_ in csv.DictReader(open(f'{DATA}/water.csv')):
    for ring in parts(r_['wkt']):
        P_ = [ll(*q) for q in ring]
        if max(q[0] for q in P_)-min(q[0] for q in P_) > 50000: continue
        if 'POLYGON' in r_['wkt'] and len(P_) > 3:
            bb = (min(q[0] for q in P_), min(q[1] for q in P_), max(q[0] for q in P_), max(q[1] for q in P_))
            for i in range(int(bb[0]//200), int(bb[2]//200)+1):
                for j in range(int(bb[1]//200), int(bb[3]//200)+1): WP[(i, j)].append(P_)
        else:
            for u, v in zip(P_, P_[1:]):
                n = max(1, int(math.dist(u, v)/30))
                for k in range(n+1): WL[(int((u[0]+(v[0]-u[0])*k/n)//60), int((u[1]+(v[1]-u[1])*k/n)//60))].append((u, v))
def wet(x, z):
    if any(pinp(x, z, P_) for P_ in WP.get((int(x//200), int(z//200)), [])): return True
    return any(segd(x, z, u, v)[0] < 7 for i in (-1, 0, 1) for j in (-1, 0, 1) for u, v in WL.get((int(x//60)+i, int(z//60)+j), []))
def covered(x, z, m=0):
    for i in (-1, 0, 1):
        for j in (-1, 0, 1):
            for g in RC.get((int(x//40)+i, int(z//40)+j), []):
                if (m and min(math.hypot(q[0]-x, q[1]-z) for q in g['p']) < m) or pinp(x, z, g['p']): return True
    return False
MH = collections.defaultdict(list)
for m in metro:
    for u, v in zip(m['p'], m['p'][1:]):
        n = max(1, int(math.dist(u, v)/30))
        for k in range(n+1): MH[(int((u[0]+(v[0]-u[0])*k/n)//60), int((u[1]+(v[1]-u[1])*k/n)//60))].append((u, v))
def plot_ok(p, gap=2.2):
    """every sample of the whole footprint: not in a building, road, rail, track or water; and no neighbour's corner inside the plot"""
    xs = [q[0] for q in p]; zs = [q[1] for q in p]; pts = list(p)
    for i in range(int(min(xs)), int(max(xs))+2, 2):
        for j in range(int(min(zs)), int(max(zs))+2, 2):
            if pinp(i, j, p): pts.append((i, j))
    for q in pts:
        if covered(q[0], q[1]) or wet(q[0], q[1]): return False
        if any(segd(q[0], q[1], u, v)[0] < 6 for i in (-1, 0, 1) for j in (-1, 0, 1) for u, v in MH.get((int(q[0]//60)+i, int(q[1]//60)+j), [])): return False
        for a, c, w, t_, h0 in near_segs(q[0], q[1], 1):
            if segd(q[0], q[1], a, c)[0] < w/2+gap: return False
    cx, cz = sum(xs)/len(xs), sum(zs)/len(zs)
    for i in range(-1, 2):
        for j in range(-1, 2):
            for g in RC.get((int(cx//40)+i, int(cz//40)+j), []):
                if any(pinp(q[0], q[1], p) for q in g['p']): return False
    return True
nosm = 0
for e in green:
    if e['type'] != 'way' or 'building' not in e.get('tags', {}) or len(e.get('geometry', [])) < 4: continue
    p = way(e)[:-1]; a = area(p)
    if abs(a) < 20: continue
    if a < 0: p = p[::-1]
    cx, cz = sum(q[0] for q in p)/len(p), sum(q[1] for q in p)/len(p)
    if cx >= RX0 or inBowl(cx, cz) or not plot_ok(p): continue
    g = dict(p=p, a=abs(a), x=cx, z=cz, cl='', h=None, fl=None, src='osm'); rings.append(g); addc(g); nosm += 1
GREEN = []                       # forest and campus land
for e in green:
    tg = e.get('tags', {})
    if e['type'] != 'way' or len(e.get('geometry', [])) < 4: continue
    k = 'wood' if tg.get('natural') == 'wood' or tg.get('landuse') == 'forest' else 'campus' if tg.get('name') in ('Center for Cellular and molecular biology', 'IICT Quarters') else 'park' if tg.get('leisure') in ('park', 'garden') or tg.get('landuse') == 'grass' else None
    if k: GREEN.append((k, way(e)[:-1], tg.get('name')))
ingreen = lambda x, z: any(min(q[0] for q in P) <= x <= max(q[0] for q in P) and pinp(x, z, P) for k, P, n in GREEN)
nfill = 0; c0 = CITY
for ix in range(int(c0[0]//24), int(c0[2]//24)):
    for iz in range(int(c0[1]//24), int(c0[3]//24)):
        x, z = ix*24+12, iz*24+12
        if covered(x, z, 9): continue
        if len(RC.get((int(x//40), int(z//40)), []))+len(RC.get((int(x//40)+1, int(z//40)), []))+len(RC.get((int(x//40)-1, int(z//40)), []))+len(RC.get((int(x//40), int(z//40)+1), []))+len(RC.get((int(x//40), int(z//40)-1), [])) < 60: continue      # only holes in a built-up block
        nr = min(((segd(x, z, a, c)[0], a, c) for a, c, w, t_, h0 in near_segs(x, z, 2) if t_ != 'rail'), default=None, key=lambda q: q[0])
        if not nr or nr[0] > 42 or nr[0] < 9: continue
        L = math.dist(nr[1], nr[2]) or 1; ux, uz = (nr[2][0]-nr[1][0])/L, (nr[2][1]-nr[1][1])/L; hw_, hd_ = 8., 6.5
        p = [(x+ux*a+-uz*b, z+uz*a+ux*b) for a, b in ((-hw_, -hd_), (hw_, -hd_), (hw_, hd_), (-hw_, hd_))]
        if area(p) < 0: p = p[::-1]
        if ingreen(x, z) or inBowl(x, z, 20) or not plot_ok(p): continue
        g = dict(p=p, a=abs(area(p)), x=x, z=z, cl='', h=None, fl=None, src='infill'); rings.append(g); addc(g); nfill += 1
log('footprints added from OSM', nosm, 'inferred infill plots', nfill)
rep_density = dict(osm=nosm, infill=nfill)
def simp(p):
    o = []
    n = len(p)
    for i in range(n):
        a, b, c = p[i-1], p[i], p[(i+1) % n]
        if math.dist(a, c) > 0 and segd(b[0], b[1], a, c)[0] < .4 and math.dist(a, b) < 12: continue
        o.append(b)
    return o if len(o) >= 3 else p
n0 = sum(len(g['p']) for g in rings)
for g in rings: g['p'] = simp(g['p'])
log('footprint vertices', n0, 'to', sum(len(g['p']) for g in rings))
# ---------------------------------------------------------------------------------------- 9. landmarks: pins are cross-checked, each keeps its src
places = []
for r in csv.DictReader(open(f'{DATA}/places.csv')):
    if r['lat']: places.append((r['name'] or '', r['cat'] or '', float(r['confidence'] or 0), float(r['lon']), float(r['lat'])))
def gx(e):
    if 'lat' in e: return e['lon'], e['lat']
    b = e.get('bounds')
    return ((b['minlon']+b['maxlon'])/2, (b['minlat']+b['maxlat'])/2) if b else None
LM = []
def lm(name, k, x, z, src, sign=None, xcheck=None):
    if any(l['k'] == k and l['name'] == name and math.hypot(l['x']-x, l['z']-z) < 200 for l in LM): return
    if x >= RX0: return
    LM.append(dict(name=name, k=k, x=round(x, 1), z=round(z, 1), src=src, sign=sign, xcheck=xcheck))
def xcheck(sub, x, z):
    """Overture pins whose name matches: distance in m from the chosen point. A far one is reported, never used."""
    b = [(p[0], round(math.hypot(ll(p[3], p[4])[0]-x, ll(p[3], p[4])[1]-z)), round(p[2], 2)) for p in places if sub in p[0].lower()]
    return sorted(b, key=lambda q: q[1])[:3]
for e in osm:
    tg = e.get('tags', {}); nm = tg.get('name'); c = gx(e)
    if not nm or not c: continue
    x, z = ll(*c); here = inCity(x, z) or at(near2k, x, z)
    nmc = re.sub(r'\s*\((Blue|Green|Red) Line\)|\s*\(u/c\)', '', nm)
    if tg.get('station') == 'subway' and tg.get('railway') == 'station' and '(u/c)' not in nm and x < CITY[2]+900 and CITY[1]-2000 < z < CITY[3]+900:
        lm(nmc + ' Metro', 'metro', x, z, 'OSM node', (nmc + ' METRO').upper())
    elif tg.get('railway') in ('station', 'halt') and e['type'] == 'node' and here and not tg.get('station'):
        lm(nm + ' Railway Station', 'station', x, z, 'OSM node', (nm + ' RAILWAY STATION').upper())
    elif tg.get('amenity') == 'hospital' and here: lm(nm, 'hospital', x, z, 'OSM', nm.upper())
    elif tg.get('amenity') in ('university', 'college') and here: lm(nm, 'school', x, z, 'OSM', nm.upper())
    elif tg.get('amenity') == 'bus_station' and here: lm(nm, 'busstand', x, z, 'OSM', nm.upper())
    elif tg.get('amenity') == 'cinema' and here: lm(nm, 'theatre', x, z, 'OSM', nm.upper())
    elif tg.get('amenity') == 'police' and here: lm(nm, 'police', x, z, 'OSM', None)
    elif tg.get('amenity') == 'fuel' and here: lm(nm, 'fuel', x, z, 'OSM', None)
    elif tg.get('amenity') == 'place_of_worship' and here:
        r_ = tg.get('religion'); lm(nm, 'church' if r_ == 'christian' else 'mosque' if r_ == 'muslim' else 'temple', x, z, 'OSM', None)
    elif tg.get('shop') == 'mall' and here: lm(nm, 'shop', x, z, 'OSM', nm.upper())
for nm, cat, cf, lo, la in places:
    x, z = ll(lo, la)
    if cf < .75 or not (at(near2k, x, z) or inCity(x, z)): continue
    if cat == 'gas_station' and sum(1 for l in LM if l['k'] == 'fuel') < 90 and not any(l['k'] == 'fuel' and math.hypot(l['x']-x, l['z']-z) < 120 for l in LM): lm(nm, 'fuel', x, z, 'Overture')
for nm, la, lo, k_, src_ in (('CSIR-IICT', 17.4243, 78.5397, 'school', 'Earth label position, approximate'), ('Centre for Cellular and Molecular Biology', 17.421155, 78.541138, 'school', 'Overture pin, OSM outline'), ('IICT Water Tanks', 17.4192, 78.5428, 'landmark', 'Earth label position, approximate'), ('Habsiguda Ramalayam', 17.41165, 78.5465, 'temple', 'neighbourhood point given by the user, approximate'), ("St Anthony's Shrine", 17.4348, 78.5192, 'church', 'Earth label position, approximate')):
    x_, z_ = ll(lo, la); lm(nm, k_, x_, z_, src_)
# the curated few, with the wrong pins checked
stc = STC
lm('Rajiv Gandhi International Cricket Stadium', 'stadium', stc[0], stc[1], 'audit coordinate, Overture pin Uppal stadium agrees within 60 m; the OSM way is the compound; the Overture pin "Uppal Stadium, Hyderabad" at 78.477 E is wrong and is not used', 'RAJIV GANDHI INTERNATIONAL STADIUM', xcheck('uppal stadium', *stc))
for l in LM:
    if l['name'] == 'Secunderabad Junction Railway Station': l['xcheck'] = xcheck('secunderabad railway station', l['x'], l['z'])
lm('AIIMS Bibinagar', 'hospital', aiims[0], aiims[1], 'audit coordinate 17.4776,78.7832', 'AIIMS BIBINAGAR', xcheck('aiims', *aiims))
for l in LM:
    if l['name'] == 'Secunderabad Junction Railway Station': l['x'], l['z'] = round(SEC[0], 1), round(SEC[1], 1); l['src'] = 'audit coordinate, station building; OSM node is 95 m east'
lm('Bhongir Fort', 'temple', fortP[0], fortP[1], 'OSM way outline, agrees with OSM node Bhuvanagiri Fort; the Overture pin at 17.4478 N is wrong and is not used', None, xcheck('bhongir fort', *fortP))
TOWNS = [('Secunderabad', ll(78.5021, 17.4345)), ('Tarnaka', ll(78.53097, 17.42664)), ('Habsiguda X Road', ll(78.54142, 17.41901)), ('Uppal X Road', ll(78.56028, 17.40151)), ('Yadagirigutta junction', ll(78.9409, 17.5407)), ('Narapally', ll(78.6290, 17.4210)), ('Ghatkesar', ll(78.6830, 17.4470)),
         ('Bibinagar', ll(78.7947, 17.4707)), ('Bhongir', ll(78.8880, 17.5120)), ('Raigir', ll(78.938, 17.537)), ('Aler', ll(79.0489, 17.6456)), ('Pembarthi', ll(79.1171, 17.6930))]
log('landmarks', collections.Counter(l['k'] for l in LM), 'kept names sample', [l['name'] for l in LM if l['k'] == 'station'][:12])
# signs: only what a player reads. Nearest footprint within 45 m wears the board, metro boards hang on the station box
LMS = [l for l in LM if l['sign']]
LMS.sort(key=lambda l: {'stadium': 0, 'station': 1, 'metro': 2, 'busstand': 3, 'hospital': 4, 'shop': 5, 'theatre': 6, 'school': 7}.get(l['k'], 9))
LMS = LMS[:150]
signs = {}
def sid(s): return signs.setdefault(s[:48], len(signs))
RB = collections.defaultdict(list)
for g in rings: RB[(int(g['x']//90), int(g['z']//90))].append(g)
for l in LM:
    if l['k'] == 'metro': continue
    best = None
    for i in range(-1, 2):
        for j in range(-1, 2):
            for g in RB.get((int(l['x']//90)+i, int(l['z']//90)+j), []):
                d = math.hypot(g['x']-l['x'], g['z']-l['z'])
                if d < 45 and 'lm' not in g and (not best or d < best[0]): best = (d, g)
    if best:
        best[1]['lm'] = l['k']
        if l in LMS and l['sign']: best[1]['sg'] = sid(l['sign'])
# heights: inferred unless the data has one
ART = {}
for p in pieces:
    if p['t'] in ('tar', 'highway'):
        for a, b, h0 in zip(p['dp'], p['dp'][1:], p['dh']): ART.setdefault((int(a[0]//40), int(a[1]//40)), []).append((a, b, p['w']))
def hash01(x, z, s): return ((int(x*10)*73856093 ^ int(z*10)*19349663 ^ s*83492791) & 0xffffffff) / 4294967296 % 1
real = 0
LOCAL = collections.Counter((int(g['x']//80), int(g['z']//80)) for g in rings)
for g in rings:
    dist = min((segd(g['x'], g['z'], a, c)[0]-w/2 for i in (-1, 0, 1) for j in (-1, 0, 1) for a, c, w in ART.get((int(g['x']//40)+i, int(g['z']//40)+j), [])), default=99)
    g['f'] = dist < 22; city = inCity(g['x'], g['z']); r_ = hash01(g['x'], g['z'], 1); A = g['a']; dn = LOCAL[(int(g['x']//80), int(g['z']//80))]
    g['shed'] = g['cl'] in ('industrial', 'warehouse', 'hangar', 'barn') or (not city and A > 900)
    if g['h']: h = g['h']; g['inf'] = 0; real += 1
    elif g['fl']: h = g['fl']*3.2; g['inf'] = 0; real += 1
    else:
        g['inf'] = 1
        if g['shed']: fl = 2
        elif A < 30: fl = 1
        elif city:
            if A > 1500: fl = 4 + r_*5
            elif g['f']: fl = (3 + r_*2.4) if A < 300 else (4 + r_*3)
            elif A > 400: fl = 3 + r_*3
            else: fl = 2 + r_*3
        else: fl = (2 + r_*2.4) if g['f'] else (1 + r_*2)
        if inAiims(g['x'], g['z']) and A > 300: fl = max(fl, 5)
        if g.get('lm') == 'hospital': fl = max(fl, 5)
        if g.get('lm') == 'school': fl = max(fl, 3)
        h = round(fl)*3.2
    g['H'] = h
    if math.hypot(g['x']-SEC[0], g['z']-SEC[1]) < 420 and any(t_ == 'rail' and segd(g['x'], g['z'], a, c)[0] < 45 for a, c, w, t_, h0 in near_segs(g['x'], g['z'], 2)):
        g['H'] = 11. if A > 500 else 7.; g['lm'] = 'station'; g['shed'] = False; stationB = globals().get('stationB', 0)+1      # a station, not flats
log('heights real', real, 'inferred', len(rings)-real)
# ---------------------------------------------------------------------------------------- 10. structures
BOX = collections.defaultdict(list); RIB = collections.defaultdict(list); FRU = collections.defaultdict(list); SGN = collections.defaultdict(list)
COL = {'pier': 0, 'deck': 1, 'plat': 2, 'station': 3, 'roof': 4, 'rock': 5, 'stand': 6, 'brick': 7, 'dark': 8, 'plinth': 9, 'white': 10, 'green': 11, 'flagO': 12, 'blue': 13, 'hedge': 14, 'nokiosk': 15, 'slab': 16}
def box(cx, cz, ux, uz, hw, hd, y0, y1, col, solid=0):
    i, j = tile_of(cx, cz)
    BOX[(i, j)].append((cx, cz, ux, uz, hw, hd, y0, y1, COL[col], solid))
def road_at(x, z, pad=.6): return any(segd(x, z, a, c)[0] < w/2+pad for a, c, w, t_, h0 in near_segs(x, z, 1) if t_ != 'rail')
MY = 12.5                     # inferred: deck top, Hyderabad Metro structures run about 12 to 15 m over the road
piers = {}
mstations = [l for l in LM if l['k'] == 'metro']
for m in metro:
    P, _ = dens(m['p'], [0]*(len(m['p'])-1), 20)
    # ribbon with its own tile runs
    for u, v in zip(P, P[1:]):
        i, j = tile_of((u[0]+v[0])/2, (u[1]+v[1])/2)
        q = RIB[(i, j)]
        if q and q[-1][0] == 'm' and q[-1][3][-1] == u: q[-1][3].append(v)
        else: q.append(['m', 5.0, MY, [u, v]])
    s = 0
    for u, v in zip(P, P[1:]):
        L = math.hypot(v[0]-u[0], v[1]-u[1]) or 1; ux, uz = (v[0]-u[0])/L, (v[1]-u[1])/L
        if int((s+L)/32) != int(s/32):
            x, z = u
            if not any(math.hypot(x-a, z-b) < 14 for (i, j) in [(int(x//40)+p_, int(z//40)+q_) for p_ in (-1, 0, 1) for q_ in (-1, 0, 1)] for a, b in piers.get((i, j), [])):
                ok = None
                for o in (0, 2.5, -2.5, 5, -5, 8, -8, 11, -11, 14, -14):
                    X, Z = x-uz*o, z+ux*o
                    if not road_at(X, Z, 3): ok = (X, Z); break
                if ok:
                    piers.setdefault((int(x//40), int(z//40)), []).append((x, z))
                    box(ok[0], ok[1], ux, uz, 1.5, 1.5, 0, .6, 'plinth', 1); box(ok[0], ok[1], ux, uz, 1.15, 1.0, .6, MY-3.6, 'pier')
                    if not any(road_at(ok[0]+ux*q_, ok[1]+uz*q_, 2) for q_ in (2, 14, 26)): box(ok[0]+ux*14, ok[1]+uz*14, ux, uz, 12, .9, 0, .85, 'plinth', 1); box(ok[0]+ux*14, ok[1]+uz*14, ux, uz, 11.5, .7, .85, 1.6, 'hedge')      # raised median planter between piers, seen at Tarnaka
                    for lift_, y_ in ((1.5, MY-3.6), (2.3, MY-3.0), (3.1, MY-2.4), (4.0, MY-1.8)): box(x, z, ux, uz, 1.1, lift_, y_, y_+.6, 'pier')      # the flared head
        s += L
log('metro piers', sum(len(v) for v in piers.values()))
for l in mstations:
    best = None
    for m in metro:
        for a, b in zip(m['p'], m['p'][1:]):
            d, t_ = segd(l['x'], l['z'], a, b)
            if not best or d < best[0]: best = (d, a, b)
    if not best or best[0] > 60: continue
    d, a, b = best; L = math.hypot(b[0]-a[0], b[1]-a[1]) or 1; ux, uz = (b[0]-a[0])/L, (b[1]-a[1])/L
    # one long roofed box straddling the road (seen at Habsiguda): concourse under, platforms on top, two curved roof bands with a slot between
    X0, Z0 = l['x'], l['z']; nx, nz = -uz, ux
    box(X0, Z0, ux, uz, 80, 12, MY-6.5, MY-3.2, 'station')
    box(X0, Z0, ux, uz, 78, 12.3, MY-3.2, MY+.4, 'dark')
    box(X0, Z0, ux, uz, 80, 12.6, MY+.4, MY+1.3, 'station')
    for w_ in (-1, 1):
        box(X0+nx*w_*12.2, Z0+nz*w_*12.2, ux, uz, 80, .25, MY+1.3, MY+6.3, 'dark')
        box(X0+nx*w_*7.4, Z0+nz*w_*7.4, ux, uz, 82, 5.4, MY+6.3, MY+6.9, 'roof'); box(X0+nx*w_*10.8, Z0+nz*w_*10.8, ux, uz, 82, 2.2, MY+5.8, MY+6.3, 'roof')
    for o in (-60, -30, 0, 30, 60):
        for w_ in (-1, 1): box(X0+ux*o+nx*w_*9, Z0+uz*o+nz*w_*9, ux, uz, .3, .3, MY+1.3, MY+6.3, 'pier')
    for o in (-52, -18, 18, 52):
        for w_ in (-10.5, 10.5):
            X, Z = X0+ux*o+nx*w_, Z0+uz*o+nz*w_
            if not road_at(X, Z, 3): box(X, Z, ux, uz, 1.1, 1.1, 0, MY-6.5, 'pier', 1)
    if 'Uppal' in l['name']: box(X0, Z0, ux, uz, 34, 12, MY-10.5, MY-6.5, 'station')      # the taller mezzanine seen from the road
    # stairs at both ends down to each footpath: flights of steps as boxes, sheet roof over
    for e_ in (-1, 1):
        for w_ in (-1, 1):
            sx0, sz0 = X0+ux*e_*44+nx*w_*17, Z0+uz*e_*44+nz*w_*17
            for n_ in range(10):
                f_ = n_/10; box(sx0+ux*e_*f_*16, sz0+uz*e_*f_*16, ux, uz, .85, 1.5, 0 if n_ < 1 else (1-f_)*(MY-6.5)-.5, (1-f_)*(MY-6.5), 'station')
            box(sx0+ux*e_*8, sz0+uz*e_*8, ux, uz, 9, 1.8, MY-3.4, MY-3.2, 'roof')
    if l in LMS:
        for o_ in (1,): SGN[tile_of(l['x'], l['z'])].append((l['x'], l['z'], ux, uz, 24., MY-6.2, sid(l['sign']), 12.9))
for P in plats:
    for u, v in zip(P, P[1:]):
        L = math.hypot(v[0]-u[0], v[1]-u[1])
        if L < 2: continue
        m_ = ((u[0]+v[0])/2, (u[1]+v[1])/2); ux, uz = (v[0]-u[0])/L, (v[1]-u[1])/L
        box(m_[0], m_[1], ux, uz, L/2+.3, 2.2, 0, .9, 'plat', 0)
        if math.hypot(m_[0]-SEC[0], m_[1]-SEC[1]) < 520:      # canopy on posts (inferred form)
            canopies = globals().get('canopies', [])+[m_]
            box(m_[0], m_[1], ux, uz, L/2+.3, 3.2, 4.9, 5.2, 'roof')
            for o in range(int(-L/2), int(L/2)+1, 12):
                box(m_[0]+ux*o, m_[1]+uz*o, ux, uz, .15, .15, .9, 4.9, 'pier')
# stadium stands as a real ring from the OSM outline; the Bhongir rock as a frustum stack (inferred shape, real place and rough size)
def clip_rect(p, x0, z0, x1, z1):
    for ax, az, nx, nz in ((x0, 0, 1, 0), (x1, 0, -1, 0), (0, z0, 0, 1), (0, z1, 0, -1)):
        if len(p) < 3: return []
        p = clip(p, ax, az, nx, nz, 0)
    return p
POLY = collections.defaultdict(list)
NOK = [(SEC[0]+20, SEC[1]-30, 110.), (-64768., 32878., 14.)]            # no roadside kiosks here
MC = [ll(lo, la) for la, lo in ((17.4372, 78.5202), (17.4400, 78.5255), (17.4355, 78.5270), (17.4336, 78.5222))]    # Mettuguda compound, rough corners from Earth (inferred outline)
GREEN.append(('campus', MC if area(MC) > 0 else MC[::-1], 'Mettuguda railway compound'))
wa = ll(78.52060, 17.43570); wb = ll(78.52240, 17.43345); Lw = math.dist(wa, wb); wx, wz = (wb[0]-wa[0])/Lw, (wb[1]-wa[1])/Lw      # mural wall seen from Krishna Deva Raya Rd
pano = ll(78.52089, 17.43451); mcc = (sum(q[0] for q in MC)/4, sum(q[1] for q in MC)/4)
wp_ = min((p for p in pieces if p['t'] in ('tar', 'highway') and not p['link'] and plen(p['dp']) > 80), key=lambda p: min(math.dist(q, (pano[0]+(mcc[0]-pano[0])*.01, pano[1]+(mcc[1]-pano[1])*.01)) for q in p['dp']))
opens = 0; off_ = wp_['w']/2+3.4
for k_, (u, v) in enumerate(zip(wp_['dp'], wp_['dp'][1:])):
    L = math.dist(u, v) or 1; ux, uz = (v[0]-u[0])/L, (v[1]-u[1])/L; nx, nz = -uz, ux
    if (mcc[0]-u[0])*nx+(mcc[1]-u[1])*nz < 0: nx, nz = -nx, -nz
    c_ = ((u[0]+v[0])/2+nx*off_, (u[1]+v[1])/2+nz*off_)
    if math.dist(c_, pano) > 260: continue
    if road_at(c_[0], c_[1], .6): opens += 1; continue
    box(c_[0], c_[1], ux, uz, L/2+.3, .2, 0, 2.3, 'blue', 1); box(c_[0], c_[1], ux, uz, L/2+.3, .25, 2.3, 2.5, 'white'); NOK.append((c_[0], c_[1], 20.))
    for m_ in range(int(L/9)):                         # mural: painted panels on the wall (generic pattern), bollards at the kerb
        o_ = -L/2+4.5+m_*9; ph_ = hash01(c_[0]+m_, c_[1], 6); h0_ = .5+ph_*.7
        box(c_[0]+ux*o_-nx*.22, c_[1]+uz*o_-nz*.22, ux, uz, 2.4+ph_*1.4, .03, h0_, h0_+.8, 'white' if ph_ < .4 else 'hedge' if ph_ < .7 else 'flagO')
    for m_ in range(int(L/4)):
        o_ = -L/2+2+m_*4; box(u[0]+ux*(o_+L/2)+nx*(wp_['w']/2+.5), u[1]+uz*(o_+L/2)+nz*(wp_['w']/2+.5), 1, 0, .12, .12, 0, .85, 'pier')
log('Mettuguda wall offset', off_, 'openings', opens)
TREES = collections.defaultdict(list)
for k, P, nm in GREEN:
    xs = [q[0] for q in P]; zs = [q[1] for q in P]; st = {'wood': 15, 'campus': 21, 'park': 26}[k]
    for i in range(int((min(xs)-HX0)//T), int((max(xs)-HX0)//T)+1):
        for j in range(int((min(zs)-HZ0)//T), int((max(zs)-HZ0)//T)+1):
            c = clip_rect(P if area(P) > 0 else P[::-1], HX0+i*T, HZ0+j*T, HX0+(i+1)*T, HZ0+(j+1)*T)
            if len(c) > 2 and abs(area(c)) > 200: POLY[(i, j)].append((c, .06, 9 if k == 'park' else 8))
    for ix in range(int(min(xs)//st), int(max(xs)//st)+1):
        for iz in range(int(min(zs)//st), int(max(zs)//st)+1):
            x = ix*st+hash01(ix, iz, 3)*st*.8; z = iz*st+hash01(ix, iz, 4)*st*.8
            if pinp(x, z, P) and not covered(x, z) and not road_at(x, z, 2): TREES[tile_of(x, z)].append((x, z))
log('trees on green land', sum(len(v) for v in TREES.values()))
# river piers of the Musi bridge, 24 m apart under both deck edges (inferred spacing)
for p in pieces:
    if p['t'] not in ('highway', 'tar') or max(p['dh']) < 6: continue
    for k in range(0, len(p['dp'])-1):
        a, b = p['dp'][k], p['dp'][k+1]
        if MUSI[0] < a[0] < MUSI[2] and MUSI[1]+25 < a[1] < MUSI[3]-25 and p['dh'][k] > 6:
            L = math.hypot(b[0]-a[0], b[1]-a[1]) or 1; ux, uz = (b[0]-a[0])/L, (b[1]-a[1])/L
            for o in (-1, 1): box(a[0]-uz*o*(p['w']/2-.8), a[1]+ux*o*(p['w']/2-.8), ux, uz, .7, .7, 0, 5.4, 'pier', 1)
# long thin footprints beside the tracks at the station are the platform roofs themselves: a roof on posts, not a block
ncan = 0
for g in rings:
    if g.get('lm') != 'station' or g['a'] < 200: continue
    P_ = g['p']; ed = max(zip(P_, P_[1:]+P_[:1]), key=lambda q: math.dist(q[0], q[1])); Ln = math.dist(*ed)
    if Ln < 60 or g['a']/Ln > 30: continue
    ux, uz = (ed[1][0]-ed[0][0])/Ln, (ed[1][1]-ed[0][1])/Ln; hw_ = g['a']/Ln/2; g['can'] = 1; ncan += 1; n_ = max(1, int(Ln/40))
    for i in range(n_):                 # in pieces, so each falls in its own tile
        o = -Ln/2+(i+.5)*Ln/n_; X_, Z_ = g['x']+ux*o, g['z']+uz*o
        box(X_, Z_, ux, uz, Ln/n_/2+.1, hw_, 5.0, 5.35, 'roof')
        for w_ in (-Ln/n_/2+1, 1): box(X_+ux*w_, Z_+uz*w_, ux, uz, .18, .18, 0, 5, 'pier', 1)
rings[:] = [g for g in rings if not g.get('can')]
log('platform roof footprints turned into canopies', ncan)
# Secunderabad Junction: a station building at the real entrance, long side along the tracks (form inferred)
rb = min(((segd(SEC[0], SEC[1], a, b)[0], a, b) for r in rail for a, b in zip(r['p'], r['p'][1:]) if math.dist(a, SEC) < 900), key=lambda q: q[0])
L = math.dist(rb[1], rb[2]) or 1; sx, sz = (rb[2][0]-rb[1][0])/L, (rb[2][1]-rb[1][1])/L
fx, fz = -sz, sx                                 # front normal, away from the tracks
if (SEC[0]-rb[1][0])*fx+(SEC[1]-rb[1][1])*fz < 0: fx, fz = -fx, -fz
sc = (SEC[0]-fx*12, SEC[1]-fz*12)     # front wall clear of the forecourt road
log('station', [round(v) for v in sc], 'track axis', round(sx, 2), round(sz, 2), 'track dist', round(rb[0]), 'roads under', sum(1 for o in range(-75, 76, 15) if road_at(sc[0]+sx*o, sc[1]+sz*o)))
nb_ = len(rings); rings[:] = [g for g in rings if not (abs((g['x']-sc[0])*sx+(g['z']-sc[1])*sz) < 92 and -24 < (g['x']-sc[0])*fx+(g['z']-sc[1])*fz < 95)]; log('buildings cleared from the station front and forecourt', nb_-len(rings))
box(sc[0], sc[1], sx, sz, 80, 11, 0, 11, 'brick', 1); box(sc[0], sc[1], sx, sz, 82, 12.5, 11, 11.7, 'roof')
box(sc[0], sc[1], sx, sz, 22, 13, 0, 19, 'brick', 1); box(sc[0], sc[1], sx, sz, 24, 14.5, 19, 19.9, 'roof')
box(sc[0], sc[1], sx, sz, 80.5, 11.5, 10.2, 11, 'white', 0); box(sc[0], sc[1], sx, sz, 22.5, 13.5, 18.2, 19, 'white', 0)
for o in (-16, 0, 16):
    box(sc[0]+sx*o+fx*13.3, sc[1]+sz*o+fz*13.3, sx, sz, 7, .2, 7, 9, 'white')
    for w_, y0_, y1_ in ((5.4, 7, 7.5), (4.4, 7.5, 7.95), (3, 7.95, 8.35), (1.4, 8.35, 8.6)): box(sc[0]+sx*o+fx*13.5, sc[1]+sz*o+fz*13.5, sx, sz, w_, .1, y0_, y1_, 'dark')     # stepped arch head
    for w_ in (-1, 1): box(sc[0]+sx*(o+w_*6.3)+fx*13.3, sc[1]+sz*(o+w_*6.3)+fz*13.3, sx, sz, .7, .25, 0, 8, 'white')
for o in range(-74, 75, 12):
    if abs(o) > 24:
        for w_ in (-1, 1): box(sc[0]+sx*(o+w_*3.6)+fx*11.2, sc[1]+sz*(o+w_*3.6)+fz*11.2, sx, sz, .3, .2, 1.8, 8.4, 'white')
        box(sc[0]+sx*o+fx*11.2, sc[1]+sz*o+fz*11.2, sx, sz, 3.9, .2, 8, 8.5, 'white')
BAR = 0
for p in pieces:
    if p['t'] not in ('tar', 'highway') or p['one'] or max(p['dh']) > .1 or p['w'] < 7: continue
    for k, (a, b) in enumerate(zip(p['dp'], p['dp'][1:])):
        if math.dist(a, SEC) > 420 or k == 0 or k > len(p['dp'])-3: continue
        L = math.dist(a, b) or 1; ux, uz = (b[0]-a[0])/L, (b[1]-a[1])/L
        for o, c_ in zip(range(0, int(L), 3), ('flagO', 'dark')*20): box(a[0]+ux*o, a[1]+uz*o, ux, uz, 1.4, .25, 0, .8, c_); BAR += 1
log('barrier pieces', BAR)
Fp = (sc[0]+fx*55, sc[1]+fz*55)                  # forecourt flag, seen in Earth
box(Fp[0], Fp[1], 1, 0, .35, .35, 0, 55, 'white', 1)
for i_, c_ in enumerate(('green', 'white', 'flagO')): box(Fp[0]+7, Fp[1], 1, 0, 6.5, .06, 45+i_*2.8, 47.8+i_*2.8, c_)
for i_ in range(6):                               # long covered footbridge over the yard, blue roof (seen in Earth)
    o_ = 30+i_*38; bx_, bz_ = sc[0]-fx*o_, sc[1]-fz*o_; box(bx_, bz_, fx, fz, 19.2, 3, 7, 7.6, 'station'); box(bx_, bz_, fx, fz, 19.2, 3.4, 10, 10.4, 'blue'); box(bx_, bz_, fx, fz, .5, .5, 0, 7, 'pier')
for o in range(-74, 75, 12):
    if abs(o) > 24: box(sc[0]+sx*o+fx*11.1, sc[1]+sz*o+fz*11.1, sx, sz, 3.4, .12, 2, 8, 'dark')
for o in (-16, 0, 16): box(sc[0]+sx*o+fx*13.1, sc[1]+sz*o+fz*13.1, sx, sz, 6, .12, 0, 7, 'dark')
for o in (-24, 24):
    for w_ in (-1, 1): box(sc[0]+sx*(o+w_*42)+fx*16, sc[1]+sz*(o+w_*42)+fz*16, sx, sz, .3, .3, 0, 5, 'pier')
box(sc[0]+fx*19, sc[1]+fz*19, sx, sz, 46, 5, 5, 5.5, 'roof')
s_ = sid('SECUNDERABAD JUNCTION')
SGN[tile_of(*sc)].append((sc[0], sc[1], sx, sz, 40., 12.6, s_, 13.4))
def ell(a, b, n=44): return [(STC[0]+a*math.cos(i/n*6.2832), STC[1]+b*math.sin(i/n*6.2832)) for i in range(n)]
SG = 56
for n_, (ra, rb, y1, t_) in enumerate([(SA, SB, 27., 13.), (SA-13, SB-13, 15., 13.)]):        # two tiers of stands, a gate gap north and south
    ring = ell(ra-t_/2, rb-t_/2, SG)
    for i in range(SG):
        if i in (13, 14, 41, 42): continue
        u, v = ring[i], ring[(i+1) % SG]; L = math.hypot(v[0]-u[0], v[1]-u[1])
        box((u[0]+v[0])/2, (u[1]+v[1])/2, (v[0]-u[0])/L, (v[1]-u[1])/L, L/2+.6, t_/2, 0, y1, 'stand', 1)
ZD = collections.defaultdict(list)
for p in pieces:
    if p['t'] in ('tar', 'highway') and p['w'] >= 6.5 and inCity(*p['dp'][0]) and max(p['dh']) < .1 and p['c'] != 'tertiary': ZD[p['a']].append((p, 0)); ZD[p['b']].append((p, 1))
nz_ = 0
for nd, l_ in ZD.items():
    if len(l_) >= 3: NOK.append((*(l_[0][0]['dp'][0] if l_[0][1] == 0 else l_[0][0]['dp'][-1]), 28.))
    if len(l_) < 4: continue
    for p, e_ in l_:
        P_ = p['dp'] if e_ == 0 else p['dp'][::-1]
        L = math.dist(P_[0], P_[1]) or 1
        if L < 10: continue
        ux, uz = (P_[1][0]-P_[0][0])/L, (P_[1][1]-P_[0][1])/L; nz_ += 1; ns_ = int(p['w']/2.2)
        for i in range(ns_):
            o = (-.5+(i+.5)/ns_)*p['w']; box(P_[0][0]+ux*8-uz*o, P_[0][1]+uz*8+ux*o, ux, uz, 1.3, .26, .1, .16, 'plat')
log('zebra legs', nz_)
POLY[tile_of(*STC)].append(([(STC[0]+(SA-27)*math.cos(i/30*6.2832), STC[1]+(SB-27)*math.sin(i/30*6.2832)) for i in range(30)], .09, 7))
SGN[tile_of(STC[0], STC[1]+SB)].append((STC[0], STC[1]+SB+.5, 1., 0., 30., 16., sid('RAJIV GANDHI INTERNATIONAL STADIUM'), 0.))
for n, (f0, f1, y0, y1) in enumerate([(1, .76, 0, 45), (.76, .53, 45, 105), (.53, .32, 105, 150), (.32, .14, 150, 172)]):
    FRU[tile_of(*fortP)].append((fortP[0], fortP[1], RA*f0, RA*f1, y0, y1))
rr_ = [(fortP[0]+RA*.99*math.cos(i/90*6.2832), fortP[1]+RB_*.99*math.sin(i/90*6.2832)) for i in range(90)]
for u, v in zip(rr_, rr_[1:]+rr_[:1]):                 # collision outline as short solid pieces, one per tile they fall in: the rock spans several tiles
    L = math.hypot(v[0]-u[0], v[1]-u[1]); box((u[0]+v[0])/2, (u[1]+v[1])/2, (v[0]-u[0])/L, (v[1]-u[1])/L, L/2+.5, .5, 0, 3, 'rock', 1)
# ---------------------------------------------------------------------------------------- 11. water
water = []; rivers = []
for r in csv.DictReader(open(f'{DATA}/water.csv')):
    for ring in parts(r['wkt']):
        p = [ll(*q) for q in ring]
        xs = [q[0] for q in p]; zs = [q[1] for q in p]
        if max(xs)-min(xs) > 50000 or min(xs) > RX0: continue
        if not any(inCity(*q) or at(near6k, *q) for q in p[::max(1, len(p)//40)]): continue
        if 'POLYGON' in r['wkt'] and len(p) > 3: water.append(p)
        elif r['class'] in ('river', 'canal', 'stream') and plen(p) > 150: rivers.append(p)
WAT = collections.defaultdict(list)
for p in water:
    xs = [q[0] for q in p]; zs = [q[1] for q in p]
    for i in range(int((min(xs)-HX0)//T), int((max(xs)-HX0)//T)+1):
        for j in range(int((min(zs)-HZ0)//T), int((max(zs)-HZ0)//T)+1):
            c = clip_rect(p, HX0+i*T, HZ0+j*T, HX0+(i+1)*T, HZ0+(j+1)*T)
            if len(c) > 2 and abs(area(c)) > 50 and i < NX and 0 <= j < NZ: WAT[(i, j)].append(c)
log('water polygons', len(water), 'rivers', len(rivers))
# ---------------------------------------------------------------------------------------- 12. tile files
os.makedirs(f'{OUT}/hyd', exist_ok=True)
for f in os.listdir(f'{OUT}/hyd'): os.remove(f'{OUT}/hyd/{f}')
TR = collections.defaultdict(list)    # tile -> road run records
TC = {'highway': 4, 'tar': 3, 'cc': 2, 'dirt': 1}
def thin(P, h, tol=.5):
    """Douglas-Peucker for flat pieces: a road only keeps the vertices its bends need."""
    if len(P) < 3: return list(P), list(h)
    keep = [False]*len(P); keep[0] = keep[-1] = True; st = [(0, len(P)-1)]
    while st:
        a, b = st.pop(); best = 0; bk = -1
        for k in range(a+1, b):
            d = segd(P[k][0], P[k][1], P[a], P[b])[0]
            if d > best: best = d; bk = k
        if best > tol and bk > 0: keep[bk] = True; st += [(a, bk), (bk, b)]
    return [q for q, k in zip(P, keep) if k], [q for q, k in zip(h, keep) if k]
for p in pieces:
    el = max(p['dh']) > .02
    if el: P, h = p['dp'], p['dh']
    else:
        P, h = thin(p['dp'], p['dh'])
        # flat pieces can have long chords: keep them under 300 m so tile records stay local
        Q = [P[0]]; 
        for a, b in zip(P, P[1:]):
            n = max(1, int(math.hypot(b[0]-a[0], b[1]-a[1])/300))
            for k in range(1, n+1): Q.append((a[0]+(b[0]-a[0])*k/n, a[1]+(b[1]-a[1])*k/n))
        P = Q; h = [0.]*len(P)
    pad = p['w']/2+2
    per = collections.defaultdict(list)
    for k, (a, b) in enumerate(zip(P, P[1:])):
        own = tile_of((a[0]+b[0])/2, (a[1]+b[1])/2)
        for i in range(tile_of(min(a[0], b[0])-pad, 0)[0], tile_of(max(a[0], b[0])+pad, 0)[0]+1):
            for j in range(tile_of(0, min(a[1], b[1])-pad)[1], tile_of(0, max(a[1], b[1])+pad)[1]+1):
                per[(i, j)].append((k, (i, j) == own))
    for tl, L in per.items():
        run = [L[0]]
        for q in L[1:]+[None]:
            if q and q[0] == run[-1][0]+1 and q[1] == run[-1][1]: run.append(q); continue
            k0, k1 = run[0][0], run[-1][0]+1
            TR[tl].append((TC[p['t']], p['w'], el, run[0][1], p['one'], P[k0:k1+1], h[k0:k1+1], p['c'] in ('primary', 'trunk', 'motorway', 'secondary', 'tertiary')))
            run = [q] if q else []
TRL = collections.defaultdict(list)
for r in rail:
    P = r['p']; raised = set(raised_rail.get(rail.index(r), [])) if raised_rail.get(rail.index(r)) else set()
    Q, L_ = dens(P, [1 if k in raised else 0 for k in range(len(P)-1)], 24)
    h = [0.]*len(Q)
    for k, l in enumerate(L_):
        if l: h[k] = h[k+1] = DECK
    for k in range(1, len(h)): h[k] = max(h[k], h[k-1]-.02*24)
    for k in range(len(h)-2, -1, -1): h[k] = max(h[k], h[k+1]-.02*24)
    for k, (a, b) in enumerate(zip(Q, Q[1:])):
        tl = tile_of((a[0]+b[0])/2, (a[1]+b[1])/2); q = TRL[tl]
        if q and q[-1][0][-1] == a: q[-1][0].append(b); q[-1][1].append(h[k+1])
        else: q.append(([a, b], [h[k], h[k+1]]))
for R_ in rivers:
    for a, b in zip(R_, R_[1:]):
        i, j = tile_of(a[0], a[1]); q = RIB[(i, j)]
        if q and q[-1][0] == 'r' and q[-1][3][-1] == a: q[-1][3].append(b)
        else: q.append(['r', 9., .03, [a, b]])
TB = collections.defaultdict(list)
for g in rings: TB[tile_of(g['x'], g['z'])].append(g)
for x_, z_, k, n in MED:
    tl = tile_of(x_, z_); q = RIB[tl]
    if q and q[-1][0] == 'k' and q[-1][4] == n and math.hypot(q[-1][3][-1][0]-x_, q[-1][3][-1][1]-z_) < 40: q[-1][3].append((x_, z_))
    else: q.append(['k', 1.2, .3, [(x_, z_)], n])
for c_ in NOK: pass
for c_ in NOK:
    for i_ in range(int((c_[0]-c_[2]-HX0)//T), int((c_[0]+c_[2]-HX0)//T)+1):
        for j_ in range(int((c_[1]-c_[2]-HZ0)//T), int((c_[1]+c_[2]-HZ0)//T)+1): BOX[(i_, j_)].append((c_[0], c_[1], 1, 0, c_[2], 0, 0, 0, COL['nokiosk'], 0))
PX_ = (-64768., 32878.)
for tl_ in list(BOX):
    kp_ = [b_ for b_ in BOX[tl_] if not (b_[9] and math.dist(b_[:2], PX_) < 9)]
    if len(kp_) != len(BOX[tl_]): log('solid structure removed at lane', [b_ for b_ in BOX[tl_] if b_ not in kp_]); BOX[tl_] = kp_
nb_ = [g for g in rings if math.dist((g['x'], g['z']), PX_) < 9 or any(math.dist(q, PX_) < 7 for q in g['p'])]
log('footprints at lane', [(round(g['a']), g.get('src'), [round(v) for v in g['p'][0]]) for g in nb_]); rings[:] = [g for g in rings if g not in nb_]
sol = collections.defaultdict(list)
for tl_, l_ in BOX.items():
    for b_ in l_:
        if b_[9]: sol[(int(b_[0]//40), int(b_[1]//40))].append(b_)
rm_ = 0
for g in list(rings):
    if g.get('src') == 'infill' and any(math.dist((b_[0], b_[1]), q) < max(b_[4], b_[5])+2 for q in g['p']+[(g['x'], g['z'])] for i in (-1, 0, 1) for j in (-1, 0, 1) for b_ in sol.get((int(g['x']//40)+i, int(g['z']//40)+j), [])): rm_ += 1; rings.remove(g)
log('infill plots removed for solid structures', rm_)
TB = collections.defaultdict(list)
for g in rings: TB[tile_of(g['x'], g['z'])].append(g)
all_t = set(TREES) | set(TR) | set(TB) | set(BOX) | set(RIB) | set(WAT) | set(TRL) | set(FRU) | set(POLY)
all_t = {t_ for t_ in all_t if 0 <= t_[0] <= NX and 0 <= t_[1] < NZ}
sizes = 0
Q10 = lambda v: max(-32767, min(32767, int(round(v*10))))
for tl in sorted(all_t):
    x0 = HX0+tl[0]*T; z0 = HZ0+tl[1]*T; o = []
    X = lambda v: Q10(v-x0); Z = lambda v: Q10(v-z0)
    bl = sorted(TB.get(tl, []), key=lambda g: -g['a'])
    nfar = sum(1 for g in bl if g['a'] > 130 or g['H'] > 11 or g.get('lm'))
    ribs = [q for q in RIB.get(tl, []) if len(q[3]) > 1]
    o += [5, len(TR.get(tl, [])), len(bl), len(TRL.get(tl, [])), len(WAT.get(tl, [])), len(ribs), len(BOX.get(tl, [])), len(FRU.get(tl, [])), len(SGN.get(tl, [])), nfar, len(POLY.get(tl, [])), (0 if not inCity(x0+T/2, z0+T/2) else 2 if math.hypot(x0+T/2-SEC[0], z0+T/2-SEC[1]) < 900 else 3 if math.hypot(x0+T/2-STC[0], z0+T/2-STC[1]) < 1500 else 1), len(TREES.get(tl, []))]
    for c, w, el, own, one, P, h, art in TR.get(tl, []):
        o += [c | (8 if el else 0) | (16 if own else 0) | (32 if one else 0) | (64 if art else 0), int(w*10), len(P)]
        for q, y in zip(P, h):
            o += [X(q[0]), Z(q[1])]
            if el: o.append(int(round(y*100)))
    KIND = {'hospital': 1, 'school': 2, 'temple': 3, 'mosque': 4, 'church': 5, 'station': 6, 'stadium': 7, 'busstand': 8, 'shop': 9, 'theatre': 10, 'fuel': 11, 'police': 12}
    for g in bl:
        p = g['p']; o += [len(p), int(round(min(g['H'], 300)*10)), (1 if g['f'] else 0) | (2 if g['inf'] else 0) | (4 if g['shed'] else 0) | (KIND.get(g.get('lm'), 0) << 3), g.get('sg', -1)+1]
        for q in p: o += [X(q[0]), Z(q[1])]
    for P, h in TRL.get(tl, []):
        o.append(len(P))
        for q, y in zip(P, h): o += [X(q[0]), Z(q[1]), int(y*100)]
    for p in WAT.get(tl, []):
        o.append(len(p))
        for q in p: o += [X(q[0]), Z(q[1])]
    for r_ in ribs:
        k, w, y, P = r_[:4]
        o += [{'m': 0, 'r': 1, 'k': 2}[k], int(w*10), int(y*10), len(P)]
        for q in P: o += [X(q[0]), Z(q[1])]
    for b in BOX.get(tl, []):
        o += [X(b[0]), Z(b[1]), int(b[2]*10000), int(b[3]*10000), int(b[4]*10), int(b[5]*10), int(b[6]*10), int(b[7]*10), b[8], b[9]]
    for f_ in FRU.get(tl, []): o += [X(f_[0]), Z(f_[1]), int(f_[2]*2), int(f_[3]*2), int(f_[4]*2), int(f_[5]*2), int(RB_/RA*1000)]
    for s in SGN.get(tl, []): o += [X(s[0]), Z(s[1]), int(s[2]*10000), int(s[3]*10000), int(s[4]*10), int(s[5]*10), s[6], int(s[7]*10)]
    for P, y, c in POLY.get(tl, []):
        o += [len(P), int(y*100), c]
        for q in P: o += [X(q[0]), Z(q[1])]
    for q in TREES.get(tl, []): o += [X(q[0]), Z(q[1])]
    b = np.array(o, dtype='<i2').tobytes(); sizes += len(b)
    open(f'{OUT}/hyd/{tl[0]}_{tl[1]}.bin', 'wb').write(b)
log('tiles', len(all_t), 'MB', round(sizes/1e6, 2), 'mean KB', round(sizes/len(all_t)/1000, 1), 'max KB', max(os.path.getsize(f'{OUT}/hyd/{f}') for f in os.listdir(f'{OUT}/hyd'))//1000)
# ---------------------------------------------------------------------------------------- 13. arterial net: nav, traffic, nearestRoad; simplified map layers
netp = [p for p in pieces if p['t'] in ('highway', 'tar') and (p['c'] != 'tertiary' or inCity(*p['dp'][0]) or at(near2k, *p['dp'][0]))]
ids = set(id(p) for p in netp)
PTOK = {}
for p in pieces: PTOK.setdefault(p['a'], p['dp'][0]); PTOK.setdefault(p['b'], p['dp'][-1])
path_keys = None
deg = collections.Counter()
for p in netp: deg[p['a']] += 1; deg[p['b']] += 1
# merge chains through degree-2 nodes of the same class, direction and name
by = collections.defaultdict(list)
for p in netp: by[p['a']].append(p); by[p['b']].append(p)
used = set(); edges = []
def rev(P): return P[::-1]
def nkey(p, k): return p['a'] if k == 0 else p['b']
nodes = {}
nid = lambda k: nodes.setdefault(k, len(nodes))
RDP = thin
for p in netp:
    if id(p) in used: continue
    used.add(id(p)); pts = list(p['dp']); hs = list(p['dh']); a, b = p['a'], p['b']; one = p['one']; nm = p['ref'] or p['name'] or ''
    same = lambda q: q['t'] == p['t'] and q['w'] == p['w'] and q['one'] == one and (q['ref'] or q['name'] or '') == nm
    while deg[b] == 2:
        q = next((c for c in by[b] if id(c) not in used and same(c)), None)
        if not q: break
        if q['a'] == b: pts += q['dp'][1:]; hs += q['dh'][1:]; b = q['b']
        elif not one: pts += q['dp'][-2::-1]; hs += q['dh'][-2::-1]; b = q['a']
        else: break
        used.add(id(q))
    while deg[a] == 2:
        q = next((c for c in by[a] if id(c) not in used and same(c)), None)
        if not q: break
        if q['b'] == a: pts = q['dp'][:-1]+pts; hs = q['dh'][:-1]+hs; a = q['a']
        elif not one: pts = q['dp'][:0:-1]+pts; hs = q['dh'][:0:-1]+hs; a = q['b']
        else: break
        used.add(id(q))
    if max(hs) > .02: P2, h2 = pts, hs
    else: P2, h2 = thin(pts, hs, 1.2)
    edges.append([nid(a), nid(b), p['w'], p['t'], [[round(q[0], 1), round(q[1], 1)] + ([round(y, 2)] if y > .02 else []) for q, y in zip(P2, h2)], 1 if one else 0, nm, 0])
lifted_ = collections.defaultdict(list)
for e in edges:
    for q in e[4]:
        if len(q) > 2 and q[2] > .5: lifted_[(int(q[0]//30), int(q[1]//30))].append((q[0], q[1]))
nbes = 0
for e in edges:
    if any(len(q) > 2 and q[2] > .5 for q in e[4]): continue
    sam = [(u[0]+(v[0]-u[0])*k/max(1, int(plen([u[:2], v[:2]])/8)), u[1]+(v[1]-u[1])*k/max(1, int(plen([u[:2], v[:2]])/8))) for u, v in zip(e[4], e[4][1:]) for k in range(max(1, int(plen([u[:2], v[:2]])/8)))]
    n_ = sum(1 for q in sam if any(math.hypot(q[0]-a, q[1]-b) < 14 for i in (-1, 0, 1) for j in (-1, 0, 1) for a, b in lifted_.get((int(q[0]//30)+i, int(q[1]//30)+j), [])))
    if n_ and n_ >= len(sam)*.5: e[7] = 2; nbes += 1
log('ground roads beside a deck marked so the route takes the deck', nbes)
names = sorted({e[6] for e in edges}); ni = {n: i for i, n in enumerate(names)}
for e in edges: e[6] = ni[e[6]]
NN = [None]*len(nodes)
for k, i in nodes.items(): NN[i] = [round(PTOK[k][0], 1), round(PTOK[k][1], 1)]
jn_out = [[nodes[j[0]], j[1][0], j[1][1]] for j in joins if j[0] in nodes]
def ds(P, tol): return [[round(q[0]), round(q[1])] for q in thin(P, [0]*len(P), tol)[0]]
net = dict(nodes=NN, edges=edges, names=names, joins=jn_out, rail=[ds(r['p'], 8) for r in rail], metro=[ds(m['p'], 6) for m in metro], water=[ds(p+[p[0]], 12) for p in water if abs(area(p)) > 20000], jnames=jnames)
json.dump(net, open(f'{OUT}/hyd-net.json', 'w'), separators=(',', ':'), ensure_ascii=False)
log('net nodes', len(NN), 'edges', len(edges), 'KB', os.path.getsize(f'{OUT}/hyd-net.json')//1024)
# route again on the net alone: this is the graph nav.js gets
NG = collections.defaultdict(list); KMH_ = {'highway': 70, 'tar': 45}
for n, e in enumerate(edges):
    L = plen([q[:2] for q in e[4]]); s = L/(KMH_[e[3]]/3.6)*(3 if e[7] == 2 else 1); NG[e[0]].append((e[1], L, s, n))
    if not e[5]: NG[e[1]].append((e[0], L, s, n))
def nroute(src, x, z):
    dst = min(range(len(NN)), key=lambda i: math.hypot(NN[i][0]-x, NN[i][1]-z)); d = {s: 0 for s in src}; pv = {}; pq = [(0, s) for s in src]
    while pq:
        c, u = heapq.heappop(pq)
        if u == dst: break
        if c > d[u]: continue
        for v, L, s, n in NG[u]:
            if c+s < d.get(v, 1e15): d[v] = c+s; pv[v] = (u, n, L); heapq.heappush(pq, (c+s, v))
    if dst not in d: return None
    u = dst; km = 0
    while u in pv: u, n, L = pv[u]; km += L
    return round(km/1000, 1), round(math.hypot(NN[dst][0]-x, NN[dst][1]-z))
# Tarnaka to Secunderabad by the Inner Ring Road through Mettuguda: edges of that path carry a preference flag nav.js honours
def npath(a, b):
    d = {a: 0}; pv = {}; pq = [(0, a)]
    while pq:
        c, u = heapq.heappop(pq)
        if u == b: break
        if c > d[u]: continue
        for v, L, s, n in NG[u]:
            if c+s < d.get(v, 1e15): d[v] = c+s; pv[v] = (u, n, L); heapq.heappush(pq, (c+s, v))
    if b not in d: return None
    o = []; km = 0; u = b
    while u in pv: u, n, L = pv[u]; o.append(n); km += L
    return o[::-1], km/1000
nn = lambda lo, la: min(range(len(NN)), key=lambda i: math.hypot(NN[i][0]-ll(lo, la)[0], NN[i][1]-ll(lo, la)[1]))
tn, mg, sn = nn(78.53097, 17.42664), nn(78.5195, 17.4355), nn(78.50112, 17.4337)
p0 = npath(tn, sn); p1 = npath(tn, mg); p2 = npath(mg, sn)
via = None
if p1 and p2:
    for n in p1[0]+p2[0]: edges[n][7] = 1 if edges[n][7] != 2 else 2
    via = {'direct_km': p0 and round(p0[1], 2), 'via_mettuguda_km': round(p1[1]+p2[1], 2), 'names': collections.Counter(names[edges[n][6]] for n in p1[0]+p2[0]).most_common(6), 'gap_to_mettuguda_m': round(math.hypot(NN[mg][0]-ll(78.5195, 17.4355)[0], NN[mg][1]-ll(78.5195, 17.4355)[1]))}
    json.dump(net, open(f'{OUT}/hyd-net.json', 'w'), separators=(',', ':'), ensure_ascii=False)
rep['tarnaka_via_mettuguda'] = via; log(via)
rep['net_route_directed'] = {nm: nroute([j[0] for j in jn_out if True], *ll(lo, la)) for nm, lo, la in (('Uppal X Road', 78.56028, 17.40151), ('Habsiguda', 78.54065, 17.41994), ('Tarnaka', 78.5284, 17.4283), ('Secunderabad Jn', 78.50112, 17.4337), ('Bhongir station', 78.898362, 17.5239764), ('Ghatkesar station', 78.67830, 17.45286))}
log(rep['net_route_directed'])
# ---------------------------------------------------------------------------------------- 14. the small always-loaded file
occ = {}
for i, j in sorted(all_t): occ.setdefault(j, []).append(i)
def snap(x, z):
    b = (1e9, x, z)
    for e in edges:
        for q in e[4]:
            d = math.hypot(q[0]-x, q[1]-z)
            if d < b[0]: b = (d, q[0], q[1])
    return b
TOWNS = [(n, snap(*c)[1:]) for n, c in TOWNS]
sn_ = snap(*SEC)
for l in LM:
    if l['name'] == 'Secunderabad Junction Railway Station': l['x'], l['z'] = sn_[1], sn_[2]; l['src'] += '; pin on the forecourt road, building at the audit point'; log('station pin moved', round(sn_[0]))
lite = dict(bounds=[HX0, HZ0, RX0, HZ1], T=T, NX=NX+1, NZ=NZ, occ={str(j): v for j, v in occ.items()}, city=[round(v) for v in CITY], signs=sorted(signs, key=signs.get),
            landmarks=[{k: l[k] for k in ('name', 'k', 'x', 'z', 'src')} | ({'xcheck': l['xcheck']} if l['xcheck'] else {}) for l in LM], towns=[[n, round(c[0]), round(c[1])] for n, c in TOWNS],
            report=rep, coverage={'footprints': len(rings), 'heightsReal': real, 'heightsInferred': len(rings)-real, 'droppedInRoad': dropped, 'trimmed': trimmed, 'roadsKm': round(sum(plen(p['dp']) for p in pieces)/1000), 'tiles': len(all_t), 'tileMB': round(sizes/1e6, 1), 'railKm': round(sum(plen(r['p']) for r in rail)/1000), 'metroKm': round(sum(plen(r['p']) for r in metro)/1000)},
            inferred=['building heights unless heightsReal', 'road widths by class', 'deck heights 6.4 m per level', 'ramps 5.5 percent', 'metro structure dimensions', 'Bhongir rock shape', 'flat terrain'])
open(f'{OUT}/hyd-lite.js', 'w').write('window.HYD_LITE=' + json.dumps(lite, separators=(',', ':'), ensure_ascii=False) + ';\n')
log('station buildings', globals().get('stationB', 0)); cn = globals().get('canopies', []); log('canopies', len(cn), [round(v) for v in cn[len(cn)//2]] if cn else None)
for xq in (-60000, -55000, -40000, -20000):
    o_ = []
    for p in pieces:
        if p['ref'] == 'NH-163' and p['one'] and p.get('gap'):
            for k, b_ in p['gap'].items():
                a_ = p['dp'][k]
                if abs(a_[0]-xq) < 20: o_.append((round(b_[0], 1), p['w'], pieces[b_[3]]['w'], round(b_[0]-(p['w']+pieces[b_[3]]['w'])/2, 2)))
    log('NH-163 at x', xq, 'gap, width, width, clear', o_[:3])
tot = [(b_[0]-(p['w']+pieces[b_[3]]['w'])/2) for p in pieces if p['ref'] == 'NH-163' and p.get('gap') for b_ in p['gap'].values()]
log('NH-163 sampled points', len(tot), 'overlapping', sum(1 for v in tot if v < 0), 'worst', round(min(tot), 2))
log('lite KB', os.path.getsize(f'{OUT}/hyd-lite.js')//1024, 'signs', len(signs), 'landmarks', len(LM))
