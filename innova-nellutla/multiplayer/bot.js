// Test bot for the Nellutla multiplayer server (Node 22, global WebSocket).
//   node innova-nellutla/multiplayer/bot.js [squadCode] [seconds]
// Joins as "RaviBot", drives a 60 m circle at 12 Hz, chats, creates or joins a squad, places a ping.
const code = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null, secs = +(process.argv[3] || 60);
const ws = new WebSocket('ws://127.0.0.1:8094');
const t0 = Date.now(), R = 60, CX = 300, CZ = 400;   // circle centre (metres)
let squad = null, myId = null;
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(5), ...a);
ws.onopen = () => {
  ws.send(JSON.stringify({ t: 'hello', name: 'RaviBot' }));
  setInterval(() => {
    const a = (Date.now() - t0) / 1000 * 0.25;     // 0.25 rad/s -> 15 m/s
    const x = CX + Math.sin(a) * R, z = CZ + Math.cos(a) * R, rot = a + Math.PI / 2;
    ws.send(JSON.stringify({ t: 'state', s: { x, z, rot, spd: 54, mode: 'vehicle', kind: 'auto' } }));
  }, 1000 / 12);
  setInterval(() => ws.send(JSON.stringify({ t: 'ping', c: Date.now() })), 2000);
  setTimeout(() => ws.send(JSON.stringify({ t: 'chat', text: 'Namaste from RaviBot :) <3', ch: 'all' })), 1000);
  setTimeout(() => ws.send(JSON.stringify({ t: 'squad', op: code ? 'join' : 'create', code })), 2000);
  setTimeout(() => ws.send(JSON.stringify({ t: 'chat', text: 'squad-only hello', ch: 'squad' })), 4000);
  setTimeout(() => ws.send(JSON.stringify({ t: 'ping_place', x: CX, z: CZ })), 5000);
  setTimeout(() => ws.send(JSON.stringify({ t: 'quick', text: 'Follow me', x: CX, z: CZ, ch: 'squad' })), 6000);
  setTimeout(() => { for (let i = 0; i < 7; i++) ws.send(JSON.stringify({ t: 'chat', text: 'spam ' + i })); }, 8000);
  setTimeout(() => { log('done'); process.exit(0); }, secs * 1000);
};
let snaps = 0;
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.t === 'welcome') { myId = m.id; log('welcome', m.id); }
  else if (m.t === 'snap') { if (++snaps % 60 === 0) log('snap', Object.values(m.players).map(p => `${p.name}@${p.x.toFixed(0)},${p.z.toFixed(0)}${p.squad ? '[' + p.squad + ']' : ''}`).join(' ')); }
  else if (m.t === 'pong') { if (snaps % 5 === 0) log('rtt', Date.now() - m.c, 'ms'); }
  else log(m.t, JSON.stringify(m));
};
ws.onclose = () => { log('closed'); process.exit(0); };
