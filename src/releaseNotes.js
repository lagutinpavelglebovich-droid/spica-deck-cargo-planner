/* ════════════════════════════════════════════════════════════
   RELEASE NOTES REGISTRY — single source of truth

   To add notes for a new release:
   1. Prepend one object with version, date, highlights, changes
   2. Keep at minimum the last 3 versions
   Entries ordered newest first.

   Change types: feature, improvement, fix, ui, sync, breaking
════════════════════════════════════════════════════════════ */

export const RELEASE_NOTES = [
  {
    version: '2.2.1',
    date: '2026-04-15',
    highlights: [
      'Operator / Viewer access control mode',
      'NEW badge system for feature discovery',
      'Release notes and update history',
    ],
    changes: [
      { type: 'feature',     text: 'Operator mode with password-protected full editing' },
      { type: 'feature',     text: 'Viewer mode — read-only deck with live sync receive' },
      { type: 'feature',     text: 'Mode selector button in toolbar with login modal' },
      { type: 'feature',     text: 'NEW badge registry with auto-expiry after 3 versions' },
      { type: 'feature',     text: 'What\'s New modal shown after each update' },
      { type: 'feature',     text: 'Update History panel accessible from Help menu' },
      { type: 'sync',        text: 'CouchDB push blocked in Viewer mode; pull stays active' },
      { type: 'improvement', text: 'Mode persists across app restarts via localStorage' },
    ],
  },
  {
    version: '2.1.2',
    date: '2026-04-15',
    highlights: [
      'ASCO import auto-assigns food containers',
    ],
    changes: [
      { type: 'feature',     text: 'ASCO entries with "food" auto-assigned Mini Container (DNV) dimensions' },
      { type: 'ui',          text: 'Green "Auto: Mini Container (DNV)" badge in import modal and queue' },
    ],
  },
  {
    version: '2.1.1',
    date: '2026-04-15',
    highlights: [
      'About modal icon updated',
    ],
    changes: [
      { type: 'fix',         text: 'Replaced inline base64 About icon with local asset reference' },
    ],
  },
];
