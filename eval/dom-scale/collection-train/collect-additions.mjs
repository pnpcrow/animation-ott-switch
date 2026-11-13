import {chromium} from '@playwright/test';
import {writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {collectDomSnapshot} from '../../tiny-decision/collect.mjs';
import {enrichDomSnapshot} from '../../tiny-decision/v2/collect.mjs';
const roots={aniplus:'https://www.aniplustv.com/Search?st=',wavve:'https://www.wavve.com/search?searchWord=',tving:'https://www.tving.com/search?keyword='};
const works=[['chainsaw-man','체인소 맨'],['witch','어느 마녀가 죽을 때까지']];
const jobs=Object.entries(roots).flatMap(([provider,root])=>works.filter(([work])=>provider!=='tving'||work==='chainsaw-man').map(([work,title])=>({id:`more-${provider}-${work}-search`,provider,work,title,url:root+encodeURIComponent(title)})));
await mkdir('.tmp/dom-scale/train',{recursive:true});
await writeFile('eval/dom-scale/collection-train/additional-plan.json',JSON.stringify({plannedAt:new Date().toISOString(),jobs,reason:'Fill missing search/detail work coverage on services with only six or seven captured pages; same already reserved training work groups. Collection and annotation remain blind to predictions.'},null,2)+'\n');
const browser=await chromium.launch({channel:'chromium',headless:true});let next=0;const pages=[];
async function capture(page,job,stage,actions,error){
 const html=await page.content();
 const p=await page.evaluate(({base,rich})=>{
  const s=(0,eval)(`(${rich})`)(document,location.href,(0,eval)(`(${base})`)(document,location.href));
  const videos=[...document.querySelectorAll('video')].map(v=>({paused:v.paused,currentTime:v.currentTime,ended:v.ended,muted:v.muted,readyState:v.readyState,renderedWidth:Math.round(v.getBoundingClientRect().width),renderedHeight:Math.round(v.getBoundingClientRect().height)}));
  s.pageEvidence.media={videoCount:videos.length,playingCount:videos.filter(v=>!v.paused&&v.currentTime>0&&!v.ended).length,fullscreen:!!document.fullscreenElement,videos};
  return {...s,annotationEvidence:{body:document.body?.innerText?.slice(0,6500)||''}};
 },{base:collectDomSnapshot.toString(),rich:enrichDomSnapshot.toString()});
 const id=stage?job.id+'-'+stage:job.id;pages.push({...job,id,...p,actions:[...actions],navigationError:error||null,capturedAt:new Date().toISOString(),htmlSha256:createHash('sha256').update(html).digest('hex'),intendedKind:stage||'search'});
 await writeFile(`.tmp/dom-scale/train/${id}.html`,html);await page.screenshot({path:`.tmp/dom-scale/train/${id}.png`}).catch(()=>{});
 await writeFile('eval/dom-scale/collection-train/additional-observations.json',JSON.stringify(pages,null,2)+'\n');console.log(JSON.stringify({id,url:p.pageUrl,title:p.documentTitle,media:p.pageEvidence.media}));
}
async function worker(){while(next<jobs.length){const job=jobs[next++],page=await browser.newPage({locale:'ko-KR',viewport:{width:1440,height:1000}}),actions=[];let error=null;
 try{await page.goto(job.url,{waitUntil:'domcontentloaded',timeout:25000});await page.waitForTimeout(3000);}catch(e){error=String(e);}await capture(page,job,'',actions,error);
 if(job.provider!=='tving')try{const target=job.provider==='aniplus'?page.locator('.div_li').filter({hasText:job.title}).last():page.locator('.title1:visible').filter({hasText:job.title}).first();await target.click({timeout:5000});await page.waitForTimeout(3000);actions.push({kind:'open-work',observedText:job.title,outcome:'clicked'});await capture(page,job,'opened-work',actions);}catch(e){actions.push({kind:'open-work',outcome:'not opened',error:String(e)});pages.find(x=>x.id===job.id).actions=actions;}
 await page.close();}}
try{await Promise.all([worker(),worker()]);await writeFile('eval/dom-scale/collection-train/additional-observations.json',JSON.stringify(pages,null,2)+'\n');}finally{await browser.close();}
