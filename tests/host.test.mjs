import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../lib/index.js';

function mockHost() {
  const routes = new Map();
  const listeners = new Map();
  const disposers=[];
  const ctx={
    webServer:{register({path,handler}){routes.set(path,handler);return()=>routes.delete(path);}},
    on(name,handler){listeners.set(name,handler);return()=>listeners.delete(name);},
    effect(callback){disposers.push(callback());},
    get(){return undefined;},
  };
  apply(ctx);
  return {routes,listeners,disposers};
}
function response(){
  return { status:0,head:null,body:'',writeHead(s,h){this.status=s;this.head=h;},write(s){this.body+=s;},end(s=''){this.body+=s;} };
}

test('registers expected read-only viewer and trace routes', async()=>{
  const {routes,listeners,disposers}=mockHost();
  for(const route of ['/trace-studio/sidebar','/trace-studio/sidebar.js','/trace-studio/sidebar.css','/trace-studio/view','/trace-studio/viewer.js','/trace-studio/viewer.css','/trace-studio/api/trace','/trace-studio/api/sessions','/trace-studio/api/stream']) assert.ok(routes.has(route));
  assert.ok(listeners.has('session/event'));assert.ok(listeners.has('agent/assistant-stream'));
  const view=response();await routes.get('/trace-studio/view')({url:'/trace-studio/view'},view);
  assert.equal(view.status,200);assert.match(view.body,/Trace Studio/);
  const sidebar=response();await routes.get('/trace-studio/sidebar')({url:'/trace-studio/sidebar'},sidebar);
  assert.equal(sidebar.status,200);assert.match(sidebar.body,/Agent trace/);
  assert.match(sidebar.body,/Full trace/);
  const script=response();await routes.get('/trace-studio/sidebar.js')({url:'/trace-studio/sidebar.js'},script);
  assert.match(script.body,/expandedTools/);
  const req={url:'/trace-studio/api/trace?session=session123'};const res=response();
  listeners.get('session/event')({id:'session123'},{type:'turn/start',data:{turn:1},time:1000});
  listeners.get('session/event')({id:'session123'},{type:'step/start',data:{turn:1,step:1},time:1100});
  await routes.get('/trace-studio/api/trace')(req,res);
  assert.equal(res.status,200);
  const trace=JSON.parse(res.body);
  assert.equal(trace.sessionId,'session123');assert.equal(trace.turns[0].steps[0].startedAt,1100);
  const bad=response();await routes.get('/trace-studio/api/trace')({url:'/trace-studio/api/trace'},bad);
  assert.equal(bad.status,400);
  disposers.forEach(d=>typeof d==='function'&&d());
});
