javascript

/* ═══════════ CONFIG ═══════════ */
const SCRIPT_URL='https://script.google.com/macros/s/AKfycbzVg_S_d8Z8XyTjuF7ri5v9K9swAczaiF_CvruvJC-14fSC1IzEikF4O2YqWR4fR3XR/exec';
const SK_ROLE='r2u_role',SK_USER='r2u_user',SK_TIME='r2u_time',SESSION_TTL=12*60*60*1000;

/* ═══════════ STATE ═══════════ */
let staff={name:'',initials:'',role:'Staff',email:''};
let students=[],casData=[],csvData=[];
let activeStudentId=null,activeCASId=null;
let fbStudent=null,fbManual=false,fbPerf='Excellent';
let emailStudent=null,emailHistory=[];
let notifyStudentId=null;
let currentView='students';
let pillFilterStudents={type:'',value:''};
let totalRecords=0,currentPage=1;
let detailStudentId=null;
let stageEdits={};

/* ═══════════ PIPELINE STAGES ═══════════ */
const STAGE_DEFS=[
  {id:'app_submitted',label:'Application submitted',key:'APPLICATION SUBMITTED DATE',done:s=>!!(s['APPLICATION SUBMITTED DATE']),prevDone:s=>true,type:'date',desc:'Record the date the application was submitted to the university.'},
  {id:'prescreening',label:'Pre-screening call',key:'PRE-SCREENING CALL STATUS',done:s=>/received|no connectivity|on hold|scheduled|withdrew|interested/i.test(s['PRE-SCREENING CALL STATUS']||''),prevDone:s=>!!(s['APPLICATION SUBMITTED DATE']),type:'select',options:[{val:'Received',icon:'📥'},{val:'No Connectivity',icon:'📵'},{val:'On Hold',icon:'⏸️'},{val:'Scheduled',icon:'📅'},{val:'Withdrew',icon:'🚫'},{val:'Called – Interested',icon:'👍'},{val:'Called – Not Interested',icon:'👎'}],desc:'Log the outcome of the initial pre-screening call with the student.'},
  {id:'offer',label:'Offer received',key:'OFFER STATUS',done:s=>/conditional|unconditional|received/i.test(s['OFFER STATUS']||''),prevDone:s=>!!(s['PRE-SCREENING CALL STATUS']),type:'select',options:[{val:'Conditional',icon:'📋'},{val:'Unconditional',icon:'🎉'},{val:'Received',icon:'✅'},{val:'Pending',icon:'⏳'},{val:'Rejected',icon:'❌'}],desc:'Update the offer status from the university.'},
  {id:'cas_payment',label:'Payment for CAS Shield',key:'CAS PAYMENT STATUS',done:s=>s['CAS PAYMENT STATUS']==='Paid',prevDone:s=>/conditional|unconditional|received/i.test(s['OFFER STATUS']||''),type:'select',options:[{val:'Paid',icon:'💳'},{val:'Unpaid',icon:'⏳'}],desc:'Confirm payment has been received for CAS Shield processing.'},
  {id:'mock',label:'Mock interview',key:'MOCK INTERVIEW STATUS',done:s=>s['MOCK INTERVIEW STATUS']==='Stage 4 Done',prevDone:s=>s['CAS PAYMENT STATUS']==='Paid',type:'mock_stages',desc:'Track progress through all 4 mock interview preparation stages.'},
  {id:'precas',label:'Pre-CAS interview',key:'PRE-CAS INTERVIEW',done:s=>s['PRE-CAS INTERVIEW']==='Pass',prevDone:s=>s['MOCK INTERVIEW STATUS']==='Stage 4 Done',type:'select',options:[{val:'Pass',icon:'✅'},{val:'Fail',icon:'❌'}],desc:'Record the result of the Pre-CAS interview. Pass required to proceed.'},
  {id:'cas_requested',label:'CAS requested',key:'CAS REQUESTED STATUS',done:s=>s['CAS REQUESTED STATUS']==='Requested',prevDone:s=>s['PRE-CAS INTERVIEW']==='Pass',type:'select',options:[{val:'Requested',icon:'📨'},{val:'Not Requested',icon:'⭕'}],desc:'Confirm that the CAS has been formally requested from the university.'},
  {id:'cas_received',label:'CAS received',key:'CAS STATUS',done:s=>/issued/i.test(s['CAS STATUS']||''),prevDone:s=>s['CAS REQUESTED STATUS']==='Requested',type:'select',options:[{val:'Issued',icon:'✅'},{val:'Pending',icon:'⏳'},{val:'Rejected',icon:'❌'}],desc:'Update when the CAS document has been issued by the university.'},
  {id:'visa',label:'Visa status',key:'VISA STATUS',done:s=>/approved/i.test(s['VISA STATUS']||''),prevDone:s=>/issued/i.test(s['CAS STATUS']||''),type:'select',options:[{val:'Approved',icon:'🎉'},{val:'Submitted',icon:'📤'},{val:'Biometrics Booked',icon:'🖐️'},{val:'Pending',icon:'⏳'},{val:'Refused',icon:'❌'},{val:'Withdrawn',icon:'🚫'}],desc:'Track the student\'s visa application status.'},
];
const MOCK_STAGES=['Stage 1 Done','Stage 2 Done','Stage 3 Done','Stage 4 Done'];
const stageList=s=>STAGE_DEFS.map(sd=>({label:sd.label,done:!!sd.done(s)}));
const stageCurrent=s=>{const l=stageList(s);const i=l.findIndex(x=>!x.done);return i===-1?l.length:i};
const stageDoneCount=s=>STAGE_DEFS.filter(sd=>sd.done(s)).length;

/* ═══════════ SIDEBAR GROUP TOGGLE ═══════════ */
function toggleGroup(id){
  const g=document.getElementById(id);
  const body=g.querySelector('.sb-group-body');
  const collapsed=g.classList.toggle('collapsed');
  if(collapsed)body.style.maxHeight='0';
  else body.style.maxHeight=body.scrollHeight+'px';
}

/* ═══════════ BOOT ═══════════ */
document.addEventListener('DOMContentLoaded',()=>{
  document.getElementById('fb-date').value=today();
  document.getElementById('drw-fb-date').value=today();
  const role=localStorage.getItem(SK_ROLE);
  const t=parseInt(localStorage.getItem(SK_TIME)||'0',10);
  if(role&&Date.now()-t<=SESSION_TTL){bootSession(localStorage.getItem(SK_USER)||'Staff',role)}
  document.addEventListener('click',e=>{
    if(!e.target.closest('.lookup-wrap'))closeLookups();
    if(!e.target.closest('#row-menu')&&!e.target.closest('.kebab-trigger'))document.getElementById('row-menu').classList.remove('show');
  });
  document.getElementById('login-username').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin()});
  document.getElementById('login-password').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin()});
  document.addEventListener('keydown',e=>{
    if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();openCmd();return}
    if(e.key==='Escape'&&document.getElementById('cmd-overlay').classList.contains('open')){closeCmd();return}
  });
  document.getElementById('cmd-input').addEventListener('keydown',e=>{if(e.key==='Enter'){const a=document.querySelector('.cmd-item.cmd-sel');if(a)a.click()}});
  document.getElementById('cmd-overlay').addEventListener('click',e=>{if(e.target.id==='cmd-overlay')closeCmd()});
  document.querySelectorAll('.sb-group-body').forEach(b=>{b.style.maxHeight=b.scrollHeight+'px'});
});
const today=()=>new Date().toISOString().split('T')[0];

function bootSession(name,role){
  const ini=name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  staff={name,initials:ini,role};
  document.getElementById('sb-avatar').textContent=ini;
  document.getElementById('sb-name').textContent=name;
  document.getElementById('sb-role').textContent=role;
  document.getElementById('hdr-avatar').textContent=ini.slice(0,1);
  document.getElementById('page-subtitle').textContent='Welcome back, '+name.split(' ')[0]+'!';
  applyRole(role);hideLogin();loadDashboardLazy();
}

/* ═══════════ AUTH ═══════════ */
async function sha256(s){const d=new TextEncoder().encode(s);const b=await crypto.subtle.digest('SHA-256',d);return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('')}
async function doLogin(){
  const u=document.getElementById('login-username').value.trim(),p=document.getElementById('login-password').value.trim();
  const errEl=document.getElementById('login-error');errEl.style.display='none';
  if(!u||!p){errEl.textContent=!u?'Enter your username':'Enter your password';errEl.style.display='block';return}
  const btn=document.getElementById('login-btn');btn.disabled=true;document.getElementById('login-btn-text').textContent='Signing in…';document.getElementById('login-spinner').style.display='';
  try{
    const hash=await sha256(p);
    const url=new URL(SCRIPT_URL);url.searchParams.set('action','login');url.searchParams.set('username',u);url.searchParams.set('passwordHash',hash);
    const res=await fetch(url.toString());const data=await res.json();
    if(data.success){localStorage.setItem(SK_ROLE,data.role);localStorage.setItem(SK_USER,data.name);localStorage.setItem(SK_TIME,String(Date.now()));bootSession(data.name,data.role)}
    else{errEl.textContent=data.error||'Invalid credentials';errEl.style.display='block';document.getElementById('login-password').value=''}
  }catch(e){errEl.textContent='Cannot reach server: '+e.message;errEl.style.display='block'}
  finally{btn.disabled=false;document.getElementById('login-btn-text').textContent='Sign in';document.getElementById('login-spinner').style.display='none'}
}
function togglePwd(){const i=document.getElementById('login-password'),ic=document.getElementById('eye-icon');const s=i.type==='password';i.type=s?'text':'password';ic.innerHTML=s?'<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.44 18.44 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>':'<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'}
function hideLogin(){const el=document.getElementById('login-screen');el.classList.add('hidden');setTimeout(()=>el.style.display='none',280)}
function signOut(){['r2u_role','r2u_user','r2u_time'].forEach(k=>localStorage.removeItem(k));location.reload()}
function applyRole(role){const isAdmin=role==='Admin';document.querySelectorAll('.admin-only').forEach(el=>el.style.display=isAdmin?'':'none');if(!isAdmin){const el=document.getElementById('upload-zone-wrap');if(el)el.innerHTML='<div class="access-denied"><div style="font-size:32px;margin-bottom:10px">🔒</div><div style="font-weight:600;color:var(--text-tertiary);font-size:13px;margin-bottom:5px">Access restricted</div><div style="font-size:12px">CSV import is for Admin users only</div></div>'}}

/* ═══════════ CMD PALETTE ═══════════ */
function openCmd(){document.getElementById('cmd-overlay').classList.add('open');setTimeout(()=>document.getElementById('cmd-input').focus(),80)}
function closeCmd(){document.getElementById('cmd-overlay').classList.remove('open');document.getElementById('cmd-input').value='';resetCmd()}
function cmdNav(view){closeCmd();const tab=document.querySelector(`.sb-link[data-view="${view}"]`);if(tab)switchView(view,tab);else switchView(view,null)}
function resetCmd(){document.getElementById('cmd-results').innerHTML=`<div class="cmd-section">Quick actions</div><div class="cmd-item" onclick="cmdNav('students')"><div class="cmd-item-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></div><div><div class="cmd-item-name">Students</div><div class="cmd-item-meta">All enrolled students</div></div></div><div class="cmd-item" onclick="cmdNav('partners')"><div class="cmd-item-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg></div><div><div class="cmd-item-name">Channel Partners</div><div class="cmd-item-meta">Agents and referral network</div></div></div><div class="cmd-item" onclick="cmdNav('reports')"><div class="cmd-item-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="20" x2="4" y2="11"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="20" y1="20" x2="20" y2="15"/></svg></div><div><div class="cmd-item-name">Reports</div><div class="cmd-item-meta">Pipeline analytics</div></div></div>`}
function cmdSearch(q){if(!q.trim()||q.length<2){resetCmd();return}const m=students.filter(s=>(s['STUDENT NAME']||'').toLowerCase().includes(q.toLowerCase())||(s['STUDENT ID']||'').toLowerCase().includes(q.toLowerCase())).slice(0,8);if(!m.length){document.getElementById('cmd-results').innerHTML='<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:12px">No students found</div>';return}document.getElementById('cmd-results').innerHTML='<div class="cmd-section">Students</div>'+m.map(s=>`<div class="cmd-item" onclick="closeCmd();openDetail('${esc(s['STUDENT ID']||'')}')"><div class="cmd-item-icon" style="background:${avatarBg(s['STUDENT NAME'])};color:#FFF;font-size:10px;font-weight:700">${initials(s['STUDENT NAME'])}</div><div><div class="cmd-item-name">${s['STUDENT NAME']||'—'}</div><div class="cmd-item-meta">${s['STUDENT ID']||''} · ${s['COURSE']||''}</div></div></div>`).join('')}

/* ═══════════ VIEW SWITCHING ═══════════ */
const PAGE_META={
  students:['Students','All enrolled students in the pipeline'],
  partners:['Channel Partners','Referral agents and partner agencies'],
  followup:['Daily Follow-Up',"Today's pending calls and tasks"],
  casshield:['CAS Shield','Pre-CAS readiness checks'],
  feedback:['Mock Pre-CAS','Interview feedback builder'],
  email:['Direct Email','Send messages to students and agents'],
  reports:['Reports','Pipeline breakdowns and insights'],
  upload:['Import CSV','Upload new student records'],
  'student-detail':['Student','Manage profile and pipeline'],
  universities:['Partner Universities','Sep 2026 intake — courses, entry criteria & fees']
};
function switchView(id,tab){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.sb-link').forEach(t=>t.classList.remove('active'));
  const el=document.getElementById('view-'+id);
  if(el)el.classList.add('active');
  if(tab)tab.classList.add('active');
  currentView=id;
  const meta=PAGE_META[id]||[id,''];
  document.getElementById('page-title').textContent=meta[0];
  document.getElementById('page-subtitle').textContent=
    (id==='students'||id==='student-detail')&&staff.name?'Welcome back, '+staff.name.split(' ')[0]+'!':meta[1];
  if(id==='reports')loadReports();
  if(id==='casshield')loadCAS();
  if(id==='followup')renderFollowup();
  if(id==='partners')renderPartners();
  if(id==='students'){filterTableStudents();updateStats();updateFunnel();renderDashboardPartners();}
}
function goHome(){switchView('students',document.querySelector('.sb-link[data-view="students"]'))}
function refreshView(){
  if(currentView==='students')loadStudents();
  else if(currentView==='casshield')loadCAS();
  else if(currentView==='reports')loadReports();
  else if(currentView==='followup')renderFollowup();
  else if(currentView==='partners')renderPartners();
  else toast('Nothing to refresh here','info');
}

/* ═══════════ API ═══════════ */
async function apiGet(action,params={}){const url=new URL(SCRIPT_URL);url.searchParams.set('action',action);Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));return(await fetch(url.toString())).json()}
async function apiPost(action,body={}){return(await fetch(SCRIPT_URL,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({action,...body})})).json()}

/* ═══════════ STUDENTS LOAD ═══════════ */
async function loadStudents(){
  currentPage=1;totalRecords=0;students=[];
  const btn=document.getElementById('load-more-btn');if(btn)btn.remove();
  loading('Fetching students…');
  try{const data=await apiGet('getStudents',{page:currentPage,limit:100});if(!data.success)throw new Error(data.error);students=data.students||[];totalRecords=data.totalRecords??students.length;currentPage=data.page??1}
  catch(e){console.warn('Using mock data:',e.message);students=getMock();totalRecords=students.length}
  finally{filterTableStudents();updateStats();updateFunnel();renderDashboardPartners();hideLoading();toast('Loaded '+students.length+' students','success')}
}

/* ═══════════ STATS & FUNNEL ═══════════ */
function updateStats(){
  const total=Math.max(totalRecords,students.length);
  const cas=students.filter(s=>/pending/i.test(s['CAS STATUS']||'')).length;
  const visa=students.filter(s=>/approved/i.test(s['VISA STATUS']||'')).length;
  const refused=students.filter(s=>/refused/i.test(s['VISA STATUS']||'')).length;
  const set=(id,val)=>{const e=document.getElementById(id);if(e)e.textContent=val};
  set('stat-total',total);set('stat-cas',cas);set('stat-visa',visa);set('stat-refused',refused);
  document.getElementById('pipeline-total-label').textContent=total+' students total';
}
function updateFunnel(){
  const total=students.length||1;
  const groups=[{label:'Applied & called',si:1},{label:'Conditional offer',si:2},{label:'Offer received',si:3},{label:'CAS payment',si:4},{label:'Mock done',si:5},{label:'Pre-CAS cleared',si:6},{label:'CAS requested',si:7},{label:'CAS received',si:8}];
  const max=groups.reduce((a,g)=>{const c=students.filter(s=>STAGE_DEFS[g.si]?.done(s)).length;return Math.max(a,c)},1);
  const grid=document.getElementById('pipeline-funnel');if(!grid)return;
  grid.innerHTML=groups.map(g=>{const c=students.filter(s=>STAGE_DEFS[g.si]?.done(s)).length;const w=Math.round(c/max*100);return`<div class="funnel-item"><div class="funnel-label">${g.label}</div><div class="funnel-bar-track"><div class="funnel-bar-fill" style="width:${w}%"></div></div><div class="funnel-count">${c}</div></div>`}).join('');
  const C=2*Math.PI*34;
  const cnts=[students.filter(s=>STAGE_DEFS[1].done(s)).length,students.filter(s=>STAGE_DEFS[2].done(s)).length,students.filter(s=>STAGE_DEFS[4].done(s)).length,students.filter(s=>STAGE_DEFS[7].done(s)).length,students.filter(s=>STAGE_DEFS[8].done(s)).length];
  const ids=['d-applied','d-cond','d-mock','d-cas','d-visa'],lids=['l-applied','l-cond','l-mock','l-cas','l-visa'];
  let offset=0;
  cnts.forEach((c,i)=>{const el=document.getElementById(ids[i]);if(!el)return;const seg=Math.round(c/total*C);el.setAttribute('stroke-dasharray',`${seg} ${C-seg}`);el.setAttribute('stroke-dashoffset',String(C-offset));offset+=seg;const le=document.getElementById(lids[i]);if(le)le.textContent=c});
  const cn=document.getElementById('d-center');if(cn)cn.textContent=students.length;
}

/* ═══════════ TABLE ═══════════ */
const AVATAR_COLORS=['#162338','#1D4ED8','#059669','#7C3AED','#B07712','#DC2626','#0EA5E9','#047857','#5B21B6','#C8871A'];
function avatarBg(n){if(!n)return'#374151';let h=0;for(let i=0;i<n.length;i++)h=(h*31+n.charCodeAt(i))%AVATAR_COLORS.length;return AVATAR_COLORS[Math.abs(h)]}
function initials(n){if(!n)return'?';return n.trim().split(/\s+/).map(w=>w[0]).join('').toUpperCase().slice(0,2)}
function esc(s){return(s||'').replace(/'/g,"\\'")}
function lvlBadge(l){const m={PG:'badge-blue',PHD:'badge-violet',UG:'badge-green'};return l?`<span class="badge ${m[l]||'badge-slate'}" style="font-size:9px">${l}</span>`:''}
function visaBadge(v){if(!v||v==='Not Applied')return`<span class="badge badge-slate">${v||'—'}</span>`;if(/approved/i.test(v))return`<span class="badge badge-green">${v}</span>`;if(/refused/i.test(v))return`<span class="badge badge-red">${v}</span>`;if(/pending|submitted|biometrics/i.test(v))return`<span class="badge badge-amber">${v}</span>`;return`<span class="badge badge-navy">${v}</span>`}

function buildRow(s){
  const sid=s['STUDENT ID']||'',safeId=esc(sid);
  const bg=avatarBg(s['STUDENT NAME']);const ini=initials(s['STUDENT NAME']);
  const list=stageList(s);const done=list.filter(x=>x.done).length;const cur=stageCurrent(s);
  const dots=list.map((st,i)=>`${i>0?`<span class="pl-connector${list[i-1].done?' done':''}"></span>`:''}${`<span class="pl-dot${st.done?' done':(i===cur?' cur':'')}" title="${st.label}"></span>`}`).join('');
  const partner=s['AGENT']||s['CHANNEL PARTNER']||'—';
  return`<tr>
    <td>${sid}</td>
    <td><div class="student-cell"><div class="s-avatar" style="background:${bg}">${ini}</div><div><div class="s-name">${s['STUDENT NAME']||'—'} ${lvlBadge(s['LEVEL'])}</div><div class="s-meta">${partner!=='—'?partner:''}</div></div></div></td>
    <td><span style="font-size:11.5px;color:var(--text-tertiary);max-width:150px;overflow:hidden;text-overflow:ellipsis;display:block;white-space:nowrap" title="${s['COURSE']||''}">${s['COURSE']||'—'}</span></td>
    <td><div class="agent-cell"><span class="a-dot" style="background:${avatarBg(partner)}"></span><span class="a-name">${partner}</span></div></td>
    <td><div class="pl-cell">${dots}<span class="pl-score">${done}/9</span></div></td>
    <td>${visaBadge(s['VISA STATUS'])}</td>
    <td style="text-align:right"><div class="row-actions">
      <button class="row-btn" onclick="openDetail('${safeId}')" title="Open profile"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
      <button class="row-btn" onclick="openStageDrawer('${safeId}')" title="Update pipeline"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg></button>
      <button class="kebab-trigger row-btn" onclick="openRowMenu(event,'${safeId}')" title="More"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/></svg></button>
    </div></td>
  </tr>`;
}

function setPillFilterStudents(type,value,btn){pillFilterStudents={type,value};btn.closest('.seg-tabs').querySelectorAll('.seg-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');filterTableStudents()}
function filterTableStudents(){
  const qEl=document.getElementById('students-search-input');
  const q=(qEl&&qEl.value||'').toLowerCase();
  const filtered=students.filter(s=>{
    if(q&&!['STUDENT NAME','STUDENT ID','COURSE','AGENT'].some(f=>(s[f]||'').toLowerCase().includes(q)))return false;
    const pf=pillFilterStudents;
    if(pf.type==='visa'&&s['VISA STATUS']!==pf.value)return false;
    if(pf.type==='offer'&&s['OFFER STATUS']!==pf.value)return false;
    if(pf.type==='cas'&&s['CAS STATUS']!==pf.value)return false;
    return true;
  });
  const tb=document.getElementById('students-page-table-body');
  if(tb){tb.innerHTML=filtered.length?filtered.map(buildRow).join(''):'<tr><td colspan="7" class="empty-state">No students match current filters</td></tr>'}
  const c=document.getElementById('students-tbl-count');if(c)c.textContent=`${filtered.length} of ${students.length}`;
}

/* ═══════════ ROW MENU ═══════════ */
function openRowMenu(e,sid){
  e.stopPropagation();activeStudentId=sid;
  const menu=document.getElementById('row-menu');
  menu.innerHTML=`
    <div class="pop-item" onclick="hideMenu();openDetail('${sid}')">Open profile</div>
    <div class="pop-divider"></div>
    <div class="pop-item" onclick="hideMenu();openStageDrawer('${sid}')">Update pipeline</div>
    <div class="pop-divider"></div>
    <div class="pop-item" onclick="hideMenu();openNotify('${sid}')">Send notification</div>
    <div class="pop-item" onclick="hideMenu();openFeedbackDrawer('${sid}')">Mock feedback</div>`;
  const r=e.currentTarget.getBoundingClientRect();let left=r.left,top=r.bottom+4;
  if(left+200>window.innerWidth)left=window.innerWidth-206;
  menu.style.top=top+'px';menu.style.left=Math.max(8,left)+'px';menu.classList.add('show');
}
function hideMenu(){document.getElementById('row-menu').classList.remove('show')}

/* ═══════════ STAGE PIPELINE DRAWER ═══════════ */
function openStageDrawer(sid){
  const s=students.find(s=>s['STUDENT ID']===sid);if(!s){toast('Student not found','error');return}
  activeStudentId=sid;stageEdits={};
  document.getElementById('drw-stage-sub').textContent=(s['STUDENT NAME']||sid)+' · '+sid;
  renderStagePipeline(s);openDrawer('drw-stage');
}
function renderStagePipeline(s){
  const wrap=document.getElementById('stage-pipeline-content');wrap.innerHTML='';
  STAGE_DEFS.forEach((sd,i)=>{
    const isDone=!!sd.done(s);const isPrevDone=!!sd.prevDone(s);
    const isCurrent=!isDone&&isPrevDone;const isLocked=!isDone&&!isPrevDone;const curVal=s[sd.key]||'';
    const step=document.createElement('div');
    step.className='stage-step'+(isDone?' completed':isCurrent?' current':isLocked?' locked':'');
    let nodeInner='';
    if(isDone)nodeInner='<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    else if(isCurrent)nodeInner=`<span style="font-size:9px;font-weight:700;color:#FFF">${i+1}</span>`;
    else nodeInner=`<span style="font-size:9px;color:var(--text-disabled)">${i+1}</span>`;
    let contentHTML=`<div class="stage-title">${sd.label}</div>`;
    if(isDone&&curVal)contentHTML+=`<div class="stage-current-val">✓ ${curVal}</div>`;
    if(!isDone&&!isLocked&&curVal)contentHTML+=`<div class="stage-current-val">${curVal}</div>`;
    if(isLocked){contentHTML+=`<div class="stage-locked-msg">Complete "${STAGE_DEFS[i-1]?.label||'previous stage'}" first to unlock this stage.</div>`}
    else{
      if(sd.type==='date'){contentHTML+=`<div style="margin-top:6px"><input type="date" class="form-control" style="max-width:180px" value="${curVal}" onchange="stageEdits[${i}]={key:'${sd.key}',val:this.value}"></div>`}
      else if(sd.type==='select'){
        contentHTML+=`<div class="stage-options">`;
        sd.options.forEach(opt=>{const isSel=curVal===opt.val;contentHTML+=`<div class="stage-opt${isSel?' selected':''}" onclick="pickStageOpt(this,${i},'${esc(sd.key)}','${esc(opt.val)}')"><span class="stage-opt-icon">${opt.icon}</span>${opt.val}</div>`});
        contentHTML+=`</div>`;
      }else if(sd.type==='mock_stages'){
        const curLevel=MOCK_STAGES.indexOf(curVal);
        contentHTML+=`<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">${sd.desc}</div><div class="stage-options">`;
        MOCK_STAGES.forEach((ms,mi)=>{const isSel=curVal===ms;const mockUnlocked=mi===0||curLevel>=mi-1;contentHTML+=`<div class="stage-opt${isSel?' selected':''}${!mockUnlocked?' locked-row':''}" onclick="pickMockStage(this,${i},'${esc(ms)}',${mi},${curLevel})" style="${!mockUnlocked?'opacity:.4;pointer-events:none':''}"><span class="stage-opt-icon">${isSel||curLevel>=mi?'✅':'⭕'}</span>Mock ${ms}</div>`});
        contentHTML+=`</div>`;
      }
      if(sd.type!=='date')contentHTML+=`<div class="stage-notes" style="margin-top:8px"><label>Notes (optional)</label><textarea placeholder="Add notes…" id="stage-note-${i}" style="min-height:40px"></textarea></div>`;
    }
    step.innerHTML=`<div class="stage-node">${nodeInner}</div><div class="stage-content">${contentHTML}</div>`;
    wrap.appendChild(step);
  });
}
function pickStageOpt(el,idx,key,val){el.closest('.stage-options').querySelectorAll('.stage-opt').forEach(o=>o.classList.remove('selected'));el.classList.add('selected');stageEdits[idx]={key,val}}
function pickMockStage(el,idx,val){stageEdits[idx]={key:'MOCK INTERVIEW STATUS',val};const s=students.find(s=>s['STUDENT ID']===activeStudentId);if(s)renderStagePipeline({...s,'MOCK INTERVIEW STATUS':val})}
async function saveStages(){
  if(typeof saveStagesOptimized==='function'){saveStagesOptimized();return}
  if(!Object.keys(stageEdits).length){closeDrawer('drw-stage');return}
  const s=students.find(s=>s['STUDENT ID']===activeStudentId);if(!s)return;
  const txt=document.getElementById('stage-save-txt'),spin=document.getElementById('stage-save-spin');
  txt.textContent='Saving…';spin.style.display='';
  const patch={};Object.values(stageEdits).forEach(e=>{if(e.val)patch[e.key]=e.val});
  Object.assign(s,patch);filterTableStudents();updateStats();updateFunnel();renderDashboardPartners();
  if(currentView==='student-detail'&&detailStudentId===activeStudentId)openDetail(activeStudentId);
  try{const res=await apiPost('updateStudentProfile',{studentId:activeStudentId,updatedBy:staff.name,...patch});if(!res.success)throw new Error(res.error||'Save error');toast('Pipeline updated','success')}
  catch(e){toast('Saved locally, sync may have failed: '+e.message,'info')}
  finally{txt.textContent='Save changes';spin.style.display='none';closeDrawer('drw-stage');stageEdits={}}
}

/* ═══════════ STUDENT DETAIL ═══════════ */
function openDetail(sid){
  const s=students.find(s=>s['STUDENT ID']===sid);if(!s){toast('Student not found: '+sid,'error');return}
  detailStudentId=sid;
  document.getElementById('detail-breadcrumb-name').textContent=s['STUDENT NAME']||sid;
  document.getElementById('detail-name').textContent=s['STUDENT NAME']||'Unknown Student';
  document.getElementById('detail-id').textContent=sid;
  document.getElementById('detail-level').textContent=s['LEVEL']||'';
  document.getElementById('detail-course').textContent=s['COURSE']||'';
  const bg=avatarBg(s['STUDENT NAME']),ini=initials(s['STUDENT NAME']);
  const av=document.getElementById('detail-avatar');av.style.background=bg;av.textContent=ini;
  const ro=(id,val)=>{const el=document.getElementById(id);if(el)el.textContent=val||'—'};
  ro('dp-sid',s['STUDENT ID']);ro('dp-level',s['LEVEL']);ro('dp-sname',s['STUDENT NAME']);ro('dp-course',s['COURSE']);ro('dp-dob',s['DOB']);ro('dp-agent',s['AGENT']||s['CHANNEL PARTNER']);ro('dp-mobile-ro',s['MOBILE']);ro('dp-email-ro',s['EMAIL']);
  const list=stageList(s);const done=list.filter(x=>x.done).length;
  document.getElementById('dp-pipeline-score').textContent=done+'/'+STAGE_DEFS.length;
  document.getElementById('dp-pipeline-list').innerHTML=list.map((st,i)=>{
    const sd=STAGE_DEFS[i];const locked=!sd.prevDone(s)&&!st.done;
    return`<div class="stage-row${locked?' locked-row':''}"><div class="stage-left"><span class="stage-num">${i+1}</span><div class="stage-check ${st.done?'done':''}">${st.done?`<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#FFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`:''}</div><span class="stage-name">${st.label}</span></div><span class="badge ${st.done?'badge-green':locked?'badge-slate':'badge-amber'}" style="font-size:9px">${st.done?'Done':locked?'Locked':'Pending'}</span></div>`;
  }).join('');
  document.getElementById('dp-stage-summary').innerHTML=STAGE_DEFS.map(sd=>{
    const val=s[sd.key]||'—';const isDone=sd.done(s);const isLocked=!sd.prevDone(s)&&!isDone;
    return`<div style="padding:10px 12px;border:1px solid var(--border-subtle);border-radius:var(--r-md);background:${isDone?'var(--emerald-50)':isLocked?'var(--surface-inset)':'var(--amber-50)'}">
      <div style="font-size:9.5px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px">${sd.label}</div>
      <div style="font-size:12px;font-weight:600;color:${isDone?'var(--emerald-700)':isLocked?'var(--text-disabled)':'var(--amber-700)'}">${isLocked?'Locked':val}</div>
    </div>`;
  }).join('');
  switchView('student-detail',null);
}
function backToDashboard(){switchView('students',document.querySelector('.sb-link[data-view="students"]'))}
function openNotifyFromDetail(){openNotify(detailStudentId)}
function openFeedbackFromDetail(){openFeedbackDrawer(detailStudentId)}

/* ═══════════ CHANNEL PARTNERS ═══════════ */
function buildPartnerData(){
  const m={};
  students.forEach(s=>{const n=s['AGENT']||s['CHANNEL PARTNER']||'Unknown';if(!m[n])m[n]={name:n,students:[],offers:0,visaApproved:0};m[n].students.push(s);if(/conditional|unconditional|received/i.test(s['OFFER STATUS']||''))m[n].offers++;if(/approved/i.test(s['VISA STATUS']||''))m[n].visaApproved++});
  return Object.values(m).sort((a,b)=>b.students.length-a.students.length);
}
function renderPartnerCard(p){
  const bg=avatarBg(p.name);const ini=initials(p.name);
  const convRate=p.students.length?Math.round(p.visaApproved/p.students.length*100):0;
  return`<div class="cp-card">
    <div class="cp-card-head"><div class="cp-avatar" style="background:${bg}">${ini}</div><div><div class="cp-name">${p.name}</div><div class="cp-type">Channel Partner</div></div></div>
    <div class="cp-stats">
      <div><div class="cp-stat-val">${p.students.length}</div><div class="cp-stat-label">Students</div></div>
      <div><div class="cp-stat-val">${p.offers}</div><div class="cp-stat-label">Offers</div></div>
      <div><div class="cp-stat-val" style="color:${convRate>50?'var(--emerald-700)':'var(--amber-700)'}">${convRate}%</div><div class="cp-stat-label">Visa rate</div></div>
    </div>
  </div>`;
}
function renderDashboardPartners(){const partners=buildPartnerData().slice(0,6);const grid=document.getElementById('dashboard-cp-grid');if(!grid)return;grid.innerHTML=partners.length?partners.map(renderPartnerCard).join(''):'<div class="empty-state" style="grid-column:1/-1">No partner data yet</div>'}
function renderPartners(){const partners=buildPartnerData();const grid=document.getElementById('full-cp-grid');if(!grid)return;grid.innerHTML=partners.length?partners.map(renderPartnerCard).join(''):'<div class="empty-state" style="grid-column:1/-1">No partners found</div>'}
function openAddPartner(){toast('Add partner form coming soon','info')}
function openAddStudent(){toast('Add student form coming soon','info')}

/* ═══════════ DRAWERS ═══════════ */
function openDrawer(id){document.getElementById(id).classList.add('open');document.getElementById('drawer-overlay').classList.add('show')}
function closeDrawer(id){document.getElementById(id).classList.remove('open');const open=document.querySelectorAll('.drawer.open');if(!open.length)document.getElementById('drawer-overlay').classList.remove('show')}
function closeAllDrawers(){document.querySelectorAll('.drawer.open').forEach(d=>closeDrawer(d.id))}
function subLabel(sid){const s=students.find(s=>s['STUDENT ID']===sid);return(s?s['STUDENT NAME']||sid:sid)+' · '+sid}

/* ═══════════ NOTIFICATIONS ═══════════ */
function openNotify(sid){const s=students.find(s=>s['STUDENT ID']===sid);if(!s){toast('Student not found','error');return}notifyStudentId=sid;document.getElementById('drw-notify-sub').textContent=subLabel(sid);document.getElementById('notify-role').value='Student';document.getElementById('notify-type').value='Email';document.getElementById('notify-subject').value='';document.getElementById('notify-message').value='';notifyPreviewRecip();openDrawer('drw-notify')}
function notifyPreviewRecip(){const s=students.find(s=>s['STUDENT ID']===notifyStudentId);if(!s)return;const role=document.getElementById('notify-role').value;const email=role==='Student'?(s['EMAIL']||'').trim():role==='Agent'?(s['AGENT EMAIL']||'').trim():(staff.email||'').trim();const label=role==='Student'?s['STUDENT NAME']:role==='Agent'?s['AGENT']||'Channel Partner':staff.name;document.getElementById('notify-recip-text').textContent=email?`Will send to: ${label} — ${email}`:`No email on file for ${label||'this recipient'}`}
async function sendNotification(){const subject=document.getElementById('notify-subject').value.trim(),message=document.getElementById('notify-message').value.trim(),type=document.getElementById('notify-type').value;if(!subject||!message){toast('Subject and message required','error');return}const btn=document.getElementById('notify-send-btn');btn.disabled=true;try{const r=await apiPost('sendNotification',{studentId:notifyStudentId,subject,message,notifyType:type,sentBy:staff.name});if(!r.success)throw new Error(r.error);toast('Notification sent','success');closeDrawer('drw-notify')}catch(e){toast('Failed: '+e.message,'error')}finally{btn.disabled=false}}

/* ═══════════ FEEDBACK DRAWER ═══════════ */
function openFeedbackDrawer(sid){activeStudentId=sid;document.getElementById('drw-fb-sub').textContent=subLabel(sid);document.getElementById('drw-fb-date').value=today();document.getElementById('drw-fb-text').value='';document.getElementById('drw-fb-recs').value='';openDrawer('drw-feedback')}
async function submitFeedbackDrawer(){const text=document.getElementById('drw-fb-text').value.trim();if(!text){toast('Write feedback first','error');return}loading('Generating…');closeDrawer('drw-feedback');try{const res=await apiPost('generateFeedbackDoc',{studentId:activeStudentId,date:document.getElementById('drw-fb-date').value,performance:document.getElementById('drw-fb-perf').value,feedback:text,recommendations:document.getElementById('drw-fb-recs').value,staffName:staff.name});if(!res.success)throw new Error(res.error);toast('Feedback doc created','success')}catch(e){toast('Failed: '+e.message,'error')}finally{hideLoading()}}

/* ═══════════ FOLLOW-UP ═══════════ */
function renderFollowup(){
  const c=document.getElementById('followup-content');
  if(!students.length){c.innerHTML='<div class="empty-state">Load students from the Students tab first</div>';return}
  const urgent=students.filter(s=>!/(called|scheduled|received|connectivity|hold)/i.test(s['PRE-SCREENING CALL STATUS']||'')&&stageDoneCount(s)<STAGE_DEFS.length);
  const sched=students.filter(s=>/scheduled/i.test(s['PRE-SCREENING CALL STATUS']||''));
  const mkTable=list=>{if(!list.length)return'<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:12px">Nothing here — great work!</div>';
    return`<table class="dt"><thead><tr><th>Student</th><th>Channel Partner</th><th>Stage</th><th>Call status</th><th style="text-align:right">Actions</th></tr></thead><tbody>${list.map(s=>{const sid=esc(s['STUDENT ID']||'');const bg=avatarBg(s['STUDENT NAME']);const ini=initials(s['STUDENT NAME']);const stageIdx=stageCurrent(s);const stage=STAGE_DEFS[stageIdx]?.label||'Complete';const cs=s['PRE-SCREENING CALL STATUS']||'Not Called';return`<tr><td><div class="student-cell"><div class="s-avatar" style="background:${bg};width:26px;height:26px;font-size:9px">${ini}</div><div><div class="s-name">${s['STUDENT NAME']||'—'}</div><div class="s-meta">${s['STUDENT ID']||''}</div></div></div></td><td><span class="a-name" style="max-width:none">${s['AGENT']||'—'}</span></td><td style="font-size:11px;color:var(--text-muted)">${stage}</td><td>${visaBadge(cs)}</td><td style="text-align:right"><div style="display:flex;gap:4px;justify-content:flex-end"><button class="btn btn-secondary btn-sm" onclick="openStageDrawer('${sid}')">Update</button><button class="btn btn-primary btn-sm" onclick="openDetail('${sid}')">View</button></div></td></tr>`}).join('')}</tbody></table>`;};
  c.innerHTML=`<div class="fu-group"><div class="fu-group-header"><span style="width:8px;height:8px;border-radius:50%;background:var(--crimson-500);display:inline-block"></span><span class="fu-group-title">Urgent — not yet called</span><span class="badge badge-red" style="margin-left:4px">${urgent.length}</span></div>${mkTable(urgent)}</div><div class="fu-group"><div class="fu-group-header"><span style="width:8px;height:8px;border-radius:50%;background:var(--amber-500);display:inline-block"></span><span class="fu-group-title">Scheduled</span><span class="badge badge-amber" style="margin-left:4px">${sched.length}</span></div>${mkTable(sched)}</div>`;
}

/* ═══════════ CAS SHIELD ═══════════ */
async function loadCAS(){loading('Fetching CAS Shield…');try{const data=await apiGet('getCASShield');if(!data.success)throw new Error(data.error);casData=data.records||[]}catch{casData=getMockCAS()}finally{renderCAS(casData);hideLoading();toast('CAS Shield loaded','success')}}
function renderCAS(recs){const tb=document.getElementById('cas-table-body');if(!recs.length){tb.innerHTML='<tr><td colspan="13" class="empty-state">No records</td></tr>';return}const yn=(v,warn)=>{if(!v)return'<span class="cas-yn-no">—</span>';const lv=v.toLowerCase().trim();if(lv==='yes'||lv==='y')return warn?`<span class="cas-yn-warn">Yes</span>`:`<span class="cas-yn-yes">Yes</span>`;if(lv==='no'||lv==='n')return'<span class="cas-yn-no">No</span>';return`<span style="font-size:11px">${v}</span>`};tb.innerHTML=recs.map(r=>{const aid=esc(r['Applicant ID']||'');return`<tr><td>${r['Applicant ID']||''}</td><td style="font-weight:600;font-size:12px">${r['Applicant Name']||''}</td><td><span class="a-name" style="max-width:none">${r['Agent (Name)']||''}</span></td><td style="font-size:11px;color:var(--text-muted)">${r['Nationality']||''}</td><td style="font-size:11px;color:var(--text-muted);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r['Course Name']||''}</td><td>${yn(r['Study Gap Y/N'])}</td><td>${yn(r['Same Level Studies Y/N'])}</td><td>${yn(r['Visa Refusal Y/N'],true)}</td><td>${yn(r['Ready for PCI'])}</td><td>${yn(r['Information check on CAS Shield completed? Y/N'])}</td><td>${yn(r['Pre-CAS questionnaire on CAS shield Completed? Y/N'])}</td><td style="font-size:11px;color:var(--text-muted)">${r['PCI Invite']||'—'}</td><td style="text-align:right"><button class="btn btn-secondary btn-sm" onclick="openCASUpdate('${aid}')">Update</button></td></tr>`}).join('')}
function filterCAS(){const q=(document.getElementById('cas-search').value||'').toLowerCase();const pci=document.getElementById('cas-filter-pci').value;const visa=document.getElementById('cas-filter-visa').value;renderCAS(casData.filter(r=>(!q||[r['Applicant Name'],r['Applicant ID'],r['Agent (Name)']].some(f=>(f||'').toLowerCase().includes(q)))&&(!pci||(r['Ready for PCI']||'')===pci)&&(!visa||(r['Visa Refusal Y/N']||'')===visa)))}
function openCASUpdate(aid){const r=casData.find(r=>r['Applicant ID']===aid);if(!r)return;activeCASId=aid;document.getElementById('drw-casupd-sub').textContent=(r['Applicant Name']||'')+' · '+aid;document.getElementById('cup-pci').value=r['Ready for PCI']||'No';document.getElementById('cup-visa-r').value=r['Visa Refusal Y/N']||'No';document.getElementById('cup-info').value=r['Information check on CAS Shield completed? Y/N']||'No';document.getElementById('cup-precas').value=r['Pre-CAS questionnaire on CAS shield Completed? Y/N']||'No';document.getElementById('cup-gap').value=r['Study Gap Y/N']||'No';document.getElementById('cup-same').value=r['Same Level Studies Y/N']||'No';document.getElementById('cup-invite').value=r['PCI Invite']||'';document.getElementById('cup-comment').value=r['Team Comment']||'';openDrawer('drw-cas-update')}
async function submitCASUpdate(){const u={applicantId:activeCASId,'Ready for PCI':document.getElementById('cup-pci').value,'Visa Refusal Y/N':document.getElementById('cup-visa-r').value,'Information check on CAS Shield completed? Y/N':document.getElementById('cup-info').value,'Pre-CAS questionnaire on CAS shield Completed? Y/N':document.getElementById('cup-precas').value,'Study Gap Y/N':document.getElementById('cup-gap').value,'Same Level Studies Y/N':document.getElementById('cup-same').value,'PCI Invite':document.getElementById('cup-invite').value,'Team Comment':document.getElementById('cup-comment').value,updatedBy:staff.name};try{loading('Saving…');const res=await apiPost('updateCASShield',u);if(!res.success)throw new Error(res.error);const r=casData.find(r=>r['Applicant ID']===activeCASId);if(r)Object.assign(r,u);filterCAS();closeDrawer('drw-cas-update');toast('CAS record updated','success')}catch(e){toast('Failed: '+e.message,'error')}finally{hideLoading()}}

/* ═══════════ FEEDBACK TOOL ═══════════ */
function fbSearch(q){const el=document.getElementById('fb-lookup');if(!q||q.length<2){el.classList.remove('open');return}const m=students.filter(s=>(s['STUDENT NAME']||'').toLowerCase().includes(q.toLowerCase())||(s['STUDENT ID']||'').toLowerCase().includes(q.toLowerCase())).slice(0,8);el.innerHTML=m.length?m.map(s=>`<div class="lookup-item" onclick="fbSelect('${esc(s['STUDENT ID']||'')}')"><div class="lookup-item-name">${s['STUDENT NAME']||'—'}</div><div class="lookup-item-sub">${s['STUDENT ID']||''} · ${s['COURSE']||''}</div></div>`).join(''):'<div style="padding:12px;color:var(--text-muted);font-size:12px;text-align:center">No students found</div>';el.classList.add('open')}
function fbSelect(id){const s=students.find(s=>s['STUDENT ID']===id);if(!s)return;fbStudent=s;document.getElementById('fb-sel-name').textContent=s['STUDENT NAME']||id;document.getElementById('fb-sel-sub').textContent=`${s['STUDENT ID']} · ${s['LEVEL']||''} · ${s['COURSE']||''} · ${s['AGENT']||'No partner'}`;document.getElementById('fb-sel').classList.add('show');document.getElementById('fb-search').value='';document.getElementById('fb-lookup').classList.remove('open');fbPreview()}
function fbClear(){fbStudent=null;document.getElementById('fb-sel').classList.remove('show');document.getElementById('fb-search').value='';fbPreview()}
function toggleFbManual(){fbManual=!fbManual;document.getElementById('fb-manual').style.display=fbManual?'block':'none';document.getElementById('fb-manual-btn').textContent=fbManual?'✕ Hide':'+ Enter manually';if(fbManual)fbClear()}
function pickPerf(el){document.querySelectorAll('.perf-opt').forEach(o=>o.classList.remove('sel'));el.classList.add('sel');fbPerf=el.dataset.val;fbPreview()}
function getFbData(){let name,id,course,agent;if(fbManual){name=document.getElementById('fb-mname').value.trim();id=document.getElementById('fb-mid').value.trim();course='';agent=''}else if(fbStudent){name=fbStudent['STUDENT NAME']||'';id=fbStudent['STUDENT ID']||'';course=fbStudent['COURSE']||'';agent=fbStudent['AGENT']||''}else return null;return{studentName:name,studentId:id,studentCourse:course,studentAgent:agent,sessionDate:document.getElementById('fb-date').value,sessionType:document.getElementById('fb-stype').value,performance:fbPerf,feedback:document.getElementById('fb-text').value.trim(),recommendations:document.getElementById('fb-recs').value.trim(),staffName:staff.name||'Staff'}}
function buildDocHTML(d){const perfClass={'Excellent':'perf-excellent','Good':'perf-good','Satisfactory':'perf-satisfactory','Needs Improvement':'perf-needs'}[d.performance]||'perf-good';const dateStr=d.sessionDate?new Date(d.sessionDate).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}):'—';return`<div class="doc-header"><div class="doc-eyebrow">Route2Uni CRM Portal — Internal Document</div><div class="doc-title">${d.sessionType} Feedback Report</div><div class="doc-meta-grid"><div class="doc-meta-item"><div class="doc-meta-label">Student</div><div class="doc-meta-val">${d.studentName||'—'}</div></div><div class="doc-meta-item"><div class="doc-meta-label">Student ID</div><div class="doc-meta-val">${d.studentId||'—'}</div></div><div class="doc-meta-item"><div class="doc-meta-label">Date</div><div class="doc-meta-val">${dateStr}</div></div>${d.studentCourse?`<div class="doc-meta-item"><div class="doc-meta-label">Course</div><div class="doc-meta-val">${d.studentCourse}</div></div>`:''}<div class="doc-meta-item"><div class="doc-meta-label">Overall</div><div class="doc-meta-val"><span class="perf-badge ${perfClass}">${d.performance}</span></div></div></div></div><div class="doc-section"><div class="doc-section-eyebrow">Detailed Feedback</div><div class="doc-section-text">${(d.feedback||'<em style="color:var(--text-muted)">No feedback yet…</em>').replace(/\n/g,'<br>')}</div></div>${d.recommendations?`<div class="doc-section"><div class="doc-section-eyebrow">Recommendations</div><div class="doc-section-text">${d.recommendations.replace(/\n/g,'<br>')}</div></div>`:''}<div class="doc-footer"><span>Route2Uni CRM Portal</span><span>Conducted by: ${d.staffName}</span></div>`}
function fbPreview(){const d=getFbData()||{studentName:'',studentId:'',studentCourse:'',studentAgent:'',sessionDate:document.getElementById('fb-date').value,sessionType:document.getElementById('fb-stype').value,performance:fbPerf,feedback:document.getElementById('fb-text').value.trim(),recommendations:document.getElementById('fb-recs').value.trim(),staffName:staff.name||'Staff'};if(!d.studentName&&!d.feedback){document.getElementById('fb-preview').innerHTML='<div style="text-align:center;padding:36px 20px;color:var(--text-muted)"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" style="margin:0 auto 10px;display:block;opacity:.4"><rect x="6" y="3.5" width="12" height="18" rx="2"/><path d="M9 3.5h6v3H9z"/></svg><div style="font-size:12px;font-weight:500">Select a student to preview</div></div>';return}document.getElementById('fb-preview').innerHTML=buildDocHTML(d)}
async function fbDownloadPDF(){const d=getFbData();if(!d?.studentName){toast('Select a student first','error');return}if(!d.feedback){toast('Write feedback first','error');return}loading('Generating PDF…');try{const{jsPDF}=window.jspdf;const doc=new jsPDF({unit:'mm',format:'a4'});const navy=[15,28,46],gold=[200,135,26],muted=[107,114,128],light=[243,244,246];let y=0;doc.setFillColor(...navy);doc.rect(0,0,210,18,'F');doc.setFontSize(11);doc.setTextColor(...gold);doc.setFont('helvetica','bold');doc.text('R2U',14,12);doc.setTextColor(200,210,220);doc.setFontSize(8);doc.setFont('helvetica','normal');doc.text('Route2Uni CRM Portal — Internal Document',26,12);y=26;doc.setFontSize(15);doc.setTextColor(...navy);doc.setFont('helvetica','bold');doc.text(d.sessionType+' Feedback Report',14,y);y+=3;doc.setDrawColor(...navy);doc.setLineWidth(0.7);doc.line(14,y,196,y);y+=10;const mItems=[['Student',d.studentName],['Student ID',d.studentId||'—'],['Date',d.sessionDate?new Date(d.sessionDate).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}):'—'],['Course',d.studentCourse||'—'],['Channel Partner',d.studentAgent||'—'],['Performance',d.performance]];const cW=91;mItems.forEach((item,i)=>{const col=i%2,x=14+col*cW;if(col===0&&i>0)y+=14;doc.setFillColor(...light);doc.roundedRect(x,y,cW-4,11,2,2,'F');doc.setFontSize(6.5);doc.setTextColor(...muted);doc.setFont('helvetica','bold');doc.text(item[0].toUpperCase(),x+4,y+4);doc.setFontSize(9);doc.setTextColor(...navy);doc.text(String(item[1]).substring(0,38),x+4,y+9)});y+=18;doc.setFillColor(...navy);doc.rect(14,y,3,7,'F');doc.setFontSize(8.5);doc.setTextColor(...navy);doc.setFont('helvetica','bold');doc.text('DETAILED FEEDBACK',20,y+5);y+=11;doc.setFontSize(9);doc.setFont('helvetica','normal');doc.setTextColor(40,55,75);const fl=doc.splitTextToSize(d.feedback,178);doc.text(fl,14,y);y+=fl.length*5+8;if(d.recommendations){if(y>240){doc.addPage();y=20}doc.setFillColor(...navy);doc.rect(14,y,3,7,'F');doc.setFontSize(8.5);doc.setFont('helvetica','bold');doc.setTextColor(...navy);doc.text('RECOMMENDATIONS',20,y+5);y+=11;doc.setFontSize(9);doc.setFont('helvetica','normal');doc.setTextColor(40,55,75);const rl=doc.splitTextToSize(d.recommendations,178);doc.text(rl,14,y)}const fy=285;doc.setDrawColor(...muted);doc.setLineWidth(0.2);doc.line(14,fy-4,196,fy-4);doc.setFontSize(7);doc.setTextColor(...muted);doc.text('Route2Uni CRM Portal',14,fy);doc.text('Conducted by: '+d.staffName,196,fy,{align:'right'});doc.save(`R2U_Feedback_${(d.studentName||'Student').replace(/\s+/g,'_')}_${d.sessionDate||today()}.pdf`);toast('PDF downloaded','success')}catch(e){toast('PDF error: '+e.message,'error')}finally{hideLoading()}}
async function fbSave(){const d=getFbData();if(!d?.studentName){toast('Select a student first','error');return}if(!d.feedback){toast('Write feedback first','error');return}if(!d.studentId){toast('Student ID required','error');return}loading('Saving to Drive…');try{const res=await apiPost('generateFeedbackDoc',{studentId:d.studentId,date:d.sessionDate,performance:d.performance,feedback:d.feedback,recommendations:d.recommendations,staffName:d.staffName,sessionType:d.sessionType});if(!res.success)throw new Error(res.error||'Unknown error');document.getElementById('fb-success-title').textContent='Feedback saved for '+d.studentName;if(res.docUrl)document.getElementById('fb-doc-link').href=res.docUrl;document.getElementById('fb-success').classList.add('show');document.getElementById('fb-success').scrollIntoView({behavior:'smooth',block:'start'});toast('Saved to Drive','success')}catch(e){toast('Save failed: '+e.message,'error')}finally{hideLoading()}}
function resetFeedback(){fbClear();document.getElementById('fb-text').value='';document.getElementById('fb-recs').value='';document.getElementById('fb-date').value=today();document.getElementById('fb-search').value='';pickPerf(document.querySelector('.perf-opt[data-val="Excellent"]'));document.getElementById('fb-success').classList.remove('show');fbPreview();window.scrollTo({top:0,behavior:'smooth'})}

/* ═══════════ EMAIL ═══════════ */
function emailSearch(q){const el=document.getElementById('email-lookup');if(!q||q.length<2){el.classList.remove('open');return}const m=students.filter(s=>(s['STUDENT NAME']||'').toLowerCase().includes(q.toLowerCase())||(s['STUDENT ID']||'').toLowerCase().includes(q.toLowerCase())).slice(0,8);el.innerHTML=m.length?m.map(s=>`<div class="lookup-item" onclick="emailSelect('${esc(s['STUDENT ID']||'')}')"><div class="lookup-item-name">${s['STUDENT NAME']||'—'}</div><div class="lookup-item-sub">${s['STUDENT ID']||''}</div></div>`).join(''):'<div style="padding:12px;color:var(--text-muted);font-size:12px;text-align:center">No students found</div>';el.classList.add('open')}
function emailSelect(id){const s=students.find(s=>s['STUDENT ID']===id);if(!s)return;emailStudent=s;document.getElementById('email-sel-name').textContent=s['STUDENT NAME']||id;document.getElementById('email-sel-sub').textContent=`${s['STUDENT ID']} · ${s['EMAIL']||'No email on file'}`;document.getElementById('email-sel').classList.add('show');document.getElementById('email-search').value='';document.getElementById('email-lookup').classList.remove('open')}
function emailClear(){emailStudent=null;document.getElementById('email-sel').classList.remove('show');document.getElementById('email-search').value=''}
function emailClearForm(){emailClear();['email-subject','email-message'].forEach(id=>document.getElementById(id).value='')}
async function sendEmail(){const subject=document.getElementById('email-subject').value.trim(),message=document.getElementById('email-message').value.trim(),type=document.getElementById('email-type').value,role=document.getElementById('email-role').value;if(!emailStudent){toast('Select a student first','error');return}if(!subject||!message){toast('Subject and message required','error');return}let email='',label='';if(role==='Student'){email=(emailStudent['EMAIL']||'').trim();label=emailStudent['STUDENT NAME']||emailStudent['STUDENT ID']}else if(role==='Agent'){email=(emailStudent['AGENT EMAIL']||'').trim();label=emailStudent['AGENT']||'Channel Partner'}else{email=(staff.email||'').trim();label=staff.name||'Staff'}const lbl=document.getElementById('email-send-lbl');lbl.textContent='Sending…';try{if((type==='Email'||type==='Both')&&email){const res=await apiPost('sendNotification',{studentId:emailStudent['STUDENT ID'],recipientRole:role,recipientEmail:email,recipientName:label,subject,message,notifyType:type,sentBy:staff.name});if(!res.success)throw new Error(res.error||'Send failed')}emailHistory.unshift({to:label,email,subject,preview:message.slice(0,80),time:new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}),bg:avatarBg(label),ini:initials(label)});renderEmailHistory();emailClearForm();toast('Sent to '+label,'success')}catch(e){toast('Failed: '+e.message,'error')}finally{lbl.textContent='Send'}}
function renderEmailHistory(){const wrap=document.getElementById('email-history-wrap');if(!emailHistory.length){wrap.innerHTML='<div class="empty-state">No messages sent this session</div>';return}wrap.innerHTML=emailHistory.map(h=>`<div class="email-history-item"><div class="email-avatar" style="background:${h.bg}">${h.ini}</div><div style="flex:1"><div style="font-weight:600;font-size:12px;color:var(--text-primary)">${h.subject}</div><div style="font-size:10.5px;color:var(--text-muted);margin-top:2px">To: ${h.to}${h.email?' ('+h.email+')':''} · ${h.time}</div><div style="font-size:11px;color:var(--text-tertiary);margin-top:3px">${h.preview}${h.preview.length>=80?'…':''}</div></div></div>`).join('')}

/* ═══════════ REPORTS ═══════════ */
async function loadReports(){
  const total=students.length;const visaApp=students.filter(s=>/applied|pending|approved|refused|submitted|biometrics/i.test(s['VISA STATUS']||'')).length;const visaOK=students.filter(s=>/approved/i.test(s['VISA STATUS']||'')).length;const avgStage=total?Math.round(students.reduce((a,s)=>a+stageCurrent(s),0)/total):0;const partners=buildPartnerData().length;
  const se=id=>document.getElementById(id);
  if(se('rpt-total'))se('rpt-total').textContent=total;if(se('rpt-visa-rate'))se('rpt-visa-rate').textContent=visaApp?Math.round(visaOK/visaApp*100)+'%':'—';if(se('rpt-avg-stage'))se('rpt-avg-stage').textContent=avgStage+'/'+STAGE_DEFS.length;if(se('rpt-partners'))se('rpt-partners').textContent=partners;
  const grid=document.getElementById('report-grid');if(!grid)return;grid.innerHTML='';
  const report=buildLocalReport();
  const funnel=STAGE_DEFS.map(sd=>({label:sd.label,cnt:students.filter(s=>sd.done(s)).length}));const fmax=Math.max(...funnel.map(f=>f.cnt),1);
  const mkCard=(title,data)=>{const tot=Object.values(data||{}).reduce((a,b)=>a+b,0)||1;const bars=Object.entries(data||{}).map(([l,c])=>{const p=Math.round(c/tot*100);return`<div class="rpt-bar-row"><div class="rpt-bar-label">${l}</div><div class="rpt-bar-track"><div class="rpt-bar-fill" style="width:${p}%"></div></div><div class="rpt-bar-num">${c}</div></div>`}).join('');return`<div class="card" style="padding:16px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px"><div class="card-title">${title}</div><span style="font-size:10.5px;color:var(--text-muted)">${tot} total</span></div>${bars||'<div class="empty-state" style="padding:20px">No data</div>'}</div>`};
  const funnelCard=`<div class="card" style="padding:16px;grid-column:span 2"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px"><div class="card-title">Pipeline funnel</div><span style="font-size:10.5px;color:var(--text-muted)">${students.length} students</span></div>${funnel.map(f=>{const p=Math.round(f.cnt/fmax*100);return`<div class="rpt-bar-row"><div class="rpt-bar-label">${f.label}</div><div class="rpt-bar-track"><div class="rpt-bar-fill" style="width:${p}%"></div></div><div class="rpt-bar-num">${f.cnt}</div></div>`}).join('')}</div>`;
  grid.innerHTML=funnelCard+mkCard('Offer status',report.offer)+mkCard('Visa status',report.visa)+mkCard('CAS status',report.cas)+mkCard('Payment',report.payment);
}
function buildLocalReport(){const cnt=(f,v)=>students.filter(s=>s[f]===v).length;return{offer:{Pending:cnt('OFFER STATUS','Pending'),Conditional:cnt('OFFER STATUS','Conditional'),Unconditional:cnt('OFFER STATUS','Unconditional'),Received:cnt('OFFER STATUS','Received'),Rejected:cnt('OFFER STATUS','Rejected')},cas:{'Not Applied':cnt('CAS STATUS','Not Applied'),Applied:cnt('CAS STATUS','Applied'),Pending:cnt('CAS STATUS','Pending'),Issued:cnt('CAS STATUS','Issued'),Rejected:cnt('CAS STATUS','Rejected')},visa:{'Not Applied':cnt('VISA STATUS','Not Applied'),Pending:cnt('VISA STATUS','Pending'),Approved:cnt('VISA STATUS','Approved'),Refused:cnt('VISA STATUS','Refused')},payment:{Unpaid:cnt('PAYMENT','Unpaid'),'Deposit Paid':cnt('PAYMENT','Deposit Paid'),'Partially Paid':cnt('PAYMENT','Partially Paid'),Paid:cnt('PAYMENT','Paid')}}}

/* ═══════════ UPLOAD ═══════════ */
function handleFileSelect(e){parseCSV(e.target.files[0])}
function handleDrop(e){e.preventDefault();document.getElementById('drop-zone').classList.remove('drag-over');parseCSV(e.dataTransfer.files[0])}
function parseCSV(file){if(!file)return;Papa.parse(file,{header:true,skipEmptyLines:true,complete:r=>{csvData=r.data;showUploadPreview(file.name,r.data)},error:err=>toast('Parse error: '+err.message,'error')})}
function showUploadPreview(name,data){if(!data.length){toast('No data rows found','error');return}document.getElementById('preview-filename').textContent=name;document.getElementById('preview-rows').textContent=data.length+' rows';const headers=Object.keys(data[0]);document.getElementById('preview-thead').innerHTML='<tr>'+headers.map(h=>`<th>${h}</th>`).join('')+'</tr>';document.getElementById('preview-tbody').innerHTML=data.slice(0,5).map(row=>'<tr>'+headers.map(h=>`<td>${row[h]||''}</td>`).join('')+'</tr>').join('');document.getElementById('upload-preview').style.display='block'}
function clearUpload(){csvData=[];document.getElementById('csv-file').value='';document.getElementById('upload-preview').style.display='none'}
async function confirmUpload(){if(!csvData.length)return;loading('Uploading…');try{const r=await apiPost('uploadCSV',{rows:csvData});if(!r.success)throw new Error(r.error);toast(`Imported ${r.added||0} new, updated ${r.updated||0} records`,'success');clearUpload();loadStudents()}catch(e){toast('Upload failed: '+e.message,'error')}finally{hideLoading()}}

/* ═══════════ EXPORT ═══════════ */
function exportStudentsCSV(){if(!students.length){toast('No student data to export','error');return}try{const rows=students.map(s=>{const list=stageList(s);const r={'STUDENT ID':s['STUDENT ID']||'','STUDENT NAME':s['STUDENT NAME']||'','COURSE':s['COURSE']||'','CHANNEL PARTNER':s['AGENT']||'','LEVEL':s['LEVEL']||''};list.forEach(st=>{r[st.label]=st.done?'Done':'Pending'});r['PIPELINE PROGRESS']=list.filter(x=>x.done).length+'/'+STAGE_DEFS.length;return r});const csv=Papa.unparse(rows);const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='R2U_Students_'+today()+'.csv';document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);toast('CSV exported','success')}catch(e){toast('Export failed: '+e.message,'error')}}

/* ═══════════ MISC ═══════════ */
function closeLookups(){document.querySelectorAll('.lookup-results').forEach(el=>el.classList.remove('open'))}
function toast(msg,type='success'){const wrap=document.getElementById('toast-wrap');const t=document.createElement('div');t.className='toast '+type;const icon=type==='success'?'✓':type==='error'?'✕':'·';t.innerHTML=`<span style="opacity:.7">${icon}</span>${msg}`;wrap.appendChild(t);setTimeout(()=>t.remove(),4200)}
function loading(msg='Processing…'){document.getElementById('loading-msg').textContent=msg;document.getElementById('global-loading').classList.add('show')}
function hideLoading(){document.getElementById('global-loading').classList.remove('show')}

/* ═══════════ MOCK DATA ═══════════ */
function getMock(){return[{'STUDENT ID':'STU-2026-001','STUDENT NAME':'Aarav Sharma','LEVEL':'UG','COURSE':'BSc (Hons) Computer Science','AGENT':'RD Pokhara','DOB':'2002-03-15','SUBMITTED BY':'Sagar','PRE-SCREENING CALL STATUS':'Called – Interested','OFFER STATUS':'Conditional','SCHOLARSHIP':'None','PAYMENT':'Deposit Paid','CAS SHIELD':'In Progress','CAS STATUS':'Not Applied','VISA STATUS':'Not Applied','APPLICATION SUBMITTED DATE':'2026-04-10','MOBILE':'986552121','EMAIL':'hemrajhadhikari@gmail.com','MOCK INTERVIEW STATUS':'Stage 2 Done','PRE-CAS INTERVIEW':'','CAS PAYMENT STATUS':'Unpaid','CAS REQUESTED STATUS':'Not Requested'},{'STUDENT ID':'STU-2026-002','STUDENT NAME':'Priya Karki','LEVEL':'PG','COURSE':'MSc Data Science','AGENT':'Bright Future Consultancy','DOB':'1999-07-22','SUBMITTED BY':'Admin','PRE-SCREENING CALL STATUS':'Scheduled','OFFER STATUS':'Unconditional','SCHOLARSHIP':'Partial','PAYMENT':'Paid','CAS PAYMENT STATUS':'Paid','CAS SHIELD':'Completed','CAS STATUS':'Pending','VISA STATUS':'Pending','APPLICATION SUBMITTED DATE':'2026-03-01','MOCK INTERVIEW STATUS':'Stage 4 Done','PRE-CAS INTERVIEW':'Pass','CAS REQUESTED STATUS':'Requested'},{'STUDENT ID':'STU-2026-003','STUDENT NAME':'Rohan Thapa','LEVEL':'UG','COURSE':'BBA Business Management','AGENT':'ABC Education','DOB':'2003-01-08','SUBMITTED BY':'Sagar','PRE-SCREENING CALL STATUS':'Not Called','OFFER STATUS':'Pending','SCHOLARSHIP':'None','PAYMENT':'Unpaid','CAS SHIELD':'Not Started','CAS STATUS':'Not Applied','VISA STATUS':'Not Applied','APPLICATION SUBMITTED DATE':'2026-05-12'},{'STUDENT ID':'STU-2026-004','STUDENT NAME':'Anisha Rai','LEVEL':'UG','COURSE':'Engineering Foundation','AGENT':'RD Pokhara','DOB':'2002-09-30','SUBMITTED BY':'Admin','PRE-SCREENING CALL STATUS':'Received','OFFER STATUS':'Conditional','CAS PAYMENT STATUS':'Paid','PAYMENT':'Deposit Paid','CAS SHIELD':'In Progress','CAS STATUS':'Not Applied','VISA STATUS':'Not Applied','APPLICATION SUBMITTED DATE':'2026-04-20','MOCK INTERVIEW STATUS':'Stage 3 Done','PRE-CAS INTERVIEW':''},{'STUDENT ID':'STU-2026-005','STUDENT NAME':'Kiran Gurung','LEVEL':'PG','COURSE':'MBA','AGENT':'NextStep Consultancy','DOB':'1998-11-14','SUBMITTED BY':'Sagar','PRE-SCREENING CALL STATUS':'Called – Interested','OFFER STATUS':'Received','SCHOLARSHIP':'Full','PAYMENT':'Paid','CAS PAYMENT STATUS':'Paid','CAS SHIELD':'Completed','CAS STATUS':'Issued','VISA STATUS':'Approved','APPLICATION SUBMITTED DATE':'2026-02-15','MOCK INTERVIEW STATUS':'Stage 4 Done','PRE-CAS INTERVIEW':'Pass','CAS REQUESTED STATUS':'Requested'},{'STUDENT ID':'STU-2026-006','STUDENT NAME':'Bishwas Shrestha','LEVEL':'PG','COURSE':'MBA Finance','AGENT':'Bright Future Consultancy','DOB':'2000-06-05','SUBMITTED BY':'Admin','PRE-SCREENING CALL STATUS':'On Hold','OFFER STATUS':'Unconditional','CAS PAYMENT STATUS':'Paid','PAYMENT':'Partially Paid','CAS SHIELD':'In Progress','CAS STATUS':'Applied','VISA STATUS':'Submitted','APPLICATION SUBMITTED DATE':'2026-03-18','MOCK INTERVIEW STATUS':'Stage 4 Done','PRE-CAS INTERVIEW':'Pass','CAS REQUESTED STATUS':'Requested'},{'STUDENT ID':'STU-2026-007','STUDENT NAME':'Puja Sharma','LEVEL':'PG','COURSE':'MA International Relations','AGENT':'ABC Education','DOB':'2001-02-19','SUBMITTED BY':'Sagar','PRE-SCREENING CALL STATUS':'Scheduled','OFFER STATUS':'Conditional','SCHOLARSHIP':'Bursary','PAYMENT':'Deposit Paid','CAS SHIELD':'Not Started','CAS STATUS':'Not Applied','VISA STATUS':'Not Applied','APPLICATION SUBMITTED DATE':'2026-05-02'},{'STUDENT ID':'STU-2026-008','STUDENT NAME':'Nikhil Raimajhi','LEVEL':'PG','COURSE':'MCS Software Engineering','AGENT':'NextStep Consultancy','DOB':'1997-12-11','SUBMITTED BY':'Admin','PRE-SCREENING CALL STATUS':'Called – Interested','OFFER STATUS':'Received','SCHOLARSHIP':'None','PAYMENT':'Paid','CAS PAYMENT STATUS':'Paid','CAS SHIELD':'Completed','CAS STATUS':'Issued','VISA STATUS':'Approved','APPLICATION SUBMITTED DATE':'2026-01-25','MOCK INTERVIEW STATUS':'Stage 4 Done','PRE-CAS INTERVIEW':'Pass','CAS REQUESTED STATUS':'Requested'},{'STUDENT ID':'STU-2026-009','STUDENT NAME':'Sita Magar','LEVEL':'UG','COURSE':'BSc Nursing','AGENT':'RD Pokhara','DOB':'2003-08-28','SUBMITTED BY':'Sagar','PRE-SCREENING CALL STATUS':'Withdrew','OFFER STATUS':'Pending','SCHOLARSHIP':'None','PAYMENT':'Unpaid','CAS SHIELD':'Not Started','CAS STATUS':'Not Applied','VISA STATUS':'Not Applied'},{'STUDENT ID':'STU-2026-010','STUDENT NAME':'Dipesh Tamang','LEVEL':'PHD','COURSE':'PhD Biomedical Engineering','AGENT':'Bright Future Consultancy','DOB':'1995-04-03','SUBMITTED BY':'Admin','PRE-SCREENING CALL STATUS':'Called – Interested','OFFER STATUS':'Unconditional','CAS PAYMENT STATUS':'Paid','SCHOLARSHIP':'Sponsorship','PAYMENT':'Paid','CAS SHIELD':'Completed','CAS STATUS':'Issued','VISA STATUS':'Refused','APPLICATION SUBMITTED DATE':'2026-02-28','MOCK INTERVIEW STATUS':'Stage 4 Done','PRE-CAS INTERVIEW':'Pass','CAS REQUESTED STATUS':'Requested'}]}
function getMockCAS(){return[{'Applicant ID':'STU-2026-001','Applicant Name':'Aarav Sharma','Agent (Name)':'RD Pokhara','Nationality':'Nepali','Course Name':'BSc Computer Science','Study Gap Y/N':'No','Same Level Studies Y/N':'No','Visa Refusal Y/N':'No','Ready for PCI':'No','Information check on CAS Shield completed? Y/N':'Yes','Pre-CAS questionnaire on CAS shield Completed? Y/N':'No','PCI Invite':''},{'Applicant ID':'STU-2026-002','Applicant Name':'Priya Karki','Agent (Name)':'Bright Future Consultancy','Nationality':'Nepali','Course Name':'MSc Data Science','Study Gap Y/N':'Yes','Same Level Studies Y/N':'No','Visa Refusal Y/N':'No','Ready for PCI':'Yes','Information check on CAS Shield completed? Y/N':'Yes','Pre-CAS questionnaire on CAS shield Completed? Y/N':'Yes','PCI Invite':'2026-07-10'},{'Applicant ID':'STU-2026-005','Applicant Name':'Kiran Gurung','Agent (Name)':'NextStep Consultancy','Nationality':'Nepali','Course Name':'MBA','Study Gap Y/N':'No','Same Level Studies Y/N':'No','Visa Refusal Y/N':'No','Ready for PCI':'Yes','Information check on CAS Shield completed? Y/N':'Yes','Pre-CAS questionnaire on CAS shield Completed? Y/N':'Yes','PCI Invite':'2026-06-15'}]}

/* ═══════════ PERF PATCH ═══════════ */
(function(){
'use strict';
const CLIENT_CACHE_TTL_MS=10*60*1000,QUEUE_FLUSH_MIN_MS=2000,QUEUE_FLUSH_MAX_MS=5000,QUEUE_RETRY_BASE_MS=1500;
const clientCache=new Map();
function cacheKey(a,p){return a+':'+JSON.stringify(p||{})}
function getCached(a,p){const e=clientCache.get(cacheKey(a,p));if(!e)return null;if(Date.now()-e.ts>CLIENT_CACHE_TTL_MS){clientCache.delete(cacheKey(a,p));return null}return e.data}
function setCached(a,p,d){clientCache.set(cacheKey(a,p),{data:d,ts:Date.now()})}
function invalidateClientCache(pre){for(const k of clientCache.keys())if(k.indexOf(pre+':')===0)clientCache.delete(k)}
window.apiGetCached=async function(action,params={}){const c=getCached(action,params);if(c)return c;const d=await apiGet(action,params);if(d&&d.success)setCached(action,params,d);return d};
window.invalidateClientCache=invalidateClientCache;
const saveQueue=new Map();let flushTimer=null,inFlight=false,retryDelay=QUEUE_RETRY_BASE_MS;
function scheduleFlush(){if(flushTimer)return;const d=QUEUE_FLUSH_MIN_MS+Math.random()*(QUEUE_FLUSH_MAX_MS-QUEUE_FLUSH_MIN_MS);flushTimer=setTimeout(flushQueue,d)}
async function flushQueue(){flushTimer=null;if(inFlight||saveQueue.size===0)return;const updates=Array.from(saveQueue.values());inFlight=true;try{const res=await fetch(SCRIPT_URL,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({action:'batchUpdate',updates,updatedBy:staff.name||'Staff'})});const data=await res.json();if(!data.success)throw new Error(data.error||'Batch save failed');updates.forEach(u=>saveQueue.delete(u.studentId+'|'+u.field));invalidateClientCache('getStudents');retryDelay=QUEUE_RETRY_BASE_MS}catch(e){toast('Sync delayed, retrying…','info');retryDelay=Math.min(retryDelay*1.7,30000);flushTimer=setTimeout(flushQueue,retryDelay)}finally{inFlight=false;if(saveQueue.size>0&&!flushTimer)scheduleFlush()}}
window.queueFieldEdit=function(studentId,field,value){saveQueue.set(studentId+'|'+field,{studentId,field,value});const s=(window.students||[]).find(s=>s['STUDENT ID']===studentId);if(s)s[field]=value;toast('✓ Saved','success');scheduleFlush()};
window.queueBatchEdit=function(sid,map){Object.entries(map).forEach(([f,v])=>window.queueFieldEdit(sid,f,v))};
window.flushSaveQueueNow=function(){if(flushTimer){clearTimeout(flushTimer);flushTimer=null}return flushQueue()};
window.addEventListener('beforeunload',()=>{if(saveQueue.size>0)flushQueue()});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&saveQueue.size>0)flushQueue()});
window.saveStagesOptimized=function(){if(!Object.keys(window.stageEdits||{}).length){closeDrawer('drw-stage');return}const sid=window.activeStudentId;const s=(window.students||[]).find(s=>s['STUDENT ID']===sid);if(!s)return;const patch={};Object.values(window.stageEdits).forEach(e=>{if(e.val)patch[e.key]=e.val});Object.assign(s,patch);if(typeof filterTableStudents==='function')filterTableStudents();if(typeof updateStats==='function')updateStats();if(typeof updateFunnel==='function')updateFunnel();if(typeof renderDashboardPartners==='function')renderDashboardPartners();if(currentView==='student-detail'&&detailStudentId===sid&&typeof openDetail==='function')openDetail(sid);toast('✓ Saved','success');closeDrawer('drw-stage');window.queueBatchEdit(sid,patch);window.stageEdits={}};
function nextFrame(){return new Promise(r=>requestAnimationFrame(()=>r()))}
window.loadDashboardLazy=async function(){const cached=getCached('getStudents',{page:1,limit:100});if(cached){window.students=cached.students||[];window.totalRecords=cached.totalRecords??window.students.length;if(typeof updateStats==='function')updateStats();if(typeof updateFunnel==='function')updateFunnel()}else{loading('Fetching students…')}
await nextFrame();if(typeof filterTableStudents==='function')filterTableStudents();
await nextFrame();if(typeof renderDashboardPartners==='function')renderDashboardPartners();
try{const data=await window.apiGetCached('getStudents',{page:1,limit:100});if(data&&data.success){window.students=data.students||[];window.totalRecords=data.totalRecords??window.students.length;window.currentPage=data.page??1}else if(!cached){window.students=getMock();window.totalRecords=window.students.length}}catch(e){if(!cached){window.students=getMock();window.totalRecords=window.students.length}}finally{if(typeof filterTableStudents==='function')filterTableStudents();if(typeof updateStats==='function')updateStats();if(typeof updateFunnel==='function')updateFunnel();if(typeof renderDashboardPartners==='function')renderDashboardPartners();hideLoading()}};
window.searchStudentsLocal=function(query){const q=(query||'').toLowerCase();if(!q)return window.students||[];return(window.students||[]).filter(s=>['STUDENT NAME','STUDENT ID','COURSE','AGENT'].some(f=>(s[f]||'').toLowerCase().includes(q)))};
console.log('[R2U perf patch v2] loaded');
})();
