import './env.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const defaultPublicDir=path.resolve(__dirname,'../crm-public');

function contentType(file){
  return {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream';
}

export function createCrmUiServer({publicDir=defaultPublicDir,auraHost='127.0.0.1',auraPort=Number(process.env.AURA_PORT||4310)}={}){
  const root=path.resolve(publicDir);
  return http.createServer((req,res)=>{
    const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
    if(url.pathname==='/health'){
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
      return res.end(JSON.stringify({ok:true,service:'ziya-crm-ui',auraBackend:`http://${auraHost}:${auraPort}`}));
    }
    if(url.pathname.startsWith('/api/')){
      const headers={...req.headers,host:`${auraHost}:${auraPort}`};
      delete headers['content-length'];
      const proxy=http.request({hostname:auraHost,port:auraPort,path:req.url,method:req.method,headers},upstream=>{
        res.writeHead(upstream.statusCode||502,upstream.headers);
        upstream.pipe(res);
      });
      proxy.on('error',error=>{
        if(res.headersSent)return res.end();
        res.writeHead(502,{'Content-Type':'application/json','Cache-Control':'no-store'});
        res.end(JSON.stringify({error:`Aura CRM backend unavailable: ${error.message}`}));
      });
      req.pipe(proxy);
      return;
    }
    const relative=url.pathname==='/'?'index.html':url.pathname.replace(/^\//,'');
    const file=path.resolve(root,relative);
    if(!file.startsWith(root+path.sep)&&file!==root){res.writeHead(403);return res.end('Forbidden')}
    if(!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end('Not found')}
    res.writeHead(200,{'Content-Type':contentType(file),'Cache-Control':path.extname(file)==='.html'?'no-store':'public, max-age=60'});
    fs.createReadStream(file).pipe(res);
  });
}

export function startCrmUiServer({port=Number(process.env.CRM_PORT||4311),auraPort=Number(process.env.AURA_PORT||4310)}={}){
  const server=createCrmUiServer({auraPort});
  server.listen(port,'127.0.0.1',()=>console.log(`Ziya CRM: http://localhost:${port} -> Aura backend :${auraPort}`));
  return server;
}

const isMain=process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href;
if(isMain)startCrmUiServer();
