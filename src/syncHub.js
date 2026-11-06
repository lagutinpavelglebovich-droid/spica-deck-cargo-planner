/* ══════════════════════════════════════════════════════════
   Sync hub — one API for the app over the only transport:
   a shared folder on the ship's network drive (syncFolder.js).
   v3.43 (IT review): the cloud (CouchDB) transport was removed; nothing
   in the sync path talks to the internet.
══════════════════════════════════════════════════════════ */
import * as Folder from './syncFolder.js';

export function setSyncConfig(cfg){
  Folder.setSyncConfig(cfg && cfg.mode === 'folder' ? cfg : null);
}
export const getMode = () => 'folder';
export const getSyncStatus = () => Folder.getSyncStatus();
export const getLastSyncTime = () => Folder.getLastSyncTime();
export const getErrorCount = () => Folder.getErrorCount();
export const getLastWriter = () => Folder.getLastWriter();
export const testConnection = () => Folder.testConnection();
export const pushState = s => Folder.pushState(s);
export const pullState = () => Folder.pullState();
export const startSync = () => Folder.startSync();
export const stopSync = () => Folder.stopSync();
export const setStateProvider = fn => Folder.setStateProvider(fn);
export const setPendingProvider = fn => Folder.setPendingProvider(fn);
export const onStatusChange = fn => Folder.onStatusChange(fn);
export const onRemoteUpdate = fn => Folder.onRemoteUpdate(fn);
export const onActivity = fn => Folder.onActivity(fn);
export const onConflict = fn => Folder.onConflict(fn);
