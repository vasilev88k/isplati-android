const cfg=window.APP_CONFIG||{};
const app=document.getElementById("app");
if(!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("ВНЕСИ_") || !cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_ANON_KEY.includes("ВНЕСИ_")){
  app.innerHTML=`<div class="container"><div class="card"><h2>Системот не е конфигуриран</h2><p>Во <b>config.js</b> внеси го Supabase URL и anon/public key.</p></div></div>`;
  throw new Error("Missing Supabase config");
}
const sb=supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);

const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money=n=>new Intl.NumberFormat("mk-MK").format(Number(n))+" ден.";
const dt=s=>new Date(s).toLocaleString("mk-MK",{dateStyle:"short",timeStyle:"short"});
const q=sel=>document.querySelector(sel);
const monthNames=["Јануари","Февруари","Март","Април","Мај","Јуни","Јули","Август","Септември","Октомври","Ноември","Декември"];
const pad=n=>String(n).padStart(2,"0");
const periodKey=(m,y)=>`${y}-${pad(m+1)}`;
const periodLabel=(m,y)=>`${monthNames[m]} ${y}`;
const currentPeriod=()=>{
  const now=new Date();
  const saved=localStorage.getItem("isplati_period");
  if(saved && /^\d{4}-\d{2}$/.test(saved)){
    const [sy,sm]=saved.split("-").map(Number);
    if(sm>=1&&sm<=12&&sy>=2000&&sy<=2100)return {m:sm-1,y:sy};
  }
  return {m:now.getMonth(),y:now.getFullYear()};
};
const setPeriod=(m,y)=>localStorage.setItem("isplati_period",periodKey(m,y));
const closedPeriods=()=>{
  try{return JSON.parse(localStorage.getItem("isplati_closed_periods")||"[]").filter(x=>typeof x==="string")}
  catch{return []}
};
const isClosed=label=>closedPeriods().includes(label);
const closePeriod=label=>{
  const a=closedPeriods();
  if(!a.includes(label)){a.push(label);localStorage.setItem("isplati_closed_periods",JSON.stringify(a))}
};
const reopenPeriod=label=>{
  const a=closedPeriods().filter(x=>x!==label);
  localStorage.setItem("isplati_closed_periods",JSON.stringify(a));
};
const scrollState={y:0};
const PUBLIC_OVERVIEW_TOKEN="ovw_8c7f2e5a4d1b9c63f0a2e7d5b8c4f1a9";
const publicOverviewUrl=()=>location.origin+location.pathname+"?overview="+encodeURIComponent(PUBLIC_OVERVIEW_TOKEN);
function printQrOnly(){document.body.classList.add("qr-only");window.print();setTimeout(()=>document.body.classList.remove("qr-only"),700);}

// V10_PUSH_DIAGNOSTIC
async function savePushSubscriptionV10(subscription) {
  if (!subscription) throw new Error("Push subscription не постои.");

  const json = subscription.toJSON ? subscription.toJSON() : subscription;
  if (!json.endpoint || !json.keys || !json.keys.p256dh || !json.keys.auth) {
    throw new Error("Push subscription е невалидна или нема потребни keys.");
  }

  const { data, error } = await sb.rpc("save_push_subscription", {
    p_subscription: json
  });

  if (error) {
    console.error("save_push_subscription ERROR:", error);
    throw new Error(`Supabase: ${error.message || error}`);
  }

  console.log("Push subscription SAVED:", json.endpoint);
  return { data, subscription: json };
}

async function adminSession(){return (await sb.auth.getSession()).data.session}
let adminPollTimer=null;
let adminKnownStatus={};
let adminNotifyReady=false;
function stopAdminPolling(){if(adminPollTimer){clearInterval(adminPollTimer);adminPollTimer=null}}
const VAPID_PUBLIC_KEY=cfg.VAPID_PUBLIC_KEY||"";
function urlBase64ToUint8Array(base64String){
  const padding='='.repeat((4-(base64String.length%4))%4);
  const base64=(base64String+padding).replace(/-/g,'+').replace(/_/g,'/');
  const raw=atob(base64);
  return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));
}
async function prepareNotifications(){
  if(!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window) || !VAPID_PUBLIC_KEY) return;
  try{
    if(Notification.permission==='default') await Notification.requestPermission();
    adminNotifyReady=Notification.permission==='granted';
    if(!adminNotifyReady) return;

    const reg=await navigator.serviceWorker.register('sw.js',{scope:'./'});
    let sub=await reg.pushManager.getSubscription();
    if(!sub){
      sub=await reg.pushManager.subscribe({
        userVisibleOnly:true,
        applicationServerKey:urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }

    await savePushSubscriptionV10(sub);
    console.log("V10: Push subscription успешно зачувана во Supabase.");
  }catch(e){
    console.error('Push setup failed:',e);
    const msg = e?.message || String(e);
    setTimeout(() => alert("Push нотификациите не се регистрираа.\n\n" + msg), 50);
  }
}
function notifyAdmin(title,body){
  try{
    if(adminNotifyReady) new Notification(title,{body,tag:'isplati-potvrda'});
  }catch{}
  try{
    const AC=window.AudioContext||window.webkitAudioContext;
    if(AC){const c=new AC(),o=c.createOscillator(),g=c.createGain();o.frequency.value=880;g.gain.value=.08;o.connect(g);g.connect(c.destination);o.start();o.stop(c.currentTime+.18)}
  }catch{}
  const n=document.createElement('div');n.className='notify-toast';n.textContent=body;document.body.appendChild(n);setTimeout(()=>n.remove(),5000);
}
function shell(title,body){
  app.innerHTML=`<div class="container"><div class="top"><h1>${title}</h1><button id="logout" class="secondary">Одјави се</button></div>${body}</div>`;
  q("#logout")?.addEventListener("click",()=>sb.auth.signOut().then(()=>location.reload()));
}
async function admin(){
  const s=await adminSession();
  if(!s){login();return}
  const {data:admins}=await sb.from("admins").select("active").eq("id",s.user.id).maybeSingle();
  if(!admins?.active){await sb.auth.signOut();login("Немате администраторски пристап.");return}
  await prepareNotifications();
  renderAdmin(false);
}
function login(msg=""){
 app.innerHTML=`<div class="login card"><h1>Администратор</h1>${msg?`<p class="pending">${esc(msg)}</p>`:""}<label>Email</label><input id="email" type="email"><label>Лозинка</label><input id="pass" type="password"><button id="loginBtn">Најави се</button></div>`;
 q("#loginBtn").onclick=async()=>{const {error}=await sb.auth.signInWithPassword({email:q("#email").value,password:q("#pass").value});if(error)login(error.message);else renderAdmin(false)};
}
async function renderAdmin(restoreScroll=true){
 stopAdminPolling();
 const {data:partners,error}=await sb.from("partners").select("*").order("name");
 if(error){app.innerHTML=`<div class="container"><div class="card">${esc(error.message)}</div></div>`;return}
 const now=new Date();
 const current=currentPeriod();
 shell("Администратор — Исплати",`
 <div class="card">
   <div class="periodbar">
     <div class="period-main-control">
       <b>МЕСЕЦ</b>
       <div class="period-controls">
         <select id="periodMonth" aria-label="Месец">${monthNames.map((m,i)=>`<option value="${i}" ${i===current.m?"selected":""}>${m}</option>`).join("")}</select>
         <select id="periodYear" aria-label="Година">${Array.from({length:11},(_,i)=>now.getFullYear()-5+i).map(y=>`<option value="${y}" ${y===current.y?"selected":""}>${y}</option>`).join("")}</select>
       </div>
       <div class="remaining-box"><span>СУМА ЗА ИСПЛАТА</span><strong id="remainingAmount">0 ден.</strong></div>
     </div>
     <div class="period-actions">
       <button id="finishPeriod" class="secondary">ЗАВРШИ ИСПЛАТИ</button>
       <button id="printReports" class="print-payouts">ПЕЧАТИ ИСПЛАТИ</button>
     </div>
   </div>
 </div>
 <div class="card"><div class="top"><b>Партнери: ${partners.length}</b><button id="newPartner">+ Нов партнер</button></div></div>
 <div class="card"><input id="search" placeholder="Пребарај партнер..." autocomplete="off"><div id="plist" class="list"></div></div>`);
 const monthEl=q("#periodMonth"),yearEl=q("#periodYear");
 const getPeriod=()=>({m:Number(monthEl.value),y:Number(yearEl.value)});
 const savePeriod=()=>{const x=getPeriod();setPeriod(x.m,x.y)};
 const draw=async()=>{
   const term=(q("#search").value||"").toLowerCase();
   const x=getPeriod(), label=periodLabel(x.m,x.y);
   const ids=partners.map(p=>p.id);
   let payments=[];
   if(ids.length){
     const {data,error}=await sb.from("payments").select("id,partner_id,period,confirmed_at,amount").in("partner_id",ids);
     if(error){q("#plist").innerHTML=`<p class="pending">${esc(error.message)}</p>`;return}
     payments=data||[];
   }
   const remaining=(payments||[]).filter(p=>p.period===label && !p.confirmed_at).reduce((sum,p)=>sum+Number(p.amount||0),0);
   const remainingEl=q("#remainingAmount");
   if(remainingEl) remainingEl.textContent=money(remaining);
   const byPartner={};
   if(!isClosed(label)){
     payments.filter(p=>p.period===label).forEach(p=>(byPartner[p.partner_id]??=[]).push(p));
   }
   q("#plist").innerHTML=partners.filter(p=>p.name.toLowerCase().includes(term)).map(p=>{
     const ps=byPartner[p.id]||[];
     const state=ps.length?(ps.every(v=>v.confirmed_at)?"done":"pending"):"none";
     const cls=state==="done"?"status-green":state==="pending"?"status-yellow":"status-white";
     const mark=state==="done"?"✓":"";
     return `<div class="item partner-row">
       <div class="partner-main">
         <span class="status-square ${cls}" aria-label="${state}">${mark}</span>
         <div class="partner-name-wrap">
           <button class="partner-name" data-id="${p.id}" type="button">${esc(p.name)}</button>
           <button class="open-partner secondary" data-id="${p.id}" type="button">ОТВОРИ</button>
         </div>
       </div>
       <div class="partner-side">
         <input class="quick-amount" data-id="${p.id}" inputmode="numeric" type="text" pattern="[0-9]*" autocomplete="off" placeholder="Сума">
         <button class="quick-add" data-id="${p.id}" type="button">ДОДАЈ</button>
       </div>
     </div>`;
   }).join("")||"<p>Нема резултати.</p>";
   const openPartner=(id)=>{
     scrollState.y=window.scrollY;
     const p=partners.find(v=>v.id===id);
     if(p){history.pushState({adminPartner:p.id},"",`${location.pathname}?admin_partner=${encodeURIComponent(p.id)}`);partnerAdmin(p,label);}
   };
   q("#plist").querySelectorAll(".open-partner,.partner-name").forEach(b=>b.onclick=()=>openPartner(b.dataset.id));
   q("#plist").querySelectorAll(".quick-add").forEach(b=>b.onclick=async()=>{
     const input=q(`.quick-amount[data-id="${b.dataset.id}"]`);
     const amount=Number(String(input?.value||"").replace(/[^0-9]/g,""));
     if(!amount||amount<=0){alert("Внеси износ.");input?.focus();return}
     const {error}=await sb.from("payments").insert({partner_id:b.dataset.id,period:label,amount});
     if(error){alert(error.message);return}
     reopenPeriod(label);
     input.value="";
     await draw();
   });
   q("#plist").querySelectorAll(".quick-amount").forEach(input=>{
     input.addEventListener("keydown",e=>{if(e.key==="Enter")q(`.quick-add[data-id="${input.dataset.id}"]`)?.click()});
     input.addEventListener("input",()=>{input.value=input.value.replace(/[^0-9]/g,"").slice(0,9); input._keepFocusUntil=Date.now()+20000;});
     input.addEventListener("focus",()=>{input._keepFocusUntil=Date.now()+20000;});
   });
 };
 const pollStatus=async()=>{
   const x=getPeriod(), label=periodLabel(x.m,x.y);
   const ids=partners.map(p=>p.id);
   if(!ids.length)return;
   const {data,error}=await sb.from("payments").select("id,partner_id,period,confirmed_at,amount").in("partner_id",ids);
   if(error)return;
   const current={};
   (data||[]).filter(v=>v.period===label).forEach(v=>{current[v.id]=!!v.confirmed_at});
   if(Object.keys(adminKnownStatus).length){
     (data||[]).filter(v=>v.period===label && v.confirmed_at && adminKnownStatus[v.id]===false).forEach(v=>{
       const partner=partners.find(p=>p.id===v.partner_id);
       notifyAdmin("Потврдена исплата",`${partner?.name||"Партнер"} ја потврди исплатата од ${money(v.amount)}.`);
     });
   }
   adminKnownStatus=current;
   await draw();
 };
 stopAdminPolling();
 adminKnownStatus={};
 await pollStatus();
 adminPollTimer=setInterval(pollStatus,5000);
 q("#search").oninput=draw;
 [monthEl,yearEl].forEach(el=>el.onchange=()=>{savePeriod();draw()});
 q("#finishPeriod").onclick=async()=>{
   const x=getPeriod(), label=periodLabel(x.m,x.y);
   if(!confirm(`Да се заврши исплатата за ${label}? Историјата останува и месецот ќе се појави во извештаите.`))return;
   closePeriod(label);
   await draw();
 };
 q("#printReports").onclick=()=>openReportChooser(partners);
 q("#newPartner").onclick=newPartner;
 await draw();
 const overviewCard=document.createElement("div");
 overviewCard.className="card qr-card admin-overview-card";
 overviewCard.innerHTML=`<h2>ИСТОРИЈА И СОСТОЈБА — СИТЕ ПАРТНЕРИ</h2><div class="qr-print-area"><h2 class="qr-name">Исплати — сите партнери</h2><div id="adminOverviewQr" class="qr"></div></div><a class="qr-link" id="adminOverviewLink" target="_blank" rel="noopener"></a><div class="qr-actions"><button id="printAdminOverviewQR" class="secondary">ПЕЧАТИ</button><button id="shareAdminOverviewQR" class="secondary">СПОДЕЛИ</button></div>`;
 app.querySelector(".container").appendChild(overviewCard);
 const overviewUrl=publicOverviewUrl();
 new QRCode(q("#adminOverviewQr"),{text:overviewUrl,width:220,height:220});
 q("#adminOverviewLink").textContent=overviewUrl;
 q("#adminOverviewLink").href=overviewUrl;
 q("#printAdminOverviewQR").onclick=printQrOnly;
 q("#shareAdminOverviewQR").onclick=async()=>{
   if(navigator.share){try{await navigator.share({title:"Исплати — сите партнери",text:overviewUrl})}catch(e){}}
   else{try{await navigator.clipboard.writeText(overviewUrl);alert("Линкот е копиран.")}catch{alert("Линк: "+overviewUrl)}}
 };
 if(restoreScroll)setTimeout(()=>window.scrollTo(0,scrollState.y),0);
}
async function newPartner(){
 const name=prompt("Име на партнерот:");
 if(!name?.trim())return;
 const {data,error}=await sb.from("partners").insert({name:name.trim()}).select().single();
 if(error)alert(error.message);else renderAdmin(true);
}
async function partnerAdmin(p,selectedPeriodLabel){
 const {data:payments,error}=await sb.from("payments").select("*").eq("partner_id",p.id).order("created_at",{ascending:false});
 if(error){alert(error.message);return}
 const pendingTotal=(payments||[]).filter(x=>!x.confirmed_at).reduce((s,x)=>s+Number(x.amount||0),0);
 shell(`Партнер — ${esc(p.name)}`,`
 <div class="card"><button id="back" class="secondary">← Назад</button> <button id="deletePartner" class="danger">Избриши партнер</button></div>
 <div class="card"><h2>Историја</h2><div id="history" class="list"></div></div>
 <div class="card qr-card"><h2>QR код</h2><div class="qr-print-area"><h2 class="qr-name">${esc(p.name)}</h2><div id="qr" class="qr"></div></div><div class="pending-total"><span>ВКУПНО ЗА ИСПЛАТА</span><br>${money(pendingTotal)}</div><a class="qr-link" id="link" target="_blank" rel="noopener"></a><div class="qr-actions"><button id="printQR" class="secondary">ПЕЧАТИ</button><button id="shareQR" class="secondary">СПОДЕЛИ</button></div></div>`);
 q("#back").onclick=()=>history.back();
 q("#deletePartner").onclick=async()=>{
   if(!confirm(`Да го избришам партнерот „${p.name}"? Партнер со исплати не може да биде избришан.`))return;
   const {error}=await sb.rpc("admin_delete_partner",{p_partner_id:p.id});
   if(error)alert(error.message);else adminBack();
 };
 q("#history").innerHTML=payments.map(x=>`<div class="item"><div><b>${esc(x.period)}</b><div class="amount">${money(x.amount)}</div>${x.confirmed_at?`<div class="success">Примено: ${dt(x.confirmed_at)}${x.recipient_name?` — ${esc(x.recipient_name)}`:""}</div>`:`<div class="pending">Не е потврдено</div>`}</div><div class="actions">${!x.confirmed_at?`<button class="secondary" data-edit="${x.id}">Измени</button><button class="danger" data-delete-pay="${x.id}">Избриши</button>`:""}</div></div>`).join("")||"<p>Нема исплати.</p>";
 q("#history").querySelectorAll("[data-edit]").forEach(b=>b.onclick=async()=>{
   const x=payments.find(v=>v.id===b.dataset.edit);if(!x)return;
   const period=prompt("Период:",x.period);if(period===null)return;
   const amountText=prompt("Износ во денари:",String(x.amount));if(amountText===null)return;
   const amount=Number(amountText);
   if(!period.trim()||!amount||amount<=0){alert("Внеси валиден период и износ.");return}
   const {error}=await sb.rpc("admin_update_payment",{p_payment_id:x.id,p_period:period.trim(),p_amount:amount});
   if(error)alert(error.message);else partnerAdmin(p,selectedPeriodLabel);
 });
 q("#history").querySelectorAll("[data-delete-pay]").forEach(b=>b.onclick=async()=>{
   const x=payments.find(v=>v.id===b.dataset.deletePay);if(!x)return;
   if(!confirm(`Да ја избришам исплатата „${x.period} — ${money(x.amount)}“?`))return;
   const {error}=await sb.rpc("admin_delete_payment",{p_payment_id:x.id});
   if(error)alert(error.message);else partnerAdmin(p,selectedPeriodLabel);
 });
 const url=location.origin+location.pathname+"?partner="+encodeURIComponent(p.token);
 new QRCode(q("#qr"),{text:url,width:220,height:220});
 q("#link").textContent=url;
 q("#link").href=url;
 q("#printQR").onclick=printQrOnly;
 q("#shareQR").onclick=async()=>{
   if(navigator.share){try{await navigator.share({title:`QR код — ${p.name}`,text:url})}catch(e){}}
   else{try{await navigator.clipboard.writeText(url);alert("Линкот е копиран.")}catch{alert("Линк: "+url)}}
 };
}
function reportRowsFromPayments(payments,partners,selectedLabels){
 const partnerMap=Object.fromEntries(partners.map(p=>[p.id,p.name]));
 const rows=(payments||[]).filter(x=>x.confirmed_at && selectedLabels.includes(x.period));
 const grouped={};
 rows.forEach(x=>{
   const key=x.partner_id;
   grouped[key]??={name:partnerMap[key]||"Непознат партнер",months:{},total:0};
   grouped[key].months[x.period]=(grouped[key].months[x.period]||0)+Number(x.amount||0);
   grouped[key].total+=Number(x.amount||0);
 });
 return {rows,grouped:Object.values(grouped).sort((a,b)=>a.name.localeCompare(b.name,"mk"))};
}
async function openReportChooser(partners){
 const periods=closedPeriods();
 if(!periods.length){alert("Сè уште нема завршени месеци.");return}
 const checked=periods.slice();
 const overlay=document.createElement("div");overlay.className="modal-backdrop";
 overlay.innerHTML=`<div class="modal-card"><div class="top"><h2>Завршени месеци</h2><button id="closeReport" class="secondary">✕</button></div><div class="report-months">${periods.map((x,i)=>`<label><input type="checkbox" data-period="${esc(x)}" checked> ${esc(x)}</label>`).join("")}</div><div class="report-actions"><button id="makeReport">ПРИКАЖИ ИЗВЕШТАЈ</button></div></div>`;
 document.body.appendChild(overlay);
 q("#closeReport")?.addEventListener("click",()=>overlay.remove());
 q("#makeReport")?.addEventListener("click",async()=>{
   const selected=[...overlay.querySelectorAll("input[type=checkbox]:checked")].map(x=>x.dataset.period);
   if(!selected.length){alert("Избери барем еден месец.");return}
   overlay.remove();
   await showReport(partners,selected);
 });
}
async function showReport(partners,selectedLabels){
 const ids=partners.map(p=>p.id); if(!ids.length)return;
 const {data,error}=await sb.from("payments").select("id,partner_id,period,amount,confirmed_at").in("partner_id",ids);
 if(error){alert(error.message);return}
 const {rows,grouped}=reportRowsFromPayments(data,partners,selectedLabels);
 const grand=rows.reduce((s,x)=>s+Number(x.amount||0),0);
 const reportWindow=window.open("","_blank");
 if(!reportWindow){alert("Прелистувачот го блокира извештајот. Дозволи отворање нов прозорец.");return}
 const monthHead=selectedLabels.map(x=>`<th>${esc(x)}</th>`).join("");
 reportWindow.document.write(`<!doctype html><html lang="mk"><head><meta charset="utf-8"><title>Завршени исплати</title><style>body{font-family:Arial,sans-serif;padding:28px;color:#111}h1{margin:0 0 6px}p{color:#555}table{border-collapse:collapse;width:100%;margin-top:20px}th,td{border:1px solid #bbb;padding:9px;text-align:left}th{background:#f0f0f0}td.num,th.num{text-align:right}.total{font-size:22px;font-weight:700;margin-top:18px}.actions{display:flex;gap:8px;margin-bottom:20px}.actions button{padding:10px 14px}.share{margin-left:8px}@media print{.actions{display:none}body{padding:0}}</style></head><body><div class="actions"><button onclick="window.print()">Печати</button><button onclick="shareReport()" class="share">Сподели како фајл</button></div><h1>ЗАВРШЕНИ ИСПЛАТИ</h1><p>${selectedLabels.map(esc).join(", ")}</p><table><thead><tr><th>Партнер</th>${monthHead}<th class="num">Вкупно</th></tr></thead><tbody>${grouped.map(g=>`<tr><td>${esc(g.name)}</td>${selectedLabels.map(m=>`<td class="num">${money(g.months[m]||0)}</td>`).join("")}<td class="num"><b>${money(g.total)}</b></td></tr>`).join("")||`<tr><td colspan="${selectedLabels.length+2}">Нема потврдени исплати за избраните месеци.</td></tr>`}</tbody></table><div class="total">ВКУПНО ЗА СИТЕ: ${money(grand)}</div><script>async function shareReport(){const csv='\uFEFF'+${JSON.stringify(`Партнер,${selectedLabels.join(",")},Вкупно\n${grouped.map(g=>`${g.name},${selectedLabels.map(m=>g.months[m]||0).join(",")},${g.total}`).join("\n")}\nВКУПНО ЗА СИТЕ,${selectedLabels.map(m=>rows.filter(x=>x.period===m).reduce((a,x)=>a+Number(x.amount||0),0)).join(",")},${grand}`)};const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const file=new File([blob],'zavrseni-isplati.csv',{type:'text/csv'});if(navigator.share){try{await navigator.share({title:'Завршени исплати',files:[file]});return}catch(e){}}const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='zavrseni-isplati.txt';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}</script></body></html>`);
 reportWindow.document.close();
}
async function adminBack(){
 history.replaceState({}, "", location.pathname);
 await renderAdmin(true);
}
window.addEventListener("popstate",async()=>{
 const params=new URLSearchParams(location.search);
 const adminId=params.get("admin_partner");
 if(adminId){
   const {data:p,error}=await sb.from("partners").select("*").eq("id",adminId).maybeSingle();
   if(!error&&p)await partnerAdmin(p,periodLabel(currentPeriod().m,currentPeriod().y));
   else await renderAdmin(true);
 }else if(params.get("partner")){
   partnerPage(params.get("partner"));
 }else{
   await renderAdmin(true);
 }
});
async function publicOverview(token){
 const {data:rows,error}=await sb.rpc("get_public_payment_overview",{p_token:token});
 if(error||!rows){app.innerHTML=`<div class="container"><div class="card"><h2>Извештајот не е достапен.</h2></div></div>`;return}
 let payments=rows||[];
 const render=()=>{
   const total=payments.reduce((s,x)=>s+Number(x.amount||0),0);
   const confirmed=payments.filter(x=>x.confirmed_at).reduce((s,x)=>s+Number(x.amount||0),0);
   const remaining=total-confirmed;
   const sorted=[...payments].sort((a,b)=>{
     const pd=String(b.period||"").localeCompare(String(a.period||""),"mk");
     if(pd!==0)return pd;
     return String(a.partner_name||"").localeCompare(String(b.partner_name||""),"mk");
   });
   app.innerHTML=`<div class="container public-overview"><div class="card"><div class="top"><div><h1>ИСПЛАТИ — СИТЕ ПАРТНЕРИ</h1><p class="muted">Историја и моментална состојба на сите исплати</p></div><div class="overview-actions"><button id="printOverview" class="secondary">ПЕЧАТИ</button><button id="shareOverview" class="secondary">СПОДЕЛИ</button></div></div><div class="overview-summary"><div><span>ВКУПНО</span><b>${money(total)}</b></div><div><span>ПОТВРДЕНО</span><b class="success">${money(confirmed)}</b></div><div><span>ЗА ИСПЛАТА</span><b class="pending">${money(remaining)}</b></div></div></div><div class="card"><div class="overview-table-wrap"><table class="overview-table"><thead><tr><th>Партнер</th><th>Период</th><th>Износ</th><th>Состојба</th><th>Потврдено</th><th>Примил</th></tr></thead><tbody>${sorted.map(x=>`<tr><td><b>${esc(x.partner_name)}</b></td><td>${esc(x.period)}</td><td class="num"><b>${money(x.amount)}</b></td><td>${x.confirmed_at?`<span class="success">✓ ПОТВРДЕНО</span>`:`<span class="pending">НЕ Е ПОТВРДЕНО</span>`}</td><td>${x.confirmed_at?dt(x.confirmed_at):"—"}</td><td>${x.recipient_name?esc(x.recipient_name):"—"}</td></tr>`).join("")||`<tr><td colspan="6">Нема исплати.</td></tr>`}</tbody></table></div></div></div>`;
   q("#printOverview").onclick=()=>window.print();
   q("#shareOverview").onclick=async()=>{
     if(navigator.share){try{await navigator.share({title:"Исплати — сите партнери",text:location.href})}catch(e){}}
     else{try{await navigator.clipboard.writeText(location.href);alert("Линкот е копиран.")}catch{alert("Линк: "+location.href)}}
   };
 };
 render();
 setInterval(async()=>{const {data}=await sb.rpc("get_public_payment_overview",{p_token:token});if(data){payments=data;render()}},10000);
}

async function partnerPage(token){
 const {data:rows,error}=await sb.rpc("get_partner_by_token",{p_token:token});
 const p=rows?.[0];
 if(error||!p){app.innerHTML=`<div class="container"><div class="card"><h2>Партнерот не е пронајден.</h2></div></div>`;return}
 await renderPartner(p);
}
async function renderPartner(p){
 stopAdminPolling();
 const {data:payments,error}=await sb.rpc("get_partner_payments",{p_token:p.token});
 if(error){app.innerHTML=`<div class="container"><div class="card">${esc(error.message)}</div></div>`;return}
 const pending=payments.filter(x=>!x.confirmed_at),done=payments.filter(x=>x.confirmed_at);
 app.innerHTML=`<div class="container"><div class="card center"><h1>ПОТВРДА ЗА ИСПЛАТА</h1><h2>${esc(p.name)}</h2></div>
 <div class="card partner-pending-card"><h2>ИСПЛАТИ</h2><div class="list pending-payments">${pending.map(x=>`<div class="item payment-card"><div><b>${esc(x.period)}</b><div class="amount">${money(x.amount)}</div></div></div>`).join("")||"<p class='muted'>Нема исплати за потврда.</p>"}</div>${pending.length?`<div class="pending-total">${money(pending.reduce((s,x)=>s+Number(x.amount||0),0))}</div><button id="confirmAll" class="confirm-big">ПОТВРДИ</button>`:""}</div>
 <div class="card"><h2>ПРИМЕНИ ИСПЛАТИ</h2><div class="list">${done.map(x=>`<div class="item"><div><b>✓ ${esc(x.period)}</b><div>${money(x.amount)}</div><div class="muted">Примено: ${dt(x.confirmed_at)}${x.recipient_name?` — ${esc(x.recipient_name)}`:""}</div></div></div>`).join("")||"<p class='muted'>Сè уште нема потврдени исплати.</p>"}</div></div></div>`;
 q("#confirmAll")?.addEventListener("click",async()=>{
   const recipient=prompt("Име и презиме на лицето што ги прими исплатите:");
   if(!recipient?.trim())return;
   const {error}=await sb.rpc("confirm_all_payments",{p_token:p.token,p_recipient:recipient.trim()});
   if(error)alert(error.message);else renderPartner(p);
 });
}
const params=new URLSearchParams(location.search);
const token=params.get("partner");
const overviewToken=params.get("overview");
const adminPartner=params.get("admin_partner");
if(overviewToken)publicOverview(overviewToken);
else if(token)partnerPage(token);
else if(adminPartner){
  sb.from("partners").select("*").eq("id",adminPartner).maybeSingle().then(({data:p})=>p?partnerAdmin(p,periodLabel(currentPeriod().m,currentPeriod().y)):admin());
}else admin();
