import {it,expect,vi} from 'vitest';
import {QIANFAN_MODEL,QIANFAN_BASE_URL,type Message,type ModelEvent} from '@wisp/core';
import {qianfanProvider} from './qianfan.js';
const config={provider:'qianfan' as const,model:QIANFAN_MODEL,baseUrl:QIANFAN_BASE_URL};
const tools=[{name:'fixture_tool',description:'fixture',inputSchema:{type:'object'}}];
const frame=(delta:object={},finish_reason:string|null=null,usage?:object)=>({choices:[{index:0,delta,finish_reason}],...(usage?{usage}:{})});
function response(frames:object[],done=true){const text=': keepalive\r\n\r\n'+frames.map(value=>`data: ${JSON.stringify(value)}\r\n\r\n`).join('')+(done?'data: [DONE]\r\n\r\n':'');return new Response(new ReadableStream<Uint8Array>({start(c){for(const byte of new TextEncoder().encode(text))c.enqueue(new Uint8Array([byte]));c.close();}}),{headers:{'content-type':'text/event-stream'}});}
async function collect(provider:ReturnType<typeof qianfanProvider>,messages:Message[]=[{role:'user',text:'你好'}],extra:object={}){const out:ModelEvent[]=[];for await(const e of provider.stream({messages,tools,...extra},{signal:new AbortController().signal}))out.push(e);return out;}
const finish=(events:ModelEvent[])=>events.find((e):e is Extract<ModelEvent,{type:'finish'}>=>e.type==='finish')!;
it('uses official endpoint/model/Bearer and Qianfan v2 request fields without guessed reasoning or output defaults',async()=>{
 const fetcher=vi.fn(async()=>response([frame({content:'你好🙂'},'stop'),{choices:[],usage:{prompt_tokens:3,completion_tokens:4,total_tokens:7,completion_tokens_details:{reasoning_tokens:2}}}]));
 const events=await collect(qianfanProvider(config,'fake-qianfan-key',{fetch:fetcher}));
 const [url,options]=fetcher.mock.calls[0] as unknown as [string,RequestInit],body=JSON.parse(options.body as string);
 expect(url).toBe('https://qianfan.baidubce.com/v2/chat/completions');expect(options.redirect).toBe('error');expect(options.headers).toMatchObject({authorization:'Bearer fake-qianfan-key'});
 expect(body).toMatchObject({model:'ernie-5.5-flash-preview',stream:true,stream_options:{include_usage:true},tools:[{type:'function',function:{name:'fixture_tool'}}]});
 for(const key of ['thinking','enable_thinking','reasoning_effort','max_tokens','max_completion_tokens'])expect(body).not.toHaveProperty(key);
 expect(finish(events).message.text).toBe('你好🙂');expect(events.find(e=>e.type==='usage')).toMatchObject({usage:{input:3,output:4,total:7,reasoning:2}});
});
it('assembles interleaved streaming tool calls and only replays private reasoning to the same provider/model/endpoint',async()=>{
 let round=0;const payloads:any[]=[];
 const fetcher=vi.fn(async(_url:unknown,options:any)=>{payloads.push(JSON.parse(options.body));return round++===0?response([
  frame({reasoning_content:'PRIVATE_QIANFAN_REASONING'}),frame({tool_calls:[{index:1,id:'second',type:'function',function:{name:'fixture_tool',arguments:'{"n":'}},{index:0,id:'first',type:'function',function:{name:'fixture_tool',arguments:'{"n":1}'}}]}),frame({tool_calls:[{index:1,function:{arguments:'2}'}}]},'tool_calls'),
 ]):response([frame({content:'完成'},'stop')]);});
 const provider=qianfanProvider(config,'fake-key',{fetch:fetcher});const first=finish(await collect(provider)).message;
 expect(first.calls).toEqual([{id:'first',name:'fixture_tool',args:{n:1}},{id:'second',name:'fixture_tool',args:{n:2}}]);expect(first.continuation).toMatchObject({provider:'qianfan',model:QIANFAN_MODEL});
 const history:Message[]=[{role:'user',text:'工具测试'},first,{role:'tool',callId:'first',text:'one'},{role:'tool',callId:'second',text:'two'}];
 await collect(provider,history);expect(payloads[1].messages[2]).toMatchObject({role:'assistant',content:'',reasoning_content:'PRIVATE_QIANFAN_REASONING'});expect(payloads[1].messages[3]).toMatchObject({role:'tool',tool_call_id:'first',content:'one'});
 for(const continuation of [{...first.continuation!,provider:'deepseek'},{...first.continuation!,endpoint:'https://other.invalid'},{...first.continuation!,model:'other'}]){await collect(provider,[{role:'user',text:'hi'},{...first,continuation}]);expect(payloads.at(-1).messages[2]).not.toHaveProperty('reasoning_content');}
});
it('supports explicit tool choice/JSON object output and keeps the preset catalog local without key probes',async()=>{
 const fetcher=vi.fn(async()=>response([frame({content:'{"ok":true}'},'stop')]));const p=qianfanProvider(config,'fake',{fetch:fetcher});
 expect(await p.listModels({signal:new AbortController().signal})).toMatchObject([{id:QIANFAN_MODEL,inputModalities:['text']}]);expect(fetcher).not.toHaveBeenCalled();
 await collect(p,undefined,{toolChoice:{name:'fixture_tool'},responseFormat:'json_object'});const body=JSON.parse((fetcher.mock.calls[0] as any)[1].body);expect(body.tool_choice).toEqual({type:'function',function:{name:'fixture_tool'}});expect(body.response_format).toEqual({type:'json_object'});
 const unsupported=vi.fn();expect(await collect(qianfanProvider({...config,thinking:'enabled'},'fake',{fetch:unsupported}))).toContainEqual(expect.objectContaining({type:'error',code:'unsupported_parameter'}));expect(unsupported).not.toHaveBeenCalled();
});
it('reports safe HTTP/JSON/SSE errors, never retries after partial output, and rejects truncated streams',async()=>{
 const key='fake-private-qianfan';const unauthorized=vi.fn(async()=>new Response(JSON.stringify({error:{code:key,message:`bad ${key}`}}),{status:401}));
 const denied=await collect(qianfanProvider(config,key,{fetch:unauthorized}));expect(denied).toContainEqual(expect.objectContaining({type:'error',status:401,partial:false}));expect(JSON.stringify(denied)).not.toContain(key);expect(unauthorized).toHaveBeenCalledOnce();
 const json=await collect(qianfanProvider(config,key,{fetch:async()=>new Response(JSON.stringify({error_code:336003,error_msg:key}),{headers:{'content-type':'application/json'}})}));expect(json).toContainEqual(expect.objectContaining({type:'error',code:'provider_error',providerCode:336003}));expect(JSON.stringify(json)).not.toContain(key);
 const partial=vi.fn(async()=>response([frame({content:'partial'}),{error:{code:'limited'}}]));expect(await collect(qianfanProvider(config,key,{fetch:partial}))).toContainEqual(expect.objectContaining({type:'error',partial:true}));expect(partial).toHaveBeenCalledOnce();
 const truncated=await collect(qianfanProvider(config,key,{fetch:async()=>response([frame({tool_calls:[{index:0,id:'a',function:{name:'fixture_tool',arguments:'{}'}}]},'tool_calls')],false)}));expect(truncated.some(e=>e.type==='finish')).toBe(false);expect(truncated).toContainEqual(expect.objectContaining({type:'error',code:'premature_eof'}));
});

it('honors Qianfan safety flags before exposing a tool call and reads native top-level error codes safely',async()=>{
 const flagged=await collect(qianfanProvider(config,'fake',{fetch:async()=>response([{choices:[{index:0,delta:{tool_calls:[{index:0,id:'unsafe',function:{name:'fixture_tool',arguments:'{}'}}]},finish_reason:'tool_calls',flag:2}]}])}));
 expect(flagged.some(e=>e.type==='tool_delta'||e.type==='finish')).toBe(false);expect(flagged).toContainEqual(expect.objectContaining({type:'error',code:'provider_content_filter'}));
 const top=await collect(qianfanProvider(config,'fake',{fetch:async()=>new Response(JSON.stringify({code:'AccessDenied',message:'private detail'}),{status:403})}));expect(top).toContainEqual(expect.objectContaining({type:'error',status:403,providerCode:'AccessDenied'}));expect(JSON.stringify(top)).not.toContain('private detail');
});
