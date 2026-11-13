// Round 2: designed using development failures only, before fresh validation.
// Existing features and the six round-1 templates remain byte-identical.
import {v2Prompt} from "./templates.mjs";
export const refinedTemplates=["scope-contrast","field-worked"];
const scope="Scope example (fictional): route /search, heading 'Search results for River', cards 'River' and 'Mountain', no observed opened detail panel. For title, artwork AND synopsis the correct choice is none: a result card is not an opened work. A visible opened work dialog may override a background search route. Login or access/security verification text alone is also not work content.";
const examples={
 title:"Compare meaning and scope: [browser title 'Watch Cloud Train - StreamCo'], [visible h1 'Cloud Train'], [episode h2 'Episode 4: Return']. The visible h1 is the clean work name. A heading 'Search' or a result-card name does not name an opened detail. A work-title image's alt is valid if it labels the detail, not an unrelated card.",
 image:"Compare image purpose: a work's large poster/backdrop is artwork; a text-title logo, service icon or repeated small episode card is not. If alt and measured size are unavailable, width x height in an image URL is only a size hint. A larger landscape/portrait work cover can be stronger than repeated card-sized thumbnails. An og:image may supply artwork, but a logo or generic site promotion still fails.",
 description:"Contrast examples: '소년은 잃어버린 가족을 찾아 여행을 떠난다' describes characters/events: a plot. '지금 구독하고 무제한으로 감상하세요' asks for a subscription: marketing. '{줄거리}' is an unfilled placeholder: absent. A plot beside the work's heading can describe the series; a plot beside an episode heading/duration (e.g. '2화', '23분') describes that episode. Prefer the series plot. Story words alone do not make an episode summary the series synopsis.",
};
export function refinedPrompt(row,template,options){
  if(!refinedTemplates.includes(template))throw new Error("Unknown refined template");
  const base=v2Prompt(row,"json-evidence",options);
  const guide=template==="scope-contrast"?scope:`${scope}\nField contrast: ${examples[row.field]}`;
  return base.replace("\nOptions:\n",`\nDecision examples: ${guide}\nApply these generic examples to the observed facts, not to option position. Do not answer with an example's name.\nOptions:\n`);
}
