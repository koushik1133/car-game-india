// Off-main-thread builder for the Nellutla -> Secunderabad corridor. One 640 m tile at a time: fetch hyd/<i>_<j>.bin (see tools/build_hyderabad.py),
// return typed arrays local to the tile origin, so nothing jitters 70 km from the world origin. No THREE here.
//  B mesh (facade texture, one quad per wall at any height): [structures + big buildings][small buildings + trees][near-only detail]
//  G mesh (noise texture): [far roads][ground, water][near roads, markings]; far roads are lifted so they do not z-fight at distance
//  S mesh (shop + sign atlas): near only
const T = 640, SN = 320, ROAD_Y = { 4: .11, 3: .09, 2: .07, 1: .05 }, DECK_Y = .115;
const ROAD_COL = { 4: [.23, .23, .235], 3: [.28, .275, .27], 2: [.42, .41, .4], 1: [.6, .47, .33] };
const PAINT = [[.95,.93,.88],[.95,.93,.88],[.92,.88,.78],[.86,.86,.84],[.82,.84,.86],[.95,.8,.72],[.96,.88,.62],[.8,.74,.86],[.96,.82,.62],[.7,.84,.8],[.91,.89,.78],[.78,.88,.72],[.9,.9,.9]];
const KC = { 1:[.95,.96,.95], 2:[.96,.84,.45], 3:[.96,.72,.4], 4:[.75,.9,.78], 5:[.95,.95,.92], 6:[.93,.76,.42], 7:[.93,.93,.9], 8:[.9,.86,.75], 9:[.84,.87,.92], 10:[.8,.75,.8], 11:[.95,.95,.95], 12:[.72,.5,.38] };
const STRUCT = [[.74,.72,.68],[.3,.3,.3],[.74,.71,.66],[.82,.82,.8],[.72,.74,.76],[.5,.46,.4],[.8,.8,.78],[1,.76,.6],[.2,.26,.3],[.5,.49,.46],[.95,.94,.9],[.1,.45,.2],[.95,.55,.12],[.22,.38,.62],[.2,.36,.16],[.9,.9,.88],[.9,.9,.88]];
const PLAIN = 1.5 / 512;
const hash = (x, z, s) => { let h = (Math.imul(x * 10 | 0, 73856093) ^ Math.imul(z * 10 | 0, 19349663) ^ Math.imul(s | 0, 83492791)) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
class List {
  constructor(n) { this.n = 0; this.cap = n || 4096; this.p = new Float32Array(this.cap * 3); this.u = new Float32Array(this.cap * 2); this.m = new Int8Array(this.cap * 4); this.c = new Uint8Array(this.cap * 4); }
  grow() { this.cap *= 2; const g = (a, C, k) => { const b = new C(this.cap * k); b.set(a); return b; }; this.p = g(this.p, Float32Array, 3); this.u = g(this.u, Float32Array, 2); this.m = g(this.m, Int8Array, 4); this.c = g(this.c, Uint8Array, 4); }
  v(x, y, z, nx, ny, nz, u, w, r, g, b) { if (this.n === this.cap) this.grow(); const i = this.n++; this.p[i*3] = x; this.p[i*3+1] = y; this.p[i*3+2] = z; this.u[i*2] = u; this.u[i*2+1] = w; this.m[i*4] = nx*127; this.m[i*4+1] = ny*127; this.m[i*4+2] = nz*127; this.c[i*4] = Math.min(255, r*255); this.c[i*4+1] = Math.min(255, g*255); this.c[i*4+2] = Math.min(255, b*255); this.c[i*4+3] = 255; }
}
// a,b bottom pair, c,d top pair. uv [u0,v0,u1,v1]
function quad(L, a, b, c, d, n, uv, col) {
  const ux = b[0]-a[0], uy = b[1]-a[1], uz = b[2]-a[2], vx = d[0]-a[0], vy = d[1]-a[1], vz = d[2]-a[2], cx = uy*vz-uz*vy, cy = uz*vx-ux*vz, cz = ux*vy-uy*vx, fl = cx*n[0]+cy*n[1]+cz*n[2] < 0;
  const V = (q, s, t) => L.v(q[0], q[1], q[2], n[0], n[1], n[2], s, t, col[0], col[1], col[2]);
  if (fl) { V(a,uv[0],uv[1]); V(d,uv[0],uv[3]); V(c,uv[2],uv[3]); V(a,uv[0],uv[1]); V(c,uv[2],uv[3]); V(b,uv[2],uv[1]); }
  else { V(a,uv[0],uv[1]); V(b,uv[2],uv[1]); V(c,uv[2],uv[3]); V(a,uv[0],uv[1]); V(c,uv[2],uv[3]); V(d,uv[0],uv[3]); }
}
const PU = [PLAIN, PLAIN, PLAIN, PLAIN], UP = [0, 1, 0];
function box(L, cx, cz, ux, uz, hw, hd, y0, y1, col, seg, roof) {
  const nx = -uz, nz = ux, P = (a, b, y) => [cx+ux*a+nx*b, y, cz+uz*a+nz*b];
  [[[-hw,-hd],[hw,-hd],[-nx,-nz]], [[hw,-hd],[hw,hd],[ux,uz]], [[hw,hd],[-hw,hd],[nx,nz]], [[-hw,hd],[-hw,-hd],[-ux,-uz]]].forEach(([a, b, n]) => { quad(L, P(a[0],a[1],y0), P(b[0],b[1],y0), P(b[0],b[1],y1), P(a[0],a[1],y1), [n[0],0,n[1]], PU, col);
    if (seg) { const p = P(a[0],a[1],0), q = P(b[0],b[1],0); seg.push(p[0],p[2],q[0],q[2]); } });
  quad(L, P(-hw,-hd,y1), P(hw,-hd,y1), P(hw,hd,y1), P(-hw,hd,y1), UP, PU, roof || col);
}
function earclip(p) {
  const n = p.length, V = [...Array(n).keys()], R = [], cr = (a, b, c) => (p[b][0]-p[a][0])*(p[c][1]-p[a][1]) - (p[b][1]-p[a][1])*(p[c][0]-p[a][0]);
  let area = 0; for (let i = 0; i < n; i++) area += p[i][0]*p[(i+1)%n][1] - p[(i+1)%n][0]*p[i][1];
  const s = area > 0 ? 1 : -1; let guard = 0;
  while (V.length > 3 && guard++ < 3*n*n) { let ok = false;
    for (let i = 0; i < V.length; i++) { const a = V[(i+V.length-1)%V.length], b = V[i], c = V[(i+1)%V.length]; if (cr(a,b,c)*s <= 0) continue; let bad = false;
      for (const q of V) { if (q === a || q === b || q === c) continue; if (cr(a,b,q)*s >= 0 && cr(b,c,q)*s >= 0 && cr(c,a,q)*s >= 0) { bad = true; break; } }
      if (bad) continue; R.push(a, b, c); V.splice(i, 1); ok = true; break; }
    if (!ok) break; }
  if (V.length === 3) R.push(V[0], V[1], V[2]); return R;
}
function poly(L, p, y, col, uv) { const R = earclip(p); for (let i = 0; i < R.length; i += 3) { const a = p[R[i]], b = p[R[i+1]], c = p[R[i+2]], s = (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]) < 0, o = s ? [a,b,c] : [a,c,b];
  for (const v of o) L.v(v[0], y, v[1], 0, 1, 0, uv ? v[0]/12 : PLAIN, uv ? v[1]/12 : PLAIN, col[0], col[1], col[2]); } }
// mitred ribbon through P [[x,z,y]], flat up normal; optional uv scale for the noise texture
function ribbon(L, P, hw, yAdd, col, tex) {
  let pl = null, pr = null;
  for (let i = 0; i < P.length; i++) { const a = P[Math.max(0,i-1)], b = P[Math.min(P.length-1,i+1)], m = P[i], dx = b[0]-a[0], dz = b[1]-a[1], l = Math.hypot(dx,dz)||1; let nx = -dz/l, nz = dx/l, k = 1;
    if (i > 0 && i < P.length-1) { const l1 = Math.hypot(m[0]-a[0], m[1]-a[1])||1, n1x = -(m[1]-a[1])/l1, n1z = (m[0]-a[0])/l1, c = nx*n1x+nz*n1z; k = 1/Math.max(.55, c); }
    const y = (m[2]||0)+yAdd, l_ = [m[0]+nx*hw*k, y, m[1]+nz*hw*k], r_ = [m[0]-nx*hw*k, y, m[1]-nz*hw*k];
    if (pl) quad(L, pl, l_, r_, pr, UP, tex ? [m[0]/12, m[1]/12, m[0]/12+.1, m[1]/12+.1] : PU, col);
    pl = l_; pr = r_; }
}
function build(i, j, x0, z0, buf, detail) {
  const D = new Int16Array(buf); let q = 0; const ver = D[q++], nR = D[q++], nB = D[q++], nL = D[q++], nW = D[q++], nI = D[q++], nX = D[q++], nF = D[q++], nS = D[q++], nFar = D[q++], nP = D[q++], CITY = D[q++], nT = D[q++];
  const X = () => D[q++] / 10;
  const B0 = new List(16384), B1 = new List(16384), B2 = new List(8192), G0 = new List(2048), G1 = new List(4096), G2 = new List(4096), S = new List(1024), seg = [], fp = [], decks = [];
  const surf = new Uint8Array(SN*SN), mark = (ax, az, bx, bz, hw, code) => { const a0 = Math.max(0, Math.floor((Math.min(ax,bx)-hw)/2)), a1 = Math.min(SN-1, Math.floor((Math.max(ax,bx)+hw)/2)), b0 = Math.max(0, Math.floor((Math.min(az,bz)-hw)/2)), b1 = Math.min(SN-1, Math.floor((Math.max(az,bz)+hw)/2)), dx = bx-ax, dz = bz-az, L2 = dx*dx+dz*dz||1;
    for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) { const px = a*2+1, pz = b*2+1, t = Math.max(0, Math.min(1, ((px-ax)*dx+(pz-az)*dz)/L2)); if (Math.hypot(px-ax-t*dx, pz-az-t*dz) <= hw && surf[b*SN+a] < code) surf[b*SN+a] = code; } };
  // ---------- roads
  const arts = [], later = [];
  for (let r = 0; r < nR; r++) { const f = D[q++], w = D[q++]/10, n = D[q++], code = f & 7, el = !!(f & 8), own = !!(f & 16), one = !!(f & 32), art = !!(f & 64), P = [];
    for (let k = 0; k < n; k++) { const x = X(), z = X(), y = el ? D[q++]/100 : 0; P.push([x, z, y]); }
    const hw = w/2;
    for (let k = 1; k < n; k++) { const a = P[k-1], b = P[k]; if (a[2] < .5 || b[2] < .5) mark(a[0],a[1],b[0],b[1],hw+.3,code); if (el && (a[2] > .02 || b[2] > .02)) decks.push(a[0],a[1],a[2],b[0],b[1],b[2],hw); if (art) arts.push(a[0],a[1],b[0],b[1],hw); }
    if (own) later.push([P, hw, code, el, one, art]); }
  const edge = (P, o) => P.map((c, k) => { const a = P[Math.max(0,k-1)], b = P[Math.min(P.length-1,k+1)], l = Math.hypot(b[0]-a[0],b[1]-a[1])||1; return [c[0]-(b[1]-a[1])/l*o, c[1]+(b[0]-a[0])/l*o, c[2]]; }), street = [];
  for (const [P, hw, code, el, one, art] of later) { const c = CITY ? (code >= 3 ? [.2,.2,.21] : code === 2 ? [.3,.3,.3] : [.46,.44,.41]) : ROAD_COL[code], y = ROAD_Y[code];
    if (CITY && art && !el && hw >= 3) for (const s of one ? [-1] : [-1, 1]) {     // kerb, interlock footpath, the street things on it. The side a one-way drives on (left) has the shops
      const k = edge(P, s*(hw+.15)), f = edge(P, s*(hw+1.2)), w = edge(P, s*(hw+2.2)); ribbon(G2, k, .15, y+.1, [.62,.6,.56]); ribbon(G2, f, .9, y+.06, [.42,.4,.38], 1); street.push([P, hw, s]);
      if (CITY >= 2) ribbon(B2, edge(P, s*(hw+.3)).map(q => q), .04, y+1, CITY === 2 ? [.45,.47,.5] : [.72,.76,.2]); }
    if (el) { ribbon(B0, P, hw, DECK_Y, c);                                    // decks: slab, parapet, wall or piers. Height comes from the graph, see build_hyderabad.py step 6
      for (let k = 1; k < P.length; k++) { const a = P[k-1], b = P[k], L = Math.hypot(b[0]-a[0],b[1]-a[1])||1, nx = -(b[1]-a[1])/L*hw, nz = (b[0]-a[0])/L*hw, m = Math.max(a[2], b[2]); if (m < .3) continue;
        const low = Math.min(a[2], b[2]), slab = low > 2.4;
        for (const s of [1,-1]) { const pa = [a[0]+nx*s, a[2]+DECK_Y, a[1]+nz*s], pb = [b[0]+nx*s, b[2]+DECK_Y, b[1]+nz*s], N = [nx/hw*s, 0, nz/hw*s], ya = slab ? a[2]-1 : 0, yb = slab ? b[2]-1 : 0;
          quad(B0, [pa[0],ya,pa[2]], [pb[0],yb,pb[2]], pb, pa, N, PU, slab ? [.62,.61,.58] : [.56,.54,.5]);
          if (m > 1.2) quad(B0, pa, pb, [pb[0],pb[1]+.75,pb[2]], [pa[0],pa[1]+.75,pa[2]], N, PU, [.8,.79,.76]); }
        if (slab) { quad(B0, [a[0]-nx,a[2]-1,a[1]-nz], [b[0]-nx,b[2]-1,b[1]-nz], [b[0]+nx,b[2]-1,b[1]+nz], [a[0]+nx,a[2]-1,a[1]+nz], [0,-1,0], PU, [.5,.49,.47]);
          if (Math.floor(hash(a[0],a[1],3)*4) === 0) for (const s of [1,-1]) { const px = a[0]+nx*s*.86, pz = a[1]+nz*s*.86, ca = Math.floor(pz/2)*SN+Math.floor(px/2); if (px >= 0 && pz >= 0 && px < T && pz < T && !surf[ca]) box(B0, px, pz, 1, 0, .6, .6, 0, a[2]-1, [.7,.69,.66], seg); } } }
      continue; }
    if (art || code >= 3) ribbon(G0, P, hw, y+.36, c, 1);
    ribbon(G2, P, hw, y, c, 1);
    if (hw >= 3) for (let k = 1; k < P.length; k++) { const a = P[k-1], b = P[k], L = Math.hypot(b[0]-a[0],b[1]-a[1])||1, ux = (b[0]-a[0])/L, uz = (b[1]-a[1])/L, h = .07, Y = y+.015;
      for (let s = 2; s < L; s += 9) { if (one && code < 4) break; const x = a[0]+ux*s, z = a[1]+uz*s, d = Math.min(4, L-s); quad(G2, [x-uz*h,Y,z+ux*h], [x+ux*d-uz*h,Y,z+uz*d+ux*h], [x+ux*d+uz*h,Y,z+uz*d-ux*h], [x+uz*h,Y,z-ux*h], UP, [.001,.001,.002,.002], [1,1,.95]); } }
  }
  // ---------- buildings: structures come first so they stay in the far range
  const rails = []; 
  const bStart = q; let foots = []; 
  const dg = new Uint8Array(64);
  for (let b = 0; b < nB; b++) { const n = D[q++], h = D[q++]/10, fl = D[q++], sg = D[q++], p = []; for (let k = 0; k < n; k++) { const x = X(), z = X(); p.push([x, z]); }
    const m = { h, f: fl&1, inf: fl&2, shed: fl&4, k: fl>>3, sg }; let A = 0, cx = 0, cz = 0;
    for (let k = 0; k < n; k++) { const a = p[k], e = p[(k+1)%n]; A += a[0]*e[1]-e[0]*a[1]; cx += a[0]; cz += a[1]; seg.push(a[0],a[1],e[0],e[1]); } A = Math.abs(A)/2; cx /= n; cz /= n;
    fp.push(n); for (const c of p) fp.push(c[0], c[1]);
    const di = Math.min(7, Math.max(0, cx/80|0)), dj = Math.min(7, Math.max(0, cz/80|0)); dg[dj*8+di] = Math.min(255, dg[dj*8+di]+1);
    foots.push(p); const L = b < nFar ? B0 : B1, wx = x0+cx, wz = z0+cz, R = k => hash(wx, wz, k);
    let col = m.k && KC[m.k] ? KC[m.k] : PAINT[Math.floor(R(2)*PAINT.length)]; const floors = Math.max(1, Math.round(h/3.2)), sh = m.shed || m.k === 7 || m.k === 6;
    const rv = R(3), rc = CITY && !m.k ? (rv < .08 ? [.34,.46,.62] : rv < .55 ? [.82,.79,.72] : rv < .85 ? [.74,.73,.7] : [.62,.6,.57]) : sh ? [.42,.53,.67] : [.62,.6,.56].map(v => v*(.85+.3*rv));
    poly(L, p, h, sh ? [.42,.53,.67] : rc);
    const offu = Math.floor(R(4)*4)/4, offv = Math.floor(R(5)*4)/4; let longest = 0, se = -1;
    for (let k = 0; k < n; k++) { const a = p[k], e = p[(k+1)%n], l = Math.hypot(e[0]-a[0], e[1]-a[1]); if (l < .05) continue; const nx = (e[1]-a[1])/l, nz = -(e[0]-a[0])/l, N = [nx,0,nz], mx = (a[0]+e[0])/2, mz = (a[1]+e[1])/2, bays = Math.max(1, Math.round(l/3.4));
      quad(L, [a[0],0,a[1]], [e[0],0,e[1]], [e[0],h,e[1]], [a[0],h,a[1]], N, sh ? PU : [offu, offv, offu+bays/4, offv+floors/4], sh ? [col[0]*.85,col[1]*.85,col[2]*.85] : col);
      const face = (m.f || m.k) && artNear(arts, mx+nx*11, mz+nz*11, 10);
      if (l > longest && (face || se < 0)) { longest = l; se = k; }
      if (face && !sh && !m.k && l > 3) { const bs = Math.max(1, Math.round(l/5)); for (let s = 0; s < bs; s++) { const t0 = s/bs, t1 = (s+1)/bs, A0 = [a[0]+(e[0]-a[0])*t0+nx*.12, a[1]+(e[1]-a[1])*t0+nz*.12], A1 = [a[0]+(e[0]-a[0])*t1+nx*.12, a[1]+(e[1]-a[1])*t1+nz*.12], c = Math.floor(hash(mx+x0+s, mz+z0, 5)*8);
          quad(S, [A0[0],0,A0[1]], [A1[0],0,A1[1]], [A1[0],3.3,A1[1]], [A0[0],3.3,A0[1]], N, [(c+1)/8-.002, 1-256/2048+.002, c/8+.002, 1-.002], [1,1,1]); } }
      if (!sh && h > 3) quad(B2, [a[0],h,a[1]], [e[0],h,e[1]], [e[0],h+.9,e[1]], [a[0],h+.9,a[1]], N, PU, [col[0]*.92,col[1]*.92,col[2]*.92]);
    }
    if (!sh && A > 60 && R(6) < .5) { const tx = cx+(R(7)-.5)*3, tz = cz+(R(8)-.5)*3; box(B2, tx, tz, 1, 0, .6, .6, h+.9, h+2.2, R(9) < .7 ? [.12,.12,.13] : [.85,.85,.82]); if (CITY && R(10) < .7) box(B2, cx-(R(7)-.5)*3, cz-(R(8)-.5)*3, 1, 0, 1.5, 1.5, h, h+2.6, [col[0]*.9,col[1]*.9,col[2]*.9]); }
    if (m.f && CITY && !sh && R(50) < .14 && A > 80) { const a = p[0], e = p[1], l = Math.hypot(e[0]-a[0],e[1]-a[1])||1, ux = (e[0]-a[0])/l, uz = (e[1]-a[1])/l, nx = uz, nz = -ux, w = Math.min(9, l), c0 = Math.floor(R(51)*8), mx = (a[0]+e[0])/2, mz = (a[1]+e[1])/2, y0 = h+1.2, y1 = y0+w*.4; for (const f of [1,-1]) quad(S, [mx-ux*w/2,y0,mz-uz*w/2], [mx+ux*w/2,y0,mz+uz*w/2], [mx+ux*w/2,y1,mz+uz*w/2], [mx-ux*w/2,y1,mz-uz*w/2], [nx*f,0,nz*f], f>0 ? [(c0+1)/8-.002, 1-70/2048, c0/8+.002, 1-.002] : [c0/8+.002, 1-70/2048, (c0+1)/8-.002, 1-.002], [1,1,1]); box(B2, mx, mz, ux, uz, .08, .08, h, y0, [.3,.3,.3]); }
    if (m.f && CITY && !sh && floors >= 2 && !m.k) for (let k = 0; k < n; k++) { const a = p[k], e = p[(k+1)%n], l = Math.hypot(e[0]-a[0],e[1]-a[1]); if (l < 7 || R(20+k) > .5) continue; const nx = (e[1]-a[1])/l, nz = -(e[0]-a[0])/l; if (!artNear(arts, (a[0]+e[0])/2+nx*11, (a[1]+e[1])/2+nz*11, 10)) continue; const c0 = Math.floor(R(30+k)*8), t0 = .1+R(40+k)*.2, t1 = t0+.6, A0 = [a[0]+(e[0]-a[0])*t0+nx*.15, a[1]+(e[1]-a[1])*t0+nz*.15], A1 = [a[0]+(e[0]-a[0])*t1+nx*.15, a[1]+(e[1]-a[1])*t1+nz*.15], y0 = 3.5, y1 = 3.5+Math.min(4.5, l*.6*.4); quad(S, [A0[0],y0,A0[1]], [A1[0],y0,A1[1]], [A1[0],y1,A1[1]], [A0[0],y1,A0[1]], [nx,0,nz], [(c0+1)/8-.002, 1-70/2048, c0/8+.002, 1-.002], [1,1,1]); }
    if (m.k === 3) for (let k = 0; k < 4; k++) { const s = 3.2-k*.7; box(B2, cx, cz, 1, 0, s, s, h+k*1.3, h+(k+1)*1.3, k%2 ? [.95,.9,.75] : [.92,.6,.32]); }
    if (m.k === 4) { box(B2, cx, cz, 1, 0, 2.6, 2.6, h, h+1, [.85,.95,.85]); box(B2, cx, cz, .707, .707, 1.7, 1.7, h+1, h+2.4, [.3,.65,.45]); }
    if (sg > 0 && se >= 0) { const a = p[se], e = p[(se+1)%n], l = longest, nx = (e[1]-a[1])/l, nz = -(e[0]-a[0])/l, w = Math.min(l*.9, 16), mx = (a[0]+e[0])/2+nx*.3, mz = (a[1]+e[1])/2+nz*.3, ux = (e[0]-a[0])/l, uz = (e[1]-a[1])/l, y = Math.min(h-1.6, Math.max(3.4, 3.3)), hh = w/8; sign(S, mx, mz, ux, uz, w, y, hh, sg-1, [nx,0,nz]); }
  }
  for (let r = 0; r < nL; r++) { const n = D[q++], P = []; for (let k = 0; k < n; k++) { const x = X(), z = X(), y = D[q++]/100; P.push([x, z, y]); }
    const el = P.some(c => c[2] > .3);
    for (let k = 1; k < n; k++) if (P[k-1][2] < 1 && P[k][2] < 1) mark(P[k-1][0],P[k-1][1],P[k][0],P[k][1],2.6,1);
    if (el) { ribbon(B0, P, 2.2, .1, [.38,.36,.34]); for (let k = 1; k < n; k++) { const a = P[k-1], b = P[k], L = Math.hypot(b[0]-a[0],b[1]-a[1])||1, nx = -(b[1]-a[1])/L*2.2, nz = (b[0]-a[0])/L*2.2; if (Math.max(a[2],b[2]) < .3) continue; for (const s of [1,-1]) quad(B0, [a[0]+nx*s,0,a[1]+nz*s], [b[0]+nx*s,0,b[1]+nz*s], [b[0]+nx*s,b[2]+.1,b[1]+nz*s], [a[0]+nx*s,a[2]+.1,a[1]+nz*s], [nx/2.2*s,0,nz/2.2*s], PU, [.45,.43,.4]); } }
    else ribbon(G0, P, 2.2, .46, [.38,.36,.34], 1), ribbon(G2, P, 2.2, .1, [.38,.36,.34], 1);
    for (const o of [-.76,.76]) { const Q = P.map((c, k) => { const a = P[Math.max(0,k-1)], b = P[Math.min(n-1,k+1)], l = Math.hypot(b[0]-a[0],b[1]-a[1])||1; return [c[0]-(b[1]-a[1])/l*o, c[1]+(b[0]-a[0])/l*o, c[2]]; }); ribbon(B2, Q, .05, .24, [.5,.5,.52]); }
    for (let k = 1; k < n; k++) { const a = P[k-1], b = P[k], L = Math.hypot(b[0]-a[0],b[1]-a[1])||1, ux = (b[0]-a[0])/L, uz = (b[1]-a[1])/L, nx = -uz, nz = ux; for (let s = 0; s < L; s += 6) { const x = a[0]+ux*s, z = a[1]+uz*s, y = a[2]+(b[2]-a[2])*s/L+.16, m = 1.25, h = .13; quad(B2,[x+nx*m-ux*h,y,z+nz*m-uz*h],[x+nx*m+ux*h,y,z+nz*m+uz*h],[x-nx*m+ux*h,y,z-nz*m+uz*h],[x-nx*m-ux*h,y,z-nz*m-uz*h],UP,PU,[.27,.24,.2]); } }
  }
  for (let r = 0; r < nW; r++) { const n = D[q++], p = []; for (let k = 0; k < n; k++) { const x = X(), z = X(); p.push([x, z]); } poly(G1, p, .05, [.28,.46,.56], 1); }
  for (let r = 0; r < nI; r++) { const k = D[q++], w = D[q++]/10, y = D[q++]/10, n = D[q++], P = []; for (let e = 0; e < n; e++) { const x = X(), z = X(); P.push([x, z, y]); }
    if (k === 1) { ribbon(G1, P, w/2, .05, [.28,.46,.56], 1); continue; }
    if (k === 2) { ribbon(B1, P, w/2, 0, [.72,.71,.64]); continue; }
    ribbon(B0, P, w/2, 0, [.72,.71,.68]); const H = w/2; for (let e = 1; e < n; e++) { const a = P[e-1], b = P[e], L = Math.hypot(b[0]-a[0],b[1]-a[1])||1, nx = -(b[1]-a[1])/L*H, nz = (b[0]-a[0])/L*H; for (const s of [1,-1]) { const N = [nx/H*s,0,nz/H*s]; quad(B0, [a[0]+nx*s,y-1.4,a[1]+nz*s], [b[0]+nx*s,y-1.4,b[1]+nz*s], [b[0]+nx*s,y+.9,b[1]+nz*s], [a[0]+nx*s,y+.9,a[1]+nz*s], N, PU, [.92,.91,.88]); } quad(B0, [a[0]-nx,y-1.4,a[1]-nz], [b[0]-nx,y-1.4,b[1]-nz], [b[0]+nx,y-1.4,b[1]+nz], [a[0]+nx,y-1.4,a[1]+nz], [0,-1,0], PU, [1,1,.98]); }
    ribbon(B2, P, .4, .25, [.4,.38,.36]); }
  const NK = [];
  for (let r = 0; r < nX; r++) { const cx = X(), cz = X(), ux = D[q++]/1e4, uz = D[q++]/1e4, hw = D[q++]/10, hd = D[q++]/10, y0 = D[q++]/10, y1 = D[q++]/10, c = D[q++], so = D[q++]; if (c === 15) { NK.push([cx, cz, hw]); continue; } box(B0, cx, cz, ux, uz, hw, hd, y0, y1, STRUCT[c], so ? seg : null); if (c === 16) { const nx = -uz, nz = ux, P = (a, b) => [cx+ux*a+nx*b, y0, cz+uz*a+nz*b]; quad(B0, P(-hw,hd), P(hw,hd), P(hw,-hd), P(-hw,-hd), [0,-1,0], PU, [1,1,1]); } if (so && c === 2) 0; }
  let rad = T*.78; for (let r = 0; r < nF; r++) { const cx = X(), cz = X(), r0 = D[q++]/2, r1 = D[q++]/2, y0 = D[q++]/2, y1 = D[q++]/2, asp = D[q++]/1000, ns = 28; rad = 1100; const rr = (k, f) => f*(.97+.05*hash(k*7.3, 3, 11+y0)), c = [.5,.46,.4].map(v => v*(.85+y1/900));
    for (let k = 0; k < ns; k++) { const a0 = k/ns*6.2832, a1 = (k+1)/ns*6.2832, A = (a, f, y) => [cx+Math.cos(a)*f, y, cz+Math.sin(a)*f*asp], p = A(a0,rr(k,r0),y0), q2 = A(a1,rr(k+1,r0),y0), s = A(a1,rr(k+1,r1),y1), t = A(a0,rr(k,r1),y1), am = (a0+a1)/2; quad(B0, p, q2, s, t, [Math.cos(am)*.8,.6,Math.sin(am)*.8], PU, c); if (y1 >= 172) quad(B0, t, s, [cx,y1+6,cz], [cx,y1+6,cz], UP, PU, c); } }
  for (let r = 0; r < nS; r++) { const x = X(), z = X(), ux = D[q++]/1e4, uz = D[q++]/1e4, w = D[q++]/10, y = D[q++]/10, s = D[q++], o = D[q++]/10; for (const f of [1,-1]) sign(S, x-uz*o*f, z+ux*o*f, ux, uz, w, y, w/8, s, [-uz*f,0,ux*f]); }
  const PC = { 7: [.3,.5,.24], 8: [.17,.22,.13], 9: [.3,.38,.2] }; for (let r = 0; r < nP; r++) { const n = D[q++], y = D[q++]/100, c = D[q++], p = []; for (let k = 0; k < n; k++) { const x = X(), z = X(); p.push([x, z]); } poly(G1, p, y, PC[c]||[.5,.5,.5], 1); }
  // ---------- ground: 80 m cells, built up land is earth, the rest fields, colours per corner so tiles blend
  const gc = (x, z, t) => { if (CITY) { const n = hash(Math.floor((x0+x)/40), Math.floor((z0+z)/40), 9), c = n < .35 ? [.36,.35,.33] : n < .75 ? [.43,.41,.38] : [.5,.47,.42]; return c; } const n = hash(Math.floor((x0+x)/160), Math.floor((z0+z)/160), 7), f = n < .25 ? [.5,.52,.3] : n < .65 ? [.69,.57,.41] : n < .85 ? [.62,.44,.3] : [.6,.56,.36], e = [.6,.55,.47]; return [f[0]+(e[0]-f[0])*t, f[1]+(e[1]-f[1])*t, f[2]+(e[2]-f[2])*t]; };
  const dn = (a, b) => { let s = 0; for (const [u, v] of [[a,b],[a-1,b],[a,b-1],[a-1,b-1]]) if (u >= 0 && v >= 0 && u < 8 && v < 8) s += dg[v*8+u]; return Math.min(1, s/6); };
  for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) for (const v of [[0,0],[1,1],[1,0],[0,0],[0,1],[1,1]]) { const x = (a+v[0])*80, z = (b+v[1])*80, c = gc(x, z, dn(a+v[0], b+v[1])); G1.v(x, .03, z, 0, 1, 0, x/12, z/12, c[0], c[1], c[2]); }
  // inferred trees, roads and footprints clear
  const footIn = (x, z) => { for (const p of foots) { if (Math.abs(p[0][0]-x) > 60 || Math.abs(p[0][1]-z) > 60) continue; let c = false; for (let k = 0; k < p.length; k++) { const a = p[k], e = p[(k+1)%p.length]; if ((a[1]>z)!==(e[1]>z) && x<(e[0]-a[0])*(z-a[1])/(e[1]-a[1])+a[0]) c = !c; } if (c) return true; } return false; };
  const crown = (L, x, z, s, k) => { const c = [.2+.08*hash(x,z,1),.33+.12*hash(x,z,2),.15]; box(L,x,z,.92,.38,s*.8,s*.7,s*.55,s*1.35,c); };
  const treeCell = new Set();
  for (let r = 0; r < nT; r++) { const x = X(), z = X(), s = 3.2+hash(x,z,5)*2.6; treeCell.add(Math.floor(x/30)*1000+Math.floor(z/30)); crown(r % 6 === 0 ? B0 : B1, x, z, s); }
  const hasRoad = (x, z) => x < 0 || z < 0 || x >= T || z >= T || surf[Math.floor(z/2)*SN+Math.floor(x/2)] > 0;
  const shopCell = (c, r) => r ? [c/8+.002, 1-256/2048+.002, (c+1)/8-.002, 1-.002] : [(c+1)/8-.002, 1-256/2048+.002, c/8+.002, 1-.002];
  for (const [P, hw, s] of street) { let run = 0; for (let k = 1; k < P.length; k++) { const a = P[k-1], b = P[k], L = Math.hypot(b[0]-a[0],b[1]-a[1])||1, ux = (b[0]-a[0])/L, uz = (b[1]-a[1])/L, nx = -uz*s, nz = ux*s, o = hw+2.4+2;      // shops at the back of the footpath, filling the gap to the buildings
      for (let d = 3; d < L-3; d += 6.2) { run += 6.2; const x = a[0]+ux*d+nx*o, z = a[1]+uz*d+nz*o; if (hash(x0+x, z0+z, 21) > .62 || NK.some(k => Math.hypot(x-k[0], z-k[1]) < k[2]) || treeCell.has(Math.floor(x/30)*1000+Math.floor(z/30))) continue; let bad = false; for (const [e, f] of [[-3.8,-3.6],[3.8,-3.6],[-3.8,3],[3.8,3],[0,0]]) { const X_ = x+ux*e+nx*f, Z_ = z+uz*e+nz*f; if (hasRoad(X_, Z_) || footIn(X_, Z_)) bad = true; } if (bad) continue;
        const cc = PAINT[Math.floor(hash(x,z,22)*PAINT.length)], H_ = 3.3; box(B2, x, z, ux, uz, 2.9, 2, 0, H_, cc, seg); const fx = x-nx*2.04, fz = z-nz*2.04, c = Math.floor(hash(x,z,23)*8); quad(S, [fx-ux*2.9,0,fz-uz*2.9], [fx+ux*2.9,0,fz+uz*2.9], [fx+ux*2.9,H_,fz+uz*2.9], [fx-ux*2.9,H_,fz-uz*2.9], [-nx,0,-nz], shopCell(c, ux*-nz+uz*nx > 0), [1,1,1]); } } }
  for (const [P, hw, s] of street) for (let k = 1; k < P.length; k++) { const a = P[k-1], b = P[k], L = Math.hypot(b[0]-a[0],b[1]-a[1])||1, ux = (b[0]-a[0])/L, uz = (b[1]-a[1])/L; for (let d = 6; d < L; d += 13) { const h = hash(a[0]+d, a[1], 12), nx = uz*s, nz = -ux*s, X0 = a[0]+ux*d, Z0 = a[1]+uz*d, inl = h*7|0, o = hw+2.2;
      if (h < .26) { const x = X0+(-nz)*-1*0+nx*-1*0-uz*s*o, z = Z0+ux*s*o; if (!hasRoad(x,z) && !footIn(x,z)) { const q2 = 3+h*6; box(B1,x,z,1,0,.15,.15,0,3,[.24,.19,.14]); crown(B1,x,z,q2); seg.push(x-.15,z,x+.15,z); } }
      else if (h < .4) { const x = X0-uz*s*(hw+.7), z = Z0+ux*s*(hw+.7); if (!hasRoad(x,z)) { box(B2,x,z,1,0,.1,.1,0,8.5,[.42,.42,.4]); seg.push(x-.1,z,x+.1,z); } }
      else if (h < .72) { const o2 = hw-1.1, x = X0-uz*s*o2, z = Z0+ux*s*o2, cc = [[.7,.7,.72],[.2,.25,.45],[.5,.1,.1],[.85,.85,.8],[.15,.15,.16],[.9,.75,.2],[.3,.5,.3]][inl]; if (h < .6) { box(B2,x,z,ux,uz,.85,.3,.35,1.05,[.1,.1,.11]); box(B2,x+ux*1.4,z+uz*1.4,ux,uz,.85,.3,.35,1.05,cc); } else { box(B2,x,z,ux,uz,2.1,.85,.25,.85,cc); box(B2,x,z,ux,uz,1.1,.75,.85,1.4,[cc[0]*.6,cc[1]*.6,cc[2]*.6]); } } } }
  const nt = nB > 300 ? 8 : 40;
  for (let k = 0; k < nt; k++) { const x = hash(i,j,k*3+1)*T, z = hash(i,j,k*3+2)*T; if (surf[Math.floor(z/2)*SN+Math.floor(x/2)] || footIn(x,z)) continue; const s = 2.2+hash(i,j,k*3+3)*3, c = [.26+.08*hash(x,z,1),.42+.1*hash(x,z,2),.2]; box(B1,x,z,1,0,.22,.22,0,2.6,[.34,.26,.18]); box(B1,x,z,.707,.707,s*.8,s*.8,2.4,2.4+s*.7,c); box(B1,x,z,1,0,s*.6,s*.6,2.4+s*.7,2.4+s*1.25,[c[0]*1.15,c[1]*1.15,c[2]*1.1]); seg.push(x-.2,z,x+.2,z); }
  const pack = (A, Bb, C) => { const n = A.n+Bb.n+C.n, p = new Float32Array(n*3), u = new Float32Array(n*2), m = new Int8Array(n*4), c = new Uint8Array(n*4); let o = 0; for (const L of [A, Bb, C]) { p.set(L.p.subarray(0,L.n*3), o*3); u.set(L.u.subarray(0,L.n*2), o*2); m.set(L.m.subarray(0,L.n*4), o*4); c.set(L.c.subarray(0,L.n*4), o*4); o += L.n; } return { pos: p, uv: u, nor: m, col: c, a: A.n, b: Bb.n, c: C.n }; };
  return { i, j, x0, z0, rad, B: pack(B0, B1, detail ? B2 : new List(1)), G: pack(G0, G1, detail ? G2 : new List(1)), S: detail ? pack(S, new List(1), new List(1)) : pack(new List(1), new List(1), new List(1)), detail, seg: new Float32Array(seg), surf, fp: new Float32Array(fp), decks: new Float32Array(decks) };
}
function artNear(a, x, z, R) { for (let k = 0; k < a.length; k += 5) { if (Math.abs(a[k]-x) > 160 || Math.abs(a[k+1]-z) > 160) continue; const dx = a[k+2]-a[k], dz = a[k+3]-a[k+1], L2 = dx*dx+dz*dz||1, t = Math.max(0, Math.min(1, ((x-a[k])*dx+(z-a[k+1])*dz)/L2)); if (Math.hypot(x-a[k]-t*dx, z-a[k+1]-t*dz) < a[k+4]+R) return true; } return false; }
const SIGN_UV = n => { const c = n % 4, r = Math.floor(n / 4), y = 256 + r * 48; return [c/4+.001, 1-(y+47)/2048, (c+1)/4-.001, 1-y/2048]; };
function sign(S, mx, mz, ux, uz, w, y, hh, n, N) { const P = (s, yy) => [mx+ux*s, yy, mz+uz*s]; let uv = SIGN_UV(n); const a = P(-w/2,y), b = P(w/2,y), c = P(w/2,y+hh), d = P(-w/2,y+hh); const flip = (b[0]-a[0])*N[2]-(b[2]-a[2])*N[0] < 0; quad(S, flip ? b : a, flip ? a : b, flip ? d : c, flip ? c : d, N, uv, [1,1,1]); }
let base = '';
self.onmessage = async e => { const m = e.data; if (m.base) { base = m.base; return; }
  const t0 = performance.now(); let buf;
  try { const r = await fetch(base + 'hyd/' + m.i + '_' + m.j + '.bin?v=' + m.v); if (!r.ok) throw new Error('http ' + r.status); buf = await r.arrayBuffer(); } catch (err) { self.postMessage({ fail: 1, i: m.i, j: m.j, msg: String(err) }); return; }
  const f = performance.now(), R = build(m.i, m.j, m.x0, m.z0, buf, m.detail); R.ms = performance.now() - f; R.fetchMs = f - t0; R.bytes = buf.byteLength;
  self.postMessage(R, [R.B.pos.buffer, R.B.nor.buffer, R.B.uv.buffer, R.B.col.buffer, R.G.pos.buffer, R.G.nor.buffer, R.G.uv.buffer, R.G.col.buffer, R.S.pos.buffer, R.S.nor.buffer, R.S.uv.buffer, R.S.col.buffer, R.seg.buffer, R.surf.buffer, R.fp.buffer, R.decks.buffer]); };
