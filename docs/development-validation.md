# 开发模拟验证记录

生产目标为 Electron 桌面端，纯 Web 仅用于 UI 展示和截图验证。本文保留已有 Web/Host 开发测试工具的运行记录，不代表生产 Web 支持；后续功能无需适配该入口。Host/API 模拟测试与 UI 样例都不能代替 Electron 端到端验收。

## 可重复运行

```sh
pnpm web:simulate
# 停止后恢复终端打印的同一模拟数据目录：
node apps/host/dist/dev.js /tmp/wisp-development-实际后缀
```

Web 默认 `127.0.0.1:5190`（`WISP_DEV_PORT` 可改），模型夹具首次分配空闲 loopback 端口并在 simulation.json 记录，恢复时保留相同 endpoint。打开终端输出的带一次性配对片段的本机链接。初次自动创建且只授权自己的临时 workspace；数据不会自动删除，便于验证重启。该链接不能从其他手机/电脑访问，不能把它当托管预览地址。

脚本服务位于 `apps/host/src/dev/simulator.ts`，只返回明确标识的协议测试输出，不执行工具、不访问第三方，不模拟智能理解。真实链路是现有 Web → 鉴权 HTTP → Runtime/Agent → DeepSeek adapter → 本机 SSE 模拟服务 → 真实文件工具。开发入口单独打包，普通 `pnpm web` 不启用它，也不静默回退。模拟 Host 锁定自动生成的假凭据，拒绝用户 model.save/clearKey，不会接收真实 Key。

发送单个场景标签：

| 输入 | 操作与预期 |
|---|---|
| `[demo:chat]` | 思考活动状态、分片文本、最终回复；思考原文留 Host 私有状态，不广播 UI |
| `[demo:write]` | 请求写 write.txt；批准前文件不存在，批准后读取到真实内容 |
| `[demo:deny]` | 拒绝写 deny.txt，文件仍不存在 |
| `[demo:cancel]` | 慢速文本，点击停止关闭模型 transport，不再生成或调用工具 |
| `[demo:retry]` | 写 retry.txt 后下一轮首次 503；仅重试模型请求，工具调用仍只有一次 |
| `[demo:error]` | 首次 400，不自动重试；点击失败重试后成功，无工具副作用 |
| `[demo:read]` | 实际读取该临时目录 README.md |

切换会话后原会话审批不能在另一个会话执行。重启使用相同模拟目录，选中会话、历史、目录及私有推理续传恢复，不沿用旧批准或重放工具。新会话不会自动获得工作目录，需明确授权。

## 凭据行为

桌面：输入官方 DeepSeek Key，勾选系统安全存储；加密密文仅保存在 Electron userData/credentials/deepseek.enc，主进程使用 OS 密钥，Host 内存解密使用。Key 不经过 Wisp 服务器，生成请求直接发官方 API。输入框从不填充已存 Key，只显示 •••• 与状态；删除同步移除密文及活动 Key。非官方 endpoint 不能保存/复用官方 Key，自定义服务必须单独提供会话凭据。请求禁止 HTTP 重定向。

现有 Web/Host 调试入口（非生产）：没有系统钥匙串能力，明确只保存当前进程，重启需重填；请求 rememberKey 会报错。安全存储不可用、Linux basic_text/unknown、加解密失败均不降级为明文。当前 macOS 使用异步 safeStorage，其他平台保留受安全后端检查的同步接口；平台保护差异见 [官方文档](https://www.electronjs.org/docs/latest/api/safe-storage)；当前未跨平台实机验证。测试仅使用独立假 OS 加密服务和假字符串，未读取任何真实凭据。

## 已验证与限制

`tests/simulation.test.ts` 从 Web 实际使用的鉴权 HTTP 边界开始验证以上所有场景、跨会话审批拒绝、重启恢复；这属于 Host/API 集成测试，**没有驱动浏览器 DOM**。`tests/credentials.test.ts` 验证保存、重启恢复、更换、删除、第三方地址隔离、安全存储失败及 Web 会话边界。其余原有 SSE 字节切分、路径/审批/预算测试继续运行。

浏览器 DOM 和各平台系统钥匙串尚需实机验收。静态 Web 构建可用于检查布局，但不包含 Host，不能替代完整交互验证。浏览器测试环境必须支持 Chromium 沙箱。
