# Wisp

运行在自己电脑上的个人 Agent 工作台。

通过对话调用模型，处理授权目录中的文件，并在同一界面浏览网页与文档。任务由本机 Host 执行，模型请求直接发送到你配置的 API 服务。

## 从这里开始

- [打包与下载](packaging.md)：macOS Apple Silicon DMG 构建与安装边界。
- [模型接入](models.md)：DeepSeek 与 OpenAI 兼容服务、凭据保存。
- [本地项目](projects.md)：把文件夹与对话关联，继承明确的目录权限。
- [开发与运行](development.md)：源码运行、架构和检查方式。

## 工作台能力

| 能力 | 说明 |
| --- | --- |
| [对话与归档](session-archive.md) | 流式回复、历史恢复，保留项目归属的归档与恢复。 |
| [工具调用](chat-tools.md) | 搜索、读取和修改文件，按执行过程展示状态；文件变更需审批。 |
| [问答澄清](questionnaire.md) | 多道题、单选、多选和自定义输入；回答不代替操作授权。 |
| [浏览工作区](browser-workspace.md) | 文件与网页多标签、地址栏、导航和下载管理。 |
| [内容阅读](markdown.md) | Markdown、数学公式、代码高亮及文本和图片预览。 |
| [本地 MCP](local-mcp.md) | 添加、启用和禁用自定义 stdio 服务，也可通过对话辅助配置和受限安装。 |

## 支持范围

生产目标为 **Electron 桌面端**，当前提供 macOS arm64 DMG 构建，尚未签名或公证。内置文件工具只访问明确授权的目录；用户启用的第三方 MCP 使用本机系统权限，不受项目目录沙箱约束。

本网站是静态文档站，不运行 Wisp、Host 或模型 API。仓库内的纯 Web 工作台仅用于 UI 展示和截图验证，不是生产版本。

[查看源码](https://github.com/eiinu/wisp) · [维护与部署此文档站](documentation.md)
