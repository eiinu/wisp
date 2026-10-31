# Wisp

本机个人 Agent 工作台：TypeScript / ESM、Electron、React + Vite、独立 Node Host、pi-ai、MCP 接口、JSONL、pnpm 与 Vitest。各模块通过显式依赖协作。

界面采用简洁中性色、紧凑会话侧栏、对话中心与按需展开的文件/网页面板。

## 运行

需要 Node.js >= 22.19、pnpm 11.25.0。

```sh
pnpm install --frozen-lockfile
pnpm web
```

`pnpm web` 构建 UI 与 Host，然后启动 **127.0.0.1:5180** 的完整工作台。打开终端给出的本机连接链接；片段中的随机令牌只存页面内存并立即从地址栏移除。服务仅限本机，不适用于跨设备分享。`WISP_PORT` 可指定端口，`WISP_DATA_DIR` 可指定数据目录（默认项目下 `.wisp`）。同一数据目录只运行一个 Host 实例。

- **Electron**：`pnpm start`。Electron 二进制未安装时，执行官方安装器 `pnpm exec install-electron`。需要可用图形环境，不能关闭沙箱来启动。
- **UI 开发**：`pnpm web:dev` 在 127.0.0.1:5173 启动 Vite。独立 UI 不连接 Host，会明确显示未连接；不会生成假的工具执行。
- **可移交的静态 UI**：`pnpm web:build` → `apps/desktop/web-preview-dist`。用本地 HTTP 服务查看。静态托管没有 Host，文件/任务功能不可用；可查看设置和网页面板。

默认没有模型配置，不会自动使用 Mock。打开“模型与设置”，可选 DeepSeek、OpenAI 兼容 Chat Completions 接口，或明确选择“离线验证”。真实模型支持提供商、模型 ID、Base URL 和 API Key；普通保存配置不发请求；DeepSeek 可显式查询可用模型，点击发送才调用生成接口。

## macOS 安装包

在 GitHub Actions 中选择 **Build macOS arm64 → Run workflow**，手动生成单个 Apple Silicon arm64 DMG。文件名按提交时间（北京时间）命名，例如 `Wisp-macos-arm64-202610311146.dmg`，产物从该运行的 Artifacts 下载；不会自动创建 Release。当前为无 Developer ID、未公证的测试构建。详见 [打包与下载说明](docs/packaging.md)。

## 实际使用流程

1. 创建独立会话，或在侧栏新建项目并授权文件夹，在项目下创建会话。项目会话自动继承项目目录；历史和运行状态仍按会话隔离，支持展开/收起、重命名与重启恢复。见 [本地项目](docs/projects.md)。
2. 配置模型。桌面版可将 DeepSeek 官方 Key 通过系统 safeStorage 加密保存在本机，重启自动恢复；Web 版仅会话保存。页面输入提交后清空，不进入 localStorage、state.json、JSONL 或快照。更换提供商/地址会清除活动凭据，不向第三方转发已保存 Key。删除按钮同时删除本地密文和内存 Key。安全存储不可用时不自动明文降级。
3. 独立会话在文件面板明确授权绝对工作目录；项目会话无需再次授权。Electron 可用系统目录选择器，Web 输入本机路径并确认。
4. 浏览文件、读取文本/Markdown/图片。编辑或新建文本时，提交的是**写入审批请求**；聊天中的批准按钮才执行真实写入。模型的文件写入也走同一审批边界。
5. 主对话支持流式回复、折叠工具过程、批准/拒绝、取消、失败重试、复制、Enter 发送/Shift+Enter 换行、Ctrl/Cmd+N 新会话。
6. 网页面板加载你选择的 HTTP(S) 链接，使用隔离 iframe；可以显式打开外部浏览器。它只展示网页，不代表 Agent 已读取或自动操作网页。Playwright MCP 的 Host 接入已实现，但默认禁用；当前 UI 启用按钮和动态状态尚待接线，见下节。静态预览仍不连接 Host。

离线验证使用同一个 Host/Agent/文件工具链，无第二套浏览器状态机。可输入：

```text
列出文件
读取 README.md
写入 notes.txt
这里是待批准的文本内容。
```

离线模式不会生成智能模型答案；实际读写仍发生在已授权工作目录中。

## 边界与数据

- `packages/core/src/index.ts`：受限请求、事件、会话、文件和桥接契约。
- `apps/host/src/runtime.ts`：唯一工作台业务入口；会话隔离，拒绝未知会话/过期审批/执行中更换目录，内存密钥管理。
- `agent.ts`：单会话单任务，多会话可各自执行；默认 8 步，上限 20 步，每步最多 8 次工具调用。AbortSignal 向模型和工具传递，取消后不再调度；已完成的外部副作用不能撤销。不配合取消的外部工具不保证被强制终止，目前只注册协作的本地文件工具。
- `files.ts`：只接受授权根内相对路径；隐藏文件、`..`、绝对路径、符号链接、硬链接及 Host 私有数据受限；不提供任意 shell。文本写入采用同目录临时文件与原子替换，完整内容需批准。目录列表最多 500 项，预览最多 2 MB，单次写入最多 200 KB，不自动创建缺失父目录。权限检查不等同于操作系统沙箱，不能防御同时恶意修改目录树的其他本机进程。
- `state.ts` / `log.ts`：`state.json` 保存无密钥的会话/模型元数据；`sessions/<uuid>.jsonl` 保存事件。重启将未完成任务标为中断，不重放工具或沿用批准。损坏日志明确报错，不静默删除。对话和文件工具结果属于本地明文日志；尚无轮转或加密。完整模型上下文及推理续传另存 Host 私有 `private-conversations/<uuid>.json`（0600），不包含在快照/事件日志中；尚无长会话压缩。旧会话仅能从日志恢复文本，开启 DeepSeek 思考工具模式需新建会话。
- `pi.ts`：官方 `@earendil-works/pi-ai@1.4.0`，`Models.streamSimple` 流式路径与显式配置。保留 OpenAI 兼容文本/工具路径；DeepSeek 使用同一模型入口下的专用 Chat Completions 适配，见 [模型模块说明](docs/models.md)。不提供所有供应商的专有参数。
- `http.ts`：loopback、精确 Host 与 Origin、随机 Bearer 令牌、受限 JSON POST 和带认证的事件流；无通配 CORS，不提供远程工具服务。请求凭据不写日志。
- `apps/desktop/src`：独立 Host 子进程，受限 IPC，来源和主 frame 检查，Renderer 无 Node 权限，沙箱开启。外部链接仅接受显式用户请求的 HTTP(S) URL。
- `apps/desktop/ui`：Web/Electron 共用工作台，不在浏览器里模拟 Host。
- `mcp.ts` / `browser.ts`：官方 Playwright MCP stdio 接入，每会话独立隔离浏览器；显式连接后注册受限工具，全部经过 Host 审批。工具名使用模型兼容的字母/数字/下划线格式。

对话与文件 Markdown 统一使用 react-markdown + remark-gfm，支持段落、标题、列表、代码块、表格、任务列表与安全链接；不执行原始 HTML、不自动加载外部图片。扩展与文本预览边界见 [Markdown 文档](docs/markdown.md)。图片预览仅支持 PNG/JPEG/GIF/WebP。网页可能被目标站点的嵌入策略拒绝；静态预览不能绕过该策略。

## 验证

```sh
pnpm typecheck
pnpm build
pnpm web:build
pnpm test
git diff --check
```

测试包括 Agent 审批/取消/预算、会话隔离、真实临时目录读写、目录逃逸与链接、密钥内存边界/跨流式片段脱敏、失败重试、独立 Host IPC 重启恢复、loopback HTTP 鉴权/来源/Host/事件流，以及 pi-ai 官方 Faux Provider 和**本机假 API** 流式集成。后者验证真实适配链路，但不是外部提供商验收。

安装脚本保护保持开启，仅批准已审查版本：`esbuild@0.27.7`（平台编译器安装/验证）、`protobufjs@7.6.6`（版本检查）、`@google/genai@2.21.0`（空操作提示），见 `pnpm-workspace.yaml`。没有全局放开脚本。

尚待验收/实现：真实用户模型 API、Electron GUI/跨平台打包、浏览器自动化的 UI 接线与 Chromium 实机验收、长期上下文压缩、日志轮转。当前环境 Chromium 沙箱配置故障，不关闭沙箱；Web 构建 ZIP 可交给受支持的云端浏览器做真实视觉验收。未连接 Host 的静态截图不能作为本机执行链路已连接的证据。

相关文档：[pi-ai](https://github.com/earendil-works/pi/tree/main/packages/ai)、[Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)。


## 浏览器自动化：Host 接入与界面接线

已固定官方 `@playwright/mcp@0.0.83`，通过 stdio 启动，不开 MCP HTTP 端口，不使用 npx 动态下载。默认关闭。界面可通过同一个受限桥接发送：

```ts
await bridge.request({ type: 'browser.connect', sessionId, confirmed: true });
await bridge.request({ type: 'browser.disconnect', sessionId });
```

`snapshot.browserSessions[sessionId]` 返回 `disabled / connecting / connected / failed`、工具数和提示；`snapshot.browserConnected` 表示当前选中会话。`changed` 通知触发重新读取快照。浏览器设置界面尚未绑定连接操作和动态状态，目前显示“未连接”。

只有 MCP 握手、工具发现、实际 `about:blank` 启动探测都成功，才报告 `connected`。连接失败会关闭 transport 并清理临时目录，保留失败状态，不自动重试。若本机已有 Chromium，可启动时设置 `WISP_CHROMIUM_PATH` 指向其可执行文件；它不接受 Renderer/模型传入的路径、命令或启动参数。缺少浏览器时由用户在本机按官方 Playwright MCP 安装说明准备，不自动安装，不关闭 sandbox。

启动固定启用 `--sandbox --headless --isolated --no-webmcp --block-service-workers`；不接已有 CDP 端点、不读取用户浏览器资料或账号。仅暴露导航、返回、页面快照、点击、输入、按键、选择、等待、标签页和悬停；不暴露代码执行、文件上传、存储导入、安装工具或任意输出文件参数。导航只接受无凭据的 HTTP(S)，每次调用即使是快照也必须批准。临时输出仅留在该连接自己的临时目录，不授予 MCP 用户工作目录。

取消会向 MCP 传播 AbortSignal 并关闭此会话的浏览器；断开、Host 退出、连接失败都会关闭 transport 与隔离浏览器并删除临时输出。重新启用需要再次明确连接。其他会话不受影响。关闭不能撤销已完成的网页操作；网页内容仍是不可信输入，点击、输入、提交等动作须由用户审阅。

Agent 仅向 provider 提供工具定义，不暴露 `execute` 或审批属性；审批前复制并冻结工具调用参数，并固定执行函数，防止等待批准时替换内容。MCP 参数也复制后发出。目录授权、写入审批、路径边界保持原有测试。

浏览器测试覆盖官方 MCP **真实握手/工具发现（没有调用浏览器启动）**、官方 SDK 离线协议夹具的连接/失败/取消/异常断开/清理与会话隔离、审批参数替换攻击测试。实际 Chromium 页面自动化仍需在支持浏览器沙箱的环境中验收。

## 开发模拟与本地凭据

运行 `pnpm web:simulate`：启动当前 Web UI、真实 Host、独立本机模拟 Chat Completions 服务和新建临时工作目录；不接触真实模型或 Key。工作台默认仅监听 127.0.0.1:5190。按终端显示的本机链接打开，输入 `[demo:write]` / `[demo:deny]` / `[demo:cancel]` 等场景。模拟状态显式标记，Host 拒绝用户输入真实 Key。详见 [开发验证记录](docs/development-validation.md)。

桌面凭据通过 Electron 主进程 safeStorage 加密，只将密文写入 `credentials/deepseek.enc`（0600）。Host 与主进程使用私有 IPC，Renderer 只获得已配置/已保存状态。Linux basic_text/unknown 拒绝使用，无明文降级；不需要云端中转。当前锁定 Electron 45，同步 safeStorage API 已弃用但仍受支持，升级到 46 前需迁移并验证异步后端的安全能力。各平台钥匙串实机行为尚未验收。
