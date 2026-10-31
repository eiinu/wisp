# Markdown 渲染与扩展

对话的流式片段、最终回复与文件面板的 Markdown 都使用 `apps/desktop/ui/markdown.tsx`，由 react-markdown 解析 CommonMark，remark-gfm 提供表格、任务列表、删除线等语法。流式内容可以是不完整的 Markdown；收到最终消息后使用完整文本重新渲染。

扩展使用 `MarkdownExtensions` 的标准 `components`、`remarkPlugins` 和 `rehypePlugins`，不注册第二套解析器。例如：

```tsx
import { Markdown, type MarkdownExtensions } from './markdown.js';
const extensions: MarkdownExtensions = {
  components: { h2: ({ children }) => <h2 className="section-title">{children}</h2> },
  remarkPlugins: [],
  rehypePlugins: [],
};
<Markdown text={content} extensions={extensions} />
```

扩展来自受信任的应用代码，不读取模型生成的可执行组件或插件。默认忽略原始 HTML，rehype-sanitize 始终在 rehype 扩展后运行。新增语法应输出标准安全节点；新增组件负责自己的属性、链接与资源安全，不能直接注入 HTML。

默认只启用无凭据的 HTTP/HTTPS 链接及文内锚点；不启用相对文件链接、脚本/data/file 协议，不自动加载 Markdown 中的图片。桌面外链通过现有受限 `openUrl` 桥接，Web 使用隔离的新标签页。文件图片预览继续走授权目录的 Host 读取，与 Markdown 外部图片隔离。

参考：[react-markdown](https://github.com/remarkjs/react-markdown)、[remark-gfm](https://github.com/remarkjs/remark-gfm)、[rehype-sanitize](https://github.com/rehypejs/rehype-sanitize)。
