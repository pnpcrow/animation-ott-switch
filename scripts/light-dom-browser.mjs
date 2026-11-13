import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, writeFile, mkdir, readdir, stat, rename } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const args=Object.fromEntries(process.argv.slice(2).map(s=>{const i=s.indexOf("=");return[s.slice(2,i),s.slice(i+1)];}));
if(!args.jobs||!args.model||!args.output||!["wasm","webgpu"].includes(args.provider))throw new Error("--jobs=path --model=path --provider=wasm|webgpu --output=path required");
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const jobBytes=await readFile(args.jobs),jobs=JSON.parse(jobBytes),modelPath=resolve(args.model),modelBytes=await readFile(modelPath),modelSha256=sha(modelBytes);
if(jobs.model.sha256&&jobs.model.sha256!==modelSha256)throw new Error("Pinned ONNX hash mismatch");
if(!Array.isArray(jobs.batches)||!jobs.batches.length||new Set(jobs.batches.map(b=>b.id)).size!==jobs.batches.length)throw new Error("Unique nonempty batches required");
const ortDir=resolve(args["ort-dir"]||"eval/tiny-decision/slayer/node_modules/onnxruntime-web/dist");
const routes={"/model.onnx":modelPath,"/browser.mjs":resolve("eval/light-dom/runtime/browser.mjs"),"/readout.mjs":resolve("eval/light-dom/runtime/readout.mjs")};
for(const name of await readdir(ortDir))if(/\.(wasm|mjs)$/.test(name))routes["/ort/"+name]=resolve(ortDir,name);
const served={};
const headers={"Cross-Origin-Opener-Policy":"same-origin","Cross-Origin-Embedder-Policy":"require-corp","Cache-Control":"no-store"};
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,"http://localhost").pathname;
  if(path==="/"){res.writeHead(200,{...headers,"Content-Type":"text/html"});res.end('<!doctype html><title>Light DOM model evaluation</title><script type="module" src="/browser.mjs"></script>');return;}
  if(!routes[path]){res.writeHead(404,headers).end();return;}
  try{const bytes=(await stat(routes[path])).size;res.writeHead(200,{...headers,"Content-Type":path.endsWith(".mjs")?"text/javascript":path.endsWith(".wasm")?"application/wasm":"application/octet-stream","Content-Length":bytes});const stream=createReadStream(routes[path]);stream.on("data",chunk=>{served[path]=(served[path]||0)+chunk.length;});stream.pipe(res);}catch{res.writeHead(500,headers).end();}
});
await new Promise(done=>server.listen(0,"127.0.0.1",done));
const origin=`http://127.0.0.1:${server.address().port}`;
const implementationSha256=Object.fromEntries(await Promise.all(["scripts/light-dom-browser.mjs","eval/light-dom/runtime/browser.mjs","eval/light-dom/runtime/readout.mjs"].map(async path=>[path,sha(await readFile(path))])));
const base={schemaVersion:1,model:jobs.model,modelFileBytes:modelBytes.length,modelSha256,jobsSha256:sha(jobBytes),sourceJobsSha256:jobs.nativeJobsSha256||jobs.jobsSha256||null,implementationSha256,startedAt:new Date().toISOString(),runtime:"ONNX Runtime Web 1.31.1",network:{externalRequests:[]},processMemory:[],batchPlan:jobs.batches.map(batch=>({id:batch.id,pairIds:batch.pairIds||null,repeats:batch.repeats??3}))};
let browser,current={};
await mkdir(dirname(resolve(args.output)),{recursive:true});
const save=async patch=>{
  current={...current,...patch};const temporary=args.output+".writing";
  await writeFile(temporary,JSON.stringify({...base,...current,servedBytes:served},null,2)+"\n");
  for(let retry=0;retry<20;retry++)try{await rename(temporary,args.output);return;}catch(error){if(retry===19)throw error;await new Promise(resolve=>setTimeout(resolve,50*(retry+1)));}
};
try{
  browser=await chromium.launch({channel:"chromium",headless:true,args:["--enable-precise-memory-info"]});
  const session=await browser.newBrowserCDPSession();
  const memory=async stage=>{
    if(process.platform!=="win32")return;
    try{
      const info=await session.send("SystemInfo.getProcessInfo");
      const ids=info.processInfo.map(p=>p.id).filter(id=>Number.isSafeInteger(id)&&id>0);
      if(!ids.length)return;
      const command=`Get-Process -Id ${ids.join(",")} -ErrorAction SilentlyContinue | Select-Object Id,WorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress`;
      const processes=JSON.parse(execFileSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",command],{encoding:"utf8",windowsHide:true,timeout:10000}));
      const rows=Array.isArray(processes)?processes:[processes];
      base.processMemory.push({stage,workingSetBytes:rows.reduce((n,p)=>n+p.WorkingSet64,0),privateBytes:rows.reduce((n,p)=>n+p.PrivateMemorySize64,0),processes:rows,note:"Entire isolated browser process set, including Chromium overhead; not per-model memory or physical GPU VRAM."});
    }catch(error){base.processMemory.push({stage,error:String(error)});}
  };
  const page=await browser.newPage();await memory("before-page");
  await page.route("**/*",route=>{const url=route.request().url();if(url.startsWith(origin+"/"))return route.continue();base.network.externalRequests.push(url);return route.abort();});
  page.on("console",m=>{if(m.type()==="warning"||m.type()==="error")console.log(m.type(),m.text().slice(0,350));});
  await page.exposeFunction("reportLightDomProgress",async report=>{if(report.stage==="loaded"||report.rows.length===1||report.rows.length===jobs.batches.length)await memory(report.stage+"-"+report.rows.length);await save(report);console.log(JSON.stringify({stage:report.stage,batches:report.rows.length,total:jobs.batches.length,last:report.rows.at(-1)?.id,error:report.rows.at(-1)?.error}));});
  await page.goto(origin);await page.waitForFunction(()=>typeof globalThis.runLightDom==="function");
  const report=await page.evaluate(data=>globalThis.runLightDom(data),{jobs,provider:args.provider});
  await memory("after-release");
  if(jobs.reference)report.referenceComparison=report.rows.map(row=>{
    const reference=jobs.reference[row.id];
    if(!reference||!row.output)return{id:row.id,error:row.error||"Missing reference"};
    if(reference.length!==row.output.data.length)throw new Error("Reference output length mismatch");
    return{id:row.id,maxAbsError:Math.max(...reference.map((v,i)=>Math.abs(v-row.output.data[i])))};
  });
  await save({...report,finishedAt:new Date().toISOString()});
  if(report.error)process.exitCode=1;
}catch(error){await save({error:String(error),finishedAt:new Date().toISOString()});process.exitCode=1;}finally{await browser?.close();await new Promise(done=>server.close(done));}
