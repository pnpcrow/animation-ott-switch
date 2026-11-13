import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const dir='eval/dom-scale/collection-train/';
const hash=x=>createHash('sha256').update(x).digest('hex');
const first=JSON.parse(await readFile(dir+'frozen-manifest.json','utf8'));
const extra=JSON.parse(await readFile(dir+'additional-manifest.json','utf8'));
const hashChecks=[];
for(const manifest of [first,extra])for(const [file,expected]of Object.entries(manifest.sourceHashes)){const actual=hash(await readFile(dir+file));hashChecks.push({file,expected,actual,match:expected===actual});}
// Preserve the older collector by recovering the one subsequent privacy-only edit.
// A byte-for-byte SHA match with the preexisting frozen manifest is mandatory.
const current=await readFile('eval/dom-scale/auth-training/collector.mjs','utf8');
const old=current.replace(',[data-uia*="profile" i]','');
if(hash(old)!==first.authSourceHashes['collector.mjs'])throw new Error('Cannot recover exact frozen auth v1 source');
await writeFile(dir+'auth-collector-v1.mjs',old);
for(const [file,expected]of Object.entries(first.authSourceHashes)){
 const path=file==='collector.mjs'?dir+'auth-collector-v1.mjs':'eval/dom-scale/auth-training/'+file;
 const actual=hash(await readFile(path));hashChecks.push({file:path,expected,actual,match:expected===actual});
}
const cohorts=[];
for(const prefix of ['', 'additional-'])cohorts.push({inputs:JSON.parse(await readFile(dir+prefix+'inputs.json','utf8')),labels:JSON.parse(await readFile(dir+prefix+'labels.json','utf8')),annotations:JSON.parse(await readFile(dir+prefix+'annotations.json','utf8'))});
const inputs=cohorts.flatMap(x=>x.inputs),labels=cohorts.flatMap(x=>x.labels),annotations=cohorts.flatMap(x=>x.annotations);
const inputIds=new Set(inputs.map(i=>i.id));
const targetDomains=new Set(['laftel.net','www.aniplustv.com','www.crunchyroll.com','www.primevideo.com','www.wavve.com','www.tving.com','www.coupangplay.com','watcha.com']);
const privacy=[];
for(const name of ['observations.json','inputs.json','additional-observations.json','additional-inputs.json',...Object.keys(extra.sourceHashes).filter(x=>x.startsWith('auth-captures/'))]){
 const raw=await readFile(dir+name,'utf8');
 privacy.push({file:name,personalEmailPattern:/[a-z0-9._%+-]+@(hotmail|gmail|outlook|naver)\./i.test(raw),sensitiveQueryPattern:/[?&](?:access_token|refresh_token|authToken|sessionId|credential|signature)=/i.test(raw),cookieStorageKeys:/"(?:cookie|cookies|localStorage|sessionStorage|authorization|password)"\s*:/i.test(raw),authBodyPrefix:name.startsWith('auth-captures/')&&/"bodyPrefix"\s*:/.test(raw)});
}
const coverage={pages:annotations.length,cases:inputs.length,answerablePositiveDecisions:labels.filter(l=>l.expectedId!=='__none__'&&l.expectedId!=='__missing__').length,noneDecisions:labels.filter(l=>l.expectedId==='__none__').length,collectorMissDecisions:labels.filter(l=>l.quality.collectorMiss).length,duplicateDecisions:labels.filter(l=>l.provenance.duplicateOf).length,distinctTargetWorks:[...new Set(annotations.map(a=>a.work))],providers:Object.fromEntries([...new Set(annotations.map(a=>a.provider))].map(p=>[p,annotations.filter(a=>a.provider===p).length])),pageKinds:Object.fromEntries([...new Set(annotations.map(a=>a.pageKind))].map(k=>[k,annotations.filter(a=>a.pageKind===k).length])),actualPlayingEpisodePages:annotations.filter(a=>a.pageKind==='full-player').map(a=>a.pageId),limitations:['Coupang detail title/description definitely present outside candidate collection; exact omitted artwork URL not retained. Three missing-gold decisions preserved, never labeled none.','Watcha login link remained visible; Prime required subscription. These existing-profile states do not establish authenticated/full-player access.','Initial repeated anonymous challenge/search/login shells remain raw attempts; downstream training dedup/split policy must avoid duplicated negatives crossing folds.','Initial exploratory navigation selector failures and one corrected mistyped URL were not retained as canonical captures; disclosed in README.']};
await writeFile(dir+'final-coverage.json',JSON.stringify(coverage,null,2)+'\n');
const audit={auditedAt:new Date().toISOString(),hashChecks,privacy,schema:{uniqueCaseIds:inputIds.size===inputs.length,labelCountMatches:labels.length===inputs.length,allSourceProvidersAllowed:labels.every(l=>targetDomains.has(new URL(l.provenance.sourceUrl||l.provenance.url).hostname)),reservedWorkTargetsExcluded:annotations.every(a=>!first.reservedWorkHoldout.includes(a.work)),reservedServicesExcluded:annotations.every(a=>!first.reservedServiceHoldout.includes(a.provider)),noAnnotationMetadataInInputs:inputs.every(i=>!('pageKind'in i)&&!('provider'in i)&&!('work'in i)),max13Options:inputs.every(i=>i.options.length<=13),noneExactlyOnce:inputs.every(i=>i.options.filter(o=>o.id==='__none__').length===1),allLabelReferencesValidOrRecordedMiss:labels.every(l=>l.quality.allAcceptedOutsidePool||inputs.find(i=>i.id===l.id).options.some(o=>l.acceptedIds.includes(o.id)))},sourceHistory:'Frozen first-cohort collector source recovered from current source by removing only subsequent data-uia profile filter; recovered bytes exactly match original frozen SHA256. Candidate/gold/input files unchanged during audit.'};
await writeFile(dir+'audit.json',JSON.stringify(audit,null,2)+'\n');
await writeFile(dir+'collection-manifest.json',JSON.stringify({frozenAt:new Date().toISOString(),cohortCount:2,pages:coverage.pages,cases:coverage.cases,mergeRule:'Concatenate initial inputs/labels with additional inputs/labels by unique id; no candidate or gold modifications. Training split/dedup documented separately by training pipeline.',cohorts:[{manifest:'frozen-manifest.json',sha256:hash(await readFile(dir+'frozen-manifest.json')),input:'inputs.json',labels:'labels.json',pages:60,cases:180,authCollectorSource:'auth-collector-v1.mjs'},{manifest:'additional-manifest.json',sha256:hash(await readFile(dir+'additional-manifest.json')),input:'additional-inputs.json',labels:'additional-labels.json',pages:20,cases:60,authCollectorSource:'auth-collector-v3.mjs'}],coverage:'final-coverage.json',audit:'audit.json'},null,2)+'\n');
console.log(JSON.stringify({pages:coverage.pages,cases:coverage.cases,sourceHashChecks:hashChecks.length,allHashesMatch:hashChecks.every(x=>x.match),schema:audit.schema,privacyFlags:privacy.filter(x=>x.personalEmailPattern||x.sensitiveQueryPattern||x.cookieStorageKeys||x.authBodyPrefix).map(x=>x.file)}));
