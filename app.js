(function(){
const ICONS={
 Filters:'<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><ellipse cx="32" cy="14" rx="18" ry="6"/><path d="M14 14v36c0 3.3 8 6 18 6s18-2.7 18-6V14"/><path d="M20 22v28M26 23v29M32 23v29M38 23v29M44 22v28"/></svg>',
 Cooling:'<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="32" cy="32" r="5"/><path d="M32 27c-2-10 2-18 10-18-1 8-4 14-10 18zM37 32c10-2 18 2 18 10-8-1-14-4-18-10zM32 37c2 10-2 18-10 18 1-8 4-14 10-18zM27 32c-10 2-18-2-18-10 8 1 14 4 18 10z"/></svg>',
 Clutch:'<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="32" cy="32" r="24"/><circle cx="32" cy="32" r="14"/><circle cx="32" cy="32" r="4"/><path d="M32 8v10M32 46v10M8 32h10M46 32h10"/></svg>',
 Engine:'<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M12 24h8l4-6h14l4 6h8v24H12z"/><path d="M4 30v12h8M60 30v12h-8M26 18v-6h12v6"/></svg>',
 Brakes:'<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="32" cy="32" r="24"/><circle cx="32" cy="32" r="8"/><path d="M14 18a24 24 0 0 1 14-10l3 10a14 14 0 0 0-8 6z"/></svg>',
 Cab:'<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M10 50V18c0-3 2-6 6-6h22l14 16v22z"/><path d="M16 18h20v12H16z"/><circle cx="20" cy="52" r="5"/><circle cx="44" cy="52" r="5"/></svg>',
 Tools:'<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M40 8a12 12 0 0 0-11 16L8 45l11 11 21-21a12 12 0 0 0 16-11l-7 4-8-4-1-9z"/></svg>',
 Workshop:'<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M40 8a12 12 0 0 0-11 16L8 45l11 11 21-21a12 12 0 0 0 16-11l-7 4-8-4-1-9z"/></svg>'
};
const $=id=>document.getElementById(id);
const money=n=>"$"+n.toFixed(2);
let DATA=null, P=[], st={cat:null,q:"",eng:""}, cart={}, current=null;

function load(){try{cart=JSON.parse(localStorage.getItem("vms-cart")||"{}")}catch(e){cart={}}}
function save(){try{localStorage.setItem("vms-cart",JSON.stringify(cart))}catch(e){}}
const key=(id,opt)=>opt?id+"|"+opt:id;
const parse=k=>{const [id,opt]=k.split("|");return {p:P.find(x=>x.id===id),opt}};
function pic(p,big){if(!p.image)return window.__ic[p.cat]||"";return `<img src="${big?p.image:(p.thumb||p.image)}" alt="${p.name}" width="${big?1000:400}" height="${big?1000:400}" loading="lazy" onerror="this.replaceWith(document.createRange().createContextualFragment(window.__ic['${p.cat}']))">`}

function renderCats(){
  const cats=[...new Set(P.map(p=>p.cat))];
  $("cats").innerHTML=cats.map(c=>`<button class="cat" type="button" aria-pressed="${c===st.cat}" data-cat="${c}">${ICONS[c]||""}${c}<small>${P.filter(p=>p.cat===c).length}</small></button>`).join("");
}
// Search text for a part: name, numbers, synonyms (tags), hidden search-only keywords, and fitment
// aliases, so "merc om471 oil filter" or "dd15 filter" finds the right part. DD13/15/16 are the
// Detroit names for the OM470/471/473 engine family.
const ENG_ALIAS={OM470:"om470 dd13 10.7",OM471:"om471 dd15 12.8",OM472:"om472",OM473:"om473 dd16 15.6"};
function hay(p){
  if(p._hay)return p._hay;
  const f=p.fits||{models:[],engines:[]};
  return p._hay=[p.name,p.cat,p.sku,p.brand,...(p.oem||[]),...(p.cross||[]),...(p.tags||[]),...(p.keywords||[]),
    f.models.length?"mercedes-benz mercedes merc benz actros truck "+f.models.join(" ")+(f.models.includes("MP4")?" 963":""):"",
    ...f.engines.map(e=>ENG_ALIAS[e]||e)].join(" ").toLowerCase();
}
function renderGrid(){
  const words=st.q.toLowerCase().split(/\s+/).filter(Boolean);
  const norm=x=>x.toLowerCase().replace(/[^a-z0-9]/g,"");
  const qn=norm(st.q).replace(/^a(?=\d)/,"");
  const nums=p=>[p.sku||"",...(p.oem||[]),...(p.cross||[])].map(n=>norm(n).replace(/^a(?=\d)/,""));
  const fitsEng=p=>!st.eng||!p.fits||!(p.fits.engines||[]).length||p.fits.engines.includes(st.eng);
  let r=P.filter(p=>(!st.cat||p.cat===st.cat)&&fitsEng(p)&&((qn.length>=4&&nums(p).some(n=>n.includes(qn)))||words.every(w=>hay(p).includes(w))));
  r.sort((a,b)=>(b.available-a.available));
  $("listTitle").textContent=(st.q?`Results for "${st.q}"`:(st.cat||"All parts"))+(st.eng?` for ${st.eng}`:"");
  document.querySelectorAll("[data-eng]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.eng===st.eng&&!!st.eng)));
  $("resultCount").innerHTML=`${r.length} part${r.length===1?"":"s"}${st.cat||st.q||st.eng?' · <button class="clear" type="button" data-clear>Show all</button>':""}`;
  $("grid").innerHTML=r.length?r.map(p=>`<a class="card" href="/parts/${p.slug}/">
    <div class="pic">${pic(p)}</div>
    <div class="body"><h3>${p.name}</h3><span class="pn">${p.oem&&p.oem.length?"OE "+p.oem[0]:"Part no. "+p.sku}</span>
    <div class="foot"><div>${p.price!=null?`<div class="price">${money(p.price)}</div>`:`<div class="price ask">Call for price</div>`}
    <div class="stock ${p.available?"":"out"}">${p.available?"In stock":"Sold out, ask us"}</div></div><span class="view">View</span></div></div></a>`).join("")
    :`<div class="empty">No parts match that search. <a href="#ask">Send us your rego or VIN and a photo of the old part</a>, or call 0481 309 893, and we'll find it for you.</div>`;
}
function totals(){
  const items=Object.entries(cart);
  const n=items.reduce((s,[,q])=>s+q,0);
  const sub=items.reduce((s,[k,q])=>{const {p}=parse(k);return s+(p&&p.price?p.price*q:0)},0);
  const quote=items.some(([k])=>{const {p}=parse(k);return p&&p.freightQuote});
  const big=items.reduce((m,[k])=>{const {p}=parse(k);return p&&p.shipClass?Math.max(m,DATA.shipping.rates[p.shipClass]):m},0);
  const ship=n&&!quote?(big||DATA.shipping.flatRate):0;
  return {items,n,sub,ship,quote};
}
function renderCart(){
  const {items,n,sub,ship,quote}=totals();
  $("cartCount").textContent=n;
  $("lines").innerHTML=n?items.map(([k,q])=>{const {p,opt}=parse(k);if(!p)return"";return `<div class="line"><strong>${p.name}${opt?" ("+opt+")":""}</strong><span>${money(p.price*q)}</span>
    <span class="pn">${money(p.price)} each</span><span class="qty"><button type="button" data-dec="${k}" aria-label="Remove one">−</button>${q}<button type="button" data-inc="${k}" aria-label="Add one">+</button></span></div>`}).join("")
    :`<p class="note" style="padding:20px 0">Your cart is empty.</p>`;
  $("sub").textContent=money(sub);
  $("ship").textContent=!n?"—":quote?"Freight quoted, or free pickup":money(ship)+" or free pickup";
  $("total").textContent=money(sub+ship);
  $("checkout").disabled=!n;
}
const HOME=!!$("grid"); // home page has the search grid; every page has the cart
const on=(id,ev,fn)=>{const el=$(id);if(el)el.addEventListener(ev,fn)};
function closeAll(){$("drawer").hidden=true}
function all(){if(HOME){renderCats();renderGrid()}renderCart()}

document.addEventListener("click",e=>{
  const t=e.target.closest("button");
  if(!t){if(e.target.classList&&e.target.classList.contains("overlay"))closeAll();return}
  if(t.dataset.cat){st.cat=st.cat===t.dataset.cat?null:t.dataset.cat;st.q="";$("q").value="";all();$("parts").scrollIntoView({behavior:"smooth"})}
  else if("clear" in t.dataset){st.cat=null;st.q="";st.eng="";$("q").value="";all()}
  else if("eng" in t.dataset){st.eng=t.dataset.eng;all();$("parts").scrollIntoView({behavior:"smooth"})}
  else if(t.dataset.close)closeAll();
  else if(t.dataset.inc){const {p}=parse(t.dataset.inc);if(p&&p.maxQty&&cart[t.dataset.inc]>=p.maxQty)return;cart[t.dataset.inc]++;save();renderCart()}
  else if(t.dataset.dec){if(--cart[t.dataset.dec]<=0)delete cart[t.dataset.dec];save();renderCart()}
});
on("pAdd","click",()=>{if(!current)return;const k=key(current.id,current.options?$("pOpt").value:null);if(current.maxQty&&(cart[k]||0)>=current.maxQty){$("pAdd").textContent=`Only ${current.maxQty} available`;return}cart[k]=(cart[k]||0)+1;save();renderCart();$("pAdd").textContent=`Added (${cart[k]} in cart)`});
on("searchForm","submit",e=>{e.preventDefault();st.q=$("q").value;st.cat=null;all();$("parts").scrollIntoView({behavior:"smooth"})});
on("q","input",e=>{st.q=e.target.value;st.cat=null;renderCats();renderGrid()});
on("toSearch","click",e=>{e.preventDefault();$("q").scrollIntoView({behavior:"smooth",block:"center"});$("q").focus({preventScroll:true})});
// "Still not sure?" form: no server needed, it opens the customer's own SMS or email app with the message written for them
on("askForm","submit",e=>{
  e.preventDefault();const f=e.target,v=n=>f.elements[n].value.trim();
  const msg=`Hi VMS, can you check the right part for my truck?\nPart: ${v("part")}\nRego/VIN: ${v("truck")||"(not given)"}\nName: ${v("name")||"(not given)"}\nPhoto of the old part: (attach it to this message)`;
  const how=(e.submitter&&e.submitter.value)||"sms";
  location.href=how==="email"?`mailto:${f.dataset.email}?subject=${encodeURIComponent("Part check: "+v("part"))}&body=${encodeURIComponent(msg)}`:`sms:${f.dataset.phone}?&body=${encodeURIComponent(msg)}`;
});
on("openCart","click",()=>{$("drawer").hidden=false});
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeAll()});
on("checkout","click",async()=>{
  const b=$("checkout");b.disabled=true;b.textContent="Opening secure checkout…";
  try{
    const items=Object.entries(cart).map(([k,q])=>{const [id,option]=k.split("|");return {id,option:option||null,qty:q}});
    const r=await fetch("/api/checkout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({items})});
    const j=await r.json();
    if(!r.ok||!j.url)throw new Error(j.error||"Checkout failed");
    location.href=j.url;
  }catch(err){
    $("checkoutNote").textContent="Checkout didn't open: "+err.message+". Please call or text 0481 309 893 and we'll take your order by phone.";
    b.disabled=false;b.textContent="Checkout";
  }
});

window.__ic=ICONS;
if($("yr"))$("yr").textContent=new Date().getFullYear();
load();
fetch("/products.json").then(r=>r.json()).then(d=>{
  DATA=d;P=d.products;
  Object.keys(cart).forEach(k=>{const {p}=parse(k);if(!p||!p.available||p.price==null)delete cart[k]});
  all();
  const part=document.body.dataset.part;if(part)current=P.find(x=>x.id===part)||null;
  const id=new URLSearchParams(location.search).get("p"),old=id&&P.find(x=>x.id===id);if(old&&HOME)location.replace("/parts/"+old.slug+"/"); // old ?p= links
  if(location.hash==="#cart")$("drawer").hidden=false;
});
})();
