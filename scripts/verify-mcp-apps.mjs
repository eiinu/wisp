/** Build pinned upstream example sources, then exercise Wisp's real Electron sandbox and stdio MCP. */
import { build } from 'esbuild';
import { mkdtemp, readFile, writeFile, mkdir, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url),root=resolve('.');
const upstream=process.argv[2],chart=process.argv[3],sdk2=process.argv[4];
if(!upstream||!chart)throw new Error('Usage: node scripts/verify-mcp-apps.mjs <ext-apps v1.7.5 checkout> <chart.js module directory>');
const out=await mkdtemp(join(tmpdir(),'wisp-mcp-app-e2e-'));
const appEntry=resolve('apps/host/node_modules/@modelcontextprotocol/ext-apps/dist/src/app.js');
for(const name of ['basic-server-vanillajs','budget-allocator-server']){
 const source=join(resolve(upstream),'examples',name),dest=join(out,name);await mkdir(dest);
 const bundled=await build({entryPoints:[join(source,'src/mcp-app.ts')],bundle:true,format:'esm',platform:'browser',minify:true,write:false,outfile:'app.js',alias:{'@modelcontextprotocol/ext-apps':appEntry,'chart.js':resolve(chart),'zod':resolve('packages/core/node_modules/zod')},logLevel:'silent'});
 const js=bundled.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundled.outputFiles.find(f=>f.path.endsWith('.css'))?.text??'';
 const html=(await readFile(join(source,'mcp-app.html'),'utf8')).replace(/<script type="module" src="\/src\/mcp-app.ts"><\/script>/,()=>`<style>${css}</style><script type="module">${js.replace(/<\/script/gi,'<\\/script')}</script>`);
 await writeFile(join(dest,'mcp-app.html'),html);
 await build({entryPoints:[join(source,'server.ts')],bundle:true,format:'esm',platform:'node',outfile:join(dest,'server.mjs'),alias:{'@modelcontextprotocol/ext-apps/server':resolve('apps/host/node_modules/@modelcontextprotocol/ext-apps/dist/src/server/index.js'),'zod':resolve('packages/core/node_modules/zod')},external:['@modelcontextprotocol/sdk/*'],logLevel:'silent'});
 await symlink(join(root,'node_modules'),join(dest,'node_modules'),'dir');
 await writeFile(join(dest,'stdio.mjs'),`import {createServer} from './server.mjs';import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';await createServer().connect(new StdioServerTransport());`);
}
if(sdk2){
 const ui=await build({entryPoints:['scripts/fixtures/mcp-app-todo-ui.ts'],bundle:true,format:'esm',platform:'browser',minify:true,write:false,alias:{'@modelcontextprotocol/ext-apps':join(resolve(sdk2),'@modelcontextprotocol/ext-apps/dist/src/app.js')},logLevel:'silent'});
 await writeFile(join(out,'todo.html'),`<!doctype html><html><body><h1>Fixture Todos</h1><ul id="todos"></ul><input id="text"><button id="add">Add fixture</button><script type="module">${ui.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')}</script></body></html>`);
}
await build({entryPoints:['apps/desktop/src/mcp-app-preload.ts'],bundle:true,format:'cjs',platform:'node',external:['electron'],outfile:join(out,'mcp-app-preload.cjs'),logLevel:'silent'});
await build({entryPoints:['scripts/fixtures/mcp-app-electron.ts'],bundle:true,format:'esm',platform:'node',external:['electron','@modelcontextprotocol/sdk/*'],outfile:join(out,'driver.mjs'),logLevel:'silent'});
await symlink(join(root,'node_modules'),join(out,'node_modules'),'dir');
const electron=require('electron');
const child=spawnSync(electron,['--no-sandbox','--ozone-platform=headless','--disable-gpu',join(out,'driver.mjs'),out,process.execPath],{stdio:'inherit',env:{...process.env,XDG_CACHE_HOME:'/tmp/wisp-electron-cache',WISP_APP_VERIFY_ROOT:out,WISP_APP_VERIFY_NODE:process.execPath,WISP_TEST_SDK2:sdk2?resolve(sdk2):'',WISP_TEST_TODO_HTML:join(out,'todo.html'),WISP_TEST_TODO_SERVER:resolve('scripts/fixtures/mcp-app-todo-server.mjs')},timeout:120000});
console.log(`Verification artifacts: ${out}`);
if(child.error)throw child.error;if(child.status===0)await readFile(join(out,'report.json'),'utf8');process.exitCode=child.status??1;
