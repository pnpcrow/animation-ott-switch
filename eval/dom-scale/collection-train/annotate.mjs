import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {questions} from '../../tiny-decision/v2/collect-inputs.mjs';
import {optionText,shuffleOptions} from '../../tiny-decision/dataset.mjs';

// Fixed manual decisions made from captured values, DOM observations and screenshots,
// before loading or evaluating any model predictions. Never use this map in collection.
const positives={
 'scale-laftel-jujutsu-kaisen-search-opened-work':['work-modal','t3','i2','d2','Visible work heading and series plot in search overlay; preview video poster, not episode thumbnails.'],
 'scale-laftel-frieren-search-opened-work':['work-modal','t3','i2','d2','Opened work overlay despite stale search head metadata and no ARIA dialog. Muted preview does not make it a full player.'],
 'scale-laftel-witch-detail':['detail','t3','i1','d2','Clean h1 and work-specific OG artwork/plot; ignore generic description and home recommendations behind overlay.'],
 'scale-laftel-apothecary-detail':['detail-unavailable','t3','i1','__none__','Work title/artwork exist but page says unavailable; {줄거리} is a placeholder, not a synopsis.'],
 'scale-laftel-apothecary-detail-playback-entry':['detail-unavailable','t3','i1','__none__','Click did not enter a player; same unavailable detail. Duplicate state retained as attempt, excluded from training.'],
 'scale-laftel-rezero-detail':['detail','t3','i1','d2','Work h1/OG artwork/series plot; background home titles are distractors.'],
 'scale-prime-blade-of-the-immortal-detail':['detail','t2',['i1','i3'],'d1','h1 series name, OG artwork and full-width 1600x900 hero, series plot metadata.'],
 'scale-prime-karakuri-circus-detail':['detail','t2',['i1','i3'],'d1','Same observed title/hero/plot relations; episode names and channel logos excluded.'],
 'scale-prime-ghost-in-the-shell-detail':['detail','t2',['i1','i3'],'d1','Title-logo alt supplies clean name, but title-logo image i5 is not artwork; hero i3 is 1600x900.'],
 'scale-prime-hazbin-hotel-detail':['detail','t2',['i1','i3'],'d1','Title-logo alt supplies clean name; artwork i3 is full hero, i5 is title logo.'],
 'scale-prime-look-back-detail':['detail','t2',['i1','i3'],'d1','Movie detail with clear plot; recommendation title aria-label is not its synopsis.'],
 'scale-tving-jujutsu-kaisen-detail':['detail','t3',['i1','i3','i4'],'d1','h1 and browser title append 1화; clean name is image alt. Artwork metadata/landscape/portrait accepted; title logo i5 excluded.'],
 'scale-tving-attack-on-titan-detail':['detail','t3','i1','d1','Adult placeholder thumbnails i3/i4 are not artwork; work-specific OG image retained. No full video element.'],
 'scale-tving-frieren-detail':['detail','t3',['i1','i3','i4'],'d1','Series synopsis metadata differs from episode summaries; poster and artwork metadata accepted, title logo excluded.'],
 'scale-tving-chainsaw-man-detail':['detail','t3','i1','d1','Age-gated placeholder images excluded. Series synopsis and clean title observed despite episode-suffixed browser title.'],
 'scale-aniplus-attack-on-titan-search-opened-work':['detail','t6','i2',['d2','d4'],'Work heading, second work-specific image metadata, both series-synopsis metadata and visible plot.'],
 'scale-aniplus-jujutsu-kaisen-search-opened-work':['detail','t6','i2',['d2','d4'],'Site has conflicting generic and work metadata; use clean work heading, second artwork and plot.'],
 'scale-aniplus-frieren-search-opened-work':['detail','t6','i2',['d2','d4'],'Opening work through actual search-card click; h2 clean title, specific artwork and synopsis.'],
 'scale-wavve-frieren-search-opened-work':['detail','t4','i2',['d3','d4'],'URL contains player but observed screen is season detail with zero video elements; heading,1240x698 hero and series plot.'],
 'scale-wavve-jujutsu-kaisen-search-opened-work':['detail','t4','i2',['d4','d3'],'Clean title alt and large hero; monochrome title logo i3 and episode summaries excluded.'],
 'scale-watcha-jujutsu-kaisen-detail':['detail','t2',['i1','i2'],['d1','d2'],'Movie metadata and visible work h1/synopsis; same hero appears blurred background and foreground; title logo excluded.'],
 'scale-watcha-chainsaw-man-detail':['detail','t2',['i1','i2'],'d1','Work h1 and synopsis metadata; i2 official foreground/background artwork, i3 title logo.'],
 'scale-watcha-frieren-detail':['detail','t2',['i1','i2'],'d1','Series detail visible despite lower page loading indicator; clear work metadata/hero/plot.'],
 'scale-watcha-attack-on-titan-detail':['detail','t2',['i1','i2'],'d1','Series detail; season name text d2 is not synopsis.'],
 'auth-class-marriage-modal':['work-modal','t3',['i2','i3'],'d3','Authenticated actual work modal; search title remains stale. Poster variants accepted, series synopsis before episode summaries.'],
 'auth-class-marriage-player':['full-player','__none__','__none__','__none__','Authenticated full episode player. Actual media paused=false,currentTime55,readyState4; all extraction decisions abstain.'],
};
const pages=JSON.parse(await readFile('eval/dom-scale/collection-train/observations.json','utf8'));
for(const name of ['class-marriage-modal','class-marriage-player']) {
 const p=JSON.parse(await readFile(`eval/dom-scale/auth-training/${name}.json`,'utf8'));
 p.url=p.pageUrl;
 const vs=p.pageEvidence.videos||[];
 p.pageEvidence.media={videoCount:vs.length,playingCount:vs.filter(v=>v.paused===false&&v.currentTime>0&&!v.ended).length,fullscreen:null,...p.media,videos:vs};
 p.collectorVariant='auth-read-only-v1'; pages.push(p);
}
const ann=[];const inputs=[];const labels=[];
for(const p of pages) {
 let a=positives[p.id];
 if(!a) {
  let kind,reason;
  if(p.documentTitle==='Access Denied'){kind='blocked';reason='Access denied response, no work detail observed.';}
  else if(p.documentTitle?.includes('잠시만 기다리십시오')){kind='challenge';reason='Browser security challenge; no bypass attempted and no work detail observed.';}
  else if(/\/auth\/login|\/member\/login/.test(p.pageUrl)){kind='login';reason='Actual navigation reached login, not selected work.';}
  else if(/\/player\//.test(p.pageUrl)){kind='player-login-gate';reason='Full episode player shell requests login; video readyState0 and no playback. Do not count as actual playing coverage.';}
  else if(p.kind==='search'){kind='search';reason='Search/list page, no work detail open; presence of title-matching cards is insufficient.';}
  else throw new Error(`Unannotated state ${p.id}`);
  a=[kind,'__none__','__none__','__none__',reason];
 }
 const [pageKind,title,image,description,rationale]=a;
 const annotation={pageId:p.id,provider:p.provider,work:p.work,pageKind,rationale,fields:{title,image,description},reviewedBeforePredictions:true,collectorVariant:p.collectorVariant||'public-generic-v2-media',sourceUrl:p.url||p.pageUrl,actualUrl:p.pageUrl};
 if(p.id==='scale-laftel-apothecary-detail-playback-entry')annotation.duplicateOf='scale-laftel-apothecary-detail';
 ann.push(annotation);
 for(const [field,question] of Object.entries(questions)) {
  const id=`${p.id}-${field}`,pool=p.fields[field].slice(0,12),value=annotation.fields[field],acceptedIds=Array.isArray(value)?value:[value];
  for(const gold of acceptedIds)if(gold!=='__none__'&&!p.fields[field].some(c=>c.id===gold))throw new Error(`Unobserved gold ${id}/${gold}`);
  inputs.push({id,split:'development',field,question,document:`URL: ${p.pageUrl}\nDocument title: ${String(p.documentTitle||'').slice(0,140)}\nCandidates are bounded observations from this same live DOM; head metadata may be hidden normally. Ancestors use >; adjacent text is local context.`,pageEvidence:p.pageEvidence,options:shuffleOptions([...pool.map(candidate=>({id:candidate.id,text:optionText(candidate,field),evidence:candidate})),{id:'__none__',text:'None: no suitable current-work element in the evidence.',evidence:null}],id)});
  const inPool=x=>x==='__none__'||pool.some(c=>c.id===x);
  labels.push({id,split:'development',expectedId:acceptedIds[0],acceptedIds,provenance:{kind:p.collectorVariant?'real-authenticated-dom':'real-public-dom',pageId:p.id,work:p.work,provider:p.provider,url:p.pageUrl,sourceUrl:p.url||p.pageUrl,pageKind,collectorVariant:annotation.collectorVariant,capturedAt:p.capturedAt,htmlSha256:p.htmlSha256||null,duplicateOf:annotation.duplicateOf||null},quality:{observedCandidates:p.fields[field].length,presentedCandidates:pool.length,emptyConcretePool:pool.length===0,expectedOutsidePool:!inPool(acceptedIds[0]),allAcceptedOutsidePool:acceptedIds.every(x=>!inPool(x)),excludeFromTraining:!!annotation.duplicateOf}});
 }
}
for(const [name,data] of Object.entries({annotations:ann,inputs,labels}))await writeFile(`eval/dom-scale/collection-train/${name}.json`,JSON.stringify(data,null,2)+'\n');
const counts={pages:pages.length,cases:inputs.length,positiveCases:labels.filter(l=>l.expectedId!=='__none__').length,providers:Object.fromEntries([...new Set(ann.map(a=>a.provider))].map(p=>[p,ann.filter(a=>a.provider===p).length])),pageKinds:Object.fromEntries([...new Set(ann.map(a=>a.pageKind))].map(k=>[k,ann.filter(a=>a.pageKind===k).length])),workGroups:[...new Set(ann.map(a=>a.work))],allAcceptedOutsidePool:labels.filter(l=>l.quality.allAcceptedOutsidePool).length};
await writeFile('eval/dom-scale/collection-train/coverage.json',JSON.stringify(counts,null,2)+'\n');
console.log(JSON.stringify(counts));
