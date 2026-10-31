// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {QuestionnaireForm,RunQuestions} from './questionnaire.js';
import {questionnaireSchema,type RunEvent} from '@wisp/core';
let root:Root,container:HTMLDivElement;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.stubGlobal('requestAnimationFrame',(fn:()=>void)=>{fn();return 1;});container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(()=>root.unmount());container.remove();vi.unstubAllGlobals();});
const form=questionnaireSchema.parse({title:'规划任务',questions:[{id:'a',title:'选择格式',type:'single',required:true,allowCustom:true,options:[{id:'one',label:'摘要'},{id:'two',label:'报告'}]},{id:'b',title:'选择内容',type:'multiple',required:true,allowCustom:true,options:[{id:'one',label:'进度'},{id:'two',label:'风险'}]},{id:'c',title:'补充说明',type:'text',required:false}]});
const click=async(text:string)=>{await act(()=>Array.from(container.querySelectorAll('button')).find(b=>b.textContent===text)!.click());};
const choose=async(text:string)=>{await act(()=>Array.from(container.querySelectorAll('label')).find(l=>l.textContent===text)!.querySelector('input')!.click());};
const type=async(text:string)=>{await act(()=>{const el=container.querySelector('textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(el,text);el.dispatchEvent(new Event('input',{bubbles:true}));});};
it('supports multi-question edits, native choices, custom input and one structured submission',async()=>{
 let finish!:()=>void;const submit=vi.fn(()=>new Promise<void>(r=>finish=r));await act(()=>root.render(<QuestionnaireForm form={form} onSubmit={submit}/>));
 expect(container.querySelectorAll('input:checked')).toHaveLength(0);await choose('摘要');await choose('自定义答案');await type('幻灯片');expect(container.querySelectorAll('input:checked')).toHaveLength(1);
 await click('下一题');await choose('进度');await choose('风险');await choose('自定义答案');await type('预算');await click('下一题');await type('简短');await click('上一题');expect(container.querySelectorAll('input:checked')).toHaveLength(3);await click('下一题');await click('提交回答');await click('正在提交…');expect(submit).toHaveBeenCalledTimes(1);
 expect(submit.mock.calls[0]).toEqual([{status:'answered',answers:[{questionId:'a',optionIds:[],text:'幻灯片'},{questionId:'b',optionIds:['one','two'],text:'预算'},{questionId:'c',optionIds:[],text:'简短'}]}]);await act(()=>finish());expect(container.textContent).toContain('回答已提交');expect(container.querySelector('textarea')).toBeNull();
});
it('validates required answers and permits cancellation without defaults',async()=>{
 const submit=vi.fn(async()=>{});await act(()=>root.render(<QuestionnaireForm form={form} onSubmit={submit}/>));await click('下一题');await click('下一题');await click('提交回答');expect(submit).not.toHaveBeenCalled();expect(container.querySelector('[role=alert]')?.textContent).toContain('必填');await click('暂不回答');expect(submit).toHaveBeenCalledWith({status:'cancelled'});expect(container.textContent).toContain('没有批准任何操作');
});
it('keeps input after transport failure and disables disconnected submission',async()=>{
 const submit=vi.fn(async()=>{throw new Error('连接中断');});await act(()=>root.render(<QuestionnaireForm form={form} onSubmit={submit}/>));await click('暂不回答');expect(container.querySelector('[role=alert]')?.textContent).toBe('连接中断');await act(()=>root.render(<QuestionnaireForm form={form} disabled onSubmit={submit}/>));await click('暂不回答');expect(submit).toHaveBeenCalledTimes(1);
});
it('binds UI replies to original ticket/run/session and shows terminal history without a submit control',async()=>{
 const event:RunEvent={version:1,id:'e',sessionId:'s',runId:'r',at:'',type:'question_requested',data:{ticket:'t',questionnaire:form}},request=vi.fn(async()=>({}));await act(()=>root.render(<RunQuestions events={[event,event]} ended={false} connected request={request}/>));expect(container.querySelectorAll('form')).toHaveLength(1);await click('暂不回答');expect(request).toHaveBeenCalledWith({type:'run.answer',sessionId:'s',runId:'r',ticket:'t',response:{status:'cancelled'}});await act(()=>root.render(<RunQuestions events={[event]} ended connected request={request}/>));expect(container.querySelector('button')).toBeNull();expect(container.textContent).toContain('不可继续提交');
});
it('requires a separate explicit submit activation after navigating to the last question',async()=>{
 const submit=vi.fn(async()=>{});await act(()=>root.render(<QuestionnaireForm form={form} onSubmit={submit}/>));
 await choose('摘要');await click('下一题');await choose('风险');
 const next=Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='下一题')!;
 await act(()=>next.click());
 expect(submit).not.toHaveBeenCalled();expect(container.querySelector('h4')?.textContent).toContain('补充说明');expect(container.querySelector('textarea')).not.toBeNull();
 const send=Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='提交回答')!;
 expect(next.isConnected).toBe(false);expect(send).not.toBe(next);expect(send.type).toBe('button');
 // Native form submission (including implicit Enter) is not the explicit answer action.
 await act(()=>container.querySelector('form')!.requestSubmit());expect(submit).not.toHaveBeenCalled();
 await act(()=>container.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})));
 expect(submit).not.toHaveBeenCalled();await type('最后一题仍可编辑\n第二行');await click('上一题');await choose('进度');await click('下一题');expect(submit).not.toHaveBeenCalled();expect(container.querySelector('textarea')!.value).toContain('第二行');
 await click('提交回答');expect(submit).toHaveBeenCalledTimes(1);expect(submit.mock.calls[0]).toEqual([{status:'answered',answers:[{questionId:'a',optionIds:['one'],text:''},{questionId:'b',optionIds:['two','one'],text:''},{questionId:'c',optionIds:[],text:'最后一题仍可编辑\n第二行'}]}]);
});
it('does not validate or jump away from the last question during navigation with empty answers',async()=>{
 const submit=vi.fn(async()=>{});await act(()=>root.render(<QuestionnaireForm form={form} onSubmit={submit}/>));await click('下一题');await click('下一题');expect(container.querySelector('h4')?.textContent).toContain('补充说明');expect(container.querySelector('[role=alert]')).toBeNull();expect(submit).not.toHaveBeenCalled();await click('上一题');expect(container.querySelector('h4')?.textContent).toContain('选择内容');
});
