import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
import {collectDomSnapshot} from '../../tiny-decision/collect.mjs';
import {enrichDomSnapshot} from '../../tiny-decision/v2/collect.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const append=process.argv.includes('--append');
let plan=JSON.parse(await readFile(new URL(append?'./append-plan.json':'./plan.json',import.meta.url)));
const directory='.tmp/dom-scale/holdout';
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'chromium',headless:true});
const rows=append?JSON.parse(await readFile(new URL('./observations.json',import.meta.url))):[];let cursor=0;
if(append)plan=plan.filter(item=>!rows.some(row=>row.id===item.id));
function sanitize(value){
 if(Array.isArray(value))return value.map(sanitize);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,sanitize(v)]));
 if(typeof value==='string'&&/^https?:\/\//.test(value))try{const u=new URL(value);for(const key of [...u.searchParams.keys()])if(/serverstate|^state$|token|signature|credential|nonce|session|key-pair-id|^code$/i.test(key))u.searchParams.delete(key);return u.href;}catch{}
 return value;
}
let saveQueue=Promise.resolve();
const save=()=>{
 const bytes=JSON.stringify(sanitize(rows.toSorted((a,b)=>a.id.localeCompare(b.id))),null,2)+'\n';
 saveQueue=saveQueue.then(async()=>{for(let attempt=0;;attempt++)try{
   await writeFile(new URL('./observations.json.writing',import.meta.url),bytes);
   await rename(new URL('./observations.json.writing',import.meta.url),new URL('./observations.json',import.meta.url));break;
  }catch(error){if(attempt===19)throw error;await new Promise(resolve=>setTimeout(resolve,50*(attempt+1)));}
 });return saveQueue;
};
async function capture(item){
 const page=await browser.newPage({locale:'ko-KR',viewport:{width:1440,height:1000}});
 const errors=[];let status,actionAttempted=false,actionSucceeded=false;
 try {
  try {const response=await page.goto(item.url,{waitUntil:'domcontentloaded',timeout:30000});status=response?.status();await page.waitForTimeout(3000);}catch(e){errors.push(String(e));}
  if(item.action){
   actionAttempted=true;
   try{
    if(item.action.kind==='search'){
      const node=page.getByRole('searchbox').first();
      await node.fill(item.action.query,{timeout:5000});await node.press('Enter');
    }else{
      const node=page.getByRole('button',{name:item.action.name,exact:item.action.exact??false}).filter({visible:true}).nth(item.action.index??0);
      await node.click({timeout:5000});
    }
    await page.waitForTimeout(item.action.waitMs??1800);actionSucceeded=true;
   }catch(e){errors.push('action: '+String(e));}
  }
  const html=await page.content();
  const snapshot=await page.evaluate(({base,rich})=>{
   const collect=(0,eval)(`(${base})`),enrich=(0,eval)(`(${rich})`);
   const output=enrich(document,location.href,collect(document,location.href));
   output.observedUi={
    bodyText:document.body?.innerText?.replace(/\s+/g,' ').slice(0,2500)||'',
    videos:[...document.querySelectorAll('video')].map(n=>({paused:n.paused,readyState:n.readyState,currentTime:n.currentTime,hasSource:!!n.currentSrc,rect:{width:Math.round(n.getBoundingClientRect().width),height:Math.round(n.getBoundingClientRect().height)}})),
    links:[...document.querySelectorAll('a[href]')].slice(0,240).map(n=>({text:(n.textContent||n.getAttribute('aria-label')||n.querySelector('img')?.alt||'').replace(/\s+/g,' ').trim().slice(0,100),href:n.href})),
    buttons:[...document.querySelectorAll('button')].slice(0,60).map(n=>({text:n.textContent?.replace(/\s+/g,' ').trim().slice(0,80),aria:n.getAttribute('aria-label')})),
    fullscreen:!!document.fullscreenElement,
   };return output;
  },{base:collectDomSnapshot.toString(),rich:enrichDomSnapshot.toString()});
  const row={...item,...snapshot,capturedAt:new Date().toISOString(),status,errors,actionAttempted,actionSucceeded,htmlSha256:sha(html)};
  await writeFile(`${directory}/${item.id}.html`,html);
  await page.screenshot({path:`${directory}/${item.id}.png`,fullPage:false});
  rows.push(row);await save();
  console.log(JSON.stringify({id:item.id,status,title:row.documentTitle,actionSucceeded,errors:errors.length,fields:Object.fromEntries(Object.entries(row.fields).map(([k,v])=>[k,v.length]))}));
 }finally{await page.close();}
}
try{await Promise.all(Array.from({length:2},async()=>{while(cursor<plan.length){const item=plan[cursor++];await capture(item);}}));}
finally{await browser.close();}
await save();
