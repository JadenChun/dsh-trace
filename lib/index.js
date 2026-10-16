import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createSession, applySessionEvent, applyStreamFrame, project } from './collector.js';

export const name = 'dsh-trace-studio';
export const inject = ['webServer'];
const BASE = '/trace-studio';
const ROOT = dirname(fileURLToPath(import.meta.url));

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': type, 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
  });
  res.end(data);
}
function sessionParam(req) {
  const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
  const id = params.get('session') ?? '';
  return id.length > 0 && id.length <= 256 ? id : null;
}

export function apply(ctx, rawConfig = {}) {
  const cfg = {
    maxSessions: Math.max(1, Math.min(100, Number(rawConfig.maxSessions) || 24)),
    maxEvents: Math.max(500, Math.min(100000, Number(rawConfig.maxEvents) || 12000)),
    maxFieldChars: Math.max(2000, Math.min(250000, Number(rawConfig.maxFieldChars) || 30000)),
    throttleMs: Math.max(100, Math.min(5000, Number(rawConfig.throttleMs) || 250)),
  };
  const store = new Map();
  const subscribers = new Map();
  const hydrated = new Set();
  const hydrating = new Map();
  const flushTimers = new Map();

  function entry(id) {
    if (store.has(id)) {
      const value = store.get(id);
      store.delete(id);
      store.set(id, value);
      return value;
    }
    const fresh = createSession(id);
    store.set(id, fresh);
    while (store.size > cfg.maxSessions) {
      const oldest = store.keys().next().value;
      for (const end of subscribers.get(oldest) ?? []) end();
      subscribers.delete(oldest);
      store.delete(oldest);
      hydrated.delete(oldest);
    }
    return fresh;
  }
  function broadcast(id) {
    if (flushTimers.has(id)) return;
    const timer = setTimeout(() => {
      flushTimers.delete(id);
      const payload = `event: snapshot\ndata: ${JSON.stringify(project(store.get(id)))}\n\n`;
      for (const sub of subscribers.get(id) ?? []) sub.write(payload);
    }, cfg.throttleMs);
    flushTimers.set(id, timer);
  }
  function applyEvent(id, event) {
    if (applySessionEvent(entry(id), event, cfg.maxFieldChars)) broadcast(id);
  }
  function queueOrRun(id, action) {
    const queue = hydrating.get(id)?.queue;
    if (queue) queue.push(action); else action();
  }
  const offEvent = ctx.on('session/event', (session, event) => {
    const id = session?.id;
    if (typeof id === 'string') queueOrRun(id, () => applyEvent(id, event));
  });
  const offStream = ctx.on('agent/assistant-stream', payload => {
    const id = payload?.agent?.session?.id;
    if (typeof id === 'string' && payload.frame) queueOrRun(id, () => {
      if (applyStreamFrame(entry(id), payload.frame, cfg.maxFieldChars)) broadcast(id);
    });
  });
  ctx.effect(() => () => { offEvent(); offStream(); }, 'trace-studio: event listeners');

  async function hydrate(id) {
    if (hydrated.has(id)) return;
    if (hydrating.has(id)) return hydrating.get(id).promise;
    const task = { queue: [], promise: null };
    hydrating.set(id, task);
    const promise = (async () => {
      let handle;
      try {
        const persistence = ctx.get?.('sessionPersistence');
        if (!persistence?.open) return;
        handle = await persistence.open(id, 'read');
        const data = await handle.read();
        if (!Array.isArray(data?.events)) return;
        const events = data.events.slice(-cfg.maxEvents);
        const fresh = createSession(id);
        for (const event of events) applySessionEvent(fresh, event, cfg.maxFieldChars);
        store.set(id, fresh);
        hydrated.add(id);
      } catch (err) {
        ctx.logger?.debug?.(`[trace-studio] Could not load historical events: ${String(err)}`);
      } finally {
        try { await handle?.close(); } catch {}
        hydrating.delete(id);
        for (const action of task.queue) action();
      }
    })();
    task.promise = promise;
    return promise;
  }

  const routes = [
    { path: `${BASE}/sidebar`, file: 'sidebar.html', type: 'text/html; charset=utf-8' },
    { path: `${BASE}/sidebar.js`, file: 'sidebar.js', type: 'text/javascript; charset=utf-8' },
    { path: `${BASE}/sidebar.css`, file: 'sidebar.css', type: 'text/css; charset=utf-8' },
    { path: `${BASE}/view`, file: 'viewer.html', type: 'text/html; charset=utf-8' },
    { path: `${BASE}/viewer.js`, file: 'viewer.js', type: 'text/javascript; charset=utf-8' },
    { path: `${BASE}/viewer.css`, file: 'viewer.css', type: 'text/css; charset=utf-8' },
  ];
  for (const item of routes) {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: item.path, handler: async (_req, res) => {
      try { send(res, 200, await readFile(join(ROOT, item.file), 'utf8'), item.type); }
      catch { send(res, 500, { error: 'Viewer asset unavailable' }); }
    } }), `trace-studio: ${item.path}`);
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: `${BASE}/api/sessions`, handler: (_req, res) => {
    send(res, 200, { sessions: [...store.values()].map(s => ({ sessionId: s.id, turns: s.turns.length, updatedAt: s.updatedAt })).reverse() });
  } }), 'trace-studio: sessions');
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: `${BASE}/api/trace`, handler: async (req, res) => {
    const id = sessionParam(req);
    if (!id) return send(res, 400, { error: 'Valid session query parameter required' });
    await hydrate(id);
    send(res, 200, project(entry(id)));
  } }), 'trace-studio: trace');
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: `${BASE}/api/stream`, handler: async (req, res) => {
    const id = sessionParam(req);
    if (!id) return send(res, 400, { error: 'Valid session query parameter required' });
    await hydrate(id);
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    let active = true;
    const sub = {
      write: data => { if (active) try { res.write(data); } catch {} },
      end: () => { if (active) { active = false; clearInterval(beat); try { res.end(); } catch {} } },
    };
    if (!subscribers.has(id)) subscribers.set(id, new Set());
    subscribers.get(id).add(sub);
    sub.write(`event: snapshot\ndata: ${JSON.stringify(project(entry(id)))}\n\n`);
    const beat = setInterval(() => sub.write(': heartbeat\n\n'), 15000);
    req.on('close', () => { subscribers.get(id)?.delete(sub); sub.end(); });
  } }), 'trace-studio: stream');

  ctx.effect(() => () => {
    for (const timer of flushTimers.values()) clearTimeout(timer);
    for (const set of subscribers.values()) for (const sub of set) sub.end();
    flushTimers.clear(); subscribers.clear(); store.clear(); hydrated.clear();
  }, 'trace-studio: cleanup');
  ctx.logger?.info?.('[trace-studio] Viewer registered at /trace-studio/view');
}
