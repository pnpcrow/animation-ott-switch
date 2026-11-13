import { chromium } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
const roots = {
  laftel: 'https://laftel.net/search?keyword=', aniplus:'https://www.aniplustv.com/Search?st=',
  crunchyroll:'https://www.crunchyroll.com/search?q=', prime:'https://www.primevideo.com/search?phrase=',
  wavve:'https://www.wavve.com/search?searchWord=',tving:'https://www.tving.com/search?keyword=',
  coupang:'https://www.coupangplay.com/search?q=',watcha:'https://watcha.com/search?query=',
};
const queries=[['jujutsu-kaisen','주술회전'],['attack-on-titan','진격의 거인'],['frieren','장송의 프리렌']];
await mkdir('.tmp/dom-scale/train',{recursive:true});
const browser=await chromium.launch({channel:'chromium',headless:true});
const results=[];
const jobs=Object.entries(roots).flatMap(([provider,url])=>queries.map(([work,title])=>({provider,work,title,url:url+encodeURIComponent(title)})));
let next=0;
async function worker(){while(next<jobs.length){const job=jobs[next++];const page=await browser.newPage({locale:'ko-KR',viewport:{width:1440,height:1000}});let error=null;try{await page.goto(job.url,{waitUntil:'domcontentloaded',timeout:25000});await page.waitForTimeout(3500);}catch(e){error=String(e);} const observed=await page.evaluate(()=>({title:document.title,url:location.href,body:document.body?.innerText?.slice(0,2500),links:[...document.querySelectorAll('a[href]')].map(a=>({text:(a.innerText||a.getAttribute('aria-label')||a.querySelector('img')?.alt||'').slice(0,100),href:a.href})).filter((x,i,a)=>a.findIndex(y=>y.href===x.href)===i).slice(0,120)})).catch(e=>({error:String(e)}));results.push({...job,...observed,error});await writeFile(`.tmp/dom-scale/train/discovery.json`,JSON.stringify(results,null,2));console.log(JSON.stringify({provider:job.provider,work:job.work,title:observed.title,links:observed.links?.length,error}));await page.close();}}
try{await Promise.all([worker(),worker(),worker()]);}finally{await browser.close();}
