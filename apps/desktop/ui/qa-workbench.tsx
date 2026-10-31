/** Development-only fixture for the real App, imported exclusively by qa.html. */
import React, { useState } from 'react';
import type { PreviewTabMetadata, Notice, Request, Result, RunEvent, Snapshot, WorkbenchBridge } from '@wisp/core';
import { safeWebUrl } from './preview-model.js';
import { App } from './app.js';

export function fixture(approvalDelay = 1800, web = false, basic = ''): WorkbenchBridge & {inspectTabs():Promise<{tabId:string;title:string;kind:string}[]>;beginRead(tabId:string):Promise<void>} {
  const files = new Map([['notes.txt', '补充笔记：仅 QA 内存数据'], ['README.md', '# 内存文件预览样例\n\n仅供 QA；没有读取磁盘或授予真实文件权限。']]);
  let approvalPending = false, previewClaimed=false, setupActivation=false;
  let previewResolve: ((accepted:boolean)=>void)|undefined;
  const ticket='qa-preview-ticket';
  const listeners = new Set<(notice: Notice) => void>();
  const event = (id: string, runId: string, type: RunEvent['type'], data: Record<string, unknown>, sessionId='conversation-fixture'): RunEvent => ({ version: 1, id, sessionId, runId, type, at: '2026-10-31T00:00:00Z', data });
  const state: Snapshot = {
    sessions: [{id:'conversation-fixture',workspace:'/QA-memory-only',title:'整理研究资料（交互样例）',createdAt:'',updatedAt:'',activeRunId:'approval-fixture'},{id:'empty-fixture',title:'空白对话（样例）',createdAt:'',updatedAt:''}], selectedId:'conversation-fixture',
    keyPresent:false,browserConnected:false,config:{provider:'offline',model:'offline-test',baseUrl:''},
    events:[
      event('start-1','completed-fixture','started',{prompt:'帮我整理本周的研究笔记，并总结下一步。'}),
      event('answer-1','completed-fixture','assistant',{step:2,text:'## 本周进展\n\n这是一段**明确标注的组件测试内容**，不是模型生成结果。\n\n- 已整理资料与关键结论\n- 下一步：核对来源并补充实验\n\n行内公式 $a+b=c$。\n\n```typescript\nconst notes = ["观察", "结论"];\nconsole.log(notes);\n```\n\n[查看链接确认样例](https://example.com)\n\n'+Array.from({length:6},(_,i)=>`第 ${i+1} 段：长内容用于检查阅读宽度、滚动与复制操作。`).join('\n\n')}),
      event('plan-round-0','completed-fixture','assistant',{step:0,text:'组件样例：先浏览目录和阅读说明。'}),
      event('list-request','completed-fixture','tool_requested',{step:0,id:'list-fixture',name:'files_list',args:{path:''}}),
      event('list-result','completed-fixture','tool_result',{callId:'list-fixture',text:'README.md, notes.txt（内存样例）'}),
      event('read-request','completed-fixture','tool_requested',{step:0,id:'read-fixture',name:'files_read',args:{path:'README.md'}}),
      event('read-result','completed-fixture','tool_result',{callId:'read-fixture',text:'组件样例文本；未读取磁盘。'}),
      event('round-1','completed-fixture','assistant',{step:1,text:'组件样例：再读取补充笔记。'}),
      event('read-next','completed-fixture','tool_requested',{step:1,id:'next-fixture',name:'files_read',args:{path:'notes.txt'}}),
      event('next-result','completed-fixture','tool_result',{callId:'next-fixture',text:'内存补充笔记'}),
      event('done-1','completed-fixture','completed',{}),
      event('start-2','approval-fixture','started',{prompt:'把摘要保存为笔记。'}),
      event('answer-2','approval-fixture','assistant',{text:'以下为审批组件样例。批准或拒绝等待约 1.8 秒，仅改变页面内存，不会写入文件。刷新 QA 页面可重置后测试另一种决定。'}),
      event('request-2','approval-fixture','tool_requested',{id:'call-fixture',name:'files_write',args:{path:'summary.md',content:'# 测试摘要'}}),
      event('approval-2','approval-fixture','approval_requested',{id:'call-fixture',name:'files_write',description:'测试审批：不会执行真实文件操作。',args:{path:'summary.md',content:'# 测试摘要'}}),
    ],
  };
  if(web) for(const e of state.events.filter(e=>['tool_requested','approval_requested'].includes(e.type)&&e.runId==='approval-fixture')) { e.data.name='open_webpage';e.data.args={url:'https://example.com/'}; e.data.description='打开网页展示样例：批准后在右侧请求加载 example.com；不读取页面，可能受到嵌入限制。'; }
  const basicSamples:Record<string,{args:Record<string,unknown>;description:string}>= {
    mcp_install_npm:{args:{name:'QA 安装样例',package:'@fixture/server',version:'1.2.3',bin:'fixture',args:[]},description:'仅 QA 内存安装样例：不会联网下载或执行进程。\n来源：https://registry.npmjs.org（公共 registry 不代表包可信）\n包：@fixture/server@1.2.3；入口 fixture\n目录：/QA-memory-only/mcp-installs/example\n真实操作：npm 12+；禁用安装脚本，拒绝 git/URL/本地依赖。批准后安装并注册为禁用；激活另行确认。密钥只在设置填写。'},
    mcp_register:{args:{name:'QA 注册样例',command:'/QA-memory-only/node',args:['/QA-memory-only/server.mjs']},description:'仅 QA 注册样例，不写磁盘、不运行程序。真实注册仅保存已有 stdio 命令，保持禁用，不声称安装；激活另行确认。'},
    mcp_qa_echo:{args:{text:'仅 QA 内存参数'},description:'调用本地 MCP「QA 服务」的 echo。仅演示审批，不启动进程。第三方 MCP 使用系统权限，不受项目目录限制。'},
    files_replace:{args:{path:'notes.txt',oldText:'补充笔记：仅 QA 内存数据',newText:'修改后的 QA 内存笔记'},description:'定点修改 notes.txt（仅内存样例）\n--- 原内容\n补充笔记：仅 QA 内存数据\n+++ 新内容\n修改后的 QA 内存笔记\n真实工具批准后重新校验文件版本。'},
    files_mkdir:{args:{path:'new-folder'},description:'创建 new-folder（仅 QA 内存结果，不创建磁盘目录）'},
    files_move:{args:{path:'notes.txt',destination:'renamed.txt'},description:'移动 notes.txt → renamed.txt（仅 QA 内存映射）\n真实工具不覆盖已有目标；目录逐项移动可能部分完成。'},
    files_trash:{args:{path:'notes.txt'},description:'将 notes.txt 移入废纸篓（仅 QA 内存移除，不触及系统废纸篓）'},
  };
  if(basicSamples[basic]) for(const e of state.events.filter(e=>['tool_requested','approval_requested'].includes(e.type)&&e.runId==='approval-fixture')) {e.data.name=basic;if(basic==='mcp_qa_echo')e.data.source={serviceId:'qa-service',serviceName:'QA 服务',toolName:'echo'};e.data.args=basicSamples[basic].args;e.data.description=basicSamples[basic].description;}
  if(['mcp_install_npm','mcp_register'].includes(basic)){state.events.find(e=>e.id==='start-2')!.data.prompt='帮我根据说明配置这个 MCP（QA 内存样例）';for(const e of state.events.filter(e=>e.runId==='approval-fixture'))e.data.step=0;}
  state.events.splice(state.events.findIndex(e=>e.id==='done-1'),0,
    event('search-request','completed-fixture','tool_requested',{step:1,id:'search-fixture',name:'files_search',args:{path:'',query:'QA',mode:'content'}}),
    event('search-result','completed-fixture','tool_result',{callId:'search-fixture',text:JSON.stringify({matches:[{path:'notes.txt',line:1,snippet:'补充笔记：仅 QA 内存数据'}],truncated:false})}));
  // The final answer follows the tool rounds in the actual event sequence.
  const answerIndex=state.events.findIndex(e=>e.id==='answer-1');
  const [answer]=state.events.splice(answerIndex,1); state.events.splice(state.events.findIndex(e=>e.id==='done-1'),0,answer);
  const changed=()=>listeners.forEach(listener=>listener({type:'changed'}));
  if(basic==='read_webpage'){state.events=state.events.filter(e=>e.runId!=='approval-fixture');delete state.sessions[0].activeRunId;}
  let query:{ticket:string;sessionId:string;claimed:boolean;resolve(tabs:PreviewTabMetadata[]):void}|undefined;
  const identifiers=new Map<string,string>();let listedSession:string|undefined;let listed:({tabId:string}&PreviewTabMetadata)[]=[];
  const queryTabs=(sessionId=state.selectedId!)=>new Promise<PreviewTabMetadata[]>((resolve,reject)=>{
    if(sessionId!==state.selectedId){reject(new Error('会话已切换，请重新获取列表'));return;}
    if(query){reject(new Error('样例列表请求尚未完成'));return;}
    const id=crypto.randomUUID(),timer=setTimeout(()=>{query=undefined;reject(new Error('样例界面未响应'));},3000);
    query={ticket:id,sessionId,claimed:false,resolve:tabs=>{clearTimeout(timer);query=undefined;resolve(tabs);}};
    listeners.forEach(listener=>listener({type:'preview.tabs',sessionId,ticket:id}));
  });

  return {
    async inspectTabs(){
      const sessionId=state.selectedId!;const rows=await queryTabs(sessionId);
      if(state.selectedId!==sessionId)throw new Error('会话已切换，请重新获取列表');
      const listEvent=(id:string,runId:string,type:RunEvent['type'],data:Record<string,unknown>)=>event(id,runId,type,data,sessionId);
      listedSession=sessionId;listed=rows.map(tab=>{const key=JSON.stringify([sessionId,tab.id]);const id=identifiers.get(key)??crypto.randomUUID();identifiers.set(key,id);return {...tab,tabId:id};});
      const run=crypto.randomUUID();state.events.push(listEvent(crypto.randomUUID(),run,'started',{prompt:'QA：列出此会话实际打开的预览标签（仅内存）'}),listEvent(crypto.randomUUID(),run,'tool_requested',{id:'qa-list',name:'list_preview_tabs',args:{}}),listEvent(crypto.randomUUID(),run,'tool_result',{callId:'qa-list',text:JSON.stringify({tabs:listed.map(({id,revision,url,...tab})=>{const safe=url&&safeWebUrl(url);if(safe){const value=new URL(safe);value.search='';value.hash='';return {...tab,url:value.href};}return tab;}),message:'仅 QA 内存标签元数据；没有读取真实网页'})}),listEvent(crypto.randomUUID(),run,'completed',{}));changed();
      return listed.map(({tabId,title,kind})=>({tabId,title,kind}));
    },
    async beginRead(tabId){
      if(listedSession!==state.selectedId)throw new Error('先获取此会话的标签列表');
      const tab=listed.find(t=>t.tabId===tabId);if(!tab||tab.kind!=='web')throw new Error('先获取列表并选择网页');
      const now=(await queryTabs()).find(t=>t.id===tab.id);if(!now||now.kind!==tab.kind||now.url!==tab.url||now.revision!==tab.revision)throw new Error('标签已关闭或变化，请重新获取列表');
      if(state.selectedId!=='conversation-fixture')throw new Error('切回样例会话后重新获取列表');
      if(state.sessions[0].activeRunId)throw new Error('样例任务尚未结束');
      const run=crypto.randomUUID();state.sessions[0].activeRunId=run;
      state.events.push(event(crypto.randomUUID(),run,'started',{prompt:'QA：直接读取指定网页（仅模拟正文，无需审批）'}),event(crypto.randomUUID(),run,'tool_requested',{id:'call-fixture',name:'read_webpage',args:{tabId}}),event(crypto.randomUUID(),run,'tool_started',{callId:'call-fixture',name:'read_webpage'}));changed();
      await new Promise(resolve=>setTimeout(resolve,approvalDelay));
      if(state.sessions[0].activeRunId!==run)return;
      const latest=(await queryTabs()).find(t=>t.id===tab.id);
      if(state.sessions[0].activeRunId!==run)return;
      const stale=state.selectedId!=='conversation-fixture'||!latest||latest.kind!==tab.kind||latest.url!==tab.url||latest.revision!==tab.revision;
      state.events.push(event(crypto.randomUUID(),run,'tool_result',{callId:'call-fixture',isError:stale,text:stale?'标签或会话已变化，请重新获取列表':JSON.stringify({source:'untrusted_webpage',text:'仅 QA 内存文章正文，没有读取真实页面',links:[],truncated:false})}),event(crypto.randomUUID(),run,'completed',{}));delete state.sessions[0].activeRunId;changed();

    },
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    async request(input:Request):Promise<Result>{
      if(input.type==='preview.tabs.claim'){if(!query||query.claimed||query.ticket!==input.ticket||input.sessionId!==state.selectedId||input.sessionId!==query.sessionId)throw new Error('样例列表票据已失效');query.claimed=true;return{};}
      if(input.type==='preview.tabs.complete'){if(!query?.claimed||query.ticket!==input.ticket||input.sessionId!==state.selectedId||input.sessionId!==query.sessionId)throw new Error('样例列表票据已失效');query.resolve(input.tabs);return{};}
      if(input.type==='snapshot')return{snapshot:structuredClone(state)};
      // Explicit UI-only MCP fixture: never spawns a process or stores env values.
      if(input.type==='mcp.save'){
        const id=input.id??crypto.randomUUID(),item={...input.config,id,envNames:input.env?Object.keys(input.env):state.mcpServers?.find(s=>s.id===id)?.envNames??[],envStorage:(input.env===undefined?state.mcpServers?.find(s=>s.id===id)?.envStorage??'none':Object.keys(input.env).length?(input.rememberEnv?'secure':'session'):'none') as 'secure'|'session'|'none',state:'disabled' as const,tools:[],message:'QA 内存配置；没有启动进程或保存凭据'};
        state.mcpServers=[...(state.mcpServers??[]).filter(s=>s.id!==id),item];changed();return{};
      }
      if(input.type==='mcp.activate'||input.type==='mcp.disable'||input.type==='mcp.delete'||input.type==='mcp.refresh'){
        const item=state.mcpServers?.find(s=>s.id===input.id);if(!item)throw new Error('QA 样例服务不存在');
        if(input.type==='mcp.delete')state.mcpServers=state.mcpServers?.filter(s=>s.id!==input.id);
        else if(input.type==='mcp.activate'){
          item.state='connecting';changed();await new Promise(resolve=>setTimeout(resolve,900));
          if(item.state!=='connecting')return{};
          item.state=item.command==='fail'?'failed':'connected';item.message=item.state==='failed'?'QA 模拟启动失败，没有真实进程':'QA 模拟连接；未启动真实 MCP';
          item.tools=item.state==='connected'?[{name:'mcp_qa_echo',remoteName:'echo',description:'QA 工具展示，没有执行实现'}]:[];
        }else if(input.type==='mcp.disable'){item.state='disabled';item.tools=[];item.message='QA 模拟已禁用';}
        changed();return{};
      }

      if(input.type==='session.select'){state.selectedId=input.sessionId;changed();return{};}
      if(input.type==='preview.claim'){if(!previewResolve||previewClaimed||input.ticket!==ticket||input.sessionId!==state.selectedId)throw new Error('样例请求已失效');previewClaimed=true;return{preview:{ticket,url:'https://example.com/'}};}
      if(input.type==='preview.complete'){if(!previewResolve||!previewClaimed||input.ticket!==ticket)throw new Error('样例请求已失效');const done=previewResolve;previewResolve=undefined;done(input.accepted);return{};}
      if(input.type==='files.read' || input.type==='files.list') {
        if(input.sessionId !== 'conversation-fixture') throw new Error('QA 会话没有内存目录权限');
        if(input.type==='files.list') {
          if(input.path) throw new Error('QA 仅提供内存根目录');
          return {entries:[...files].map(([path,text])=>({path,name:path,kind:'file',size:new TextEncoder().encode(text).length}))};
        }
        const text=files.get(input.path); if(text===undefined) throw new Error('此内存样例文件不存在；未访问磁盘');
        return {file:{path:input.path,kind:input.path.endsWith('.md')?'markdown':'text',text,size:new TextEncoder().encode(text).length}};
      }
      if(input.type==='run.cancel'){
        if(input.sessionId!=='conversation-fixture'||input.runId!==state.sessions[0].activeRunId) throw new Error('没有匹配的样例任务');
        state.events.push(event(crypto.randomUUID(),input.runId,'cancelled',{reason:'样例已取消；未执行真实操作'})); delete state.sessions[0].activeRunId;changed();return{};
      }
      if(input.type==='run.approve'){
        if(basic==='read_webpage'||input.sessionId!=='conversation-fixture'||input.runId!==state.sessions[0].activeRunId||input.callId!==(setupActivation?'activation-fixture':'call-fixture')||approvalPending) throw new Error('没有匹配的待审批样例');
        approvalPending=true;
        await new Promise(resolve=>setTimeout(resolve,approvalDelay));
        if(!state.sessions[0].activeRunId) return{};
        if(['mcp_install_npm','mcp_register'].includes(basic)){
          const callId=setupActivation?'activation-fixture':'call-fixture',name=setupActivation?'mcp_activate_service':basic,step=setupActivation?1:0;
          state.events.push(event(crypto.randomUUID(),'approval-fixture','approval_resolved',{step,callId,allowed:input.allowed}));
          if(input.allowed&&!setupActivation){
            state.mcpServers=[{id:'qa-setup-service',name:'QA 对话配置',command:'/QA-memory-only/node',args:['/QA-memory-only/server.mjs'],state:'disabled',envNames:[],envStorage:'none',tools:[],message:'仅 QA 内存配置；没有安装软件或启动进程'}];
            state.events.push(event(crypto.randomUUID(),'approval-fixture','tool_result',{step,callId,name,text:JSON.stringify({simulated:true,id:'qa-setup-service',state:'disabled',installed:basic==='mcp_install_npm',message:'仅内存模拟；没有实际安装或注册。下一步需要单独批准激活。'})}));
            state.events.push(event(crypto.randomUUID(),'approval-fixture','assistant',{step:1,text:'QA 内存样例：配置保持禁用。下面单独演示激活审批；如服务需要密钥，应只在设置的环境变量表单填写。'}));
            state.events.push(event(crypto.randomUUID(),'approval-fixture','tool_requested',{step:1,id:'activation-fixture',name:'mcp_activate_service',args:{id:'qa-setup-service'}}));
            state.events.push(event(crypto.randomUUID(),'approval-fixture','approval_requested',{step:1,id:'activation-fixture',name:'mcp_activate_service',args:{id:'qa-setup-service'},description:'仅 QA 模拟激活，不执行进程。真实操作会启动已确认的本地命令并检查协议与工具列表；第三方程序拥有本机权限，不受项目目录约束。'}));
            setupActivation=true;approvalPending=false;changed();return{};
          }
          if(input.allowed&&state.mcpServers?.[0]){state.mcpServers[0].state='connected';state.mcpServers[0].tools=[{name:'mcp_qa_echo',remoteName:'echo',description:'仅 QA 内存工具'}];}
          state.events.push(event(crypto.randomUUID(),'approval-fixture','tool_result',{step,callId,name,denied:!input.allowed,text:input.allowed?'仅 QA 激活样例：模拟发现 echo，没有启动或调用服务':'已拒绝；此阶段没有执行，已注册的配置仍保持禁用。'}));
          state.events.push(event(crypto.randomUUID(),'approval-fixture','completed',{}));delete state.sessions[0].activeRunId;changed();return{};
        }
        let received=false;
        if(web&&input.allowed) received=await new Promise<boolean>(resolve=>{const timer=setTimeout(()=>{previewResolve=undefined;resolve(false);},5000);previewResolve=accepted=>{clearTimeout(timer);resolve(accepted);};listeners.forEach(listener=>listener({type:'preview.open',ticket,sessionId:'conversation-fixture'}));});
        if(!state.sessions[0].activeRunId)return{};
        if(input.allowed&&basic==='files_replace')files.set('notes.txt','修改后的 QA 内存笔记');
        if(input.allowed&&basic==='files_move'){files.set('renamed.txt',files.get('notes.txt')!);files.delete('notes.txt');}
        if(input.allowed&&basic==='files_trash')files.delete('notes.txt');
        if(input.allowed&&!web&&!basic) files.set('summary.md','# 内存摘要样例\n\n审批仅改变 QA 内存；没有写入磁盘。');
        state.events.push(event(crypto.randomUUID(),'approval-fixture','approval_resolved',{callId:'call-fixture',allowed:input.allowed}));
        state.events.push(event(crypto.randomUUID(),'approval-fixture','tool_result',{callId:'call-fixture',denied:!input.allowed,isError:web&&input.allowed&&!received,text:!input.allowed?'已拒绝；没有打开或写入':web?(received?'标签打开请求已接收；未读取网页，加载状态请查看右侧':'界面未确认打开请求'):basic==='mcp_qa_echo'?'仅 QA MCP 结果样例；未启动进程、未调用真实工具':basic==='files_mkdir'?'仅 QA 创建目录结果样例；未创建磁盘目录':'内存样例已更新；没有写入磁盘'}));
        state.events.push(event(crypto.randomUUID(),'approval-fixture','completed',{}));delete state.sessions[0].activeRunId;changed();return{};
      }
      if(input.type==='model.list')return{models:[{id:'offline-test',name:'离线验证（开发）'}]};
      if(input.type==='model.save'){state.config={...input.config};changed();return{};}
      throw new Error('此工作台为开发样例：不连接 Host、模型或真实文件，请返回组件样例检查项目与文件交互。');
    },
  };
}
export function QAWorkbench({web=false,basic=''}:{web?:boolean;basic?:string}){
 const[bridge]=useState(()=>fixture(1800,web,basic)),[tabs,setTabs]=useState<{tabId:string;title:string;kind:string}[]>([]),[chosen,choose]=useState(''),[message,setMessage]=useState(''),[pending,setPending]=useState(false);
 const perform=async(task:()=>Promise<void>)=>{if(pending)return;setPending(true);setMessage('');try{await task();}catch(e){setMessage(String(e));}finally{setPending(false);}};
 return <div className="qa-tool-workbench">{basic==='read_webpage'&&<div className="qa-banner"><p>两步网页工具 · 内存测试：先在右侧打开网页/文件/新标签，再获取实时列表。正文直接读取无需审批，只返回静态样例，不提取 iframe。</p><button disabled={pending} onClick={()=>void perform(async()=>{const result=await bridge.inspectTabs();setTabs(result);choose(result.find(t=>t.kind==='web')?.tabId??'');})}>获取当前标签列表（内存测试）</button><select aria-label="指定列表中的网页" value={chosen} onChange={e=>choose(e.target.value)}><option value="">选择网页标签</option>{tabs.filter(t=>t.kind==='web').map(t=><option key={t.tabId} value={t.tabId}>{t.title} · {t.tabId.slice(0,8)}</option>)}</select><button disabled={pending||!chosen} onClick={()=>void perform(()=>bridge.beginRead(chosen))}>请求读取指定网页（模拟正文）</button><span role="status">{message||`列表共 ${tabs.length} 个标签`}</span></div>}<App initialClient={bridge}/></div>;
}
