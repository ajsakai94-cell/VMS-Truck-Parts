// Shared menu for the private backend. Each /admin/ page loads this with
// <script src="/admin/shell.js" data-page="orders"></script> at the end of <body>.
// One login for every page: the STATS_KEY saved in this browser as "vms-stats-key".
(function(){
  var me=document.currentScript, page=me&&me.dataset.page;
  var PAGES=[["orders","/admin/orders/","Orders"],["products","/admin/products/","Products"],["stats","/admin/stats/","Stats"],["settings","/admin/settings/","Settings"]];
  var nav=document.createElement("nav");
  nav.className="adm-nav";nav.setAttribute("aria-label","Backend");
  nav.innerHTML='<a class="adm-brand" href="/admin/orders/">VMS<i>.</i><small>Backend</small></a>'+
    PAGES.map(function(p){return '<a class="it" data-p="'+p[0]+'" href="'+p[1]+'"'+(p[0]===page?' aria-current="page"':'')+'><span>'+p[2]+'</span></a>'}).join("")+
    '<div class="adm-foot"><a href="/" target="_blank" rel="noopener">View shop</a><button type="button" id="admLogout">Log out on this device</button></div>';
  document.body.insertBefore(nav,document.body.firstChild);
  document.body.classList.add("adm");
  document.getElementById("admLogout").onclick=function(){try{localStorage.removeItem("vms-stats-key")}catch(e){}location.href="/admin/orders/"};
  // Pages call this to show a count on a menu item, e.g. orders still to send
  window.vmsBadge=function(p,n){var a=nav.querySelector('[data-p="'+p+'"]');if(!a)return;var b=a.querySelector(".adm-badge");
    if(!n){if(b)b.remove();return}if(!b){b=document.createElement("span");b.className="adm-badge";a.appendChild(b)}b.textContent=n};
})();
