import {readFile,writeFile} from 'node:fs/promises';
const discovery=JSON.parse(await readFile('.tmp/dom-scale/holdout/discovery.json'));
const n=discovery.find(x=>x.provider==='netflix').links;
const a=discovery.find(x=>x.provider==='apple').links;
const plan=[];
const add=(provider,cohort,work,kind,url,action)=>plan.push({id:`h${String(plan.length+1).padStart(3,'0')}`,provider,cohort,work,requestedKind:kind,url,...(action?{action}:{})});
const netflix=[['skip-and-loafer','스킵과 로퍼'],['cyberpunk-edgerunners','사이버펑크: 엣지러너'],['saiki-k','사이키 쿠스오의 재난'],['komi-cant-communicate','코미 양은 커뮤증입니다'],['blue-period','블루 피리어드'],['mob-psycho-100','모브 사이코 100']];
for(const [work,title] of netflix){const link=n.find(x=>x.text===title);if(!link)throw new Error(title);add('netflix','unseen-service',work,'detail',link.href);}
for(const [work,title] of netflix.slice(0,2))add('netflix','unseen-service',work,'search',`https://www.netflix.com/search?q=${encodeURIComponent(title)}`);
for(const [work,title] of netflix.slice(2,4)){const id=n.find(x=>x.text===title).href.split('/').at(-1);add('netflix','unseen-service',work,'modal',`https://www.netflix.com/browse?jbv=${id}`);}
for(const [work,title] of netflix.slice(4)){const id=n.find(x=>x.text===title).href.split('/').at(-1);add('netflix','unseen-service',work,'playback',`https://www.netflix.com/watch/${id}`);}
for(const [work,title] of netflix.slice(0,2)){const link=n.find(x=>x.text===title);add('netflix','unseen-service',work,'trailer-modal',link.href,{name:'예고편'});}
const apples=[['mob-psycho-100','https://tv.apple.com/kr/show/모브사이코100/umc.cmc.3fcfxpl733t5fzl2ob612r3on'],['skip-and-loafer','https://tv.apple.com/kr/show/스킵과-로퍼/umc.cmc.39pmvds25qdwutg5xtprs73hc'],['odd-taxi','https://tv.apple.com/kr/show/오드-택시/umc.cmc.5gv0dudnaj025ewqa9hlydobc']];
for(const [work,title] of [['bleach','블리치'],['hunter-x-hunter','헌터X헌터'],['blue-exorcist','청의 엑소시스트'],['mononogatari','모노노가타리']]){const link=a.find(x=>x.text===title);if(!link)throw new Error(title);apples.push([work,link.href]);}
for(const [work,url] of apples)add('apple','unseen-service',work,'detail',url);
for(const [work,url] of apples.slice(0,2))add('apple','unseen-service',work,'description-modal',url,{name:'더 보기',exact:true,index:0});
for(const [work,title] of [['mob-psycho-100','모브사이코100'],['odd-taxi','오드 택시']])add('apple','unseen-service',work,'search',`https://tv.apple.com/kr/search?term=${encodeURIComponent(title)}`);
for(const [work,url] of apples.slice(0,2))add('apple','unseen-service',work,'playback-access',url,{name:'로그인',exact:false,index:0});
// These routes are observed official links; actions/redirects are verified in the captures.
const laftel=discovery.find(x=>x.provider==='laftel').links;
const bocchi=laftel.find(x=>x.text==='외톨이 THE ROCK!');
add('laftel','unseen-work','bocchi-the-rock','search','https://laftel.net/search?keyword=봇치');
add('laftel','unseen-work','bocchi-the-rock','modal',bocchi.href);
add('laftel','unseen-work','bocchi-the-rock','detail','https://laftel.net/item/'+new URL(bocchi.href).searchParams.get('modal'));
add('laftel','unseen-work','skip-and-loafer','search','https://laftel.net/search?keyword=스킵과%20로퍼');
add('laftel','unseen-work','odd-taxi','search','https://laftel.net/search?keyword=오드%20택시');
add('tving','unseen-work','skip-and-loafer','search','https://www.tving.com/search?keyword=스킵과%20로퍼');
add('tving','unseen-work','skip-and-loafer','detail','https://www.tving.com/contents/P001707310');
add('tving','unseen-work','bocchi-the-rock','search','https://www.tving.com/search?keyword=봇치');
add('tving','unseen-work','odd-taxi','search','https://www.tving.com/search?keyword=오드%20택시');
await writeFile(new URL('./plan.json',import.meta.url),JSON.stringify(plan,null,2)+'\n');
console.log(JSON.stringify({attempts:plan.length,providers:Object.fromEntries([...new Set(plan.map(x=>x.provider))].map(p=>[p,plan.filter(x=>x.provider===p).length]))}));
