// Read-only projection of DSH's authoritative session events.
// DSH does NOT expose hidden reasoning; only provider-exposed reasoning blocks are collected.
export function limit(value, cap = 30000) {
  if (typeof value !== 'string') return value;
  return value.length > cap ? value.slice(0, cap) + `\n… [truncated ${value.length - cap} chars]` : value;
}

export function redact(text) {
  return String(text)
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|secret|password|authorization)\s*[=:]\s*["']?)[^\s,"'}]+/gi, '$1[REDACTED]')
    .replace(/("(?:api[_-]?key|access[_-]?token|secret|password|authorization)"\s*:\s*")[^"]+("?)/gi, '$1[REDACTED]$2');
}

export function safeValue(value, cap = 30000) {
  const seen = new WeakSet();
  try {
    const raw = typeof value === 'string' ? value : JSON.stringify(value, (key, v) => {
      if (/^(?:authorization|password|secret|api[_-]?key|access[_-]?token)$/i.test(key)) return '[REDACTED]';
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[Circular]';
        seen.add(v);
      }
      return v;
    }, 2);
    return limit(redact(raw ?? ''), cap);
  } catch {
    return '[Unserializable value]';
  }
}

const number = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined;
const string = v => typeof v === 'string' ? v : undefined;
const keyOf = (t, s) => `${t}.${s}`;

export function createSession(id) {
  return { id, turns: [], updatedAt: Date.now(), attempts: new Map(), last: undefined };
}
function ensureTurn(trace, n, at) {
  let turn = trace.turns.find(t => t.number === n);
  if (!turn) {
    turn = { number: n, id: `turn:${n}`, title: `Turn ${n}`, startedAt: at, endedAt: null, steps: [] };
    trace.turns.push(turn);
    trace.turns.sort((a,b) => a.number - b.number);
  }
  return turn;
}
function ensureStep(trace, turnN, stepN, at) {
  const turn = ensureTurn(trace, turnN, at);
  let step = turn.steps.find(s => s.number === stepN);
  if (!step) {
    step = { id: `step:${turnN}:${stepN}`, number: stepN, turn: turnN,
      title: `Model step ${stepN}`, kind: 'model', status: 'running',
      startedAt: at, endedAt: null, attempts: 1, reasoning: '', output: '',
      model: null, usage: null, input: null, metadata: {}, tools: [] };
    turn.steps.push(step);
    turn.steps.sort((a,b) => a.number - b.number);
  }
  trace.last = { turn: turnN, step: stepN };
  return step;
}
function contentParts(blocks) {
  const parsed = { reasoning: '', output: '' };
  if (!Array.isArray(blocks)) return parsed;
  for (const b of blocks) {
    if (!b || typeof b.text !== 'string') continue;
    if (b.type === 'reasoning') parsed.reasoning += b.text;
    if (b.type === 'text') parsed.output += b.text;
  }
  return parsed;
}
function findCall(step, id) { return step.tools.find(t => t.callId === id); }

export function applySessionEvent(trace, event, maxFieldChars = 30000) {
  if (!event || typeof event !== 'object') return false;
  const type = string(event.type);
  const data = event.data ?? {};
  const at = number(event.time) ?? Date.now();
  const turnN = number(data.turn);
  if (type === 'user/message') {
    const t = trace.turns.at(-1);
    if (!t || data.source?.kind !== 'user') return false;
    const text = contentParts(data.content).output.trim();
    if (text && !t.userInput) { t.userInput = limit(redact(text), maxFieldChars); t.title = limit(t.userInput.replace(/\s+/g,' '), 100); return true; }
    return false;
  }
  if (turnN === undefined) return false;
  if (type === 'turn/start') {
    const turn = ensureTurn(trace, turnN, at);
    turn.seq = event.seq;
    turn.startedAt = Math.min(turn.startedAt, at);
  } else if (type === 'turn/end') {
    const turn = ensureTurn(trace, turnN, at);
    turn.endedAt = at;
    turn.endReason = string(data.reason) ?? null;
    for (const s of turn.steps) if (!s.endedAt) { s.endedAt = at; s.status = 'interrupted'; }
  } else if (type === 'step/start') {
    if (number(data.step) === undefined) return false;
    const step = ensureStep(trace, turnN, Number(data.step), at);
    step.startedAt = Math.min(at, step.startedAt);
  } else if (type === 'step/end') {
    if (number(data.step) === undefined) return false;
    const step = ensureStep(trace, turnN, Number(data.step), at);
    step.endedAt = at;
    step.status = step.tools.some(t => t.status === 'error') ? 'error' : 'success';
  } else if (type === 'assistant/message') {
    if (number(data.step) === undefined) return false;
    const step = ensureStep(trace, turnN, Number(data.step), at);
    const message = data.message ?? {};
    const content = contentParts(message.content);
    if (content.reasoning) step.reasoning = limit(redact(content.reasoning), maxFieldChars);
    if (content.output) step.output = limit(redact(content.output), maxFieldChars);
    step.model = string(message.model) ?? string(data.model) ?? step.model;
    step.usage = message.usage ?? data.usage ?? step.usage;
    step.metadata = { ...step.metadata, ...(data.attemptId ? { attemptId: data.attemptId } : {}), ...(data.provider ? { provider: data.provider } : {}) };
    if (step.output) step.title = limit(step.output.replace(/\s+/g, ' '), 80);
  } else if (type === 'tool/call') {
    if (number(data.step) === undefined) return false;
    const step = ensureStep(trace, turnN, Number(data.step), at);
    const id = string(data.callId);
    if (!id || findCall(step, id)) return false;
    step.tools.push({ id: `tool:${turnN}:${data.step}:${id}`, callId: id, name: string(data.name) ?? 'Unknown tool',
      kind: 'tool', status: 'running', startedAt: at, endedAt: null,
      input: safeValue(data.arguments, maxFieldChars), output: null, error: null,
      metadata: { callId: id, parentStep: step.id } });
  } else if (type === 'tool/result') {
    if (number(data.step) === undefined) return false;
    const step = ensureStep(trace, turnN, Number(data.step), at);
    const msg = data.message ?? {};
    const callId = string(msg.source?.callId);
    const tool = (callId && findCall(step, callId)) || step.tools.find(t => !t.endedAt);
    if (!tool) return false;
    tool.endedAt = at;
    tool.status = msg.isError === true ? 'error' : 'success';
    tool.output = safeValue(msg.content ?? msg, maxFieldChars);
    tool.error = msg.isError === true ? safeValue(data.error ?? msg.content ?? 'Tool error', maxFieldChars) : null;
  } else {
    return false;
  }
  trace.updatedAt = Date.now();
  return true;
}

export function applyStreamFrame(trace, frame, maxFieldChars = 30000) {
  if (!frame || typeof frame !== 'object') return false;
  const id = string(frame.attemptId);
  if (!id) return false;
  if (frame.type === 'start') {
    if (number(frame.turn) === undefined || number(frame.step) === undefined) return false;
    const s = ensureStep(trace, Number(frame.turn), Number(frame.step), Date.now());
    if (s.metadata.attemptId && s.metadata.attemptId !== id) s.attempts++;
    s.metadata.attemptId = id;
    trace.attempts.set(id, { turn: s.turn, step: s.number });
    return true;
  }
  if (frame.type === 'end') { trace.attempts.delete(id); return false; }
  if (frame.type !== 'chunk' || typeof frame.chunk?.text !== 'string') return false;
  const owned = frame.turn !== undefined && frame.step !== undefined
    ? { turn: Number(frame.turn), step: Number(frame.step) }
    : trace.attempts.get(id);
  if (!owned) return false;
  const s = ensureStep(trace, owned.turn, owned.step, Date.now());
  if (s.metadata.attemptId && s.metadata.attemptId !== id) return false;
  if (frame.chunk.type === 'reasoning-delta') s.reasoning = limit(redact(s.reasoning + frame.chunk.text), maxFieldChars);
  else if (frame.chunk.type === 'text-delta') s.output = limit(redact(s.output + frame.chunk.text), maxFieldChars);
  else return false;
  trace.updatedAt = Date.now();
  return true;
}

export function project(trace) {
  if (!trace) return null;
  return { sessionId: trace.id, updatedAt: trace.updatedAt, turns: trace.turns.map(turn => ({
    ...turn, steps: turn.steps.map(s => ({ ...s, usage: s.usage ? safeValue(s.usage, 10000) : null }))
  })) };
}
