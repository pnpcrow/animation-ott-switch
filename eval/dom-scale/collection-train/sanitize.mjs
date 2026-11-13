import {readFile,writeFile} from 'node:fs/promises';
const path='eval/dom-scale/collection-train/observations.json';
const raw=await readFile(path,'utf8');
const pages=JSON.parse(raw);
await writeFile('.tmp/dom-scale/train/observations-with-review-evidence.json',raw);
let removedProfileCandidates=0;
for(const p of pages) {
 const replacements=new Map();
 for(const f of Object.values(p.fields))for(const c of f) {
  if(/의 프로필 이미지$/.test(c.value)) replacements.set(c.value,'[public profile image redacted]');
  if(/https:\/\/thumbnail\.laftel\.net\/profiles\//.test(c.value))replacements.set(c.value,`https://example.invalid/redacted-public-profile/${c.id}`);
  for(const n of c.nodes||[])if(n.alt&&/의 프로필 이미지$/.test(n.alt))replacements.set(n.alt,'[public profile image redacted]');
 }
 function redact(v) {
  if(typeof v==='string'){for(const [before,after] of replacements)v=v.split(before).join(after);return v;}
  if(Array.isArray(v))return v.map(redact);
  if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,redact(x)]));
  return v;
 }
 for(const [field,candidates] of Object.entries(p.fields))p.fields[field]=redact(candidates);
 p.pageEvidence=redact(p.pageEvidence);
 removedProfileCandidates+=replacements.size;
 delete p.annotationEvidence;
 p.privacy={anonymousBrowser:true,publicProfileRedactions:replacements.size,rawHtml:'local-temporary-only',reviewBodyExcluded:true,candidateIdsAndOrderPreserved:true};
}
await writeFile(path,JSON.stringify(pages,null,2)+'\n');
console.log(JSON.stringify({pages:pages.length,removedProfileCandidates}));
