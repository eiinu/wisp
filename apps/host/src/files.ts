import { constants } from 'node:fs';
import { lstat, realpath, readdir, open, rename, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, sep, dirname, basename, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FileEntry, FilePreview, Tool } from '@wisp/core';
const maxBytes = 2 * 1024 * 1024;
export class WorkspaceFiles {
  constructor(readonly root: string, private privateDirectory: string, private identity?: {dev: string; ino: string}) {}
  static async grant(path: string, privateDirectory: string, identity?: {dev: string; ino: string}) {
    if (!isAbsolute(path)) throw new Error('工作目录必须是绝对路径');
    const root = await realpath(path);
    if (!(await lstat(root)).isDirectory()) throw new Error('请选择文件夹');
    if (root === sep) throw new Error('不能授权整个文件系统');
    if (identity && root !== path) throw new Error('项目目录已改变，请恢复原目录');
    const files = new WorkspaceFiles(root, await realpath(privateDirectory), identity);
    if (identity) await files.resolve('');
    return files;
  }
  async resolve(path: string, allowNew = false) {
    if (isAbsolute(path) || path.includes('\\') || path.includes('\0') || path.split('/').some(p => p === '..' || p.startsWith('.'))) throw new Error('不允许路径逃逸、隐藏文件或符号链接');
    const target = join(this.root, path);
    const rel = relative(this.root, target);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('路径超出授权目录');
    const privateRel = relative(this.privateDirectory, target);
    if (!privateRel.startsWith('..') && !isAbsolute(privateRel)) throw new Error('不能访问 Wisp 私有数据目录');
    const rootStat = await lstat(this.root, { bigint: true });
    if (this.identity && (!rootStat.isDirectory() || rootStat.dev.toString() !== this.identity.dev || rootStat.ino.toString() !== this.identity.ino)) throw new Error('项目目录已移动或被替换，请恢复原目录或新建项目');
    if (await realpath(this.root) !== this.root) throw new Error('授权目录已改变，请重新授权');
    let cursor = this.root;
    const parts = rel ? rel.split(sep) : [];
    for (let i = 0; i < parts.length; i++) {
      cursor = join(cursor, parts[i]);
      try { if ((await lstat(cursor)).isSymbolicLink()) throw new Error('禁止符号链接'); }
      catch (e) { if (allowNew && i === parts.length - 1 && (e as NodeJS.ErrnoException).code === 'ENOENT') break; throw e; }
    }
    return target;
  }
  async list(path = ''): Promise<FileEntry[]> {
    const target = await this.resolve(path), entries = await readdir(target, { withFileTypes: true });
    const result: FileEntry[] = [];
    for (const entry of entries.slice(0, 500)) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) continue;
      const child = path ? `${path}/${entry.name}` : entry.name;
      try { const safe = await this.resolve(child); const stat = await lstat(safe); result.push({ name: entry.name, path: child, kind: stat.isDirectory() ? 'directory' : 'file', size: stat.size }); } catch { /* unavailable or private entries are omitted */ }
    }
    return result.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1));
  }
  async read(path: string): Promise<FilePreview> {
    const target = await this.resolve(path), handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat(); if (!stat.isFile() || stat.nlink > 1) throw new Error('只能预览非硬链接的普通文件');
      if (stat.size > maxBytes) throw new Error('文件超过 2 MB 预览限制');
      const data = await handle.readFile(); if (data.length > maxBytes) throw new Error('文件超过 2 MB 预览限制');
      const ext = extname(path).toLowerCase();
      const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' } as Record<string, string>)[ext];
      if (mime) return { path, size: data.length, kind: 'image', dataUrl: `data:${mime};base64,${data.toString('base64')}` };
      let text: string;
      const utf16 = data[0] === 0xff && data[1] === 0xfe ? 'utf-16le' : data[0] === 0xfe && data[1] === 0xff ? 'utf-16be' : undefined;
      try { text = new TextDecoder(utf16 ?? 'utf-8', { fatal: true }).decode(data); }
      catch { throw new Error('无法解码文本：请使用 UTF-8，或带 BOM 的 UTF-16 文件'); }
      if (text.includes('\0')) return { path, size: data.length, kind: 'unsupported' };
      return { path, size: data.length, kind: ['.md', '.markdown'].includes(ext) ? 'markdown' : 'text', text };
    } finally { await handle.close(); }
  }
  async write(path: string, content: string, signal: AbortSignal) {
    signal.throwIfAborted(); if (Buffer.byteLength(content) > 200000) throw new Error('写入内容过大');
    const target = await this.resolve(path, true);
    try { const stat = await lstat(target); if (!stat.isFile() || stat.nlink > 1) throw new Error('不能覆盖链接或非普通文件'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    const temporary = join(dirname(target), `.wisp-write-${randomUUID()}`);
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(content, 'utf8'); await handle.close(); signal.throwIfAborted();
      await this.resolve(path, true); await rename(temporary, target);
    } catch (e) { await handle.close().catch(() => {}); await unlink(temporary).catch(() => {}); throw e; }
    return `已写入 ${basename(path)}（${Buffer.byteLength(content)} 字节）`;
  }
  tools(): Tool[] {
    const schema = { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false };
    const pathArg = (args: Record<string, unknown>) => { if (typeof args.path !== 'string') throw new Error('path 必须是字符串'); return args.path; };
    const validate = async (args: Record<string, unknown>, write = false) => {
      if (!args || Array.isArray(args) || Object.keys(args).some(key => !['path', ...(write ? ['content'] : [])].includes(key))) throw new Error('包含不支持的工具参数');
      const path = pathArg(args);
      if (path.length > 4096) throw new Error('路径过长');
      if (write && (typeof args.content !== 'string' || Buffer.byteLength(args.content) > 200000)) throw new Error('content 必须是最多 200000 字节的文本');
      await this.resolve(path, write);
    };
    return [
      { name: 'files_list', description: '列出已授权工作目录中的文件。path 为空字符串表示根目录。', inputSchema: schema, requiresApproval: false, validate: args => validate(args), execute: async (args, signal) => { signal.throwIfAborted(); return JSON.stringify(await this.list(pathArg(args))); } },
      { name: 'files_read', description: '读取已授权目录中的文本文件（最多 2 MB）；不支持模型图片输入。', inputSchema: schema, requiresApproval: false, validate: args => validate(args), execute: async (args, signal) => { signal.throwIfAborted(); const file = await this.read(pathArg(args)); if (file.text === undefined) throw new Error('工具仅支持文本内容'); return file.text.length > 32000 ? file.text.slice(0, 32000) + '\n[工具结果已截断至 32000 字符；可在文件面板查看完整预览]' : file.text; } },
      { name: 'files_write', description: '创建或覆盖授权目录内的文本文件；每次写入须由用户明确批准完整内容。', inputSchema: { ...schema, properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] }, requiresApproval: true, validate: args => validate(args, true), execute: async (args, signal) => { if (typeof args.content !== 'string') throw new Error('content 必须是字符串'); return this.write(pathArg(args), args.content, signal); } },
    ];
  }
}
