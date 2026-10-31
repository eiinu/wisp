# Playwright MCP 接入

已固定官方 `@playwright/mcp@0.0.83`，通过 stdio 启动，不开 MCP HTTP 端口，不使用 npx 动态下载。默认关闭。界面可通过同一个受限桥接发送：

```ts
await bridge.request({ type: 'browser.connect', sessionId, confirmed: true });
await bridge.request({ type: 'browser.disconnect', sessionId });
```

`snapshot.browserSessions[sessionId]` 返回 `disabled / connecting / connected / failed`、工具数和提示；`snapshot.browserConnected` 表示当前选中会话。`changed` 通知触发重新读取快照。设置页的连接区域会显示当前会话的状态与提示，但尚未提供连接/断开操作入口，默认显示“未连接”。

只有 MCP 握手、工具发现、实际 `about:blank` 启动探测都成功，才报告 `connected`。连接失败会关闭 transport 并清理临时目录，保留失败状态，不自动重试。若本机已有 Chromium，可启动时设置 `WISP_CHROMIUM_PATH` 指向其可执行文件；它不接受 Renderer/模型传入的路径、命令或启动参数。缺少浏览器时由用户在本机按官方 Playwright MCP 安装说明准备，不自动安装，不关闭 sandbox。

启动固定启用 `--sandbox --headless --isolated --no-webmcp --block-service-workers`；不接已有 CDP 端点、不读取用户浏览器资料或账号。仅暴露导航、返回、页面快照、点击、输入、按键、选择、等待、标签页和悬停；不暴露代码执行、文件上传、存储导入、安装工具或任意输出文件参数。导航只接受无凭据的 HTTP(S)，每次调用即使是快照也必须批准。临时输出仅留在该连接自己的临时目录，不授予 MCP 用户工作目录。

取消会向 MCP 传播 AbortSignal 并关闭此会话的浏览器；断开、Host 退出、连接失败都会关闭 transport 与隔离浏览器并删除临时输出。重新启用需要再次明确连接。其他会话不受影响。关闭不能撤销已完成的网页操作；网页内容仍是不可信输入，点击、输入、提交等动作须由用户审阅。

Agent 仅向 provider 提供工具定义，不暴露 `execute` 或审批属性；审批前复制并冻结工具调用参数，并固定执行函数，防止等待批准时替换内容。MCP 参数也复制后发出。目录授权、写入审批、路径边界保持原有测试。

浏览器测试覆盖官方 MCP **真实握手/工具发现（没有调用浏览器启动）**、官方 SDK 离线协议夹具的连接/失败/取消/异常断开/清理与会话隔离、审批参数替换攻击测试。实际 Chromium 页面自动化仍需在支持浏览器沙箱的环境中验收。

右侧内置浏览器的标签、导航、下载及只读网页工具独立于此 MCP 连接，见 [浏览工作区](browser-workspace.md) 与 [工具调用](chat-tools.md)。
