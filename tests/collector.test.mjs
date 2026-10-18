import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, applySessionEvent, applyStreamFrame, project, safeValue, redact } from '../lib/collector.js';

const ev=(type,data={},time=1000)=>({type,data,time});
function make(){const trace=createSession('s1');applySessionEvent(trace,ev('turn/start',{turn:1}));return trace;}

test('DSH event projection preserves turn/step and tool lineage',()=>{
  const t=make();
  applySessionEvent(t,ev('user/message',{source:{kind:'user'},content:[{type:'text',text:'Why did auth fail?'}]}));
  applySessionEvent(t,ev('step/start',{turn:1,step:1},1100));
  applySessionEvent(t,ev('assistant/message',{turn:1,step:1,message:{model:'deepseek-reasoner',usage:{input_tokens:100},content:[{type:'reasoning',text:'Check logs'},{type:'text',text:'Reading logs'}]}},1200));
  applySessionEvent(t,ev('tool/call',{turn:1,step:1,callId:'call1',name:'read_file',arguments:'{"path":"auth.ts"}'},1300));
  applySessionEvent(t,ev('tool/result',{turn:1,step:1,message:{source:{callId:'call1'},content:[{type:'text',text:'file output'}]}},1400));
  applySessionEvent(t,ev('step/end',{turn:1,step:1},1500));
  applySessionEvent(t,ev('turn/end',{turn:1,reason:{kind:'completed'}},1500));
  const out=project(t);const step=out.turns[0].steps[0];
  assert.equal(out.turns[0].title,'Why did auth fail?');
  assert.equal(out.turns[0].endReason,'completed');
  assert.equal(step.reasoning,'Check logs');
  assert.equal(step.model,'deepseek-reasoner');
  assert.equal(step.status,'success');
  assert.equal(step.startedAt,1100);assert.equal(step.endedAt,1500);
  assert.equal(step.tools[0].callId,'call1');assert.equal(step.tools[0].status,'success');
  assert.match(step.tools[0].output,/file output/);
  assert.match(step.usage,/input_tokens/);
});

test('model stream can be assembled and durable assistant message overwrites stream',()=>{
  const t=make();
  assert.equal(applyStreamFrame(t,{type:'start',attemptId:'a1',turn:1,step:1}),true);
  applyStreamFrame(t,{type:'chunk',attemptId:'a1',chunk:{type:'reasoning-delta',text:'Investigate '}});
  applyStreamFrame(t,{type:'chunk',attemptId:'a1',chunk:{type:'reasoning-delta',text:'issue.'}});
  assert.equal(t.turns[0].steps[0].reasoning,'Investigate issue.');
  applySessionEvent(t,ev('assistant/message',{turn:1,step:1,message:{content:[{type:'reasoning',text:'Final attempt reasoning'}]}}));
  assert.equal(t.turns[0].steps[0].reasoning,'Final attempt reasoning');
});

test('tool errors use authoritative isError boolean not error-looking text',()=>{
  const t=make();
  applySessionEvent(t,ev('tool/call',{turn:1,step:1,callId:'bad',name:'bash',arguments:'{}'}));
  applySessionEvent(t,ev('tool/result',{turn:1,step:1,message:{source:{callId:'bad'},isError:true,content:[{type:'text',text:'denied'}]},error:{code:'DENIED'}}));
  applySessionEvent(t,ev('step/end',{turn:1,step:1}));
  assert.equal(t.turns[0].steps[0].status,'error');
  assert.equal(t.turns[0].steps[0].tools[0].status,'error');
  assert.match(t.turns[0].steps[0].tools[0].error,/DENIED/);
});

test('duplicate tool calls are idempotent; wrong turn inputs are ignored',()=>{
  const t=make();assert.equal(applySessionEvent(t,ev('tool/call',{turn:1,step:1,callId:'1',name:'shell',arguments:'{}'})),true);
  assert.equal(applySessionEvent(t,ev('tool/call',{turn:1,step:1,callId:'1',name:'shell',arguments:'{}'})),false);
  assert.equal(t.turns[0].steps[0].tools.length,1);
  assert.equal(applySessionEvent(t,ev('step/start',{step:2})),false);
});

test('sensitive credentials are redacted from visible values',()=>{
  assert.doesNotMatch(redact('Authorization: Bearer abc.def.ghi'),/abc\.def\.ghi/);
  assert.doesNotMatch(safeValue({ api_key:'secret-123',password:'hunter2',path:'/tmp'}),/hunter2|secret-123/);
  assert.match(safeValue({ api_key:'secret-123' }),/REDACTED/);
});

test('content is bounded and no available reasoning is treated as missing',()=>{
  const t=make();applySessionEvent(t,ev('assistant/message',{turn:1,step:1,message:{content:[{type:'text',text:'a'.repeat(300)}]}}),80);
  assert.ok(t.turns[0].steps[0].output.length<=120);
  assert.equal(t.turns[0].steps[0].reasoning,'');
});
