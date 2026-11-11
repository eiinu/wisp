# 模型接入

## 一个入口，一个 Agent loop

`packages/core/src/index.ts` 定义 `ModelProvider.listModels({signal})` 和 `stream(request,{signal})`，使用统一 Message、ToolSpec、ModelEvent、ModelUsage。provider 只生成，不持有工具执行函数或审批权。`agent.ts` 是唯一事件消费者/工具执行循环；思考增量不广播到 Renderer。

`pi.ts` 的 `configuredProvider` 是现有配置入口。DeepSeek 转交 `deepseek.ts`，百度千帆转交 `qianfan.ts`；两者复用 `chat-completions.ts` 的流解析、错误与工具增量逻辑，按各自协议组装参数。其他兼容服务继续使用已安装的官方 pi-ai。`model.ts` 将现有 pi-ai/离线诊断的 generate 接口转换为同一事件流，这是迁移适配边界，不是第二套运行循环。该兼容边界目前仅提供配置模型条目及文本/工具回复，不声称实现其他供应商的动态模型发现或全部推理、用量、错误语义；不支持的请求选项明确失败。

新增供应商实现同一接口，并在配置入口注册。当前接入范围为 Chat Completions，不支持 Responses、任意参数透传或自动 provider fallback。

## DeepSeek

使用原生 fetch + Chat Completions，默认 `https://api.deepseek.com`，Bearer 认证；不同时叠加 SDK 重试。UI 初始建议 `deepseek-flash`，模型 ID 可手填，设置中显式“保存并获取可用模型”访问 `/models`。查询的可选窗口、输出限制、模态和 effort 元数据保留，不按模型名字推断能力。默认开启 thinking / high，可显式关闭或选择 low/high/max。普通“保存”不发 API 请求。

SSE 增量 UTF-8 解码、CRLF、多 data 行、空帧及 keepalive 注释；文本/思考/工具增量独立，工具按 index 累积。只有完整 finish + `[DONE]` 才交付最终助手消息。结束帧先读 usage；cache hit/miss 属于 input 子集，reasoning 属于 output 子集，不重复加总。所有原始 finish reason 保留，只有 stop/tool_calls 允许 Agent 继续，length/content_filter/资源不足/aborted 等失败且不执行残缺工具调用。

HTTP 400/401/402/422 不重试；429/500/503 在没有语义输出时最多重试两次，250/500ms 退避，同一请求共享 11 分钟超时预算。已输出文本/思考/工具/用量后不隐式重放；提前 EOF、未知 transport 故障不自动重试。原始 HTTP status 和上游 error.code 保留，响应错误正文不进入日志。取消关闭本地 fetch/reader，不保证服务端停止或退款。模型发现单独受 Host 10 秒请求预算限制。

thinking 模式拒绝 required/具名 tool_choice；不发送 parallel_tool_calls。JSON object 模式不保证任意 JSON Schema。首版不提供 beta strict、图片输入、搜索接口或 Responses。

## 百度千帆 · 文心 5.5 Flash Preview

在设置 → 模型中选择“百度千帆 · 文心”，默认模型 **`ernie-5.5-flash-preview`**、API 地址 **`https://qianfan.baidubce.com/v2`**。在 API Key 字段填写千帆的 API Key（不是 AK/SK 或旧版 access_token），保存后即可发送任务。需自行在千帆开通模型及相关权限；API 按服务规则计费。不要把 Key 发到对话。

模型详情页资源 ID `am-abe18d298d70` 不是 API 的 model 值，也不要填写 OpenRouter 的 `baidu/` 前缀。请求为 `POST /v2/chat/completions`，使用 `Authorization: Bearer <API Key>`。可为明确的自建网关填写独立 HTTPS 地址，或用 loopback HTTP 做开发测试；更改提供商或地址不会携带原服务的 Key。

“保存并查看预置模型”展示的是本地核对过的预置条目，**不会访问 `/models`、验证 Key、查询账户权限或发起生成请求**；界面会明确提示未验证。没有臆造未核实的模型发现 API。

支持文本 SSE、工具调用增量与并行调用、工具结果回传、原有审批循环、取消、结束原因和最后一个 chunk 的 usage。请求 `stream_options.include_usage=true`；`parallel_tool_calls` 沿用官方默认，不额外传入。工具仅在完整 `finish_reason=tool_calls` 与 `[DONE]` 后进入审批。JSON object 输出可由统一接口显式请求；不提供任意 JSON Schema 参数透传。

不向千帆发送 DeepSeek 的 `thinking`、`reasoning_effort`，也不猜测 5.5 的 `enable_thinking` 开关；当前设置中不展示这些选项，直接传入会被拒绝。如果服务返回 `reasoning_content`，沿用 Host 私有续接与脱敏存储，只对完全相同的提供商/模型/地址回传，不把原始推理广播到界面或诊断日志。

不把模型页列出的上下文/输出上限设置成默认 `max_tokens`，不承诺完整 1M 上下文可在当前 Wisp 会话限制内使用。图片输入、百度托管搜索、多模态和 API 撤屏/历史回撤语义尚未接入；遇非 0 的流式 `flag` 时停止本轮并拒绝工具执行，不承诺回撤已经显示的历史片段。

**密钥仅会话保存**：千帆 Key 只在 Host 内存中使用，重启需重填；配置、事件及私有会话中的已知 Key 均脱敏，不扩展既有 DeepSeek 专属钥匙串槽。不会自动读取环境变量或其他服务凭据；跨提供商不会恢复保存的 DeepSeek Key。现有单 Key 模式下输入新的会话 Key 会清除原槽中的已保存凭据，删除 Key 也清除当前内存与既有保存项。

2026-11-11 核对的百度官方来源：

- [模型列表（含 API 接入点 ID）](https://cloud.baidu.com/doc/qianfan/s/rmh4stp0j)
- [文本生成 API、鉴权、流式与工具参数](https://cloud.baidu.com/doc/qianfan-api/s/3m7of64lb)
- [API Key 鉴权说明](https://cloud.baidu.com/doc/qianfan-api/s/ym9chdsy5)
- [Function Calling](https://cloud.baidu.com/doc/qianfan-docs/s/xm95lyys5)
- [用户提供的模型详情页](https://console.bce.baidu.com/qianfan/modelcenter/model/buildIn/detail/am-abe18d298d70)

模型列表已包含 5.5；教程支持模型清单更新较慢，不能据旧教程假定所有思考扩展参数都适用。控制台详情页的自动抓取未成功，API ID 另由公开官方模型列表核实。

### 千帆验证范围

只使用假 Key、模拟 SSE 和 loopback HTTP：覆盖字节级 UTF-8、并行工具增量、完整结束校验、审批批准/拒绝、取消无重试、Host 重启续接、跨来源推理隔离、原生错误代码、内容过滤信号、用量和凭据脱敏。共用流实现的原有 DeepSeek 回归保留。

`pnpm build` 后可运行 `node scripts/verify-qianfan.mjs`：实际启动 Electron 与编译后的 Host，用临时用户目录和假 Key 验证提供商选择、默认 ID/地址、私有 IPC 保存及预置模型展示；不生成模型请求。截图和 JSON 报告保存在打印的临时目录。Linux 容器验证使用 headless 与测试专用 `--no-sandbox` 参数，产品配置仍保留 `sandbox:true`；不等于 macOS 图形安装实测。

没有使用真实用户密钥，没有付费请求；线上账户权限、服务端效果、限流及 Preview 后续变更均未实测。

## 会话与凭据

完整模型消息（含助手工具调用、对应 tool_call_id 结果、所有助手轮次的 reasoning_content）写入 `private-conversations/<session>.json`，目录 0700、文件 0600、临时文件原子替换。它是 Host 私有会话状态，**不在 JSONL 诊断日志/快照/Renderer 持久化中**。这是文件权限保护，不是磁盘加密；同一操作系统用户仍可读取。不存在保护该用户免受其自身恶意进程的承诺。

续传带 provider/protocol/model/endpoint 来源，只对完全匹配的供应商请求回传；DeepSeek 无 tools 时不传 reasoning。开启思考且带工具时遇到缺失或不同来源的旧助手历史，明确报 `incompatible_history_start_new_session`，请新建会话，不伪造空推理。旧版 JSONL 不包含推理，因此不能完整迁移旧会话。不会静默删除或压缩长会话；超出上下文窗口由提供商报错，长期压缩待实现。

每条助手工具调用在执行前保存，工具结果随后保存；重启遇到未决调用会补“结果未知、禁止重做”结果，不重放工具或批准。发生副作用后崩溃无法承诺 exactly-once；需用户检查实际结果。失败重试按钮拒绝已有非只读工具请求的任务；仅 files_read/files_list 可安全重试。API transport 重试仅重新生成下一条模型消息，不重复执行上一轮工具。

保留的 Web/Host 调试入口仅将 API Key 留在 Host 内存，不作为生产 Web 版本；新模型能力无需为纯 Web 适配。桌面版可选择通过 Electron 系统 safeStorage 加密保存官方 DeepSeek Key，Host 重启后经私有 IPC 读取；配置/事件/私有会话都不保存它。已知当前密钥在持久化字符串中脱敏。删除清除密文和内存；更换提供商/地址不携带已存官方 Key，切回官方地址可恢复。系统安全存储失败不明文降级。不自动读取环境或其他凭据。

## 验证范围与来源

离线夹具覆盖字节切分、结束帧用量、多工具交错、错误/终止分类、超时/取消/提前 EOF、参数拒绝、两轮以上推理续传、重启、私有数据和退避不重复副作用。真实 loopback HTTP 还验证取消连接，以及 Runtime → DeepSeek 适配 → 审批 → 临时目录写入 → Host 重启续传。没有真实 DeepSeek 密钥或付费请求；GUI 改动仅做类型/构建检查，不能声称实机 API 或视觉验收。

2026-10-30 核对官方文档：[Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)、[模型发现](https://api-docs.deepseek.com/api/list-models/)、[思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)、[错误码](https://api-docs.deepseek.com/quick_start/error_codes/)、[缓存](https://api-docs.deepseek.com/guides/kv_cache/)、[限流与 keepalive](https://api-docs.deepseek.com/quick_start/rate_limit/)。工具调用指南页面抓取超时，工具消息结构依据可读取的 Chat Completions 与思考模式规范核对。

## 图片输入

DeepSeek 视觉模型可接收本地图片，具体模型判断、产品限制与保存边界见[图片对话](./chat-images.md)。兼容适配器仍仅提供文字输入，不能静默忽略图片。
