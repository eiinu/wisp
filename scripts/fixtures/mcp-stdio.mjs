// Offline verification fixture only. Not shipped or configured as a product service.
import { createInterface } from 'node:readline';
const lines = createInterface({ input: process.stdin });
const tool = { name: 'fixture.echo', description: 'Offline fixture echo', annotations: { readOnlyHint: true }, inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } };
lines.on('line', line => {
  const request=JSON.parse(line); if(request.id===undefined)return;
  const result=request.method==='initialize'?{protocolVersion:request.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'wisp-verification-only',version:'1'}}:
    request.method==='tools/list'?{tools:[tool]}:
    request.method==='tools/call'?{content:[{type:'text',text:request.params.arguments.text}]}:{};
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\n');
});
lines.on('close',()=>process.exit(0));
