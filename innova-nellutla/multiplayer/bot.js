// Bots for the Nellutla multiplayer server (Node 22, global WebSocket). Test tool: never point it at a live game's port by habit.
//   node multiplayer/bot.js [--port 8197] [--n 16] [--secs 30] [--kind auto] [--cx 300 --cz 400] [--r 60] [--loss 0] [--fuzz] [--drive]
// Each bot drives a circle at 15 Hz with the real wire format, keeps a server-clock estimate and reports RTT, snapshot rate and
// bandwidth. Bots share one analytic path: x = cx + sin(w t) r, z = cz + cos(w t) r, t = server ms / 1000, so a page can
// measure its interpolation error against the truth. --loss drops that fraction of sends. --fuzz sends garbage.
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : (process.argv[i + 1] === undefined || process.argv[i + 1].startsWith('--') ? true : process.argv[i + 1]); };
const PORT = +arg('port', 8197), N = +arg('n', 1), SECS = +arg('secs', 30), KIND = arg('kind', 'auto'), CX = +arg('cx', 300), CZ = +arg('cz', 400), R = +arg('r', 60), LOSS = +arg('loss', 0), SPREAD = +arg('spread', 0), W = 15 / R;
const bots = [], rtts = []; let snaps = 0, bytes = 0, seen = new Set();
function bot(i) {
  const ws = new WebSocket('ws://127.0.0.1:' + PORT); let off = 0, best = 1e9, closed = false;
  const J = o => ws.readyState === 1 && ws.send(JSON.stringify(o));
  ws.onopen = () => {
    J({ t: 'hello', name: 'Bot' + i, tab: 'bot' + i });
    J({ t: 'm', m: { mode: 'vehicle', kind: KIND, cap: 3, paint: 0xcc2222, doors: 0, wf: 0 } });
    setInterval(() => {
      const st = Date.now() + off, t = st / 1000, a = W * t + i * 0.4, cx = CX + i * SPREAD, x = cx + Math.sin(a) * R, z = CZ + Math.cos(a) * R;
      if (Math.random() >= LOSS) J({ t: 's', a: [Math.round(st), +x.toFixed(2), 0, +z.toFixed(2), +(a + Math.PI / 2).toFixed(3), 54, 0.1, 0, 2] });
    }, 1000 / 15);
    setInterval(() => J({ t: 'ping', c: Date.now() }), 1000);
    if (arg('fuzz', false)) setInterval(() => fuzz(ws, J), 50);
  };
  ws.onmessage = e => {
    bytes += e.data.length; const m = JSON.parse(e.data);
    if (m.t === 'pong') { const r = Date.now() - m.c; rtts.push(r); if (r <= best) { best = r; off = m.st - (m.c + r / 2); } }
    else if (m.t === 'S') { snaps++; for (const k in m.p) seen.add(k); }
    else if (m.t === 'welcome') off = m.st - Date.now();
  };
  ws.onclose = () => { closed = true; }; bots.push(ws);
}
function fuzz(ws, J) {
  const junk = [null, 1e308, -1, NaN, 'x'.repeat(300), [], {}, [[]], true, { a: 1 }], q = () => junk[Math.random() * junk.length | 0];
  for (const t of ['s', 'm', 'r', 'hello', 'chat', 'squad', 'seat_req', 'seat_switch', 'claim', 'park', 'knock', 'time_set', 'ping', 'ping_place', 'quick', 'event', 'nonsense'])
    J({ t, a: q(), m: q(), y: q(), d: q(), to: q(), k: q(), x: q(), z: q(), h: q(), name: q(), text: q(), op: q(), code: q(), driver: q(), seat: q(), kind: q(), rot: q(), c: q(), rtt: q(), range: q() });
  ws.send('not json'); ws.send('[1,2'); ws.send('[]'); ws.send(new Uint8Array([1, 2, 3]));
}
for (let i = 0; i < N; i++) setTimeout(() => bot(i), i * 20);
setTimeout(() => {
  rtts.sort((a, b) => a - b);
  console.log(JSON.stringify({ bots: N, open: bots.filter(w => w.readyState === 1).length, playersSeen: seen.size, rttP50: rtts[rtts.length >> 1], rttP99: rtts[rtts.length * 0.99 | 0], snapsPerBotPerS: +(snaps / N / SECS).toFixed(1), kBpsPerBot: +(bytes / N / SECS / 1024).toFixed(1) }));
  process.exit(0);
}, SECS * 1000);
