// isolated development preview: only sanitized fixtures, never the user's Homebridge configuration
import http from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ConfigEditor, SettingsError } from '../dist/ui-config.js';

const root=mkdtempSync(join(tmpdir(),'http-advanced-ui-preview-'));
const configPath=join(root,'config.json');
const accessories=JSON.parse(readFileSync(new URL('../test/fixtures/fleet.json',import.meta.url),'utf8'));
writeFileSync(configPath,JSON.stringify({accessories,platforms:[{platform:'Other',name:'Unrelated fixture'}]}),{mode:0o600});
const editor=new ConfigEditor(configPath);
const html=readFileSync(new URL('../homebridge-ui/public/index.html',import.meta.url),'utf8');
const mock=`<script>
window.homebridge=new EventTarget();
homebridge.disableSaveButton=()=>{};
homebridge.closeSettings=()=>{
  document.querySelector('.http-settings').hidden=true;
  const note=document.createElement('p');note.id='closed-settings';note.textContent='Plugin menu — choose JSON Config to edit individual accessories';document.body.append(note);
};
homebridge.request=async(path,body)=>{
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body??{})});
  const result=await response.json();if(!response.ok)throw new Error(result.message);return result;
};
window.addEventListener('load',()=>homebridge.dispatchEvent(new Event('ready')));
</script>`;
const server=http.createServer(async(req,res)=>{
  try {
    if(req.method==='POST'){
      let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>2e6)throw new Error('Request too large');}
      if(req.url==='/settings/save') await delay(Math.min(5000, Math.max(0, Number(process.env.UI_PREVIEW_SAVE_DELAY) || 0)));
      const result=req.url==='/settings/load'?editor.load():req.url==='/settings/save'?editor.save(JSON.parse(raw)):null;
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
    }
    if(req.url==='/settings.js'){
      res.setHeader('Content-Type','text/javascript');res.end(readFileSync(new URL('../homebridge-ui/public/settings.js',import.meta.url)));return;
    }
    res.setHeader('Content-Type','text/html');
    const dark = new URL(req.url, 'http://localhost').searchParams.get('theme') === 'dark';
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>HTTP Advanced fixture settings</title><style>body{font:16px system-ui;margin:0;background:${dark ? '#242424' : '#fafafa'};color:${dark ? '#eee' : '#242424'}}.form-control{box-sizing:border-box;display:block;width:100%;padding:9px;border:1px solid #888;border-radius:5px;background:white;color:#222}.btn{padding:10px;border:1px solid #777;border-radius:5px;cursor:pointer;background:transparent;color:inherit}.btn-primary{background:#5636a8;color:white}.text-danger{color:${dark ? '#ffaaaa' : '#b00'}}.small{font-size:13px}input[type=checkbox]{margin-right:8px}</style></head><body>${mock}${html}</body></html>`);
  }catch(error){res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({message:error instanceof SettingsError ? error.message : 'Invalid settings; no changes saved'}));}
});
server.listen(0,'127.0.0.1',()=>console.log(`http://127.0.0.1:${server.address().port}`));
const close=()=>{server.close();rmSync(root,{recursive:true,force:true});process.exit(0);};
process.on('SIGTERM',close);process.on('SIGINT',close);
