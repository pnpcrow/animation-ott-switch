// Run only after all model conditions are frozen. Never changes annotation or candidate inputs.
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const base=new URL('./',import.meta.url);
const read=async name=>JSON.parse(await readFile(new URL(name,base),'utf8'));
const digest=b=>createHash('sha256').update(b).digest('hex');
const freeze=await read('data-freeze.json');
const evaluationPlan=await read('evaluation-plan.json');
if(digest(await readFile(new URL(import.meta.url)))!==evaluationPlan.scorerSha256)throw Error('Scorer differs from the predeclared evaluation plan');
for(const[file,expected]of Object.entries(freeze.hashes))if(digest(await readFile(new URL(file,base)))!==expected)throw Error('Holdout freeze mismatch: '+file);
const labels=await read('labels.json'),inputs=await read('inputs.json'),inputById=new Map(inputs.map(x=>[x.id,x]));
const directory=new URL('./predictions/',base);
const quantile=(v,p)=>v.toSorted((a,b)=>a-b)[Math.min(v.length-1,Math.floor((v.length-1)*p))]??null;
const mean=v=>v.length?v.reduce((a,b)=>a+b,0)/v.length:null;
function interval(rows){
 const groups=Object.values(Object.groupBy(rows,r=>r.label.provenance.work));
 if(groups.length<2)return null;
 let seed=731214;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const accuracy=[];
 for(let k=0;k<2000;k++){
  let n=0,correct=0;
  for(let j=0;j<groups.length;j++){const g=groups[Math.floor(random()*groups.length)];n+=g.length;correct+=g.reduce((a,x)=>a+Number(x.correct),0);}
  accuracy.push(correct/n);
 }
 return{method:'percentile bootstrap by canonical work family; all pages/fields/services for a sampled work stay together',resamples:2000,clusters:groups.length,low:quantile(accuracy,.025),high:quantile(accuracy,.975)};
}
function metrics(rows){
 const count=fn=>rows.filter(fn).length;
 const correct=count(r=>r.correct),positive=count(r=>r.positive),negative=rows.length-positive;
 const correctPositive=count(r=>r.correct&&r.positive),correctNone=count(r=>r.correct&&!r.positive);
 const selectedPositive=count(r=>r.validSelection&&r.prediction.selected!=='__none__'),selectedNone=count(r=>r.validSelection&&r.prediction.selected==='__none__');
 const byPage=Object.values(Object.groupBy(rows,r=>r.label.provenance.pageId));
 const pagesWithAllFields=byPage.filter(p=>p.length===3);
 return {cases:rows.length,correct,accuracy:rows.length?correct/rows.length:null,correctPositive,positiveCases:positive,correctNone,noneCases:negative,
  positiveSelectionPrecision:selectedPositive?correctPositive/selectedPositive:null,positiveSelectionRecall:positive?correctPositive/positive:null,
  nonePrecision:selectedNone?correctNone/selectedNone:null,noneRecall:negative?correctNone/negative:null,
  falsePositiveOnNone:count(r=>!r.positive&&r.validSelection&&r.prediction.selected!=='__none__'),falseNoneOnPositive:count(r=>r.positive&&r.validSelection&&r.prediction.selected==='__none__'),
  executionFailures:count(r=>!!r.prediction.error||!r.validSelection),missingGoldCases:count(r=>r.label.quality.allAcceptedOutsidePool),
  allFieldsCorrectPages:pagesWithAllFields.filter(p=>p.every(r=>r.correct)).length,completePages:pagesWithAllFields.length,
  accuracyWhenGoldInPool:mean(rows.filter(r=>!r.label.quality.allAcceptedOutsidePool).map(r=>Number(r.correct))),
  inferenceMs:{median:quantile(rows.map(r=>r.prediction.inferenceMs).filter(Number.isFinite),.5),p95:quantile(rows.map(r=>r.prediction.inferenceMs).filter(Number.isFinite),.95)},
  workClusterAccuracy95:interval(rows)};
}
const models=[];
for(const file of (await readdir(directory)).filter(x=>x.endsWith('-predictions.json')).sort()){
 const result=JSON.parse(await readFile(new URL(file,directory),'utf8'));
 const planBytes=await readFile(new URL(`../../../.tmp/dom-scale/holdout/plans/${result.recipe}.json`,base));
 const plan=JSON.parse(planBytes);
 if(digest(planBytes)!==result.inputPlanSha256||plan.inputsSha256!==freeze.hashes['inputs.json'])throw Error('Input-plan provenance differs: '+result.recipe);
 for(const[mode,list]of [['full',result.predictions],['micro2',result.micro2Predictions]]){
  if(!list)continue;
  const predictions=new Map(list.map(r=>[r.id,r]));if(predictions.size!==list.length)throw Error('Duplicate prediction ids');
  if(predictions.size!==labels.length||list.some(r=>!inputById.has(r.id)))throw Error('Prediction case set differs');
  const rows=labels.map(label=>{
   const prediction=predictions.get(label.id),input=inputById.get(label.id);
   if(JSON.stringify([...prediction.candidateIds].sort())!==JSON.stringify(input.options.map(o=>o.id).sort()))throw Error('Candidate set differs: '+label.id);
   const validSelection=!prediction.error&&input.options.some(o=>o.id===prediction.selected);
   return{label,prediction,positive:label.expectedId!=='__none__',validSelection,correct:validSelection&&!label.quality.allAcceptedOutsidePool&&label.acceptedIds.includes(prediction.selected)};
  });
  const breakdown={};
  for(const key of ['field','cohort','provider','observedKind','kind']){
   const groups=Object.groupBy(rows,r=>key==='field'?r.label.field:r.label.provenance[key]);
   breakdown[key]=Object.fromEntries(Object.entries(groups).map(([k,g])=>[k,metrics(g)]));
  }
  models.push({recipe:result.recipe,mode,modelSha256:result.modelSha256,modelFreezeSha256:result.freezeSha256,inputPlanSha256:result.inputPlanSha256,predictionsSha256:digest(await readFile(new URL(file,directory))),metrics:metrics(rows),breakdown,
   cases:rows.map(({label,prediction,correct,validSelection})=>({id:label.id,correct,validSelection,selected:prediction.selected??null,error:prediction.error??null,expectedId:label.expectedId,acceptedIds:label.acceptedIds,missingGold:label.quality.allAcceptedOutsidePool}))});
 }
}
function compare(before,after){
 const prior=new Map(before.cases.map(c=>[c.id,c])),next=new Map(after.cases.map(c=>[c.id,c]));
 const groups=Object.values(Object.groupBy(labels,l=>l.provenance.work));
 let seed=731215;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const differences=[];
 for(let i=0;i<2000;i++){
  let total=0,delta=0;
  for(let j=0;j<groups.length;j++)for(const l of groups[Math.floor(random()*groups.length)]){total++;delta+=Number(next.get(l.id).correct)-Number(prior.get(l.id).correct);}
  differences.push(delta/total);
 }
 return{before:before.recipe+'/'+before.mode,after:after.recipe+'/'+after.mode,cases:labels.length,
  correctGained:labels.filter(l=>!prior.get(l.id).correct&&next.get(l.id).correct).length,correctLost:labels.filter(l=>prior.get(l.id).correct&&!next.get(l.id).correct).length,
  sameSelection:labels.filter(l=>prior.get(l.id).selected===next.get(l.id).selected).length,
  accuracyDifference:after.metrics.accuracy-before.metrics.accuracy,
  pairedWorkClusterDifference95:{method:'paired percentile bootstrap by canonical work family',resamples:2000,clusters:groups.length,low:quantile(differences,.025),high:quantile(differences,.975)}};
}
const comparisons=[];
for(const recipe of ['full-natural','full-compact','small-compact']){
 const full=models.find(m=>m.recipe===recipe&&m.mode==='full'),micro=models.find(m=>m.recipe===recipe&&m.mode==='micro2');
 if(full&&micro)comparisons.push(compare(full,micro));
}
const baseline=models.find(m=>m.recipe==='full-natural'&&m.mode==='full');
if(baseline)for(const recipe of ['full-compact','small-compact']){const other=models.find(m=>m.recipe===recipe&&m.mode==='full');if(other)comparisons.push(compare(baseline,other));}
const report={schemaVersion:1,scoredAt:new Date().toISOString(),dataFreezeSha256:digest(await readFile(new URL('data-freeze.json',base))),scorerSha256:digest(await readFile(new URL(import.meta.url))),attempts:freeze.attempts,scoredPages:freeze.pages,cases:freeze.cases,
 notes:['Three fixed-pool target-recall failures remain incorrect for every model, including none predictions.','A missing/invalid selection or execution error is incorrect even on a none case.','Confidence intervals resample whole canonical work families, not individual candidates or fields.','Only two unseen services are tested; intervals do not establish population-wide service generalization.','Full and micro2 inference timings are local CPU runner measurements, not Chrome/WebGPU measurements.'],comparisons,models};
await writeFile(new URL('scores.json',base),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(models.map(m=>({recipe:m.recipe,mode:m.mode,...m.metrics})),null,2));
