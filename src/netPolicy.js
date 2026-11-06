/* ══════════════════════════════════════════════════════════
   Internet use — user settings + IT policy (v3.43)

   The app reaches the internet for three things only. Each has a switch
   in Smart Tools → Internet, and IT can fix any of them with an optional
   policy file that overrides the switch and locks it:

     %ProgramData%\Decargo\policy.json     e.g.  {"updates":"off","weather":"on","maps":"on"}

     updates  automatic update check against GitHub. "off" (policy) also
              blocks the manual "Check for updates" and every download;
              the user setting "off" only stops the automatic checks.
     weather  Open-Meteo forecast for the working locations (coordinates only)
     maps     OpenStreetMap / OpenSeaMap tiles in the position-check map

   No file, an unreadable file or an unknown value → that key is not
   managed and the user's setting applies (default on).
══════════════════════════════════════════════════════════ */

export const NET_KINDS = ['updates', 'weather', 'maps'];
const LS = { updates: 'decargo_net_updates', weather: 'decargo_net_weather', maps: 'decargo_net_maps' };

let _policy = {};             /* kind → 'on' | 'off' (only managed keys) */
let _policyPath = '';
let _resolve;
const _ready = new Promise(r => { _resolve = r; });
const _listeners = new Set();

/* Called once at start-up with the Rust command result (or null). */
export function setPolicy(p){
  _policy = {};
  _policyPath = (p && typeof p.path === 'string') ? p.path : '';
  const v = p && p.values;
  if(v && typeof v === 'object'){
    NET_KINDS.forEach(k => { if(v[k] === 'on' || v[k] === 'off') _policy[k] = v[k]; });
  }
  _resolve();
  _emit();
}
/* wait for the policy before the first network request of the session */
export const netReady = () => _ready;
/* never let a missing Rust command hold the app offline for long */
setTimeout(() => _resolve(), 4000);

export function policyOf(kind){ return _policy[kind] || null; }
export function policyPath(){ return _policyPath; }
export function userSetting(kind){
  try{ return localStorage.getItem(LS[kind]) !== '0'; }catch(e){ return true; }
}
export function setUserSetting(kind, on){
  try{ localStorage.setItem(LS[kind], on ? '1' : '0'); }catch(e){}
  _emit();
}
/* the effective switch: policy first, then the user's setting */
export function netAllowed(kind){
  const p = policyOf(kind);
  if(p) return p === 'on';
  return userSetting(kind);
}
/* manual update check / download: blocked only by an IT policy */
export function updatesBlocked(){ return policyOf('updates') === 'off'; }

export function onNetChange(fn){ _listeners.add(fn); return () => _listeners.delete(fn); }
function _emit(){ _listeners.forEach(fn => { try{ fn(); }catch(e){} }); }
