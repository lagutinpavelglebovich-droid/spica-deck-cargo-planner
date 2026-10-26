/* ══════════════════════════════════════════════════════════
   Sync hub (v3.28) — one API for the app, two transports:
   • 'folder' — local: a shared folder on the ship's network drive
   • 'cloud'  — CouchDB (kept for later, off by default)
   Only one transport is live at a time; the other is fully stopped, so
   local mode never talks to the cloud.
══════════════════════════════════════════════════════════ */
import * as Cloud from './sync.js';
import * as Folder from './syncFolder.js';

let _active = Folder;
const both = fn => { fn(Cloud); fn(Folder); };

export function setSyncConfig(cfg){
  if(cfg && cfg.mode === 'folder'){ Cloud.setSyncConfig(null); _active = Folder; Folder.setSyncConfig(cfg); }
  else if(cfg){ Folder.setSyncConfig(null); _active = Cloud; Cloud.setSyncConfig(cfg); }
  else { Cloud.setSyncConfig(null); Folder.setSyncConfig(null); }
}
export const getMode = () => (_active === Folder ? 'folder' : 'cloud');
export const getSyncStatus = () => _active.getSyncStatus();
export const getLastSyncTime = () => _active.getLastSyncTime();
export const getErrorCount = () => _active.getErrorCount();
export const getLastWriter = () => (_active.getLastWriter ? _active.getLastWriter() : '');
export const testConnection = () => _active.testConnection();
export const pushState = s => _active.pushState(s);
export const pullState = () => _active.pullState();
export const startSync = () => _active.startSync();
export const stopSync = () => both(m => m.stopSync());
export const migrateIfNeeded = s => _active.migrateIfNeeded(s);
export const setStateProvider = fn => Folder.setStateProvider(fn);
export function onStatusChange(fn){ both(m => m.onStatusChange(fn)); }
export function onRemoteUpdate(fn){ both(m => m.onRemoteUpdate(fn)); }
export function onActivity(fn){ both(m => m.onActivity(fn)); }
export function onConflict(fn){ both(m => m.onConflict(fn)); }
