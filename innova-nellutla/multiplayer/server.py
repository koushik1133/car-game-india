"""Nellutla multiplayer relay. Client-authoritative movement, with server sanity checks; the server owns seats,
vehicle claims, shared world flags and the clock.

Wire (client -> server):
  hello {name,tab}     s {a:[ct,x,y,z,rot,spd,steer,lean,flags]}     m {m:{mode,kind,cap,paint,doors,wf}}     ping {c,rtt}
  r {y,d,to,range,self}  generic relay        chat/quick/horn/squad/ping_place/ping_clear/event     time_set {h}
  seat_req {driver,seat} seat_switch {seat} seat_leave        claim {k}  park {k,kind,x,z,rot,paint,lock}  knock {k,dx,dz}
Server -> client:
  welcome, roster {players,wv,gone,knocked,wf,h,st} (late join), m {id,m}, S {st,p:{id:a}} at up to 20 Hz, leave,
  w {op:'take'|'park'|'del'|'knock',...}, claim_ok/claim_no, wf {v}, time {h,st}, seat_ok/seat_no/seat_end, r, chat, sys...
Area of interest: every state within 250 m, or to your squad / shared vehicle; 4 Hz to 700 m; 1 Hz beyond. Unchanged players
are omitted. A player's outbound queue is bounded: a slow client loses snapshots, never stalls the others.
Run:  python3 innova-nellutla/multiplayer/server.py [port]            (default 0.0.0.0:8094)
"""
import asyncio, json, random, re, string, sys, time
import websockets

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8094
players = {}          # id -> {"ws", "state", "name", "color", "squad", "rtt", "chat": [timestamps]}
COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#f97316']
MAX_PLAYERS = 64
PING_TTL = 60.0
pings = {}            # owner id -> {"id","x","z","owner","name","color","squad","t"}


def now_ms():
    return time.time() * 1000.0


pending_leave = {}    # name -> asyncio task announcing "left" after a grace period
REJOIN_GRACE = 8.0


def enqueue(p, data, droppable=False):
    q = p["q"]
    if q.qsize() >= (32 if droppable else 256):
        if not droppable:
            asyncio.ensure_future(p["ws"].close(1013, "too slow"))
        return
    q.put_nowait(data)
    stats["out"] += len(data)


async def writer(p):
    try:
        while True:
            await asyncio.wait_for(p["ws"].send(await p["q"].get()), 5.0)
    except asyncio.CancelledError:
        raise
    except Exception:
        try:
            await p["ws"].close(1011, "send failed")
        except Exception:
            pass


async def send_to(pid, msg):
    p = players.get(pid)
    if p:
        enqueue(p, json.dumps(msg))


async def send_all(msg, skip=None, squad=None):
    data = json.dumps(msg)
    for pid, p in list(players.items()):
        if pid != skip and (squad is None or p["squad"] == squad):
            enqueue(p, data)


SEAT_RANGE = 9.0      # metres between the two players' origins; the client asks from next to the vehicle
DRIVING = ("crysta", "vehicle")


def riders_of(did):
    return {p["ride"][1]: pid for pid, p in players.items() if p.get("ride") and p["ride"][0] == did}


async def release_riders(did, reason):
    for pid in riders_of(did).values():
        players[pid]["ride"] = None
        await send_to(pid, {"t": "seat_end", "reason": reason})


def seat_refusal(pid, did):
    """The server owns the seats: returns why this player can't board, or None."""
    p, d = players[pid], players.get(did)
    if did == pid or not d or not d["state"]:
        return "That player is gone"
    if p.get("ride"):
        return "Already riding"
    me, st = p["state"], d["state"]
    if not me or not p["meta"] or p["meta"]["mode"] != "foot":
        return "Get out of your vehicle first"
    if not d["meta"] or d["meta"]["mode"] not in DRIVING or d.get("ride"):
        return "Nobody is driving that"
    if ((me["x"] - st["x"]) ** 2 + (me["z"] - st["z"]) ** 2) ** 0.5 > SEAT_RANGE:
        return "Too far away"
    if len(riders_of(did)) >= d["meta"]["cap"]:
        return "No free seat"
    return None


# ---------------------------------------------------- generic relay: lets features add message types without server code
RELAY_TYPE = re.compile(r"^[A-Za-z0-9_:.-]{1,32}$")
RELAY_MAX_BYTES = 8192      # one message
RELAY_RATE = 40.0           # messages / s per client (token bucket, burst 80)
RELAY_BYTES = 96000.0       # bytes / s per client (burst twice that)
NEAR_DEFAULT, NEAR_MAX = 120.0, 2000.0


def relay_allowed(p, size):
    t = time.time()
    last = p.get("r_t", t)
    p["r_t"] = t
    p["r_n"] = min(80.0, p.get("r_n", 80.0) + (t - last) * RELAY_RATE)
    p["r_b"] = min(RELAY_BYTES * 2, p.get("r_b", RELAY_BYTES * 2) + (t - last) * RELAY_BYTES)
    if p["r_n"] < 1 or p["r_b"] < size:
        return False
    p["r_n"] -= 1
    p["r_b"] -= size
    return True


def relay_targets(pid, p, to, rng):
    """Ids a relayed message goes to."""
    if to == "squad":
        return [i for i, o in players.items() if p["squad"] and o["squad"] == p["squad"]]
    if to == "near":
        me = p["state"]
        if not me:
            return []
        try:
            r = max(1.0, min(NEAR_MAX, float(rng)))
        except (TypeError, ValueError):
            r = NEAR_DEFAULT
        return [i for i, o in players.items() if o["state"]
                and (o["state"]["x"] - me["x"]) ** 2 + (o["state"]["z"] - me["z"]) ** 2 <= r * r]
    if to == "all":
        return list(players)
    return [to] if to in players else []


async def relay(pid, p, m, raw):
    y = m.get("y")
    if not isinstance(y, str) or not RELAY_TYPE.match(y) or len(raw) > RELAY_MAX_BYTES:
        return
    if not relay_allowed(p, len(raw)):
        return
    to = m.get("to", "all")
    if not isinstance(to, str):
        return
    data = json.dumps({"t": "r", "y": y, "d": m.get("d"), "from": pid, "name": p["name"], "color": p["color"],
                       "st": now_ms()})
    for i in relay_targets(pid, p, to, m.get("range", NEAR_DEFAULT)):
        if i in players and (i != pid or m.get("self")):
            enqueue(players[i], data)


# ---------------------------------------------------- state validation
LIMIT = 30000.0       # metres from the origin
MAX_SPEED = 170.0     # m/s between two states; anything faster is a teleport
KIND = re.compile(r"^[A-Za-z0-9_]{1,20}$")
MODES = ("crysta", "vehicle", "foot", "passenger")


def num(v, lo, hi):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or v in (float("inf"), float("-inf")):
        return None
    return max(lo, min(hi, v))


def clean_state(a, tnow):
    """[ct,x,y,z,rot,spd,steer,lean,flags] with every field range-checked, else None."""
    if not isinstance(a, list) or len(a) != 9:
        return None
    lim = ((0, 1e15), (-LIMIT, LIMIT), (-50, 500), (-LIMIT, LIMIT), (-1000, 1000), (-700, 700), (-2, 2), (-2, 2), (0, 65535))
    out = []
    for v, (lo, hi) in zip(a, lim):
        v = num(v, lo, hi)
        if v is None:
            return None
        out.append(v)
    # the sender's clock estimate may only be a little off ours
    if abs(out[0] - tnow) > 1500:
        out[0] = tnow
    out[8] = int(out[8])
    return [out[0], round(out[1], 2), round(out[2], 2), round(out[3], 2), round(out[4], 3), round(out[5], 1),
            round(out[6], 2), round(out[7], 2), out[8]]


def clean_meta(m, old):
    if not isinstance(m, dict):
        return None
    mode, kind = m.get("mode"), m.get("kind")
    if mode not in MODES or not isinstance(kind, str) or not KIND.match(kind):
        return None
    out = {"mode": mode, "kind": kind}
    for k, hi in (("cap", 60), ("paint", 0xffffff), ("doors", 255), ("wf", 7)):
        out[k] = int(num(m.get(k, 0), 0, hi) or 0)
    return out


def meta_of(pid, p):
    return {**(p["meta"] or {}), "name": p["name"], "color": p["color"], "squad": p["squad"], "ride": p.get("ride")}


# ---------------------------------------------------- shared world: who holds which vehicle, what has changed
claims = {}     # key -> player id driving it
wv = {}         # key -> where a player left a vehicle {k,kind,x,z,rot,paint,lock,owner}
gone = set()    # original world keys (parked.js items, prop bikes) no longer standing where the map put them
knocked = {}    # key -> [dx, dz]
wf_or = 0
DAY_S = 960.0
clock = {"h": 9.0, "at": time.time(), "set": 0.0}
MAX_RECORDS = 512
KEY = re.compile(r"^[A-Za-z0-9_:.@,-]{1,48}$")


def hour_now():
    return (clock["h"] + (time.time() - clock["at"]) * 24.0 / DAY_S) % 24.0


async def claim(pid, p, k):
    if not isinstance(k, str) or not KEY.match(k):
        return
    if claims.get(k, pid) != pid:
        return enqueue(p, json.dumps({"t": "claim_no", "k": k, "reason": "Someone else is driving that"}))
    rec = wv.get(k)
    if rec and rec.get("lock") and rec.get("owner") != p.get("tab"):
        return enqueue(p, json.dumps({"t": "claim_no", "k": k, "reason": "That is another player's car"}))
    if len(gone) >= MAX_RECORDS and k not in gone:
        return enqueue(p, json.dumps({"t": "claim_no", "k": k, "reason": "Too many moved vehicles"}))
    claims[k] = pid
    wv.pop(k, None)
    gone.add(k)
    enqueue(p, json.dumps({"t": "claim_ok", "k": k}))
    await send_all({"t": "w", "op": "take", "k": k, "by": pid}, skip=pid)


async def park(pid, p, m):
    k = m.get("k")
    if not isinstance(k, str) or not KEY.match(k) or not isinstance(m.get("kind"), str) or not KIND.match(m["kind"]):
        return
    x, z, rot = num(m.get("x"), -LIMIT, LIMIT), num(m.get("z"), -LIMIT, LIMIT), num(m.get("rot"), -1000, 1000)
    if None in (x, z, rot):
        return
    lock = bool(m.get("lock"))
    if claims.get(k) != pid and not (lock and k == "crysta:" + str(p.get("tab"))):
        return
    if k not in wv and len(wv) >= MAX_RECORDS:
        return
    claims.pop(k, None)
    rec = {"k": k, "kind": m["kind"], "x": x, "z": z, "rot": rot, "paint": int(num(m.get("paint", 0), 0, 0xffffff) or 0),
           "lock": lock, "owner": p.get("tab") if lock else None}
    wv[k] = rec
    await send_all({"t": "w", "op": "park", "rec": rec}, skip=pid)


async def drop_claims(pid, p):
    """A driver vanished: what they drove stays where it stopped, free for anyone. Their own locked Crysta leaves."""
    st = p.get("state")
    for k in [k for k, o in claims.items() if o == pid]:
        del claims[k]
        if st and len(wv) < MAX_RECORDS and p.get("meta"):
            rec = {"k": k, "kind": p["meta"]["kind"], "x": st["x"], "z": st["z"], "rot": st["rot"],
                   "paint": p["meta"].get("paint", 0), "lock": False, "owner": None}
            wv[k] = rec
            await send_all({"t": "w", "op": "park", "rec": rec})
    k = "crysta:" + str(p.get("tab"))
    if wv.pop(k, None):
        await send_all({"t": "w", "op": "del", "k": k})


def system(text, kind="info"):
    return {"t": "sys", "text": text, "kind": kind, "st": now_ms()}


def squad_members(code):
    return [pid for pid, p in players.items() if p["squad"] == code]


async def squad_update(code):
    if not code:
        return
    members = squad_members(code)
    await send_all({"t": "squad", "code": code, "members": members}, squad=code)


async def leave_squad(pid, quiet=False):
    p = players[pid]
    code = p["squad"]
    if not code:
        return
    p["squad"] = None
    if not quiet:
        await send_to(pid, {"t": "squad", "code": None, "members": []})
    if not quiet:
        await send_all(system(f'{p["name"]} left squad {code}', "squad"), squad=code)
    await squad_update(code)


async def handler(ws):
    pid = '%06x' % random.randrange(1 << 24)
    used = {p["color"] for p in players.values()}
    color = next((c for c in COLORS if c not in used), random.choice(COLORS))
    if len(players) >= MAX_PLAYERS:
        await ws.close(1013, "server full")
        return
    me = players[pid] = {"ws": ws, "q": asyncio.Queue(), "state": None, "meta": None, "name": "Player", "color": color,
                         "squad": None, "rtt": 0, "chat": [], "named": False, "seq": 0, "sent": {}, "last_meta": "",
                         "tok": 200.0, "tok_t": time.time(), "bad": 0}
    me["wtask"] = asyncio.create_task(writer(me))
    try:
        enqueue(me, json.dumps({"t": "welcome", "id": pid, "color": color, "st": now_ms()}))
        enqueue(me, json.dumps({"t": "roster", "st": now_ms(), "h": hour_now(), "wf": wf_or, "wv": list(wv.values()),
                                "gone": sorted(gone), "knocked": knocked,
                                "players": {i: {"m": meta_of(i, o), "a": o.get("a")} for i, o in players.items()
                                            if i != pid and o["meta"]}}))
        # existing pings visible to this player (public ones)
        for pg in pings.values():
            if not pg["squad"]:
                enqueue(me, json.dumps({"t": "ping_place", **pg}))
        async for raw in ws:
            p = players[pid]
            tn = time.time()
            p["tok"] = min(400.0, p["tok"] + (tn - p["tok_t"]) * 200.0)
            p["tok_t"] = tn
            if p["tok"] < 1:
                p["bad"] += 1
                if p["bad"] > 5000:
                    await ws.close(1008, "flood")
                    break
                continue
            p["tok"] -= 1
            stats["in"] += len(raw)
            try:
                m = json.loads(raw)
            except (ValueError, TypeError):
                continue
            if not isinstance(m, dict):
                continue
            try:
                await on_message(ws, pid, p, m, raw)
            except websockets.ConnectionClosed:
                raise
            except Exception as e:      # one bad message must never take a player (or the server) down
                print("bad message", repr(e)[:200], str(m)[:200], flush=True)
    except websockets.ConnectionClosed:
        pass
    finally:
        await disconnected(pid)


async def on_message(ws, pid, p, m, raw):
    if True:
        if True:
            t = m.get("t")
            if t == "r":
                await relay(pid, p, m, raw)
            elif t == "ping":
                p["rtt"] = int(num(m.get("rtt"), 0, 99999) or 0)
                enqueue(p, json.dumps({"t": "pong", "c": m.get("c"), "st": now_ms()}))
            elif t == "hello":
                first = not p["named"]
                want = str(m.get("name", "Player")).strip()[:20] or "Player"
                p["tab"] = str(m.get("tab", ""))[:16]
                # unique names: a name held by another player (not this tab's own stale socket) gets a suffix
                def taken(n):
                    return any(o is not p and o.get("named") and o["name"].lower() == n.lower()
                               and not (p["tab"] and o.get("tab") == p["tab"]) for o in players.values())
                name, k = want, 2
                while taken(name):
                    name = f"{want[:17]}-{k}"; k += 1
                p["name"] = name
                p["named"] = True
                enqueue(p, json.dumps({"t": "name", "name": name, "asked": want}))
                if first:
                    t = pending_leave.pop(p["name"], None)
                    twin = any(o is not p and o.get("named") and o["name"] == p["name"] for o in players.values())
                    if t or twin:   # same player came back within the grace period (or is already here): no join/leave spam
                        if t:
                            t.cancel()
                    else:
                        await send_all(system(f'{p["name"]} joined Nellutla', "join"))
            elif t == "s":
                tn = time.time()
                if tn - p.get("s_t", 0) < 0.012:
                    return
                a = clean_state(m.get("a"), now_ms())
                if not a:
                    return
                st = p["state"]
                if st:
                    dt = max(0.001, tn - p["s_t"])
                    if ((a[1] - st["x"]) ** 2 + (a[3] - st["z"]) ** 2) ** 0.5 / dt > MAX_SPEED and dt < 2:
                        if tn - p.get("tele", 0) < 2:      # one teleport (respawn, fast travel) is normal; a stream is not
                            stats["rejected"] += 1
                            return
                        p["tele"] = tn
                p["s_t"] = tn
                p["state"] = {"x": a[1], "z": a[3], "rot": a[4]}
                p["a"] = a
                p["seq"] += 1
                p["frag"] = '"%s":%s' % (pid, json.dumps(a, separators=(",", ":")))
            elif t == "m":
                old = p["meta"]
                nm = clean_meta(m.get("m"), old)
                if not nm:
                    return
                p["meta"] = nm
                # the driver got out or swapped vehicle: everyone in that vehicle is out too
                if old and riders_of(pid) and (nm["mode"] not in DRIVING or nm["kind"] != old["kind"]):
                    await release_riders(pid, "The driver left the vehicle")
            elif t == "time_set":
                h, tn = num(m.get("h"), 0, 24), time.time()
                if h is not None and tn - clock["set"] > 0.1:
                    clock.update(h=h, at=tn, set=tn)
                    await send_all({"t": "time", "h": h, "st": now_ms()}, skip=pid)
            elif t == "claim":
                await claim(pid, p, m.get("k"))
            elif t == "park":
                await park(pid, p, m)
            elif t == "knock":
                k, dx, dz = m.get("k"), num(m.get("dx"), -2, 2), num(m.get("dz"), -2, 2)
                if isinstance(k, str) and KEY.match(k) and dx is not None and dz is not None and k not in knocked \
                        and len(knocked) < MAX_RECORDS:
                    knocked[k] = [dx, dz]
                    await send_all({"t": "w", "op": "knock", "k": k, "dx": dx, "dz": dz}, skip=pid)
            elif t == "seat_switch":
                ride = p.get("ride")
                if not ride or ride[0] not in players or not players[ride[0]]["meta"]:
                    return
                cap, used = players[ride[0]]["meta"]["cap"], riders_of(ride[0])
                want = m.get("seat")
                if isinstance(want, int) and not isinstance(want, bool):
                    seat = want if 0 <= want < cap and want not in used else None
                else:      # next free seat, wrapping round
                    seat = next(((ride[1] + i) % cap for i in range(1, cap) if (ride[1] + i) % cap not in used), None)
                if seat is None:
                    enqueue(p, json.dumps({"t": "seat_no", "reason": "No free seat"}))
                    return
                p["ride"] = [ride[0], seat]
                enqueue(p, json.dumps({"t": "seat_ok", "driver": ride[0], "seat": seat, "switch": 1}))
            elif t == "seat_req":
                did = str(m.get("driver", ""))
                why = seat_refusal(pid, did)
                if why:
                    enqueue(p, json.dumps({"t": "seat_no", "reason": why}))
                    return
                taken = riders_of(did)
                want = m.get("seat")
                cap = players[did]["meta"]["cap"]
                seat = want if isinstance(want, int) and not isinstance(want, bool) and 0 <= want < cap and want not in taken \
                    else next(i for i in range(cap) if i not in taken)
                p["ride"] = [did, seat]
                enqueue(p, json.dumps({"t": "seat_ok", "driver": did, "seat": seat}))
                await send_to(did, system(f'{p["name"]} got in with you', "info"))
            elif t == "seat_leave":
                p["ride"] = None
            elif t in ("chat", "quick"):
                tnow = time.time()
                p["chat"] = [x for x in p["chat"] if tnow - x < 5.0]
                if len(p["chat"]) >= 5:
                    enqueue(p, json.dumps(system("Slow down! Max 5 messages per 5 seconds.", "warn")))
                    return
                p["chat"].append(tnow)
                text = str(m.get("text", "")).strip()[:160]
                if not text:
                    return
                ch = "squad" if m.get("ch") == "squad" and p["squad"] else "all"
                out = {"t": "chat", "from": pid, "name": p["name"], "color": p["color"], "text": text, "ch": ch,
                       "st": now_ms()}
                if t == "quick":
                    out["quick"] = True
                    try:
                        out["x"], out["z"] = float(m.get("x")), float(m.get("z"))
                    except (TypeError, ValueError):
                        pass
                await send_all(out, squad=p["squad"] if ch == "squad" else None)
            elif t == "horn":
                data = json.dumps({"t": "horn", "from": pid})
                for i in relay_targets(pid, p, "near", 250):
                    if i != pid:
                        enqueue(players[i], data)
            elif t == "squad":
                op = m.get("op")
                if op == "create":
                    await leave_squad(pid)
                    code = ''.join(random.choice(string.ascii_uppercase + string.digits) for _ in range(4))
                    p["squad"] = code
                    enqueue(p, json.dumps(system(f"Squad {code} created. Friends join with /squad join {code}", "squad")))
                    await squad_update(code)
                elif op == "rejoin":                          # silent re-entry after a reconnect
                    code = str(m.get("code", "")).upper().strip()[:8]
                    if code and len(squad_members(code)) < 8:
                        await leave_squad(pid, quiet=True)
                        p["squad"] = code
                        await squad_update(code)
                elif op == "join":
                    code = str(m.get("code", "")).upper().strip()[:8]
                    if not squad_members(code):
                        enqueue(p, json.dumps(system(f"No squad called {code}", "warn")))
                        return
                    if len(squad_members(code)) >= 8:
                        enqueue(p, json.dumps(system(f"Squad {code} is full", "warn")))
                        return
                    await leave_squad(pid)
                    p["squad"] = code
                    await send_all(system(f'{p["name"]} joined squad {code}', "squad"), squad=code)
                    await squad_update(code)
                    for pg in list(pings.values()):          # catch the newcomer up on the squad's live pings
                        if pg["squad"] == code:
                            enqueue(p, json.dumps({"t": "ping_place", **pg}))
                elif op == "leave":
                    await leave_squad(pid)
            elif t == "ping_place":
                try:
                    x, z = float(m["x"]), float(m["z"])
                except (KeyError, TypeError, ValueError):
                    return
                pg = {"id": pid + "-" + str(int(time.time() * 1000)), "x": x, "z": z, "owner": pid,
                      "name": p["name"], "color": p["color"], "squad": p["squad"], "at": now_ms(),
                      "ttl": PING_TTL * 1000}
                pings[pid] = pg
                await send_all({"t": "ping_place", **pg}, squad=p["squad"])
            elif t == "ping_clear":
                pg = pings.pop(pid, None)
                if pg:
                    await send_all({"t": "ping_clear", "owner": pid}, squad=pg["squad"])
            elif t == "event" and m.get("kind") == "crash":
                o = players.get(str(m.get("other")))
                if o:
                    await send_all(system(f'{p["name"]} crashed into {o["name"]}', "kill"))

async def disconnected(pid):
    if True:
        p = players.get(pid)
        if p and p["squad"]:
            try:
                await leave_squad(pid, quiet=True)
            except Exception:
                pass
        p = players.pop(pid, {})
        if p.get("wtask"):
            p["wtask"].cancel()
        for o in players.values():
            o["sent"].pop(pid, None)
        await drop_claims(pid, p)
        await release_riders(pid, "The driver disconnected")
        pg = pings.pop(pid, None)
        await send_all({"t": "leave", "id": pid})
        if pg:
            await send_all({"t": "ping_clear", "owner": pid})
        if p.get("named"):
            name = p.get("name", "Player")
            async def announce(n=name):
                await asyncio.sleep(REJOIN_GRACE)
                pending_leave.pop(n, None)
                if not any(o.get("name") == n for o in players.values()):
                    await send_all(system(f'{n} left', "leave"))
            old = pending_leave.pop(name, None)
            if old:
                old.cancel()
            pending_leave[name] = asyncio.create_task(announce())


TICK = 0.05       # 20 Hz: clients send 15 Hz, so no state waits long or is lost between ticks
NEAR, MID = 250.0 ** 2, 700.0 ** 2
stats = {"in": 0, "out": 0, "rejected": 0}


def linked(a, b, pa, pb):
    if pa["squad"] and pa["squad"] == pb["squad"]:
        return True
    ra, rb = pa.get("ride"), pb.get("ride")
    return bool((ra and ra[0] == b) or (rb and rb[0] == a) or (ra and rb and ra[0] == rb[0]))


async def ticker():
    global wf_or
    tick = 0
    while True:
        t0 = time.time()
        tick += 1
        tnow = now_ms()
        for owner, pg in list(pings.items()):
            if tnow - pg["at"] > PING_TTL * 1000:
                pings.pop(owner, None)
        wf = 0
        for pid, p in list(players.items()):
            if p["meta"]:
                wf |= p["meta"].get("wf", 0)
                data = json.dumps(meta_of(pid, p), sort_keys=True)
                if data != p["last_meta"]:
                    p["last_meta"] = data
                    await send_all({"t": "m", "id": pid, "m": json.loads(data)}, skip=pid)
        if wf != wf_or:
            wf_or = wf
            await send_all({"t": "wf", "v": wf})
        if tick % 40 == 0:
            await send_all({"t": "rtts", "r": {i: p["rtt"] for i, p in players.items()}})
        if tick % 200 == 0:                  # a slow drift correction for clients whose tab was throttled
            await send_all({"t": "time", "h": hour_now(), "st": tnow})
        senders = [(i, p) for i, p in players.items() if p.get("frag") and p["state"]]
        head = '{"t":"S","st":%d,"p":{' % tnow
        for rid, r in players.items():
            rs, sent, frags = r["state"], r["sent"], []
            for sid, s in senders:
                if sid == rid:
                    continue
                e = sent.get(sid)
                if e and e[0] == s["seq"]:
                    continue
                gap = 1
                if rs and not linked(rid, sid, r, s):
                    d2 = (rs["x"] - s["state"]["x"]) ** 2 + (rs["z"] - s["state"]["z"]) ** 2
                    gap = 1 if d2 < NEAR else 5 if d2 < MID else 20
                if e and tick - e[1] < gap:
                    continue
                sent[sid] = (s["seq"], tick)
                frags.append(s["frag"])
            if frags:
                enqueue(r, head + ",".join(frags) + "}}", droppable=True)
        await asyncio.sleep(max(0.0, TICK - (time.time() - t0)))


async def main():
    async with websockets.serve(handler, "0.0.0.0", PORT, max_size=2 ** 16,
                                ping_interval=20, ping_timeout=60):
        print(f"Nellutla multiplayer server on ws://0.0.0.0:{PORT}", flush=True)
        await ticker()


if __name__ == "__main__":
    asyncio.run(main())
