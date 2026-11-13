import {readFile,writeFile,mkdir} from "node:fs/promises";import {dirname} from "node:path";
import {decisionPrompt} from "../eval/tiny-decision/templates.mjs";import {hash} from "../eval/tiny-decision/metrics.mjs";
const args=Object.fromEntries(process.argv.slice(2).map(s=>{const i=s.indexOf("=");return[s.slice(2,i),s.slice(i+1)];}));
if(!["jev","slayer"].includes(args.model)||!args.output)throw new Error("--model=jev|slayer --output=path required");
const freeze=JSON.parse(await readFile("eval/tiny-decision/v2/global-freeze.json","utf8"));
if(!freeze.lockedAt)throw new Error("All development decisions must be frozen first");
const inputs=JSON.parse(await readFile("eval/tiny-decision/v2/data/holdout-inputs.json","utf8")),labels=JSON.parse(await readFile("eval/tiny-decision/v2/data/holdout-labels.json","utf8"));
const byId=new Map(labels.map(r=>[r.id,r]));const template=args.model==="jev"?"dom-hierarchy":"korean-structure";
if(byId.size!==labels.length||new Set(inputs.map(r=>r.id)).size!==inputs.length)throw new Error("Duplicate case ID");
for(const row of inputs){const label=byId.get(row.id);if(!label||![label.expectedId,...label.acceptedIds||[]].every(id=>row.options.some(o=>o.id===id)))throw new Error("Missing or invalid scoring label");}
const cases=inputs.map(row=>({id:row.id,split:"holdout",field:row.field,template,indexBase:1,document:row.document,question:row.question,options:row.options.map(o=>({id:o.id,text:o.text})),prompt:decisionPrompt(row,template),expectedId:byId.get(row.id).expectedId,acceptedIds:byId.get(row.id).acceptedIds||[byId.get(row.id).expectedId]}));
await mkdir(dirname(args.output),{recursive:true});await writeFile(args.output,JSON.stringify({schemaVersion:1,cohort:"unchanged-v1-on-fresh-v2-holdout",inputsSha256:hash(inputs),labelsSha256:hash(labels),freeze,cases},null,2)+"\n");console.log(JSON.stringify({output:args.output,cases:cases.length,template}));
