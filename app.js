const STORAGE_KEY="workday.salary.tracker.v1";
const state=loadState();
let view=new Date();
view.setDate(1);

function loadState(){
  const fallback={name:"Employee",rate:500,records:{},theme:"light"};
  try{return {...fallback,...JSON.parse(localStorage.getItem(STORAGE_KEY)||"{}")};}catch{return fallback}
}
function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state))}
const $=s=>document.querySelector(s);
const money=n=>new Intl.NumberFormat("en-PH",{style:"currency",currency:"PHP",maximumFractionDigits:0}).format(n);
const monthName=d=>d.toLocaleDateString("en-US",{month:"long",year:"numeric"});
const keyFor=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
const today=new Date();

function render(){
  const key=keyFor(view), days=state.records[key]||[];
  const title=monthName(view);
  $("#heroName").textContent=state.name;
  $("#profileName").textContent=state.name;
  $("#monthLabel").textContent=title;
  $("#calendarTitle").textContent=title;
  $("#profileMonth").textContent=title;
  $("#dailyRate").textContent=money(state.rate);
  $("#profileRate").textContent=money(state.rate);
  $("#daysWorked").textContent=days.length;
  $("#daysCaption").textContent=days.length===1?"day this month":"days this month";
  $("#salaryEarned").textContent=money(days.length*state.rate);
  $("#salaryFormula").textContent=`${days.length} ${days.length===1?"day":"days"} × ${money(state.rate)}`;
  $("#markedSummary").textContent=days.length?`${days.length} workday${days.length===1?"":"s"} marked for ${title}`:"No workdays marked yet";
  renderCalendar(days);
  renderHistory();
  const total=new Date(view.getFullYear(),view.getMonth()+1,0).getDate();
  const pct=Math.round(days.length/total*100);
  $("#progressText").textContent=pct+"%";
  $("#progressBar").style.width=pct+"%";
}
function renderCalendar(days){
  const cal=$("#calendar");cal.innerHTML="";
  const y=view.getFullYear(),m=view.getMonth();
  const first=new Date(y,m,1).getDay(), total=new Date(y,m+1,0).getDate();
  for(let i=0;i<first;i++){const b=document.createElement("div");b.className="day blank";cal.appendChild(b)}
  for(let d=1;d<=total;d++){
    const btn=document.createElement("button");btn.className="day";btn.textContent=d;
    if(days.includes(d))btn.classList.add("worked");
    if(d===today.getDate()&&m===today.getMonth()&&y===today.getFullYear())btn.classList.add("today");
    btn.setAttribute("aria-label",`${monthName(view)} ${d}${days.includes(d)?", worked":""}`);
    btn.onclick=()=>toggleDay(d);cal.appendChild(btn)
  }
}
function toggleDay(day){
  const key=keyFor(view),arr=[...(state.records[key]||[])],i=arr.indexOf(day);
  if(i>=0)arr.splice(i,1);else arr.push(day);
  arr.sort((a,b)=>a-b);state.records[key]=arr;save();render();toast(i>=0?"Workday removed":"Workday marked");
}
function renderHistory(){
  const list=$("#historyList");list.innerHTML="";
  const entries=Object.entries(state.records).filter(([,days])=>days.length).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,6);
  if(!entries.length){list.innerHTML='<div class="empty-history">Your completed months will appear here automatically as you mark workdays.</div>';return}
  entries.forEach(([key,days])=>{
    const [y,m]=key.split("-").map(Number),d=new Date(y,m-1,1);
    const item=document.createElement("div");item.className="history-item";
    item.innerHTML=`<strong>${monthName(d)}</strong><span>${days.length} workday${days.length===1?"":"s"}</span><div class="money">${money(days.length*state.rate)}</div>`;
    list.appendChild(item)
  })
}
function toast(msg){const t=$("#toast");t.textContent=msg;t.classList.add("show");clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>t.classList.remove("show"),1700)}
function openSettings(){$("#nameInput").value=state.name;$("#rateInput").value=state.rate;$("#settingsDialog").showModal()}
$("#settingsBtn").onclick=$("#editProfileBtn").onclick=openSettings;
$("#saveSettingsBtn").onclick=e=>{e.preventDefault();const name=$("#nameInput").value.trim(),rate=Number($("#rateInput").value);if(!name||rate<0)return;state.name=name;state.rate=rate;save();$("#settingsDialog").close();render();toast("Settings saved")};
$("#prevMonth").onclick=()=>{view.setMonth(view.getMonth()-1);render()};
$("#nextMonth").onclick=()=>{view.setMonth(view.getMonth()+1);render()};
$("#todayBtn").onclick=()=>{view=new Date();view.setDate(1);render()};
$("#monthLabel").onclick=()=>{view=new Date();view.setDate(1);render()};
$("#clearMonthBtn").onclick=()=>{$("#confirmMonth").textContent=monthName(view);$("#confirmDialog").showModal()};
$("#confirmClearBtn").onclick=e=>{e.preventDefault();state.records[keyFor(view)]=[];save();$("#confirmDialog").close();render();toast("Month cleared")};
$("#exportBtn").onclick=()=>window.print();
$("#themeBtn").onclick=()=>{state.theme=state.theme==="dark"?"light":"dark";save();applyTheme();toast(`${state.theme==="dark"?"Dark":"Light"} mode`)};
function applyTheme(){document.body.classList.toggle("dark",state.theme==="dark")}
applyTheme();render();