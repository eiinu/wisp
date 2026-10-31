# CSS 基础层与焦点

参考（2026-10-31 核对）：[Tailwind CSS Preflight 官方文档](https://tailwindcss.com/docs/preflight)、[官方源码](https://github.com/tailwindlabs/tailwindcss/blob/main/packages/tailwindcss/preflight.css)。借鉴基础层分离、尺寸与表单继承规范，不引入 Tailwind 运行依赖，也不整份覆盖第三方样式。

`style.css` 首行以 `layer(reset)` 引入 `reset.css`，优先级低于现有组件与 KaTeX/高亮样式。统一盒模型（含伪元素）、文档外距、fieldset、表格、表单继承与外观、媒体布局、dialog/hidden 状态。字体与行高沿用产品定义；不重置所有数学内部 span，不删除列表标记，不统一隐藏滚动条。Markdown 明确定义标题、列表、代码和表格样式。

移除原有两套重复焦点规则和聊天输入无替代的 outline 清除。按钮、链接和选择控件保留 `focus-visible` 外偏移焦点环。文本输入与编辑器在 focus 时采用同色边框和 `outline-offset:-2px` 的内嵌轮廓，视觉上只有一条连续的 2px 边缘，不出现外偏移双框；聊天输入同样只在整个 composer 外框内绘制这条边缘。仅在非 focus-visible 的交互焦点或有外框替代的聊天 textarea 上取消 outline。高对比模式使用 Highlight/GrayText 系统色，保持可见焦点和禁用状态。

下拉框保留原生箭头，checkbox/radio 保留原生 appearance、勾选/互斥语义。没有改变控件事件、原生菜单、tab 顺序或 iframe sandbox。样式仅加载到 Wisp Renderer 文档，不注入远程 iframe 或 Electron WebContentsView。

`qa.html` 的基础表单样例与产品共用样式：文本、密码（只输入测试文字）、搜索、下拉、文件编辑器、checkbox/radio、禁用态、聊天输入框。搭配实际项目弹窗、地址栏和 Markdown/KaTeX 检查鼠标与 Tab。自动测试覆盖 CSS 契约和真实 Markdown 结构；浏览器焦点像素、forced-colors 与 macOS 原生控件效果需实际视觉验证，不能用 DOM 测试替代。
