import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {questions} from '../../tiny-decision/v2/collect-inputs.mjs';
import {optionText,shuffleOptions} from '../../tiny-decision/dataset.mjs';
const read=async name=>JSON.parse(await readFile(new URL(name,import.meta.url),'utf8'));
const observations=[...await read('./observations.json'),...await read('./auth-observations.json')];
const {pages:annotations}=await read('./annotations.json');
const inputs=[],labels=[];
const hash=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
for(const page of observations){
 const gold=annotations[page.id];if(!gold)throw Error('Missing annotation '+page.id);if(!gold.include)continue;
 for(const [field,question]of Object.entries(questions)){
  const id=`${page.id}-${field}`,pool=page.fields[field].slice(0,12);
  const expectedId=gold[field],acceptedIds=gold.accepted?.[field]??[expectedId];
  const missingObserved=gold.missingObservedFields?.includes(field)??false;
  if(!expectedId||(!missingObserved&&!acceptedIds.includes(expectedId))||(missingObserved&&acceptedIds.length))throw Error('Invalid gold '+id);
  if(acceptedIds.some(x=>x!=='__none__'&&!page.fields[field].some(c=>c.id===x)))throw Error('Unobserved gold '+id);
  inputs.push({id,split:'holdout',field,question,
   document:`URL: ${page.pageUrl}\nDocument title: ${String(page.documentTitle||'').slice(0,140)}\nCandidates are bounded observations from this same live DOM; head metadata may be hidden normally. Ancestors use >; adjacent text is local context.`,
   pageEvidence:page.pageEvidence,
   options:shuffleOptions([...pool.map(candidate=>({id:candidate.id,text:optionText(candidate,field),evidence:candidate})),{id:'__none__',text:'None: no suitable current-work element in the evidence.',evidence:null}],id)
  });
  labels.push({id,field,expectedId,acceptedIds,
   provenance:{kind:page.enrichment?.version==='auth-read-only-v1'?'real-authenticated-dom':'real-public-dom',pageId:page.id,provider:page.provider,cohort:page.cohort,work:page.work,url:page.url,capturedAt:page.capturedAt,requestedKind:page.requestedKind,observedKind:gold.observedKind,captureSha256:hash(page)},
   quality:{observedCandidates:page.fields[field].length,presentedCandidates:pool.length,actualTargetPresent:expectedId!=='__none__',candidateRecall:expectedId==='__none__'||acceptedIds.some(x=>pool.some(c=>c.id===x)),missingGold:missingObserved||!acceptedIds.some(x=>x==='__none__'||pool.some(c=>c.id===x)),missingFromOriginalObservedPool:missingObserved,outsidePoolAcceptedIds:acceptedIds.filter(x=>x!=='__none__'&&!pool.some(c=>c.id===x)),expectedOutsidePool:expectedId!=='__none__'&&!pool.some(c=>c.id===expectedId),allAcceptedOutsidePool:!acceptedIds.some(x=>x==='__none__'||pool.some(c=>c.id===x))}
  });
 }
}
for(const [name,rows]of [['inputs.json',inputs],['labels.json',labels]])await writeFile(new URL('./'+name,import.meta.url),JSON.stringify(rows,null,2)+'\n');
const counts=key=>Object.fromEntries([...new Set(observations.map(p=>p[key]))].map(k=>[k,{attempts:observations.filter(p=>p[key]===k).length,pages:observations.filter(p=>p[key]===k&&annotations[p.id]?.include).length}]));
const manifest={version:1,createdAt:new Date().toISOString(),candidateCap:12,noneCandidate:true,attempts:observations.length,pages:inputs.length/3,cases:inputs.length,providers:counts('provider'),cohorts:counts('cohort'),observedKinds:Object.fromEntries([...new Set(Object.values(annotations).map(a=>a.observedKind))].map(k=>[k,{attempts:Object.values(annotations).filter(a=>a.observedKind===k).length,pages:Object.values(annotations).filter(a=>a.observedKind===k&&a.include).length}])),missingGoldCases:labels.filter(l=>l.quality.allAcceptedOutsidePool).length,hashes:{}};
for(const name of ['observations.json','auth-observations.json','auth-annotation-evidence.json','annotations.json','inputs.json','labels.json','annotate.mjs','build.mjs','sanitize.mjs'])manifest.hashes[name]=hash(await readFile(new URL('./'+name,import.meta.url),'utf8'));
await writeFile(new URL('./manifest.json',import.meta.url),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest,null,2));
