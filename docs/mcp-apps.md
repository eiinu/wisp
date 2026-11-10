# MCP Apps

Wisp 为已激活的 stdio 或 Streamable HTTP MCP 服务提供 MCP Apps 宿主。带有 `_meta.ui.resourceUri` 的工具经用户批准执行后，宿主从**同一连接**读取 `ui://` HTML，在独立隔离窗口显示交互界面；普通工具继续显示文本结果。此能力以 Electron 桌面端为准，Web 展示入口不运行 Apps。

## 接入 HTTP App

设置 → 本地 MCP → 添加服务，将传输方式选为 **Streamable HTTP**，填写服务 URL，保存后确认激活。例如用户在同一 Mac 启动的待办 demo 可填写 `http://127.0.0.1:3030/mcp`；`127.0.0.1` 指运行 Wisp 的电脑，不是另一个云环境。随后让助手调用 `show_todos`，批准工具后打开 App，新增/完成待办仍需分别确认。

HTTP 只允许 HTTPS 或 loopback HTTP，禁止 URL 凭据、查询参数、片段及重定向，不接受 stdio 的命令/参数/环境变量。当前无 OAuth、Bearer header 配置或重连；需认证的服务会连接失败。每次 HTTP 响应/流最多 4 MiB，超限关闭。没有更改 stdio 的既有安全存储绑定。

## 协议与 SDK

实现使用官方 `@modelcontextprotocol/ext-apps` **1.7.5**，与现有 MCP SDK **1.32.2** 配合，支持 Apps 协议 **2026-01-26**。截至 2026-11-10，ext-apps 最新版为 2.0.4，但要求 MCP SDK 2；本次没有同时迁移 MCP 传输层。协议不匹配时拒绝握手，不静默猜测兼容版本。

参考：[官方规范](https://github.com/modelcontextprotocol/ext-apps/blob/v1.7.5/specification/2026-01-26/apps.mdx)、[官方 SDK](https://github.com/modelcontextprotocol/ext-apps/tree/v1.7.5)、[MCP Apps 概览](https://apps.extensions.modelcontextprotocol.io/api/)。

| 能力 | 当前行为 |
| --- | --- |
| 能力协商 | 桌面 Host 声明 `io.modelcontextprotocol/ui` 与 `text/html;profile=mcp-app`；非桌面不声明 |
| UI 发现 | `_meta.ui.resourceUri`；兼容已弃用的 `_meta["ui/resourceUri"]`，优先使用新字段 |
| HTML 读取 | `resources/read`，仅接受同 URI、正确 MIME 的单个 text/base64 资源；HTML 至多 2 MB |
| 可见性 | 严格校验 `visibility`；默认 model/app，App-only 不进入模型工具目录，model-only 不允许 App 调用 |
| 初始化 | `ui/initialize` → 初始化响应 → `ui/notifications/initialized`；独立检查顺序，未就绪不能调用工具 |
| 输入与结果 | 初始化后依次发送一次完整 `tool-input`、完整 `tool-result`，包括 UI 所需 `structuredContent` 与 `_meta` |
| 工具调用 | App 的 `tools/call` 只可调用原服务当前工具；JSON Schema 校验、每次原生确认、超时/取消保护，不自动重试 |
| 服务资源 | App 的 `resources/read` 经逐次确认代理到原服务；不是宿主文件系统或 HTTP 读取接口 |
| 外链 | `ui/open-link` 只接受无用户名/密码的 HTTP(S) URL；逐次确认后交给系统浏览器 |
| 布局 | `inline` 布局的独立原生窗口，内容宽度固定 760，高度按 `size-changed` 在 240–900 之间调整 |
| 清理 | `ui/resource-teardown`，最长等待 1 秒；关闭、会话切换/归档、工具列表刷新、禁用、连接退出和 Host 退出均销毁实例 |
| 健康与日志 | `ping`；接收日志通知但不持久化第三方 UI 日志 |

`AppBridge` 不持有真实 MCP Client，不使用其自动转发。每个实例绑定服务连接及工具列表版本、原会话与结果；授权前、授权后和执行前后均校验，旧窗口不能借新连接执行操作。并发审批被拒绝，每实例消息限速；最多打开 8 个 App。

HTML、资源内容和 UI 专用 `_meta` 不进入模型消息或 JSONL。模型仍接收原有有界文本/结构化工具结果；App 加载失败保留文本结果，不重新执行工具。App 数据仅在内存保留，不在会话历史中恢复 UI。

## 隔离与权限

第三方 HTML 位于独立临时 Electron session 的 opaque-origin iframe 中，`sandbox="allow-scripts"`，没有 `allow-same-origin`、弹窗、表单、顶层导航或下载授权。第三方帧没有 Node、Electron、工作台 `window.wisp` 或宿主 preload。原生外壳的独立 preload 仅传递协议消息；主进程校验窗口与 mainFrame 来源，不能用于工作台 IPC。

宿主在解析不可信 HTML **之前**设置 CSP，并以 session 请求拦截作第二层限制。目前进一步限制为完全离线 UI：不授予 `connectDomains`、`resourceDomains`、`frameDomains`、`baseUriDomains` 中任何网络权限；只允许内联脚本/样式及 data/blob 图片/媒体，禁止 eval、外部脚本、远程字体和嵌套帧。后续 HTML 里的 CSP 不能放宽该策略。声明的设备权限也不获授权，能力响应返回实际授予的空权限。

因此需外网资源、跨域请求、嵌套网页、camera/microphone/geolocation/clipboard、持久存储或自定义 domain 的 App 当前不能完整运行。App 可以通过已审批的同服务工具/资源请求获取数据，不需要页面直接联网。MCP 服务进程本身仍是用户批准的本机进程，具有本机权限；隔离 UI 不会把服务进程变成项目沙箱。

暂不支持 `ui/message`、`ui/update-model-context`、App 暴露工具给宿主调用、文件下载、fullscreen/pip、输入参数流式预览或会话重启恢复；请求会明确失败，不注入模型上下文，不提升权限。窗口打开在工具完成后，因此初始失败结果可传递，但不展示执行中的参数或取消状态。

## 验证

`tests/mcp-apps.test.ts` 使用官方 App SDK 进行真实协议握手，验证输入/结果顺序、调用/资源代理、逐次拒绝、非法外链、未初始化访问、重复握手、连接过期、可见性、私有元数据和 UI 资源身份。原有 MCP 审批与进程测试保留。

Electron 验证脚本实际启动本机 stdio 服务，并加载官方 **v1.7.5** 的 Vanilla JS 示例与 Budget Allocator，验证界面渲染、时间刷新审批、图表和关闭；另以 ext-apps 2.0.4 + MCP Server 2.4.0 / Node adapter 2.1.2 建立 Streamable HTTP 合成 Todo 服务，验证 `show_todos` → `ui://todo/index.html`、`structuredContent.todos` 及逐次审批的 `add_todo` / `set_todo_done`。合成数据不来自用户项目，未连接或修改用户 Mac 的实际待办。攻击夹具尝试读取父页面、工作台/Node/preload、本地存储、顶层导航、弹窗及 HTTP fetch/图片/脚本/iframe；测试断言本地探针收到 0 个请求。

可复现命令（在仓库根执行，Node 22+，已安装工作区依赖和 Electron 二进制）：

```sh
git clone --depth 1 --branch v1.7.5 https://github.com/modelcontextprotocol/ext-apps.git /tmp/wisp-official-ext-apps
npm install --prefix /tmp/wisp-mcp-verification --no-audit --no-fund chart.js@4.4.9
npm install --prefix /tmp/wisp-mcp-sdk2 --no-audit --no-fund @modelcontextprotocol/ext-apps@2.0.4 @modelcontextprotocol/server@2.4.0 @modelcontextprotocol/node@2.1.2
node scripts/verify-mcp-apps.mjs /tmp/wisp-official-ext-apps /tmp/wisp-mcp-verification/node_modules/chart.js /tmp/wisp-mcp-sdk2/node_modules
```

脚本将构建、截图和 JSON 报告写入打印出的临时目录，不修改上游示例或用户仓库。Linux 云验证使用 Chromium headless 与测试专用 `--no-sandbox` 进程参数，以适应容器无显示服务/内核 sandbox 的环境；产品代码仍设置 Electron `sandbox: true`，iframe 与 CSP 实际执行并受测。此验证不证明 macOS 内核 sandbox 或所有第三方 App 的兼容性；macOS 打包和手动安装仍需单独验收。用户 Mac 上真实 Todo demo 的最终验收需在该 Mac 启动本分支 Wisp 并连接已有服务，云端无法用自己的 loopback 地址代替这一验证。
