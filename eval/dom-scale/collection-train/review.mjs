import {readFile} from 'node:fs/promises';
const pages=JSON.parse(await readFile('eval/dom-scale/collection-train/observations.json','utf8'));
for(const page of pages.filter(p=>process.argv[2].split(',').includes(p.provider)&&(!process.argv[3]||new RegExp(process.argv[3]).test(p.id)))) {
 console.log('\n'+page.id+' '+page.pageUrl);
 console.log('BODY',page.annotationEvidence?.body?.slice(0,500));
 for(const field of ['title','description','image']) {
   const candidates = page.fields[field].slice(0,Number(process.argv[4]||18)).map(c=>[c.id,c.value.slice(0,field==='image'?120:110),c.nodes?.slice(0,1).map(n=>[n.tag,n.attribute,n.alt])]);
   console.log(field,JSON.stringify(candidates));
 }
}
