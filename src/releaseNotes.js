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
    version: '3.22.2',
    date: '2026-10-25',
    highlights: [ 'Port and field weather side by side' ],
    changes: [
      { type: 'improvement', text: 'The header keeps the port / city weather and shows the weather at the working location next to it' },
    ],
  },
  {
    version: '3.22.1',
    date: '2026-10-25',
    highlights: [ 'Exact Windy colour scales' ],
    changes: [
      { type: 'fix', text: 'Wind, gusts, Hs, Hmax and swell now use Windy\'s own default colour scales, taken from windy.com itself (wind by m/s, waves by metres) — not an approximation' },
      { type: 'improvement', text: 'Swell cells are coloured on the waves scale, as on Windy' },
    ],
  },
  {
    version: '3.22.0',
    date: '2026-10-25',
    highlights: [
      'Field weather like Windy',
      'Weather of the location you work on, in the header',
    ],
    changes: [
      { type: 'improvement', text: 'Field Weather in the Windy layout: Wind, then Gusts, then a separate Direction row of arrows; Hs and below it Hmax; swell height and period' },
      { type: 'improvement', text: 'Windy colours: wind from blue through cyan, green, yellow, orange and red to magenta and purple as it grows; sea state in the same order by wave height. No more red for an ordinary day' },
      { type: 'feature', text: 'Wind in knots or m/s — switch in the Field Weather window; the header and the location cards follow' },
      { type: 'feature', text: 'The header shows the weather where you are working: the location of the selected unit, else the selected location, else the first one of the trip with a position (instead of the port). Click it for the 48 h forecast' },
      { type: 'improvement', text: 'Hmax ≈ 1.86 × Hs (the highest of about 1000 waves, ≈ 3 h); the rain row and the red limit colouring are gone' },
    ],
  },
  {
    version: '3.21.0',
    date: '2026-10-25',
    highlights: [
      'Pipe bundles of any size',
      'Non-standard units: your own name, size and outline',
    ],
    changes: [
      { type: 'improvement', text: 'Pipes: Single joint or Bundle. A bundle is 2 pipes or more, with no upper limit — type the number; pipes per layer is automatic or your own (layers nest like on deck). 2" and 3" added for small tubulars' },
      { type: 'feature', text: 'Non-standard unit: give it a name, size, weight and height, and pick an outline — Box, Rounded, Round, Frame — or ✎ Draw: click its corners on the deck and the unit takes exactly that shape (Enter to finish, Shift for square edges)' },
      { type: 'feature', text: 'Keep in Custom Cargo saves a non-standard unit as a template for next time' },
      { type: 'feature', text: 'Inspector → Kind of unit → Non-standard: change the outline, the height, or draw the outline of any unit already on deck' },
      { type: 'improvement', text: 'The ready-made lifeboat / rescue boat / cable reel presets are gone — a non-standard unit covers them and anything else' },
    ],
  },
  {
    version: '3.20.0',
    date: '2026-10-25',
    highlights: [
      'Weather at the working locations',
    ],
    changes: [
      { type: 'feature', text: 'View → Field Weather: wind, gusts, wave height (Hs), wind sea, swell height / period / direction, rain, air temperature and visibility at each platform\'s own position — now and the next 48 hours' },
      { type: 'feature', text: 'Your limits for wind and Hs: the forecast turns amber at 85 % and red at the limit; the location cards on the plan show wind and Hs right now in the same colours' },
      { type: 'feature', text: 'Vessel Setup → Locations → Position: type or paste it the way the ECDIS shows it (58 27.4N 000 15.2E), or in decimals' },
      { type: 'feature', text: 'Windy / Windy · waves opens windy.com at that position in the browser' },
      { type: 'improvement', text: 'Data from Open-Meteo, refreshed every 30 minutes; only the coordinates of the locations are sent' },
    ],
  },
  {
    version: '3.19.0',
    date: '2026-10-25',
    highlights: [
      'Pipes: joints and bundles',
      'Non-standard cargo',
    ],
    changes: [
      { type: 'feature', text: 'Library → Pipes & Special: pick the size (4" to 30" or any other), 1 to 5 pipes in the bundle and the joint length — footprint and an estimated weight (standard wall) come out by themselves; click or drag onto the deck' },
      { type: 'feature', text: 'Pipes are drawn as pipes: shaded tubes, thread protectors, bundle straps; in 3D the ends show the bundle as circles, stacked 3 + 2 like on deck' },
      { type: 'feature', text: 'Non-standard cargo: lifeboat, rescue boat, open frame, cable reel, out of gauge — each drawn as its own shape, with an orange outline and a NON-STD tag on the plan and in the PDF' },
      { type: 'feature', text: 'Inspector → Kind of unit: turn any unit into a pipe (size, pipes, joint length) or mark it non-standard' },
    ],
  },
  {
    version: '3.18.0',
    date: '2026-10-25',
    highlights: [
      'Deck editor 2.0',
      'Vessel Setup without a password',
    ],
    changes: [
      { type: 'improvement', text: 'Vessel Setup no longer asks for a password — a short confirmation instead (header editing too)' },
      { type: 'feature', text: 'Drag the tabs above the deck to move the joint between two bays — both lengths shown live; Shift moves the rest of the deck forward, the last tab sets the bow bay. Drag the STBD edge to make the deck wider or narrower' },
      { type: 'feature', text: 'Zones are styled one by one: stripes, solid colour, gradient or outline only, in any colour — the tiger strip and hose bays can be another colour or removed' },
      { type: 'feature', text: 'Methanol zone as a shape: arc line, circle, semicircle, quarter circle or rectangle, turned any way, with its own line width and an optional fill' },
      { type: 'feature', text: 'New on the deck: moonpool, hatches, openings in the crash barrier and free text labels anywhere' },
      { type: 'feature', text: 'Lashing points can be moved, added (dollies and D-rings) and removed — they snap to bay edges, mid-bays and deck edges' },
      { type: 'feature', text: 'Every zone chooses whether it counts in Deck Used; double-click a zone on the deck to rename it (Store → Bosun Workshop)' },
      { type: 'improvement', text: 'Changing a bay length keeps zones and lashing points in their place within the bay' },
    ],
  },
  {
    version: '3.17.0',
    date: '2026-10-24',
    highlights: [
      'Deck camera: record the loading',
      'Deck camera: read lifts from a video',
    ],
    changes: [
      { type: 'feature', text: 'Deck Camera → Record: records the bridge camera to a folder you choose, and next to the video keeps the load list, the Imported queue and every move you make on the plan with its time. Keeps recording when the window is closed — REC shows in the corner' },
      { type: 'feature', text: 'Deck Camera → Read lifts: open a video and the planner finds every lift, reads the unit number on the hook against the load list, Imported and the deck, and shows where it was lifted from or landed — Mark lifted or Place on plan in one click' },
      { type: 'improvement', text: 'Text on units standing on deck under the load is told apart from the load itself — it does not vote' },
      { type: 'improvement', text: 'Everything is read on this computer (PaddleOCR on ONNX Runtime); the first read takes a few seconds to load' },
    ],
  },
  {
    version: '3.16.0',
    date: '2026-10-24',
    highlights: [
      'Load lists straight from Outlook',
      'Drop files onto the window',
      'Deck camera calibration',
    ],
    changes: [
      { type: 'feature', text: 'Outlook: the Import window lists load lists, backloads and manifests from the Inbox of the last 7 days — Import in one click. Reads classic Outlook on this computer only; nothing is sent anywhere' },
      { type: 'feature', text: 'Outlook watch: a new load list or backload arriving while the planner is open shows a card with Import (switch off with Watch in the Import window)' },
      { type: 'feature', text: 'Drag a load list, backload or manifest anywhere onto the window to import it; drop a project file to open it' },
      { type: 'feature', text: 'Import: Select all / Clear all across every sheet and location at once' },
      { type: 'feature', text: 'View → Deck Camera: calibrate the bridge camera to the deck — 4 points plus painted bay numbers; the plan is drawn over the picture, with the error of every point shown' },
      { type: 'fix',     text: 'Dropping a file on the Import window now works in the desktop app (the window used to swallow it)' },
    ],
  },
  {
    version: '3.15.1',
    date: '2026-10-24',
    highlights: [
      'DG class badges stay inside the cargo block',
    ],
    changes: [
      { type: 'fix', text: 'DG class badges on small units (minis, tote tanks, baskets) no longer stick out over the edge and under neighbouring cargo — they sit in the corner inside the block' },
      { type: 'fix', text: 'The unit number moves below the DG badge and is sized to fit, so the two never overlap' },
      { type: 'improvement', text: 'Unit numbers are fitted using the real text width, so a label no longer wraps unexpectedly on small blocks' },
    ],
  },
  {
    version: '3.15.0',
    date: '2026-10-24',
    highlights: [
      'Finish loading — close the load list when the job is done',
    ],
    changes: [
      { type: 'feature', text: 'LOAD LIST chip has a ✓ button: when everything is on deck it turns green and says Finish — one click closes the list' },
      { type: 'feature', text: 'Finishing early (the platform says "that\'s all"): the first click asks "Finish 30/33?", the second confirms; the toast tells how many were not loaded' },
      { type: 'ui',      text: 'Closing fills the bar, ticks and folds the chip away; Undo in the toast brings it back' },
      { type: 'improvement', text: 'A finished load list is not carried into the next import' },
    ],
  },
  {
    version: '3.14.3',
    date: '2026-10-23',
    highlights: [
      'Unit numbers stand out in the import list',
    ],
    changes: [
      { type: 'ui', text: 'Import list: the unit number (CCU) leads each row in large bold type; the description follows. Rows without a number say "no CCU"' },
      { type: 'ui', text: 'Dark theme: DG, Heavy Lift, "Size not detected" and Auto badges in the import list are readable' },
    ],
  },
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
