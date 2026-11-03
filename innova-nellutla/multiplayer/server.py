"""Nellutla multiplayer relay.

Every client sends its state up to 12 times a second (skipped while parked); the server keeps the latest state per
player and broadcasts a time-stamped snapshot of everyone at 12 Hz. Clients interpolate ~100 ms in the past.

Messages (client -> server):
  hello {name}            state {s:{x,z,rot,spd,mode,kind}}       ping {c}  -> pong {c, st}
  chat {text, ch:'all'|'squad'}   quick {text, x, z}              horn
  squad {op:'create'|'join'|'leave', code}                        ping_place {x, z}   ping_clear
  event {kind:'crash', other}
Run:  python3 innova-nellutla/multiplayer/server.py            (listens on 0.0.0.0:8094)
"""
import asyncio, json, random, string, sys, time
import websockets

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8094
players = {}          # id -> {"ws", "state", "name", "color", "squad", "rtt", "chat": [timestamps]}
COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#f97316']
PING_TTL = 60.0
pings = {}            # owner id -> {"id","x","z","owner","name","color","squad","t"}


def now_ms():
    return time.time() * 1000.0


pending_leave = {}    # name -> asyncio task announcing "left" after a grace period
REJOIN_GRACE = 8.0


async def _safe_send(ws, data):
    # never let one slow / dead client stall the broadcast loop for everyone
    try:
        await asyncio.wait_for(ws.send(data), 2.0)
    except Exception:
        pass


async def send_to(pid, msg):
    p = players.get(pid)
    if p:
        try:
            await p["ws"].send(json.dumps(msg))
        except Exception:
            pass


async def send_all(msg, skip=None, squad=None):
    data = json.dumps(msg)
    targets = [p["ws"] for pid, p in list(players.items())
               if pid != skip and (squad is None or p["squad"] == squad)]
    if targets:
        await asyncio.gather(*(_safe_send(w, data) for w in targets))


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
    players[pid] = {"ws": ws, "state": None, "name": "Player", "color": color, "squad": None, "rtt": 0,
                    "chat": [], "named": False}
    try:
        await ws.send(json.dumps({"t": "welcome", "id": pid, "color": color, "st": now_ms()}))
        # existing pings visible to this player (public ones)
        for pg in pings.values():
            if not pg["squad"]:
                await ws.send(json.dumps({"t": "ping_place", **pg}))
        async for raw in ws:
            try:
                m = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(m, dict):
                continue
            p = players[pid]
            t = m.get("t")
            if t == "ping":
                p["rtt"] = int(m.get("rtt") or 0)
                await ws.send(json.dumps({"t": "pong", "c": m.get("c"), "st": now_ms()}))
            elif t == "hello":
                first = not p["named"]
                p["name"] = str(m.get("name", "Player")).strip()[:20] or "Player"
                p["named"] = True
                if first:
                    t = pending_leave.pop(p["name"], None)
                    twin = any(o is not p and o.get("named") and o["name"] == p["name"] for o in players.values())
                    if t or twin:   # same player came back within the grace period (or is already here): no join/leave spam
                        if t:
                            t.cancel()
                    else:
                        await send_all(system(f'{p["name"]} joined Nellutla', "join"))
            elif t == "state":
                s = m.get("s") or {}
                st = {}
                for k in ("x", "z", "rot", "spd"):
                    try:
                        st[k] = float(s.get(k, 0))
                    except (TypeError, ValueError):
                        st[k] = 0.0
                for k in ("mode", "kind"):
                    st[k] = str(s.get(k, ""))[:12]
                p["state"] = st
            elif t in ("chat", "quick"):
                tnow = time.time()
                p["chat"] = [x for x in p["chat"] if tnow - x < 5.0]
                if len(p["chat"]) >= 5:
                    await ws.send(json.dumps(system("Slow down! Max 5 messages per 5 seconds.", "warn")))
                    continue
                p["chat"].append(tnow)
                text = str(m.get("text", "")).strip()[:160]
                if not text:
                    continue
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
                await send_all({"t": "horn", "from": pid}, skip=pid)
            elif t == "squad":
                op = m.get("op")
                if op == "create":
                    await leave_squad(pid)
                    code = ''.join(random.choice(string.ascii_uppercase + string.digits) for _ in range(4))
                    p["squad"] = code
                    await ws.send(json.dumps(system(f"Squad {code} created. Friends join with /squad join {code}", "squad")))
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
                        await ws.send(json.dumps(system(f"No squad called {code}", "warn")))
                        continue
                    if len(squad_members(code)) >= 8:
                        await ws.send(json.dumps(system(f"Squad {code} is full", "warn")))
                        continue
                    await leave_squad(pid)
                    p["squad"] = code
                    await send_all(system(f'{p["name"]} joined squad {code}', "squad"), squad=code)
                    await squad_update(code)
                    for pg in list(pings.values()):          # catch the newcomer up on the squad's live pings
                        if pg["squad"] == code:
                            await ws.send(json.dumps({"t": "ping_place", **pg}))
                elif op == "leave":
                    await leave_squad(pid)
            elif t == "ping_place":
                try:
                    x, z = float(m["x"]), float(m["z"])
                except (KeyError, TypeError, ValueError):
                    continue
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
    except websockets.ConnectionClosed:
        pass
    finally:
        p = players.get(pid)
        if p and p["squad"]:
            try:
                await leave_squad(pid, quiet=True)
            except Exception:
                pass
        p = players.pop(pid, {})
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


async def ticker():
    while True:
        await asyncio.sleep(1 / 12)
        tnow = now_ms()
        for owner, pg in list(pings.items()):
            if tnow - pg["at"] > PING_TTL * 1000:
                pings.pop(owner, None)
        snap = {pid: {**p["state"], "name": p["name"], "color": p["color"], "squad": p["squad"], "rtt": p["rtt"]}
                for pid, p in players.items() if p["state"]}
        if snap:
            await send_all({"t": "snap", "players": snap, "st": tnow})


async def main():
    async with websockets.serve(handler, "0.0.0.0", PORT, max_size=2 ** 16,
                                ping_interval=20, ping_timeout=60):
        print(f"Nellutla multiplayer server on ws://0.0.0.0:{PORT}", flush=True)
        await ticker()


if __name__ == "__main__":
    asyncio.run(main())
