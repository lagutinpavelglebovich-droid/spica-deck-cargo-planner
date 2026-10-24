/* ════════════════════════════════════════════════════════════
   OUTLOOK WATCH — v3.16
   Finds load lists / backloads / manifests in the classic Outlook Inbox
   on THIS computer (Rust command `outlook_scan`, read-only, local) and
   offers them for import: a list in the Import window, and a card when
   a new one arrives while the planner is open.
   Nothing is sent anywhere; attachments are copied to the local temp
   folder only so the import can read them.
════════════════════════════════════════════════════════════ */

const LS_SEEN  = 'spicaTide_mailSeen';
const LS_DONE  = 'spicaTide_mailImported';
const LS_WATCH = 'spicaTide_mailWatch';
const PATTERN  = 'asco|ilms|loadout|load ?list|loadlist|back ?load|back-load|manifest|cargo list|lift list|deck cargo|MAN-[0-9]';
const DAYS = 7, EVERY_MS = 3 * 60 * 1000, FIRST_MS = 20 * 1000;

let API = null, last = null, timer = 0, busy = false;

const lsGet = (k, d) => { try{ const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }catch(e){ return d; } };
const lsSet = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const itemKey = it => it.key + '|' + it.name;

export function mailAvailable(){
  if(!API) return false;
  if(typeof window !== 'undefined' && window.__mailMock) return true;
  return API.isTauri() && /Windows/i.test(navigator.userAgent || '');
}
export function mailWatching(){ return lsGet(LS_WATCH, true) !== false; }

export function initMailWatch(api){
  API = api;
  if(!mailAvailable()) return;
  const box = document.getElementById('ascoMail');
  if(box) box.hidden = false;
  const w = document.getElementById('ascoMailWatch');
  if(w){
    w.checked = mailWatching();
    w.addEventListener('change', () => { lsSet(LS_WATCH, w.checked); schedule(w.checked ? 1500 : 0); renderList(); });
  }
  document.getElementById('ascoMailCheck')?.addEventListener('click', () => scan(true));
  renderList();
  schedule(FIRST_MS);
}

function schedule(ms){
  clearTimeout(timer); timer = 0;
  if(!mailWatching() || !ms) return;
  timer = setTimeout(async () => { await scan(false); schedule(EVERY_MS); }, ms);
}

/* Run a scan. manual = from the button (shows errors). */
export async function scan(manual){
  if(!mailAvailable() || busy) return last;
  busy = true; renderList();
  try{
    const call = window.__mailMock || ((c, a) => API.invoke(c, a));
    const raw = await call('outlook_scan', { days: DAYS, maxItems: 400, pattern: PATTERN });
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    let items = Array.isArray(data.items) ? data.items : (data.items ? [data.items] : []);
    items = items.filter(it => it && it.path && it.name)
      .sort((a, b) => String(b.received).localeCompare(String(a.received)));
    last = { at: new Date(), running: data.running !== false, items, error: '' };
    if(!manual) notifyNew(items);
    else markSeen(items);
  }catch(e){
    last = { at: new Date(), running: true, items: (last && last.items) || [], error: String(e && e.message || e).slice(0, 200) };
    if(manual) API.toast('Outlook check failed — ' + last.error, 'warn');
  }finally{
    busy = false; renderList();
  }
  return last;
}

function kindOf(it){
  const t = (it.name + ' ' + it.subject).toLowerCase();
  if(/asco|ilms|loadout/.test(t)) return 'ASCO load list';
  if(/back ?-?load/.test(t)) return 'Backload';
  if(/manifest|man-\d/.test(t)) return 'Manifest';
  if(/load ?list|loadlist/.test(t)) return 'Load list';
  return 'Cargo list';
}
function ago(iso){
  const d = new Date(iso); if(isNaN(d)) return '';
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if(m < 1) return 'just now';
  if(m < 60) return m + ' min ago';
  const h = Math.round(m / 60);
  if(h < 24) return h + ' h ago';
  return d.toLocaleDateString(undefined, { day:'numeric', month:'short' }) + ' ' + d.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });
}

function markSeen(items){
  const seen = new Set(lsGet(LS_SEEN, []));
  items.forEach(it => seen.add(itemKey(it)));
  lsSet(LS_SEEN, [...seen].slice(-400));
}
function notifyNew(items){
  const stored = lsGet(LS_SEEN, null);
  const seen = new Set(stored || []);
  const fresh = stored ? items.filter(it => !seen.has(itemKey(it))) : [];   /* first run ever: no flood */
  markSeen(items);
  if(!API.isOperator()) return;
  fresh.slice(0, 3).reverse().forEach(showCard);
}

async function importItem(it){
  if(!API.isOperator()){ API.toast('Viewer mode — import is not available', 'warn'); return; }
  try{
    const call = window.__mailMock || ((c, a) => API.invoke(c, a));
    const buf = await call('read_file_bytes', { path: it.path });
    const bytes = buf instanceof ArrayBuffer ? buf : (buf && buf.buffer) ? buf.buffer : new Uint8Array(buf || []).buffer;
    const file = new File([bytes], it.name, { type: '' });
    const done = new Set(lsGet(LS_DONE, [])); done.add(itemKey(it)); lsSet(LS_DONE, [...done].slice(-400));
    API.importFile(file);
    renderList();
  }catch(e){
    API.toast('Could not open the attachment — ' + String(e && e.message || e).slice(0, 120), 'warn');
  }
}

/* ── Import window list ───────────────────────────────────── */
function renderList(){
  const list = document.getElementById('ascoMailList'), meta = document.getElementById('ascoMailMeta');
  const btn = document.getElementById('ascoMailCheck');
  if(!list) return;
  if(btn){ btn.disabled = busy; btn.textContent = busy ? 'Checking…' : 'Check now'; }
  if(meta){
    meta.textContent = busy ? 'looking through the Inbox…'
      : !last ? (mailWatching() ? 'checks every 3 min' : 'not checked yet')
      : last.error ? 'last check failed'
      : !last.running ? 'Outlook is not open'
      : `checked ${last.at.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' })} · last ${DAYS} days`;
  }
  const items = (last && last.items) || [];
  const done = new Set(lsGet(LS_DONE, []));
  list.innerHTML = '';
  if(last && !last.running){ list.innerHTML = '<div class="asco-mail-empty">Open Outlook on this computer, then check again.</div>'; return; }
  if(last && last.error){ list.innerHTML = `<div class="asco-mail-empty">${esc(last.error)}</div>`; return; }
  if(last && !items.length){ list.innerHTML = `<div class="asco-mail-empty">No load lists, backloads or manifests in the Inbox in the last ${DAYS} days.</div>`; return; }
  items.slice(0, 8).forEach(it => {
    const row = document.createElement('div');
    row.className = 'asco-mail-row' + (done.has(itemKey(it)) ? ' done' : '');
    row.innerHTML = `
      <span class="asco-mail-kind">${esc(kindOf(it))}</span>
      <div class="asco-mail-main">
        <div class="asco-mail-name" title="${esc(it.name)}">${esc(it.name)}</div>
        <div class="asco-mail-sub" title="${esc(it.subject)}">${esc(it.from)} · ${esc(ago(it.received))} · ${esc(it.subject)}</div>
      </div>
      <button type="button" class="asco-mail-imp">${done.has(itemKey(it)) ? 'Again' : 'Import'}</button>`;
    row.querySelector('.asco-mail-imp').addEventListener('click', e => { e.stopPropagation(); importItem(it); });
    list.appendChild(row);
  });
}

/* ── New-mail card ───────────────────────────────────────── */
function showCard(it){
  let stack = document.getElementById('mailNoteStack');
  if(!stack){ stack = document.createElement('div'); stack.id = 'mailNoteStack'; stack.className = 'mail-note-stack'; document.body.appendChild(stack); }
  const card = document.createElement('div');
  card.className = 'mail-note';
  card.setAttribute('role', 'status');
  card.innerHTML = `
    <div class="mail-note-head"><span class="mail-note-dot"></span><span class="mail-note-k">New in Outlook · ${esc(kindOf(it))}</span>
      <button type="button" class="mail-note-x" title="Dismiss">✕</button></div>
    <div class="mail-note-name">${esc(it.name)}</div>
    <div class="mail-note-sub">${esc(it.from)} · ${esc(ago(it.received))}</div>
    <div class="mail-note-subj">${esc(it.subject)}</div>
    <div class="mail-note-act"><button type="button" class="mail-note-later">Later</button><button type="button" class="mail-note-imp">Import</button></div>`;
  const close = () => { card.classList.remove('in'); setTimeout(() => card.remove(), 220); };
  card.querySelector('.mail-note-x').addEventListener('click', close);
  card.querySelector('.mail-note-later').addEventListener('click', close);
  card.querySelector('.mail-note-imp').addEventListener('click', () => { close(); importItem(it); });
  stack.appendChild(card);
  requestAnimationFrame(() => card.classList.add('in'));
  try{ API.sound && API.sound(); }catch(e){}
}

/* test hooks */
export const _mail = { scan, renderList, state: () => last, kindOf };
