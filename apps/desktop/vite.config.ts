import { defineConfig } from 'vite';
export default defineConfig(({ mode }) => ({
  root: 'ui', base: './', build: { outDir: '../ui-dist', emptyOutDir: true, ...(mode === 'web-preview' ? { rolldownOptions: { input: ['ui/index.html', 'ui/qa.html'] } } : {}) },
  plugins: [{ name: 'local-preview-csp', apply: 'serve', transformIndexHtml(html) {
    return html.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'").replace("connect-src 'self'", "connect-src 'self' ws://127.0.0.1:5173");
  } }],
}));
