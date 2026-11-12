/* Логика прототипа: состояние, расчёт баллов, экраны ролей, обработка событий */

/* ======================= СОСТОЯНИЕ ======================= */
const KEY='evviva-proto-v2';
const clone = o => JSON.parse(JSON.stringify(o));
let S;
function fresh(){
  const s={settings:clone(DEFAULT_SETTINGS), people:buildDemoPeople(),
    ui:{role:'employee', empId:'p1', empTab:'home', empMod:null, empModTab:'learn',
        asMod:'m4', asTab:'list', asId:null, coTab:'list', coId:null, setTab:'rules', setMod:'m1',
        filt:{pos:'',stage:''}, open:{}, draft:{}, dec:{}}};
  S=s;
  s.people.forEach(p=>MODULES.forEach(m=>{ const pm=p.mods[m.id]; if(pm.autofill){ autofill(p,m.id); delete pm.autofill; } }));
  return s;
}
function load(){ try{ const r=localStorage.getItem(KEY); if(r){ const o=JSON.parse(r); if(o&&o.people&&o.settings&&o.ui){ S=o; return; } } }catch(e){} fresh(); }
function save(){ try{ localStorage.setItem(KEY, JSON.stringify(S)); }catch(e){} }

/* ======================= УТИЛИТЫ ======================= */
const $ = s => document.querySelector(s);
const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const iso = (d=new Date()) => { const z=new Date(d.getTime()-d.getTimezoneOffset()*60000); return z.toISOString().slice(0,10); };
const plusDays = n => { const d=new Date(); d.setDate(d.getDate()+n); return iso(d); };
const fd = s => s ? s.split('-').reverse().join('.') : '—';
const f2 = n => (n==null||isNaN(n)) ? '—' : n.toFixed(2).replace('.',',');
const f1 = n => (n==null||isNaN(n)) ? '—' : n.toFixed(1).replace('.',',');
const initials = fio => fio.split(' ').slice(0,2).map(w=>w[0]).join('');
const shortName = fio => { const p=fio.split(' '); return p[0]+' '+(p[1]?p[1][0]+'.':'')+(p[2]?p[2][0]+'.':''); };
const person = id => S.people.find(p=>p.id===id);
const mod = id => MODULES.find(m=>m.id===id);
const crit = (mid,cid) => mod(mid).criteria.find(c=>c.id===cid);
function toast(msg, err){ const t=$('#toast'); t.textContent=msg; t.className=(err?'err ':'')+'on'; clearTimeout(t._h); t._h=setTimeout(()=>t.className='',2800); }

function positionOf(p){ return S.settings.positions.find(x=>x.name===p.position); }
function isProfile(p, mid){ const pos=positionOf(p); return !!(pos && pos.profile.includes(mid)); }
function req(p, mid, cid){ const r=S.settings.req[mid][cid]; return isProfile(p,mid) ? {req:r.p, mand:r.pm} : {req:r.np, mand:r.npm}; }
function applicable(p, mid){ return mod(mid).criteria.filter(c=>req(p,mid,c.id).req!=='net'); }
function learnedCount(p, mid){ const l=p.mods[mid].learned; return applicable(p,mid).filter(c=>l[c.id]).length; }
function questionsFor(p, mid){ return QUESTIONS.filter(q=>q.m===mid && req(p,mid,q.c).req!=='net'); }
function hasTest(mid){ return QUESTIONS.some(q=>q.m===mid) || !!CASES[mid]; }

function testResult(p, mid){
  const t=p.mods[mid].test; if(!t||!t.done) return null;
  const by={}; let ok=0,total=0;
  questionsFor(p,mid).forEach(q=>{ by[q.c]=by[q.c]||{ok:0,total:0}; by[q.c].total++; total++; if(t.answers&&t.answers[q.id]===q.a){ by[q.c].ok++; ok++; } });
  return {by, ok, total, pct: total?Math.round(ok*100/total):null};
}

function verdictOf(avg, defs){
  const st=S.settings;
  if(avg==null) return {k:'none', t:'Недостаточно данных для вывода'};
  if(avg>=st.tFull && !defs) return {k:'ok', t:'Соответствует требованиям'};
  if(avg>=st.tPlan) return {k:'plan', t:'Соответствует при условии выполнения плана развития'};
  return {k:'def', t:'Значимый дефицит — нужны обучение и повторная оценка'};
}
function levelOf(avg, defs){
  if(avg==null) return null;
  const L=[...S.settings.levels].sort((a,b)=>b.min-a.min);
  return L.find(l=>avg>=l.min && (!l.noDef || !defs)) || null;
}

/* Расчёт по модулю: среднее = сумма баллов / число оценённых применимых критериев; Н/О и Н/П вне делителя */
function calcModule(p, mid){
  const st=S.settings, m=mod(mid); let sum=0, scored=0, no=0, np=0; const risks=[];
  m.criteria.forEach(c=>{
    const r=req(p,mid,c.id), s=p.mods[mid].scores[c.id]; const v = r.req==='net' ? 'НП' : (s?s.v:null);
    if(v==='НП'){ np++; return; }
    if(v==='НО'){ no++; if(r.mand) risks.push({m, c, lim:true, t:`М${m.n}, критерий ${c.n}: обязательный, но не оценён (Н/О) — ограничение заключения`}); return; }
    if(typeof v==='number'){
      sum+=v; scored++;
      const min = r.req==='op' ? st.minOp : st.minDa;
      if(r.mand && v<min) risks.push({m, c, t:`М${m.n}, критерий ${c.n} «${c.title}»: ${v} при минимуме ${min} — дефицит по обязательному критерию`});
    }
  });
  const applicableN = m.criteria.length - np;
  const avg = scored ? sum/scored : null;
  const defs = risks.filter(r=>!r.lim).length;
  return {sum, scored, no, np, applicable:applicableN, notScored:applicableN-scored-no, avg, risks, defs, verdict:verdictOf(avg,defs), level:levelOf(avg,defs)};
}

/* Общий результат: среднее средних баллов оценённых модулей (с весами из настроек) */
function calcOverall(p){
  const W=S.settings.weights; let ws=0, w=0, assessed=0, insufficient=0, defs=0; const risks=[], rows=[];
  MODULES.forEach(m=>{
    const pm=p.mods[m.id], k=calcModule(p,m.id), done=pm.status==='assessed';
    rows.push({m, pm, k, done});
    if(done && k.avg!=null){ assessed++; const wt=Number(W[m.id])||0; ws+=k.avg*wt; w+=wt; defs+=k.defs; risks.push(...k.risks); if(k.risks.some(r=>r.lim)) insufficient++; }
    else insufficient++;
  });
  const avg = w ? ws/w : null;
  return {rows, avg, assessed, insufficient, defs, risks, verdict:verdictOf(avg,defs), level:levelOf(avg,defs)};
}

function stage(p){
  if(p.decision) return p.decision.approved ? {k:'decided', t:'Решение утверждено', cls:'ok'} : {k:'decided', t:'На утверждении ГД', cls:'warn'};
  const st=MODULES.map(m=>p.mods[m.id].status), a=st.filter(s=>s==='assessed').length, t=st.filter(s=>s==='tested').length;
  if(a===MODULES.length) return {k:'commission', t:'На комиссии', cls:'warn'};
  if(a||t) return {k:'assessing', t:`Идёт оценка · ${a} из ${MODULES.length}`, cls:'blue'};
  return {k:'learning', t:'Обучение', cls:'grey'};
}
const stageChip = p => { const s=stage(p); return `<span class="chip ${s.cls}">${s.t}</span>`; };
const modChip = pm => `<span class="chip ${MOD_STATUS[pm.status].cls}">${MOD_STATUS[pm.status].t}</span>`;
function scoreBtnClass(v){ if(v==null) return ''; if(v==='НО'||v==='НП') return 'sx'; return 's'+v; }
function reqChip(r){ return `<span class="chip ${r.req}">${r.req==='net'?'Не оценивается':'Требование: '+REQ[r.req]}</span>${r.mand&&r.req!=='net'?'<span class="chip mand">обязательный</span>':''}`; }
function verdictChip(v, short){ const map={ok:['ok','Соответствует'],plan:['warn','С планом развития'],def:['bad','Дефицит'],none:['grey','—']}; const x=map[v.k]; return `<span class="chip ${x[0]}">${short?x[1]:v.t}</span>`; }
function scoreCls(v){ if(v==null) return ''; return v>=S.settings.tFull?'hi':v>=S.settings.tPlan?'mid':'lo'; }
const profChip = (p,mid) => isProfile(p,mid) ? '<span class="chip da">Профильный модуль</span>' : '<span class="chip grey">Непрофильный модуль</span>';

/* ======================= ШАПКА ======================= */
function vProtobar(){
  const R=[['employee','Сотрудник'],['assessor','Оценщик'],['commission','Комиссия / HR'],['settings','Настройки']];
  return `<span class="tag">ПРОТОТИП</span><span class="desc">8 модулей · 54 критерия · данные демонстрационные</span><span class="sp"></span>
  <div class="roles"><span>Смотреть как:</span>${R.map(([k,t])=>`<button data-a="role" data-v="${k}" class="${S.ui.role===k?'on':''}">${t}</button>`).join('')}</div>`;
}
function vHeader(){
  let name, sub, ini;
  if(S.ui.role==='employee'){ const p=person(S.ui.empId); name=shortName(p.fio); sub=p.position; ini=initials(p.fio); }
  else if(S.ui.role==='assessor'){ const m=mod(S.ui.asMod); name=`Ответственный за модуль ${m.n}`; sub=m.resp; ini='М'+m.n; }
  else if(S.ui.role==='commission'){ name='Оценочная комиссия'; sub='Кадровый департамент'; ini='ОК'; }
  else { name='Администратор'; sub='Настройки методики'; ini='А'; }
  return `<div class="logo"><img src="${LOGO}" alt="Эввива"><small>Медицинский центр<br>высшей категории</small></div>
  <div class="ptitle"><b>Платформа обучения и оценки персонала</b><span>Онбординг · обучение · оценка компетенций · ступени роста</span></div>
  <div class="user"><div class="ava">${esc(ini)}</div><div><b>${esc(name)}</b><small>${esc(sub)}</small></div></div>`;
}
function vSubnav(){
  const u=S.ui; let tabs=[], key, crumb='';
  if(u.role==='employee'){ key='empTab'; tabs=[['home','Главная'],['mods','Модули'],['results','Мои результаты']]; if(u.empTab==='mods'&&u.empMod) crumb='Модуль '+mod(u.empMod).n; }
  if(u.role==='assessor'){ key='asTab'; tabs=[['list','Оцениваемые']]; if(u.asId){ tabs.push(['protocol',`Протокол № ${mod(u.asMod).n}`]); crumb=shortName(person(u.asId).fio); } }
  if(u.role==='commission'){ key='coTab'; tabs=[['list','Сводная ведомость']]; if(u.coId){ tabs.push(['sheet','Итоговый лист']); crumb=shortName(person(u.coId).fio); } }
  if(u.role==='settings'){ key='setTab'; tabs=[['rules','Пороги и веса'],['req','Требования по модулям'],['pos','Должности и профили'],['levels','Ступени роста'],['bank','Банк вопросов']]; }
  return tabs.map(([k,t])=>`<button data-a="tab" data-k="${key}" data-v="${k}" class="${u[key]===k?'on':''}">${t}</button>`).join('') + (crumb?`<span class="crumb">${esc(crumb)}</span>`:'');
}

/* ======================= СОТРУДНИК ======================= */
function vEmployee(){
  const p=person(S.ui.empId);
  const sel = `<div class="row" style="margin-bottom:18px"><span class="small muted">Демо: войти как</span>
    <select data-f="emp" style="width:auto;min-width:300px">${S.people.map(x=>`<option value="${x.id}" ${x.id===p.id?'selected':''}>${esc(x.fio)} — ${esc(x.position)}</option>`).join('')}</select></div>`;
  const t=S.ui.empTab;
  return sel + (t==='home'?empHome(p): t==='mods'?(S.ui.empMod?empModule(p,S.ui.empMod):empModGrid(p)) : empResults(p));
}

function modCard(p, m){
  const pm=p.mods[m.id], ac=applicable(p,m.id).length, lc=learnedCount(p,m.id), tr=testResult(p,m.id);
  const pct = pm.status==='learning' ? Math.round(lc*100/ac) : 100;
  const sub = pm.status==='learning' ? `Изучено ${lc} из ${ac}` : pm.status==='tested' ? (tr?`Тест: ${tr.ok} из ${tr.total}`:'Готов к оценке') : `Балл модуля: ${f2(calcModule(p,m.id).avg)}`;
  return `<div class="m on" data-a="openMod" data-v="${m.id}"><div class="row" style="gap:6px"><small>Модуль ${m.n} · ${ac} крит.</small><span class="sp"></span>${modChip(pm)}</div>
    <b>${esc(m.t)}</b>${isProfile(p,m.id)?'<span class="chip da" style="align-self:flex-start">профильный</span>':''}<div class="sp"></div>
    <div class="bar"><i style="width:${pct}%"></i></div><small>${sub}</small></div>`;
}

function empHome(p){
  const sts=MODULES.map(m=>p.mods[m.id].status), ready=sts.filter(s=>s!=='learning').length, assessed=sts.filter(s=>s==='assessed').length, N=MODULES.length;
  const dec=p.decision;
  const steps=[
    {t:'Обучение и тесты', d:`${ready} из ${N} модулей`, done: ready===N},
    {t:'Оценка ответственными', d:`${assessed} из ${N} модулей`, done: assessed===N},
    {t:'Оценочная комиссия', d: dec?`решение ${fd(dec.date)}`:'итоговый лист', done: !!dec},
    {t:'Утверждение ГД', d: dec&&dec.approved?'утверждено':'генеральный директор', done: !!(dec&&dec.approved)},
    {t:'Ступень и план развития', d: dec&&dec.approved?esc(dec.level):'после утверждения', done: !!(dec&&dec.approved)}
  ];
  const cur=steps.findIndex(s=>!s.done);
  const nextMod = MODULES.find(m=>p.mods[m.id].status==='learning');
  let next;
  if(dec) next=`<button class="btn" data-a="tab" data-k="empTab" data-v="results">Посмотреть результаты и план развития</button>`;
  else if(nextMod) next=`<button class="btn" data-a="openMod" data-v="${nextMod.id}">Продолжить: модуль ${nextMod.n} «${esc(nextMod.t)}»</button>`;
  else if(assessed<N) next=`<div class="note green">Все модули пройдены. Ответственные проводят оценку: оценено ${assessed} из ${N}.</div>`;
  else next=`<div class="note green">Оценка по всем модулям завершена. Результаты рассматривает оценочная комиссия.</div>`;
  return `<h1>Добрый день, ${esc(p.fio.split(' ')[1])}!</h1>
  <p class="lead">Здесь вы проходите обучение по модулям, сдаёте тесты и видите результаты оценки, свою ступень и план развития.</p>
  <div class="card hero"><div style="flex:1"><p class="big">${esc(p.position)}</p>
    <div class="kv"><div><span>Статус</span><b>${esc(p.kind)}</b></div><div><span>Профильные модули</span><b>${(positionOf(p)?positionOf(p).profile:[]).map(x=>'М'+mod(x).n).join(', ')||'—'}</b></div><div><span>Текущая ступень</span><b>${esc(p.level)}</b></div><div><span>Этап</span>${stageChip(p)}</div></div></div></div>
  <div class="card"><h2>Ваш путь оценки</h2>
    <div class="steps">${steps.map((s,i)=>`<div class="step ${s.done?'done':i===cur?'cur':''}"><div class="dot">${s.done?'✓':i+1}</div><b>${s.t}</b><span>${s.d}</span></div>`).join('')}</div>
    <hr><div class="row">${next}</div></div>
  <div class="card"><h2>Модули оценки</h2><div class="grid g4 mods">${MODULES.map(m=>modCard(p,m)).join('')}</div></div>`;
}

function empModGrid(p){
  return `<h1>Модули</h1><p class="lead">8 модулей оценки управленческих компетенций. Выберите модуль, чтобы изучить темы и пройти тест.</p>
  <div class="grid g4 mods">${MODULES.map(m=>modCard(p,m)).join('')}</div>`;
}

function empModule(p, mid){
  const m=mod(mid), pm=p.mods[mid], t=S.ui.empModTab;
  return `<div class="row" style="margin-bottom:10px"><button class="link" data-a="closeMod">← Все модули</button></div>
  <h1>Модуль ${m.n}. ${esc(m.t)}</h1>
  <div class="row" style="margin:-2px 0 18px">${profChip(p,mid)}${modChip(pm)}<span class="small muted">Ответственный: ${esc(m.resp)}</span></div>
  <div class="ptabs"><button data-a="tab" data-k="empModTab" data-v="learn" class="${t==='learn'?'on':''}">Обучение</button><button data-a="tab" data-k="empModTab" data-v="test" class="${t==='test'?'on':''}">Тест</button></div>
  ${t==='learn'?empLearn(p,mid):empTest(p,mid)}`;
}

function empLearn(p, mid){
  const m=mod(mid), ac=applicable(p,mid).length, lc=learnedCount(p,mid), L=p.mods[mid].learned;
  return `<p class="lead">Изучите темы модуля — по ним проводится тест и собеседование с ответственным. Изучено: <b>${lc} из ${ac}</b>.</p>
  ${m.criteria.map(c=>{
    const r=req(p,mid,c.id), net=r.req==='net', done=!!L[c.id], op=!!S.ui.open['l'+c.id];
    return `<div class="lesson ${done?'done':''} ${net?'dim':''} ${op?'open':''}">
      <div class="lh" data-a="toggle" data-v="l${c.id}"><div class="n">${done?'✓':c.n}</div>
        <div class="lt"><b>${esc(c.title)}</b><div class="cmeta" style="margin:4px 0 0">${reqChip(r)}</div></div><span class="caret">▶</span></div>
      ${op?`<div class="lb">
        ${net?`<div class="note" style="margin-bottom:10px">Для вашей должности тема не оценивается. Её можно изучить для общего развития.</div>`:''}
        ${r.req==='op'?`<div class="note" style="margin-bottom:10px">Требуется общее представление: понимание принципов, рисков, взаимосвязей и порядка обращения к профильному специалисту.</div>`:''}
        <h3>Что нужно знать и уметь</h3>
        <ul>${c.points.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>
        <h3>Материалы</h3>
        <div class="mats"><div class="mat"><b>Конспект</b> · загружает ответственный за модуль</div><div class="mat"><b>Видеолекция</b> · 10–15 мин</div><div class="mat"><b>Внутренние документы</b> · положения, регламенты, приказы</div></div>
        <button class="btn ${done?'ghost':''} sm" data-a="learn" data-v="${c.id}">${done?'Изучено ✓ (отменить)':'Отметить как изученное'}</button>
      </div>`:''}
    </div>`;}).join('')}
  <div class="row" style="margin-top:16px"><button class="btn" data-a="tab" data-k="empModTab" data-v="test">Перейти к тесту</button></div>`;
}

function testPlaceholder(p, mid){
  const pm=p.mods[mid], m=mod(mid), ac=applicable(p,mid), lc=learnedCount(p,mid);
  return `<div class="card"><div class="row"><h2 style="margin:0">Тест по модулю ${m.n} готовится</h2><span class="sp"></span><span class="chip warn">вопросы будут добавлены</span></div>
    <p class="muted small" style="margin:8px 0 14px">Вопросы и кейс по этому модулю пока разрабатываются. Структура теста:</p>
    ${TEST_NOTE[mid]?`<div class="note" style="margin-bottom:14px">${esc(TEST_NOTE[mid])}</div>`:''}
    <div class="slots">${ac.map(c=>`<div class="slot"><span class="n">${c.n}</span><span>${esc(c.title)}</span><span class="sp"></span><span class="small muted">вопросы — место зарезервировано</span></div>`).join('')}
      <div class="slot"><span class="n">К</span><span>${mid==='m8'?'Ситуационные задания':'Кейс (открытый ответ)'}</span><span class="sp"></span><span class="small muted">место зарезервировано</span></div></div>
  </div>
  <div class="card">${pm.status==='learning'
    ? `<h3>Пока тест готовится</h3><p class="small">Когда изучите темы модуля, сообщите о готовности — ответственный (${esc(m.resp.toLowerCase())}) назначит собеседование.</p>
       ${lc<ac.length?`<p class="small muted">Изучено ${lc} из ${ac.length} тем.</p>`:''}<button class="btn" data-a="ready" data-v="${mid}">Сообщить о готовности к оценке</button>`
    : pm.status==='tested' ? `<div class="note green">Вы сообщили о готовности ${fd(pm.test.date)}. Ответственный за модуль свяжется с вами, чтобы назначить собеседование.</div>`
    : `<div class="note green">Оценка по модулю проведена ${fd(pm.adate)}.</div>`}</div>`;
}

function empTest(p, mid){
  if(!hasTest(mid)) return testPlaceholder(p, mid);
  const pm=p.mods[mid], tr=testResult(p,mid), qs=questionsFor(p,mid), m=mod(mid), caseT=CASES[mid];
  if(tr){
    const canRetry = pm.status!=='assessed' && !p.decision;
    return `<p class="lead">Тест пройден ${fd(pm.test.date)}. Результат передан ответственному за модуль как одно из доказательств. Итоговый балл по каждому критерию выставляет оценщик по шкале 1–5.</p>
    <div class="grid g2" style="align-items:start">
      <div class="card"><h2>Результат: ${tr.ok} из ${tr.total}${tr.pct!=null?` (${tr.pct}%)`:''}</h2>
        <div class="bars">${applicable(p,mid).map(c=>{const b=tr.by[c.id]; if(!b) return ''; const pc=Math.round(b.ok*100/b.total); return `<div class="b"><span>${c.n}. ${esc(c.title)}</span><div class="bar"><i style="width:${pc}%;background:${pc<50?'var(--red)':pc<100?'#e8a33a':'var(--g)'}"></i></div><b class="num">${b.ok}/${b.total}</b></div>`;}).join('')}</div>
      </div>
      ${caseT?`<div class="card"><h2>Кейс</h2><p class="small muted">${esc(caseT)}</p><div class="case"><b>Ваш ответ</b>${esc(pm.test.caseAnswer||'—')}</div><p class="small muted">Ответ на кейс оценивает ответственный за модуль на собеседовании.</p></div>`:''}
    </div>
    <div class="card"><h2>Разбор ответов</h2>${qs.map((q,i)=>{const a=pm.test.answers[q.id]; return `<div class="q"><p>${i+1}. ${esc(q.text)}</p>${q.o.map((o,j)=>`<div class="opt ${j===q.a?'right':j===a?'wrong':''}"><span>${j===q.a?'✓':j===a?'✗':'·'}</span><span>${esc(o)}</span></div>`).join('')}</div>`;}).join('')}</div>
    ${canRetry?`<div class="row" style="margin-top:16px"><button class="btn ghost" data-a="retest" data-v="${mid}">Пройти тест заново</button><span class="small muted">В прототипе пересдача доступна до завершения оценки.</span></div>`:''}`;
  }
  if(pm.status==='assessed') return `<div class="note green">Оценка по модулю проведена ${fd(pm.adate)}.</div>`;
  const key=p.id+mid, d=S.ui.draft[key]||(S.ui.draft[key]={answers:{},caseAnswer:''});
  let lastC=null;
  return `<p class="lead">${qs.length} вопросов с выбором ответа${caseT?' и 1 кейс':''}. Тест — одно из доказательств для оценщика; итоговый балл ставит ответственный за модуль.</p>
  <div class="note" style="margin-bottom:16px">Вопросы демонстрационные. Финальную редакцию банка вопросов утверждает ответственный за модуль.</div>
  <form class="card" onsubmit="return false">
    ${qs.map((q,i)=>{ const c=crit(mid,q.c); const head = q.c!==lastC ? `<h3 style="margin-top:${i?18:0}px">Тема ${c.n}. ${esc(c.title)}</h3>`:''; lastC=q.c;
      return head+`<div class="q"><p>${i+1}. ${esc(q.text)}</p>${q.o.map((o,j)=>`<label class="opt"><input type="radio" name="${q.id}" value="${j}" data-f="ans" data-q="${q.id}" ${d.answers[q.id]===j?'checked':''}><span>${esc(o)}</span></label>`).join('')}</div>`;}).join('')}
    ${caseT?`<h3 style="margin-top:18px">Кейс</h3><p class="small">${esc(caseT)}</p><textarea data-f="case" placeholder="Опишите план действий…">${esc(d.caseAnswer)}</textarea>`:''}
    <div class="row" style="margin-top:16px"><button class="btn" data-a="submitTest" data-v="${mid}">Отправить ответы</button><span class="small muted" id="ansCount">Отвечено: ${Object.keys(d.answers).length} из ${qs.length}</span></div>
  </form>`;
}

function empResults(p){
  const o=calcOverall(p), dec=p.decision;
  const table = `<div class="card tscroll"><h2>Результаты по модулям</h2><table class="t"><thead><tr><th>Модуль</th><th>Статус</th><th>Тест</th><th>Балл</th>${dec?'<th>Вывод</th>':''}</tr></thead><tbody>
    ${o.rows.map(r=>{const tr=testResult(p,r.m.id); return `<tr><td><b style="font-weight:500">${r.m.n}. ${esc(r.m.t)}</b>${isProfile(p,r.m.id)?' <span class="chip da">профильный</span>':''}</td><td>${modChip(r.pm)}</td><td class="num">${tr&&tr.pct!=null?tr.pct+'%':'—'}</td><td class="num"><b>${dec&&r.done?f2(r.k.avg):'—'}</b></td>${dec?`<td>${r.done?verdictChip(r.k.verdict,true):''}</td>`:''}</tr>`;}).join('')}
  </tbody></table>${dec?'':'<p class="small muted" style="margin:10px 0 0">Баллы по модулям станут видны после решения оценочной комиссии.</p>'}</div>`;
  if(!dec) return `<h1>Мои результаты</h1><p class="lead">Итоговые результаты появятся после рассмотрения оценочной комиссией и утверждения генеральным директором.</p>${table}`;
  return `<h1>Мои результаты</h1>
  <p class="lead">Решение комиссии от ${fd(dec.date)}${dec.approved?' · утверждено генеральным директором':' · на утверждении у генерального директора'}</p>
  <div class="grid g3">
    <div class="card sum"><span class="small muted">Общий средний балл</span><div class="score">${f2(o.avg)} <small>/ 5</small></div><p class="small muted" style="margin:8px 0 0">Оценено модулей: ${o.assessed} из ${MODULES.length}</p></div>
    <div class="card"><span class="small muted">Решение комиссии</span><p style="margin:6px 0 0;font-weight:500;color:var(--gd)">${DECISIONS[dec.type]}</p></div>
    <div class="card"><span class="small muted">Ступень</span><p style="margin:6px 0 0;font-size:20px;font-weight:700;color:var(--gd)">${esc(dec.level)}</p></div>
  </div>
  <div style="margin-top:16px">${table}</div>
  <div class="grid g2" style="margin-top:16px;align-items:start">
    <div class="card"><h2>Баллы по критериям</h2>${o.rows.filter(r=>r.done).map(r=>`<details><summary>Модуль ${r.m.n}. ${esc(r.m.t)} — ${f2(r.k.avg)}</summary><table class="t"><tbody>${r.m.criteria.map(c=>{const rq=req(p,r.m.id,c.id); const s=r.pm.scores[c.id]; const v=rq.req==='net'?'НП':s?s.v:null; return `<tr><td class="small">${c.n}. ${esc(c.title)}</td><td style="text-align:right"><button class="sb ${scoreBtnClass(v)} ${typeof v!=='number'?'w':''}" disabled>${v==='НП'?'Н/П':v==='НО'?'Н/О':v==null?'—':v}</button></td></tr>`;}).join('')}</tbody></table></details>`).join('')}</div>
    <div class="card"><h2>План развития</h2>${dec.plan&&dec.plan.length?`<table class="t"><thead><tr><th>Задача</th><th>Ответственный</th><th>Срок</th></tr></thead><tbody>${dec.plan.map(x=>`<tr><td>${esc(x.t)}</td><td class="small">${esc(x.o)}</td><td class="num small">${fd(x.d)}</td></tr>`).join('')}</tbody></table>`:'<p class="muted">Задач нет.</p>'}
      <hr><h3>Рекомендации</h3><p class="small">${esc(dec.recs||'—')}</p></div>
  </div>`;
}

/* ======================= ОЦЕНЩИК ======================= */
function vAssessor(){
  const sel=`<div class="row" style="margin-bottom:18px"><span class="small muted">Демо: войти как ответственный за</span>
    <select data-f="asMod" style="width:auto;min-width:420px">${MODULES.map(m=>`<option value="${m.id}" ${m.id===S.ui.asMod?'selected':''}>Модуль ${m.n}. ${esc(m.t)} — ${esc(m.resp)}</option>`).join('')}</select></div>`;
  return sel + (S.ui.asTab==='protocol' && S.ui.asId ? asProtocol(person(S.ui.asId), S.ui.asMod) : asList(S.ui.asMod));
}
function asList(mid){
  const m=mod(mid);
  const waiting=S.people.filter(p=>p.mods[mid].status==='tested').length;
  return `<h1>Оценка по модулю ${m.n}</h1>
  <p class="lead">«${esc(m.t)}». Ответственный: ${esc(m.resp.toLowerCase())}. Откройте протокол, выставьте баллы 1–5 по каждому критерию, приложите доказательства и сформируйте лист заключений.</p>
  ${waiting?`<div class="note green" style="margin-bottom:16px">Ожидают оценки по этому модулю: <b>${waiting}</b>.</div>`:''}
  <div class="card tscroll"><table class="t"><thead><tr><th>Оцениваемый</th><th>Статус</th><th>Модуль для должности</th><th>Тест</th><th>Балл модуля</th><th>Этап модуля</th><th></th></tr></thead><tbody>
  ${S.people.map(p=>{const pm=p.mods[mid], tr=testResult(p,mid), k=calcModule(p,mid); return `<tr>
    <td class="who"><b>${esc(p.fio)}</b><small>${esc(p.position)}</small></td>
    <td class="small">${esc(p.kind)}</td>
    <td>${isProfile(p,mid)?'<span class="chip da">Профильный</span>':'<span class="chip grey">Непрофильный</span>'}</td>
    <td class="num">${tr&&tr.pct!=null?tr.pct+'%':pm.status==='tested'&&pm.test&&pm.test.ready?'<span class="small muted">готов</span>':'<span class="muted">—</span>'}</td>
    <td class="num"><b>${f2(k.avg)}</b></td>
    <td>${modChip(pm)}</td>
    <td style="text-align:right"><button class="btn sm ${pm.status==='tested'?'':'ghost'}" data-a="openAs" data-v="${p.id}">${pm.status==='tested'?'Оценить':'Открыть протокол'}</button></td></tr>`;}).join('')}
  </tbody></table></div>`;
}

function asProtocol(p, mid){
  const m=mod(mid), pm=p.mods[mid], tr=testResult(p,mid), k=calcModule(p,mid), locked=!!p.decision;
  const rows = m.criteria.map(c=>{
    const r=req(p,mid,c.id), net=r.req==='net', s=pm.scores[c.id]||{}, v=net?'НП':s.v;
    const tb = tr&&tr.by[c.id] ? `<span class="chip test">Тест: ${tr.by[c.id].ok} из ${tr.by[c.id].total}</span>` : '';
    const btn = (val,label,w) => `<button class="sb ${w?'w':''} ${v===val?scoreBtnClass(val):''}" data-a="score" data-c="${c.id}" data-v="${val}" ${net||locked?'disabled':''} title="${label}">${label}</button>`;
    return `<div class="crow ${net?'dim':''}">
      <div class="cnum">${c.n}</div>
      <div><div class="ctitle">${esc(c.title)}</div>
        <div class="cmeta">${reqChip(r)}${tb}</div>
        <details data-open="as${c.id}" ${S.ui.open['as'+c.id]?'open':''}><summary>Что проверять</summary><ul>${c.points.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></details>
        ${net?`<div class="small muted">Для этой должности критерий не применим — автоматически Н/П, не входит в расчёт.</div>`:`<input type="text" data-f="cm" data-c="${c.id}" value="${esc(s.cm||'')}" placeholder="Комментарий / краткое доказательство" ${locked?'disabled':''}>`}
      </div>
      <div class="cscore"><div class="scores">${[1,2,3,4,5].map(n=>btn(n,n)).join('')}</div>
        <div class="scores" style="margin-top:4px;justify-content:flex-end">${btn('НО','Н/О',1)}${btn('НП','Н/П',1)}</div></div>
    </div>`;}).join('');
  const C=pm.concl, caseT=CASES[mid];
  return `<div class="row" style="margin-bottom:10px"><button class="link" data-a="tab" data-k="asTab" data-v="list">← Все оцениваемые</button></div>
  <h1>Протокол № ${m.n}. ${esc(m.t)}</h1>
  <p class="lead">${esc(p.fio)} · ${esc(p.position)} · ${esc(p.kind)} · ${isProfile(p,mid)?'профильный модуль':'непрофильный модуль'} · дата ${fd(pm.adate||iso())}</p>
  ${locked?`<div class="note green" style="margin-bottom:16px">Комиссия приняла решение — протокол закрыт для изменений.</div>`:''}
  ${pm.status==='learning'?`<div class="note" style="margin-bottom:16px">Сотрудник ещё не завершил обучение по модулю. Оценку можно провести, но обычно её начинают после теста или сообщения о готовности.</div>`:''}
  ${!hasTest(mid)?`<div class="note" style="margin-bottom:16px">Тест по этому модулю пока не добавлен — оценка проводится собеседованием, кейсами и анализом документов.${pm.test&&pm.test.ready?` Сотрудник сообщил о готовности ${fd(pm.test.date)}.`:''}</div>`:''}
  <div class="side">
    <div>
      <div class="card"><div class="row"><h2 style="margin:0">Критерии</h2><span class="sp"></span><span class="small muted">1 — не продемонстрировано · 3 — базовый рабочий · 5 — самостоятельно в сложных ситуациях</span></div>
        ${caseT&&pm.test&&pm.test.caseAnswer?`<div class="case" style="margin-top:12px"><b>Ответ сотрудника на кейс (с платформы)</b>${esc(pm.test.caseAnswer)}</div>`:''}${rows}</div>
      <div class="card"><h2>Лист заключений № ${m.n}</h2>
        <div class="field"><label>Применённые методы оценки</label><div class="checks">${Object.entries(METHODS).map(([mk,mt])=>`<label><input type="checkbox" data-f="method" data-v="${mk}" ${C.methods.includes(mk)?'checked':''} ${locked?'disabled':''}>${mt}</label>`).join('')}</div></div>
        ${!locked?`<div class="row" style="margin-bottom:14px"><button class="btn ghost sm" data-a="autofill">Заполнить черновик по баллам</button><span class="small muted">Система предложит формулировки, их можно отредактировать</span></div>`:''}
        <div class="grid g2">
        ${[['strengths','Сильные стороны и подтверждённые компетенции'],['gaps','Выявленные пробелы и профильные риски'],['verdict','Заключение о соответствии требованиям должности'],['proposals','Предложения по назначению / продолжению работы / повторной оценке'],['training','Рекомендации по обучению и развитию'],['responsible','Ответственный за исполнение рекомендаций; срок']].map(([fk,fl])=>`<div class="field"><label>${fl}</label><textarea data-f="concl" data-k="${fk}" ${locked?'disabled':''} style="min-height:${fk==='responsible'?60:90}px">${esc(C[fk])}</textarea></div>`).join('')}
        </div>
      </div>
    </div>
    <div class="sticky">${summaryCard(k,'модулю')}
      <div class="card"><div class="grid" style="gap:8px">
        <button class="btn ghost" data-a="preview" data-v="${p.id}" data-m="${mid}">Предпросмотр протокола</button>
        ${!locked?`<button class="btn" data-a="submitAs">${pm.status==='assessed'?'Обновить данные для комиссии':'Завершить оценку модуля'}</button>`:''}
      </div><p class="small muted" style="margin:10px 0 0">Результат модуля попадает в сводную ведомость и итоговый лист комиссии.</p></div>
    </div>
  </div>`;
}

function summaryCard(k, what, extra){
  return `<div class="card sum">
    <span class="small muted">Средний балл по ${what}</span>
    <div class="score">${f2(k.avg)} <small>/ 5,00</small></div>
    <div class="cnt">${extra||`<div>Применимых<b>${k.applicable}</b></div><div>Оценено<b>${k.scored}</b></div><div>Н/О<b>${k.no}</b></div><div>Н/П<b>${k.np}</b></div>`}</div>
    ${k.notScored>0?`<p class="small muted" style="margin:-4px 0 10px">Ещё не оценено: ${k.notScored}</p>`:''}
    <div class="verdict ${k.verdict.k}">${k.verdict.t}</div>
    ${k.risks.length?`<ul class="risks">${k.risks.map(r=>`<li class="${r.lim?'lim':''}">${esc(r.t)}</li>`).join('')}</ul>`:''}
    <div class="level"><span>Предлагаемая ступень (по порогам)</span><b>${k.level?esc(k.level.name):'—'}</b></div>
    <p class="small muted" style="margin:10px 0 0">Н/О и Н/П не заменяются нулём и исключаются из делителя. Окончательное решение принимает комиссия.</p>
  </div>`;
}

function autofill(p, mid){
  const k=calcModule(p,mid), pm=p.mods[mid], C=pm.concl, m=mod(mid);
  const sc = c => { if(req(p,mid,c.id).req==='net') return null; const s=pm.scores[c.id]; return s&&typeof s.v==='number'?s.v:null; };
  const strong=m.criteria.filter(c=>sc(c)>=4), weak=m.criteria.filter(c=>sc(c)!=null&&sc(c)<=3), no=m.criteria.filter(c=>pm.scores[c.id]&&pm.scores[c.id].v==='НО'&&req(p,mid,c.id).req!=='net');
  if(!C.methods.length){ C.methods=['interview']; const tr=testResult(p,mid); if(tr) C.methods.unshift('test'); if(pm.test&&pm.test.caseAnswer) C.methods.push('case'); if(!tr) C.methods.push('docs'); }
  C.strengths = strong.length ? 'Уверенный уровень по критериям: '+strong.map(c=>`${c.n} (${c.title.charAt(0).toLowerCase()+c.title.slice(1)})`).join('; ')+'.' : 'Критериев с уверенным уровнем (4–5) не выявлено.';
  C.gaps = [weak.length?'Пробелы: '+weak.map(c=>`${c.n} — ${sc(c)} балл(а)`).join('; ')+'.':'', k.defs?'Дефицит по обязательным критериям: '+k.risks.filter(r=>!r.lim).map(r=>r.c.n).join(', ')+'.':'', no.length?'Не оценены (Н/О): '+no.map(c=>c.n).join(', ')+'.':''].filter(Boolean).join(' ') || 'Значимых пробелов не выявлено.';
  C.verdict = k.verdict.t + '.' + (k.avg!=null?` Средний балл ${f2(k.avg)}.`:'');
  C.proposals = k.verdict.k==='ok' ? 'Подтвердить соответствие по модулю.' : k.verdict.k==='plan' ? 'Продолжение работы / назначение с планом развития и повторной проверкой слабых критериев через 2 месяца.' : 'Обучение и повторная оценка модуля.';
  C.training = weak.length ? 'Повторно изучить '+(weak.length>1?'темы ':'тему ')+weak.map(c=>`${c.n} «${c.title}»`).join(', ')+', пройти тест и собеседование по ним.' : 'Поддерживать актуальность знаний по модулю.';
  C.responsible = m.resp+'; '+(weak.length?'2 месяца':'по графику');
}

function protocolDoc(p, mid){
  const m=mod(mid), pm=p.mods[mid], k=calcModule(p,mid), R=S.settings.req[mid], C=pm.concl;
  const reqT = r => r==='op'?'общее представление':r==='da'?'да':'нет';
  return `<div class="doc" id="docText">
    <p class="c" style="margin:0 0 10px">ПМУ «Эввива»</p>
    <h4>ПРОТОКОЛ № ${m.n}. ${esc(m.t.toUpperCase())}</h4>
    <p>Должность: <b>${esc(p.position)}</b> &nbsp; ФИО: <b>${esc(p.fio)}</b><br>Статус: ${esc(p.kind)} &nbsp; Дата: ${fd(pm.adate||iso())}</p>
    <table><thead><tr><th>№</th><th>Оцениваемые знания, способности и умения</th><th>Профильный</th><th>Непрофильный</th><th>Балл 1–5</th><th>Комментарий / доказательство</th></tr></thead><tbody>
    ${m.criteria.map(c=>{const r=req(p,mid,c.id); const s=pm.scores[c.id]||{}; const v=r.req==='net'?'Н/П':s.v==='НО'?'Н/О':s.v==='НП'?'Н/П':(s.v||'');
      return `<tr><td>${c.n}</td><td>${esc(c.title)}</td><td>${reqT(R[c.id].p)}</td><td>${reqT(R[c.id].np)}</td><td style="text-align:center"><b>${v}</b></td><td>${esc(s.cm||'')}</td></tr>`;}).join('')}
    </tbody></table>
    <p><b>Средний балл по модулю: ${f2(k.avg)}</b> &nbsp; Применимых критериев: ${k.applicable} &nbsp; Оценено: ${k.scored} &nbsp; Н/О: ${k.no} &nbsp; Н/П: ${k.np}</p>
    <p><b>Ответственный:</b> ${esc(m.resp)} ПМУ «Эввива»</p>
    <p>ФИО оценщика: <span class="ln"></span> Подпись: <span class="ln" style="min-width:100px"></span> Дата: ${fd(pm.adate||iso())}</p>
    <h4 style="margin-top:22px">ЛИСТ ЗАКЛЮЧЕНИЙ № ${m.n}. «${esc(m.t.toUpperCase())}»</h4>
    <table><tbody>
      <tr><td style="width:38%">Средний балл по модулю; количество проверенных критериев</td><td>${f2(k.avg)}; ${k.scored} из ${k.applicable}</td></tr>
      <tr><td>Применённые методы оценки и подтверждающие материалы</td><td>${C.methods.map(x=>METHODS[x]).join('; ')}</td></tr>
      <tr><td>Сильные стороны и подтверждённые компетенции</td><td>${esc(C.strengths)}</td></tr>
      <tr><td>Выявленные пробелы и профильные риски</td><td>${esc(C.gaps)}</td></tr>
      <tr><td>Заключение о соответствии требованиям должности</td><td>${esc(C.verdict)}</td></tr>
      <tr><td>Предложения по назначению / продолжению работы / повторной оценке</td><td>${esc(C.proposals)}</td></tr>
      <tr><td>Рекомендации по обучению и развитию</td><td>${esc(C.training)}</td></tr>
      <tr><td>Ответственный за исполнение рекомендаций; контрольный срок</td><td>${esc(C.responsible)}</td></tr>
    </tbody></table>
    <p>Ответственный за модуль: <span class="ln"></span> Подпись: <span class="ln" style="min-width:100px"></span></p>
    <p>Ознакомлен(а) с результатами: <span class="ln"></span> «___» __________ 20___ г.</p>
  </div>`;
}

/* ======================= КОМИССИЯ / HR ======================= */
function vCommission(){ return S.ui.coTab==='sheet' && S.ui.coId ? coSheet(person(S.ui.coId)) : coList(); }

function filteredPeople(){
  const f=S.ui.filt;
  return S.people.filter(p=>(!f.pos||p.position===f.pos) && (!f.stage||stage(p).k===f.stage));
}
function coList(){
  const f=S.ui.filt, list=filteredPeople();
  const positions=[...new Set(S.people.map(p=>p.position))];
  const stages=[['learning','Обучение'],['assessing','Идёт оценка'],['commission','На комиссии'],['decided','Решение принято']];
  return `<h1>Сводная ведомость</h1>
  <p class="lead">Все оцениваемые и все 8 модулей в одной таблице. Сюда автоматически подтягиваются результаты тестов и баллы, которые выставляют ответственные. Нажмите на балл, чтобы открыть протокол модуля, или на «Итоговый лист», чтобы рассмотреть человека целиком.</p>
  <div class="card" style="padding:14px 20px"><div class="row">
    <span class="small muted">Должность</span><select data-f="fpos" style="width:auto;min-width:240px"><option value="">Все</option>${positions.map(x=>`<option ${f.pos===x?'selected':''}>${esc(x)}</option>`).join('')}</select>
    <span class="small muted">Этап</span><select data-f="fstage" style="width:auto"><option value="">Все</option>${stages.map(([k,t])=>`<option value="${k}" ${f.stage===k?'selected':''}>${t}</option>`).join('')}</select>
    <span class="sp"></span><button class="btn ghost sm" data-a="copyTable">Скопировать для Excel</button></div></div>
  <div class="card tscroll"><table class="t matrix"><thead><tr><th>Оцениваемый</th>${MODULES.map(m=>`<th class="mc" title="${esc(m.t)}">М${m.n}</th>`).join('')}<th class="mc">Общий</th><th>Вывод</th><th>Ступень (предл.)</th><th>Этап</th><th></th></tr></thead><tbody>
  ${list.map(p=>{const o=calcOverall(p); return `<tr>
    <td class="who"><b>${esc(p.fio)}</b><small>${esc(p.position)}</small></td>
    ${o.rows.map(r=>{ const tr=testResult(p,r.m.id);
      if(r.done) return `<td class="mc"><button class="mcell ${scoreCls(r.k.avg)} ${isProfile(p,r.m.id)?'prof':''}" data-a="preview" data-v="${p.id}" data-m="${r.m.id}" title="${esc(r.m.t)}${r.k.defs?' · дефицит':''}">${f1(r.k.avg)}${r.k.defs?'<i>!</i>':''}</button></td>`;
      if(r.pm.status==='tested') return `<td class="mc"><span class="mwait" title="Ожидает оценки${tr&&tr.pct!=null?' · тест '+tr.pct+'%':''}">${tr&&tr.pct!=null?tr.pct+'%':'ждёт'}</span></td>`;
      return `<td class="mc"><span class="mnone" title="Обучение">—</span></td>`; }).join('')}
    <td class="mc"><b>${f2(o.avg)}</b></td>
    <td>${o.assessed?verdictChip(o.verdict,true):'<span class="muted small">—</span>'}${o.defs?` <span class="chip bad">${o.defs} деф.</span>`:''}</td>
    <td class="small">${p.decision?`<b>${esc(p.decision.level)}</b>`:o.level&&o.assessed?esc(o.level.name):'—'}</td>
    <td>${stageChip(p)}</td>
    <td style="text-align:right"><button class="btn sm ${stage(p).k==='commission'?'':'ghost'}" data-a="openCo" data-v="${p.id}">Итоговый лист</button></td></tr>`;}).join('') || `<tr><td colspan="14" class="muted">Нет оцениваемых по выбранным фильтрам</td></tr>`}
  </tbody></table>
  <div class="legend"><span><i class="mcell hi">4,5</i> от ${f1(S.settings.tFull)}</span><span><i class="mcell mid">3,5</i> от ${f1(S.settings.tPlan)}</span><span><i class="mcell lo">2,5</i> ниже</span><span><i class="mcell mid prof">3,8</i> профильный модуль</span><span><i class="mcell lo">2,9<i>!</i></i> дефицит по обязательному критерию</span><span><span class="mwait">70%</span> ждёт оценки (результат теста)</span><span><span class="mnone">—</span> обучение</span></div>
  </div>`;
}

function tableTSV(){
  const head=['ФИО','Должность','Статус',...MODULES.map(m=>`М${m.n} ${m.t}`),'Общий балл','Вывод','Ступень','Этап'];
  const rows=filteredPeople().map(p=>{const o=calcOverall(p); return [p.fio,p.position,p.kind,...o.rows.map(r=>r.done?f2(r.k.avg):r.pm.status==='tested'?'ожидает оценки':'обучение'),f2(o.avg),o.assessed?o.verdict.t:'',p.decision?p.decision.level:(o.level&&o.assessed?o.level.name:''),stage(p).t];});
  return [head,...rows].map(r=>r.join('\t')).join('\n');
}

function decDraft(p){
  if(p.decision) return p.decision;
  if(!S.ui.dec[p.id]){
    const o=calcOverall(p);
    const type = o.verdict.k==='ok'?'ok':o.verdict.k==='plan'?'plan':'retry';
    const plan=[];
    o.rows.filter(r=>r.done).forEach(r=>{
      const weak=r.m.criteria.filter(c=>{ const s=r.pm.scores[c.id]; return req(p,r.m.id,c.id).req!=='net' && s && typeof s.v==='number' && s.v<=3; });
      if(weak.length){ const min=Math.min(...weak.map(c=>r.pm.scores[c.id].v));
        plan.push({t:`Модуль ${r.m.n} «${r.m.t}»: ${weak.length>1?'темы':'тема'} ${weak.map(c=>c.n).join(', ')} — повторное изучение, тест и собеседование`, o:r.m.resp, d:plusDays(min<3?60:90)}); }
    });
    const lim = o.insufficient ? ` Модулей без достаточной оценки: ${o.insufficient}.` : '';
    S.ui.dec[p.id]={type, level:o.level?o.level.name:S.settings.levels[0].name, just:'', plan,
      concl:`${o.verdict.t}. Общий средний балл ${f2(o.avg)}.${o.defs?` Дефициты по обязательным профильным критериям: ${o.defs}.`:''}${lim}`,
      recs: plan.length?'Обучение и повторная проверка по слабым темам в соответствии с планом развития; наставничество профильных руководителей.':'Поддерживать уровень; ежегодная плановая оценка.',
      hr:'', exec:''};
  }
  return S.ui.dec[p.id];
}

function coSheet(p){
  const o=calcOverall(p), d=decDraft(p), done=!!p.decision, ready=o.assessed===MODULES.length;
  const proposed=o.level?o.level.name:'—', differs = d.level!==proposed;
  const extra=`<div>Оценено модулей<b>${o.assessed} / ${MODULES.length}</b></div><div>Без достаточной оценки<b>${o.insufficient}</b></div><div>Дефициты (обяз.)<b>${o.defs}</b></div><div>Профильных модулей<b>${(positionOf(p)?positionOf(p).profile.length:0)}</b></div>`;
  const ta=(k,l,h)=>`<div class="field"><label>${l}</label><textarea data-f="dtxt" data-k="${k}" style="min-height:${h||80}px" ${done?'disabled':''}>${esc(d[k]||'')}</textarea></div>`;
  return `<div class="row" style="margin-bottom:10px"><button class="link" data-a="tab" data-k="coTab" data-v="list">← Сводная ведомость</button></div>
  <h1>Итоговый лист оценки</h1>
  <p class="lead">${esc(p.fio)} · ${esc(p.position)} · ${esc(p.kind)} · текущая ступень: ${esc(p.level)}</p>
  <div class="side">
    <div>
      <div class="card tscroll"><div class="row"><h2 style="margin:0">Результаты по модулям</h2><span class="sp"></span><button class="btn ghost sm" data-a="previewFinal" data-v="${p.id}">Предпросмотр итогового листа</button></div>
        <table class="t" style="margin-top:8px"><thead><tr><th>№</th><th>Модуль</th><th>Средний балл</th><th>Оценено / применимо</th><th>Заключение / риски</th><th></th></tr></thead><tbody>
        ${o.rows.map(r=>`<tr><td>${r.m.n}</td><td><b style="font-weight:500">${esc(r.m.t)}</b>${isProfile(p,r.m.id)?' <span class="chip da">профильный</span>':''}<div class="small muted">${esc(r.m.resp)}</div></td>
          <td class="num"><b>${r.done?f2(r.k.avg):'—'}</b></td><td class="num">${r.done?`${r.k.scored} / ${r.k.applicable}`:'—'}</td>
          <td>${r.done?verdictChip(r.k.verdict,true)+(r.k.defs?` <span class="chip bad">${r.k.defs} деф.</span>`:''):modChip(r.pm)}</td>
          <td style="text-align:right">${r.done?`<button class="btn ghost sm" data-a="preview" data-v="${p.id}" data-m="${r.m.id}">Протокол</button>`:''}</td></tr>`).join('')}
        </tbody></table>
      </div>
      ${o.risks.length?`<div class="card"><h2>Профильные риски и ограничения</h2><ul class="risks" style="margin:0">${o.risks.map(r=>`<li class="${r.lim?'lim':''}">${esc(r.t)}</li>`).join('')}</ul></div>`:''}
      <div class="card"><h2>Заключения</h2>
        ${!done?`<div class="row" style="margin-bottom:12px"><button class="btn ghost sm" data-a="refillFinal">Пересобрать черновик по данным</button><span class="small muted">Черновик собран из баллов и заключений по модулям</span></div>`:''}
        ${ta('concl','Итоговое заключение о соответствии конкретной должности (с учётом профильных требований и рисков)',90)}
        ${ta('recs','Рекомендации по результатам оценки (обучение, наставничество, повторная проверка, организационные меры)',80)}
        <div class="grid g2">${ta('hr','Предложение кадрового департамента',70)}${ta('exec','Заключение руководителя исполнительской службы',70)}</div>
      </div>
      <div class="card"><h2>Решение комиссии</h2>
        ${!ready&&!done?`<div class="note" style="margin-bottom:14px">Оценены не все модули (${o.assessed} из ${MODULES.length}). Решение можно зафиксировать, когда все ответственные завершат оценку.</div>`:''}
        <div class="radios">${Object.entries(DECISIONS).map(([dk,dt])=>`<label class="${d.type===dk?'on':''}"><input type="radio" name="dtype" data-f="dtype" value="${dk}" ${d.type===dk?'checked':''} ${done?'disabled':''}><span>${dt}</span></label>`).join('')}</div>
        <div class="grid g2">
          <div class="field"><label>Ступень роста</label><select data-f="dlevel" ${done?'disabled':''}>${S.settings.levels.map(l=>`<option ${l.name===d.level?'selected':''}>${esc(l.name)}</option>`).join('')}</select>
            <div class="small muted" style="margin-top:4px">Предложено системой: <b>${esc(proposed)}</b></div></div>
          <div class="field"><label>Обоснование${differs?' <span style="color:var(--red)">— обязательно, ступень отличается от предложенной</span>':''}</label><textarea data-f="dtxt" data-k="just" style="min-height:70px" ${done?'disabled':''} placeholder="Мотивированное заключение комиссии">${esc(d.just)}</textarea></div>
        </div>
        <h3>План развития</h3>
        <div class="tscroll"><table class="t plan"><thead><tr><th>Задача</th><th>Ответственный</th><th>Срок</th><th></th></tr></thead><tbody>
          ${d.plan.map((x,i)=>`<tr><td><input type="text" data-f="plan" data-i="${i}" data-k="t" value="${esc(x.t)}" ${done?'disabled':''}></td><td><input type="text" data-f="plan" data-i="${i}" data-k="o" value="${esc(x.o)}" ${done?'disabled':''}></td><td><input type="date" data-f="plan" data-i="${i}" data-k="d" value="${esc(x.d)}" ${done?'disabled':''}></td><td>${done?'':`<button class="x" data-a="delPlan" data-v="${i}" title="Удалить">×</button>`}</td></tr>`).join('') || `<tr><td colspan="4" class="muted small">Задач нет</td></tr>`}
        </tbody></table></div>
        ${done?'':`<button class="link" data-a="addPlan" style="margin-top:10px">+ Добавить задачу</button>`}
        <hr>
        ${done?`<div class="row"><div class="note green" style="flex:1">Решение зафиксировано ${fd(p.decision.date)}. ${p.decision.approved?'Утверждено генеральным директором.':'Ожидает утверждения генеральным директором.'}</div>${p.decision.approved?'':`<button class="btn" data-a="approve">Отметить утверждение ГД</button>`}</div>`
          :`<button class="btn" data-a="decide" ${ready?'':'disabled'}>Зафиксировать решение комиссии</button> <span class="small muted">&nbsp;После фиксации решение уходит на утверждение генеральному директору.</span>`}
      </div>
    </div>
    <div class="sticky">${summaryCard(Object.assign({},o,{notScored:0}),'всем модулям',extra)}</div>
  </div>`;
}

function finalDoc(p){
  const o=calcOverall(p), d=p.decision||decDraft(p);
  const box = k => p.kind===k ? '☒' : '☐';
  return `<div class="doc" id="docText">
    <p class="c" style="margin:0 0 10px">ПМУ «Эввива»</p>
    <h4>ИТОГОВЫЙ ЛИСТ ОЦЕНКИ КОМПЕТЕНЦИЙ</h4>
    <p>Должность: <b>${esc(p.position)}</b> &nbsp; ФИО: <b>${esc(p.fio)}</b><br>Статус: ${box('Действующий руководитель')} действующий руководитель ${box('Кандидат на должность')} кандидат ${box('Перевод / назначение')} перевод / назначение</p>
    <table><thead><tr><th>№</th><th>Модуль</th><th>Средний балл</th><th>Оценено / применимо</th><th>Заключение / риски</th></tr></thead><tbody>
    ${o.rows.map(r=>`<tr><td>${r.m.n}</td><td>${esc(r.m.t)}</td><td style="text-align:center">${r.done?f2(r.k.avg):''}</td><td style="text-align:center">${r.done?`${r.k.scored} / ${r.k.applicable}`:''}</td><td>${r.done?esc(r.k.verdict.t)+(r.k.defs?`; дефицитов: ${r.k.defs}`:''):'не оценено'}</td></tr>`).join('')}
    </tbody></table>
    <p><b>Общий средний балл по применимым оценённым модулям: ${f2(o.avg)} / 5,00</b></p>
    <p>Количество модулей без достаточной оценки: ${o.insufficient}; обязательные профильные критерии с дефицитами: ${o.defs}</p>
    <p><b>Итоговое заключение о соответствии конкретной должности:</b><br>${esc(d.concl||'')}</p>
    <p><b>Рекомендации по результатам оценки:</b><br>${esc(d.recs||'')}</p>
    <p>Предложение кадрового департамента: ${esc(d.hr||'')}</p>
    <p>Заключение руководителя исполнительской службы: ${esc(d.exec||'')}</p>
    <p><b>Решение комиссии:</b> ${p.decision?esc(DECISIONS[d.type])+'; ступень: '+esc(d.level):'не принято'}</p>
    <p><b>Решение генерального директора ПМУ «Эввива»:</b> ${p.decision&&p.decision.approved?'утверждено':'<span class="ln"></span>'}</p>
    <p>«___» ______________ 20___ г. <span class="ln"></span></p>
  </div>`;
}

/* ======================= НАСТРОЙКИ ======================= */
function vSettings(){
  const t=S.ui.setTab, st=S.settings;
  if(t==='req'){
    const mid=S.ui.setMod, m=mod(mid);
    return `<h1>Требования по модулям</h1>
    <p class="lead">Для каждого критерия — требование для профильной и непрофильной должности и отметка «обязательный». Значения «да / общее представление / нет» взяты из протоколов регламента. Обязательными по умолчанию считаются все критерии профильного модуля.</p>
    <div class="modsel">${MODULES.map(x=>`<button data-a="setMod" data-v="${x.id}" class="${x.id===mid?'on':''}">М${x.n}. ${esc(x.t)}</button>`).join('')}</div>
    <div class="card tscroll"><h2>Модуль ${m.n}. ${esc(m.t)}</h2><p class="small muted" style="margin-top:-6px">Ответственный: ${esc(m.resp)}</p>
      <table class="t"><thead><tr><th>Критерий</th><th>Профильная</th><th>Обяз.</th><th>Непрофильная</th><th>Обяз.</th></tr></thead><tbody>
      ${m.criteria.map(c=>{const r=st.req[mid][c.id]; return `<tr><td>${c.n}. ${esc(c.title)}</td>
        <td style="width:190px"><select data-f="mx" data-c="${c.id}" data-k="p">${Object.entries(REQ).map(([rk,rt])=>`<option value="${rk}" ${r.p===rk?'selected':''}>${rt}</option>`).join('')}</select></td>
        <td style="width:60px;text-align:center"><input type="checkbox" data-f="mx" data-c="${c.id}" data-k="pm" ${r.pm?'checked':''}></td>
        <td style="width:190px"><select data-f="mx" data-c="${c.id}" data-k="np">${Object.entries(REQ).map(([rk,rt])=>`<option value="${rk}" ${r.np===rk?'selected':''}>${rt}</option>`).join('')}</select></td>
        <td style="width:60px;text-align:center"><input type="checkbox" data-f="mx" data-c="${c.id}" data-k="npm" ${r.npm?'checked':''}></td></tr>`;}).join('')}
      </tbody></table></div>`;
  }
  if(t==='pos') return `<h1>Должности и профили</h1>
    <p class="lead">Для каждой должности отмечаются профильные модули: по ним действуют требования «Профильная» и обязательные критерии. По остальным модулям — требования «Непрофильная». Перечень — пример, его уточняют под конкретные должности (п. 1–2 регламента).</p>
    <div class="card tscroll"><table class="t matrix"><thead><tr><th>Должность</th>${MODULES.map(m=>`<th class="mc" title="${esc(m.t)}">М${m.n}</th>`).join('')}<th></th></tr></thead><tbody>
    ${st.positions.map((x,i)=>`<tr><td><input type="text" data-f="posname" data-i="${i}" value="${esc(x.name)}"></td>${MODULES.map(m=>`<td class="mc"><input type="checkbox" data-f="posprof" data-i="${i}" data-m="${m.id}" ${x.profile.includes(m.id)?'checked':''}></td>`).join('')}<td>${S.people.some(p=>p.position===x.name)?'':`<button class="x" data-a="delPos" data-v="${i}" title="Удалить">×</button>`}</td></tr>`).join('')}
    </tbody></table><button class="link" data-a="addPos" style="margin-top:12px">+ Добавить должность</button>
    <div class="legend">${MODULES.map(m=>`<span><b>М${m.n}</b> ${esc(m.t)}</span>`).join('')}</div></div>`;
  if(t==='levels') return `<h1>Ступени роста</h1>
    <p class="lead">Пример трека для руководителей. Система предлагает самую высокую ступень, порог которой достигнут по общему среднему баллу. Для части ступеней дополнительно требуется отсутствие дефицитов по обязательным критериям. В рабочей версии у каждой должности будет свой трек.</p>
    <div class="card tscroll"><table class="t"><thead><tr><th>#</th><th>Ступень</th><th>Минимальный общий балл</th><th>Без дефицитов по обязательным</th></tr></thead><tbody>
    ${st.levels.map((l,i)=>`<tr><td>${i+1}</td><td><input type="text" data-f="lvl" data-i="${i}" data-k="name" value="${esc(l.name)}"></td><td style="width:200px"><input type="number" step="0.1" min="0" max="5" data-f="lvl" data-i="${i}" data-k="min" value="${l.min}"></td><td style="width:220px"><div class="checks"><label><input type="checkbox" data-f="lvl" data-i="${i}" data-k="noDef" ${l.noDef?'checked':''}> требуется</label></div></td></tr>`).join('')}
    </tbody></table></div>
    <div class="note" style="margin-top:16px">Названия ступеней и пороги — пример для прототипа. Их нужно согласовать с кадровым департаментом и утвердить.</div>`;
  if(t==='bank'){
    const total=QUESTIONS.length;
    return `<h1>Банк вопросов</h1>
    <p class="lead">Место под тесты по всем 8 модулям: по каждому критерию — вопросы с выбором ответа, по модулю — кейс. Сейчас заполнен только модуль 4 (демонстрационные вопросы). Остальные тесты прорабатываются отдельно и добавляются в файл <code>js/data.js</code>.</p>
    <div class="grid g4" style="margin-bottom:16px">${MODULES.map(m=>{const n=QUESTIONS.filter(q=>q.m===m.id).length; return `<div class="card" style="padding:14px"><small class="muted">Модуль ${m.n}</small><div style="font-weight:500;margin:2px 0 6px">${esc(m.t)}</div>${n?`<span class="chip ok">${n} вопросов${CASES[m.id]?' + кейс':''}</span>`:'<span class="chip warn">место под тест</span>'}</div>`;}).join('')}</div>
    ${MODULES.map(m=>{const qs=QUESTIONS.filter(q=>q.m===m.id); return `<details class="card bankm" ${S.ui.open['bank'+m.id]?'open':''} data-open="bank${m.id}"><summary><b>Модуль ${m.n}. ${esc(m.t)}</b> <span class="small muted">· ${qs.length} вопросов · ${m.criteria.length} критериев</span></summary>
      ${TEST_NOTE[m.id]?`<div class="note" style="margin:12px 0">${esc(TEST_NOTE[m.id])}</div>`:''}
      ${m.criteria.map(c=>{const cq=qs.filter(q=>q.c===c.id); return `<div class="q"><p>${c.n}. ${esc(c.title)}</p>${cq.length?cq.map(q=>`<div style="margin:6px 0 10px"><div class="small" style="font-weight:500">${esc(q.text)}</div>${q.o.map((o,j)=>`<div class="opt ${j===q.a?'right':''}"><span>${j===q.a?'✓':'·'}</span><span>${esc(o)}</span></div>`).join('')}</div>`).join(''):'<div class="slot empty">Место для вопросов — будут добавлены</div>'}</div>`;}).join('')}
      <div class="q"><p>${m.id==='m8'?'Ситуационные задания':'Кейс (открытый ответ, оценивает ответственный)'}</p>${CASES[m.id]?`<div class="small">${esc(CASES[m.id])}</div>`:'<div class="slot empty">Место для кейса — будет добавлен</div>'}</div>
    </details>`;}).join('')}
    <p class="small muted">Всего вопросов в банке: ${total}.</p>`;
  }
  return `<h1>Пороги и веса</h1>
    <p class="lead">Правила расчёта для всех модулей. Изменения сразу пересчитывают выводы во всех разделах прототипа.</p>
    <div class="card"><h2>Пороги вывода</h2><div class="grid g4">
      <div class="field"><label>«Соответствует» — средний балл от</label><input type="number" step="0.1" min="1" max="5" data-f="set" data-k="tFull" value="${st.tFull}"></div>
      <div class="field"><label>«С планом развития» — от</label><input type="number" step="0.1" min="1" max="5" data-f="set" data-k="tPlan" value="${st.tPlan}"></div>
      <div class="field"><label>Минимум по обязательному критерию «Да»</label><input type="number" step="1" min="1" max="5" data-f="set" data-k="minDa" value="${st.minDa}"></div>
      <div class="field"><label>Минимум для «Общее представление»</label><input type="number" step="1" min="1" max="5" data-f="set" data-k="minOp" value="${st.minOp}"></div>
    </div><p class="small muted" style="margin:0">Ниже порога «С планом развития» — значимый дефицит. Если есть дефицит по обязательному критерию, вывод «Соответствует» не ставится.</p></div>
    <div class="card"><h2>Веса модулей в общем балле</h2><p class="small muted" style="margin-top:-6px">По регламенту рекомендуется одинаковый вес (1). Специальные веса устанавливаются до начала оценки.</p>
      <div class="grid g4">${MODULES.map(m=>`<div class="field"><label>М${m.n}. ${esc(m.t)}</label><input type="number" step="0.5" min="0" max="5" data-f="weight" data-m="${m.id}" value="${st.weights[m.id]}"></div>`).join('')}</div></div>
    <div class="card"><h2>Демо-данные</h2><p class="small muted">Вернуть прототип в исходное состояние: оценки, решения и настройки.</p><button class="btn red" data-a="reset">${S.ui.resetArm?'Нажмите ещё раз для подтверждения':'Сбросить демо-данные'}</button></div>`;
}

/* ======================= РЕНДЕР ======================= */
function render(){
  $('#protobar').innerHTML=vProtobar();
  $('#header').innerHTML=vHeader();
  $('#subnav').innerHTML=vSubnav();
  const v={employee:vEmployee, assessor:vAssessor, commission:vCommission, settings:vSettings}[S.ui.role];
  $('#app').innerHTML=v();
  save();
}
function setRole(r){ S.ui.role=r; S.ui.resetArm=false; try{ if(location.hash!=='#'+r) history.replaceState(null,'','#'+r); }catch(e){} }
function openModal(html){ const m=$('#modal'); m.innerHTML=html; m.classList.remove('hidden'); }
function closeModal(){ $('#modal').classList.add('hidden'); $('#modal').innerHTML=''; }
function docModal(title, html){ openModal(`<div class="sheet"><div class="sh"><b style="color:var(--gd)">${title}</b><span class="sp"></span><button class="btn ghost sm" data-a="copyDoc">Копировать текст</button><button class="btn sm" data-a="closeModal">Закрыть</button></div>${html}</div>`); }
function copyText(txt, ok){ try{ navigator.clipboard.writeText(txt).then(()=>toast(ok),()=>toast('Не удалось скопировать',true)); }catch(err){ toast('Не удалось скопировать',true); } }

/* ======================= СОБЫТИЯ ======================= */
document.addEventListener('click', e=>{
  if(e.target.id==='modal'){ closeModal(); return; }
  const a=e.target.closest('[data-a]'); if(!a) return;
  const act=a.dataset.a, v=a.dataset.v;
  const scrollTop = ['tab','role','openAs','openCo','openMod','closeMod'].includes(act);
  switch(act){
    case 'role': setRole(v); break;
    case 'tab': S.ui[a.dataset.k]=v; if(a.dataset.k==='empTab'&&v==='mods') S.ui.empMod=null; break;
    case 'toggle': S.ui.open[v]=!S.ui.open[v]; break;
    case 'openMod': S.ui.empTab='mods'; S.ui.empMod=v; S.ui.empModTab='learn'; break;
    case 'closeMod': S.ui.empMod=null; break;
    case 'learn': { const p=person(S.ui.empId), L=p.mods[S.ui.empMod].learned; L[v]=!L[v]; if(L[v]) toast('Тема отмечена как изученная'); break; }
    case 'ready': { const p=person(S.ui.empId), pm=p.mods[v]; pm.status='tested'; pm.test={done:false, ready:true, date:iso()}; toast('Ответственный за модуль получил уведомление о вашей готовности'); break; }
    case 'submitTest': {
      const p=person(S.ui.empId), mid=v, key=p.id+mid, d=S.ui.draft[key]||{answers:{},caseAnswer:''};
      const qs=questionsFor(p,mid); const miss=qs.filter(q=>d.answers[q.id]==null);
      if(miss.length){ toast(`Ответьте на все вопросы: осталось ${miss.length}`, true); return; }
      if(CASES[mid] && !(d.caseAnswer||'').trim()){ toast('Заполните ответ на кейс', true); return; }
      const pm=p.mods[mid]; pm.test={done:true, date:iso(), answers:{...d.answers}, caseAnswer:d.caseAnswer};
      if(pm.status==='learning') pm.status='tested';
      delete S.ui.draft[key];
      const tr=testResult(p,mid); toast(`Тест отправлен: ${tr.ok} из ${tr.total}. Результаты переданы ответственному за модуль`);
      window.scrollTo(0,0); break;
    }
    case 'retest': { const pm=person(S.ui.empId).mods[v]; pm.test={done:false}; if(pm.status==='tested') pm.status='learning'; break; }
    case 'openAs': S.ui.asId=v; S.ui.asTab='protocol'; break;
    case 'score': {
      const pm=person(S.ui.asId).mods[S.ui.asMod], c=a.dataset.c, val=(v==='НО'||v==='НП')?v:Number(v);
      pm.scores[c]=pm.scores[c]||{cm:''}; pm.scores[c].v = pm.scores[c].v===val ? null : val;
      if(!pm.adate) pm.adate=iso();
      break;
    }
    case 'autofill': autofill(person(S.ui.asId), S.ui.asMod); toast('Черновик заключения заполнен — проверьте формулировки'); break;
    case 'submitAs': {
      const p=person(S.ui.asId), mid=S.ui.asMod, pm=p.mods[mid];
      const miss=mod(mid).criteria.filter(c=>req(p,mid,c.id).req!=='net' && !(pm.scores[c.id]&&pm.scores[c.id].v!=null));
      if(miss.length){ toast('Не оценены критерии: '+miss.map(c=>c.n).join(', ')+'. Поставьте балл или Н/О', true); return; }
      if(!pm.concl.verdict.trim()) autofill(p,mid);
      if(!pm.adate) pm.adate=iso();
      const was=pm.status; pm.status='assessed'; delete S.ui.dec[p.id];
      const k=calcModule(p,mid);
      toast(was==='assessed'?'Данные для комиссии обновлены':`Модуль ${mod(mid).n} оценён: ${f2(k.avg)} · результат передан в сводную ведомость`);
      S.ui.asTab='list'; window.scrollTo(0,0); break;
    }
    case 'preview': { const p=person(v), m=mod(a.dataset.m); docModal(`Протокол № ${m.n} · ${esc(shortName(p.fio))}`, protocolDoc(p,m.id)); return; }
    case 'previewFinal': { const p=person(v); docModal(`Итоговый лист · ${esc(shortName(p.fio))}`, finalDoc(p)); return; }
    case 'copyDoc': copyText(document.getElementById('docText').innerText, 'Текст скопирован'); return;
    case 'copyTable': copyText(tableTSV(), 'Таблица скопирована — вставьте её в Excel (Ctrl+V)'); return;
    case 'closeModal': closeModal(); return;
    case 'openCo': S.ui.coId=v; S.ui.coTab='sheet'; break;
    case 'refillFinal': { delete S.ui.dec[S.ui.coId]; toast('Черновик пересобран по текущим данным'); break; }
    case 'addPlan': decDraft(person(S.ui.coId)).plan.push({t:'',o:'',d:plusDays(60)}); break;
    case 'delPlan': decDraft(person(S.ui.coId)).plan.splice(Number(v),1); break;
    case 'decide': {
      const p=person(S.ui.coId), d=decDraft(p), o=calcOverall(p), proposed=o.level?o.level.name:'—';
      if(o.assessed<MODULES.length){ toast('Оценены не все модули', true); return; }
      if(d.level!==proposed && !(d.just||'').trim()){ toast('Укажите обоснование: ступень отличается от предложенной системой', true); return; }
      p.decision={...clone(d), date:iso(), approved:false}; delete S.ui.dec[p.id];
      toast('Решение зафиксировано и отправлено на утверждение генеральному директору'); break;
    }
    case 'approve': { const p=person(S.ui.coId); p.decision.approved=true; p.level=p.decision.level; toast(`Утверждено. Ступень «${p.decision.level}» назначена`); break; }
    case 'setMod': S.ui.setMod=v; break;
    case 'addPos': S.settings.positions.push({name:'Новая должность', profile:[]}); break;
    case 'delPos': S.settings.positions.splice(Number(v),1); break;
    case 'reset': {
      if(!S.ui.resetArm){ S.ui.resetArm=true; break; }
      const role=S.ui.role; fresh(); S.ui.role=role; S.ui.setTab='rules'; toast('Демо-данные сброшены'); break;
    }
    default: return;
  }
  if(act!=='reset') S.ui.resetArm=false;
  render();
  if(scrollTop) window.scrollTo(0,0);
});

document.addEventListener('toggle', e=>{ const d=e.target; if(d.dataset && d.dataset.open){ S.ui.open[d.dataset.open]=d.open; save(); } }, true);

function field(e, isChange){
  const t=e.target, f=t.dataset&&t.dataset.f; if(!f) return;
  const num = x => { const n=parseFloat(String(x).replace(',','.')); return isNaN(n)?null:n; };
  switch(f){
    case 'emp': if(isChange){ S.ui.empId=t.value; S.ui.empMod=null; render(); } return;
    case 'asMod': if(isChange){ S.ui.asMod=t.value; S.ui.asTab='list'; S.ui.asId=null; render(); } return;
    case 'fpos': if(isChange){ S.ui.filt.pos=t.value; render(); } return;
    case 'fstage': if(isChange){ S.ui.filt.stage=t.value; render(); } return;
    case 'ans': { const p=person(S.ui.empId), mid=S.ui.empMod, key=p.id+mid; const d=S.ui.draft[key]||(S.ui.draft[key]={answers:{},caseAnswer:''}); d.answers[t.dataset.q]=Number(t.value); const el=$('#ansCount'); if(el) el.textContent=`Отвечено: ${Object.keys(d.answers).length} из ${questionsFor(p,mid).length}`; save(); return; }
    case 'case': { const p=person(S.ui.empId), key=p.id+S.ui.empMod; const d=S.ui.draft[key]||(S.ui.draft[key]={answers:{},caseAnswer:''}); d.caseAnswer=t.value; save(); return; }
    case 'cm': { const pm=person(S.ui.asId).mods[S.ui.asMod]; pm.scores[t.dataset.c]=pm.scores[t.dataset.c]||{v:null}; pm.scores[t.dataset.c].cm=t.value; save(); return; }
    case 'concl': person(S.ui.asId).mods[S.ui.asMod].concl[t.dataset.k]=t.value; save(); return;
    case 'method': { if(!isChange) return; const C=person(S.ui.asId).mods[S.ui.asMod].concl, m=t.dataset.v; C.methods = t.checked ? [...new Set([...C.methods,m])] : C.methods.filter(x=>x!==m); save(); return; }
    case 'dtype': if(isChange){ decDraft(person(S.ui.coId)).type=t.value; render(); } return;
    case 'dlevel': if(isChange){ decDraft(person(S.ui.coId)).level=t.value; render(); } return;
    case 'dtxt': decDraft(person(S.ui.coId))[t.dataset.k]=t.value; save(); return;
    case 'plan': decDraft(person(S.ui.coId)).plan[Number(t.dataset.i)][t.dataset.k]=t.value; save(); return;
    case 'set': if(isChange){ const n=num(t.value); if(n!=null) S.settings[t.dataset.k]=n; render(); } return;
    case 'weight': if(isChange){ const n=num(t.value); if(n!=null) S.settings.weights[t.dataset.m]=n; render(); } return;
    case 'mx': if(isChange){ const r=S.settings.req[S.ui.setMod][t.dataset.c]; if(t.type==='checkbox') r[t.dataset.k]=t.checked; else r[t.dataset.k]=t.value; render(); } return;
    case 'posname': { const pos=S.settings.positions[Number(t.dataset.i)], old=pos.name; pos.name=t.value; S.people.forEach(p=>{ if(p.position===old) p.position=t.value; }); save(); if(isChange) render(); return; }
    case 'posprof': if(isChange){ const pos=S.settings.positions[Number(t.dataset.i)], m=t.dataset.m; pos.profile = t.checked ? [...new Set([...pos.profile,m])] : pos.profile.filter(x=>x!==m); render(); } return;
    case 'lvl': {
      const l=S.settings.levels[Number(t.dataset.i)];
      if(t.dataset.k==='name'){ l.name=t.value; save(); return; }
      if(!isChange) return;
      if(t.dataset.k==='noDef') l.noDef=t.checked; else { const n=num(t.value); if(n!=null) l.min=n; }
      render(); return;
    }
  }
}
document.addEventListener('input', e=>field(e,false));
document.addEventListener('change', e=>field(e,true));
document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeModal(); });
window.addEventListener('hashchange', ()=>{ const h=location.hash.slice(1); if(['employee','assessor','commission','settings'].includes(h) && h!==S.ui.role){ S.ui.role=h; render(); } });

load();
(function(){ const h=location.hash.slice(1); if(['employee','assessor','commission','settings'].includes(h)) S.ui.role=h; })();
render();
