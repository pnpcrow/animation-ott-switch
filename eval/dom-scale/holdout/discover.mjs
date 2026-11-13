import {chromium} from '@playwright/test';
import {writeFile,mkdir} from 'node:fs/promises';
const urls=[
 ['netflix','https://www.netflix.com/kr/browse/genre/6721'],
 ['apple','https://tv.apple.com/kr/show/모브사이코100/umc.cmc.3fcfxpl733t5fzl2ob612r3on'],
 ['laftel','https://laftel.net/search?keyword=봇치'],
 ['tving','https://www.tving.com/search?keyword=스킵과%20로퍼'],
];
const browser=await chromium.launch({channel:'chromium',headless:true});
const results=[];
try {for(const [provider,url] of urls){
 const page=await browser.newPage({locale:'ko-KR',viewport:{width:1440,height:1000}});
 let error;try{await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});await page.waitForTimeout(2500);}catch(e){error=String(e);}
 const observed=await page.evaluate(()=>({url:location.href,title:document.title,links:[...document.querySelectorAll('a[href]')].map(n=>({text:(n.textContent||n.getAttribute('aria-label')||n.querySelector('img')?.alt||'').replace(/\s+/g,' ').trim().slice(0,120),href:n.href})),buttons:[...document.querySelectorAll('button')].map(n=>({text:n.textContent,aria:n.getAttribute('aria-label')}))}));
 results.push({provider,requested:url,error,...observed});await page.close();
}}
finally{await browser.close();}
await writeFile('.tmp/dom-scale/holdout/discovery.json',JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results.map(x=>({provider:x.provider,url:x.url,title:x.title,links:x.links.filter(l=>/(\/title\/|\/item\/|\/contents\/|\/show\/)/.test(l.href))})),null,2));
