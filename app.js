const STORAGE_KEY="workday.salary.tracker.v1";
const EMPLOYEE_COLORS=["#1f7a4d","#3b82f6","#8b5cf6","#f59e0b","#ef4444","#06b6d4","#ec4899","#84cc16"];
const state=loadState();
let view=new Date();
let editingLinkIndex=null;
view.setDate(1);

function loadState(){
  const base={theme:"light",links:[],employees:[],attendance:{},activeEmployeeId:null};
  try{
    const raw=JSON.parse(localStorage.getItem(STORAGE_KEY)||"{}");
    const next={...base,...raw};
    if(!Array.isArray(next.links))next.links=[];
    if(!Array.isArray(next.employees)||!next.employees.length){
      const id="emp-1";
      next.employees=[{id,name:raw.name||"Employee",rate:Number(raw.rate??500),color:EMPLOYEE_COLORS[0]}];
      next.activeEmployeeId=id;
      next.attendance={};
      Object.entries(raw.records||{}).forEach(([month,days])=>{
        next.attendance[month]={};
        (Array.isArray(days)?days:[]).forEach(day=>{next.attendance[month][String(day)]=[id]});
      });
    }
    next.employees=next.employees.map((e,i)=>({id:e.id||`emp-${Date.now()}-${i}`,name:e.name||`Employee ${i+1}`,rate:Number(e.rate??500),color:e.color||EMPLOYEE_COLORS[i%EMPLOYEE_COLORS.length]}));
    if(!next.activeEmployeeId||!next.employees.some(e=>e.id===next.activeEmployeeId))next.activeEmployeeId=next.employees[0].id;
    if(!next.attendance||typeof next.attendance!=="object")next.attendance={};
    return next;
  }catch{
    return {...base,employees:[{id:"emp-1",name:"Employee",rate:500,color:EMPLOYEE_COLORS[0]}],activeEmployeeId:"emp-1"};
  }
}
function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state))}
const $=s=>document.querySelector(s);
const money=n=>new Intl.NumberFormat("en-PH",{style:"currency",currency:"PHP",maximumFractionDigits:0}).format(n);
const monthName=d=>d.toLocaleDateString("en-US",{month:"long",year:"numeric"});
const keyFor=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
const today=new Date();
const activeEmployee=()=>state.employees.find(e=>e.id===state.activeEmployeeId)||state.employees[0];
const initials=name=>String(name||"?").trim().split(/\s+/).slice(0,2).map(p=>p[0]?.toUpperCase()||"").join("")||"?";

function employeeDaysForMonth(monthKey,employeeId){
  const month=state.attendance[monthKey]||{};
  return Object.entries(month).filter(([,ids])=>Array.isArray(ids)&&ids.includes(employeeId)).map(([day])=>Number(day)).sort((a,b)=>a-b);
}
function render(){
  const emp=activeEmployee();if(!emp)return;
  const key=keyFor(view),days=employeeDaysForMonth(key,emp.id),title=monthName(view);
  $("#heroName").textContent=emp.name;$("#profileName").textContent=emp.name;$("#monthLabel").textContent=title;$("#calendarTitle").textContent=title;$("#profileMonth").textContent=title;
  $("#dailyRate").textContent=money(emp.rate);$("#profileRate").textContent=money(emp.rate);$("#daysWorked").textContent=days.length;$("#daysCaption").textContent=days.length===1?"day this month":"days this month";
  $("#salaryEarned").textContent=money(days.length*emp.rate);$("#salaryFormula").textContent=`${days.length} ${days.length===1?"day":"days"} × ${money(emp.rate)}`;
  $("#markedSummary").textContent=days.length?`${emp.name}: ${days.length} workday${days.length===1?"":"s"} marked for ${title}`:`No workdays marked for ${emp.name}`;
  document.documentElement.style.setProperty("--active-employee",emp.color);
  renderEmployees();renderCalendar();renderHistory();renderLinks();
  const total=new Date(view.getFullYear(),view.getMonth()+1,0).getDate(),pct=Math.round(days.length/total*100);
  $("#progressText").textContent=pct+"%";$("#progressBar").style.width=pct+"%";$("#progressBar").style.background=emp.color;
}
function renderEmployees(){
  const wrap=$("#employeeChips");wrap.innerHTML="";
  state.employees.forEach(emp=>{
    const btn=document.createElement("button");btn.type="button";btn.className="employee-chip"+(emp.id===state.activeEmployeeId?" active":"");btn.style.setProperty("--employee-color",emp.color);
    btn.innerHTML=`<span class="employee-color-dot"></span><span class="employee-chip-name">${escapeHtml(emp.name)}</span><small>${money(emp.rate)}/day</small>`;
    btn.onclick=()=>{state.activeEmployeeId=emp.id;save();render()};wrap.appendChild(btn);
  });
}
function renderCalendar(){
  const cal=$("#calendar");cal.innerHTML="";
  const y=view.getFullYear(),m=view.getMonth(),monthKey=keyFor(view),monthAttendance=state.attendance[monthKey]||{},first=new Date(y,m,1).getDay(),total=new Date(y,m+1,0).getDate();
  for(let i=0;i<first;i++){const b=document.createElement("div");b.className="day blank";cal.appendChild(b)}
  for(let d=1;d<=total;d++){
    const ids=Array.isArray(monthAttendance[String(d)])?monthAttendance[String(d)]:[];
    const btn=document.createElement("button");btn.className="day";if(ids.includes(state.activeEmployeeId))btn.classList.add("worked");if(d===today.getDate()&&m===today.getMonth()&&y===today.getFullYear())btn.classList.add("today");
    const number=document.createElement("span");number.className="day-number";number.textContent=d;btn.appendChild(number);
    if(ids.length){const badges=document.createElement("span");badges.className="day-employees";ids.forEach(id=>{const emp=state.employees.find(e=>e.id===id);if(!emp)return;const badge=document.createElement("span");badge.className="day-employee-badge";badge.style.background=emp.color;badge.title=emp.name;badge.textContent=initials(emp.name);badges.appendChild(badge)});btn.appendChild(badges)}
    btn.onclick=()=>toggleDay(d);cal.appendChild(btn);
  }
}
function toggleDay(day){
  const emp=activeEmployee(),key=keyFor(view),dayKey=String(day);state.attendance[key]=state.attendance[key]||{};
  const ids=Array.isArray(state.attendance[key][dayKey])?[...state.attendance[key][dayKey]]:[],i=ids.indexOf(emp.id);
  if(i>=0)ids.splice(i,1);else ids.push(emp.id);if(ids.length)state.attendance[key][dayKey]=ids;else delete state.attendance[key][dayKey];save();render();toast(i>=0?`${emp.name} removed from ${day}`:`${emp.name} marked on ${day}`);
}
function renderHistory(){
  const list=$("#historyList"),emp=activeEmployee();list.innerHTML="";
  const entries=Object.keys(state.attendance).sort((a,b)=>b.localeCompare(a)).map(key=>[key,employeeDaysForMonth(key,emp.id)]).filter(([,days])=>days.length).slice(0,6);
  if(!entries.length){list.innerHTML=`<div class="empty-history">${escapeHtml(emp.name)}'s completed months will appear here as workdays are marked.</div>`;return}
  entries.forEach(([key,days])=>{const [y,m]=key.split("-").map(Number),d=new Date(y,m-1,1),item=document.createElement("div");item.className="history-item";item.innerHTML=`<strong>${monthName(d)}</strong><span>${days.length} workday${days.length===1?"":"s"}</span><div class="money">${money(days.length*emp.rate)}</div>`;list.appendChild(item)});
}
function faviconFor(url){try{return `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(new URL(url).origin)}`}catch{return ""}}
function createLogo(link,sizeClass=""){
  const box=document.createElement("span");box.className=`link-logo ${sizeClass}`.trim();const placeholder=document.createElement("span");placeholder.className="link-logo-placeholder";placeholder.textContent=initials(link.name).slice(0,1);box.appendChild(placeholder);
  const src=(link.logo||"").trim()||faviconFor(link.url);if(src){const img=document.createElement("img");img.alt="";img.loading="lazy";img.src=src;img.onload=()=>placeholder.hidden=true;img.onerror=()=>{img.remove();placeholder.hidden=false};box.appendChild(img)}return box;
}
function renderLinks(){
  const quick=$("#quickLinks"),list=$("#savedLinksList");quick.innerHTML="";list.innerHTML="";
  if(!state.links.length){quick.innerHTML='<div class="empty-links">No shortcuts yet. Add your first link.</div>';list.innerHTML='<div class="empty-links">No saved links yet.</div>';return}
  state.links.forEach((link,index)=>{
    const a=document.createElement("a");a.className="quick-link";a.href=link.url;a.target="_blank";a.rel="noopener noreferrer";a.appendChild(createLogo(link));const label=document.createElement("span");label.className="quick-link-label";label.textContent=link.name;a.appendChild(label);quick.appendChild(a);
    const item=document.createElement("div");item.className="saved-link-item";const left=document.createElement("div");left.className="saved-link-with-logo";left.appendChild(createLogo(link,"small-logo"));const main=document.createElement("div");main.className="saved-link-main";main.innerHTML=`<strong>${escapeHtml(link.name)}</strong><span>${escapeHtml(link.url)}</span>`;left.appendChild(main);
    const actions=document.createElement("div");actions.className="saved-link-actions";actions.innerHTML=`<button class="icon-button small edit-link-btn" data-index="${index}" aria-label="Edit ${escapeAttr(link.name)}">✎</button><a class="icon-button small" href="${escapeAttr(link.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeAttr(link.name)}">↗</a><button class="icon-button small danger-link" data-index="${index}" aria-label="Delete ${escapeAttr(link.name)}">×</button>`;item.append(left,actions);list.appendChild(item);
  });
  list.querySelectorAll(".edit-link-btn").forEach(btn=>btn.onclick=()=>startEditLink(Number(btn.dataset.index)));
  list.querySelectorAll(".danger-link").forEach(btn=>btn.onclick=()=>deleteLink(Number(btn.dataset.index)));
}
function escapeHtml(value){return String(value).replace(/[&<>\"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]))}
function escapeAttr(value){return escapeHtml(value).replace(/'/g,"&#39;")}
function normalizeUrl(url){const trimmed=url.trim();return /^https?:\/\//i.test(trimmed)?trimmed:`https://${trimmed}`}
function startEditLink(index){
  const link=state.links[index];if(!link)return;editingLinkIndex=index;$("#linkNameInput").value=link.name;$("#linkUrlInput").value=link.url;$("#linkLogoInput").value=link.logo||"";$("#linkFormTitle").textContent="Edit shortcut";$("#saveLinkBtn").textContent="Update link";$("#cancelLinkEditBtn").hidden=false;$("#linkNameInput").focus();
}
function cancelLinkEdit(){editingLinkIndex=null;$("#linkForm").reset();$("#linkFormTitle").textContent="New shortcut";$("#saveLinkBtn").textContent="Save link";$("#cancelLinkEditBtn").hidden=true}
function deleteLink(index){
  const link=state.links[index];if(!link)return;if(!confirm(`Delete "${link.name}"? This cannot be undone.`))return;state.links.splice(index,1);if(editingLinkIndex===index)cancelLinkEdit();else if(editingLinkIndex!==null&&editingLinkIndex>index)editingLinkIndex--;save();renderLinks();toast("Link deleted");
}
function showLinksPage(){$("#homePage").hidden=true;$("#linksPage").hidden=false;window.scrollTo({top:0,behavior:"smooth"})}
function showHomePage(){$("#linksPage").hidden=true;$("#homePage").hidden=false;window.scrollTo({top:0,behavior:"smooth"})}
function toast(msg){const t=$("#toast");t.textContent=msg;t.classList.add("show");clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>t.classList.remove("show"),1700)}
function openSettings(){const emp=activeEmployee();$("#nameInput").value=emp.name;$("#rateInput").value=emp.rate;$("#editEmployeeColorInput").value=emp.color;$("#settingsDialog").showModal()}
function openEmployeeDialog(){const nextColor=EMPLOYEE_COLORS[state.employees.length%EMPLOYEE_COLORS.length];$("#employeeForm").reset();$("#employeeRateInput").value="500";$("#employeeColorInput").value=nextColor;$("#employeeDialog").showModal()}
function closeDialog(id){const dialog=$(id);if(dialog?.open)dialog.close()}
function deleteActiveEmployee(){
  const emp=activeEmployee();if(!emp)return;if(state.employees.length===1){alert("You must keep at least one employee.");return}
  if(!confirm(`Delete ${emp.name}? All attendance records for this employee will also be removed. This cannot be undone.`))return;
  state.employees=state.employees.filter(e=>e.id!==emp.id);Object.values(state.attendance).forEach(month=>Object.keys(month).forEach(day=>{month[day]=(month[day]||[]).filter(id=>id!==emp.id);if(!month[day].length)delete month[day]}));state.activeEmployeeId=state.employees[0].id;save();closeDialog("#settingsDialog");render();toast("Employee deleted");
}

$("#settingsBtn").onclick=$("#editProfileBtn").onclick=openSettings;
$("#settingsForm").onsubmit=e=>{e.preventDefault();const emp=activeEmployee(),name=$("#nameInput").value.trim(),rate=Number($("#rateInput").value),color=$("#editEmployeeColorInput").value;if(!name||!Number.isFinite(rate)||rate<0){alert("Enter a valid employee name and salary rate.");return}if(!confirm(`Save changes to ${emp.name}?`))return;emp.name=name;emp.rate=rate;emp.color=color;save();closeDialog("#settingsDialog");render();toast("Employee updated")};
$("#deleteEmployeeBtn").onclick=deleteActiveEmployee;
$("#closeSettingsBtn").onclick=$("#cancelSettingsBtn").onclick=()=>closeDialog("#settingsDialog");
$("#addEmployeeBtn").onclick=openEmployeeDialog;
$("#employeeForm").onsubmit=e=>{e.preventDefault();const name=$("#employeeNameInput").value.trim(),rate=Number($("#employeeRateInput").value),color=$("#employeeColorInput").value;if(!name||!Number.isFinite(rate)||rate<0){alert("Enter a valid employee name and salary rate.");return}const emp={id:`emp-${Date.now()}`,name,rate,color};state.employees.push(emp);state.activeEmployeeId=emp.id;save();closeDialog("#employeeDialog");render();toast(`${name} added`)};
$("#closeEmployeeBtn").onclick=$("#cancelEmployeeBtn").onclick=()=>closeDialog("#employeeDialog");
$("#prevMonth").onclick=()=>{view.setMonth(view.getMonth()-1);render()};$("#nextMonth").onclick=()=>{view.setMonth(view.getMonth()+1);render()};$("#todayBtn").onclick=()=>{view=new Date();view.setDate(1);render()};$("#monthLabel").onclick=()=>{view=new Date();view.setDate(1);render()};
$("#clearMonthBtn").onclick=()=>{const emp=activeEmployee();$("#confirmMonth").textContent=`${emp.name}'s attendance in ${monthName(view)}`;$("#confirmDialog").showModal()};
$("#cancelClearBtn").onclick=()=>closeDialog("#confirmDialog");
$("#confirmClearBtn").onclick=()=>{const emp=activeEmployee(),key=keyFor(view),month=state.attendance[key]||{};Object.keys(month).forEach(day=>{month[day]=(month[day]||[]).filter(id=>id!==emp.id);if(!month[day].length)delete month[day]});save();closeDialog("#confirmDialog");render();toast(`${emp.name}'s month cleared`)};
$("#exportBtn").onclick=()=>window.print();$("#themeBtn").onclick=()=>{state.theme=state.theme==="dark"?"light":"dark";save();applyTheme();toast(`${state.theme==="dark"?"Dark":"Light"} mode`)};$("#linksBtn").onclick=$("#manageLinksBtn").onclick=showLinksPage;$("#backHomeBtn").onclick=showHomePage;
$("#cancelLinkEditBtn").onclick=cancelLinkEdit;
$("#linkForm").onsubmit=e=>{e.preventDefault();const name=$("#linkNameInput").value.trim(),url=$("#linkUrlInput").value.trim(),logo=$("#linkLogoInput").value.trim();if(!name||!url){alert("Enter a link name and website URL.");return}const entry={name,url:normalizeUrl(url),logo};if(editingLinkIndex===null){state.links.push(entry);save();renderLinks();cancelLinkEdit();toast("Link saved")}else{const old=state.links[editingLinkIndex];if(!confirm(`Save changes to "${old.name}"?`))return;state.links[editingLinkIndex]=entry;save();renderLinks();cancelLinkEdit();toast("Link updated")}};
function applyTheme(){document.body.classList.toggle("dark",state.theme==="dark")}
applyTheme();render();