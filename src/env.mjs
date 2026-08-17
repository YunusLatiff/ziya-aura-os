import fs from 'node:fs';
import path from 'node:path';
const file=path.resolve(process.cwd(),'.env');
if(fs.existsSync(file)){
  for(const raw of fs.readFileSync(file,'utf8').split(/\r?\n/)){
    const line=raw.trim(); if(!line||line.startsWith('#')) continue;
    const i=line.indexOf('='); if(i<1) continue;
    const k=line.slice(0,i).trim(); let v=line.slice(i+1).trim();
    if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1);
    else v=v.replace(/\s+#.*$/,'');
    if(process.env[k]===undefined) process.env[k]=v;
  }
}
