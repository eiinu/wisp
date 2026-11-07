# 版本与 Release 草稿

根 `package.json` 是版本来源，当前为 `0.1.1`。根 `CHANGELOG.md` 是唯一更新日志；[文档站更新日志](changelog.md) 直接引用，不复制内容。`v0.1.1` 于 2026-11-07 首次正式公开；后续版本在公开前仍标为“待发布”，不把提交或草稿日期当作发布时间。

## 准备版本

1. 在功能分支维护重要功能日志。下个版本修改根 `package.json` 的 `version`，执行 `pnpm version:sync` 同步桌面、Host 与 core 包；安装依赖时继续使用 frozen lockfile。
2. 更新 `CHANGELOG.md` 对应的 `## [版本] - 待发布` 条目，至少包含一项变化。当前仅支持稳定 `X.Y.Z` 版本，不接受预发布后缀。
3. 检查并合入 main 后，经授权在**已合入的确切提交**上创建版本 tag。以下是维护者未来的操作示例，本次实现不会执行：

```sh
git fetch origin
git tag -a v0.1.1 <已验收并合入main的完整SHA> -m 'Wisp 0.1.1 draft candidate'
git push origin refs/tags/v0.1.1
```

不要移动或强推既有 tag。建议为 `main` 和 `v*` 设置规则集，只允许维护者创建 tag，禁止删除/更新。工作流的祖先检查是防误操作校验，不能替代仓库权限控制（有权改工作流的人也能改校验）。

由维护者正常推送 tag 会触发 **Draft version release**。用另一个 workflow 的 `GITHUB_TOKEN` 推 tag 通常不会触发新 workflow；本流程不自动创建 tag，不需要额外 PAT。不要为绕过触发限制把长期凭据写入代码。

## 自动流程与产物

- 在安装依赖前校验 tag 等于根版本、全部工作区版本一致、tag/HEAD/触发 SHA 相等、提交属于 `origin/main` 历史且存在日志条目。
- 复用 [手动 macOS arm64 打包](packaging.md) 的锁文件安装、typecheck、全量测试、构建与包内 Host/MCP 验证；另构建文档。检查包内应用版本。
- 成功后才准备 `Wisp-0.1.1-macos-arm64.dmg`、`SHA256SUMS` 和 `build-info.json`，后者记录完整源码 SHA、版本、架构、签名状态与 DMG 哈希。手动打包仍保留时间戳命名和单 DMG artifact。
- 上传 job 重新 checkout，并通过 GitHub API 再次确认远端 tag 未删除/移动、提交仍属于 main，校验附件身份，才调用 GitHub API 创建 **draft: true** 的 Release；不依赖 `release` 事件再次触发流程。只有该 job 拥有 `contents: write`，不安装项目依赖、不运行项目构建。全部外部 Actions 固定完整提交 SHA。
- 当前不自动公开、不自动生成/推送 tag、不启用 Developer ID 或公证。草稿仅有相应仓库权限的人可见。

## 重试与首次验证

首轮须在实际 Actions/macOS 上完成后检查草稿、三个附件与校验信息，再在 Apple Silicon Mac 验证安装/启动、Gatekeeper、钥匙串与核心功能。Linux 单元测试和 API mock 不能替代该验收；真实 Release API、macOS 打包和桌面安装尚需首轮验证。

失败优先选择 **Re-run failed jobs**，复用同一运行中已验证的构建 artifact（保留 14 天）。同 tag 的完整草稿可重复检查，已有同名附件仅在大小、上传完成状态及 GitHub SHA-256 digest 全部一致时跳过；只补缺失附件。已公开版本、被编辑的草稿或同名不同内容附件一律停止，不覆盖。整轮重构建的 DMG 可能不是字节级可复现；因此不要把新构建强行覆盖旧草稿，冲突时由维护者核查，必要时使用新版本。

GitHub REST 不支持将 Release 和附件作为一个事务创建。所有本地产物先验证，首个上传失败时尽力清理本轮刚建且仍为空的草稿；网络中断、runner 被杀或 API 拒绝可能留下空草稿/部分附件，需要维护者检查。部分草稿留存便于补传；失败上传的 starter 附件、缺 digest 或不同 digest 必须人工处理，脚本不会删除已有附件。并发按 tag 排队，但请勿在自动上传中手工编辑或公开草稿。远端校验与创建 Release 也不是原子事务；必须结合 tag 禁删/禁改规则，避免维护者在两者之间删除 tag（GitHub 创建 Release API 可能补建不存在的 tag）。

草稿验收成功后再决定公开及是否改为全自动；本版没有自动切换。真正公开时记录实际发布日期，保留既有 tag 和附件不变。开发功能日志仍进入下一个待发布条目。

官方参考：[GitHub Release API](https://docs.github.com/en/rest/releases/releases#create-a-release)、[Release 附件 API](https://docs.github.com/en/rest/releases/assets#upload-a-release-asset)、[GITHUB_TOKEN 触发规则](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow)、[复用工作流](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)、[VitePress Markdown 引用](https://vitepress.dev/guide/markdown#markdown-file-inclusion)。
