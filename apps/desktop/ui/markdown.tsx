import React from 'react';
// Deliberately no raw HTML, embedded media, or executable markup.
export function Markdown({ text }: { text: string }) {
  const blocks = text.split(/(```[\s\S]*?(?:```|$))/g);
  return <div className="markdown">{blocks.map((block, index) => block.startsWith('```') ? <pre key={index}><code>{block.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')}</code></pre> : <div key={index}>{block.split('\n').map((line, i) => {
    if (/^#{1,3} /.test(line)) return <h3 key={i}>{line.replace(/^#+ /, '')}</h3>;
    if (/^[-*] /.test(line)) return <div className="md-list" key={i}>• {line.slice(2)}</div>;
    return <p key={i}>{line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, j) => part.startsWith('**') ? <strong key={j}>{part.slice(2, -2)}</strong> : part.startsWith('`') ? <code key={j}>{part.slice(1, -1)}</code> : part) || '\u00a0'}</p>;
  })}</div>)}</div>;
}
