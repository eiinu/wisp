// Renderer data work only: excludes Host, IPC serialization and DOM/layout time.
import {buildSync} from 'esbuild';
const bundled=buildSync({entryPoints:['apps/desktop/ui/history.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {mergeHistory,historyTurns,indexSessions}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const events=Array.from({length:25000},(_,i)=>({version:1,id:`e${i}`,sessionId:'s',runId:`r${Math.floor(i/50)}`,at:'',type:'assistant_delta',data:{step:0,text:'fragment '}}));
const oldMerge=()=>[...new Map([...events,...events.filter(e=>!events.some(n=>n.id===e.id))].map(e=>[e.id,e])).values()];
const measure=fn=>{const times=[];for(let i=0;i<3;i++){const start=performance.now();fn();times.push(performance.now()-start);}return times.sort((a,b)=>a-b)[1];};
console.log(JSON.stringify({events:events.length,turns:500,medianOf:3,baselineMergeMs:measure(oldMerge),mergeMs:measure(()=>mergeHistory(events,events)),indexAndGroupMs:measure(()=>historyTurns(indexSessions(events).get('s')))},null,2));
