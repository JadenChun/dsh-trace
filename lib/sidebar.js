/* Trace Studio compact DSH sidebar — no framework or bundler required.
   The API supplies observable trace facts; this view does not invent causal reasoning. */
const byId = id => document.getElementById(id);
const ui = {
  trace: null, connection: null, source: null, sessionId: null, query: '',
  expandedSteps: new Set(), expandedTools: new Set(), expandedSections: new Set(),
  collapsedTurns: new Set(), previousLatestTurn: null, demo: Boolean(window.TRACE_STUDIO_DEMO),
};
const text = (tag, className, content) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (content !== undefined) el.textContent = String(content);
  return el;
};
const add = (parent, ...children) => { children.forEach(child => parent.appendChild(child)); return parent; };
const safeStr = value => value == null ? '' : String(value);
const summarize = (value, count = 115) => safeStr(value).replace(/\s+/g, ' ').trim().slice(0, count);
const pretty = value => {
  if (value == null || value === '') return 'Not reported';
  if (typeof value !== 'string') return JSON.stringify(value, null, 2);
  try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
};
const duration = ms => {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round(ms % 60000 / 1000)}s`;
};
const elapsed = node => node?.startedAt ? (node.endedAt || Date.now()) - node.startedAt : null;
const statusIcon = status => ({ success: '✓', error: '!', running: '·', interrupted: '–' })[status] ?? '·';
const chevron = () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'm9 6 6 6-6 6');
  svg.appendChild(path);
  return add(text('span', 'step-chevron'), svg);
};
const stepName = step => {
  const generic = /^model step \d+$/i.test(safeStr(step.title));
  if (!generic && step.title) return summarize(step.title, 140);
  if (step.tools?.length) return `${step.tools.map(t => t.name).slice(0, 2).join(' + ')}`;
  return `Model step ${step.number}`;
};
const isWorking = trace => (trace?.turns || []).some(t => (t.steps || []).some(s => s.status === 'running'));

function stats(trace) {
  const turns = trace?.turns || [];
  const steps = turns.flatMap(turn => turn.steps || []);
  const tools = steps.flatMap(step => step.tools || []);
  const started = turns.map(t => t.startedAt).filter(Boolean);
  const finished = turns.map(t => t.endedAt || Date.now()).filter(Boolean);
  const latest = turns.at(-1);
  return { turns, steps, tools, latest, ms: started.length ? Math.max(0, Math.max(...finished) - Math.min(...started)) : null };
}
function setConnection(status, label) {
  const node = byId('connection');
  // Synthetic preview data should not display a connection badge.
  // Real DSH sessions still show their actual live/reconnecting state.
  if (ui.demo) { node.hidden = true; return; }
  node.hidden = false;
  node.className = 'connection ' + status;
  node.replaceChildren(text('span', 'pulse'), document.createTextNode(' ' + label));
}
function detailBlock(label, value, opts = {}) {
  const wrap = text('div', 'detail-block');
  const line = text('div', 'detail-label');
  line.append(text('span', '', label));
  if (opts.copy !== false) {
    const copy = text('button', 'copy-btn', 'Copy');
    copy.type = 'button';
    copy.title = `Copy ${label.toLowerCase()}`;
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(pretty(value)); copy.textContent = 'Copied'; }
      catch { copy.textContent = 'Unavailable'; }
    });
    line.append(copy);
  }
  const code = text('pre', 'detail-code' + (opts.error ? ' error' : ''), pretty(value).slice(0, 8000));
  if (pretty(value).length > 8000) code.append('\n… [preview truncated — Copy gets full value]');
  return add(wrap, line, code);
}
function fold(label, id, contents) {
  const d = document.createElement('details'); d.className = 'disclosure'; d.open = ui.expandedSections.has(id);
  const summary = text('summary', '', label); d.appendChild(summary);
  d.appendChild(add(text('div', 'details-content'), ...contents));
  d.addEventListener('toggle', () => { if (d.open) ui.expandedSections.add(id); else ui.expandedSections.delete(id); });
  return d;
}
function metadataRows(node, turn) {
  const rows = [['Status', node.status || 'unknown'], ['Started', node.startedAt ? new Date(node.startedAt).toLocaleTimeString() : '—'],
    ['Duration', duration(elapsed(node))], ['Span ID', node.id]];
  if (node.kind === 'tool') rows.push(['Tool name', node.name || '—'], ['Call ID', node.callId || '—']);
  else rows.push(['Model', node.model || 'Not reported'], ['Attempts', node.attempts || 1], ['Turn / step', `${turn.number} / ${node.number}`]);
  const dl = document.createElement('dl'); dl.className = 'metadata';
  for (const [key, val] of rows) add(dl, text('dt', '', key), text('dd', '', val));
  return dl;
}
function toolPanel(tool, step, turn) {
  const contents = add(text('div', 'tool-panel'),
    detailBlock('Input', tool.input),
    detailBlock('Output', tool.output),
    ...(tool.error ? [detailBlock('Error', tool.error, { error: true })] : []),
    fold('Execution metadata', `${tool.id}:meta`, [metadataRows(tool, turn), detailBlock('Attributes', tool.metadata || {})]));
  return contents;
}
function toolRow(tool, step, turn) {
  const fragment = document.createDocumentFragment();
  const open = ui.expandedTools.has(tool.id);
  const btn = text('button', 'tool-btn'); btn.type = 'button'; btn.setAttribute('aria-expanded', String(open));
  btn.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} tool ${tool.name}`);
  add(btn, text('span', 'tool-ico ' + (tool.status === 'error' ? 'error' : ''), statusIcon(tool.status)),
    text('span', 'tool-name', tool.name || 'Unknown tool'),
    text('span', 'tool-duration', duration(elapsed(tool))),
    chevron());
  btn.addEventListener('click', () => {
    if (open) ui.expandedTools.delete(tool.id); else ui.expandedTools.add(tool.id);
    render();
  });
  fragment.append(btn);
  if (open) fragment.append(toolPanel(tool, step, turn));
  return fragment;
}
function stepPanel(step, turn) {
  const panel = text('div', 'step-content');
  if (step.reasoning) {
    const hint = text('div', 'hint-row');
    add(hint, text('span', 'hint-tag', 'Reasoning'), text('span', '', 'Provider-exposed'));
    panel.append(hint);
    panel.append(text('p', 'thought-preview', step.reasoning));
    panel.append(fold('Read full reasoning', `${step.id}:reason`, [
      detailBlock('Available reasoning text', step.reasoning),
      text('p', 'details-note', 'Only reasoning supplied by the model provider is available; private internal reasoning is not accessible.'),
    ]));
  } else {
    panel.append(text('p', 'no-reasoning', step.status === 'running' ? 'Agent is working. Expand tools below to see its latest actions.' : 'No provider-exposed reasoning for this step.'));
  }
  if (step.tools?.length) {
    panel.append(text('div', 'content-divider'));
    panel.append(text('div', 'tool-heading', `Tools · ${step.tools.length}`));
    for (const tool of step.tools) panel.append(toolRow(tool, step, turn));
  }
  if (step.output) panel.append(fold('Model response', `${step.id}:response`, [detailBlock('Response', step.output)]));
  panel.append(fold('Step metadata', `${step.id}:metadata`, [metadataRows(step, turn),
    detailBlock('Token usage', step.usage), detailBlock('Attributes', step.metadata || {})]));
  return panel;
}
function stepMatches(step, query) {
  if (!query) return true;
  return [step.title, step.output, step.reasoning, step.model, ...(step.tools || []).flatMap(t => [t.name, t.input, t.output, t.error])]
    .some(v => safeStr(v).toLowerCase().includes(query));
}
function stepRow(step, turn) {
  const expanded = ui.expandedSteps.has(step.id);
  const wrapper = text('div', 'step ' + (step.status || '') + (expanded ? ' expanded' : ''));
  wrapper.append(text('span', 'step-dot ' + (step.status || ''), statusIcon(step.status)));
  const btn = text('button', 'step-head'); btn.type = 'button'; btn.setAttribute('aria-expanded', String(expanded));
  btn.setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} step ${step.number}: ${stepName(step)}`);
  const main = text('span', 'step-core');
  main.append(text('span', 'step-title', stepName(step)));
  const under = text('span', 'step-sub');
  const toolCount = (step.tools || []).length;
  const failed = (step.tools || []).some(t => t.status === 'error');
  under.append(text('span', failed ? 'error' : (step.status === 'running' ? 'running' : ''), step.status === 'running' ? 'Running' : step.status === 'error' ? 'Failed' : `Step ${step.number}`));
  if (toolCount) add(under, text('span', '', '·'), text('span', '', `${toolCount} ${toolCount === 1 ? 'tool' : 'tools'}`));
  main.append(under);
  const tick = text('span', 'step-time', duration(elapsed(step)));
  if (step.status === 'running') tick.dataset.activeTimer = step.startedAt || '';
  add(btn, main, tick, chevron());
  btn.addEventListener('click', () => { if (expanded) ui.expandedSteps.delete(step.id); else ui.expandedSteps.add(step.id); render(); });
  wrapper.append(btn);
  if (expanded) wrapper.append(stepPanel(step, turn));
  return wrapper;
}
function turnSection(turn, latest) {
  const group = text('section', 'turn-group');
  const isSearch = Boolean(ui.query);
  const collapsed = !isSearch && ui.collapsedTurns.has(turn.id);
  const header = text('button', 'turn-head'); header.type = 'button'; header.setAttribute('aria-expanded', String(!collapsed));
  add(header, text('span', 'turn-num', `Turn ${turn.number}`),
    text('span', 'turn-label', turn.id === latest.id ? 'Latest' : summarize(turn.title, 42)),
    chevron());
  const arrow = header.querySelector('.step-chevron');
  arrow.classList.add('chevron');
  if (!collapsed) arrow.style.transform = 'rotate(90deg)';
  header.addEventListener('click', () => { if (collapsed) ui.collapsedTurns.delete(turn.id); else ui.collapsedTurns.add(turn.id); render(); });
  group.append(header);
  if (!collapsed) {
    const steps = (turn.steps || []).filter(s => stepMatches(s, ui.query));
    for (const step of steps) group.append(stepRow(step, turn));
    if (!steps.length) group.append(text('div', 'empty-message', 'No matching steps in this turn.'));
  }
  return group;
}
function render() {
  const list = byId('steps'); const container = byId('traceScroll'); const scrollY = container.scrollTop;
  const { turns, steps, tools, latest, ms } = stats(ui.trace);
  byId('taskTitle').textContent = latest?.title || 'Waiting for a session';
  byId('taskDetail').textContent = latest ? `Turn ${latest.number} · ${steps.some(s => s.status === 'running') ? 'Running' : 'Recorded execution'}` : 'Start an agent run to see its execution steps.';
  byId('totalSteps').textContent = steps.length;
  byId('totalTools').textContent = tools.length;
  byId('totalTime').textContent = duration(ms);
  const completed = steps.filter(s => s.status === 'success' || s.status === 'error' || s.status === 'interrupted').length;
  byId('progressText').textContent = steps.length ? `${completed} of ${steps.length} completed` : 'No steps yet';
  list.replaceChildren();
  if (!turns.length) list.append(text('div', 'empty-message', 'No recorded steps yet. A new agent run will appear here automatically.'));
  else {
    for (const turn of turns.toReversed ? turns.toReversed() : turns.slice().reverse()) {
      if (ui.query && !(turn.steps || []).some(s => stepMatches(s, ui.query))) continue;
      list.append(turnSection(turn, latest));
    }
    if (ui.query && !list.childNodes.length) list.append(text('div', 'empty-message', 'No steps match your search.'));
  }
  container.scrollTop = scrollY;
}
function applyTrace(trace) {
  if (ui.trace && trace?.sessionId !== ui.trace.sessionId) {
    ui.expandedSteps.clear(); ui.expandedTools.clear(); ui.expandedSections.clear(); ui.collapsedTurns.clear();
  }
  const prev = ui.trace?.turns?.at(-1)?.id;
  const latest = trace?.turns?.at(-1)?.id;
  if (prev !== latest && latest) {
    // Old turns stay available behind one click. The latest turn stays open.
    for (const turn of trace.turns.slice(0, -1)) ui.collapsedTurns.add(turn.id);
    ui.collapsedTurns.delete(latest);
  }
  ui.trace = trace; render();
}
function connect(sessionId) {
  ui.source?.close(); ui.source = null;
  if (!sessionId) return;
  ui.sessionId = sessionId;
  byId('fullLink').href = '/trace-studio/view?session=' + encodeURIComponent(sessionId);
  setConnection('waiting', 'Connecting');
  const source = new EventSource('/trace-studio/api/stream?session=' + encodeURIComponent(sessionId));
  ui.source = source;
  source.addEventListener('snapshot', event => {
    try { applyTrace(JSON.parse(event.data)); setConnection('online', 'Live'); }
    catch (error) { console.error('[trace-studio] Invalid snapshot', error); setConnection('offline', 'Error'); }
  });
  source.onerror = () => setConnection('offline', 'Retrying');
}
function demoTrace() {
  const now = Date.now(), base = now - 19600;
  const tool = (step, key, name, from, to, input, output, status = 'success') => ({
    id: `tool:1:${step}:${key}`, callId:key, kind:'tool', name, status,
    startedAt:base+from, endedAt:to == null ? null : base+to,
    input:JSON.stringify(input, null, 2), output:JSON.stringify(output, null, 2),
    metadata:{callId:key,parentStep:`step:1:${step}`}, error:status === 'error'?'TEST_FAILURE: issuer value differs':null,
  });
  const step = (n, title, from, to, reasoning, output, tools=[]) => ({
    id:`step:1:${n}`,number:n,turn:1,kind:'model',title,status:to == null?'running':tools.some(t=>t.status==='error')?'error':'success',
    startedAt:base+from,endedAt:to == null?null:base+to,reasoning,output,tools,
    model:'deepseek-reasoner',attempts:1,usage:JSON.stringify({input_tokens:1200+n*130,output_tokens:360+n*120}),metadata:{provider:'DeepSeek'},
  });
  return { sessionId:'demo_agent_session', updatedAt:now, turns:[{
    id:'turn:1', number:1, title:'Investigate failed API requests and identify the cause', userInput:'Investigate failed API requests and identify the cause',
    startedAt:base,endedAt:null,steps:[
      step(1,'Inspect application logs',350,4200,'Check the latest API logs before changing any code.','The errors appear to originate in authentication.',[
        tool(1,'logs','read_server_logs',1500,3750,{path:'/var/log/api.log',lines:200},{error:'JWT issuer verification failed',matches:27}),
      ]),
      step(2,'Find the JWT verification handler',4500,10200,'Locate the code that validates the issuer and signing algorithm.','Found the auth handler and the configuration.',[
        tool(2,'grep','search_codebase',6250,8450,{pattern:'verifyJwt',directory:'src/'},{files:['src/middleware/auth.ts']}),
        tool(2,'file','read_file',6350,9600,{path:'src/config/auth.ts'},{issuer:'https://auth.internal.local'}),
      ]),
      step(3,'Check authentication configuration',10500,15300,'Compare the token issuer against the configured issuer, then run the auth tests.','The test failed: the issuer differs from the configured value.',[
        tool(3,'test','run_test',13000,14900,{command:'npm test -- auth'},{passed:18,failed:1},'error'),
      ]),
      step(4,'Summarize the root cause',16000,null,'Evidence indicates an issuer mismatch, not an expired token. Explain the finding and next steps.','The API failures originate from inconsistent JWT issuer configuration.'),
    ]
  }] };
}
function init() {
  const searchToggle = byId('searchButton'), searchbar = byId('searchbar'), input = byId('search');
  searchToggle.addEventListener('click', () => {
    searchbar.hidden = !searchbar.hidden; searchToggle.setAttribute('aria-expanded', String(!searchbar.hidden));
    if (!searchbar.hidden) input.focus(); else { input.value = ''; ui.query = ''; render(); }
  });
  input.addEventListener('input', () => { ui.query = input.value.trim().toLowerCase(); render(); });
  input.addEventListener('keydown', ev => { if (ev.key === 'Escape') searchToggle.click(); });
  byId('refreshButton').addEventListener('click', () => {
    if (ui.demo) { applyTrace(demoTrace()); return; }
    const session = ui.sessionId || new URLSearchParams(location.search).get('session');
    if (session) connect(session); else location.reload();
  });
  if (ui.demo) {
    applyTrace(demoTrace()); setConnection('online', ''); return;
  }
  const session = new URLSearchParams(location.search).get('session');
  if (session) connect(session);
  else {
    setConnection('offline', 'No session');
    fetch('/trace-studio/api/sessions').then(r => r.json()).then(data => {
      if (data.sessions?.[0]?.sessionId) connect(data.sessions[0].sessionId);
    }).catch(() => {});
  }
  // Update active wall-time labels without rebuilding expanded detail sections.
  setInterval(() => {
    const s = stats(ui.trace);
    if (isWorking(ui.trace)) byId('totalTime').textContent = duration(s.ms);
    document.querySelectorAll('[data-active-timer]').forEach(node => {
      const at = Number(node.dataset.activeTimer);
      if (at) node.textContent = duration(Date.now() - at);
    });
  }, 1000);
}
init();
