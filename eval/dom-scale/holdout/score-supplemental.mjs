// Supplemental condition added from development evidence before any holdout predictions.
// Original three-condition scorer and all held-out inputs/labels stay unchanged.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const args=Object.fromEntries(process.argv.slice(2).map(x=>{const i=x.indexOf('=');return[x.slice(2,i),x.slice(i+1)];}));
const base=new URL('./',import.meta.url),digest=b=>createHash('sha256').update(b).digest('hex');
const read=async p=>JSON.parse(await readFile(new URL(p,base),'utf8'));
const freeze=await read('data-freeze.json'),initialPlan=await read('evaluation-plan.json'),supplement=await read('supplemental-evaluation-plan.json');
if(digest(await readFile(new URL(import.meta.url)))!==supplement.wrapperSha256)throw Error('Supplemental wrapper changed');
for(const[file,expected]of Object.entries(freeze.hashes))if(digest(await readFile(new URL(file,base)))!==expected)throw Error('Data freeze mismatch: '+file);
const source=await readFile(new URL('score.mjs',base),'utf8');
if(digest(source)!==initialPlan.scorerSha256||initialPlan.scorerSha256!==supplement.frozenScorerSha256)throw Error('Original scorer changed');
const labels=await read('labels.json'),inputs=await read('inputs.json'),byInput=new Map(inputs.map(x=>[x.id,x]));
const start=source.indexOf('const quantile='),end=source.indexOf('const models=[];'),compareStart=source.indexOf('function compare('),compareEnd=source.indexOf('const comparisons=[];');
if(start<0||end<start||compareStart<0||compareEnd<compareStart)throw Error('Frozen metric function anchors changed');
const{metrics,compare}=Function('labels',source.slice(start,end)+source.slice(compareStart,compareEnd)+';return{metrics,compare};')(labels);
const predictionBytes=await readFile(new URL('supplemental/predictions/small-natural-predictions.json',base)),predictions=JSON.parse(predictionBytes);
if(predictions.recipe!=='small-natural')throw Error('Wrong supplemental recipe');
const planBytes=await readFile(new URL('../../../.tmp/dom-scale/holdout/followup-plans/small-natural.json',base)),inputPlan=JSON.parse(planBytes);
if(digest(planBytes)!==predictions.inputPlanSha256||inputPlan.inputsSha256!==freeze.hashes['inputs.json'])throw Error('Supplemental input provenance differs');
function scoreRows(list,browser=false){
 const map=new Map(list.map(p=>[p.id,p]));if(map.size!==list.length||list.some(p=>!byInput.has(p.id)))throw Error('Duplicate or unknown supplemental case');
 if(!browser&&map.size!==labels.length)throw Error('Native supplemental denominator differs');
 const rows=labels.map(label=>{
  const input=byInput.get(label.id),observed=map.get(label.id),prediction=observed??{id:label.id,valid:false,error:'Browser case missing',selected:null};
  if(observed&&JSON.stringify([...observed.candidateIds].sort())!==JSON.stringify(input.options.map(o=>o.id).sort()))throw Error('Candidate set differs: '+label.id);
  const validSelection=(!browser||prediction.valid===true)&&!prediction.error&&input.options.some(o=>o.id===prediction.selected);
  return{label,prediction,positive:label.expectedId!=='__none__',validSelection,correct:validSelection&&!label.quality.allAcceptedOutsidePool&&label.acceptedIds.includes(prediction.selected)};
 });
 const breakdown={};
 for(const key of ['field','cohort','provider','observedKind','kind'])breakdown[key]=Object.fromEntries(Object.entries(Object.groupBy(rows,r=>key==='field'?r.label.field:r.label.provenance[key])).map(([k,g])=>[k,metrics(g)]));
 return{metrics:metrics(rows),breakdown,cases:rows.map(r=>({id:r.label.id,validSelection:r.validSelection,selected:r.prediction.selected??null,correct:r.correct,error:r.prediction.error??null,missingGold:r.label.quality.allAcceptedOutsidePool}))};
}
const models=[{recipe:'small-natural',mode:'full',...scoreRows(predictions.predictions)},{recipe:'small-natural',mode:'micro2',...scoreRows(predictions.micro2Predictions)}];
const original=await read('scores.json'),baseline=original.models.find(m=>m.recipe==='full-natural'&&m.mode==='full');
if(!baseline)throw Error('Original full-natural result missing');
const comparisons=[compare(baseline,models[0]),compare(models[0],models[1])];
let browser;
if(args['browser-result']){
 const raw=await readFile(args['browser-result']),actual=JSON.parse(raw),jobs=await readFile(new URL('supplemental/predictions/small-natural-full-browser.json',base));
 if(actual.modelSha256!==predictions.modelSha256||actual.jobsSha256!==digest(jobs))throw Error('Supplemental browser model/jobs differ');
 if(actual.mode!=='worker'||actual.provider!=='wasm'||actual.threads!==1||actual.tokenize!==true)throw Error('Wrong supplemental browser configuration');
 browser={recipe:'small-natural',mode:'browser-worker-wasm1-full',...scoreRows(actual.cases??[],true),resultPath:args['browser-result'],resultSha256:digest(raw),runtime:{processing:actual.processing,inference:actual.inference,tokenizationAndInference:actual.tokenizationAndInference,loadMs:actual.loadMs,tokenizerLoadMs:actual.tokenizerLoadMs,modelBytes:actual.modelBytes,processMemory:actual.processMemory,mainThreadTimer:actual.mainThreadTimer,environment:actual.environment}};
 comparisons.push(compare(models[0],browser));
}
const report={schemaVersion:1,scoredAt:new Date().toISOString(),supplementalPlanSha256:digest(await readFile(new URL('supplemental-evaluation-plan.json',base))),dataFreezeSha256:digest(await readFile(new URL('data-freeze.json',base))),modelFreezeSha256:predictions.freezeSha256,modelSha256:predictions.modelSha256,predictionsSha256:digest(predictionBytes),reason:supplement.reason,models,comparisons,...(browser?{browser}:{}),notes:['Development-driven additional condition, not part of the original three-condition preregistration.','All original conditions must remain reported.','Same frozen120 cases and exact metric functions; three missing-gold cases remain failures.','Actual browser choices are scored independently; native equality is not assumed.']};
await mkdir(new URL('supplemental/',base),{recursive:true});
await writeFile(new URL(browser?'supplemental/browser-scores.json':'supplemental/scores.json',base),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({models:models.map(m=>({recipe:m.recipe,mode:m.mode,...m.metrics})),comparisons,...(browser?{browser:browser.metrics}:{})},null,2));
