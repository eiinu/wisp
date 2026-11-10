/** Native Electron host: an opaque-origin iframe, never the workbench renderer. */
export const APP_CSP="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export function sandboxedAppDocument(html:string){
  // The first policy is active before any untrusted markup is parsed. Later CSP cannot relax it.
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${APP_CSP}"><meta name="referrer" content="no-referrer"></head><body>${html}</body></html>`;
}
export const APP_SHELL=`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; frame-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>MCP App</title><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;box-sizing:border-box}body{overflow:hidden}</style></head><body><iframe id="app" sandbox="allow-scripts" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-write 'none'" referrerpolicy="no-referrer" title="第三方 MCP App"></iframe><script>
const frame=document.getElementById('app');
window.addEventListener('message',event=>{if(event.source===frame.contentWindow&&event.data&&typeof event.data==='object')window.mcpApp.send(event.data);});
window.mcpApp.subscribe(input=>{if(input.type==='load')frame.srcdoc=input.html;else if(input.type==='message')frame.contentWindow.postMessage(input.message,'*');});
</script></body></html>`;
export const APP_SHELL_URL='data:text/html;charset=utf-8,'+encodeURIComponent(APP_SHELL);
