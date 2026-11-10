import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
/** No auth injection, redirects or automatic reconnect; all responses are bounded. */
export function mcpHttpTransport(url:string){
  return new StreamableHTTPClientTransport(new URL(url),{
    fetch:async(input,init)=>{
      const response=await fetch(input,{...init,redirect:'error'});
      if(!response.body)return response;
      let bytes=0;
      const body=response.body.pipeThrough(new TransformStream({transform(chunk,controller){
        bytes+=chunk.byteLength;
        if(bytes>4*1024*1024)throw new Error('MCP HTTP response exceeds limit');
        controller.enqueue(chunk);
      }}));
      return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
    },
    reconnectionOptions:{maxRetries:0,maxReconnectionDelay:1000,initialReconnectionDelay:1000,reconnectionDelayGrowFactor:1},
  });
}
