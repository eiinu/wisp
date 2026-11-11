# 大历史记录下的交互性能验证

新建/归档对话会触发 snapshot 刷新，设置返回和输入草稿会触发 App 渲染。排查确认有三处 renderer 重复工作：

- snapshot 合并对每条旧事件遍历新事件，复杂度为 O(previous × incoming)。改用 Map/Set 后保留新 snapshot 优先、原顺序及刷新期间到达的 notice，复杂度为 O(previous + incoming)。
- 链接确认 Provider 每次渲染创建新 Context value，绕过 Markdown 的 memo，让未变化的历史重复解析。现在 value 只随确认的 blocked 状态改变；回调和待确认目标仍使用最新值。
- 每次 App 渲染过滤全量事件，并在每轮再次扫描当前会话事件、分组。现在按事件数组缓存会话索引和轮次分组，同时索引子任务所属父轮次；设置、草稿变化复用结果。工具执行分组也按 events 引用缓存。

## 复现和结果

在仓库根运行：

```sh
node scripts/benchmark-history.mjs
pnpm exec vitest run apps/desktop/ui/history.test.ts apps/desktop/ui/history-app.test.tsx apps/desktop/ui/link-confirmation.test.tsx
```

云端 Node 24.19.0，25,000 条事件、500 轮，三次中位数：

| 测量 | 耗时 |
| --- | ---: |
| 原 snapshot 合并 | 1,251.7 ms |
| 修复后 snapshot 合并 | 7.6 ms |
| 修复后会话索引及轮次分组 | 8.8 ms |

时间受机器负载影响，测试用事件 ID 访问次数验证线性复杂度，不用毫秒阈值判定成功。

App 使用 25,000 条后台历史的内存 bridge fixture，验证新建、归档后恢复原会话，以及设置往返和输入草稿不再次调用 Markdown 解析器。Context 对照复测中，原实现首次解析加十次父更新共解析 11 次，修复后仅 1 次；回归验证十次父更新复用已解析 Markdown，同时确认仍调用最新 onOpen；现有用例覆盖流式文本变更取消旧链接、Escape、焦点恢复和单次确认。延迟 snapshot 回归验证 changed 连续到达时拒绝旧响应，并保留刷新期间送达的流式事件。

## 验证边界

以上基准只测 renderer 的数据处理；App 回归运行在 jsdom，使用内存 bridge。它们不包含真实 IPC 序列化、Host 读取/持久化、桌面布局或 GPU 时间，也不代表用户设备上的端到端耗时。本次没有更改持久化或 snapshot/notice 协议。历史仍全量传输，首次渲染很长的单会话仍会挂载全部消息；本轮没有增加虚拟列表。

本云环境此前 Electron 二进制下载失败（`TypeError: fetch failed`），因此未在此环境完成原生桌面性能复测。
