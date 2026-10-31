import { pageReadTool } from './page-tool.js';
import type { DesktopService } from './desktop-service.js';
import { officialDeepSeek, type CredentialVault } from './credentials.js';
import { PreviewRequests } from './preview.js';
import { ConversationStore } from './conversation.js';
import { asModelProvider } from './model.js';
import { randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { Registry, requestSchema, type Notice, type Result, type SessionInfo, type Snapshot, type RunEvent, type Message, type ModelProvider, type GenerationProvider, type Tool } from '@wisp/core';
import { Agent } from './agent.js';
import { EventLog } from './log.js';
import { StateStore } from './state.js';
import { WorkspaceFiles } from './files.js';
import { configuredProvider } from './pi.js';
import { offlineProvider } from './offline.js';
import { BrowserSession, type BrowserTransportFactory } from './browser.js';
export class Runtime {
  readonly store: StateStore;
  private events: RunEvent[] = [];
  private previews = new PreviewRequests(notice => this.publish(notice), () => this.store.state.selectedId);
  private agents = new Map<string, Agent>();
  private busy = new Set<string>();
  private tasks = new Set<Promise<void>>();
  private listeners = new Set<(notice: Notice) => void>();
  private key = '';
  private keyChanging = false;
  private protectedKey = false;
  private credential: NonNullable<Snapshot['credential']> = { storage: 'session', saved: false };
  private browsers = new Map<string, BrowserSession>();
  constructor(directory: string, private browserFactory?: BrowserTransportFactory, private vault?: CredentialVault, private development?: { baseUrl: string; key: string }, private desktop?: DesktopService) { this.store = new StateStore(resolve(directory)); }
  async init() {
    await this.store.load();
    if (this.development) { this.key = this.development.key; this.store.state.config = { provider: 'deepseek', model: 'wisp-dev-simulator', baseUrl: this.development.baseUrl }; await this.store.save(); }
    if (this.vault) { try { this.credential.storage = await this.vault.available() ? 'secure' : 'session'; const key = await this.vault.load(); this.credential.saved = !!key; if (key && this.store.state.config && officialDeepSeek(this.store.state.config)) { this.key = key; this.protectedKey = true; } } catch { this.credential.error = '安全存储不可用或凭据无法解密；请解锁系统钥匙串、重新保存或删除凭据'; } }
    for (const session of this.store.state.sessions) {
      const log = this.log(session.id), events = await log.read(); this.events.push(...events);
      const starts = events.filter(e => e.type === 'started');
      for (const start of starts) if (!events.some(e => e.runId === start.runId && ['completed', 'cancelled', 'failed'].includes(e.type))) {
        const interrupted: RunEvent = { version: 1, id: randomUUID(), sessionId: session.id, runId: start.runId, at: new Date().toISOString(), type: 'failed', data: { reason: 'Host 已重启；原任务已中断，没有重放工具。' } };
        await log.append(interrupted); this.events.push(interrupted);
      }
    }
  }
  subscribe(listener: (notice: Notice) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private publish(notice: Notice) { this.listeners.forEach(listener => listener(notice)); }
  private log(id: string) { return new EventLog(join(this.store.directory, 'sessions', `${id}.jsonl`)); }
  private session(id: string) { const session = this.store.state.sessions.find(s => s.id === id); if (!session) throw new Error('会话不存在'); return session; }
  private idle(id: string) { if (this.busy.has(id)) throw new Error('会话仍在执行，请先取消或等待完成'); }
  private redact = (text: string) => this.key ? text.split(this.key).join('[REDACTED]') : text;
  private project(id: string) { const project = this.store.state.projects.find(p => p.id === id); if (!project) throw new Error('项目不存在'); return project; }
  snapshot(): Snapshot { return structuredClone({ ...this.store.state, projects: this.store.state.projects.map(({identity: _identity, ...project}) => project), sessions: this.store.state.sessions.map(session => ({ ...session, workspace: session.projectId ? this.project(session.projectId).workspace : session.workspace })), keyPresent: !!this.key, credential: this.credential, events: this.events, browserConnected: this.browsers.get(this.store.state.selectedId ?? '')?.status.state === 'connected', browserSessions: Object.fromEntries([...this.browsers].map(([id, browser]) => [id, browser.status])) }); }
  private async workspace(session: SessionInfo) { if (session.projectId) { const project = this.project(session.projectId); try { return await WorkspaceFiles.grant(project.workspace, this.store.directory, project.identity); } catch { throw new Error('项目目录不可用或已改变，请恢复原目录或新建项目'); } } if (!session.workspace) throw new Error('请先授权此会话的工作目录'); return WorkspaceFiles.grant(session.workspace, this.store.directory); }
  private provider(): ModelProvider {
    const config = this.store.state.config; if (!config) throw new Error('请先配置模型；也可以明确选择离线验证模式');
    if (config.provider === 'offline') return asModelProvider(offlineProvider);
    if (!this.key) throw new Error('API Key 未在当前 Host 进程中设置');
    if (this.protectedKey && !officialDeepSeek(config)) throw new Error('持久化 DeepSeek Key 仅限官方 API');
    return configuredProvider(config, this.key);
  }
  async request(input: unknown): Promise<Result> {
    const parsed = requestSchema.safeParse(input); if (!parsed.success) throw new Error('请求格式不正确');
    const command = parsed.data;
    if (this.keyChanging && command.type !== 'snapshot') throw new Error('凭据正在更新，请稍后重试');
    if (command.type === 'snapshot') return { snapshot: this.snapshot() };
    if (command.type === 'model.list') return { models: await this.provider().listModels({ signal: AbortSignal.timeout(10000) }) };
    if (command.type === 'project.create') {
      const files = await WorkspaceFiles.grant(command.path, this.store.directory); await files.resolve('');
      const stat = await lstat(files.root, { bigint: true }), id = randomUUID();
      this.store.state.projects.push({ id, name: command.name ?? basename(files.root).slice(0, 100), workspace: files.root, collapsed: false, createdAt: new Date().toISOString(), identity: { dev: stat.dev.toString(), ino: stat.ino.toString() } });
      await this.store.save(); this.publish({ type: 'changed' }); return { projectId: id };
    }
    if (command.type === 'project.rename' || command.type === 'project.collapse') {
      const project = this.project(command.projectId);
      if (command.type === 'project.rename') project.name = command.name; else project.collapsed = command.collapsed;
      await this.store.save(); this.publish({ type: 'changed' }); return {};
    }
    if (command.type === 'session.create') {
      if (command.projectId) { const project = this.project(command.projectId); await this.workspace({projectId: project.id} as SessionInfo); project.collapsed = false; }
      const now = new Date().toISOString(), session: SessionInfo = { ...(command.projectId ? { projectId: command.projectId } : {}), id: randomUUID(), title: command.title, createdAt: now, updatedAt: now };
      this.store.state.sessions.unshift(session); this.store.state.selectedId = session.id;
      await this.store.save(); this.publish({ type: 'changed' }); return { sessionId: session.id };
    }
    if (command.type === 'model.save' || command.type === 'model.clearKey') {
      if (this.development) throw new Error('开发模拟固定使用自动生成的假凭据，不接受真实 Key；请退出并运行普通工作台');
      if (this.busy.size) throw new Error('请等待所有任务结束后修改模型配置');
      this.keyChanging = true;
      try {
        if (command.type === 'model.clearKey') {
          this.key = ''; this.protectedKey = false;
          try { await this.vault?.delete(); this.credential.saved = false; delete this.credential.error; }
          catch { this.credential.error = '内存已清除，但删除本地凭据失败，请重试'; throw new Error(this.credential.error); }
        } else {
          const config = command.config;
          if (config.provider !== 'offline') {
            let url: URL; try { url = new URL(config.baseUrl); } catch { throw new Error('Base URL 无效'); }
            if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new Error('模型地址仅允许 HTTPS 或本机 HTTP，不能包含凭据、查询参数或片段');
          }
          const supplied = command.apiKey?.trim();
          if (command.rememberKey) {
            if (!this.vault || !await this.vault.available()) throw new Error('此环境不支持安全持久化，请明确选择仅会话保存');
            if (!officialDeepSeek(config)) throw new Error('仅能为 DeepSeek 官方 API 保存 Key；自定义地址使用独立会话凭据');
            const key = supplied || (this.protectedKey ? this.key : undefined);
            if (!key) throw new Error('请输入需要安全保存的 Key');
            await this.vault.save(key); this.key = key; this.protectedKey = true; this.credential.saved = true; this.credential.storage = 'secure';
          } else {
            if (this.store.state.config?.baseUrl !== config.baseUrl || this.store.state.config?.provider !== config.provider) { this.key = ''; this.protectedKey = false; }
            if (supplied !== undefined) {
              if (this.vault) { await this.vault.delete(); this.credential.saved = false; }
              this.key = supplied; this.protectedKey = false;
            } else if (this.vault && officialDeepSeek(config) && !this.key) {
              const restored = await this.vault.load(); if (restored) { this.key = restored; this.protectedKey = true; this.credential.saved = true; }
            }
          }
          this.store.state.config = { ...config }; delete this.credential.error;
        }
        await this.store.save(); this.publish({ type: 'changed' }); return {};
      } finally { this.keyChanging = false; this.publish({ type: 'changed' }); }
    }
    const session = this.session(command.sessionId);
    if (command.type === 'session.archive' || command.type === 'session.restore') {
      this.idle(session.id);
      if (command.type === 'session.archive') {
        session.archivedAt ??= new Date().toISOString();
        if (this.store.state.selectedId === session.id) this.store.state.selectedId = this.store.state.sessions.find(s => !s.archivedAt && s.projectId === session.projectId)?.id;
      } else {
        delete session.archivedAt;
        if (session.projectId) this.project(session.projectId).collapsed = false;
      }
      await this.store.save(); this.publish({type: 'changed'}); return {};
    }
    if (session.archivedAt) throw new Error('此对话已归档，请先恢复后再操作');
    if (command.type === 'browser.connect') {
      this.idle(session.id); this.busy.add(session.id);
      let browser = this.browsers.get(session.id);
      if (!browser) { browser = new BrowserSession(() => this.publish({ type: 'changed' }), this.browserFactory); this.browsers.set(session.id, browser); }
      try { await browser.connect(); } finally { this.busy.delete(session.id); }
      return { snapshot: this.snapshot() };
    }
    if (command.type === 'browser.disconnect') {
      const agent = this.agents.get(session.id); if (agent?.activeRunId) agent.cancel(agent.activeRunId);
      await this.browsers.get(session.id)?.disconnect();
      return { snapshot: this.snapshot() };
    }
    if (command.type === 'preview.claim') return {preview:this.previews.claim(session.id,command.ticket)};
    if (command.type === 'preview.complete') { this.previews.complete(session.id,command.ticket,command.accepted);return {}; }
    if (command.type === 'session.select') this.store.state.selectedId = session.id;
    else if (command.type === 'session.rename') session.title = command.title;
    else if (command.type === 'workspace.grant') {
      if (session.projectId) throw new Error('项目会话继承项目目录，不能单独更改授权');
      this.idle(session.id); const workspace = await WorkspaceFiles.grant(command.path, this.store.directory); this.idle(session.id); if (session.archivedAt) throw new Error('此对话已归档，请先恢复后再操作'); session.workspace = workspace.root;
    } else if (command.type === 'workspace.revoke') { if (session.projectId) throw new Error('项目会话继承项目目录，不能单独撤销授权'); this.idle(session.id); delete session.workspace; }
    else if (command.type === 'files.list') return { entries: await (await this.workspace(session)).list(command.path) };
    else if (command.type === 'files.read') return { file: await (await this.workspace(session)).read(command.path) };
    else if (command.type === 'run.cancel' || command.type === 'run.approve') {
      const agent = this.agents.get(session.id);
      if (!agent || agent.activeRunId !== command.runId) throw new Error('没有匹配的运行任务');
      if (command.type === 'run.cancel') { agent.cancel(command.runId); await this.browsers.get(session.id)?.disconnect('任务取消，浏览器已关闭'); } else agent.approve(command.runId, command.callId, command.allowed);
      return {};
    } else {
      this.idle(session.id); this.busy.add(session.id);
      try {
        let prompt: string, maxSteps = 8, provider: ModelProvider | GenerationProvider;
        if (command.type === 'files.write') {
          const workspace = await this.workspace(session); await workspace.resolve(command.path, true);
          prompt = `手动保存文件：${command.path}`;
          provider = { generate: async messages => messages.some(m => m.role === 'tool') ? { text: '文件保存流程结束，请查看工具结果。' } : { text: '', calls: [{ id: randomUUID(), name: 'files_write', args: { path: command.path, content: command.content } }] } };
        } else {
          provider = this.provider();
          if (command.type === 'run.retry') {
            const previous = this.events.filter(e => e.sessionId === session.id);
            const last = previous.findLast(e => e.type === 'started');
            if (!last || !previous.some(e => e.runId === last.runId && ['failed', 'cancelled'].includes(e.type))) throw new Error('没有可重试的失败或取消任务');
            if (previous.some(e => e.runId === last.runId && e.type === 'tool_requested' && !['files_read', 'files_list'].includes(String(e.data.name)))) throw new Error('此任务已经请求过工具，不能自动重放；请检查执行结果后发送新指令');
            if (String(last.data.prompt).startsWith('手动保存文件：')) throw new Error('请重新打开文件编辑器确认写入内容');
            prompt = String(last.data.prompt); maxSteps = Number(last.data.maxSteps);
          } else { prompt = command.prompt; maxSteps = command.maxSteps; }
        }
        const tools = new Registry<Tool>(); tools.register('open_webpage', this.previews.tool(session.id)); tools.register('read_webpage', pageReadTool(session.id, () => this.store.state.selectedId, this.desktop)); if (session.workspace || session.projectId) for (const tool of (await this.workspace(session)).tools(this.desktop)) tools.register(tool.name, tool);
        for (const tool of this.browsers.get(session.id)?.tools() ?? []) tools.register(tool.name, tool);
        const conversation = new ConversationStore(this.store.directory, session.id);
        const history: Message[] = command.type === 'files.write' ? [] : (await conversation.read()) ?? this.events.filter(e => e.sessionId === session.id && (e.type === 'started' || e.type === 'assistant')).slice(-30).map(e => ({ role: e.type === 'started' ? 'user' : 'assistant', text: String(e.data.prompt ?? e.data.text) }));
        const runKey = this.key, redactRun = (text: string) => runKey ? text.split(runKey).join('[REDACTED]') : text;
        const agent = new Agent(provider, tools, this.log(session.id), event => {
          if (event.type === 'started') session.activeRunId = event.runId;
          this.events.push(event); session.updatedAt = event.at; this.publish({ type: 'event', event });
        }, session.id, redactRun, runKey.length, command.type === 'files.write' ? undefined : messages => conversation.save(messages, redactRun));
        this.agents.set(session.id, agent);
        // No shared await gap after claiming busy: all commands for this session stay isolated.
        const task = agent.run(prompt, maxSteps, history).catch(() => this.publish({ type: 'disconnected', message: '日志写入失败，请检查数据目录；任务已停止。' })).finally(async () => {
          this.agents.delete(session.id); this.busy.delete(session.id); delete session.activeRunId;
          await this.store.save().catch(() => {}); this.publish({ type: 'changed' });
        });
        this.tasks.add(task); void task.finally(() => this.tasks.delete(task));
        return {};
      } catch (error) { this.busy.delete(session.id); throw error; }
    }
    await this.store.save(); this.publish({ type: 'changed' }); return {};
  }
  async shutdown() { for (const agent of this.agents.values()) if (agent.activeRunId) agent.cancel(agent.activeRunId); this.key = ''; await Promise.all([...this.browsers.values()].map(browser => browser.disconnect('Host 已关闭'))); await Promise.allSettled([...this.tasks]); await this.store.save(); }
}
