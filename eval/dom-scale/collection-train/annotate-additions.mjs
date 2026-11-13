import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {questions} from '../../tiny-decision/v2/collect-inputs.mjs';
import {optionText,shuffleOptions} from '../../tiny-decision/dataset.mjs';
const dir='eval/dom-scale/collection-train/';
const pages=JSON.parse(await readFile(dir+'additional-observations.json','utf8'));
let extraAnnotations=[];
try{extraAnnotations=JSON.parse(await readFile(dir+'auth-annotations.json','utf8'));for(const a of extraAnnotations)pages.push(JSON.parse(await readFile(dir+`auth-captures/${a.pageId}.json`,'utf8')));}catch(e){if(e.code!=='ENOENT')throw e;}
const annotations=[
 {pageId:'more-aniplus-chainsaw-man-search',pageKind:'search-empty',title:'__none__',image:'__none__',description:'__none__',rationale:'Observed search returned zero results for query with a space. Failed open-work click retained as attempt, not a fictitious detail.'},
 {pageId:'more-aniplus-witch-search',pageKind:'search-empty',title:'__none__',image:'__none__',description:'__none__',rationale:'Observed search returned zero results; no detail opened.'},
 {pageId:'more-wavve-witch-search',pageKind:'search',title:'__none__',image:'__none__',description:'__none__',rationale:'Search contains program and episode matches but no opened work.'},
 {pageId:'more-wavve-chainsaw-man-search',pageKind:'search',title:'__none__',image:'__none__',description:'__none__',rationale:'Search result listing mixes programs, a movie and episodes. No active detail.'},
 {pageId:'more-wavve-witch-search-opened-work',pageKind:'detail',title:'t4',image:'i2',description:['d4','d3'],rationale:'Observed season detail reached through actual result click. Clean title alt,1240x698 work hero, aria-label/full and visible shortened series synopsis. /player route has zero videos; not full player.'},
 {pageId:'more-wavve-chainsaw-man-search-opened-work',pageKind:'login',title:'__none__',image:'__none__',description:'__none__',rationale:'Actual result click redirected to login. No authenticated work evidence.'},
 {pageId:'more-tving-chainsaw-man-search',pageKind:'search',title:'__none__',image:'__none__',description:'__none__',rationale:'Search result listing. Recommendations and matching card metadata do not establish an opened work.'},
 ...extraAnnotations,
];
const inputs=[],labels=[];
for(const p of pages) {
 const a=annotations.find(a=>a.pageId===p.id);if(!a)throw new Error(`Unannotated ${p.id}`);
 a.provider=p.provider;a.work=p.work;a.url=p.pageUrl;a.sourceUrl=p.url||p.pageUrl;a.reviewedBeforePredictions=true;
 if(p.media)p.pageEvidence.media={...p.media,videos:p.pageEvidence.videos||p.videoEvidence||[]};
 for(const [field,question]of Object.entries(questions)){
  const id=p.id+'-'+field,pool=p.fields[field].slice(0,12),acceptedIds=Array.isArray(a[field])?a[field]:[a[field]];
  for(const gold of acceptedIds)if(gold!=='__none__'&&!(gold==='__missing__'&&a.missingGold)&&!p.fields[field].some(c=>c.id===gold))throw new Error(`Unobserved gold ${id}/${gold}`);
  inputs.push({id,split:'development',field,question,document:`URL: ${p.pageUrl}\nDocument title: ${String(p.documentTitle||'').slice(0,140)}\nCandidates are bounded observations from this same live DOM; head metadata may be hidden normally. Ancestors use >; adjacent text is local context.`,pageEvidence:p.pageEvidence,options:shuffleOptions([...pool.map(c=>({id:c.id,text:optionText(c,field),evidence:c})),{id:'__none__',text:'None: no suitable current-work element in the evidence.',evidence:null}],id)});
  const inside=x=>x==='__none__'||pool.some(c=>c.id===x);
  labels.push({id,split:'development',expectedId:acceptedIds[0],acceptedIds,provenance:{kind:p.captureMethod?'real-browser-profile-dom':'real-public-dom',pageId:p.id,work:p.work,provider:p.provider,url:p.pageUrl,sourceUrl:p.url||p.pageUrl,pageKind:a.pageKind,collectorVariant:p.collectorVariant||'public-generic-v2-media',collectorSha256:p.collectorSha256||null,authState:a.authState||'anonymous-isolated',capturedAt:p.capturedAt,htmlSha256:p.htmlSha256||null},quality:{observedCandidates:p.fields[field].length,presentedCandidates:pool.length,emptyConcretePool:pool.length===0,expectedOutsidePool:!inside(acceptedIds[0]),allAcceptedOutsidePool:acceptedIds.every(x=>!inside(x)),collectorMiss:!!a.missingGold,missingGold:!!a.missingGold,excludeFromTraining:!!a.missingGold,missingEvidence:a.missingEvidence?.[field]||null}});
 }
}
for(const [name,data]of Object.entries({annotations,inputs,labels}))await writeFile(dir+`additional-${name}.json`,JSON.stringify(data,null,2)+'\n');
// Keep full annotation evidence only in the ignored local audit copy.
const original=await readFile(dir+'additional-observations.json','utf8');
if(pages.some(p=>p.annotationEvidence))await writeFile('.tmp/dom-scale/train/additional-review-evidence.json',original);
const publicPages=pages.filter(p=>!p.captureMethod).map(p=>{const copy={...p};delete copy.annotationEvidence;return copy;});
await writeFile(dir+'additional-observations.json',JSON.stringify(publicPages,null,2)+'\n');
const hashes={};for(const name of ['additional-observations.json','additional-annotations.json','additional-inputs.json','additional-labels.json','collect-additions.mjs','annotate-additions.mjs'])hashes[name]=createHash('sha256').update(await readFile(dir+name)).digest('hex');
for(const name of await readdir(dir+'auth-captures'))hashes['auth-captures/'+name]=createHash('sha256').update(await readFile(dir+'auth-captures/'+name)).digest('hex');
hashes['auth-collector-v3.mjs']=createHash('sha256').update(await readFile(dir+'auth-collector-v3.mjs')).digest('hex');
await writeFile(dir+'additional-manifest.json',JSON.stringify({frozenAt:new Date().toISOString(),note:'Additional cohort collected/annotated without inspecting model predictions; initial frozen cohort unchanged.',pages:pages.length,cases:inputs.length,candidateCap:12,observationCap:18,sourceHashes:hashes,works:[...new Set(pages.map(p=>p.work))],coverage:Object.fromEntries([...new Set(annotations.map(a=>a.provider))].map(provider=>[provider,annotations.filter(a=>a.provider===provider).reduce((r,a)=>(r[a.pageKind]=(r[a.pageKind]||0)+1,r),{})]))},null,2)+'\n');
console.log(JSON.stringify({pages:pages.length,cases:inputs.length,positive:labels.filter(l=>l.expectedId!=='__none__').length}));
