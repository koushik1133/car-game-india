"""Field-parcel extraction from the z18 mosaic.

Segments the farmland outside the village into individual fields (watershed on a
mean-shift-smoothed gradient, then region merging by colour similarity), simplifies each
field to a polygon and classifies it from its median colour and texture.

Classes (field 'c'):
  0 dry fallow          1 ploughed red soil    2 paddy (green, uniform)   3 flooded / dark paddy
  4 row crop (cotton/maize/chilli: green with row texture)              5 harvested stubble
  6 orchard / plantation (dotted tree pattern)  7 scrub / grazing     8 cloud-covered (filled as fallow)
"""
import math
import numpy as np
import cv2

BUND = 160.0
MERGE_D = 16.0
AXIS_K = 6.0
RECT_FILL = 0.8
TILE_M = 300.0

NAMES = ['fallow', 'ploughed', 'paddy', 'flooded_paddy', 'row_crop', 'stubble', 'orchard', 'scrub', 'cloud']


class DSU:
    def __init__(s, n): s.p = list(range(n))
    def f(s, a):
        while s.p[a] != a:
            s.p[a] = s.p[s.p[a]]; a = s.p[a]
        return a
    def u(s, a, b):
        a, b = s.f(a), s.f(b)
        if a != b: s.p[b] = a


def extract(mosaic, cloud, bld_mask, road_mask, river_px, lake_px, px2w, mpp, overlay_path=None, log=print):
    H, W = mosaic.shape[:2]
    F = 2                                   # work at half resolution (~1.15 m/px)
    w, h = W // F, H // F
    small = cv2.resize(mosaic, (w, h), interpolation=cv2.INTER_AREA)
    m_px = mpp * F

    # ---- exclusion mask: village (building density), roads, river bed, lakes
    excl = np.zeros((h, w), np.uint8)
    bs = cv2.resize(bld_mask, (w, h), interpolation=cv2.INTER_AREA)
    dens = cv2.blur((bs > 0).astype(np.float32), (41, 41))
    excl[dens > 0.12] = 255
    excl = cv2.dilate(excl, np.ones((9, 9), np.uint8))
    excl[cv2.dilate(bs, np.ones((5, 5), np.uint8)) > 0] = 255
    rs = cv2.resize(road_mask, (w, h), interpolation=cv2.INTER_NEAREST)
    excl[cv2.dilate(rs, np.ones((3, 3), np.uint8)) > 0] = 255
    for rv in river_px:
        cv2.polylines(excl, [(rv / F).astype(np.int32)], False, 255, int(26 / m_px))
    for lk in lake_px:
        cv2.fillPoly(excl, [(lk / F).astype(np.int32)], 255)
    cl = cv2.resize(cloud, (w, h), interpolation=cv2.INTER_NEAREST) > 0
    excl_seg = excl.copy(); excl_seg[cl] = 255          # cloud strip is filled with a field grid afterwards

    # ---- segmentation
    ms = cv2.pyrMeanShiftFiltering(small, 6, 14)
    lab = cv2.cvtColor(ms, cv2.COLOR_BGR2LAB).astype(np.float32)
    gx = np.zeros((h, w), np.float32)
    for k in range(3):
        sx = cv2.Sobel(lab[..., k], cv2.CV_32F, 1, 0, ksize=3); sy = cv2.Sobel(lab[..., k], cv2.CV_32F, 0, 1, ksize=3)
        gx += sx * sx + sy * sy
    grad = np.sqrt(gx)
    # thin bunds/paths: bright or dark 1-3 px lines (top-hat / black-hat on luminance)
    L = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    k5 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    ridge = cv2.morphologyEx(L, cv2.MORPH_TOPHAT, k5).astype(np.float32) + 0.6 * cv2.morphologyEx(L, cv2.MORPH_BLACKHAT, k5).astype(np.float32)
    # straight bunds: oriented line filter over the ridge response (suppresses dots, keeps long thin lines)
    best = np.zeros_like(ridge); n = 21; c0 = n // 2
    for a in np.arange(0, 180, 10):
        K = np.zeros((n, n), np.float32); ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
        for t in np.linspace(-c0, c0, 4 * n): K[int(round(c0 + sa * t)), int(round(c0 + ca * t))] = 1
        best = np.maximum(best, cv2.filter2D(ridge, -1, K / K.sum()))
    line = np.clip(best - cv2.blur(ridge, (n, n)), 0, None)
    # ---- dominant field-grid orientation per 300 m tile (Hough lines on the bund map)
    T = int(TILE_M / m_px); tw, th_ = (w + T - 1) // T, (h + T - 1) // T
    sgi = small.astype(np.int32)
    treey = cv2.blur(((small.max(axis=2) < 95) & (sgi[..., 1] >= sgi[..., 2])).astype(np.float32), (25, 25)) > 0.04
    okl = (excl == 0) & ~treey & ~cl                      # tree rows / orchards / cloud would vote for false directions
    lm = ((line > np.percentile(line[okl], 90)) & okl).astype(np.uint8) * 255
    segsL = cv2.HoughLinesP(lm, 1, np.pi / 180, 30, minLineLength=30, maxLineGap=4)
    segsL = segsL.reshape(-1, 4) if segsL is not None else np.zeros((0, 4))
    hist = np.zeros((th_, tw, 90))
    for x1, y1, x2, y2 in segsL:
        L_ = math.hypot(x2 - x1, y2 - y1); ang = int(round(math.degrees(math.atan2(y2 - y1, x2 - x1)))) % 90
        hist[int((y1 + y2) / 2) // T, int((x1 + x2) / 2) // T, ang] += L_
    gh = hist.sum((0, 1))
    def peak(hh):
        sm = sum(np.roll(hh, k) * (1 - abs(k) / 4) for k in range(-3, 4)); return int(np.argmax(sm))
    gang = peak(gh)
    tang = np.zeros((th_, tw)); tang2 = np.zeros((th_, tw))
    for ty in range(th_):
        for tx in range(tw):
            hh = hist[max(0, ty - 1):ty + 2, max(0, tx - 1):tx + 2].sum((0, 1)) * 0.5 + hist[ty, tx]
            p1 = peak(hh) if hh.sum() > 250 else gang
            tang[ty, tx] = math.radians(p1)
            h2 = hh.copy()
            for k in range(-15, 16): h2[(p1 + k) % 90] = 0
            tang2[ty, tx] = math.radians(peak(h2)) if h2.sum() > 150 else math.radians(p1)
    log('fields: hough lines', len(segsL), 'global grid angle', gang)

    # ---- axis-aligned bund/edge enhancement in each tile's grid frame: long 1-D averages along the two grid
    # directions keep straight bunds and field-to-field colour steps, and wash out blobs and texture
    Lf = cv2.GaussianBlur(L.astype(np.float32), (0, 0), 1.0)
    axis = np.zeros((h, w), np.float32); pad = 48
    for ty in range(th_):
        for tx in range(tw):
            x0_, y0_ = tx * T - pad, ty * T - pad; x1_, y1_ = min(w, (tx + 1) * T + pad), min(h, (ty + 1) * T + pad)
            X0c, Y0c = max(0, x0_), max(0, y0_)
            win_r = ridge[Y0c:y1_, X0c:x1_]; win_l = Lf[Y0c:y1_, X0c:x1_]; win_c = lab[Y0c:y1_, X0c:x1_]
            hh_, ww_ = win_r.shape; ctr = (ww_ / 2, hh_ / 2)
            M = cv2.getRotationMatrix2D(ctr, math.degrees(tang[ty, tx]), 1.0)
            Mi = cv2.invertAffineTransform(M)
            rr = cv2.warpAffine(win_r, M, (ww_, hh_), flags=cv2.INTER_LINEAR)
            ll = cv2.warpAffine(win_l, M, (ww_, hh_), flags=cv2.INTER_LINEAR)
            cc_ = cv2.warpAffine(win_c, M, (ww_, hh_), flags=cv2.INTER_LINEAR)
            out = np.zeros_like(rr)
            for horiz in (True, False):
                k1 = np.ones((1, 25), np.float32) / 25 if horiz else np.ones((25, 1), np.float32) / 25
                r1 = cv2.filter2D(rr, -1, k1)
                # colour step across the line (Sobel normal to it), averaged along it
                st = np.zeros_like(rr)
                for ch in range(3):
                    g_ = cv2.Sobel(cc_[..., ch], cv2.CV_32F, 0 if horiz else 1, 1 if horiz else 0, ksize=3)
                    st += np.abs(cv2.filter2D(g_, -1, k1))
                out = np.maximum(out, r1 * 3 + st * 0.5)
            back = cv2.warpAffine(out, Mi, (ww_, hh_), flags=cv2.INTER_LINEAR)
            ys_, xs_ = ty * T - Y0c, tx * T - X0c
            blk = back[ys_:ys_ + T, xs_:xs_ + T]
            axis[ty * T:ty * T + blk.shape[0], tx * T:tx * T + blk.shape[1]] = blk
    edge = grad * 0.5 + ridge * 2 + line * 8 + axis * AXIS_K
    # orchards/plantations: dotted tree canopies make edges everywhere; smooth the edge map there
    gs = L.astype(np.float32)
    hp0 = np.abs(gs - cv2.GaussianBlur(gs, (0, 0), 2.5))
    sg = small.astype(np.int32)
    dtree = ((small.max(axis=2) < 95) & (sg[..., 1] >= sg[..., 2]) & (2 * sg[..., 1] - sg[..., 2] - sg[..., 0] > 4)).astype(np.float32)
    dd = cv2.blur(dtree, (31, 31)); th = cv2.blur(hp0, (31, 31))
    vb = cv2.blur(small.max(axis=2).astype(np.float32), (31, 31))
    orch = ((dd > 0.04) & (dd < 0.4) & (th > 4.6) & (vb > 100)).astype(np.uint8)   # tree dots on open ground
    orch = cv2.morphologyEx(orch, cv2.MORPH_OPEN, np.ones((31, 31), np.uint8))
    orch = cv2.morphologyEx(orch, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    eb = cv2.GaussianBlur(edge, (0, 0), 6)
    edge = np.where(orch > 0, eb, edge)
    edge[excl_seg > 0] = 255 * 4
    e8 = np.clip(edge / 4, 0, 255).astype(np.uint8)

    interior = ((e8 < 30) & (excl_seg == 0)).astype(np.uint8)
    dt = cv2.distanceTransform(interior, cv2.DIST_L2, 3)
    peaks = ((dt >= cv2.dilate(dt, np.ones((13, 13), np.uint8))) & (dt >= 2.5)).astype(np.uint8)
    _, markers = cv2.connectedComponents(peaks)
    markers = markers.astype(np.int32)
    markers[excl_seg > 0] = markers.max() + 1          # one big "excluded" seed
    EX = markers.max()
    ws = cv2.watershed(cv2.cvtColor(e8, cv2.COLOR_GRAY2BGR), markers.copy())
    log('fields: seeds', EX - 1)

    # ---- region stats + merging
    lab0 = cv2.cvtColor(cv2.GaussianBlur(small, (3, 3), 0), cv2.COLOR_BGR2LAB).astype(np.float32)
    lbl = ws.copy(); lbl[lbl < 0] = 0; lbl[lbl == EX] = 0
    N = EX
    flat = lbl.ravel()
    cnt = np.bincount(flat, minlength=N).astype(np.float64)
    mean = np.stack([np.bincount(flat, lab0[..., k].ravel(), minlength=N) for k in range(3)], 1) / np.maximum(cnt, 1)[:, None]
    # adjacency across watershed lines (-1): take pixels 2 apart horizontally and vertically
    pairs, pe = [], []
    for sl_a, sl_b, sl_m in (((slice(None), slice(0, -2)), (slice(None), slice(2, None)), (slice(None), slice(1, -1))),
                             ((slice(0, -2), slice(None)), (slice(2, None), slice(None)), (slice(1, -1), slice(None)))):
        a, b, mid = lbl[sl_a], lbl[sl_b], edge[sl_m]
        m = (a != b) & (a > 0) & (b > 0)
        pairs.append(np.stack([a[m], b[m]], 1)); pe.append(mid[m])
    pairs = np.sort(np.concatenate(pairs), 1); pe = np.concatenate(pe)
    key = pairs[:, 0].astype(np.int64) * (N + 1) + pairs[:, 1]
    uk, inv, bcount = np.unique(key, return_inverse=True, return_counts=True)
    bstr = np.bincount(inv, pe) / bcount
    pairs = np.stack([uk // (N + 1), uk % (N + 1)], 1).astype(np.int64)
    log('fields: pairs', len(pairs), 'border edge pct', np.percentile(bstr, [10, 25, 50, 75, 90]).round(1))
    dsu = DSU(N)
    area = cnt.copy(); acc = mean * cnt[:, None]
    min_px = 250 / (m_px * m_px)            # < 250 m2 is not a field
    def mergeall(cond):
        changed = True
        while changed:
            changed = False
            dist = np.array([np.linalg.norm(acc[dsu.f(a)] / area[dsu.f(a)] - acc[dsu.f(b)] / area[dsu.f(b)]) for a, b in pairs])
            for i in np.argsort(dist):
                a, b = dsu.f(pairs[i][0]), dsu.f(pairs[i][1])
                if a == b: continue
                d = np.linalg.norm(acc[a] / area[a] - acc[b] / area[b])
                if cond(d, bstr[i], area[a], area[b], bcount[i]):
                    s_ = area[a] + area[b]; t_ = acc[a] + acc[b]
                    dsu.u(a, b); area[a] = s_; acc[a] = t_; changed = True
    # 1) same field split by texture: similar colour AND no bund between them
    mergeall(lambda d, e, A1, A2, bc: d < MERGE_D and e < BUND and bc > 12 and (A1 + A2) * m_px * m_px < 30000)
    # 2) slivers and specks go to the neighbour they share the weakest/longest border with
    mergeall(lambda d, e, A1, A2, bc: min(A1, A2) < min_px and d < 60)
    root = np.array([dsu.f(i) for i in range(N)])
    root[0] = 0
    reg = root[lbl]
    reg[excl_seg > 0] = 0

    # ---- per-region polygons + classification
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV).astype(np.int32)
    g = L.astype(np.float32)
    hp = np.abs(g - cv2.GaussianBlur(g, (0, 0), 2.5))       # fine texture
    B_, G_, R_ = [small[..., i].astype(np.int32) for i in range(3)]
    exg = 2 * G_ - R_ - B_
    dark_tree = ((small.max(axis=2) < 95) & (G_ >= R_) & (exg > 4)).astype(np.float32)
    # directional row energy: ratio of max/min oriented gradient energy at row scale
    gxs = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3); gys = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)


    def snap_poly(pts, th):
        """snap edge directions within 20 deg of the grid (th or th+90) and rebuild vertices by line intersection"""
        n = len(pts); lines = []
        for i in range(n):
            a_, b_ = pts[i], pts[(i + 1) % n]; d = b_ - a_; L_ = np.hypot(*d)
            if L_ < 1e-6: continue
            phi = math.atan2(d[1], d[0]); k = round((phi - th) / (math.pi / 2)); snapped = th + k * math.pi / 2
            if abs(phi - snapped) < math.radians(20): phi = snapped
            lines.append(((a_ + b_) / 2, phi))
        # drop consecutive edges that ended up parallel
        out = []
        for ln in lines:
            if out and abs(math.sin(ln[1] - out[-1][1])) < 0.05: out[-1] = (((out[-1][0] + ln[0]) / 2), out[-1][1]); continue
            out.append(ln)
        if len(out) > 2 and abs(math.sin(out[0][1] - out[-1][1])) < 0.05: out[0] = ((out[0][0] + out[-1][0]) / 2, out[0][1]); out.pop()
        if len(out) < 3: return None
        V = []
        for i in range(len(out)):
            (p1, a1), (p2, a2) = out[i - 1], out[i]
            d1 = np.array([math.cos(a1), math.sin(a1)]); d2 = np.array([math.cos(a2), math.sin(a2)])
            den = d1[0] * d2[1] - d1[1] * d2[0]
            if abs(den) < 1e-6: return None
            t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den
            V.append(p1 + d1 * t)
        return np.array(V, np.float32)

    CELL = 2.0                                          # grid cell in work px (~2.3 m), shared by all parcels of a tile
    def fit(c, th):
        """Rasterise the parcel on a grid aligned with the tile's field direction, so neighbouring parcels get
        straight, parallel, shared edges; use the whole rectangle when the parcel fills >= RECT_FILL of it."""
        A0 = cv2.contourArea(c)
        ca, sa = math.cos(th), math.sin(th)
        P = c.reshape(-1, 2).astype(np.float64)
        U = (P[:, 0] * ca + P[:, 1] * sa) / CELL; V = (-P[:, 0] * sa + P[:, 1] * ca) / CELL
        u0, v0 = math.floor(U.min()) - 1, math.floor(V.min()) - 1
        Wc, Hc = int(math.ceil(U.max())) - u0 + 2, int(math.ceil(V.max())) - v0 + 2
        SS = 4                                          # supersample, then majority per cell
        msk = np.zeros((Hc * SS, Wc * SS), np.uint8)
        cv2.fillPoly(msk, [np.stack([(U - u0) * SS, (V - v0) * SS], 1).astype(np.int32)], 1)
        cellm = (msk.reshape(Hc, SS, Wc, SS).mean((1, 3)) >= 0.5).astype(np.uint8)
        cellm = cv2.morphologyEx(cellm, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8)) if cellm.sum() > 40 else cellm
        if cellm.sum() < 3: return None, False
        n_, lab_, st_, _ = cv2.connectedComponentsWithStats(cellm, connectivity=4)
        k_ = 1 + int(np.argmax(st_[1:, 4])); cellm = (lab_ == k_).astype(np.uint8)
        x_, y_, ww_, hh_, ar_ = st_[k_]
        def back(q):                                    # cell coords -> work px
            uu, vv = (q[:, 0] + u0) * CELL, (q[:, 1] + v0) * CELL
            return np.stack([uu * ca - vv * sa, uu * sa + vv * ca], 1).astype(np.float32)
        if ar_ / float(ww_ * hh_) >= RECT_FILL:
            box = np.array([[x_, y_], [x_ + ww_, y_], [x_ + ww_, y_ + hh_], [x_, y_ + hh_]], np.float64)
            return [back(box)], True
        # otherwise cover the parcel with a few grid-aligned rectangles (greedy largest rectangle)
        rem = cellm.copy(); tot = rem.sum(); out = []
        while len(out) < 3 and rem.sum() > max(40, 0.25 * tot):
            r = largest_rect(rem)
            if r is None: break
            (rx, ry, rw, rh) = r
            if rw < 4 or rh < 4 or rw * rh < 45: break
            rem[ry:ry + rh, rx:rx + rw] = 0
            out.append(back(np.array([[rx, ry], [rx + rw, ry], [rx + rw, ry + rh], [rx, ry + rh]], np.float64)))
        return out or None, False

    def largest_rect(mk_):
        Hh, Ww = mk_.shape; hgt = np.zeros(Ww, np.int32); best = None; ba = 0
        for y in range(Hh):
            hgt = np.where(mk_[y] > 0, hgt + 1, 0); st = []
            for x in range(Ww + 1):
                cur = hgt[x] if x < Ww else 0; start = x
                while st and st[-1][1] >= cur:
                    sx, sh = st.pop(); a_ = sh * (x - sx)
                    if a_ > ba and min(sh, x - sx) >= 3: ba = a_; best = (sx, y - sh + 1, x - sx, sh)
                    start = sx
                st.append((start, cur))
        return best

    from scipy import ndimage
    objs = ndimage.find_objects(reg)
    fields, counts = [], [0] * len(NAMES)
    ov = small.copy(); fillov = []
    nrect = 0
    tile_cols = {}
    for rid0, sl in enumerate(objs):
        if sl is None: continue
        rid = rid0 + 1
        ys, xs = sl[0].start, sl[1].start
        m = (reg[sl] == rid).astype(np.uint8)
        if m.sum() * m_px * m_px < 250: continue
        cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        if not cs: continue
        c = max(cs, key=cv2.contourArea) + np.array([[xs, ys]])
        A = cv2.contourArea(c) * m_px * m_px
        if A < 250: continue
        cx_, cy_ = c.reshape(-1, 2).mean(0)
        ti, tj = min(th_ - 1, int(cy_) // T), min(tw - 1, int(cx_) // T)
        Pc = c.reshape(-1, 2).astype(np.float64); A_px = cv2.contourArea(c)
        def bbfill(a):
            ca, sa = math.cos(a), math.sin(a); U = Pc[:, 0] * ca + Pc[:, 1] * sa; V = -Pc[:, 0] * sa + Pc[:, 1] * ca
            return A_px / max(1e-6, (U.max() - U.min()) * (V.max() - V.min()))
        cands = [(bbfill(tang[ti, tj]) + 0.06, tang[ti, tj]), (bbfill(tang2[ti, tj]) + 0.04, tang2[ti, tj]),
                 (bbfill(math.radians(cv2.minAreaRect(c)[2])), math.radians(cv2.minAreaRect(c)[2]))]
        th = max(cands)[1]
        polys, isrect = fit(c, th)
        if not polys: continue
        nrect += isrect
        mk = m > 0
        cf = cl[sl][mk].mean()
        hh, ss, vv = [np.median(hsv[..., k][sl][mk]) for k in range(3)]
        bb, gg, rr = np.median(B_[sl][mk]), np.median(G_[sl][mk]), np.median(R_[sl][mk])
        eg = np.median(exg[sl][mk]); tex = hp[sl][mk].mean(); dt = dark_tree[sl][mk].mean()
        ex2, ey2 = (gxs[sl][mk] ** 2).mean(), (gys[sl][mk] ** 2).mean()
        exy = (gxs[sl][mk] * gys[sl][mk]).mean()
        tr = ex2 + ey2; det = ex2 * ey2 - exy * exy
        coh = math.sqrt(max(0, tr * tr / 4 - det)) / max(1e-6, tr / 2)   # 0 isotropic .. 1 oriented
        orf = orch[sl][mk].mean()
        if cf > 0.4: k = 8
        elif orf > 0.6 and A > 1500: k = 6
        elif gg - rr > 5:
            if vv < 80 and bb >= rr: k = 3
            elif tex > 4.5 or coh > 0.5: k = 4
            else: k = 2
        elif rr - gg > 30 and ss > 100: k = 1
        elif tex > 5 and dt > 0.05: k = 7
        elif vv > 140 and ss < 80: k = 5
        else: k = 0
        counts[k] += len(polys)
        for ap in polys:
            ap = ap.reshape(-1, 1, 2)
            pts = []
            for (px_, py_) in ap.reshape(-1, 2):
                x, z = px2w(px_ * F + F / 2, py_ * F + F / 2)
                pts.append([round(float(x), 1), round(float(z), 1)])
            med = np.median(small[sl][mk], 0)                 # BGR median of the real imagery
            fields.append({'p': pts, 'c': k, 'm': int(med[2]) << 16 | int(med[1]) << 8 | int(med[0])})
            tkey = (int(cy_) // T, int(cx_) // T); tile_cols.setdefault(tkey, []).append(fields[-1]['m'])
            if overlay_path is not None:
                colr = [(170, 200, 220), (40, 80, 220), (60, 230, 60), (200, 120, 20), (0, 200, 200),
                        (120, 220, 255), (0, 90, 0), (100, 160, 120), (255, 255, 255)][k]
                fillov.append((ap.astype(np.int32), colr))
    # ---- cloud strip: extend the local field grid (tile orientation) with plausible straight-edged parcels
    rs_ = np.random.RandomState(11); ncl = 0
    clm = (cl & (excl == 0)).astype(np.uint8)
    for ty in range(th_):
        for tx in range(tw):
            if clm[ty * T:(ty + 1) * T, tx * T:(tx + 1) * T].mean() < 0.02: continue
            th = tang[ty, tx]; ca, sa = math.cos(th), math.sin(th)
            ox, oy = (tx + 0.5) * T, (ty + 0.5) * T
            near = [v for (yy, xx), vs in tile_cols.items() if abs(yy - ty) <= 1 and abs(xx - tx) <= 1 for v in vs] or [0xA08868]
            v = -T * 0.75
            while v < T * 0.75:
                dv = rs_.uniform(28, 45) / m_px; u = -T * 0.75
                while u < T * 0.75:
                    du = rs_.uniform(40, 85) / m_px
                    box = np.array([[u, v], [u + du, v], [u + du, v + dv], [u, v + dv]])
                    P = np.stack([ox + box[:, 0] * ca - box[:, 1] * sa, oy + box[:, 0] * sa + box[:, 1] * ca], 1)
                    cxp, cyp = P.mean(0); u += du
                    if not (tx * T <= cxp < (tx + 1) * T and ty * T <= cyp < (ty + 1) * T): continue
                    samp = [P.mean(0)] + [P[i] * 0.5 + P.mean(0) * 0.5 for i in range(4)]
                    if sum(0 <= q[0] < w and 0 <= q[1] < h and clm[int(q[1]), int(q[0])] > 0 for q in samp) < 4: continue
                    if False and not all(0 <= q[0] < w and 0 <= q[1] < h and clm[int(q[1]), int(q[0])] for q in samp): continue
                    pts = [[round(float(c_), 1) for c_ in px2w(q[0] * F + F / 2, q[1] * F + F / 2)] for q in P]
                    fields.append({'p': pts, 'c': 8, 'm': int(near[rs_.randint(len(near))])}); counts[8] += 1; ncl += 1; nrect += 1
                    if overlay_path is not None: fillov.append((P.reshape(-1, 1, 2).astype(np.int32), (255, 255, 255)))
                v += dv
    log('fields: cloud-grid parcels', ncl, 'rectangle fits', nrect, 'of', len(fields), '(%.0f%%)' % (100.0 * nrect / max(1, len(fields))))
    if overlay_path is not None:
        lay = ov.copy()
        for pp, cc in fillov: cv2.fillPoly(lay, [pp], cc)
        ov = cv2.addWeighted(ov, 0.75, lay, 0.25, 0)
        for pp, cc in fillov: cv2.polylines(ov, [pp], True, (0, 255, 255), 1)
        ov[excl > 0] = (ov[excl > 0] * 0.5).astype(np.uint8)
        cv2.imwrite(overlay_path, ov, [cv2.IMWRITE_JPEG_QUALITY, 85])
    log('fields:', len(fields), dict(zip(NAMES, counts)))
    return fields, counts


if __name__ == '__main__':
    # fast iteration: python3 tools/fields.py <scratch dir>  (uses fields_inputs.npz written by build_map.py)
    import sys
    D = sys.argv[1]
    z = np.load(f'{D}/fields_inputs.npz', allow_pickle=True)
    Z, X0, Y0, LAT0, LON0 = 18, 188731, 117963, 17.70160, 79.19630
    MX = 111320.0 * math.cos(math.radians(LAT0)); MZ = 110574.0
    def px2w(px, py):
        n = 2 ** Z * 256
        lon = (X0 * 256 + px) / n * 360 - 180
        lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (Y0 * 256 + py) / n))))
        return (lon - LON0) * MX, -(lat - LAT0) * MZ
    mosaic = cv2.imread(f'{D}/mosaic18.jpg')
    extract(mosaic, z['cloud'], z['bld'], z['road'], list(z['river']), list(z['lakes']), px2w, float(z['mpp']), overlay_path=f'{D}/fields_overlay.jpg')
