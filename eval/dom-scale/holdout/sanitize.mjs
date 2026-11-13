import {readFile,writeFile} from 'node:fs/promises';
const base=new URL('./',import.meta.url);
for(const file of ['observations.json','auth-observations.json']){
 const raw=await readFile(new URL(file,base),'utf8'),pages=JSON.parse(raw);
 if(file==='observations.json')await writeFile(new URL('../../../.tmp/dom-scale/holdout/public-review-evidence.json',base),raw);
 let redactions=0;
 for(const p of pages){
  const replacements=new Map();
  for(const candidates of Object.values(p.fields))for(const c of candidates){
   if(/의 프로필 이미지$/.test(c.value))replacements.set(c.value,'[public profile image redacted]');
   if(/^https:\/\/thumbnail\.laftel\.net\/profiles\//.test(c.value))replacements.set(c.value,`https://example.invalid/redacted-public-profile/${c.id}`);
   for(const n of c.nodes||[])if(n.alt&&/의 프로필 이미지$/.test(n.alt))replacements.set(n.alt,'[public profile image redacted]');
  }
  function redact(v){
   if(typeof v==='string'){
    for(const[a,b]of replacements)v=v.split(a).join(b);
    if(/^https?:\/\//.test(v))try{const u=new URL(v);for(const k of [...u.searchParams.keys()])if(/serverstate|^state$|token|signature|credential|nonce|session|key-pair-id|^code$|^trackid$|^tctx$/i.test(k))u.searchParams.delete(k);v=u.href;}catch{}
    return v;
   }
   if(Array.isArray(v))return v.map(redact);
   if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,redact(x)]));
   return v;
  }
  const sanitized=redact(p);delete sanitized.observedUi;
  Object.keys(p).forEach(k=>delete p[k]);Object.assign(p,sanitized);
  p.privacy={anonymousBrowser:file==='observations.json',publicProfileRedactions:replacements.size,reviewBodyExcluded:true,candidateIdsAndOrderPreserved:true,trackingQueryRemoved:true};
  redactions+=replacements.size;
 }
 await writeFile(new URL(file,base),JSON.stringify(pages,null,2)+'\n');
 console.log(JSON.stringify({file,pages:pages.length,redactions}));
}
