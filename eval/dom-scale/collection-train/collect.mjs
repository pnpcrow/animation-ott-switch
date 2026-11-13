import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { collectDomSnapshot } from '../../tiny-decision/collect.mjs';
import { enrichDomSnapshot } from '../../tiny-decision/v2/collect.mjs';

const roots={laftel:'https://laftel.net/search?keyword=',aniplus:'https://www.aniplustv.com/Search?st=',crunchyroll:'https://www.crunchyroll.com/search?q=',prime:'https://www.primevideo.com/search?phrase=',wavve:'https://www.wavve.com/search?searchWord=',tving:'https://www.tving.com/search?keyword=',coupang:'https://www.coupangplay.com/search?q=',watcha:'https://watcha.com/search?query='};
const queries=[['jujutsu-kaisen','주술회전'],['attack-on-titan','진격의 거인'],['frieren','장송의 프리렌']];
const direct=[
 ['prime','blade-of-the-immortal','무한의 주인','https://www.primevideo.com/-/ko/detail/0I1FLPJR5P008ZZEZY0YFF5M01'],
 ['prime','karakuri-circus','꼭두각시 서커스','https://www.primevideo.com/-/ko/detail/0RMO6B95JK1V641KSQV6W0VIQH'],
 ['prime','ghost-in-the-shell','공각기동대','https://www.primevideo.com/-/ko/detail/0MRWXUDE3L303XFEJRNWB20S3O'],
 ['prime','hazbin-hotel','해즈빈 호텔','https://www.primevideo.com/-/ko/detail/0HZWTBZYQQXYW48YBANMDM2MZE'],
 ['prime','look-back','룩백','https://www.primevideo.com/-/ko/detail/0UA9Q3CLPT1Q1GZL2M0N4JRHRL'],
 ['tving','jujutsu-kaisen','주술회전','https://www.tving.com/contents/P001336142'],
 ['tving','attack-on-titan','진격의 거인','https://www.tving.com/contents/P001319056'],
 ['tving','frieren','장송의 프리렌','https://www.tving.com/contents/P001747384'],
 ['tving','chainsaw-man','체인소 맨','https://www.tving.com/contents/P001654042'],
 ['watcha','jujutsu-kaisen','극장판 주술회전 0','https://watcha.com/ko/contents/m5Go91n'],
 ['watcha','chainsaw-man','체인소 맨','https://watcha.com/ko/contents/tPJZ6jo'],
 ['watcha','frieren','장송의 프리렌','https://watcha.com/ko/contents/tRN7gzz'],
 ['watcha','attack-on-titan','진격의 거인 The Final Season 파트 1','https://watcha.com/ko/contents/tEqZbVd'],
 ['crunchyroll','jujutsu-kaisen','JUJUTSU KAISEN','https://www.crunchyroll.com/series/GRDV0019R/jujutsu-kaisen'],
 ['crunchyroll','frieren','Frieren','https://www.crunchyroll.com/series/GG5H5XQX4/frieren-beyond-journeys-end'],
 ['crunchyroll','jujutsu-kaisen','JUJUTSU KAISEN 0','https://www.crunchyroll.com/watch/G4VUQ9ZQ3'],
 ['laftel','witch','어느 마녀가 죽을 때까지','https://laftel.net/item/42783'],
 ['laftel','apothecary','약사의 혼잣말','https://laftel.net/item/41714'],
 ['laftel','rezero','Re:제로부터 시작하는 이세계 생활','https://laftel.net/item/39644'],
];
// Direct TVING chainsaw URL comes from the previously frozen public capture.
const jobs=Object.entries(roots).flatMap(([provider,root])=>queries.map(([work,title])=>({provider,work,title,url:root+encodeURIComponent(title),kind:'search',id:`scale-${provider}-${work}-search`})));
for(const [provider,work,title,url] of direct) jobs.push({provider,work,title,url,kind:url.includes('/watch/')?'player-entry':'detail',id:`scale-${provider}-${work}-${url.includes('/watch/')?'watch':'detail'}`});
jobs.push({provider:'coupang',work:'none-home',title:'쿠팡플레이',url:'https://www.coupangplay.com/',kind:'home',id:'scale-coupang-home'});
await mkdir('eval/dom-scale/collection-train',{recursive:true});
await mkdir('.tmp/dom-scale/train',{recursive:true});
await writeFile('eval/dom-scale/collection-train/plan.json',JSON.stringify({plannedAt:new Date().toISOString(),candidateCap:12,observationCap:18,jobs,workGroups:[...new Set(jobs.map(j=>j.work))],forbiddenProviders:['netflix','apple'],note:'Search flows on Laftel/Aniplus/Wavve may add observed detail/modal and playback-entry captures after actual UI clicks. No fabricated DOM or player; failed clicks are retained in actions.'},null,2)+'\n');
const only=process.argv.find(x=>x.startsWith('--only='))?.slice(7);
const providerFilter=process.argv.find(x=>x.startsWith('--providers='))?.slice(12).split(',');
const selectedJobs=only?jobs.filter(j=>j.id===only):providerFilter?jobs.filter(j=>providerFilter.includes(j.provider)):jobs;
const browser=await chromium.launch({channel:'chromium',headless:true});
const results=only||providerFilter?JSON.parse(await readFile('eval/dom-scale/collection-train/observations.json','utf8')).filter(x=>!selectedJobs.some(j=>x.id.startsWith(j.id))):[];let next=0;
async function capture(page,job,stage,actions,error){
 const html=await page.content();
 const snapshot=await page.evaluate(({base,rich})=>{const s=(0,eval)(`(${rich})`)(document,location.href,(0,eval)(`(${base})`)(document,location.href));const videos=[...document.querySelectorAll('video')].slice(0,8).map(v=>{const r=v.getBoundingClientRect();return {paused:v.paused,currentTime:v.currentTime,ended:v.ended,muted:v.muted,readyState:v.readyState,width:Math.round(r.width),height:Math.round(r.height),visible:r.width>0&&r.height>0&&getComputedStyle(v).display!=='none'};});s.pageEvidence.media={videoCount:document.querySelectorAll('video').length,playingCount:videos.filter(v=>!v.paused&&!v.ended&&v.currentTime>0).length,fullscreen:!!document.fullscreenElement,videos};return {...s,annotationEvidence:{body:document.body?.innerText?.slice(0,6500)||'',buttons:[...document.querySelectorAll('button,a,[role=button]')].map(n=>({tag:n.tagName,text:(n.innerText||n.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim().slice(0,100),href:n.tagName==='A'?n.href:null})).filter(x=>x.text).slice(0,70)}};},{base:collectDomSnapshot.toString(),rich:enrichDomSnapshot.toString()});
 const id=stage?`${job.id}-${stage}`:job.id;
 const item={...job,id,intendedKind:stage||job.kind,...snapshot,actions:[...actions],navigationError:error||null,capturedAt:new Date().toISOString(),htmlSha256:createHash('sha256').update(html).digest('hex')};
 await writeFile(`.tmp/dom-scale/train/${id}.html`,html);
 await page.screenshot({path:`.tmp/dom-scale/train/${id}.png`}).catch(()=>{});
 results.push(item);await writeFile('eval/dom-scale/collection-train/observations.json',JSON.stringify(results,null,2)+'\n');
 console.log(JSON.stringify({id,url:item.pageUrl,title:item.documentTitle,dialog:item.pageEvidence.visibleDialogCount,video:item.pageEvidence.media,error}));
 return item;
}
const clickLabels={laftel:{'jujutsu-kaisen':'주술회전 1기 part 1','attack-on-titan':'진격의 거인 1기',frieren:'(자막) 장송의 프리렌'},aniplus:{'jujutsu-kaisen':'주술회전','attack-on-titan':'진격의 거인 The Final Season Part 3 (완결편 후편)',frieren:'장송의 프리렌'},wavve:{'jujutsu-kaisen':'주술회전 1기','attack-on-titan':'진격의 거인 1기',frieren:'장송의 프리렌 (자막)'}};
async function playAttempt(page,job,actions){
 const options=await page.locator('button,a,[role=button]').evaluateAll(ns=>ns.map((n,i)=>({i,text:(n.innerText||n.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim()})).filter(x=>/^(?:첫.*재생|재생|시청하기|1화.*|감상하기|Start Watching|Watch now|지금 시청|무료.*시청)/i.test(x.text)));
 if(!options.length){actions.push({kind:'playback-attempt',outcome:'no observed playback control'});return false;}
 const option=options[0];
 try{await page.locator('button,a,[role=button]').nth(option.i).click({timeout:5000});await page.waitForTimeout(2500);actions.push({kind:'playback-attempt',label:option.text,outcome:'clicked'});await capture(page,job,'playback-entry',actions);return true;}catch(e){actions.push({kind:'playback-attempt',label:option.text,error:String(e)});return false;}
}
async function worker(){while(next<selectedJobs.length){const job=selectedJobs[next++];const page=await browser.newPage({locale:'ko-KR',viewport:{width:1440,height:1000}});let error=null;const actions=[];try{await page.goto(job.url,{waitUntil:'domcontentloaded',timeout:25000});await page.waitForTimeout(3000);}catch(e){error=String(e);}try{
 const initial=await capture(page,job,'',actions,error);
 if(job.kind==='search'&&clickLabels[job.provider]){const label=clickLabels[job.provider][job.work];try{const target=job.provider==='aniplus'?page.locator('.div_li').filter({hasText:label}).last():job.provider==='wavve'?page.locator('.title1:visible').filter({hasText:label}).first():page.getByText(label,{exact:true}).first();await target.click({timeout:6000});await page.waitForTimeout(3000);actions.push({kind:'open-work',label,outcome:'clicked'});await capture(page,job,'opened-work',actions);await playAttempt(page,job,actions);}catch(e){actions.push({kind:'open-work',label,error:String(e)});}}
 else if(job.kind==='detail'&&!/잠시만|Access Denied/i.test(initial.documentTitle))await playAttempt(page,job,actions);
 initial.actions=[...actions];await writeFile('eval/dom-scale/collection-train/observations.json',JSON.stringify(results,null,2)+'\n');
 }catch(e){results.push({...job,error:String(e),captureFailed:true});await writeFile('eval/dom-scale/collection-train/observations.json',JSON.stringify(results,null,2)+'\n');}await page.close();}}
try{await Promise.all([worker(),worker(),worker()]);}finally{await browser.close();}
