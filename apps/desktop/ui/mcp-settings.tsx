import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {McpConfig, McpServerInfo, Request, Result} from '@wisp/core';
import {WorkspaceIcon} from './workspace-icon.js';
import './mcp-settings.css';
const blank:McpConfig={name:'',command:'',args:[]};
const stateNames={disabled:'已禁用',connecting:'正在连接',connected:'已激活',failed:'连接失败'};
export function McpSettings({servers,connected,request,onDirty}:{servers:McpServerInfo[];connected:boolean;request(input:Request):Promise<Result>;onDirty(dirty:boolean):void}){
 const [draft,setDraft]=useState<McpConfig|null>(null),[id,setId]=useState<string>(),[args,setArgs]=useState('[]');
 const [variables,setVariables]=useState<{name:string;value:string}[]>([]),[replace,setReplace]=useState(false),[remember,setRemember]=useState(true);
 const [pending,setPending]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState(''),[confirm,setConfirm]=useState<{id:string;action:'activate'|'delete'}>();
 const lock=useRef(false),heading=useRef<HTMLHeadingElement>(null),add=useRef<HTMLButtonElement>(null),generation=useRef(0);
 const confirmation=useRef<HTMLDivElement>(null),confirmationTrigger=useRef<HTMLButtonElement|null>(null),restoreConfirmation=useRef(false);
 useLayoutEffect(()=>{
  if(confirm||!restoreConfirmation.current)return;
  restoreConfirmation.current=false;const trigger=confirmationTrigger.current;
  if(trigger?.isConnected&&!trigger.disabled&&!trigger.closest('[hidden],[inert]')&&(document.activeElement===document.body||document.activeElement===document.documentElement))trigger.focus();
 },[confirm]);
 const cancelConfirmation=()=>{restoreConfirmation.current=!!confirmation.current?.contains(document.activeElement);setConfirm(undefined);};
 useEffect(()=>{onDirty(!!draft);},[draft,onDirty]);
 const edit=(server?:McpServerInfo)=>{setId(server?.id);setDraft(server?{name:server.name,command:server.command,args:server.args,cwd:server.cwd}:{...blank});setArgs(JSON.stringify(server?.args??[],null,2));setVariables([]);setReplace(!server);setRemember(server?.envStorage!=='session');setError('');setStatus('');setConfirm(undefined);};
 const reset=()=>{setDraft(null);setVariables([]);setError('');setTimeout(()=>add.current?.focus(),0);};
 const task=async(work:()=>Promise<void>)=>{if(lock.current)return;lock.current=true;setPending(true);setError('');setStatus('');try{await work();}catch(e){setError(e instanceof Error?e.message:'MCP 操作失败');}finally{lock.current=false;setPending(false);}};
 const selected=servers.find(server=>server.id===id);
 const save=async()=>{if(!draft||!connected)return;let parsed:unknown;try{parsed=JSON.parse(args);}catch{throw new Error('参数须为 JSON 字符串数组，例如 ["/path/server.js"]');}if(!Array.isArray(parsed)||!parsed.every(value=>typeof value==='string'))throw new Error('每个参数必须是字符串');
  const names=variables.map(row=>row.name);if(new Set(names).size!==names.length)throw new Error('环境变量名称不能重复');
  try{await request({type:'mcp.save',id,config:{...draft,args:parsed,cwd:draft.cwd?.trim()||undefined},...(replace?{env:Object.fromEntries(variables.map(row=>[row.name,row.value]))}:{}),rememberEnv:remember});reset();setStatus('配置已保存，服务保持禁用。确认信任后再激活。');}finally{setVariables(current=>current.map(row=>({...row,value:''})));}
 };
 return <section className="mcp-settings" aria-label="本地 MCP 管理">
  <p className="settings-note">添加你已安装的 stdio MCP 服务。激活会在本机运行指定命令，拥有你的系统权限，<strong>不受项目目录授权限制</strong>。仅添加你信任的服务；工具调用仍逐次审批。Wisp 不内置 MCP 服务。</p>
  <p className="settings-note">也可以在对话中提供 MCP 安装说明，让助手整理方案。你批准后，Wisp 可注册已有服务或安装指定版本的公共 npm 包，再单独确认激活。密钥请仅在下方编辑服务的环境变量中填写，不要发到聊天。</p>
  {!connected&&<p role="status">本机服务未连接，连接后可管理 MCP。</p>}
  <div className="mcp-heading"><h3>服务</h3><button ref={add} disabled={!connected||pending||!!draft} onClick={()=>edit()}><WorkspaceIcon name="plus"/>添加本地 MCP</button></div>
  {!servers.length&&!draft&&<p className="settings-note">尚未添加服务。配置默认禁用，重启后也需要手动激活。</p>}
  <div className="settings-group">{servers.map(server=><article className="mcp-service" key={server.id}>
   <div className="mcp-heading"><strong title={server.name}>{server.name}</strong><span>{stateNames[server.state]}</span></div>
   <p className="settings-note">{server.message??'未启动进程'} · {server.tools.length} 个工具</p>
   <p className="settings-note">环境变量：{server.envNames.length?`${server.envNames.join('、')} · ${server.envStorage==='secure'?'系统安全存储':'仅本次会话'}`:'无'}</p>
   <div className="mcp-actions">
    {server.state==='connected'||server.state==='connecting'?<button disabled={!connected} onClick={()=>{const current=++generation.current;void request({type:'mcp.disable',id:server.id}).then(()=>{if(current===generation.current)setStatus('服务已禁用；已请求停止进行中的调用，不能撤销已发生的副作用。');},()=>setError('禁用失败，请刷新状态确认'));}}>禁用 {server.name}</button>:<button disabled={!connected||pending||!!draft} onClick={event=>{confirmationTrigger.current=event.currentTarget;setConfirm({id:server.id,action:'activate'});}}>激活 {server.name}</button>}
    <button disabled={!connected||pending||!!draft} onClick={()=>edit(server)}>编辑 {server.name}</button><button disabled={!connected||pending||!!draft} onClick={event=>{confirmationTrigger.current=event.currentTarget;setConfirm({id:server.id,action:'delete'});}}>删除 {server.name}</button>
    {server.state==='connected'&&<button disabled={pending||!connected} onClick={()=>void task(async()=>{await request({type:'mcp.refresh',id:server.id});setStatus('工具列表已刷新');})}>刷新工具</button>}
   </div>
   {!!server.tools.length&&<details><summary>工具列表 · {server.tools.length}</summary><ul>{server.tools.map(tool=><li key={tool.name}><strong>{tool.remoteName}</strong><p>{tool.description}</p><code>{tool.name}</code></li>)}</ul></details>}
   {confirm?.id===server.id&&<div ref={confirmation} className="mcp-confirm" onKeyDown={event=>{if(event.key==='Escape'&&!pending){event.preventDefault();event.stopPropagation();cancelConfirmation();}}} role="region" aria-label={confirm.action==='activate'?'确认运行本地服务':'确认删除配置'}>
    {confirm.action==='activate'?<><p>确认信任并运行以下本机命令？这是进程启动授权，不是项目目录沙箱。</p><pre>{JSON.stringify({command:server.command,args:server.args,cwd:server.cwd??'用户主目录'},null,2)}</pre></>:<p>删除「{server.name}」配置和保存的环境变量，并停止服务。不会删除服务程序或你的项目文件。</p>}
    <div className="mcp-actions"><button autoFocus disabled={pending} onClick={cancelConfirmation}>取消</button><button disabled={pending||!connected} onClick={()=>void task(async()=>{const action=confirm.action;setConfirm(undefined);await request(action==='activate'?{type:'mcp.activate',id:server.id,confirmed:true}:{type:'mcp.delete',id:server.id});setStatus(action==='activate'?'连接操作已结束，请查看服务状态':'配置已删除');})}>{confirm.action==='activate'?'信任并激活':'确认删除'}</button></div>
   </div>}
  </article>)}</div>
  {draft&&<form onSubmit={event=>{event.preventDefault();void task(save);}}>
   <h3 ref={heading} tabIndex={-1}>{id?'编辑服务':'添加服务'}</h3><fieldset disabled={pending||!connected}>
    <div className="settings-group">
     <label className="settings-row"><span>名称</span><input autoFocus required maxLength={80} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
     <label className="settings-row"><span>可执行文件<small>程序名或绝对路径，不是整段 shell 命令</small></span><input required maxLength={4096} placeholder="例如 node" value={draft.command} onChange={e=>setDraft({...draft,command:e.target.value})}/></label>
     <label className="mcp-field">参数（JSON 数组）<textarea rows={3} value={args} onChange={e=>setArgs(e.target.value)} spellCheck={false}/></label>
     <label className="settings-row"><span>工作目录<small>可选，绝对路径；留空使用用户主目录</small></span><input maxLength={4096} value={draft.cwd??''} onChange={e=>setDraft({...draft,cwd:e.target.value})}/></label>
    </div>
    <h3>环境变量</h3><p className="settings-note">敏感值仅通过此处输入，不要放在命令或参数中。已保存的值不回显；保存后清空本次输入。</p>
    {id&&<label className="mcp-check"><input type="checkbox" checked={replace} onChange={e=>setReplace(e.target.checked)}/>替换全部环境变量（空列表表示清除；不勾选则保留）</label>}
    {!replace&&selected&&<p className="settings-note">保留变量：{selected.envNames.join('、')||'无'}。更换命令或参数时，须重新填写或清除变量。</p>}
    {replace&&<><div className="mcp-variables">{variables.map((row,index)=><div className="mcp-variable" key={index}>
      <input aria-label={`变量 ${index+1} 名称`} required pattern="[A-Za-z_][A-Za-z0-9_]*" maxLength={128} value={row.name} onChange={e=>setVariables(variables.map((r,i)=>i===index?{...r,name:e.target.value}:r))}/>
      <input aria-label={`变量 ${index+1} 值`} type="password" autoComplete="off" maxLength={8192} value={row.value} onChange={e=>setVariables(variables.map((r,i)=>i===index?{...r,value:e.target.value}:r))}/>
      <button type="button" aria-label={`移除变量 ${index+1}`} onClick={()=>setVariables(variables.filter((_,i)=>i!==index))}><WorkspaceIcon name="close"/></button>
    </div>)}</div><button type="button" disabled={variables.length>=64} onClick={()=>setVariables([...variables,{name:'',value:''}])}>添加环境变量</button>
    <label className="mcp-check"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/>使用系统安全存储；取消勾选则仅本次会话保存</label><p className="settings-note">安全存储失败会报错，不会自动明文保存。服务配置保存在本机；重启不自动运行。</p></>}
   </fieldset>
   <div className="mcp-actions"><button type="button" disabled={pending} onClick={reset}>取消编辑</button><button className="primary" disabled={pending||!connected}>保存配置</button></div>
  </form>}
  <div className="settings-feedback" aria-live="polite" aria-atomic="true">{pending?<p role="status">正在处理…</p>:error?<p role="alert" className="error">{error}</p>:status?<p role="status">{status}</p>:null}</div>
 </section>;
}
