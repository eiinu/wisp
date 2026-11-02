# 文档站与部署

本站使用 VitePress 1.6.4 稳定版，直接以 `docs/*.md` 为内容源；现有文档在 GitHub 中仍可阅读。导航和本地全文搜索在 `docs/.vitepress/config.mts` 配置，搜索无需 API Key 或外部搜索服务，中文使用 `Intl.Segmenter` 分词。

## 本地开发与检查

在仓库根目录，使用 [开发环境要求](development.md) 中的 Node.js 与 pnpm 版本：

```sh
pnpm install --frozen-lockfile
pnpm docs:dev
pnpm docs:build
pnpm docs:preview
```

开发服务器默认使用 5173，构建预览默认使用 4173。构建只生成 `docs/.vitepress/dist` 静态文件，不启动 Host、不构建或打包 Electron。缓存与生成产物不提交。

新增文档时同步维护导航。文档间使用相对 `.md` 链接以兼容 GitHub，VitePress 会转换为站内地址；构建保留默认的无效链接检查，不通过忽略链接来掩盖问题。

## Vercel Git 自动部署

用户在 Vercel 导入此 Git 仓库后：

- **Root Directory**：仓库根目录（留空或 `.`），不是 `docs`。这个选项在 Vercel 项目设置中选择，`vercel.json` 不支持 `rootDirectory`。
- **Framework Preset**：Other。仓库根 `vercel.json` 显式设为 `null`，避免误用桌面应用构建。
- **Node.js**：选择 24.x，符合仓库的 Node.js 要求。
- **包管理器版本**：在 Vercel 的 Production / Preview 构建环境设置非敏感变量 `ENABLE_EXPERIMENTAL_COREPACK=1`，让 Corepack 使用根 `package.json` 固定的 `pnpm@11.25.0`，避免自定义安装命令选到旧版 pnpm。
- **Production Branch**：通常为 `main`；本分支需先经用户验收合并。
- 安装、构建与输出由仓库配置提供，无需模型 API Key、MCP 凭据或 Electron 签名配置。

`vercel.json` 使用 `pnpm install --frozen-lockfile` 安装，`pnpm docs:build` 构建，仅发布 `docs/.vitepress/dist`。启用 Corepack 后，Vercel 根据 `packageManager` 选择仓库固定的 pnpm 版本。`cleanUrls: true` 与 VitePress 保持一致；不添加将所有路径重写到首页的 SPA fallback，未知页面应返回 404。

本站按域名根路径 `/` 部署，尚未指定线上域名，因此没有虚构站点 URL 或 sitemap 域名。若未来部署到子路径，再同步调整 VitePress 的 `base` 和托管路径。

本次仅提供仓库配置，没有绑定 Vercel 项目、执行部署或新增 Actions 部署流水线。Git 自动部署由用户接入 Vercel 后启用。

参考：[VitePress 1.x 部署](https://vuejs.github.io/vitepress/v1/guide/deploy)、[本地搜索](https://vuejs.github.io/vitepress/v1/reference/default-theme-search)、[Vercel 配置](https://vercel.com/docs/project-configuration/vercel-json)、[构建与根目录设置](https://vercel.com/docs/builds/configure-a-build)。
