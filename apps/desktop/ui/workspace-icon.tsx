import React from 'react';

const paths = {
  back: 'm14 5-7 7 7 7M7 12h14',
  forward: 'm10 5 7 7-7 7M3 12h14',
  refresh: 'M20 7v5h-5M20 12a8 8 0 1 0-2 5M20 7v5',
  close: 'm6 6 12 12M6 18 18 6',
  plus: 'M12 5v14M5 12h14',
  download: 'M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4',
  folder: 'M3 6h7l2 3h9v11H3z',
  file: 'M5 3h9l5 5v13H5zM14 3v6h5M8 13h8M8 17h6',
  globe: 'M3 12h18M12 3c-6 5-6 13 0 18 6-5 6-13 0-18',
  edit: 'm15 4 5 5M4 20l5-1L21 7l-5-5L4 14z',
} as const;

/** Decorative icons; the containing control owns its accessible name. */
export function WorkspaceIcon({ name }: { name: keyof typeof paths }) {
  return <svg className="workspace-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {name === 'globe' && <circle cx="12" cy="12" r="9"/>}<path d={paths[name]}/>
  </svg>;
}
