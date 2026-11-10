import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {mcpConfigSchema,mcpHttpUrl} from '../packages/core/src/index.js';
import {LocalMcp} from '../apps/host/src/local-mcp.js';
it('accepts explicit HTTPS or loopback HTTP endpoints and rejects ambiguous/auth-bearing transport configuration',()=>{
 const config={name:'Todo',command:'',args:[],transport:'streamable-http',url:'http://127.0.0.1:3030/mcp'};
 expect(mcpConfigSchema.parse(config)).toMatchObject(config);expect(mcpHttpUrl('https://example.com/mcp')).toBe('https://example.com/mcp');
 for(const url of ['file:///etc/passwd','http://example.com/mcp','https://user:password@example.com/mcp','https://example.com/mcp?token=secret','https://example.com/mcp#secret'])expect(mcpConfigSchema.safeParse({...config,url}).success).toBe(false);
 for(const value of [{...config,command:'node'},{...config,args:['server.js']},{...config,cwd:'/tmp'},{...config,transport:'stdio'}])expect(mcpConfigSchema.safeParse(value).success).toBe(false);
 expect(mcpConfigSchema.parse({name:'legacy',command:'node',args:[]})).toEqual({name:'legacy',command:'node',args:[]});
});
it('never follows a Streamable HTTP redirect or forwards environment secrets',async()=>{
 let reached=0;const target=createServer((_req,res)=>{reached++;res.end('unexpected');});await new Promise<void>(r=>target.listen(0,'127.0.0.1',r));
 const redirect=createServer((_req,res)=>{res.writeHead(307,{location:`http://127.0.0.1:${(target.address() as any).port}/target`});res.end();});await new Promise<void>(r=>redirect.listen(0,'127.0.0.1',r));
 const directory=await mkdtemp(join(tmpdir(),'wisp-http-')),mcp=new LocalMcp(directory,()=>{});
 try{await mcp.init();const config={name:'HTTP',command:'',args:[],transport:'streamable-http' as const,url:`http://127.0.0.1:${(redirect.address() as any).port}/mcp`};
  await expect(mcp.save(undefined,config,{TOKEN:'fixture-secret'},false)).rejects.toThrow('身份验证');
  const id=await mcp.save(undefined,config,{},false);await expect(mcp.activate(id)).rejects.toThrow();expect(reached).toBe(0);expect(mcp.snapshot()[0].state).toBe('failed');
 }finally{await mcp.shutdown();redirect.closeAllConnections();target.closeAllConnections();await Promise.all([new Promise<void>(r=>redirect.close(()=>r())),new Promise<void>(r=>target.close(()=>r()))]);await rm(directory,{recursive:true,force:true});}
});
