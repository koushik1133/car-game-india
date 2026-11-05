// Off-main-thread tile builder for the streamed Jangaon town. Holds jangaon-data.json, turns one tile at a time into typed
// arrays (no THREE here), so the main thread only wraps transferred buffers. Layout of the texture atlas: see makeAtlas in jangaon.js.
//  building mesh vertices: [far-only][shared][near-only]   far draws 0..far+shared, near draws far..end
//  ground mesh vertices:   [far roads][ground][near roads]  same trick; far roads are lifted so they do not z-fight at distance
const SHELLED = new Set(['showroom','showroom2','showroom3','bikeShowroom','bikeShowroom2','autoShowroom','upgrade']);
let SITES = [];
const inShell = (x, z) => SITES.some(q => { const dx = x-q.x, dz = z-q.z, a = dx*q.c-dz*q.s, b = dx*q.s+dz*q.c; return Math.abs(a) < q.w/2+2 && b > -q.d/2-2 && b < q.d/2+10; });   // the walk-in shell and its door approach stay clear
let H = null, Hd = null, HUMPS = [];
const hAt = (x, z) => { if (!H) return 0; const u = (x-H.x0)/40, v = (z-H.z0)/40, i = Math.floor(u), j = Math.floor(v); if (i < 0 || j < 0 || i >= H.nx-1 || j >= H.nz-1) return 0; const a = u-i, b = v-j, q = j*H.nx+i, d = Hd; return ((d[q]*(1-a)+d[q+1]*a)*(1-b)+(d[q+H.nx]*(1-a)+d[q+H.nx+1]*a)*b)/100; };
let D = null, dens = null, railBy = null, plat = [];
const ROAD_Y = { highway: 0.11, tar: 0.09, cc: 0.07, lane: 0.06, dirt: 0.05 }, ROAD_COL = { highway: [.23, .23, .235], tar: [.29, .28, .27], cc: [.72, .70, .66], dirt: [.60, .47, .33] };
const SURF_CODE = { dirt: 1, cc: 2, tar: 3, highway: 4 };
const PAINT = [[.95,.93,.88],[.95,.93,.88],[.92,.88,.78],[.66,.85,.63],[.62,.8,.91],[.95,.72,.78],[.96,.88,.54],[.79,.7,.88],[.96,.78,.54],[.56,.84,.79],[.91,.89,.78],[.72,.88,.69],[.85,.85,.85]];
const hash = (x, z, s) => { let h = (Math.imul(x * 10 | 0, 73856093) ^ Math.imul(z * 10 | 0, 19349663) ^ Math.imul(s | 0, 83492791)) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function List() { this.p = []; this.n = []; this.u = []; this.c = []; }
const CELL = (i, r) => [i / 8 + .002, 1 - (r + 1) / 8 + .002, (i + 1) / 8 - .002, 1 - r / 8 - .002];
const SIGN = n => { const c = n % 3, r = Math.floor(n / 3), y = 512 + r * 48; return [c * 682 / 2048 + .001, 1 - (y + 47) / 2048, (c + 1) * 682 / 2048 - .001, 1 - y / 2048]; };
// a,b bottom pair, c,d top pair (c above b). uv rect [u0,v0,u1,v1] mapped u a->b, v bottom->top; rep repeats nothing: atlas only
function quad(L, a, b, c, d, n, uv, col) {
  const ux = b[0]-a[0], uy = b[1]-a[1], uz = b[2]-a[2], vx = d[0]-a[0], vy = d[1]-a[1], vz = d[2]-a[2];
  const cx = uy*vz-uz*vy, cy = uz*vx-ux*vz, cz = ux*vy-uy*vx, fl = cx*n[0]+cy*n[1]+cz*n[2] < 0;
  const A = [a[0],a[1],a[2],uv[0],uv[1]], B = [b[0],b[1],b[2],uv[2],uv[1]], C = [c[0],c[1],c[2],uv[2],uv[3]], E = [d[0],d[1],d[2],uv[0],uv[3]];
  for (const v of fl ? [A,E,C,A,C,B] : [A,B,C,A,C,E]) { L.p.push(v[0],v[1],v[2]); L.n.push(n[0],n[1],n[2]); L.u.push(v[3],v[4]); L.c.push(col[0],col[1],col[2]); }
}
const WHITE = CELL(7, 0);
function hquad(L, x0, z0, x1, z1, y, col, uv) { quad(L, [x0,y,z0], [x1,y,z0], [x1,y,z1], [x0,y,z1], [0,1,0], uv || WHITE, col); }
// box aligned to axes (ux,uz)/(nx,nz), centre cx,cz
function box(L, cx, cz, ux, uz, hw, hd, y0, y1, col, uvFront, seg, roof) {
  const nx = -uz, nz = ux, P = (a, b, y) => [cx + ux*a + nx*b, y, cz + uz*a + nz*b];
  const sides = [[[-hw,-hd],[hw,-hd],[-nx,-nz]], [[hw,-hd],[hw,hd],[ux,uz]], [[hw,hd],[-hw,hd],[nx,nz]], [[-hw,hd],[-hw,-hd],[-ux,-uz]]];
  sides.forEach(([a, b, n], i) => { quad(L, P(a[0],a[1],y0), P(b[0],b[1],y0), P(b[0],b[1],y1), P(a[0],a[1],y1), [n[0],0,n[1]], (i === 0 && uvFront) || WHITE, col);
    if (seg) { const p = P(a[0],a[1],0), q = P(b[0],b[1],0); seg.push(p[0],p[2],q[0],q[2]); } });
  quad(L, P(-hw,-hd,y1), P(hw,-hd,y1), P(hw,hd,y1), P(-hw,hd,y1), [0,1,0], WHITE, roof || col);
}
function earclip(p) {
  const n = p.length, V = [...Array(n).keys()], T = [];
  const cr = (a, b, c) => (p[b][0]-p[a][0])*(p[c][1]-p[a][1]) - (p[b][1]-p[a][1])*(p[c][0]-p[a][0]);
  let area = 0; for (let i = 0; i < n; i++) area += p[i][0]*p[(i+1)%n][1] - p[(i+1)%n][0]*p[i][1];
  const s = area > 0 ? 1 : -1; let guard = 0;
  while (V.length > 3 && guard++ < 3 * n * n) {
    let ok = false;
    for (let i = 0; i < V.length; i++) {
      const a = V[(i + V.length - 1) % V.length], b = V[i], c = V[(i + 1) % V.length];
      if (cr(a, b, c) * s <= 0) continue;
      let bad = false;
      for (const q of V) { if (q === a || q === b || q === c) continue; if (cr(a,b,q)*s >= 0 && cr(b,c,q)*s >= 0 && cr(c,a,q)*s >= 0) { bad = true; break; } }
      if (bad) continue; T.push(a, b, c); V.splice(i, 1); ok = true; break;
    }
    if (!ok) break;
  }
  if (V.length === 3) T.push(V[0], V[1], V[2]);
  return T;
}
function poly(L, p, y, col) { const T = earclip(p); for (let i = 0; i < T.length; i += 3) { const a = p[T[i]], b = p[T[i+1]], c = p[T[i+2]];
  const s = (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]) < 0, o = s ? [a,b,c] : [a,c,b];
  for (const v of o) { L.p.push(v[0],y,v[1]); L.n.push(0,1,0); L.u.push(WHITE[0],WHITE[1]); L.c.push(col[0],col[1],col[2]); } } }

function init(d) {
  D = d;
  // 40 m density grid for ground colour (town earth vs fields)
  const [x0, z0, x1, z1] = D.bounds, w = Math.ceil((x1 - x0) / 40) + 1, h = Math.ceil((z1 - z0) / 40) + 1, g = new Float32Array(w * h);
  for (const k in D.tiles) for (const b of D.tiles[k].b) { const p = b[0], i = (p[0]-x0)/40 | 0, j = (p[1]-z0)/40 | 0; if (i >= 0 && j >= 0 && i < w && j < h) g[j*w+i]++; }
  dens = { g, w, h };
  railBy = new Map();
  const put = (k, v) => { (railBy.get(k) || railBy.set(k, []).get(k)).push(v); };
  const st = D.lm.find(l => l.k === 'station'); plat = [];
  for (const r of D.rail) for (let i = 0; i + 1 < r.length; i++) {
    const a = r[i], b = r[i+1], L = Math.hypot(b[0]-a[0], b[1]-a[1]), n = Math.max(1, Math.ceil(L / 20));
    for (let k = 0; k < n; k++) { const ax = a[0]+(b[0]-a[0])*k/n, az = a[1]+(b[1]-a[1])*k/n, bx = a[0]+(b[0]-a[0])*(k+1)/n, bz = a[1]+(b[1]-a[1])*(k+1)/n;
      put(tid((ax+bx)/2, (az+bz)/2), [ax,az,bx,bz]);
      if (st && Math.hypot((ax+bx)/2-st.x, (az+bz)/2-st.z) < 190) plat.push([ax,az,bx,bz]); }
  }
  // the platform: inferred strip on the station side of the nearest track (OSM has no platform here)
  if (st && plat.length) { let bd = 1e9, bl = 0; for (const s of plat) { const d2 = Math.hypot((s[0]+s[2])/2-st.x, (s[1]+s[3])/2-st.z); if (d2 < bd) { bd = d2; bl = s; } }
    const lin = (bl[2]-bl[0])*(st.z-bl[1]) - (bl[3]-bl[1])*(st.x-bl[0]); D.platSide = lin >= 0 ? 1 : -1;
    plat = plat.filter(s => { const dx = s[2]-s[0], dz = s[3]-s[1]; const q = ((s[0]-bl[0])*-(bl[3]-bl[1]) + (s[1]-bl[1])*(bl[2]-bl[0])) / Math.hypot(bl[2]-bl[0], bl[3]-bl[1]); return Math.abs(q) < 2.5 && Math.abs(dx*(bl[2]-bl[0])+dz*(bl[3]-bl[1])) > 0; }); }
}
const tid = (x, z) => Math.floor((x - D.bounds[0]) / D.T) + ',' + Math.floor((z - D.bounds[1]) / D.T);
const groundCol = (x, z) => {
  const [x0, z0] = D.bounds, i = Math.max(0, Math.min(dens.w-1, (x-x0)/40|0)), j = Math.max(0, Math.min(dens.h-1, (z-z0)/40|0)); let s = 0;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const q = (j+b)*dens.w+i+a; if (q >= 0 && q < dens.g.length) s += dens.g[q]; }
  const n = hash(Math.floor(x/80), Math.floor(z/80), 7), t = Math.min(1, s / 4), f = n < .15 ? [.5,.52,.3] : n < .65 ? [.69,.57,.41] : n < .85 ? [.66,.42,.27] : [.6,.56,.36], e = [.66,.56,.42];
  return [f[0]+(e[0]-f[0])*t, f[1]+(e[1]-f[1])*t, f[2]+(e[2]-f[2])*t];
};
function buildTile(i, j) {
  const T = D.T, x0 = D.bounds[0] + i*T, z0 = D.bounds[1] + j*T, t = D.tiles[i+','+j] || { b: [], r: [] };
  const far = new List(), sh = new List(), near = new List(), gFar = new List(), g = new List(), gNear = new List(), seg = [], fp = [];
  // ---------- surface raster (2 m), roads of neighbours included so joints are clean
  const SN = 160, surf = new Uint8Array(SN * SN), mark = (ax, az, bx, bz, hw, code) => {
    const a0 = Math.max(0, Math.floor((Math.min(ax,bx)-hw-x0)/2)), a1 = Math.min(SN-1, Math.floor((Math.max(ax,bx)+hw-x0)/2)), b0 = Math.max(0, Math.floor((Math.min(az,bz)-hw-z0)/2)), b1 = Math.min(SN-1, Math.floor((Math.max(az,bz)+hw-z0)/2));
    const dx = bx-ax, dz = bz-az, L2 = dx*dx+dz*dz || 1;
    for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) { const px = x0+a*2+1, pz = z0+b*2+1, tt = Math.max(0, Math.min(1, ((px-ax)*dx+(pz-az)*dz)/L2));
      if (Math.hypot(px-ax-tt*dx, pz-az-tt*dz) <= hw && surf[b*SN+a] < code) surf[b*SN+a] = code; } };
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const q = D.tiles[(i+a)+','+(j+b)]; if (q) for (const r of q.r) mark(r[0],r[1],r[2],r[3],r[5]/2+.3,SURF_CODE[r[4]]||1); }
  for (const r of railBy.get(i+','+j) || []) mark(r[0],r[1],r[2],r[3],2.6,1);
  // ---------- ground
  const GS = 40; for (let a = 0; a < T/GS; a++) for (let b = 0; b < T/GS; b++) {
    const X = [x0+a*GS, x0+(a+1)*GS], Z = [z0+b*GS, z0+(b+1)*GS], uvw = 1/12, V = [[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]];   // colours per corner, so tiles blend
    for (const v of V) { const x = X[v[0]], z = Z[v[1]], c = groundCol(x, z); g.p.push(x,.03,z);   /* above the village's camera-following terrain patch, y 0 */ g.n.push(0,1,0); g.u.push(x*uvw,z*uvw); g.c.push(c[0],c[1],c[2]); }
  }
  // ---------- roads
  const arts = [];
  for (const r of t.r) { const [ax,az,bx,bz,ty,w,ns] = r; if (ty === 'tar' || ty === 'highway') arts.push(r);
    if (ns) continue;
    const L = Math.hypot(bx-ax, bz-az) || 1, ux = (bx-ax)/L, uz = (bz-az)/L, nx = -uz*w/2, nz = ux*w/2, e = .7, y = ROAD_Y[ty], c = ROAD_COL[ty];
    const P = [ax-ux*e, az-uz*e, bx+ux*e, bz+uz*e], R = (LL, yy) => quad(LL, [P[0]+nx,yy,P[1]+nz], [P[2]+nx,yy,P[3]+nz], [P[2]-nx,yy,P[3]-nz], [P[0]-nx,yy,P[1]-nz], [0,1,0], [ax/12, az/12, (ax+L)/12, (az+w)/12], c);
    R(gNear, y); R(gFar, y + .35);
    if (w >= 6 && ty !== 'dirt' && ty !== 'cc') for (let s = 2; s < L; s += 9) { const h = .07, x = ax+ux*s, z = az+uz*s, q = Math.min(4, L-s);
      quad(gNear, [x-uz*h,y+.015,z+ux*h], [x+ux*q-uz*h,y+.015,z+uz*q+ux*h], [x+ux*q+uz*h,y+.015,z+uz*q-ux*h], [x+uz*h,y+.015,z-ux*h], [0,1,0], [.001,.001,.002,.002], [1.6,1.6,1.5]); } }
  // ---------- rail: ballast, rails, sleepers
  for (const r of railBy.get(i+','+j) || []) { const [ax,az,bx,bz] = r, L = Math.hypot(bx-ax,bz-az)||1, ux = (bx-ax)/L, uz = (bz-az)/L, nx = -uz, nz = ux, s = 2.2;
    quad(gNear,[ax+nx*s,.1,az+nz*s],[bx+nx*s,.1,bz+nz*s],[bx-nx*s,.1,bz-nz*s],[ax-nx*s,.1,az-nz*s],[0,1,0],[ax/12,az/12,bx/12,bz/12],[.38,.36,.34]);
    quad(gFar,[ax+nx*s,.45,az+nz*s],[bx+nx*s,.45,bz+nz*s],[bx-nx*s,.45,bz-nz*s],[ax-nx*s,.45,az-nz*s],[0,1,0],[ax/12,az/12,bx/12,bz/12],[.38,.36,.34]);
    for (let q = .4; q < L; q += 1.6) { const x = ax+ux*q, z = az+uz*q, m = 1.25, h = .13; quad(near,[x+nx*m-ux*h,.16,z+nz*m-uz*h],[x+nx*m+ux*h,.16,z+nz*m+uz*h],[x-nx*m+ux*h,.16,z-nz*m+uz*h],[x-nx*m-ux*h,.16,z-nz*m-uz*h],[0,1,0],WHITE,[.27,.24,.2]); }
    for (const o of [-.76,.76]) quad(near,[ax+nx*(o-.05),.24,az+nz*(o-.05)],[bx+nx*(o-.05),.24,bz+nz*(o-.05)],[bx+nx*(o+.05),.24,bz+nz*(o+.05)],[ax+nx*(o+.05),.24,az+nz*(o+.05)],[0,1,0],WHITE,[.5,.5,.52]); }
  for (const r of plat) { if (tid((r[0]+r[2])/2,(r[1]+r[3])/2) !== i+','+j) continue;
    const L = Math.hypot(r[2]-r[0],r[3]-r[1])||1, ux=(r[2]-r[0])/L, uz=(r[3]-r[1])/L, s=D.platSide, nx=-uz*s, nz=ux*s, mx=(r[0]+r[2])/2+nx*5.6, mz=(r[1]+r[3])/2+nz*5.6;
    box(sh, mx, mz, ux, uz, L/2+.2, 3, 0, .9, [.74,.71,.66], null, seg);
    for (const f of [-L/4, L/4]) box(near, mx+ux*f, mz+uz*f, ux, uz, .12, .12, .9, 4.4, [.3,.45,.6]);
    box(sh, mx, mz, ux, uz, L/2+.2, 2.4, 4.4, 4.6, [.58,.3,.24]);
    // parked rake on the track beyond (inferred)
    box(sh, mx-nx*5.6, mz-nz*5.6, ux, uz, L/2-.5, 1.5, .9, 4, [.2,.31,.55]); seg.push(r[0],r[1],r[2],r[3]); }
  // ---------- buildings
  const artNear = (x, z, R) => { for (const r of arts) { const dx=r[2]-r[0], dz=r[3]-r[1], L2=dx*dx+dz*dz||1, q=Math.max(0,Math.min(1,((x-r[0])*dx+(z-r[1])*dz)/L2)); if (Math.hypot(x-r[0]-q*dx,z-r[1]-q*dz) < r[5]/2+R) return true; } return false; };
  const footIn = (x, z) => { for (const b of t.b) { const p = b[0]; let c = false; for (let q = 0; q < p.length; q++) { const a = p[q], e = p[(q+1)%p.length]; if ((a[1]>z)!==(e[1]>z) && x<(e[0]-a[0])*(z-a[1])/(e[1]-a[1])+a[0]) c=!c; } if (c) return true; } return false; };
  for (const b of t.b) {
    if (b.slice(0,-1).some(q => inShell(q[0],q[1]))) continue;
    const s0 = [far.p.length, sh.p.length, near.p.length];
    const m = b[b.length-1], p = b.slice(0, -1), n = p.length; let A = 0, cx = 0, cz = 0;
    for (let q = 0; q < n; q++) { const a = p[q], e = p[(q+1)%n]; A += a[0]*e[1]-e[0]*a[1]; cx += a[0]; cz += a[1]; seg.push(a[0],a[1],e[0],e[1]); } A = Math.abs(A)/2; cx /= n; cz /= n;
    fp.push(n, ...p.flat());
    const R = k => hash(cx, cz, k), dn = dens.g[Math.min(dens.g.length-1, Math.max(0, (((cz-D.bounds[1])/40|0)*dens.w+((cx-D.bounds[0])/40|0))))], shed = A > 700 && !m.l;
    let fl = shed ? 2 : A < 30 ? 1 : m.f ? 2 + Math.floor(R(1) * (dn > 5 ? 3.4 : 2.2)) : 1 + Math.floor(R(1) * (dn > 5 ? 3 : 2));
    if (m.l === 'hospital' || m.l === 'school') fl = Math.max(fl, 2) + (A > 300 ? 1 : 0);
    const FH = 3.2, h = fl * FH; let col = PAINT[Math.floor(R(2)*PAINT.length)];
    if (m.l) col = { hospital:[.95,.96,.95], school:[.96,.84,.45], temple:[.96,.72,.4], station:[.93,.76,.42], bank:[.85,.87,.92], police:[.72,.5,.38], theatre:[.8,.75,.8], church:[.95,.95,.92], mosque:[.75,.9,.78], civic:[.9,.83,.7], busstand:[.9,.86,.75], market:[.8,.78,.7], fuel:[.95,.95,.95] }[m.l] || col;
    const roofC = shed ? [.42,.53,.67] : [.62,.6,.56].map(v => v*(.85+.3*R(3)));
    poly(sh, p, h, roofC);
    let longest = 0, signEdge = -1;
    for (let q = 0; q < n; q++) {
      const a = p[q], e = p[(q+1)%n], L = Math.hypot(e[0]-a[0], e[1]-a[1]); if (L < .05) continue;
      const nx = (e[1]-a[1])/L, nz = -(e[0]-a[0])/L, mx = (a[0]+e[0])/2, mz = (a[1]+e[1])/2, N = [nx,0,nz];
      quad(far, [a[0],0,a[1]], [e[0],0,e[1]], [e[0],h,e[1]], [a[0],h,a[1]], N, shed ? CELL(5,0) : CELL(0,0), col);
      const face = (m.f || m.l) && artNear(mx+nx*7, mz+nz*7, 6) && !footIn(mx+nx*2, mz+nz*2);
      if (L > longest && (face || signEdge < 0)) { longest = L; signEdge = q; }
      const bays = Math.max(1, Math.round(L / 3.4));
      for (let f = 0; f < fl; f++) for (let k = 0; k < bays; k++) {
        const t0 = k/bays, t1 = (k+1)/bays, X = u => [a[0]+(e[0]-a[0])*u, a[1]+(e[1]-a[1])*u], A0 = X(t0), A1 = X(t1), y0 = f*FH, y1 = y0+FH, r = hash(mx+k, mz+f, 5);
        let uv = CELL(r < .55 ? 0 : r < .8 ? 1 : 3, 0), c2 = col;
        if (shed) uv = CELL(f ? 3 : 5, 0);
        else if (f === 0 && face && !m.l) { uv = CELL(Math.floor(r*8), 1); c2 = [1,1,1]; }
        else if (f === 0 && r < .22) uv = CELL(2, 0);
        quad(near, [A0[0],y0,A0[1]], [A1[0],y0,A1[1]], [A1[0],y1,A1[1]], [A0[0],y1,A0[1]], N, uv, c2);
      }
      if (!shed && h > 3 && fl > 1) for (let f = 1; f < fl; f++) { const o = .25, y = f*FH; quad(near,[a[0],y,a[1]],[e[0],y,e[1]],[e[0]+nx*o,y,e[1]+nz*o],[a[0]+nx*o,y,a[1]+nz*o],[0,1,0],WHITE,[.8,.78,.74]); }
      if (!shed) quad(near,[a[0],h,a[1]],[e[0],h,e[1]],[e[0],h+.9,e[1]],[a[0],h+.9,a[1]],N,WHITE,[col[0]*.92,col[1]*.92,col[2]*.92]);
      if (face && !m.l && !shed) { const o = 1.5, y = 3.1; quad(near,[a[0],y,a[1]],[e[0],y,e[1]],[e[0]+nx*o,y-.5,e[1]+nz*o],[a[0]+nx*o,y-.5,a[1]+nz*o],[nx*.3,.95,nz*.3],WHITE,[[.2,.4,.7],[.75,.25,.2],[.25,.55,.35],[.9,.7,.2]][Math.floor(R(q+9)*4)]); }
    }
    if (!shed && A > 45 && R(6) < .6) { const tx = cx+(R(7)-.5)*2, tz = cz+(R(8)-.5)*2; box(near, tx, tz, 1, 0, .6, .6, h, h+1.1, [.12,.12,.13]); }
    if (m.s != null && signEdge >= 0) { const a = p[signEdge], e = p[(signEdge+1)%n], L = longest, nx = (e[1]-a[1])/L, nz = -(e[0]-a[0])/L, w = Math.min(L*.9, 14), mx=(a[0]+e[0])/2+nx*.25, mz=(a[1]+e[1])/2+nz*.25, ux=(e[0]-a[0])/L, uz=(e[1]-a[1])/L, y=Math.max(3.4,FH+.1), hh=w/8;
      const P = (s, yy) => [mx+ux*s, yy, mz+uz*s]; quad(sh, P(-w/2,y), P(w/2,y), P(w/2,y+hh), P(-w/2,y+hh), [nx,0,nz], SIGN(m.s), [1,1,1]); }
    if (m.l === 'temple') for (let k = 0; k < 4; k++) { const s = 3.2 - k*.7; box(sh, cx, cz, 1, 0, s, s, h+k*1.3, h+(k+1)*1.3, k%2 ? [.95,.9,.75] : [.92,.6,.32]); }
    if (m.l === 'mosque') { box(sh, cx, cz, 1, 0, 2.6, 2.6, h, h+1, [.85,.95,.85]); box(sh, cx, cz, .707, .707, 1.7, 1.7, h+1, h+2.4, [.3,.65,.45]); }
    if (m.l === 'church') { box(sh, cx, cz, 1, 0, .15, .15, h, h+3, [.9,.9,.9]); box(sh, cx, cz, 1, 0, .8, .12, h+1.9, h+2.2, [.9,.9,.9]); }
    const hb = Math.min(...b.slice(0,-1).map(q => hAt(q[0],q[1]))); [far,sh,near].forEach((Q,k) => (Q.fix = Q.fix || []).push([s0[k], Q.p.length, hb]));
  }
  // ---------- humps (inferred, see build_jangaon_net.py)
  for (const q of HUMPS) { if (tid(q[0],q[1]) !== i+','+j) continue; const sa=Math.sin(q[2]), ca=Math.cos(q[2]), W=q[3]/2, Ln=q[4], P=(al,si,y)=>[q[0]+sa*al+ca*si,y,q[1]+ca*al-sa*si], n=6;
    for (let k=0;k<n;k++) { const a0=-Ln/2+Ln*k/n, a1=a0+Ln/n, y=al=>.1+q[5]*Math.cos(Math.PI*al/Ln)**2; quad(gNear,P(a0,-W,y(a0)),P(a1,-W,y(a1)),P(a1,W,y(a1)),P(a0,W,y(a0)),[0,1,0],WHITE,k%2?[.95,.85,.3]:[.25,.25,.25]); } }
  // ---------- landmark extras (each inferred from kind, located at the real point)
  for (const l of D.lm) { if (tid(l.x, l.z) !== i+','+j) continue;
    let ux = 1, uz = 0, cx = l.x, cz = l.z, rn = null, rd = 1e9;
    for (const r of arts.length ? arts : t.r) { const dx=r[2]-r[0], dz=r[3]-r[1], L=Math.hypot(dx,dz)||1, q=Math.max(0,Math.min(1,((l.x-r[0])*dx+(l.z-r[1])*dz)/(L*L))), px=r[0]+q*dx, pz=r[1]+q*dz, d=Math.hypot(l.x-px,l.z-pz); if (d<rd) { rd=d; rn=[px,pz,dx/L,dz/L,r[5]]; } }
    if (rn) { ux = rn[2]; uz = rn[3]; }
    if (l.k === 'fuel' && rn) { let ox=l.x-rn[0], oz=l.z-rn[1], oL=Math.hypot(ox,oz)||1; ox/=oL; oz/=oL; cx=rn[0]+ox*(rn[4]/2+9); cz=rn[1]+oz*(rn[4]/2+9);
      for (const f of [[-5,-3],[5,-3],[-5,3],[5,3]]) box(sh, cx+ux*f[0]+-uz*f[1], cz+uz*f[0]+ux*f[1], ux, uz, .22, .22, 0, 5, [.9,.9,.9], null, seg);
      box(sh, cx, cz, ux, uz, 8, 5, 5, 5.7, [.95,.95,.97], null, null, [.85,.2,.15]);
      for (const f of [-3,3]) box(near, cx+ux*f, cz+uz*f, ux, uz, .5, .3, 0, 1.8, [.85,.2,.15], null, seg);
      const px = cx+ux*11, pz = cz+uz*11; box(sh, px, pz, ux, uz, .15, .15, 0, 6.5, [.8,.8,.8]);
      const n2 = [-uz*(ox*-uz+oz*ux>0?-1:1),0,ux*(ox*-uz+oz*ux>0?-1:1)]; quad(sh,[px-ux*2.4,6.5,pz-uz*2.4],[px+ux*2.4,6.5,pz+uz*2.4],[px+ux*2.4,7.1,pz+uz*2.4],[px-ux*2.4,7.1,pz-uz*2.4],n2,SIGN(l.s),[1,1,1]); }
    if (l.k === 'busstand') for (const o of [-13,13]) { const X=cx-uz*o, Z=cz+ux*o; if (!footIn(X,Z)) { box(sh,X,Z,ux,uz,22,5,4.3,4.8,[.8,.8,.76],null,null,[.72,.25,.2]); for (let f=-20;f<=20;f+=10) box(sh,X+ux*f,Z+uz*f,ux,uz,.25,.25,0,4.3,[.8,.75,.65],null,seg); } }
    if (l.k === 'market') for (let a=-1;a<=1;a++) for (let b=-1;b<=1;b++) { const X=cx+ux*a*26-uz*b*16, Z=cz+uz*a*26+ux*b*16; if (footIn(X,Z)) continue; box(sh,X,Z,ux,uz,11,6,4.4,4.8,[.7,.7,.7],null,null,[.46,.56,.68]); for (const f of [[-10,-5],[10,-5],[-10,5],[10,5]]) box(sh,X+ux*f[0]-uz*f[1],Z+uz*f[0]+ux*f[1],ux,uz,.2,.2,0,4.4,[.6,.6,.6],null,seg); }
    if (l.k === 'school' && !footIn(cx+6,cz)) { box(sh,cx+6,cz,1,0,.06,.06,0,7,[.85,.85,.85]); box(sh,cx+6.6,cz,1,0,.55,.02,6,6.8,[.95,.55,.15]); }
  }
  // ---------- site lots: forecourt plus a shell at the back of the lot
  for (const l of D.lots) { if (tid(l.x, l.z) !== i+','+j) continue;
    const c=[.72,.71,.68], ux=l.ux, uz=l.uz, nx=l.nx, nz=l.nz, W=l.w/2, Dp=l.d/2, Q=(a,b,y)=>[l.x+ux*a+nx*b,y,l.z+uz*a+nz*b];
    quad(gNear,Q(-W,-Dp,.13),Q(W,-Dp,.13),Q(W,Dp,.13),Q(-W,Dp,.13),[0,1,0],[0,0,W/6,Dp/6],c); quad(gFar,Q(-W,-Dp,.46),Q(W,-Dp,.46),Q(W,Dp,.46),Q(-W,Dp,.46),[0,1,0],[0,0,1,1],c);
    const bw=W*.86, bd=Dp*.46, bo=Dp-bd-.3, bx=l.x+nx*bo, bz=l.z+nz*bo, s2=(nx*-uz+nz*ux)>0?1:-1, H=l.k==='taxiStand'||SHELLED.has(l.k)?0:6.5;   /* showroom.js builds the walk-in shell for these */
    mark(l.x-ux*W-nx*Dp, l.z-uz*W-nz*Dp, l.x+ux*W+nx*Dp, l.z+uz*W+nz*Dp, 0, 0);
    if (H) { const a=[bx+ux*-bw-nx*bd,0,bz+uz*-bw-nz*bd], b=[bx+ux*bw-nx*bd,0,bz+uz*bw-nz*bd], u2=H;
      box(sh, bx, bz, ux*s2, uz*s2, bw, bd, 0, H, [.86,.88,.9], null, seg, [.5,.5,.5]);
      const bays=Math.round(bw*2/5); for (let k=0;k<bays;k++) { const t0=k/bays,t1=(k+1)/bays,P=(u,y)=>[a[0]+(b[0]-a[0])*u-nx*.04,y,a[2]+(b[2]-a[2])*u-nz*.04]; quad(near,P(t0,0),P(t1,0),P(t1,4.6),P(t0,4.6),[-nx,0,-nz],CELL(4,0),[1,1,1]); }
      const sw=Math.min(bw*1.6,24), mx=bx-nx*(bd+.1), mz=bz-nz*(bd+.1), P2=(a2,y)=>[mx+ux*a2,y,mz+uz*a2]; quad(sh,P2(-sw/2,4.7),P2(sw/2,4.7),P2(sw/2,4.7+sw/10),P2(-sw/2,4.7+sw/10),[-nx,0,-nz],SIGN(l.s),[1,1,1]); }
  }
  // ---------- landmarks without a footprint get a small block; trees inferred, roads clear
  for (const l of D.lm) { if (tid(l.x,l.z)!==i+','+j || l.k==='fuel' || l.k==='market' || l.k==='busstand') continue; if (!footIn(l.x,l.z) && surf[Math.floor((l.z-z0)/2)*SN+Math.floor((l.x-x0)/2)]===0 && (l.k==='station')) box(sh,l.x,l.z,1,0,14,6,0,6,[.93,.76,.42],null,seg,[.6,.3,.22]); }
  for (let k = 0; k < 16; k++) { const x = x0+hash(i,j,k*3+1)*T, z = z0+hash(i,j,k*3+2)*T, q = Math.floor((z-z0)/2)*SN+Math.floor((x-x0)/2); if (surf[q] || footIn(x,z) || inShell(x,z)) continue;
    const s = 2.2+hash(i,j,k*3+3)*2.4, c=[.26+.08*hash(x,z,1),.42+.1*hash(x,z,2),.2]; box(sh,x,z,1,0,.22,.22,0,2.6,[.34,.26,.18]); box(sh,x,z,.707,.707,s*.8,s*.8,2.4,2.4+s*.7,c); box(sh,x,z,1,0,s*.6,s*.6,2.4+s*.7,2.4+s*1.25,[c[0]*1.15,c[1]*1.15,c[2]*1.1]); seg.push(x-.2,z,x+.2,z); }
  const lift = Q => { const r = Q.fix || []; let k = 0; for (let v = 0; v < Q.p.length; v += 3) { while (k < r.length && v >= r[k][1]) k++; Q.p[v+1] += k < r.length && v >= r[k][0] ? r[k][2] : hAt(Q.p[v], Q.p[v+2]); } };
  [far, sh, near, g, gFar, gNear].forEach(lift);
  const pack = (A, B, C) => { const P = [...A.p, ...B.p, ...C.p], N = [...A.n, ...B.n, ...C.n], U = [...A.u, ...B.u, ...C.u], Co = [...A.c, ...B.c, ...C.c];
    return { pos: new Float32Array(P), nor: new Float32Array(N), uv: new Float32Array(U), col: new Float32Array(Co), a: A.p.length/3, b: B.p.length/3, c: C.p.length/3 }; };
  const B = pack(far, sh, near), G = pack(gFar, g, gNear), sg = new Float32Array(seg), fpa = new Float32Array(fp);
  return { i, j, x0, z0, B, G, seg: sg, surf, fp: fpa };
}
self.onmessage = async e => {
  const m = e.data;
  if (m.init) { H = m.H; Hd = new Int16Array(H.d); HUMPS = m.humps; SITES = m.sites; const r = await fetch(m.init); init(await r.json()); self.postMessage({ ready: true }); return; }
  const t0 = performance.now(), r = buildTile(m.i, m.j); r.ms = performance.now() - t0;
  self.postMessage(r, [r.B.pos.buffer, r.B.nor.buffer, r.B.uv.buffer, r.B.col.buffer, r.G.pos.buffer, r.G.nor.buffer, r.G.uv.buffer, r.G.col.buffer, r.seg.buffer, r.surf.buffer, r.fp.buffer]);
};
