import fs from 'node:fs';
import crypto from 'node:crypto';
import { chooseCompactHeuristic } from '../eval/tiny-decision/baseline.mjs';
import { predict } from '../eval/light-dom/structural.mjs';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const read = path => JSON.parse(fs.readFileSync(path));
const root='eval/light-dom/';
const freeze=read(root+'freeze.json'), inputs=read(root+'data/holdout-inputs.json'), labels=read(root+'data/holdout-labels.json');
const gold=new Map(labels.map(x=>[x.id,x]));
const sourceDigests={};
function source(path) { const b=fs.readFileSync(path);sourceDigests[path]=sha(b);return JSON.parse(b); }
for(const [path,digest] of Object.entries(freeze.sources)) if(sha(fs.readFileSync(path))!==digest) throw Error('Frozen source mismatch '+path);
function decision(scores,threshold) {
  if (!scores.length) return '__none__';
  if(scores.some(x=>!Number.isFinite(x.score))) throw Error('Non-finite score');
  const sorted=scores.slice().sort((a,b)=>b.score-a.score);
  if(sorted[0].score<threshold || (sorted[1]&&Math.abs(sorted[0].score-sorted[1].score)<1e-9)) return '__none__';
  return sorted[0].candidateId;
}
function evaluate(choices) {
 const rows=inputs.map(input=>{
   const chosenId=choices.get(input.id), label=gold.get(input.id);
   if(!chosenId || !input.options.some(x=>x.id===chosenId)) throw Error('Unknown choice '+input.id);
   return {id:input.id,field:input.field,chosenId,expectedId:label.expectedId,acceptedIds:label.acceptedIds,positive:label.expectedId!=='__none__',trivial:input.options.length===1,correct:label.acceptedIds.includes(chosenId)};
 });
 const count=rs=>({correct:rs.filter(x=>x.correct).length,total:rs.length});
 return {all:count(rows),nontrivial:count(rows.filter(x=>!x.trivial)),positive:count(rows.filter(x=>x.positive)),none:count(rows.filter(x=>!x.positive)),falseSelections:rows.filter(x=>!x.correct&&x.chosenId!=='__none__').length,falseAbstentions:rows.filter(x=>!x.correct&&x.chosenId==='__none__').length,errors:rows.filter(x=>!x.correct),rows};
}
function scorePredictions(name,preds) {
 const selected=freeze.selections[name];
 if(preds.length!==128 || new Set(preds.map(x=>x.id)).size!==128) throw Error('Pair coverage');
 const choices=new Map(inputs.map(input=>{
   const p=preds.filter(x=>x.caseId===input.id);
   const concrete=input.options.filter(x=>x.id!=='__none__');
   if(p.length!==concrete.length || concrete.some(x=>!p.some(y=>y.candidateId===x.id))) throw Error('Per-case coverage '+input.id);
   if(p.some(x=>x.template!==selected.template||x.error)) throw Error('Wrong template/inference failure');
   return [input.id,decision(p,selected.threshold)];
 }));
 return evaluate(choices);
}
const groups={};
for(const [name,path] of Object.entries({nli:'nli/holdout.json',jina:'jina/holdout.json',kure:'reports/kure-holdout.json'})) {
 const report=source(root+path);
 if(!report.finishedAt||report.modelSha256!==freeze.selections[name].modelSha256)throw Error('Native artifact not frozen/completed');
 const preds=report.predictions.map(x=>({...x,score:name==='nli'?x.logits[0]-x.logits[2]:x.logits[0]}));
 const maxStoredScoreError=Math.max(...preds.map((x,i)=>Math.abs(x.score-report.predictions[i].score)));
 groups[name+'Native']={...scorePredictions(name,preds),maxStoredScoreError};
}
for(const [key,name,path] of [
 ['nliWebGPU','nli','nli/browser-webgpu-holdout.json'],
 ['jinaWebGPU','jina','jina/browser-webgpu-holdout.json'],
 ['jinaWASM','jina','jina/browser-wasm-holdout.json'],
 ['kureWebGPU','kure','reports/kure-browser-webgpu-holdout.json']]) {
 const report=source(root+path);
 if(!report.finishedAt || report.rows.length!==17 || report.modelSha256!==freeze.selections[name].modelSha256) throw Error('Browser artifact not completed/frozen');
 const preds=report.rows.flatMap(row=>{
  if(row.error)throw Error('Browser error');
  const width=name==='nli'?3:1;
  if(row.output.dims[0]!==row.pairIds.length || row.output.data.length!==row.pairIds.length*width)throw Error('Output shape');
  return row.pairIds.map((id,index)=>{
   const [caseId,template,candidateId]=id.split('::');
   return {id,caseId,template,candidateId,score:name==='nli'?row.output.data[index*3]-row.output.data[index*3+2]:row.output.data[index]};
  });
 });
 groups[key]=scorePredictions(name,preds);
}
const structural=source(root+'reports/structural-browser.json');
groups.structuralBrowser=evaluate(new Map(structural.rows.map(x=>[x.id,x.chosenId])));
const model=source(root+'structural-model.json');
groups.structuralNative=evaluate(new Map(inputs.map(input=>[input.id,predict(model,input).chosenId])));
groups.baseline=evaluate(new Map(inputs.map(input=>[input.id,chooseCompactHeuristic(input)])));
const result={finishedAt:new Date().toISOString(),method:'Independent raw-logit rescoring without importing selection.mjs, metrics.mjs, report.mjs or root report output. Frozen thresholds and candidate IDs, tie-to-none at 1e-9, explicit 128-pair coverage; accepted-ID labels.',sourceDigests,groups};
fs.writeFileSync(root+'reports/independent-audit.json',JSON.stringify(result,null,2)+'\n');
for(const [name,g] of Object.entries(groups))console.log(JSON.stringify({name,...Object.fromEntries(Object.entries(g).filter(([k])=>k!=='rows'&&k!=='errors')),errors:g.errors.map(x=>`${x.id}:${x.chosenId}->${x.expectedId}`)}));
