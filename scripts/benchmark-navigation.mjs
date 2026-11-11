// Synthetic data work, separate from real IPC, DOM/layout and user disk latency.
import {buildSync} from 'esbuild';
const contents=['tool-index','session-index','event-batch'].map(name=>`export * from './apps/desktop/ui/${name}.ts';`).join('\n')+"\nexport * from './apps/host/src/interrupted-runs.ts';";
const output=buildSync({stdin:{contents,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {indexToolRound,indexSessionList,applyEventBatch,interruptedStarts}=await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const measure=fn=>{const times=[];for(let i=0;i<3;i++){const start=performance.now();fn();times.push(performance.now()-start);}return +times.sort((a,b)=>a-b)[1].toFixed(2);};
const event=(id,type='assistant_delta',data={text:id})=>({version:1,id,runId:'run',sessionId:'s',at:'',type,data});
const tools=Array.from({length:2000},(_,i)=>[event(`call-${i}`,'tool_requested',{id:`c${i}`}),event(`start-${i}`,'tool_started',{callId:`c${i}`}),event(`result-${i}`,'tool_result',{callId:`c${i}`})]).flat();
const oldTools=()=>{for(const call of tools.filter(e=>e.type==='tool_requested')){const id=call.data.id;tools.find(e=>e.type==='tool_result'&&e.data.callId===id);tools.some(e=>e.type==='tool_started'&&e.data.callId===id);tools.some(e=>e.type==='approval_requested'&&e.data.id===id);tools.some(e=>e.type==='question_requested'&&e.data.callId===id);}};
const indexedTools=()=>{const index=indexToolRound(tools);for(const call of tools.filter(e=>e.type==='tool_requested')){const id=call.data.id;index.results.get(id);index.started.has(id);index.approvals.has(id);index.questions.has(id);}};
const projects=Array.from({length:500},(_,i)=>({id:`p${i}`,name:`Project ${i}`})),sessions=Array.from({length:25000},(_,i)=>({id:`s${i}`,title:'Session',projectId:`p${i%500}`}));
const events=Array.from({length:25000},(_,i)=>event(`e${i}`)),burst=Array.from({length:1000},(_,i)=>event(`delta${i}`));
const snapshot={events,sessions:[{id:'s',title:'Session',createdAt:'',updatedAt:''}],keyPresent:false,browserConnected:false};
const oldBurst=()=>{let s=snapshot;for(const e of burst)s={...s,events:s.events.some(old=>old.id===e.id)?s.events:[...s.events,e],sessions:s.sessions.map(session=>session.id!==e.sessionId?session:{...session,updatedAt:e.at,activeRunId:e.type==='started'&&!e.parentRunId?e.runId:session.activeRunId})};return s;};
const recovery=Array.from({length:5000},(_,i)=>[event(`start${i}`,'started'),event(`delta${i}`),event(`done${i}`,'completed')].map(e=>({...e,runId:`r${i}`}))).flat();
const oldRecovery=()=>recovery.filter(e=>e.type==='started').filter(start=>!recovery.some(e=>e.runId===start.runId&&['completed','cancelled','failed'].includes(e.type)));
console.log(JSON.stringify({medianOf:3,toolCalls:2000,toolCorrelationMs:{before:measure(oldTools),after:measure(indexedTools)},projects:500,sessions:25000,sessionGroupingMs:{before:measure(()=>projects.map(p=>sessions.filter(s=>s.projectId===p.id))),after:measure(()=>indexSessionList(sessions,projects))},history:25000,burst:1000,burstUpdateMs:{before:measure(oldBurst),after:measure(()=>applyEventBatch(snapshot,burst))},completedRuns:5000,recoveryScanMs:{before:measure(oldRecovery),after:measure(()=>interruptedStarts(recovery))}},null,2));
