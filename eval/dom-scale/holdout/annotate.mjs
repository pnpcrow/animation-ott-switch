// Independent human decisions recorded from captured DOM and screenshots, before model outputs.
// This file is held blind to training/development until the three model conditions are frozen.
import {readFile,writeFile} from 'node:fs/promises';
const observations=[...JSON.parse(await readFile(new URL('./observations.json',import.meta.url),'utf8')),...JSON.parse(await readFile(new URL('./auth-observations.json',import.meta.url),'utf8'))];
const pages={};
function positive(id,observedKind,title,image,description,accepted={},note=''){
 pages[id]={include:true,observedKind,title,image,description,accepted,note};
}
function negative(id,observedKind,note=''){
 pages[id]={include:true,observedKind,title:'__none__',image:'__none__',description:'__none__',note};
}
function exclude(id,observedKind,reason,duplicateOf=null){pages[id]={include:false,observedKind,reason,duplicateOf};}
for(let n=1;n<=6;n++)positive(`h${String(n).padStart(3,'0')}`,'detail','t2','i1','d2',{image:['i1','i2'],description:['d1','d2']},'Clean series heading; official OG and main hero artwork; head synopsis with trailing watch CTA and plain visible synopsis are equivalent plot evidence.');
negative('h007','login','Search route redirects to login; no work detail open.');
exclude('h008','login','Same login-only state as prior search redirect.','h007');
exclude('h009','detail','Anonymous modal route redirected to the already captured public detail; no actual modal.','h003');
exclude('h010','detail','Anonymous modal route redirected to the already captured public detail; no actual modal.','h004');
exclude('h011','detail','Requested watch route redirected to the already captured public detail; no actual player.','h005');
exclude('h012','detail','Requested watch route redirected to the already captured public detail; no actual player.','h006');
exclude('h013','detail','Trailer action target absent; unchanged public detail.','h001');
exclude('h014','detail','Trailer action target absent; unchanged public detail.','h002');
for(let n=15;n<=21;n++)positive(`h${String(n).padStart(3,'0')}`,'detail','t2','i1','d1',{image:['i1','i2']},'Current series title and plot; desktop and responsive hero artwork valid. Title graphic, WATCHA provider icon, episode cards excluded.');
for(const id of ['h022','h023'])positive(id,'description-modal','t2','i1','d1',{image:['i1','i2']},'Expanded current-work synopsis in a visible dialog over the same detail; not an auth dialog or player.');
negative('h024','search-landing','Direct term route did not populate query; popular-search landing, no current work.');
exclude('h025','search-landing','Same unpopulated popular-search landing as h024.','h024');
exclude('h026','detail','Login click had no visible modal at capture; unchanged detail.','h015');
exclude('h027','auth-loading','Sign-in spinner is a transient state; stable loaded login captured separately in h047.');
for(const id of ['h028','h031','h032','h033','h035','h036'])negative(id,'search','Search results/list alone do not constitute an opened work detail.');
positive('h029','work-modal','t3','i2','d3',{description:['d2','d3']},'Search head retains generic Laftel OG; current native work overlay has clean heading, main video poster and plot. It lacks ARIA dialog semantics.');
positive('h030','work-modal','t3','i1','d2',{description:['d2','d3']},'Direct item URL opens the current work over the home page. Official work OG is valid; home carousel artwork is unrelated.');
positive('h034','detail','t3','i1','d1',{image:['i1','i3','i4']},'Head title includes episode number; clean series heading t3. OG, landscape hero and portrait poster valid; title logo and episode cards excluded.');
positive('h037','work-modal','t3','i2','d2',{},'Search metadata stays generic; current work video poster and series plot belong to the native modal, which lacks ARIA dialog semantics.');
positive('h038','work-modal','t3','i1','d2',{},'Direct item work overlay; current official metadata is valid despite unrelated home carousels and recommendation descriptions.');
negative('h039','login','Age-restricted work modal route redirects to sign-in. No work detail is open.');
negative('h040','login','Direct item age-gate redirects to sign-in but stale work synopsis remains in head; still no work detail.');
positive('h041','detail','t3','i1','d1',{image:['i1','i3','i4']},'Clean series heading and plot; official metadata, landscape hero and portrait poster valid; title-logo image excluded.');
negative('h042','subscription-modal','Blocking subscription offer covers the detail after play access click; no actual full player.');
positive('h043','detail','t3','i1','d1',{},'Official OG artwork is valid. Body landscape/portrait images are generic 19+ blocking placeholders, not representative art; text title-logo also excluded.');
negative('h044','subscription-modal','Blocking subscription offer covers the detail after play access click; no actual full player.');
exclude('h045','search-landing','Entered query visible but popular results remain; no verified query-specific results. Duplicate semantic landing state.','h024');
exclude('h046','search-landing','Entered query visible but popular results remain; no verified query-specific results. Duplicate semantic landing state.','h024');
negative('h047','login-modal','Stable Apple email login dialog blocks underlying detail. Credentials are empty; no actual playback.');
positive('h048','work-modal','t14','__missing_observed_image__','d3',{image:[]},'Authenticated title URL opens a native work modal above the home DOM. Clean title t14 is outside fixed12; actual storyArt was verified independently but is absent from original18 image candidates. Neither case is relabeled none.');
pages.h048.missingObservedFields=['image'];
negative('h049','full-player','Actual play-link navigation; paused=false, currentTime=4.09, readyState=4, video1438x797. Captured immediately then closed.');
negative('h050','search','Authenticated query result page has a matching work link, without opening its detail.');
positive('h051','work-modal','t11','__missing_observed_image__','d1',{image:[]},'Authenticated search result opened a current-work native modal. Current-work storyArt verified independently but original18 image candidates contain preceding result artwork. Preview video in the detail is not a full player.');
pages.h051.missingObservedFields=['image'];
negative('h052','full-player','Actual play-link navigation; paused=false, currentTime=6.596577, readyState=4, video1438x792. Captured immediately then closed.');
const unknown=observations.filter(p=>!pages[p.id]);
if(unknown.length)throw Error('Unannotated captures: '+unknown.map(x=>x.id));
await writeFile(new URL('./annotations.json',import.meta.url),JSON.stringify({
 version:'independent-dom-scale-holdout-v1',annotatedAt:new Date().toISOString(),
 protocol:'Manual DOM/screenshot review by holdout collector before model predictions. All attempts retained; duplicate, no-effect and transient states excluded explicitly. No candidate insertion/reordering based on labels.',
 pages
},null,2)+'\n');
console.log(JSON.stringify({attempts:observations.length,included:Object.values(pages).filter(p=>p.include).length,excluded:Object.values(pages).filter(p=>!p.include).length}));
