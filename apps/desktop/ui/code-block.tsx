import { WorkspaceIcon } from './workspace-icon.js';
import React, { useMemo, useRef, useState } from 'react';
import { createLowlight } from 'lowlight';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import sql from 'highlight.js/lib/languages/sql';
import { copyText } from './clipboard.js';
import 'highlight.js/styles/github.css';

const highlighter = createLowlight({ javascript, typescript, python, json, bash, css, xml, sql });
type Token = ReturnType<typeof highlighter.highlight>['children'][number];
function tokens(nodes: Token[]): React.ReactNode {
  return nodes.map((node, i) => node.type === 'text' ? node.value : node.type === 'element' ? <span key={i} className={(node.properties.className as string[] | undefined)?.join(' ')}>{tokens(node.children as Token[])}</span> : null);
}
export function CodeBlock({ text, language = '' }: { text: string; language?: string }) {
  const [copiedText, setCopiedText] = useState<string>(), [error, setError] = useState(false), latest = useRef(text); latest.current = text;
  const content = useMemo(() => {
    if (!highlighter.registered(language) || text.length > 32000) return text;
    try { return tokens(highlighter.highlight(language, text).children); } catch { return text; }
  }, [language, text]);
  return <div className="code-block"><div className="code-toolbar"><span>{language || '文本'}</span><button onClick={() => {
    const value = text; setError(false); void copyText(value, window.wisp).then(() => { if (latest.current === value) setCopiedText(value); }).catch(() => setError(true));
  }}>{copiedText === text ? '已复制' : '复制代码'}</button></div><pre tabIndex={0} aria-label="代码，可横向滚动"><code className={language ? `hljs language-${language}` : undefined}>{content}</code></pre>{error && <span role="alert">复制失败，请手动选择代码。</span>}</div>;
}
