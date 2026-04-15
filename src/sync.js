/* ══════════════════════════════════════════════════════════
   SPICA TIDE — CouchDB Sync Service v3
   Direct REST API. Single-document sync.
   Long-polling for instant remote updates.
   Conflict protection + replication activity tracking.
   Full console logging for debugging.
══════════════════════════════════════════════════════════ */

const SYNC_DOC_ID = 'spica_tide_plan';
const POLL_TIMEOUT = 25000;
const RETRY_DELAY = 10000;

let _cfg = null;        // { url, db, username, password }
let _status = 'disabled';
let _rev = null;         // CouchDB _rev
let _lastSync = 0;
let _onStatus = null;
let _onRemote = null;
let _onActivity = null;  // callback for push/pull activity
let _onConflict = null;  // callback for conflict resolution
let _pollActive = false;
let _pollAbort = null;
let _errorCount = 0;

const log = (...args) => console.log('[Sync]', ...args);
const warn = (...args) => console.warn('[Sync]', ...args);
const err = (...args) => console.error('[Sync]', ...args);

/* ── Status ── */
function _setStatus(s) {
  if (_status === s) return;
  _status = s;
  log('Status:', s);
  if (_onStatus) _onStatus(s);
}

function _emitActivity(dir, detail) {
  if (_onActivity) _onActivity(dir, detail);
}

export function getSyncStatus() { return _status; }
export function getLastSyncTime() { return _lastSync; }
export function getErrorCount() { return _errorCount; }
export function onStatusChange(fn) { _onStatus = fn; }
export function onRemoteUpdate(fn) { _onRemote = fn; }
export function onActivity(fn) { _onActivity = fn; }
export function onConflict(fn) { _onConflict = fn; }

/* ── Config ── */
export function setSyncConfig(config) {
  _cfg = config;
  if (config?.url && config?.db) {
    log('Config set:', config.url + '/' + config.db);
    _setStatus('offline');
    _errorCount = 0;
  } else {
    log('Config cleared');
    _setStatus('disabled');
    stopSync();
  }
}
export function getSyncConfig() { return _cfg; }

/* ── Auth ── */
function _headers() {
  const h = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
  if (_cfg?.username && _cfg?.password) {
    h['Authorization'] = 'Basic ' + btoa(_cfg.username + ':' + _cfg.password);
  }
  return h;
}

function _baseUrl() { return _cfg.url.replace(/\/+$/, ''); }
function _dbUrl() { return _baseUrl() + '/' + _cfg.db; }
function _docUrl() { return _dbUrl() + '/' + SYNC_DOC_ID; }

/* ══════════════════════════════════════════════════════════
   TEST CONNECTION — verify CouchDB is reachable + auth works
══════════════════════════════════════════════════════════ */
export async function testConnection() {
  if (!_cfg?.url || !_cfg?.db) return { ok: false, error: 'No config' };

  log('Testing connection to', _dbUrl());

  try {
    // Step 1: Test server root
    const rootRes = await fetch(_baseUrl() + '/', { headers: _headers() });
    log('Root response:', rootRes.status, rootRes.statusText);

    if (!rootRes.ok) {
      const body = await rootRes.text().catch(() => '');
      return { ok: false, error: `Server error ${rootRes.status}: ${body.slice(0, 100)}` };
    }

    // Step 2: Test database exists
    const dbRes = await fetch(_dbUrl(), { headers: _headers() });
    log('DB response:', dbRes.status, dbRes.statusText);

    if (dbRes.status === 404) {
      return { ok: false, error: 'Database "' + _cfg.db + '" not found. Create it first.' };
    }
    if (dbRes.status === 401 || dbRes.status === 403) {
      _setStatus('auth_failed');
      return { ok: false, error: 'Authentication failed. Check username/password.' };
    }
    if (!dbRes.ok) {
      return { ok: false, error: `DB error ${dbRes.status}` };
    }

    const info = await dbRes.json();
    log('DB info:', info);
    _errorCount = 0;
    return { ok: true, dbName: info.db_name, docCount: info.doc_count };

  } catch (e) {
    err('Test connection failed:', e);
    return { ok: false, error: e.message || 'Network error — check URL and CORS' };
  }
}

/* ══════════════════════════════════════════════════════════
   PUSH — send local state to CouchDB
   With conflict detection: if remote changed, notify caller
══════════════════════════════════════════════════════════ */
export async function pushState(stateData) {
  if (!_cfg?.url || !_cfg?.db || _status === 'disabled') return false;
  /* Viewer mode: never write to CouchDB */
  if (typeof window !== 'undefined' && window.__spicaIsViewer && window.__spicaIsViewer()) return false;

  _setStatus('syncing');
  _emitActivity('push', 'start');

  const doc = {
    _id: SYNC_DOC_ID,
    timestamp: Date.now(),
    type: 'deck_plan',
    version: '2.3.0',
    state: stateData
  };
  if (_rev) doc._rev = _rev;

  try {
    log('PUSH to', _docUrl(), _rev ? '(rev: ' + _rev + ')' : '(new doc)');

    const res = await fetch(_docUrl(), {
      method: 'PUT',
      headers: _headers(),
      body: JSON.stringify(doc)
    });

    log('PUSH response:', res.status, res.statusText);

    if (res.status === 409) {
      // Conflict — remote has a newer revision
      warn('PUSH conflict (409). Remote has changed.');
      _emitActivity('push', 'conflict');

      // Fetch remote doc to compare
      const remote = await _fetchDoc();
      if (remote && remote.state) {
        // Ask the app to resolve the conflict
        if (_onConflict) {
          log('Delegating conflict resolution to app...');
          _onConflict({
            localState: stateData,
            remoteState: remote.state,
            remoteRev: remote._rev,
            remoteTimestamp: remote.timestamp,
            resolve: async (chosenState) => {
              // Push the chosen state with the remote's rev
              _rev = remote._rev;
              const ok = await pushState(chosenState);
              return ok;
            }
          });
          return false; // don't auto-resolve, let app decide
        }

        // Fallback: force-push local (overwrite remote)
        _rev = remote._rev;
        doc._rev = _rev;
        const retry = await fetch(_docUrl(), {
          method: 'PUT',
          headers: _headers(),
          body: JSON.stringify(doc)
        });
        log('PUSH retry:', retry.status);
        if (retry.ok) {
          const r = await retry.json();
          _rev = r.rev;
          _lastSync = Date.now();
          _errorCount = 0;
          _setStatus('synced');
          _emitActivity('push', 'done');
          return true;
        }
      }
      _errorCount++;
      _setStatus('error');
      _emitActivity('push', 'error');
      return false;
    }

    if (res.status === 401 || res.status === 403) {
      err('PUSH auth failed:', res.status);
      _errorCount++;
      _setStatus('auth_failed');
      _emitActivity('push', 'auth_failed');
      return false;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      err('PUSH failed:', res.status, body.slice(0, 200));
      _errorCount++;
      _setStatus('error');
      _emitActivity('push', 'error');
      return false;
    }

    const result = await res.json();
    _rev = result.rev;
    _lastSync = Date.now();
    _errorCount = 0;
    log('PUSH ok. New rev:', _rev);
    _setStatus('synced');
    _emitActivity('push', 'done');
    return true;

  } catch (e) {
    err('PUSH network error:', e.message);
    _errorCount++;
    _setStatus('offline');
    _emitActivity('push', 'error');
    return false;
  }
}

/* ══════════════════════════════════════════════════════════
   PULL — fetch doc from CouchDB
══════════════════════════════════════════════════════════ */
async function _fetchDoc() {
  try {
    const res = await fetch(_docUrl(), { headers: _headers() });
    if (res.status === 404) { log('Doc not found (first sync)'); return null; }
    if (res.status === 401 || res.status === 403) {
      _setStatus('auth_failed');
      return null;
    }
    if (!res.ok) { warn('Fetch doc:', res.status); return null; }
    return await res.json();
  } catch (e) {
    err('Fetch doc error:', e.message);
    return null;
  }
}

export async function pullState() {
  if (!_cfg?.url || !_cfg?.db || _status === 'disabled') return null;

  _setStatus('syncing');
  _emitActivity('pull', 'start');
  log('PULL from', _docUrl());

  const doc = await _fetchDoc();
  if (!doc || !doc.state) {
    _setStatus('offline');
    _emitActivity('pull', 'error');
    return null;
  }

  _rev = doc._rev;
  _lastSync = Date.now();
  _errorCount = 0;
  log('PULL ok. Rev:', _rev, 'Timestamp:', new Date(doc.timestamp).toLocaleString());
  _setStatus('synced');
  _emitActivity('pull', 'done');
  return doc.state;
}

/* ══════════════════════════════════════════════════════════
   LONG-POLLING — _changes feed for instant updates
   GET-based (no POST/filter — simpler, wider CORS support)
══════════════════════════════════════════════════════════ */
let _lastSeq = null;

export function startSync() {
  if (_pollActive) { log('Already polling'); return; }
  _pollActive = true;
  log('START long-poll sync');

  // Get initial sequence number, then start polling
  _initSeqAndPoll();
}

async function _initSeqAndPoll() {
  try {
    // Get current db update_seq to start polling from now
    const res = await fetch(_dbUrl(), { headers: _headers() });
    if (res.ok) {
      const info = await res.json();
      _lastSeq = info.update_seq;
      log('Initial seq:', _lastSeq);
      _setStatus('synced');
    }
  } catch (e) {
    warn('Cannot get initial seq:', e.message);
  }

  _pollLoop();
}

async function _pollLoop() {
  while (_pollActive) {
    if (_status === 'disabled' || !_cfg?.url) {
      await _sleep(5000);
      continue;
    }

    try {
      const changesUrl = _dbUrl() + '/_changes?feed=longpoll&timeout=' + POLL_TIMEOUT +
        '&since=' + encodeURIComponent(_lastSeq || 'now') +
        '&filter=_doc_ids&doc_ids=' + encodeURIComponent(JSON.stringify([SYNC_DOC_ID]));

      log('Long-poll waiting...', _lastSeq ? '(seq: ' + _lastSeq + ')' : '');

      _pollAbort = new AbortController();
      const res = await fetch(changesUrl, {
        method: 'GET',
        headers: _headers(),
        signal: _pollAbort.signal
      });

      if (!res.ok) {
        // Some CouchDB versions don't support _doc_ids filter via GET params
        // Fallback: simple poll without filter
        if (res.status === 400 || res.status === 404) {
          log('_doc_ids filter not supported, using simple poll');
          await _simplePollOnce();
          await _sleep(5000);
          continue;
        }
        warn('Long-poll error:', res.status);
        _errorCount++;
        _setStatus('offline');
        await _sleep(RETRY_DELAY);
        continue;
      }

      const data = await res.json();
      _lastSeq = data.last_seq || _lastSeq;

      const changed = data.results?.some(r => r.id === SYNC_DOC_ID);
      if (changed) {
        log('Remote change detected!');
        _emitActivity('pull', 'start');
        const doc = await _fetchDoc();
        if (doc && doc.state && doc._rev !== _rev) {
          log('Applying remote update. Rev:', doc._rev);
          _rev = doc._rev;
          _lastSync = doc.timestamp || Date.now();
          _errorCount = 0;
          _setStatus('synced');
          _emitActivity('pull', 'done');
          if (_onRemote) _onRemote(doc.state);
        } else {
          _emitActivity('pull', 'done');
        }
      }

      _setStatus('synced');

    } catch (e) {
      if (e.name === 'AbortError') { log('Poll aborted (stopSync)'); break; }
      warn('Poll error:', e.message);
      _errorCount++;
      _setStatus('offline');
      await _sleep(RETRY_DELAY);
    }
  }
  log('Poll loop ended');
}

/* Fallback: simple GET doc comparison */
async function _simplePollOnce() {
  const doc = await _fetchDoc();
  if (doc && doc.state && doc._rev !== _rev) {
    log('Simple poll: remote change detected');
    _emitActivity('pull', 'start');
    _rev = doc._rev;
    _lastSync = doc.timestamp || Date.now();
    _errorCount = 0;
    _setStatus('synced');
    _emitActivity('pull', 'done');
    if (_onRemote) _onRemote(doc.state);
  } else if (doc) {
    _setStatus('synced');
  }
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export function stopSync() {
  log('STOP sync');
  _pollActive = false;
  if (_pollAbort) { _pollAbort.abort(); _pollAbort = null; }
}

/* ══════════════════════════════════════════════════════════
   INITIAL MIGRATION — first launch seed
══════════════════════════════════════════════════════════ */
export async function migrateIfNeeded(localState) {
  if (!_cfg?.url || !_cfg?.db) return null;
  log('Migration check...');

  const remote = await _fetchDoc();
  if (remote && remote.state) {
    log('Remote doc exists — using remote state');
    _rev = remote._rev;
    _lastSync = remote.timestamp || Date.now();
    return remote.state;
  }

  if (localState) {
    log('No remote doc — pushing local state as seed');
    await pushState(localState);
  }
  return null;
}
