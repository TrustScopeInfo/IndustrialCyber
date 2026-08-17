const nodes = {mimic:[], cipmimic:[]};
function mk(tag){return {tag, attrs:{}, children:[], _text:null,
  setAttribute(k,v){this.attrs[k]=v}, appendChild(c){this.children.push(c);return c},
  addEventListener(){}, querySelectorAll(){return []},
  set textContent(v){this._text=v}, get textContent(){return this._text}}}
global.document={createElementNS:(n,t)=>mk(t),
  getElementById:(id)=>{ if(nodes[id]) {const b=nodes[id]; return {appendChild(c){b.push(c);return c},setAttribute(){},querySelectorAll(){return[]}}}
    return {appendChild(){},setAttribute(){},querySelectorAll(){return[]},textContent:'',classList:{toggle(){}}}}};
const NS='x';
const E=(t,a={},x)=>{const n=document.createElementNS(NS,t);for(const k in a)n.setAttribute(k,a[k]);if(x!=null)n.textContent=x;return n};
const $=i=>document.getElementById(i);
const S={ph:'IDLE',el:0,tgt:1}; const set=()=>{},pipe=()=>{},vlv=()=>{},pmp=()=>{};
eval(require('fs').readFileSync('/home/claude/v5/builders.js','utf8'));

const NARROW="iIljtfr.,:;'|! ", WIDE='MWmw@%';
const tw=(t,s)=>{let u=0;for(const c of String(t)){
  u += NARROW.includes(c)?0.32 : WIDE.includes(c)?0.88 : (c>='A'&&c<='Z')?0.68 : (c>='0'&&c<='9')?0.56 : 0.55} return u*s};

function collect(list){
  const T=[],R=[],P=[];
  const walk=n=>{
    if(n.tag==='text'){
      const s=parseFloat(n.attrs['font-size']||15), t=n.textContent||'';
      const w=tw(t,s), a=n.attrs['text-anchor']||'start', x=+n.attrs.x, y=+n.attrs.y;
      const x1=a==='middle'?x-w/2:a==='end'?x-w:x;
      T.push({t,x1,x2:x1+w,y1:y-s*0.78,y2:y+s*0.22});
    } else if(n.tag==='rect'){
      const w=+n.attrs.width,h=+n.attrs.height,f=n.attrs.fill||'';
      if(f!=='none'&&w<1400&&h<600) R.push({f,x1:+n.attrs.x,x2:+n.attrs.x+w,y1:+n.attrs.y,y2:+n.attrs.y+h});
    } else if(n.tag==='path'&&n.attrs.d&&(n.attrs['stroke-width']||0)>=5&&n.attrs.fill==='none'){
      // axis aligned segments from the M/H/V pipe grammar
      const d=n.attrs.d, sw=+n.attrs['stroke-width'];
      let cx=0,cy=0; const toks=d.match(/[MHV]\s*-?[\d.]+(\s+-?[\d.]+)?/g)||[];
      toks.forEach(tk=>{
        const c=tk[0], nums=tk.slice(1).trim().split(/\s+/).map(Number);
        if(c==='M'){cx=nums[0];cy=nums[1]}
        else if(c==='H'){P.push({x1:Math.min(cx,nums[0]),x2:Math.max(cx,nums[0]),y1:cy-sw/2,y2:cy+sw/2});cx=nums[0]}
        else if(c==='V'){P.push({x1:cx-sw/2,x2:cx+sw/2,y1:Math.min(cy,nums[0]),y2:Math.max(cy,nums[0])});cy=nums[0]}});
    }
    (n.children||[]).forEach(walk)};
  list.forEach(walk); return {T,R,P};
}
const ov=(a,b)=>a.x1<b.x2&&b.x1<a.x2&&a.y1<b.y2&&b.y1<a.y2;
const inside=(a,b)=>a.x1>=b.x1-2&&a.x2<=b.x2+2&&a.y1>=b.y1-3&&a.y2<=b.y2+3;

function report(name,list){
  const {T,R,P}=collect(list); const hits=new Set();
  for(let i=0;i<T.length;i++){
    for(let j=i+1;j<T.length;j++) if(ov(T[i],T[j])) hits.add(`TEXT/TEXT  "${T[i].t}"  x  "${T[j].t}"`);
    for(const r of R) if(ov(T[i],r)&&!inside(T[i],r)) hits.add(`TEXT/BOX   "${T[i].t}" clipped by box ${r.f} @${Math.round(r.x1)},${Math.round(r.y1)}`);
    for(const p of P) if(ov(T[i],p)) hits.add(`TEXT/PIPE  "${T[i].t}" sits on a pipe @${Math.round(p.x1)},${Math.round(p.y1)}`);
  }
  console.log('\n=== '+name+' ==='); console.log(hits.size?[...hits].join('\n'):'clean');
}
buildMimic(); report('BLEND',nodes.mimic);
buildCIP();   report('CIP',nodes.cipmimic);
