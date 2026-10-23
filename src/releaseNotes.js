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
    version: '3.14.2',
    date: '2026-10-23',
    highlights: [
      'ASCO load lists in the new iLMS layout import with unit numbers and weights',
    ],
    changes: [
      { type: 'fix', text: 'ASCO import: unit numbers (CCU) and estimated weights were empty for load lists in the current iLMS layout — now read from the "CCU / Lifts" and "Est WT" columns' },
      { type: 'fix', text: 'ASCO import: when the Loadlist ID is only a file name, the location is taken from "Location:" (e.g. BLEOHOLM)' },
      { type: 'fix', text: 'The "ROB Lines" sheet (units remaining on board) is not imported as cargo to load' },
    ],
  },
  {
    version: '3.14.1',
    date: '2026-10-23',
    highlights: [
      'Security update of PDF, Excel and file libraries',
    ],
    changes: [
      { type: 'fix',         text: 'PDF reader updated: a crafted PDF can no longer run code when imported' },
      { type: 'fix',         text: 'PDF export and Excel libraries updated to versions without known vulnerabilities; exports look the same' },
      { type: 'fix',         text: 'Text PDF manifests: a quantity column is no longer read as weight, and a table continued on page 2 stays one section' },
    ],
  },
  {
    version: '3.14.0',
    date: '2026-10-23',
    highlights: [
      'Import platform backloads and manifests — Excel, Word, PDF, even scanned',
    ],
    changes: [
      { type: 'feature',     text: 'Import window reads backloads and manifests from any platform: Excel in any layout, Word tables, PDF — and scanned PDFs, recognised on this computer' },
      { type: 'feature',     text: 'Each section shows Backload / Load and the location (found from the title, "Platform:" or the file name); change either before adding to Imported' },
      { type: 'feature',     text: 'Backload items keep their direction: placed on deck they come in as Backload' },
      { type: 'improvement', text: 'Scanned files are marked "check numbers"; a code one character off a unit already known is corrected to it' },
      { type: 'improvement', text: 'Files with both a backload and an offload tick the backload rows only; units already on deck or in Imported are skipped as before' },
    ],
  },
  {
    version: '3.13.1',
    date: '2026-10-23',
    highlights: [
      'Workshop zones and zones on both sides',
    ],
    changes: [
      { type: 'feature',     text: 'Vessel Setup: Workshop zone type — not counted as usable deck, like the store' },
      { type: 'feature',     text: 'Copy any zone to the other side of the deck (PORT ↔ STBD) or duplicate it' },
      { type: 'improvement', text: 'Adding a bay at the bow moves the bow zones (store, No DG area) with it' },
    ],
  },
  {
    version: '3.13.0',
    date: '2026-10-23',
    highlights: [
      'Several vessels, each with its own deck, locations and charterer',
    ],
    changes: [
      { type: 'feature',     text: 'Vessel Setup: pick the vessel in use or add a new one — name it first, then set up its deck (copy of the current vessel or an empty deck)' },
      { type: 'feature',     text: 'Locations belong to the vessel: rename, add or delete them, set Platform / FPSO, "always grey" and the ASCO names that mean this location' },
      { type: 'feature',     text: 'The charterer on the PDF is kept per vessel' },
      { type: 'improvement', text: 'The header shows the vessel in use; saved plans remember their vessel and opening one switches to it' },
    ],
  },
  {
    version: '3.12.0',
    date: '2026-10-23',
    highlights: [
      'Vessel Setup: set up the deck of any vessel',
    ],
    changes: [
      { type: 'feature',     text: 'Edit → Vessel Setup… (admin password): vessel name, deck width, joint width, max deck load and pressure, clear deck area, and whether Bay 1 is at the bow or the stern' },
      { type: 'feature',     text: 'Bays: change any bay length, add a bay at the stern or bow, remove bays, choose which bays count towards Deck Used' },
      { type: 'feature',     text: 'Zones: add hose bays, no-cargo areas, No DG areas, stores, waste skips, tiger strip and the methanol line; drag and resize them on the deck, with snapping to bay and deck edges (Alt for free)' },
      { type: 'feature',     text: 'The deck redraws live while you edit; Cancel puts everything back, Save keeps it' },
      { type: 'feature',     text: 'Export a vessel profile to a file and import it on another vessel; Reset to SPICA TIDE restores the measured layout' },
      { type: 'improvement', text: 'PDF, Excel, the deck caption and the 3D view follow the vessel profile (name, size, bay numbers)' },
    ],
  },
  {
    version: '3.11.1',
    date: '2026-10-23',
    highlights: [
      'Charterer name is editable',
    ],
    changes: [
      { type: 'feature', text: 'Edit → Charterer… sets the charter name printed on the PDF deck plan (header and footer); leave it empty to print none' },
    ],
  },
  {
    version: '3.11.0',
    date: '2026-10-22',
    highlights: [
      'Status for many cargo at once',
      'Re-import shows what changed in the load list',
      'Limited Quantity DG mark and Glass setting',
    ],
    changes: [
      { type: 'feature',     text: 'Multi-select: box-select cargo on the deck and set Load / Backload / ROB / Transfer for all of them in the inspector, or press S; one Undo puts them back' },
      { type: 'feature',     text: 'Re-import: the ASCO window lists cargo on deck whose weight, size, DG or location changed in the new list, and Load cargo that was dropped from it; they get a marker on the deck until you dismiss it in the inspector' },
      { type: 'feature',     text: 'Re-import can update the weight and DG of the cargo on deck to the new list in one go' },
      { type: 'feature',     text: 'DG: Limited Quantity (LQ) — the black-and-white diamond without a class number; read from ASCO ("LQ", "LTD QTY"); no segregation applied' },
      { type: 'ui',          text: 'Smart Tools → Glass: Solid, Frosted or Clear panels, in light and dark theme' },
      { type: 'feature',     text: 'Resize from any side: grips on the edge centres change one side only, with a live size in metres; sizes snap to standard units, Shift resizes both sides, Alt turns snapping off' },
      { type: 'ui',          text: 'Drag Ghost Trail: while moving cargo its old place stays as a ghost with a lead line to the new spot; Esc puts it back' },
      { type: 'improvement', text: 'Lift-order numbering removed (the order is decided on the platform)' },
    ],
  },
  {
    version: '3.10.0',
    date: '2026-10-21',
    highlights: [
      '3D deck view and fly-to-cargo',
      'Load list progress, lift order and crane lift-off',
      'Night floodlights and wet deck in Atmosphere',
    ],
    changes: [
      { type: 'feature',     text: '3D deck view (V or the 3D button): the deck tilts into perspective and cargo rises as boxes at typical unit heights, with shadows, night floodlights and rain; V or Esc returns to the plan' },
      { type: 'feature',     text: 'Fly to cargo: F, the command palette (Ctrl+K), Enter in the Library search or a click on an On-deck Imported card glides the view to the cargo and selects it' },
      { type: 'feature',     text: 'Lifted: mark cargo as lifted off at the platform (inspector or Edit menu); it rises away on a crane wire, Undo brings it back' },
      { type: 'ui',          text: 'Atmosphere lights the deck: after dark the plating dims under warm floodlight pools; rain adds a wet sheen and light reflections' },
      { type: 'ui',          text: 'Header counters roll like an odometer; LOAD LIST flashes green with a short chime when everything is on deck' },
      { type: 'ui',          text: 'Dropped cargo settles with a brief footprint; newly imported cargo slides into Imported one by one' },
      { type: 'improvement', text: 'Library and inspector no longer cover Bays 3–1: the deck moves left and fits beside the open panel, and returns when it closes' },
      { type: 'improvement', text: 'DG ON BOARD opens every current segregation conflict, including acknowledged ones; Locate flies to the cargo' },
      { type: 'improvement', text: 'Command palette: 3D view, lift order, Lifted and DG conflicts' },
      { type: 'fix',         text: 'Fit is exact at launch and after resizing the window (the bow was clipped at start-up)' },
      { type: 'fix',         text: 'Keyboard shortcuts sheet covers the header; About shows the app icon; Smart Tools text in English' },
      { type: 'ui',          text: 'Readable Update History, About and ASCO import windows; "Not saved to file" instead of "Unsaved" next to Autosave' },
      { type: 'ui',          text: 'Alignment pass: location cards on the page centre line, one style for all header stat labels, header controls flush right, matched capsule heights, larger zoom −/+' },
      { type: 'fix',         text: 'Cargo kept its colour while being removed (it turned grey during the exit animation)' },
      { type: 'feature',     text: 'Load list progress: LOAD LIST n / m shows how much of the imported ASCO list is on deck (per location in the tooltip); click to open Imported' },
      { type: 'feature',     text: 'Lift order: Edit → Number Lift Order numbers Load and Transfer lifts per location (priority first, then aft to fore); edit any number in the inspector; shown on the deck, in the PDF and in Excel' },
      { type: 'feature',     text: 'Inspector: edit cargo size in metres (along / across the deck) and the lift number' },
      { type: 'improvement', text: 'Library search highlights matching cargo on deck and dims the rest for as long as the search is active' },
      { type: 'improvement', text: 'DG ON BOARD shows vessel totals as coloured IMDG class chips with the number of DG lifts' },
      { type: 'fix',         text: 'Zoom and Fit: the deck drifted left and up at any zoom other than 100% and the bow was clipped at Fit; it is now centred and fully visible' },
      { type: 'fix',         text: 'Location pills: larger status letters; the status light no longer reads as the letter O' },
      { type: 'fix',         text: 'DG badges on small cargo sit on the block edge and no longer cover the CCU' },
      { type: 'fix',         text: 'PDF includes Transfer cargo (KPI card and location pills)' },
      { type: 'fix',         text: 'Undo after opening a project no longer brings back the previous plan' },
      { type: 'fix',         text: 'Viewer mode cannot delete, undo, clear the deck or edit the voyage number' },
      { type: 'fix',         text: 'Shift + Up / Down moves exactly 1 m across the deck' },
      { type: 'fix',         text: 'Inspector shows descriptions that are not in the library list instead of a blank field' },
      { type: 'fix',         text: 'Inspector and Library open below the header instead of covering its buttons' },
      { type: 'fix',         text: 'Arrow keys and shortcuts work right after launch (the city search no longer takes keyboard focus)' },
      { type: 'fix',         text: 'Resizing by a corner keeps cargo on the deck; Duplicate places the copy in free space' },
      { type: 'fix',         text: 'Two-device sync: an unsaved local change is no longer overwritten silently by a remote update' },
      { type: 'ui',          text: 'Distinct Smart Tools icon (it duplicated the theme sun); better contrast for NO DG CARGO and small labels in dark mode; smoother Library close' },
    ],
  },
  {
    version: '3.9.0',
    date: '2026-10-21',
    highlights: [
      'Live volumetric sky for Atmosphere mode',
      'Accurate DG segregation distances',
      'Larger, clearer printed deck plan',
    ],
    changes: [
      { type: 'fix',         text: 'DG segregation measures true edge-to-edge distance in metres; no more alarms for units far apart in the same row or bays' },
      { type: 'fix',         text: 'Across-deck MINI clearances were 22% too large; zones on deck now match the check exactly' },
      { type: 'fix',         text: 'Drag preview only highlights DG units the new position actually infringes' },
      { type: 'fix',         text: 'ASCO hazard classes such as "3.0", "1.4S" and "8 (3)" are recognised; a class without division uses its strictest division' },
      { type: 'fix',         text: 'Cargo labels shrink with small blocks instead of disappearing, including while resizing' },
      { type: 'feature',     text: 'Atmosphere (Cinematic): real-time volumetric clouds, sun and moon by local time, rain on glass, snow, fog and lightning' },
      { type: 'improvement', text: 'PDF: taller deck plan, larger cargo labels on a light plate, location-type icons instead of colour dots' },
      { type: 'improvement', text: 'Updates are checked at every launch and every 12 hours while the app is open' },
      { type: 'fix',         text: 'Deck Used counts only the usable deck: Bays 12–2 without the tiger strip, both hose bays and the waste skip (Bay 1 excluded)' },
      { type: 'fix',         text: 'Re-importing a load list adds only cargo not yet on deck or in Imported: CCUs match regardless of spaces or dashes, rows without a CCU match by description, weight and location, and cargo dropped from the new list leaves Imported' },
      { type: 'improvement', text: 'Import window marks rows already On deck or In Imported and pre-selects only new cargo' },
      { type: 'fix',         text: 'Rotated cargo keeps its true size (it was distorted by about 20%); plans saved with distorted blocks are corrected on load' },
      { type: 'fix',         text: 'Imported sizes snap to a library type only when both sides match, not just the area' },
      { type: 'fix',         text: 'Bloom Picker: clicking a colour petal now applies it' },
    ],
  },
  {
    version: '3.8.0',
    date: '2026-06-11',
    highlights: [
      'ASCO re-import dedup by CCU',
      'Per-status location colors with Bloom Picker',
      'White glass light theme for Library and Smart Tools',
    ],
    changes: [
      { type: 'fix',     text: 'ASCO re-import deduplicates against the Import Queue and cargo already on deck by CCU; summary toast shows added/skipped counts' },
      { type: 'feature', text: 'Per-status location colors — click a status pill (Operator) to pick a custom color via the new Bloom Picker' },
      { type: 'sync',    text: 'Custom status colors sync to Viewer' },
      { type: 'ui',      text: 'Light theme: Cargo Library and Smart Tools panels redesigned in white glass' },
    ],
  },
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
