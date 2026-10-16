/* Trace Studio — zero-dependency, local-first trace explorer. */
const $ = id => document.getElementById(id);
const state = { trace: null, selected: null, mode: 'timeline', zoom: 1, source: null, search: '' };
const fmt = (v, fallback = '—') => v === null || v === undefined || v === '' ? fallback : String(v);
const dur = ms => ms == null || !Number.isFinite(ms) ? '—' : ms < 1000 ? `${Math.max(0,Math.round(ms))}ms` : ms < 60000 ? `${(ms/1000).toFixed(2)}s` : `${Math.floor(ms/60000)}m ${Math.round(ms%60000/1000)}s`;
const date = ms => ms ? new Date(ms).toLocaleTimeString([], { hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit' }) : '—';
const cap = (v,n=60) => String(v??'').replace(/\s+/g, ' ').slice(0,n);
const statusText = s => ({ success:'Success',error:'Error',running:'Running',interrupted:'Interrupted' })[s] || 'Pending';
const empty = el => { while(el.firstChild) el.removeChild(el.firstChild); };
function element(tag, klass='', text='') { const n=document.createElement(tag); if(klass)n.className=klass; n.textContent=text; return n; }
function add(parent,...children) { children.forEach(c=>parent.appendChild(c)); return parent; }
function calculate(trace) {
  const turns=trace?.turns||[], steps=turns.flatMap(t=>t.steps||[]),tools=steps.flatMap(s=>s.tools||[]);
  const start=turns.map(t=>t.startedAt).filter(Boolean),finish=turns.map(t=>t.endedAt||Date.now()).filter(Boolean);
  return { turns,steps,tools,errors:tools.filter(t=>t.status==='error').length,
    duration:start.length ? Math.max(...finish)-Math.min(...start) : null,
    status:steps.length ? (steps.some(s=>s.status==='running') ? 'running' : steps.some(s=>s.status==='error') ? 'error' : 'success') : null };
}
function allNodes(trace) { const out=new Map(); for(const t of trace?.turns||[]){out.set(t.id,{...t,kind:'turn'});for(const step of t.steps||[]){out.set(step.id,step);for(const tool of step.tools||[])out.set(tool.id,{...tool,parent:step});}}return out; }
function nodeMatches(node,query) { if(!query)return true;return [node.title,node.name,node.output,node.input,node.reasoning,node.id].some(v=>typeof v==='string'&&v.toLowerCase().includes(query)); }
function makeBadge(kind) {const el=element('span','kind-pill'+(kind==='tool'?' tool':''),kind==='tool'?'TOOL':kind==='turn'?'TURN':'MODEL');return el;}
function select(id) { state.selected=id; document.querySelector('.inspector')?.classList.remove('mobile-hidden'); render(); const pane=document.querySelector('.inspect-scroll'); if(pane)pane.scrollTop=0; }
function updateSummary() {
  const {steps,tools,errors,duration,status,turns}=calculate(state.trace);
  $('runCount').textContent=`${steps.length} steps`;
  $('metricSteps').textContent=steps.length.toString();$('metricTools').textContent=tools.length.toString();
  $('metricErrors').textContent=`${errors} failed`;
  $('metricDuration').textContent=dur(duration);
  const st=$('metricStatus');st.textContent=statusText(status);st.className=status==='success'?'good':status==='running'?'warn':'';
  $('runRef').textContent=state.trace?.sessionId?cap(state.trace.sessionId,25):'CURRENT SESSION';
  $('runTitle').textContent=turns.length?cap(turns.at(-1)?.title||'Agent execution trace',65):'Agent execution trace';
  $('runSub').textContent=turns.length?`${turns.length} turn${turns.length===1?'':'s'} captured · Click any span to inspect events and metadata`:'Examine agent steps, tool I/O, durations, and model metadata.';
}
function renderNav() {
  const root=$('traceList');empty(root);
  if(!state.trace?.turns.length){add(root,element('div','empty-side','No trace loaded'));return;}
  for(const turn of state.trace.turns){
    const heading=element('div','nav-turn');add(heading,element('span','','TURN '+turn.number),element('span','',`${turn.steps.length} steps`));root.appendChild(heading);
    const groups=[];
    for(const step of turn.steps){groups.push(step);groups.push(...step.tools);}
    for(const node of groups){if(!nodeMatches(node,state.search))continue;
      const btn=element('button','nav-item'+(node.kind==='tool'?' nav-tool':'')+(node.id===state.selected?' active':''));btn.type='button';btn.onclick=()=>select(node.id);
      const symbol=element('span','small-icon',node.kind==='tool'?'⚙':'◇');
      const info=element('div','nav-info');add(info,element('strong','',node.kind==='tool'?node.name:node.title),element('small','',node.kind==='tool'?cap(node.callId,16):`Step ${node.number} · ${dur(node.endedAt?node.endedAt-node.startedAt:null)}`));
      add(btn,symbol,info,element('i','status-dot '+node.status));root.appendChild(btn);
    }
  }
  if(!root.querySelector('.nav-item'))root.appendChild(element('div','empty-side','No matching steps'));
}
function renderTimeline() {
  const root=$('timelineContent');empty(root);
  if(!state.trace?.turns.length){root.appendChild(element('div','no-results','Open a DSH session or try the demo to explore a trace.'));return;}
  let matching=0;
  for(const turn of state.trace.turns){
    const entries=turn.steps.flatMap(s=>[s,...s.tools]);
    if(!entries.some(n=>nodeMatches(n,state.search)))continue;
    root.appendChild(add(element('div','timeline-turn'),element('span','turn-pill','TURN '+turn.number),element('span','',cap(turn.title,85))));
    for(const node of entries){
      if(!nodeMatches(node,state.search))continue;
      matching++;
      const row=element('div','flow-entry');const rail=element('div','rail');rail.appendChild(element('div','rail-dot'+(node.kind==='tool'?' tool':'')+(node.status==='error'?' error':''),node.kind==='tool'?'⚙':'◇'));
      const card=element('div','flow-card'+(node.id===state.selected?' active':''));card.tabIndex=0;card.role='button';card.setAttribute('aria-label','Inspect '+(node.name||node.title));card.onclick=()=>select(node.id);card.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select(node.id);}};
      const body=element('div','flow-card-body');const top=element('div','flow-card-top');top.appendChild(makeBadge(node.kind));top.appendChild(element('strong','',node.kind==='tool'?node.name:node.title));
      const right=element('div','top-right');right.appendChild(element('span','',dur(node.endedAt?node.endedAt-node.startedAt:node.startedAt?Date.now()-node.startedAt:null)));right.appendChild(element('span','',node.status==='error'?'✕':node.status==='success'?'✓':'◌'));
      add(body,top,element('p','',node.kind==='tool'?cap(node.input,130):cap(node.reasoning||node.output||'Awaiting model output',130)));
      const foot=element('div','footline');
      add(foot,element('span','',`◷ ${date(node.startedAt)}`),element('span','',node.kind==='tool'?`Call ${cap(node.callId,16)}`:`Attempt ${node.attempts||1}`),element('span','',statusText(node.status)));
      body.appendChild(foot);add(card,body,right);add(row,rail,card);root.appendChild(row);
    }
  }
  if(!matching)root.appendChild(element('div','no-results','No matching steps or tools'));
}
function svgEl(tag,attrs={}) {const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,String(v));return el;}
function path(root,a,b) { const m=(a.x+b.x)/2; root.appendChild(svgEl('path',{class:'svg-edge',d:`M ${a.x} ${a.y} C ${m} ${a.y}, ${m} ${b.y}, ${b.x} ${b.y}`})); }
function renderGraph() {
  const svg=$('graphSvg');empty(svg);const traces=state.trace?.turns||[];
  if(!traces.length)return;
  const nodes=[],edges=[];let y=60;
  for(const turn of traces){
    const base=y;
    nodes.push({id:turn.id,x:50,y:base,w:190,h:58,name:`Turn ${turn.number}`,subtitle:cap(turn.title,24),kind:'turn'});
    let prev=null;
    for(const step of turn.steps){
      const sY=y+105;
      nodes.push({id:step.id,x:315,y:sY,w:200,h:60,name:`Step ${step.number} · Model`,subtitle:cap(step.title,25),kind:'model'});
      edges.push({a:prev||turn.id,b:step.id});
      let ty=sY;
      for(const tool of step.tools){
        nodes.push({id:tool.id,x:615,y:ty,w:210,h:58,name:cap(tool.name,28),subtitle:`${statusText(tool.status)} · ${dur(tool.endedAt?tool.endedAt-tool.startedAt:null)}`,kind:'tool'});
        edges.push({a:step.id,b:tool.id});ty+=85;
      }
      y=Math.max(sY+36,ty-55)+85;
      prev=step.id;
    }
    if(!turn.steps.length)y+=130;
    y=Math.max(y,base+135)+30;
  }
  const byId=new Map(nodes.map(n=>[n.id,n]));
  for(const e of edges){const a=byId.get(e.a),b=byId.get(e.b);if(a&&b)path(svg,{x:a.x+a.w,y:a.y+a.h/2},{x:b.x,y:b.y+b.h/2});}
  for(const n of nodes){
    const group=svgEl('g',{class:'svg-node'+(n.id===state.selected?' selected':''),tabindex:'0',role:'button'});
    group.appendChild(svgEl('rect',{x:n.x,y:n.y,width:n.w,height:n.h,rx:9}));
    const title=svgEl('text',{x:n.x+13,y:n.y+23});title.textContent=n.name;group.appendChild(title);
    const sub=svgEl('text',{x:n.x+13,y:n.y+43,class:'secondary'});sub.textContent=n.subtitle;group.appendChild(sub);
    group.onclick=()=>select(n.id);group.onkeydown=e=>{if(e.key==='Enter')select(n.id)};svg.appendChild(group);
  }
  const width=880,height=y+50;svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.style.width=(width*state.zoom)+'px';svg.style.height=(height*state.zoom)+'px';$('zoomLabel').textContent=Math.round(state.zoom*100)+'%';
}
function inspectSection(root,name) {const section=element('section','inspect-section');section.appendChild(element('h3','',name));root.appendChild(section);return section;}
function kv(section,key,value){const row=element('div','kv');add(row,element('span','key',key),element('span','value',fmt(value)));section.appendChild(row);}
function codeSection(root,title,content) {
  const section=inspectSection(root,title);const toolbar=element('div','code-title');const button=element('button','copy-btn','Copy');button.type='button';button.onclick=async()=>{try{await navigator.clipboard.writeText(String(content??''));button.textContent='Copied';setTimeout(()=>button.textContent='Copy',1200);}catch{button.textContent='Unavailable';}};
  toolbar.appendChild(button);section.appendChild(toolbar);section.appendChild(element('pre','codebox',content===null||content===undefined||content===''?'No data available':typeof content==='string'?content:JSON.stringify(content,null,2)));return section;
}
function renderInspector() {
  const root=$('inspectContent');empty(root);
  const node=allNodes(state.trace).get(state.selected);
  $('inspectTitle').textContent=node?(node.name||node.title||'Turn '+node.number):'Node details';
  $('inspectType').textContent=node?.kind?.toUpperCase()||'SELECT';
  $('inspectType').className='node-type';
  document.querySelector('.inspector')?.classList.toggle('no-selection',!node);
  if(!node){const box=element('div','inspect-placeholder');add(box,element('div','placeholder-glyph','⌁'),element('strong','','Explore a step'),element('p','','Select a model invocation or tool call to view metadata, input, output, and timing.'));root.appendChild(box);return;}
  const meta=inspectSection(root,'Execution metadata');
  const pill=element('span','status-badge '+node.status,statusText(node.status));const statusRow=element('div','kv');add(statusRow,element('span','key','Status'),pill);meta.appendChild(statusRow);
  kv(meta,'Span ID',node.id);kv(meta,'Started',date(node.startedAt));kv(meta,'Ended',date(node.endedAt));kv(meta,'Duration',dur(node.endedAt?node.endedAt-node.startedAt:node.startedAt?Date.now()-node.startedAt:null));
  if(node.kind==='model'){kv(meta,'Model',node.model||'Not reported');kv(meta,'Attempts',node.attempts||1);kv(meta,'Turn / step',`${node.turn} / ${node.number}`);if(node.usage)codeSection(root,'Token usage (reported)',node.usage);}
  else if(node.kind==='tool'){kv(meta,'Tool',node.name);kv(meta,'Call ID',node.callId);kv(meta,'Parent span',node.parent?.id||node.metadata?.parentStep);}
  else{kv(meta,'Turn',node.number);kv(meta,'Event sequence',node.seq);kv(meta,'End reason',node.endReason);}
  root.appendChild(element('div','divider'));
  if(node.kind==='model'){
    if(node.reasoning) { const sec=inspectSection(root,'Available model reasoning');sec.appendChild(element('div','summary',node.reasoning.slice(0,240)+(node.reasoning.length>240?'…':'')));codeSection(root,'Reasoning text',node.reasoning); }
    else { const sec=inspectSection(root,'Model reasoning');sec.appendChild(element('div','summary','This step has no provider-exposed reasoning text. Internal hidden thoughts cannot be recovered.')); }
    codeSection(root,'Model response',node.output);
  } else if(node.kind==='tool'){codeSection(root,'Tool input',node.input);codeSection(root,'Tool output',node.output);if(node.error)codeSection(root,'Error',node.error);}
  else codeSection(root,'User input',node.userInput);
  codeSection(root,'Attributes & metadata',node.metadata||{});
}
function render(){ const pane=document.querySelector('.inspect-scroll'); const oldScroll=pane?.scrollTop||0; updateSummary();renderNav();renderTimeline();renderGraph();renderInspector();if(pane)pane.scrollTop=oldScroll; }
function connect(id) {
  state.source?.close();state.source=null;
  $('session').value=id;
  $('full').href='/trace-studio/view?session='+encodeURIComponent(id);
  if(!id){setConnection('offline','No session');return;}
  history.replaceState(null,'','?session='+encodeURIComponent(id));
  setConnection('loading','Connecting');
  const stream=new EventSource('/trace-studio/api/stream?session='+encodeURIComponent(id));state.source=stream;
  stream.addEventListener('snapshot',e=>{try{state.trace=JSON.parse(e.data);const nodes=allNodes(state.trace);if(!nodes.has(state.selected))state.selected=state.trace.turns.at(-1)?.steps?.at(-1)?.id||null;setConnection('online','Live trace');render();}catch(err){console.error('Invalid trace payload',err);}});
  stream.onerror=()=>setConnection('offline','Reconnecting');
}
function setConnection(kind,text){const el=$('connection');el.className='connection '+(kind==='online'?'online':kind==='offline'?'offline':'');el.lastChild.textContent=' '+text;}
function exportTrace(){if(!state.trace)return;const blob=new Blob([JSON.stringify(state.trace,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='dsh-trace-'+cap(state.trace.sessionId,30).replace(/[^a-zA-Z0-9_-]/g,'_')+'.json';a.click();URL.revokeObjectURL(url);}
function demoTrace(){
  const now=Date.now(),base=now-18900;
  const step=(n,title,start,end,reasoning,output,tools=[])=>({id:`step:1:${n}`,number:n,turn:1,title,kind:'model',status:end?'success':'running',startedAt:base+start,endedAt:end?base+end:null,attempts:1,reasoning,output,model:'deepseek-reasoner',usage:{input_tokens:1210+n*155,output_tokens:420+n*170},metadata:{provider:'DeepSeek',reasoning_available:true},tools});
  const tool=(n,id,name,start,end,input,output,status='success')=>({id:`tool:1:${n}:${id}`,callId:id,name,kind:'tool',status,startedAt:base+start,endedAt:end?base+end:null,input:JSON.stringify(input,null,2),output:JSON.stringify(output,null,2),metadata:{callId:id,parentStep:`step:1:${n}`}});
  return { sessionId:'session_demo_72a9f',updatedAt:now,turns:[{id:'turn:1',number:1,title:'Investigate failed API requests and identify the cause',userInput:'Investigate failed API requests and identify the cause',startedAt:base,endedAt:null,steps:[
    step(1,'Inspect application logs',300,4200,'I should check recent logs before changing code. The latest failures may reveal the underlying exception.','The error appears concentrated in the authentication middleware.',[tool(1,'call_logs','read_server_logs',1500,3900,{path:'/var/log/api.log',lines:200},{matches:27,error:'JWT verification failed'})]),
    step(2,'Locate JWT verification logic',4400,10600,'I need to determine which middleware verifies the JWT and whether it expects an outdated signing algorithm.','Found the JWT verification handler and configuration.',[tool(2,'call_grep','search_codebase',6200,8400,{pattern:'verifyJwt',directory:'src/'},{files:['src/middleware/auth.ts','src/config/auth.ts']}),tool(2,'call_config','read_file',6200,9900,{path:'src/config/auth.ts'},{algorithm:'RS256',issuer:'https://auth.example.local'})]),
    step(3,'Validate authentication configuration',11100,15100,'The configured issuer and token issuer may differ. Confirm the environment values before drawing a conclusion.','Detected an issuer mismatch.',[tool(3,'call_test','run_test',13100,14800,{command:'npm test -- auth'},{passed:18,failed:1},'error')]),
    step(4,'Summarize findings',15600,null,'The tool results indicate an issuer mismatch rather than an expired token. I should report evidence and the recommended config change.','The authentication failures are caused by inconsistent JWT issuer configuration.')
  ]}]};
}
function bootstrap(){
  $('load').onclick=()=>connect($('session').value.trim());$('session').onkeydown=e=>{if(e.key==='Enter')connect(e.target.value.trim());};$('reload').onclick=()=>{if(window.TRACE_STUDIO_DEMO){state.trace=demoTrace();render();}else connect($('session').value.trim());};
  $('filter').oninput=e=>{state.search=e.target.value.toLowerCase().trim();renderNav();renderTimeline();};
  $('timelineTab').onclick=()=>switchMode('timeline');$('graphTab').onclick=()=>switchMode('graph');$('export').onclick=exportTrace;$('closeInspector').onclick=()=>document.querySelector('.inspector')?.classList.add('mobile-hidden');
  $('zoomIn').onclick=()=>{state.zoom=Math.min(1.7,+(state.zoom+.15).toFixed(2));renderGraph();};$('zoomOut').onclick=()=>{state.zoom=Math.max(.5,+(state.zoom-.15).toFixed(2));renderGraph();};$('fit').onclick=()=>{state.zoom=1;renderGraph();};
  document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('filter').focus();}});
  if(window.TRACE_STUDIO_DEMO){state.trace=demoTrace();state.selected='step:1:2';$('session').value=state.trace.sessionId;$('full').style.display='none';setConnection('online','Demo data');render();return;}
  const session=new URLSearchParams(location.search).get('session');if(session){connect(session);}else{$('full').href='/trace-studio/view';setConnection('offline','Choose a session');render();fetch('/trace-studio/api/sessions').then(r=>r.json()).then(data=>{if(data.sessions?.length)connect(data.sessions[0].sessionId);}).catch(()=>{});}
}
function switchMode(mode){state.mode=mode;$('timeline').classList.toggle('hidden',mode!=='timeline');$('graph').classList.toggle('hidden',mode!=='graph');$('timelineTab').classList.toggle('selected',mode==='timeline');$('graphTab').classList.toggle('selected',mode==='graph');if(mode==='graph')renderGraph();}
bootstrap();
