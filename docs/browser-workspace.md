# 浏览工作区

右侧统一展示网页、授权目录及文件标签。标签上限 12 个，达到上限后关闭最早标签；关闭网页会销毁对应网页进程内容。文件标签绑定会话和授权目录，切换会话或撤销授权后移除，读取与编辑仍经过 Host 的路径校验和写入审批。文本和 Markdown 使用同一文件读取接口；Markdown 与聊天共用公式、代码高亮和链接确认。

## 桌面浏览器

Electron WebContentsView 提供真实地址更新、页面标题、加载错误、前进、后退和刷新。地址栏明确提交 HTTP/HTTPS 网址后直接导航。聊天及 Markdown 链接先显示目标确认框，确认后才加载；相对文件链接只能解析到原授权目录内。网页弹出的新窗口也先转为确认请求。网页内普通导航保留在当前网页标签。

每次启动使用独立、非持久化的浏览器 Session，没有 Wisp preload、Node 集成或 Host IPC。权限请求默认拒绝，不绕过证书错误，不允许 file/javascript 等导航；网页不能调用工作台的凭据或文件接口。设置和链接确认弹窗出现时隐藏原生网页视图，避免遮住控件；关闭标签和窗口会清理视图、监听器以及未完成的下载。

下载管理器取自 Electron DownloadItem 实际字节数与状态。下载会提示系统保存对话框，由用户选择位置和确认覆盖；Wisp 不自动执行或打开文件，不扫描下载目录。支持取消，不提供断点续传、后台持久化下载记录。网页会话、网页历史、标签与下载记录本期仅在当前启动内保留，不影响已有聊天会话持久化。

## Web 预览限制

Web 版使用 `sandbox="allow-scripts"` 的 iframe，无 same-origin、弹窗、下载或顶层导航权限。它不能提供原生导航历史、下载管理或可靠的重定向地址，相关按钮禁用并显示说明。网站的 X-Frame-Options/CSP 限制不绕过；嵌入拒绝也不能可靠由跨域父页面检测，因此不声称 iframe 加载事件代表内容加载成功。桌面原生网页与 Agent 浏览器自动化是不同能力，不据此声称 Agent 已读取网页。

## 验证

`pnpm test` 覆盖主进程隔离配置、危险导航、实际导航状态映射、下载事件/取消、关闭清理，以及 DOM 中链接确认、过期确认取消、文件链接来源、标签隔离和弹窗遮挡指令。使用 Electron 模拟对象，不代表已完成 macOS WebContentsView、布局、系统保存对话框或真实下载验收。

运行 `pnpm web:build` 后可在同一静态服务的 `/qa.html` 查看真实组件测试页。它明确标记开发样例，用两个只读 fixture 文件验证渲染，不是生产会话或模型回复。该页面不包含在桌面生产构建中；实际文件读取、原生浏览器和下载仍需桌面实测。`index.html` 保留真实 Host 连接状态，不注入模拟会话。

API 依据：[WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view)、[NavigationHistory](https://www.electronjs.org/docs/latest/api/navigation-history)、[DownloadItem](https://www.electronjs.org/docs/latest/api/download-item)。
