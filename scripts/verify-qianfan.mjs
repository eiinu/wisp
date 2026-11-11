import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),out=await mkdtemp(join(tmpdir(),'wisp-qianfan-desktop-'));
const child=spawnSync(require('electron'),['--no-sandbox','--ozone-platform=headless','--disable-gpu',resolve('scripts/fixtures/qianfan-electron.mjs')],{env:{...process.env,XDG_CACHE_HOME:'/tmp/wisp-electron-cache',WISP_QIANFAN_REPO:resolve('.'),WISP_QIANFAN_VERIFY_DIR:out},stdio:'inherit',timeout:60000});
console.log(`Desktop verification artifacts: ${out}`);
if(child.error)throw child.error;if(child.status===0)await readFile(join(out,'report.json'),'utf8');process.exitCode=child.status??1;
