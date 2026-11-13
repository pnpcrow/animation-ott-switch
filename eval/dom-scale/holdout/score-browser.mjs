// Adapts actual browser selections to the already frozen metric functions.
// No native selection is substituted for a browser result; no labels/inputs are changed.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const args=Object.fromEntries(process.argv.slice(2).map(x=>{const i=x.indexOf('=');return[x.slice(2,i),x.slice(i+1)];}));
if(!args.result||!args.recipe)throw Error('--result=actual-browser.json --recipe=development-selected-recipe required');
const base=new URL('./',import.meta.url),digest=b=>createHash('sha256').update(b).digest('hex');
const read=async p=>JSON.parse(await readFile(new URL(p,base),'utf8'));
const dataFreeze=await read('data-freeze.json'),evaluationPlan=await read('evaluation-plan.json'),browserPlan=await read('browser-evaluation-plan.json');
if(digest(await readFile(new URL(import.meta.url)))!==browserPlan.wrapperSha256)throw Error('Browser scoring wrapper changed');
for(const[file,expected]of Object.entries(dataFreeze.hashes))if(digest(await readFile(new URL(file,base)))!==expected)throw Error('Data freeze mismatch: '+file);
const frozenScorer=await readFile(new URL('score.mjs',base),'utf8');
if(digest(frozenScorer)!==evaluationPlan.scorerSha256||evaluationPlan.scorerSha256!==browserPlan.frozenScorerSha256)throw Error('Frozen scoring functions changed');
// Extract the byte-identical, standalone metric declarations from trusted frozen code.
// That scorer's top-level native file runner is deliberately not executed here.
const start=frozenScorer.indexOf('const quantile='),end=frozenScorer.indexOf('const models=[];');
if(start<0||end<start)throw Error('Frozen metric block not found');
const metrics=Function(frozenScorer.slice(start,end)+';return metrics;')();
const labels=await read('labels.json'),inputs=await read('inputs.json'),inputById=new Map(inputs.map(i=>[i.id,i]));
const bytes=await readFile(args.result),actual=JSON.parse(bytes),list=actual.cases??[];
const actualById=new Map(list.map(p=>[p.id,p]));
if(actualById.size!==list.length||list.some(p=>!inputById.has(p.id)))throw Error('Duplicate or unknown browser case');
const native=await read(`predictions/${args.recipe}-predictions.json`);
const jobsBytes=await readFile(new URL(`predictions/${args.recipe}-micro2-browser.json`,base));
if(actual.modelSha256!==native.modelSha256||actual.jobsSha256!==digest(jobsBytes))throw Error('Actual browser model/job identity differs');
if(actual.mode!=='worker'||actual.provider!=='wasm'||actual.threads!==1||actual.tokenize!==true)throw Error('Unexpected browser configuration');
const rows=labels.map(label=>{
 const input=inputById.get(label.id),observed=actualById.get(label.id);
 const prediction=observed??{id:label.id,field:label.field,selected:null,valid:false,error:'Case not executed or no browser result returned'};
 if(observed&&JSON.stringify([...observed.candidateIds].sort())!==JSON.stringify(input.options.map(o=>o.id).sort()))throw Error('Browser candidate set differs: '+label.id);
 const validSelection=prediction.valid===true&&!prediction.error&&input.options.some(o=>o.id===prediction.selected);
 // The frozen scorer treats !validSelection as a failure independently of error text.
 return{label,prediction,positive:label.expectedId!=='__none__',validSelection,correct:validSelection&&!label.quality.allAcceptedOutsidePool&&label.acceptedIds.includes(prediction.selected)};
});
const breakdown={};
for(const key of ['field','cohort','provider','observedKind','kind'])breakdown[key]=Object.fromEntries(Object.entries(Object.groupBy(rows,r=>key==='field'?r.label.field:r.label.provenance[key])).map(([k,g])=>[k,metrics(g)]));
const prior=new Map(native.micro2Predictions.map(p=>[p.id,p]));
const comparable=rows.filter(r=>r.validSelection&&!prior.get(r.label.id)?.error&&inputById.get(r.label.id).options.some(o=>o.id===prior.get(r.label.id)?.selected));
const report={schemaVersion:1,scoredAt:new Date().toISOString(),recipe:args.recipe,configuration:{mode:actual.mode,provider:actual.provider,threads:actual.threads,tokenize:actual.tokenize,microbatch:2},
 dataFreezeSha256:digest(await readFile(new URL('data-freeze.json',base))),browserPlanSha256:digest(await readFile(new URL('browser-evaluation-plan.json',base))),rawBrowserResult:{path:args.result,sha256:digest(bytes),returnedCases:list.length,finishedAt:actual.finishedAt,error:actual.error??null},
 metrics:metrics(rows),breakdown,nativeComparison:{comparableSelections:comparable.length,sameSelections:comparable.filter(r=>r.prediction.selected===prior.get(r.label.id).selected).length,different:comparable.filter(r=>r.prediction.selected!==prior.get(r.label.id).selected).map(r=>({id:r.label.id,browser:r.prediction.selected,native:prior.get(r.label.id).selected}))},
 runtime:{processing:actual.processing,inference:actual.inference,tokenizationAndInference:actual.tokenizationAndInference,loadMs:actual.loadMs,tokenizerLoadMs:actual.tokenizerLoadMs,modelBytes:actual.modelBytes,processMemory:actual.processMemory,mainThreadTimer:actual.mainThreadTimer,environment:actual.environment},
 cases:rows.map(r=>({id:r.label.id,validSelection:r.validSelection,selected:r.prediction.selected??null,correct:r.correct,error:r.prediction.error??null,missingGold:r.label.quality.allAcceptedOutsidePool})),
 notes:['Every selection is from the actual browser result, not copied from native predictions.','Missing, invalid or errored browser cases remain failures in the full frozen denominator.','The three fixed-pool target-recall failures remain incorrect.','Metric function bytes are the independently frozen native scorer implementation.','Whole-process sampled working-set measurements are not continuous physical-memory peaks; field timings exclude DOM collection/template preparation and model loading.']};
await writeFile(new URL('browser-scores.json',base),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({recipe:args.recipe,metrics:report.metrics,nativeComparison:report.nativeComparison},null,2));
