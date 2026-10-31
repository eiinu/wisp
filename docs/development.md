# 开发与运行

技术栈：TypeScript / ESM、Electron、React + Vite、独立 Node Host、pi-ai、MCP、JSONL、pnpm 与 Vitest。模块通过显式依赖协作，Web 与桌面共用工作台 UI。

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

默认没有模型配置，不会自动使用 Mock。打开独立设置页的模型区域，可选 DeepSeek、OpenAI 兼容 Chat Completions 接口，或明确选择“离线验证”。真实模型支持提供商、模型 ID、Base URL 和 API Key；普通保存配置不发请求；DeepSeek 可显式查询可用模型，点击发送才调用生成接口。

## 使用与离线验证

在侧栏创建普通会话，或新建项目并授权目录；项目会话继承项目目录。独立会话须先在文件区域授权工作目录，Electron 使用系统目录选择器，Web 输入本机路径并确认。文件读取、编辑和审批的边界见 [项目](projects.md) 与 [工具调用](chat-tools.md)。

主对话支持 Enter 发送、Shift+Enter 换行、Ctrl/Cmd+N 新会话。离线验证使用同一 Host/Agent/文件工具链，可输入：

```text
列出文件
读取 README.md
写入 notes.txt
这里是待批准的文本内容。
```

离线模式不生成智能模型答案；实际读写发生在授权目录，写入仍需审批。`pnpm web:simulate` 则启动真实 Web/Host 和独立本机模拟 API，默认监听 127.0.0.1:5190，使用临时目录与假凭据，拒绝真实 Key。启动、恢复及场景见 [开发模拟验证](development-validation.md)。

## 架构、权限与数据

- `packages/core/src/index.ts`：受限请求、事件、会话、文件和桥接契约。
- `apps/host/src/runtime.ts`：唯一工作台业务入口；会话隔离，拒绝未知会话/过期审批/执行中更换目录，内存密钥管理。
- `agent.ts`：单会话单任务，多会话可各自执行；默认 8 步，上限 20 步，每步最多 8 次工具调用。AbortSignal 向模型和工具传递，取消后不再调度；已完成的外部副作用不能撤销。不配合取消的外部工具不保证被强制终止，内置工具能力和审批策略见 [主对话工具调用](chat-tools.md)。
- `files.ts`：只接受授权根内相对路径；隐藏文件、`..`、绝对路径、符号链接、硬链接及 Host 私有数据受限；不提供任意 shell。文本写入采用同目录临时文件与原子替换，完整内容需批准。目录列表最多 500 项，预览最多 2 MB，单次写入最多 200 KB，不自动创建缺失父目录。权限检查不等同于操作系统沙箱，不能防御同时恶意修改目录树的其他本机进程。
- `state.ts` / `log.ts`：`state.json` 保存无密钥的会话/模型元数据；`sessions/<uuid>.jsonl` 保存事件。重启将未完成任务标为中断，不重放工具或沿用批准。损坏日志明确报错，不静默删除。对话和文件工具结果属于本地明文日志；尚无轮转或加密。完整模型上下文及推理续传另存 Host 私有 `private-conversations/<uuid>.json`（0600），不包含在快照/事件日志中；尚无长会话压缩。旧会话仅能从日志恢复文本，开启 DeepSeek 思考工具模式需新建会话。
- `pi.ts`：官方 `@earendil-works/pi-ai@1.4.0`，`Models.streamSimple` 流式路径与显式配置。保留 OpenAI 兼容文本/工具路径；DeepSeek 使用同一模型入口下的专用 Chat Completions 适配，见 [模型模块说明](models.md)。不提供所有供应商的专有参数。
- `http.ts`：loopback、精确 Host 与 Origin、随机 Bearer 令牌、受限 JSON POST 和带认证的事件流；无通配 CORS，不提供远程工具服务。请求凭据不写日志。
- `apps/desktop/src`：独立 Host 子进程，受限 IPC，来源和主 frame 检查，Renderer 无 Node 权限，沙箱开启。外部链接仅接受显式用户请求的 HTTP(S) URL。
- `apps/desktop/ui`：Web/Electron 共用工作台，不在浏览器里模拟 Host。
- `mcp.ts` / `browser.ts`：官方 Playwright MCP stdio 接入，每会话独立隔离浏览器；显式连接后注册受限工具，全部经过 Host 审批。工具名使用模型兼容的字母/数字/下划线格式。

对话与文件 Markdown 统一使用 react-markdown + remark-gfm，支持段落、标题、列表、代码块、表格、任务列表与安全链接；不执行原始 HTML、不自动加载外部图片。扩展与文本预览边界见 [Markdown 文档](markdown.md)。图片预览仅支持 PNG/JPEG/GIF/WebP。Web iframe 可能被目标站点的嵌入策略拒绝；详见 [浏览工作区](browser-workspace.md)。

桌面凭据仅将密文写入 userData 下 `credentials/deepseek.enc`（0600），通过私有 IPC 供 Host 使用；Renderer 不回显已存 Key。macOS 使用异步 safeStorage，未存凭据时不探测或解锁钥匙串；其他平台检查安全后端，Linux basic_text/unknown 不允许持久保存。安全设施不可用时可明确选择仅会话保存，不自动明文降级。详见 [模型接入](models.md) 和 [凭据验证](development-validation.md#凭据行为)。

## 检查

```sh
pnpm typecheck
pnpm build
pnpm web:build
pnpm test
git diff --check
```

测试包括 Agent 审批/取消/预算、会话隔离、真实临时目录读写、目录逃逸与链接、密钥内存边界/跨流式片段脱敏、失败重试、独立 Host IPC 重启恢复、loopback HTTP 鉴权/来源/Host/事件流，以及 pi-ai 官方 Faux Provider 和**本机假 API** 流式集成。后者验证真实适配链路，但不是外部提供商验收。

安装脚本保护保持开启，仅批准已审查版本：`esbuild@0.27.7`（平台编译器安装/验证）、`protobufjs@7.6.6`（版本检查）、`@google/genai@2.21.0`（空操作提示），见 `pnpm-workspace.yaml`。没有全局放开脚本。

验证报告应区分单元/协议测试、Web 组件走查与 Electron 实机行为。真实模型 API、系统钥匙串、原生网页与下载需在相应环境验证；静态预览没有 Host，不能作为本机执行成功的证据。长期上下文压缩与日志轮转尚未实现。浏览器测试需要支持 Chromium 沙箱的环境，不应关闭沙箱来通过验证。

相关文档：[pi-ai](https://github.com/earendil-works/pi/tree/main/packages/ai)、[Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)。

## 专题文档

- [macOS arm64 打包、下载与签名状态](packaging.md)
- [浏览工作区及 Web 限制](browser-workspace.md)
- [Playwright MCP 接入与生命周期](browser-automation.md)
- [界面验证记录](ui-verification.md)
