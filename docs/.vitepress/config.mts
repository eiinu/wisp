import { defineConfig } from 'vitepress';

export default defineConfig({
  lang: 'zh-CN',
  title: 'Wisp',
  description: '运行在自己电脑上的个人 Agent 工作台：对话、文件、网页与本地 MCP。',
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: '使用与能力', link: '/projects' },
      { text: '开发文档', link: '/development' },
      { text: '打包与下载', link: '/packaging' }
    ],
    sidebar: [
      { text: '使用与能力', items: [
        { text: '本地项目', link: '/projects' },
        { text: '对话归档', link: '/session-archive' },
        { text: '模型接入', link: '/models' },
        { text: '工具与权限', link: '/chat-tools' },
        { text: '问答与授权', link: '/questionnaire' },
        { text: '本地 MCP', link: '/local-mcp' },
        { text: '浏览工作区', link: '/browser-workspace' },
        { text: 'Markdown 与文件预览', link: '/markdown' }
      ] },
      { text: '开发与维护', items: [
        { text: '开发与运行', link: '/development' },
        { text: '打包与下载', link: '/packaging' },
        { text: '开发模拟验证', link: '/development-validation' },
        { text: '文档站与部署', link: '/documentation' }
      ] },
      { text: '界面规范与验证', collapsed: true, items: [
        { text: '界面规范', link: '/interface-design' },
        { text: 'CSS 与焦点', link: '/css-baseline' },
        { text: '图标审计', link: '/icon-audit' },
        { text: 'UI 验证', link: '/ui-verification' }
      ] }
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/eiinu/wisp' }],
    outline: { label: '本页目录', level: [2, 3] },
    docFooter: { prev: '上一篇', next: '下一篇' },
    sidebarMenuLabel: '文档目录',
    returnToTopLabel: '返回顶部',
    darkModeSwitchLabel: '外观',
    darkModeSwitchTitle: '切换深色模式',
    lightModeSwitchTitle: '切换浅色模式',
    skipToContentLabel: '跳转到内容',
    search: {
      provider: 'local',
      options: {
        // Segment Chinese words as well as Latin tool names; runs in build and browser.
        miniSearch: { options: { tokenize: (text) => Array.from(
          new Intl.Segmenter('zh-CN', { granularity: 'word' }).segment(text),
          part => part.isWordLike ? part.segment : ''
        ).filter(Boolean) } },
        translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
          modal: {
            displayDetails: '显示详细结果', resetButtonTitle: '清空搜索',
            backButtonTitle: '关闭搜索', noResultsText: '没有找到相关文档',
            footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' }
          }
        }
      }
    },
    footer: { message: 'Wisp · Electron 桌面工作台。本站仅提供项目文档。' }
  }
});
