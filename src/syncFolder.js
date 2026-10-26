/* ══════════════════════════════════════════════════════════
   Local sync through a shared folder (v3.28)

   Both bridge computers point at the same folder on the ship's network
   drive. The plan lives in <folder>/decargo-plan.json:
     { app:'decargo', kind:'plan', schema:1, docId, commit, parent, rev,
       writerId, writerName, ts, appVersion, state }
   • Publishing (Operator only) goes through the Rust `shared_commit`
     command: OS lock + compare-and-swap on the commit id + atomic replace
     + bounded history in <folder>/history. A refused commit means someone
     else published since our base → the app's conflict bar decides.
   • Reading: every poll reads the whole file (mtime is only a hint on SMB)
     and applies it when its commit differs from ours and we have nothing
     unpublished.
   • Unpublished edits survive restarts: the base commit and a dirty flag
     are kept in localStorage; the plan itself is the app's own autosave.
   Nothing here touches the internet — only the folder.
══════════════════════════════════════════════════════════ */
import { invoke } from '@tauri-apps/api/core';

const POLL_MS = 1500;
const POLL_SLOW_MS = 5000;
const STATE_KEY = 'decargo_folderSync';
const DEVICE_KEY = 'decargo_deviceId';

let _cfg = null;              /* { mode:'folder', dir } */
let _status = 'disabled';
let _commit = null;           /* commit id we last published or applied */
let _rev = 0;
let _docId = null;
let _dirty = false;           /* local edits not yet published */
let _pending = null;          /* latest local plan waiting to be published */
let _lastSync = 0;
let _lastWriter = '';
let _errorCount = 0;
let _conflictOpen = false;
let _active = false;
let _timer = null;
let _busy = false;            /* one read/commit in flight at a time */
let _stateProvider = null;
let _computer = '';
let _onStatus = null, _onRemote = null, _onActivity = null, _onConflict = null;

const log = (...a) => console.log('[FolderSync]', ...a);
const warn = (...a) => console.warn('[FolderSync]', ...a);

const isViewer = () => typeof window !== 'undefined' && window.__spicaIsViewer && window.__spicaIsViewer();
const tauri = () => typeof window !== 'undefined' && !!(window.__TAURI_INTERNALS__ || window.__TAURI__);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

function _deviceId(){
  try{
    let id = localStorage.getItem(DEVICE_KEY);
    if(!id){ id = uid(); localStorage.setItem(DEVICE_KEY, id); }
    return id;
  }catch(e){ return 'device'; }
}
function _saveState(){
  try{ localStorage.setItem(STATE_KEY, JSON.stringify({ dir: _cfg && _cfg.dir, commit: _commit, rev: _rev, docId: _docId, dirty: _dirty })); }catch(e){}
}
function _loadState(dir){
  try{
    const s = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
    if(s && s.dir === dir){ _commit = s.commit || null; _rev = +s.rev || 0; _docId = s.docId || null; _dirty = !!s.dirty; return; }
  }catch(e){}
  _commit = null; _rev = 0; _docId = null; _dirty = false;
}

function _setStatus(s){
  if(_status === s) return;
  _status = s;
  if(_onStatus) _onStatus(s);
}
const _act = (dir, detail) => { if(_onActivity) _onActivity(dir, detail); };

export function getSyncStatus(){ return _status; }
export function getLastSyncTime(){ return _lastSync; }
export function getErrorCount(){ return _errorCount; }
export function getLastWriter(){ return _lastWriter; }
export function onStatusChange(fn){ _onStatus = fn; }
export function onRemoteUpdate(fn){ _onRemote = fn; }
export function onActivity(fn){ _onActivity = fn; }
export function onConflict(fn){ _onConflict = fn; }
export function setStateProvider(fn){ _stateProvider = fn; }
export function getSyncConfig(){ return _cfg; }

export function setSyncConfig(cfg){
  if(cfg && cfg.dir){
    const changed = !_cfg || _cfg.dir !== cfg.dir;
    _cfg = { mode: 'folder', dir: cfg.dir };
    if(changed) _loadState(cfg.dir);
    _errorCount = 0;
    _setStatus('offline');
  } else {
    stopSync();
    _cfg = null;
    _setStatus('disabled');
  }
  if(tauri() && !_computer) invoke('computer_name').then(n => { _computer = n || ''; }).catch(() => {});
}

/* ── document ── */
function _parse(text){
  try{
    const d = JSON.parse(text);
    if(!d || d.app !== 'decargo' || d.kind !== 'plan' || typeof d.commit !== 'string') return null;
    if(!d.state || !Array.isArray(d.state.cargo)) return null;
    return d;
  }catch(e){ return null; }
}
async function _read(){
  const r = await invoke('shared_read', { dir: _cfg.dir });
  if(!r.exists) return { exists: true, doc: null, empty: true };
  const doc = _parse(r.text || '');
  return { exists: true, doc, damaged: !doc };
}

function _hasLocalCargo(){
  try{ const st = _pending || (_stateProvider && _stateProvider()); return !!(st && st.cargo && st.cargo.length); }catch(e){ return true; }
}

function _adopt(doc){
  _commit = doc.commit; _rev = +doc.rev || 0; _docId = doc.docId || _docId;
  _lastWriter = doc.writerName || '';
  _lastSync = Date.now();
}

/* ══════════════ TEST ══════════════ */
export async function testConnection(){
  if(!_cfg || !_cfg.dir) return { ok: false, error: 'Choose a folder first' };
  if(!tauri()) return { ok: false, error: 'Folder sync works in the desktop app only' };
  try{
    const r = await invoke('shared_probe', { dir: _cfg.dir, write: !isViewer() });
    if(!r.ok) return { ok: false, error: r.error || 'Folder not reachable' };
    return { ok: true, writable: r.writable, hasPlan: r.has_plan };
  }catch(e){ return { ok: false, error: String(e && e.message || e) }; }
}

/* ══════════════ PUBLISH ══════════════ */
async function _commitDoc(state, force){
  const doc = {
    app: 'decargo', kind: 'plan', schema: 1,
    docId: _docId || uid(), commit: uid(), parent: _commit, rev: _rev + 1,
    writerId: _deviceId(), writerName: _computer, ts: Date.now(),
    appVersion: (typeof window !== 'undefined' && window.__decargoVersion) || '',
    state,
  };
  const r = await invoke('shared_commit', { dir: _cfg.dir, expected: _commit, doc: JSON.stringify(doc), force: !!force });
  return { r, doc };
}

export async function pushState(state){
  if(!_cfg || !_cfg.dir || _status === 'disabled' || !tauri()) return false;
  if(isViewer()) return false;
  _pending = state; _dirty = true; _saveState();
  if(_conflictOpen) return false;
  if(_busy){ return false; }          /* the poll loop publishes _pending next */
  return _publish(false);
}

async function _publish(force){
  if(!_pending) return false;
  _busy = true;
  _setStatus('syncing'); _act('push', 'start');
  try{
    const state = _pending;
    const { r, doc } = await _commitDoc(state, force);
    if(r.ok){
      _adopt(doc); _lastWriter = _computer;
      if(_pending === state){ _pending = null; _dirty = false; }
      _errorCount = 0; _saveState();
      _setStatus(_dirty ? 'pending' : 'synced'); _act('push', 'done');
      return true;
    }
    if(r.conflict){
      _act('push', 'conflict');
      _raiseConflict(r.current ? _parse(r.current) : null, r.error);
      return false;
    }
    warn('publish failed:', r.error);
    _errorCount++; _setStatus('offline'); _act('push', 'error');
    return false;
  }catch(e){
    warn('publish error:', e);
    _errorCount++; _setStatus('offline'); _act('push', 'error');
    return false;
  }finally{ _busy = false; }
}

function _raiseConflict(remote, error, firstLink){
  if(_conflictOpen) return;
  _conflictOpen = true; _setStatus('conflict');
  const local = _pending || (_stateProvider && _stateProvider());
  if(!_onConflict){ _conflictOpen = false; return; }
  _onConflict({
    localState: local,
    remoteState: remote ? remote.state : null,
    remoteTimestamp: remote ? remote.ts : Date.now(),
    remoteWriter: remote ? remote.writerName : '',
    damaged: !!error,
    firstLink: !!firstLink,
    /* Keep mine: rebase on what is in the folder now and publish — the
       compare-and-swap re-checks under the lock, so a third change still
       gets caught. */
    resolve: async (chosen) => {
      _conflictOpen = false;
      if(remote) { _commit = remote.commit; _rev = +remote.rev || _rev; _docId = remote.docId || _docId; }
      _pending = chosen || local; _dirty = true; _saveState();
      return _publish(!remote);
    },
    /* Use theirs: drop our unpublished edits. */
    accept: () => {
      _conflictOpen = false;
      if(remote) _adopt(remote);
      _pending = null; _dirty = false; _saveState();
      _setStatus('synced');
    },
  });
}

/* ══════════════ PULL ══════════════ */
export async function pullState(){
  if(!_cfg || !_cfg.dir || _status === 'disabled' || !tauri()) return null;
  _act('pull', 'start');
  try{
    const { doc } = await _read();
    if(!doc){ _act('pull', 'error'); return null; }
    _adopt(doc); _pending = null; _dirty = false; _saveState();
    _setStatus('synced'); _act('pull', 'done');
    return doc.state;
  }catch(e){ _setStatus('offline'); _act('pull', 'error'); return null; }
}

async function _poll(){
  if(!_active || !_cfg) return;
  let next = POLL_MS;
  if(!_busy && !_conflictOpen){
    _busy = true;
    try{
      const res = await _read();
      const doc = res.doc;
      if(res.empty){
        /* empty folder: the Operator seeds it with the current plan */
        if(!isViewer() && !_commit){
          _pending = _pending || (_stateProvider && _stateProvider()); _dirty = !!_pending;
        }
        _setStatus(_dirty ? 'pending' : 'synced');
      } else if(res.damaged){
        _errorCount++; _setStatus('error');
      } else if(_commit === null && !isViewer() && _hasLocalCargo()){
        /* first link of this computer to a folder that already holds a plan,
           while this computer has a plan of its own: never overwrite either
           side silently (an empty local deck just takes the folder's plan) */
        _busy = false;
        _pending = _pending || (_stateProvider && _stateProvider());
        _raiseConflict(doc, null, true);
      } else if(doc.commit === _commit){
        _lastWriter = doc.writerName || _lastWriter;
        _setStatus(_dirty ? 'pending' : 'synced');
      } else if(_dirty && !isViewer()){
        /* the other computer published while we have unpublished edits */
        _busy = false;
        _raiseConflict(doc, null);
      } else {
        _act('pull', 'start');
        _adopt(doc); _pending = null; _dirty = false; _saveState();
        _errorCount = 0; _setStatus('synced'); _act('pull', 'done');
        if(_onRemote) _onRemote(doc.state, { writer: doc.writerName, ts: doc.ts });
      }
      if(_status !== 'error') _errorCount = 0;
    }catch(e){
      _errorCount++; _setStatus('offline'); next = POLL_SLOW_MS;
    }finally{ _busy = false; }
    /* publish whatever is waiting (offline edits, empty folder seed) */
    if(_dirty && !isViewer() && !_conflictOpen && _status !== 'offline' && _status !== 'error'){
      if(!_pending && _stateProvider) _pending = _stateProvider();
      if(_pending) await _publish(false);
    }
  }
  if(_active) _timer = setTimeout(_poll, next);
}

export function startSync(){
  if(_active || !_cfg || !tauri()) return;
  _active = true;
  log('watching', _cfg.dir);
  _poll();
}
export function stopSync(){
  _active = false;
  clearTimeout(_timer); _timer = null;
}

/* Called when sync is first enabled: nothing to migrate — the first poll
   either adopts the plan already in the folder or seeds an empty one. */
export async function migrateIfNeeded(){ return null; }
