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
// Activity log (track.js): every shop step is recorded so we can see who looked, searched, filled a cart or started checkout
const T=(n,p)=>{try{window.vmsTrack&&window.vmsTrack(n,p)}catch(e){}};
const cartSnap=()=>Object.entries(cart).map(([k,q])=>{const {p,opt}=parse(k);return {id:k.split("|")[0],name:p?p.name:k,opt:opt||undefined,qty:q,price:p?p.price:null}});
const cartVal=()=>Object.entries(cart).reduce((s,[k,q])=>{const {p}=parse(k);return s+(p&&p.price?p.price*q:0)},0);
let lastCount=0, searchT=null;
function trackSearch(how){clearTimeout(searchT);const q=st.q.trim();if(q.length<2)return;searchT=setTimeout(()=>T("search",{q:q.slice(0,100),results:lastCount,how,cat:st.cat||undefined,eng:st.eng||undefined}),how==="typed"?1200:0)}
const money=n=>"$"+n.toFixed(2);
let DATA=null, P=[], st={cat:null,q:"",eng:""}, cart={}, current=null;
let pc="", cty="AU", sq=null, sqKey="", sqBusy=false, sqFail=""; // delivery postcode and the Australia Post quote for the cart as it is now

function load(){try{cart=JSON.parse(localStorage.getItem("vms-cart")||"{}");pc=localStorage.getItem("vms-pc")||"";cty=localStorage.getItem("vms-cty")==="NZ"?"NZ":"AU"}catch(e){cart={}}}
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
  // "OE A 012 542 62 18", "part no. 123" and "OEM ..." search the same as the bare number
  const q0=st.q.replace(/^\s*(oem?|o\.e\.|part\s*(no\.?|number|#)?|p\/?n)\s*[:#.]?\s+/i,"");
  const words=q0.toLowerCase().split(/\s+/).filter(Boolean);
  const norm=x=>x.toLowerCase().replace(/[^a-z0-9]/g,"");
  const qn=norm(q0).replace(/^a(?=\d)/,"");
  const nums=p=>[p.sku||"",...(p.oem||[]),...(p.cross||[])].map(n=>norm(n).replace(/^a(?=\d)/,""));
  const fitsEng=p=>!st.eng||!p.fits||!(p.fits.engines||[]).length||p.fits.engines.includes(st.eng);
  let r=P.filter(p=>(!st.cat||p.cat===st.cat)&&fitsEng(p)&&((qn.length>=4&&nums(p).some(n=>n.includes(qn)))||words.every(w=>hay(p).includes(w))));
  r.sort((a,b)=>(b.available-a.available));lastCount=r.length;
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
  const quote=cty==="AU"&&items.some(([k])=>{const {p}=parse(k);return p&&p.freightQuote}); // NZ: shipping.js refuses freight-quoted parts
  const ready=!!(sq&&sqKey===quoteKey()&&!sq.needsPostcode&&!sq.unavailable);
  const ship=n&&!quote&&ready?sq.cents/100:0;
  return {items,n,sub,ship,quote,ready};
}
const pc4=()=>cty==="AU"&&/^\d{4}$/.test(pc)?pc:"";
const quoteKey=()=>cty+pc4()+"#"+JSON.stringify(Object.entries(cart).sort());
async function getQuote(){
  const k=quoteKey();
  if(!Object.keys(cart).length||(sq&&sqKey===k)||sqBusy||sqFail===k)return;
  sqBusy=true;renderCart();
  try{
    const items=Object.entries(cart).map(([c,q])=>({id:c.split("|")[0],qty:q}));
    const r=await fetch("/api/shipping",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({items,postcode:pc4(),country:cty})});
    const j=await r.json();if(!r.ok)throw new Error(j.error);
    sq=j;sqKey=k;
    T("shipping_quote",{postcode:pc4()||undefined,country:cty==="NZ"?"NZ":undefined,unavailable:j.unavailable||undefined,cents:j.cents,source:j.source,needsPostcode:!!j.needsPostcode,items:items.length});
  }catch(e){sq=null;sqFail=k;T("shipping_quote_failed",{postcode:pc4()||undefined,error:String(e.message||e).slice(0,120)})}
  sqBusy=false;renderCart();
  if(sqKey!==quoteKey())getQuote(); // the cart changed while we were asking
}
function renderCart(){
  const {items,n,sub,ship,quote,ready}=totals();
  $("cartCount").textContent=n;
  $("lines").innerHTML=n?items.map(([k,q])=>{const {p,opt}=parse(k);if(!p)return"";return `<div class="line"><strong>${p.name}${opt?" ("+opt+")":""}</strong><span>${money(p.price*q)}</span>
    <span class="pn">${money(p.price)} each</span><span class="qty"><button type="button" data-dec="${k}" aria-label="Remove one">−</button>${q}<button type="button" data-inc="${k}" aria-label="Add one">+</button></span></div>`}).join("")
    :`<p class="note" style="padding:20px 0">Your cart is empty.</p>`;
  $("sub").textContent=money(sub);
  const cur=sq&&sqKey===quoteKey(), needPc=cur&&sq.needsPostcode, nz=cty==="NZ", noNz=cur&&sq.unavailable;
  const boxed=items.some(([k])=>{const {p}=parse(k);return p&&(p.pack||!p.satchel)}); // boxed parts are priced to the postcode
  if($("ctyRow"))$("ctyRow").hidden=!n;
  if($("country"))$("country").value=cty;
  if($("pcRow"))$("pcRow").hidden=!(n&&!nz&&!quote&&boxed);
  $("ship").textContent=!n?"—":quote?"Freight quoted, or free pickup":noNz?"Not available":ready?money(ship)+(nz?"":" or free pickup"):needPc?"Enter your postcode":sqBusy?"Checking…":"Couldn't check, call us";
  if($("checkoutNote"))$("checkoutNote").textContent=noNz?sq.label+" 0481 309 893":nz?"Shipped to New Zealand by Australia Post International, tracked. Prices and postage are in Australian dollars. Any NZ import charges are paid by you. No account needed.":"Shipped by Australia Post. No account needed, and you can choose free pickup at checkout instead.";
  $("total").textContent=money(sub+ship);
  if($("postcode")&&document.activeElement!==$("postcode"))$("postcode").value=pc;
  $("checkout").disabled=!n||(!quote&&!ready);
  if(n&&!quote&&!ready)getQuote();
}
const HOME=!!$("grid"); // home page has the search grid; every page has the cart
const on=(id,ev,fn)=>{const el=$(id);if(el)el.addEventListener(ev,fn)};
function closeAll(){if(!$("drawer").hidden)T("cart_close",{items:Object.keys(cart).length,value:cartVal()});$("drawer").hidden=true}
function all(){if(HOME){renderCats();renderGrid()}renderCart()}

document.addEventListener("click",e=>{
  const t=e.target.closest("button");
  if(!t){if(e.target.classList&&e.target.classList.contains("overlay"))closeAll();return}
  if(t.dataset.cat){st.cat=st.cat===t.dataset.cat?null:t.dataset.cat;T("category",{cat:st.cat||"(all)"});st.q="";$("q").value="";all();$("parts").scrollIntoView({behavior:"smooth"})}
  else if("clear" in t.dataset){st.cat=null;st.q="";st.eng="";$("q").value="";all()}
  else if("eng" in t.dataset){st.eng=t.dataset.eng;T("engine_filter",{eng:st.eng||"(all)"});all();$("parts").scrollIntoView({behavior:"smooth"})}
  else if(t.dataset.close)closeAll();
  else if(t.dataset.inc){const k=t.dataset.inc,{p}=parse(k);if(p&&p.maxQty&&cart[k]>=p.maxQty){T("add_blocked",{id:k,maxQty:p.maxQty});return}cart[k]++;save();renderCart();T("cart_qty",{id:k,qty:cart[k],value:cartVal(),cart:cartSnap()})}
  else if(t.dataset.dec){const k=t.dataset.dec;if(--cart[k]<=0){delete cart[k];T("remove_from_cart",{id:k,value:cartVal(),cart:cartSnap()})}else T("cart_qty",{id:k,qty:cart[k],value:cartVal(),cart:cartSnap()});save();renderCart()}
});
on("pAdd","click",()=>{if(!current)return;const k=key(current.id,current.options?$("pOpt").value:null);if(current.maxQty&&(cart[k]||0)>=current.maxQty){$("pAdd").textContent=`Only ${current.maxQty} available`;T("add_blocked",{id:k,maxQty:current.maxQty});return}cart[k]=(cart[k]||0)+1;save();renderCart();$("pAdd").textContent=`Added (${cart[k]} in cart)`;
  T("add_to_cart",{id:current.id,name:current.name,opt:current.options?$("pOpt").value:undefined,price:current.price,qty:cart[k],value:cartVal(),cart:cartSnap()})});
on("searchForm","submit",e=>{e.preventDefault();st.q=$("q").value;st.cat=null;all();trackSearch("submitted");$("parts").scrollIntoView({behavior:"smooth"})});
on("q","input",e=>{st.q=e.target.value;st.cat=null;renderCats();renderGrid();trackSearch("typed")});
on("toSearch","click",e=>{e.preventDefault();$("q").scrollIntoView({behavior:"smooth",block:"center"});$("q").focus({preventScroll:true})});
// "Still not sure?" form: no server needed, it opens the customer's own SMS or email app with the message written for them
on("askForm","submit",e=>{
  e.preventDefault();const f=e.target,v=n=>f.elements[n].value.trim();
  const msg=`Hi VMS, can you check the right part for my truck?\nPart: ${v("part")}\nRego/VIN: ${v("truck")||"(not given)"}\nName: ${v("name")||"(not given)"}\nPhoto of the old part: (attach it to this message)`;
  const how=(e.submitter&&e.submitter.value)||"sms";
  T("ask_form",{how,part:v("part").slice(0,120),truck:v("truck").slice(0,40)||undefined,name:v("name").slice(0,60)||undefined});
  location.href=how==="email"?`mailto:${f.dataset.email}?subject=${encodeURIComponent("Part check: "+v("part"))}&body=${encodeURIComponent(msg)}`:`sms:${f.dataset.phone}?&body=${encodeURIComponent(msg)}`;
});
on("openCart","click",()=>{$("drawer").hidden=false;T("cart_open",{items:Object.keys(cart).length,value:cartVal(),cart:cartSnap()})});
on("country","change",e=>{cty=e.target.value==="NZ"?"NZ":"AU";try{localStorage.setItem("vms-cty",cty)}catch(x){}T("country",{country:cty});renderCart()});
on("postcode","input",e=>{pc=e.target.value.replace(/\D/g,"").slice(0,4);e.target.value=pc;try{localStorage.setItem("vms-pc",pc)}catch(x){}if(pc.length===4)T("postcode",{postcode:pc});renderCart()});
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeAll()});
on("checkout","click",async()=>{
  const b=$("checkout");b.disabled=true;b.textContent="Opening secure checkout…";
  try{
    const items=Object.entries(cart).map(([k,q])=>{const [id,option]=k.split("|");return {id,option:option||null,qty:q}});
    const {sub,ship}=totals();
    T("begin_checkout",{value:sub,shipping:ship,postcode:pc4()||undefined,country:cty==="NZ"?"NZ":undefined,cart:cartSnap()});
    let vid="",sid="",own=0;try{vid=localStorage.getItem("vms-vid")||"";sid=sessionStorage.getItem("vms-sid")||"";own=localStorage.getItem("vms-owner")==="1"?1:0}catch(x){}
    const r=await fetch("/api/checkout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({items,postcode:pc4(),country:cty,vid,sid,own})});
    const j=await r.json();
    if(!r.ok||!j.url)throw new Error(j.error||"Checkout failed");
    location.href=j.url;
  }catch(err){
    T("checkout_error",{error:String(err.message||err).slice(0,200),cart:cartSnap()});
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
  if(current)T("view_item",{id:current.id,name:current.name,price:current.price,available:!!current.available});
  let seen=true;try{seen=!!sessionStorage.getItem("vms-cart-seen");sessionStorage.setItem("vms-cart-seen","1")}catch(e){}
  if(Object.keys(cart).length&&!seen)T("cart_restored",{value:cartVal(),cart:cartSnap()});
  const id=new URLSearchParams(location.search).get("p"),old=id&&P.find(x=>x.id===id);if(old&&HOME)location.replace("/parts/"+old.slug+"/"); // old ?p= links
  if(location.hash==="#cart")$("drawer").hidden=false;
});
// "Recently sold" pop-up, bottom left. Real paid orders only (from /api/recent-sales): part name and state,
// no customer details and no dates. Waits 15s, then one every ~45s, at most 4 per page, never while the cart
// is open, and a tap on the x stops it for the rest of the visit.
(function(){
  let off=false;try{off=sessionStorage.getItem("vms-rs-off")==="1"}catch(e){}
  if(off||/success/.test(location.pathname)||navigator.webdriver)return;
  const esc=t=>String(t).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  fetch("/api/recent-sales").then(r=>r.ok?r.json():null).then(j=>{
    const list=(j&&j.sales||[]).slice();if(!list.length)return;
    for(let i=list.length-1;i>0;i--){const k=Math.floor(Math.random()*(i+1));[list[i],list[k]]=[list[k],list[i]]}
    const el=document.createElement("aside");el.className="rsold";el.setAttribute("aria-live","polite");el.hidden=true;
    document.body.appendChild(el);
    let n=0,hideT=null;
    const busy=()=>[...document.querySelectorAll(".overlay")].some(o=>!o.hidden);
    function show(){
      if(n>=Math.min(4,list.length)||off)return;
      if(busy()||document.hidden){setTimeout(show,8000);return}
      const s=list[n++];
      el.innerHTML=`<a href="${esc(s.url)}">${s.img?`<img src="${esc(s.img)}" alt="" width="52" height="52" loading="lazy">`:""}<span><small>Recently sold${s.state?" in "+esc(s.state):""}</small><b>${esc(s.name)}</b></span></a><button type="button" class="rx" aria-label="Hide recently sold">&times;</button>`;
      el.hidden=false;requestAnimationFrame(()=>el.classList.add("in"));
      el.querySelector("a").addEventListener("click",()=>T("recent_sale_click",{name:s.name}));
      el.querySelector(".rx").addEventListener("click",()=>{off=true;try{sessionStorage.setItem("vms-rs-off","1")}catch(e){}hide()});
      clearTimeout(hideT);hideT=setTimeout(()=>{hide();setTimeout(show,38000+Math.random()*15000)},7000);
    }
    function hide(){el.classList.remove("in");setTimeout(()=>{el.hidden=true},300)}
    setTimeout(show,15000);
  }).catch(()=>{});
})();
})();
