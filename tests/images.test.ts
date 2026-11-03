import {it,expect,afterEach,vi} from 'vitest';
import sharp from 'sharp';
import {mkdtemp,readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer,type ServerResponse} from 'node:http';
import {ImageStore} from '../apps/host/src/images.js';
import {Runtime} from '../apps/host/src/runtime.js';
import {deepseekProvider} from '../apps/host/src/deepseek.js';
import {IMAGE_LIMIT,requestSchema,supportsImages} from '../packages/core/src/index.js';
const cleanup:(()=>Promise<unknown>)[]=[];
afterEach(async()=>{for(const f of cleanup.splice(0).reverse())await f();});
async function root(){const directory=await mkdtemp(join(tmpdir(),'wisp-image-'));cleanup.push(()=>rm(directory,{recursive:true,force:true}));return directory;}
async function png(){return sharp({create:{width:5,height:3,channels:3,background:'red'}}).png().toBuffer();}
it('decodes actual formats, removes metadata, bounds bytes/dimensions and rejects corrupt, forged and animated files',async()=>{
 const directory=await root(),store=new ImageStore(directory,randomUUID());
 for(const format of ['png','jpeg','webp','gif'] as const){const bytes=await sharp(await png()).withMetadata({exif:{IFD0:{Artist:'secret-location'}}}).toFormat(format).toBuffer();const image=await store.import('misleading.txt',bytes.toString('base64'));expect(image.mime).toBe(`image/${format}`);const value=await store.read(image.id);expect((await sharp(Buffer.from(value.dataUrl.split(',')[1],'base64')).metadata()).exif).toBeUndefined();}
 await expect(store.import('fake.png',Buffer.from('<svg>not an image</svg>').toString('base64'))).rejects.toThrow('图片无效');
 await expect(store.import('truncated.png',(await png()).subarray(0,35).toString('base64'))).rejects.toThrow('图片无效');
 await expect(store.import('huge.png',Buffer.alloc(IMAGE_LIMIT+1).toString('base64'))).rejects.toThrow('10 MiB');
 const huge=await sharp({create:{width:8193,height:1,channels:3,background:'red'}}).png().toBuffer();await expect(store.import('wide.png',huge.toString('base64'))).rejects.toThrow('8192');
 const animated=await sharp(Buffer.concat([Buffer.alloc(12,0),Buffer.alloc(12,255)]),{raw:{width:2,height:4,channels:3,pageHeight:2}}).gif().toBuffer();await expect(store.import('animated.gif',animated.toString('base64'))).rejects.toThrow('动画');
});
it('persists immutable session-bound assets and fails closed for cross-session IDs, tampering and symlinks',async()=>{
 const directory=await root(),sessionId=randomUUID(),store=new ImageStore(directory,sessionId),image=await store.import('note.png',(await png()).toString('base64'));
 expect((await new ImageStore(directory,sessionId).read(image.id)).image).toEqual(image);
 await expect(new ImageStore(directory,randomUUID()).read(image.id)).rejects.toThrow('不属于');
 await expect(store.read('../other')).rejects.toThrow('无效');
 const file=join(directory,'private-images',sessionId,`${image.id}.image`);await writeFile(file,'bad');await expect(store.read(image.id)).rejects.toThrow('损坏');
 await rm(file);await symlink(join(directory,'outside'),file);await expect(store.read(image.id)).rejects.toThrow();
});
function respond(res:ServerResponse,text:string,calls?:{id:string;name:string;args:unknown}[]){res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{index:0,delta:calls?{tool_calls:calls.map((c,index)=>({index,id:c.id,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}}))}:{content:text},finish_reason:calls?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`);}
it('uses real HTTP multimodal payload through tools, retains history over restart, keeps children text-only, rejects nonvision and duplicate/foreign IDs',async()=>{
 const directory=await root(),bodies:any[]=[];
 const server=createServer(async(req,res)=>{
  if(req.url==='/models'){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'deepseek-flash',input_modalities:['text','image']},{id:'deepseek-v4-pro',input_modalities:['text']}]}));return;}
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);bodies.push(body);
  if(typeof body.messages[1]?.content==='string'&&body.messages[1].content.startsWith('Subtask:')){respond(res,'child done');return;}
  if(bodies.length===1){respond(res,'',[{id:'inspect',name:'tool_introspect',args:{}},{id:'spawn',name:'agent_spawn',args:{title:'text child',task:'say hi'}}]);return;}
  respond(res,'done');
 });await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));cleanup.push(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
 const config={provider:'deepseek',model:'deepseek-flash',thinking:'disabled',baseUrl:`http://127.0.0.1:${(server.address() as any).port}`};
 let runtime=new Runtime(directory);cleanup.push(()=>runtime.shutdown());await runtime.init();await runtime.request({type:'model.save',config,apiKey:'fixture-key'});await runtime.request({type:'model.list'});
 const sessionId=(await runtime.request({type:'session.create'})).sessionId!,foreign=(await runtime.request({type:'session.create'})).sessionId!;
 const image=(await runtime.request({type:'images.import',sessionId,name:'fixture-key.png',data:(await png()).toString('base64')})).image!;
 await expect(runtime.request({type:'run.start',sessionId:foreign,prompt:'foreign',imageIds:[image.id]})).rejects.toThrow('不属于');
 await expect(runtime.request({type:'run.start',sessionId,prompt:'duplicate',imageIds:[image.id,image.id]})).rejects.toThrow('格式');
 await runtime.request({type:'run.start',sessionId,prompt:'see this',imageIds:[image.id]});await vi.waitFor(()=>expect(runtime.snapshot().events.some(e=>e.type==='completed'&&!e.parentRunId)).toBe(true));
 const first=bodies[0].messages[1];expect(first.content[0]).toEqual({type:'text',text:'see this'});expect(first.content[1].image_url.url).toMatch(/^data:image\/png;base64,/);
 const parents=bodies.filter(b=>Array.isArray(b.messages[1]?.content));expect(parents.length).toBeGreaterThan(1);for(const body of parents)expect(body.messages[1]).toEqual(first);
 const child=bodies.find(b=>typeof b.messages[1]?.content==='string'&&b.messages[1].content.startsWith('Subtask:'));expect(child).toBeTruthy();expect(JSON.stringify(child)).not.toContain('image_url');
 expect(JSON.stringify(runtime.snapshot())).not.toContain('fixture-key');expect(JSON.stringify(runtime.snapshot())).not.toContain('base64');expect(await readFile(join(directory,'sessions',`${sessionId}.jsonl`),'utf8')).not.toContain('base64');expect(await readFile(join(directory,'private-conversations',`${sessionId}.json`),'utf8')).not.toContain('base64');
 await vi.waitFor(()=>expect(runtime.snapshot().sessions.find(s=>s.id===sessionId)?.activeRunId).toBeUndefined());await runtime.shutdown();runtime=new Runtime(directory);await runtime.init();await runtime.request({type:'model.save',config,apiKey:'fixture-key'});await runtime.request({type:'model.list'});
 expect((await runtime.request({type:'images.read',sessionId,id:image.id})).image).toEqual(image);
 await runtime.request({type:'run.start',sessionId,prompt:'next'});await vi.waitFor(()=>expect(bodies.at(-1).messages.at(-1).content).toBe('next'));expect(bodies.at(-1).messages[1]).toEqual(first);
 await vi.waitFor(()=>expect(runtime.snapshot().sessions.find(s=>s.id===sessionId)?.activeRunId).toBeUndefined());
 await runtime.request({type:'model.save',config:{...config,model:'deepseek-v4-pro'}});const before=bodies.length;
 await expect(runtime.request({type:'run.start',sessionId,prompt:'not silently dropped'})).rejects.toThrow('不支持图片');expect(bodies).toHaveLength(before);
});
it('rejects unsupported provider images and oversized full JSON before any network request; validates count',async()=>{
 const config={provider:'deepseek' as const,model:'deepseek-v4-pro',baseUrl:'https://api.deepseek.com'},fetcher=vi.fn();
 const image={id:randomUUID(),name:'test',mime:'image/png' as const,width:1,height:1,size:1,sha256:'a'.repeat(64),dataUrl:'data:image/png;base64,AAAA'};
 let events=[];for await(const e of deepseekProvider(config,'fake',{fetch:fetcher}).stream({messages:[{role:'user',text:'x',images:[image]}],tools:[]},{signal:new AbortController().signal}))events.push(e);
 expect(events).toContainEqual(expect.objectContaining({type:'error',code:'image_input_not_supported'}));expect(fetcher).not.toHaveBeenCalled();
 events=[];for await(const e of deepseekProvider({...config,model:'deepseek-flash'},'fake',{fetch:fetcher}).stream({messages:[{role:'user',text:'x'.repeat(48*1024*1024)}],tools:[]},{signal:new AbortController().signal}))events.push(e);
 expect(events).toContainEqual(expect.objectContaining({type:'error',code:'request_body_exceeds_48_mib_start_new_session'}));expect(fetcher).not.toHaveBeenCalled();
 expect(requestSchema.safeParse({type:'run.start',sessionId:randomUUID(),prompt:'',imageIds:Array.from({length:5},()=>randomUUID())}).success).toBe(false);
 expect(supportsImages(config)).toBe(false);expect(supportsImages({...config,model:'deepseek-flash'})).toBe(true);expect(supportsImages({...config,model:'unknown'})).toBe(false);
});
it('cancels a real pending multimodal HTTP run, checkpoints images without bytes, and never replays on restart',async()=>{
 const directory=await root(),bodies:any[]=[];let held:ServerResponse|undefined;
 const server=createServer(async(req,res)=>{if(req.url==='/models'){res.end(JSON.stringify({data:[{id:'vision',input_modalities:['image','text']}]}));return;}let raw='';for await(const chunk of req)raw+=chunk;bodies.push(JSON.parse(raw));held=res;});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));cleanup.push(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
 let runtime=new Runtime(directory);cleanup.push(()=>runtime.shutdown());await runtime.init();await runtime.request({type:'model.save',config:{provider:'deepseek',model:'vision',baseUrl:`http://127.0.0.1:${(server.address() as any).port}`,thinking:'disabled'},apiKey:'fixture'});await runtime.request({type:'model.list'});
 const sessionId=(await runtime.request({type:'session.create'})).sessionId!,image=(await runtime.request({type:'images.import',sessionId,name:'cancel.png',data:(await png()).toString('base64')})).image!;
 await runtime.request({type:'run.start',sessionId,prompt:'',imageIds:[image.id]});await vi.waitFor(()=>expect(held).toBeTruthy());const runId=runtime.snapshot().sessions[0].activeRunId!;
 await runtime.request({type:'run.cancel',sessionId,runId});await vi.waitFor(()=>expect(runtime.snapshot().sessions[0].activeRunId).toBeUndefined());respond(held!,'late');
 expect(runtime.snapshot().events.some(e=>e.type==='cancelled')).toBe(true);expect(runtime.snapshot().events.some(e=>e.type==='assistant')).toBe(false);
 const saved=JSON.parse(await readFile(join(directory,'private-conversations',`${sessionId}.json`),'utf8'));expect(saved.messages[0].images[0].id).toBe(image.id);expect(JSON.stringify(saved)).not.toContain('base64');
 await runtime.shutdown();runtime=new Runtime(directory);await runtime.init();expect(bodies).toHaveLength(1);expect((await runtime.request({type:'images.read',sessionId,id:image.id})).image).toEqual(image);
});

it('bounds aggregate history instead of dropping old images, including multi-image resolution rule',async()=>{
 const store=new ImageStore(await root(),randomUUID()),image=await store.import('small.png',(await png()).toString('base64'));
 await expect(store.hydrate([{role:'user',text:'',images:Array.from({length:101},()=>image)}])).rejects.toThrow('历史图片过多');
 await expect(store.hydrate([{role:'user',text:'',images:Array.from({length:4},()=>({...image,size:10*1024*1024}))}])).rejects.toThrow('历史图片过多');
 const wide=await store.import('wide.png',(await sharp({create:{width:4097,height:1,channels:3,background:'blue'}}).png().toBuffer()).toString('base64'));
 await expect(store.hydrate([{role:'user',text:'',images:Array.from({length:15},()=>wide)}])).rejects.toThrow('4096');
});
