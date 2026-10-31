import { join } from 'node:path';
import { mcpEnvSchema } from '@wisp/core';
import { credentialVault, type SystemCrypto } from './credential-vault.js';
/** Private parent/Host IPC only; no Renderer route exposes a load operation. */
export async function mcpEnvironmentOperation(operation:string,payload:Record<string,unknown>,directory:string,crypto:SystemCrypto,signal:AbortSignal) {
  if(typeof payload?.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(payload.id))throw new Error('无效的 MCP 凭据 ID');
  signal.throwIfAborted();
  const vault=credentialVault(join(directory,'mcp-secrets',payload.id),crypto);
  if(operation==='mcp.env.load'){const value=await vault.load();signal.throwIfAborted();if(!value)throw new Error('MCP 环境变量未保存，请重新填写');const saved=JSON.parse(value);return {env:mcpEnvSchema.parse(saved.env),binding:saved.binding};}
  if(operation==='mcp.env.delete'){await vault.delete();return;}
  if(operation==='mcp.env.save'){const env=mcpEnvSchema.parse(payload.env);if(typeof payload.binding!=='string'||!/^[a-f0-9]{64}$/.test(payload.binding))throw new Error('无效的凭据绑定');await vault.save(JSON.stringify({env,binding:payload.binding}));return;}
  throw new Error('无效的 MCP 凭据操作');
}
