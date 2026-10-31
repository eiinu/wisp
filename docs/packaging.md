# macOS Apple Silicon 打包

## 在 GitHub 手动构建

1. 将需要打包的代码提交并推送到 GitHub。
2. 打开仓库 **Actions → Build macOS arm64 → Run workflow**。
3. 选择要构建的分支，点击 **Run workflow**。工作流按触发时的具体 commit SHA checkout，不追随构建期间移动的分支。
4. 成功后打开该运行的 **Artifacts**，下载 `Wisp-macos-arm64-YYYYMMDDHHmm`，解压后获取唯一的 DMG 安装包。GitHub Actions 下载时仍会将 artifact 包装成 ZIP；这不是另一份应用 ZIP 安装产物。

工作流只响应 `workflow_dispatch`；push、PR、tag 均不会自动构建。它生成 Actions 下载产物，**不创建 GitHub Release、不创建 tag，也不发布到其他服务**。Artifact 保留 14 天；手动运行可能消耗 GitHub 账户的 Actions 配额。

安装产物只有 `Wisp-macos-arm64-YYYYMMDDHHmm.dmg`，例如 `Wisp-macos-arm64-202610311146.dmg`。时间取实际检出提交的 **committer timestamp**，固定转换为 **Asia/Shanghai（UTC+08）**，精确到分钟；不是作者时间、构建开始时间或 runner 本地时间。同一提交重跑文件名一致，不同提交在同一分钟可能同名，可通过各自运行摘要中的完整 SHA 区分。

应用内部版本仍取根 `package.json` 的 `version`，当前为 `0.1.0`。完整源码 SHA、提交时间、版本、签名状态和 DMG SHA-256 写入运行页面的 Job summary，不作为独立附件上传。Artifact 中只包含 DMG。

DMG 仅支持 Apple Silicon arm64，不是 Intel 或 universal 包。当前使用默认 Electron 图标，未配置不存在的自定义资源。

## 本机打包

在 Apple Silicon Mac 上使用 Node.js **24.19.0**、pnpm **11.25.0**：

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm package:mac
node scripts/verify-package.mjs release/mac-arm64/Wisp.app/Contents/Resources/app release/mac-arm64/Wisp.app/Contents/MacOS/Wisp arm64
node scripts/package-manifest.mjs
```

构建产物写入 `release/`，该目录不进入版本控制。Electron 与 electron-builder 分别固定为 45.1.0、26.18.0，安装使用已提交锁文件。Windows 专用 electron-winstaller 安装脚本明确不执行；本流程无需它，其他安装脚本仍按工作区白名单控制。

## 打包内容与验证

根 `package.json` 的生产依赖记录 Host 的外部运行依赖，并与 `apps/host/package.json` 保持相同版本。electron-builder 收集这些依赖；React/UI 和共享契约由现有构建打包。明确列入的入口有：

- `apps/desktop/dist/main.js`：Electron 主进程。
- `apps/desktop/dist/preload.cjs`：开启 contextIsolation/sandbox 的受限桥接。
- `apps/desktop/ui-dist/`：本地 Renderer，不依赖 Vite 开发服务器。
- `apps/host/dist/main.js`：独立 Host。
- `node_modules/`：pi-ai、MCP SDK、Playwright MCP 及生产传递依赖。

首版使用真实目录而非 ASAR，保持相对路径和 Node 子进程依赖解析。Host 通过随安装包提供的 Electron 可执行文件以 `ELECTRON_RUN_AS_NODE=1` 运行，用户不需要安装 Node。MCP 子进程同样复用该可执行文件；不能在后续 Electron fuse 配置中关闭 RunAsNode 而不同时调整 Host 启动方式。

`verify-package.mjs` 检查入口、静态资源、依赖路径、外部符号链接和执行架构，并实际启动包内 Host 完成 IPC/离线 Agent 任务，随后用包内 Electron 与 MCP 完成握手和工具发现。它不调用收费模型、不读取用户凭据，也不启动浏览器。工作流在最终 .app 生成后运行该检查，失败不上传产物。

安装包包含 MCP 协议服务，但不包含独立 Playwright Chromium 浏览器二进制；Electron 内嵌 Chromium 不等于可供 Playwright 工具使用的浏览器。本机未准备匹配浏览器时自动化连接会失败，不能报告已连接。浏览器 UI 接线仍按主 README 中的状态说明。

## 签名、系统凭据与验收边界

当前是**无 Developer ID 证书、未公证的测试构建**。为支持 Apple Silicon，使用不需要证书的 ad-hoc 签名（identity `-`）；DMG 不签名。这不会建立 Apple 认可的开发者身份，Gatekeeper 可能阻止从互联网下载的应用。仅从可信来源获取并核对校验值，按 macOS 针对单个应用的官方许可流程处理；不要关闭 Gatekeeper、SIP 或浏览器沙箱。

系统 Key 存储继续由 Electron safeStorage 管理。未正式签名或签名身份变化的构建在 macOS 上可能再次请求钥匙串许可。真实钥匙串访问、安装后的 GUI、下载隔离标记/Gatekeeper，仍需在 Mac 上确认；更新后的单 DMG 命名流程需首次手动 Actions 构建确认；Linux 结构/Host 验证不能替代这些验收。

正式分发需要另行配置 Developer ID 签名与 Apple 公证。应通过 GitHub Secrets 提供签名材料，并调整工作流/签名配置；不要把证书、私钥、口令或 API Key 写入仓库。当前工作流不读取此类 secrets，也不会自动尝试公证。

参考：[electron-builder 配置](https://www.electron.build/configuration/)、[GitHub 手动触发工作流](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)、[GitHub macOS arm64 runner](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)、[Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)。
