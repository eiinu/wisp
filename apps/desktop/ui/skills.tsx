import React,{useRef,useState} from 'react';
import type {Request,Result,SkillInfo,RunEvent} from '@wisp/core';
import './skills.css';
export function SkillSettings({skills,connected,request,chooseDirectory=()=>window.wisp?.chooseDirectory?.()??Promise.reject(new Error('目录选择仅在桌面端可用；Web 只用于 UI 验证'))}:{skills:SkillInfo[];connected:boolean;request(input:Request):Promise<Result>;chooseDirectory?:()=>Promise<string|undefined>}){
 const [error,setError]=useState(''),[status,setStatus]=useState(''),[pending,setPending]=useState(false),lock=useRef(false),mounted=useRef(true),addButton=useRef<HTMLButtonElement>(null),restore=useRef(false);
 React.useLayoutEffect(()=>{if(!pending&&restore.current){restore.current=false;if(document.activeElement===document.body&&!addButton.current?.closest('[hidden]'))addButton.current?.focus();}},[pending]);
 React.useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const act=async(work:()=>Promise<unknown>,message:string)=>{if(lock.current)return;const trigger=document.activeElement;lock.current=true;setPending(true);setError('');setStatus('');try{await work();if(mounted.current)setStatus(message);}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'操作失败');}finally{lock.current=false;if(mounted.current){restore.current=document.activeElement===trigger;setPending(false);}}};
 return <section aria-label="本地技能" className="skill-settings">
  <p className="settings-note">添加含 SKILL.md 的文件夹。默认禁用，启用后可将正文与文本材料发送给当前模型。只启用你信任的技能；不执行脚本，不授予工具或目录权限。请勿放入密码或密钥。</p>
  <button ref={addButton} disabled={!connected} aria-disabled={pending} onClick={()=>void act(async()=>{const path=await chooseDirectory();if(!path)return;await request({type:'skills.add',path,confirmed:true});},'目录选择已结束；新增技能默认禁用')}>添加技能文件夹…</button>
  {!connected&&<p className="settings-note">本机服务未连接，连接后可管理技能。</p>}
  <div aria-live="polite">{pending?<p role="status">正在处理…</p>:error?<p role="alert" className="error">{error}</p>:status?<p role="status">{status}</p>:null}</div>
  {!skills.length&&<p className="settings-note">尚未添加技能。Wisp 不会自动扫描或启用项目内的指令。</p>}
  {skills.map(skill=><article key={skill.id} className="settings-group skill-entry"><header><strong>{skill.name}</strong><span>{skill.error?'不可用':skill.enabled?'已启用':'已禁用'}</span></header><p>{skill.description}</p><p className="settings-note">来源：{skill.source}</p><p className="settings-note">版本：{skill.version.slice(0,12)} · UTF-8 文本读取</p>{skill.compatibility&&<p>环境要求：{skill.compatibility}</p>}{skill.warnings.map((warning,i)=><p className="settings-note" key={i}>{warning}</p>)}{skill.error&&<p role="alert" className="error">{skill.error}</p>}<div className="settings-actions"><button aria-label={`${skill.enabled?'禁用':'启用'} ${skill.name}`} disabled={!connected||!!skill.error&&!skill.enabled} aria-disabled={pending} onClick={()=>void act(()=>request({type:'skills.enable',id:skill.id,enabled:!skill.enabled}),skill.enabled?'技能已禁用，后续读取已撤销':'技能已启用，下次任务可用')}>{skill.enabled?'禁用':'启用'}</button><button aria-label={`刷新 ${skill.name}`} disabled={!connected} aria-disabled={pending} onClick={()=>void act(()=>request({type:'skills.refresh',id:skill.id}),'已刷新，请查看技能状态；新版本在下次任务生效')}>刷新</button><button aria-label={`移除 ${skill.name}`} disabled={!connected} aria-disabled={pending} onClick={()=>void act(()=>request({type:'skills.remove',id:skill.id}),'已移除配置，磁盘文件保持不变')}>移除</button></div></article>)}
 </section>;
}
export function SkillPicker({skills,selected,onChange,disabled}:{skills:SkillInfo[];selected:string[];onChange(ids:string[]):void;disabled:boolean}){
 const available=skills.filter(s=>s.enabled&&!s.error);if(!available.length)return null;
 return <details className="skill-picker"><summary>技能{selected.length?` · ${selected.length}`:''}</summary><fieldset disabled={disabled}><legend>本次任务主动加载（最多 3 个）</legend>{available.map(s=><label key={s.id} title={`${s.description}\n${s.source}`}><input type="checkbox" checked={selected.includes(s.id)} disabled={!selected.includes(s.id)&&selected.length>=3} onChange={e=>onChange(e.target.checked?[...selected,s.id]:selected.filter(id=>id!==s.id))}/><span>{s.name}<small>{s.description}</small></span></label>)}<p>未选择的已启用技能仍可由助手按需加载。</p></fieldset></details>;
}
export function SkillActivity({events}:{events:RunEvent[]}){
 const loads=events.filter(e=>e.type==='skill_loaded');if(!loads.length)return null;
 return <details className="skill-activity"><summary>已加载 {loads.length} 个技能</summary>{loads.map(e=><p key={e.id}><strong>{String(e.data.name)}</strong><small>来源：{String(e.data.source)} · 版本 {String(e.data.version).slice(0,12)}</small></p>)}</details>;
}
