import { expect, it } from 'vitest';
import { fork } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('answers a snapshot sent during secure credential initialization without losing it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wisp-host-startup-'));
  const host = fork(new URL('../apps/host/dist/main.js', import.meta.url), [directory, '--secure-credentials'], {execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc']});
  const responses: any[] = [];
  let stderr = ''; host.stderr!.on('data', chunk => { stderr += chunk; });
  try {
    await new Promise<void>((resolve, reject) => {
      host.once('error', reject);
      host.once('exit', code => reject(new Error(`Host exited ${code}: ${stderr}`)));
      host.on('message', (message: any) => {
        if (message.type === 'credential-request') {
          if (message.operation === 'available') {
            // Ordered IPC: this request reaches the child before initialization can finish.
            host.send({id: 'early', request: {type: 'snapshot'}});
          }
          host.send({type: 'credential-response', id: message.id, ok: true, value: message.operation === 'available' ? true : undefined});
        }
        if (message.type === 'host-ready') host.send({id: 'barrier', request: {type: 'snapshot'}});
        if (message.type === 'response') {
          responses.push(message);
          if (message.id === 'barrier') resolve();
        }
      });
    });
    expect(responses.find(message => message.id === 'early')?.result?.snapshot).toMatchObject({sessions: [], keyPresent: false});
    expect(responses.find(message => message.id === 'barrier')?.result?.snapshot).toMatchObject({sessions: [], keyPresent: false});
  } finally {
    if (host.exitCode === null) { const exited = new Promise(resolve => host.once('exit', resolve)); host.kill(); await exited; }
    await rm(directory, {recursive:true, force:true});
  }
});
