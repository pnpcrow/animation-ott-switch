// Model-visible facts only. No gold, provenance, CSS classes, case ID or scoring flags.
const clip=(value,n)=>[...String(value??"").replace(/\s+/g," ").trim()].slice(0,n).join("");
const tag=n=>n?.tag+(n?.role?`[${n.role}]`:"");
function asset(value){
  try {const u=new URL(value);const path=decodeURIComponent(u.pathname).split("/").filter(Boolean).slice(-2).join("/");return path.length>64?path.slice(0,36)+"…"+path.slice(-24):path;}catch{return value;}
}
function route(value){try{const u=new URL(value);return decodeURI(u.pathname)+(u.search?"?"+[...u.searchParams.keys()].join("&"):"");}catch{return "unknown";}}
export function featurePack(row,{textLimit=96}={}){
  if(!["title","image","description"].includes(row.field))throw new Error("Unsupported field");
  const p=row.pageEvidence||{};
  return {
    field:row.field,
    page:{title:clip(p.documentTitle,120),url:route(p.url),headings:(p.headings||[]).filter(h=>!h.hidden).slice(0,2).map(h=>clip(h.text,64)),dialogs:p.visibleDialogCount??null},
    candidates:row.options.map(option=>{
      if(option.id==="__none__")return {id:option.id,none:true,value:"No current-work field is present among the observed candidates."};
      const e=option.evidence;
      if(!e?.nodes?.length)throw new Error(`Missing observed evidence for ${option.id}`);
      const n=e.nodes.find(n=>!n.hidden&&!n.navigation)||e.nodes[0];
      const near=(n.nearbyHeadings||[]).map(h=>typeof h==="string"?h:h.text).filter(Boolean);
      const width=n.naturalWidth||n.width||n.renderedWidth||null;
      const height=n.naturalHeight||n.height||n.renderedHeight||null;
      return {
        id:option.id,value:clip(row.field==="image"?asset(e.value):e.value,textLimit),tag:n.tag,source:n.attribute,
        hidden:!!n.hidden,navigation:!!n.navigation,
        parents:(n.parentRoles||n.parents||[]).slice(0,3).map(tag),role:n.role||null,
        alt:clip(n.alt,Math.min(textLimit,64)),width,height,
        nearHeading:clip(near[0],Math.min(textLimit,48)),
        dialog:n.inDialog?`dialog ${n.dialogIndex??"?"}${n.inLastVisibleDialogInDom?" last-visible-in-DOM":""}`:null,
        inert:n.inert??null,previous:clip(n.previous,24),next:clip(n.next,24),
      };
    }),
  };
}
export function factLine(c){
  if(c.none)return c.value;
  const facts=[`${c.tag}/${c.source}`,c.tag==="meta"||c.tag==="title"?"head metadata":c.hidden?"hidden":"visible",`value=${JSON.stringify(c.value)}`];
  if(c.parents.length)facts.push(`parents=${c.parents.join("<")}`);
  if(c.navigation)facts.push("navigation");if(c.inert)facts.push("inert");if(c.dialog)facts.push(c.dialog);
  if(c.alt&&c.alt!==c.value)facts.push(`alt=${JSON.stringify(c.alt)}`);
  if(c.width||c.height)facts.push(`size=${c.width??"?"}x${c.height??"?"}`);
  if(c.nearHeading)facts.push(`near=${JSON.stringify(c.nearHeading)}`);
  if(c.previous)facts.push(`before=${JSON.stringify(c.previous)}`);if(c.next)facts.push(`after=${JSON.stringify(c.next)}`);
  return facts.join("; ");
}
export function compactCandidate(c){
  if(c.none)return {none:true};
  return Object.fromEntries(Object.entries(c).filter(([k,v])=>k!=="id"&&v!==null&&v!==""&&(!Array.isArray(v)||v.length)));
}
