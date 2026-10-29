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
    version: '3.40.0',
    date: '2026-10-29',
    highlights: [ 'Watch lifts: the deck camera locks on the load, reads its number and shows where it comes down' ],
    changes: [
      { type: 'feature', text: 'Watch lifts (Deck camera): play a video or start the camera — the load on the hook is locked and followed while it swings and hovers, its painted number is read when it can be seen, and a shadow on the deck shows where it is coming down, with the bay and side' },
      { type: 'feature', text: 'Set-downs and lift-offs are listed with the bay. A load list is not needed; with one, the number is checked against it and the unit can be placed from Imported or marked lifted with one click. A unit that could not be read can be picked from Imported' },
      { type: 'feature', text: 'Numbers painted on units already standing on deck are learned first, so a load swinging over them is not reported as one of them' },
      { type: 'improvement', text: 'Calibration reopens on the picture it was made on (kept on this computer) with the deck lines drawn — no more points on a black screen' },
      { type: 'ui', text: 'Clearer Picture panel: live camera or a video/photo file; Record video now says what it is for and that it needs the live camera' },
      { type: 'improvement', text: 'Text reading runs in the background, so the video and the lock do not stutter' },
    ],
  },
  {
    version: '3.39.0',
    date: '2026-10-29',
    highlights: [ 'Calibrate the deck camera even when corners are hidden or outside the picture' ],
    changes: [
      { type: 'feature', text: 'Guide lines: draw a line over any deck line you can see — the foot of the port or starboard crash barrier, the stern edge or a bay joint — even a short stretch of it. Both deck edges plus two cross lines are enough, no corner needed' },
      { type: 'feature', text: 'Corner points are optional and can be placed beside the picture: tick "Room around the picture" to get space around the frame' },
      { type: 'feature', text: 'Fine-tune: move, rotate, size and tilt (top/bottom, left/right) the drawn deck by hand, Lightroom-style' },
      { type: 'feature', text: 'Lens curvature correction with an Auto button — bend a guide line onto a curved deck edge with its middle handle and press Auto' },
      { type: 'ui', text: 'Every point and line shows its error in metres; a point or line can be removed with ✕' },
    ],
  },
  {
    version: '3.38.1',
    date: '2026-10-29',
    highlights: [ 'Deck camera calibration you can follow' ],
    changes: [
      { type: 'ui', text: 'Calibration shows a deck map as the bridge camera sees it (stern at the top, port on the right) with the spot to click next ringed, and says it in words: "Click where the joint between Bay 3 and Bay 2 meets the PORT side"' },
      { type: 'ui', text: 'Plain names: stern corner port / starboard, Bay 3/2 joint port / starboard; optional bay centres explained (middle of the bay on the centreline, where the number is painted)' },
    ],
  },
  {
    version: '3.38.0',
    date: '2026-10-29',
    highlights: [ 'Licence keys — enter your vessel\u2019s key once' ],
    changes: [
      { type: 'breaking', text: 'Decargo now needs a licence key for your vessel. Paste it once in the window that opens (Help → Licence… to change it later). Keys are issued by the developer, Pavlo Lagutin' },
      { type: 'feature', text: 'The licence holder is printed on every PDF and in the Excel summary, and shown in About' },
      { type: 'feature', text: 'A reminder appears 30 days before a licence ends; without a valid key Decargo does not open the plan — your plans stay saved on this computer' },
    ],
  },
  {
    version: '3.37.4',
    date: '2026-10-26',
    highlights: [ 'English only — language switch removed' ],
    changes: [
      { type: 'ui', text: 'The language switch is gone from the header: Decargo is English only. Anyone who had switched to Russian or Ukrainian is back on English' },
    ],
  },
  {
    version: '3.37.3',
    date: '2026-10-26',
    highlights: [ 'Explosives next to explosives — advisory per GOMO UKCS' ],
    changes: [
      { type: 'feature', text: 'Two Class 1 units within 3 MINI of each other now raise an amber advisory: "See introduction of Class 1 for segregations within group" (GOMO UKCS Supplement §2.3). The decision stays with the operator — mark it reviewed once checked' },
      { type: 'ui', text: 'The DG card names its source: GOMO UKCS Supplement §2.3 segregation table, Rev 3' },
    ],
  },
  {
    version: '3.37.2',
    date: '2026-10-26',
    highlights: [ 'Safer reading of scanned load lists and deck videos' ],
    changes: [
      { type: 'fix', text: 'Scanned PDFs from black-and-white office scanners (CCITT / JBIG2) are now read — they used to come out as "No cargo rows"' },
      { type: 'fix', text: 'Scanned weights: two agreeing readings are no longer overruled by one with a decimal point (14 t stays 14 t, 2350 kg stays 2.35 t) — doubtful ones are marked "check weight"' },
      { type: 'fix', text: 'Scanned cells keep short code prefixes and units: "AB 1234" stays AB 1234, "850 kg" is 0.85 t (was 850 t), ".85" is 0.85, "4 x 2.5 te" is 2.5 t per unit' },
      { type: 'fix', text: 'Deck video: stencilled weights ("MGW 5820 KG", "TARE 1820") no longer match a unit; one wrong character is only a "Maybe", never "Sure"' },
      { type: 'fix', text: 'Deck video: a damaged or closed video stops the reading with a message instead of hanging; memory use on long clips cut sharply' },
      { type: 'fix', text: 'A plan double-clicked while Decargo is still starting is opened once it is ready, not lost' },
    ],
  },
  {
    version: '3.37.1',
    date: '2026-10-26',
    highlights: [ 'Fixes the broken layout after 3.37.0', 'DG segregation per GOMO UKCS Rev 3' ],
    changes: [
      { type: 'fix', text: 'The deck, library and panels display correctly again — 3.37.0 showed a tiny deck and a loose card list on Windows. Your plan was never affected' },
      { type: 'improvement', text: 'DG segregation table updated to GOMO UKCS Supplement §2.3, Revision 3 (August 2026): 19 class pairs changed' },
      { type: 'fix', text: 'Scanned load lists: a weight of 10–99 t is no longer silently divided by 10 — it is kept and marked "check weight"' },
      { type: 'fix', text: 'Scanned load lists: a CCU one character off a unit already on deck is no longer renamed — it is marked "same as …?" and imports as read' },
    ],
  },
  {
    version: '3.37.0',
    date: '2026-10-26',
    highlights: [ 'Safer plans and sync', 'Faster and calmer on the bridge PC', 'Double-click a plan to open it' ],
    changes: [
      { type: 'fix', text: 'A damaged plan — opened, restored, received from the other PC or stored — can no longer half-replace the plan or stop Decargo from starting; it is set aside and the backups are offered' },
      { type: 'fix', text: 'Shared folder: when the other PC changes the plan while you have an edit waiting, Decargo always asks which to keep — it no longer overwrites the other PC after 30 seconds' },
      { type: 'fix', text: 'Undo / redo now reach the other bridge PC' },
      { type: 'fix', text: 'Save, Save As and backups keep the load list' },
      { type: 'fix', text: 'Undoing a placement from the import queue puts the lift back in the queue' },
      { type: 'fix', text: 'Imported weights: "1,250 kg", "2,5 t", "12 500", tonnes over 60 t and negative values are read correctly' },
      { type: 'feature', text: 'DG cargo standing in a NO DG CARGO area is flagged like a segregation conflict (limited quantities excepted)' },
      { type: 'fix', text: 'A plan made for another vessel switches to that vessel BEFORE placing its cargo, so nothing moves' },
      { type: 'fix', text: 'A unit longer than the deck is wide can no longer be turned across it' },
      { type: 'fix', text: 'Viewer mode keeps the red DG conflict outlines' },
      { type: 'fix', text: 'Ctrl+Shift+S / Ctrl+Shift+Z work, also with Caps Lock; Ctrl+Z in a text field undoes the typing, not the plan' },
      { type: 'fix', text: 'The plan date rolls over at midnight only if it was today — a date you picked or an older plan keeps its date' },
      { type: 'fix', text: 'Dropping a unit after an undo or a remote update mid-drag no longer loses the move; negative weights are refused' },
      { type: 'improvement', text: 'Security: Content-Security-Policy on, imported names are always shown as text, unused file-system plugin removed, file reads/writes run off the UI thread with size limits' },
      { type: 'improvement', text: 'Performance: idle CPU down ~20× (weather icon and header animation pause when not needed), smooth dragging with hundreds of units, instant zoom-out, faster DG checks and location strip, start-up bundle halved' },
      { type: 'feature', text: 'Double-clicking a plan file opens it in Decargo; a second double-click opens the plan in the running window instead of a second copy of the app' },
      { type: 'feature', text: 'The window remembers its size, position and maximised state' },
      { type: 'feature', text: 'Ctrl+= / Ctrl+- / Ctrl+0 zoom the deck, Ctrl+F searches cargo (command palette)' },
      { type: 'ui', text: 'Delete / rotate / copy buttons keep the same size at every zoom; menus and dialogs are solid; keyboard focus is visible; hovering a unit shows its full name, size and weight' },
      { type: 'ui', text: 'The window title shows the open file and a • when it has unsaved changes' },
      { type: 'fix', text: 'Tab moves between buttons in dialogs (Clear Deck confirm was unreachable); right-click selects the unit it opens the menu for' },
      { type: 'fix', text: 'Reload (F5 / Ctrl+R) and the browser context menu can no longer drop the session in the desktop app' },
      { type: 'fix', text: 'Export PDF writes exactly where you chose even if Print is pressed meanwhile, and no longer shows a misleading "open manually" message' },
      { type: 'fix', text: 'The "Undo" on a lift message undoes that lift only — not a later move' },
      { type: 'fix', text: 'A plan from the other PC marks the open file as unsaved; routine updates no longer flood the backup list' },
      { type: 'fix', text: 'Excel "Bay" column shows the bay holding most of the unit; the Summary adds an "Other / unassigned" row so it adds up' },
      { type: 'fix', text: 'Import: unreadable files no longer leave the import panel spinning; very large sheets no longer fail' },
      { type: 'fix', text: 'About → Changelog opens the update history inside Decargo (it did nothing in the desktop app)' },
    ],
  },
  {
    version: '3.36.0',
    date: '2026-10-26',
    highlights: [ 'Your plan is kept safe' ],
    changes: [
      { type: 'improvement', text: 'The plan is now also kept as a file in the Decargo data folder, with backups every 10 minutes while you work, at launch and before any plan is replaced (open, new, clear, restore, a plan from the other bridge PC). 30 recent copies + one per day for two weeks' },
      { type: 'feature', text: 'File → Restore from Backup… — pick a copy by time, voyage and cargo count; the plan you leave is backed up too' },
      { type: 'improvement', text: 'An opened plan file changes only when you Save (Ctrl+S); every file Decargo writes is written safely, so a power cut cannot leave it half-written' },
      { type: 'fix', text: 'Closing: Decargo asks Save / Don\u2019t Save / Cancel only when an opened file has unsaved changes; File → Exit closes properly' },
      { type: 'fix', text: 'Opening a damaged or newer-version file no longer half-replaces the plan or makes that file the target of the next Save' },
      { type: 'fix', text: 'File → recent files list was always empty — it now shows your recent plans' },
      { type: 'fix', text: 'Print (Ctrl+P) opens the PDF again' },
      { type: 'ui', text: 'PDF footer time shows its time zone (e.g. 09:40 UTC+1)' },
    ],
  },
  {
    version: '3.35.0',
    date: '2026-10-26',
    highlights: [ 'Automatic updates' ],
    changes: [
      { type: 'feature', text: 'Decargo checks for updates by itself — at launch, every 3 hours and whenever the internet comes back — and downloads a new version in the background (about 30 MB)' },
      { type: 'feature', text: 'When it is ready, a small card offers Install and restart / Later; the bottom bar shows Update ready until you install. Nothing installs without your click' },
      { type: 'improvement', text: 'Before installing, the plan is saved and read back; if that fails, the update is not installed' },
      { type: 'improvement', text: 'The card waits while you drag cargo, type or have a dialog open, and makes no sound' },
      { type: 'ui', text: 'About → Download updates automatically: switch off on an expensive satellite link' },
    ],
  },
  {
    version: '3.34.1',
    date: '2026-10-26',
    highlights: [ 'Header tiles match the Wind & waves button' ],
    changes: [
      { type: 'ui', text: 'Upload, Library and Smart Tools are built like the Wind & waves button — same size, corners and light — in ocean blue, teal and olive from the same sea palette' },
      { type: 'ui', text: 'The tiles sit on the same line as the Wind & waves button, the names hang underneath, and the tiles are evenly spaced' },
    ],
  },
  {
    version: '3.34.0',
    date: '2026-10-26',
    highlights: [ 'New Decargo icon', 'Header buttons with names' ],
    changes: [
      { type: 'ui', text: 'New app icon: a graphite D with cargo blocks inside — on the taskbar, Start menu, installer, window and About' },
      { type: 'ui', text: 'Header: Upload, Library and Smart Tools are now coloured tiles with their name always written underneath — purple, blue and amber, so you find them at a glance without hovering' },
      { type: 'ui', text: 'Theme and Language moved to two small round buttons on the right' },
    ],
  },
  {
    version: '3.33.0',
    date: '2026-10-26',
    highlights: [ 'Delete several locations in a row' ],
    changes: [
      { type: 'fix', text: 'Add Location: confirming Delete no longer closes the location picker — you can remove several locations one after another' },
      { type: 'ui', text: 'Saved, exported or imported: the role bar lights up bright green with a short glow and a light running down it, then returns to its colour' },
    ],
  },
  {
    version: '3.32.0',
    date: '2026-10-26',
    highlights: [ 'Living role bar' ],
    changes: [
      { type: 'ui', text: 'The orange / blue bar next to the vessel name now flows slowly top to bottom in a seamless loop; switching Operator ↔ Viewer crossfades the colours. It holds still in Calm and Off animations, with reduced motion and in Performance mode' },
      { type: 'ui', text: 'A single soft light sweep runs down the bar when a save, export or import finishes' },
    ],
  },
  {
    version: '3.31.0',
    date: '2026-10-26',
    highlights: [ 'Simpler DG warning' ],
    changes: [
      { type: 'improvement', text: 'DG segregation warning is now a short card: one line with the rule and the two placards, how far apart the units are against what is required, and Got it / Show / Details. Details open the full breakdown in the same card — units, class names, IMDG rule, actual and required distance, how much more clearance is needed' },
      { type: 'improvement', text: '“Got it” means reviewed, not resolved: the units keep a steady outline and the DG ON BOARD line shows a conflict chip until they are apart. A reviewed pair warns again only if it gets clearly worse (0.5 m closer or a stricter rule)' },
      { type: 'ui', text: 'Esc or × just closes the card; clicking DG ON BOARD opens every current conflict' },
    ],
  },
  {
    version: '3.30.0',
    date: '2026-10-26',
    highlights: [ 'Deck gets its width back while you place' ],
    changes: [
      { type: 'improvement', text: 'Picking a unit in the Library slides the Library away and the deck smoothly zooms back to full width for placing; after you save the unit the Library returns and the deck fits beside it again. Dragging a card keeps the zoom so the target does not move under the pointer' },
      { type: 'ui', text: 'The header-label editor (pencil next to the vessel name) is removed — the header shows the active vessel and “Deck Cargo Plan”' },
    ],
  },
  {
    version: '3.29.0',
    date: '2026-10-26',
    highlights: [ 'New sound palette' ],
    changes: [
      { type: 'improvement', text: 'All sounds redone as one family — felted wood and soft glass, physically modelled: cargo placed (three variants), snap, box select, remove, rotate, duplicate, undo/redo, save, export, list imported, plan received, DG warning, DG cleared, not allowed' },
      { type: 'improvement', text: 'Built for long loadings: fixed loudness ladder (ticks quietest, alerts on top), rate limits so a drag never chatters, one sound per gesture, at most three at a time' },
      { type: 'ui', text: 'Sound settings regrouped: Actions, Results, Alerts, Interface (panel and switch sounds, off by default). Ocean ambient, voice alert and VHF radio removed' },
    ],
  },
  {
    version: '3.28.0',
    date: '2026-10-26',
    highlights: [ 'Sync over the ship network', 'Now called Decargo' ],
    changes: [
      { type: 'sync', text: 'Sync through a shared folder on the ship\'s network drive — no servers, nothing leaves the vessel. Both bridge computers point at the same folder (Smart Tools → Sync → Ship network); the Operator publishes, the other computer picks the plan up within a couple of seconds' },
      { type: 'sync', text: 'Safe by design: writes are locked and atomic, a change made on the other computer while you had unpublished edits asks Keep mine / Use theirs, linking to a folder that already holds a plan asks first, and the last 30 versions are kept in the folder\'s history' },
      { type: 'sync', text: 'Cloud sync stays available as the second option and is fully off while the ship network is used' },
      { type: 'ui', text: 'The app is now Decargo — Deck Cargo Planner: window title, About, splash, PDF footer and EULA. Exports and project files are named after the active vessel' },
    ],
  },
  {
    version: '3.27.7',
    date: '2026-10-25',
    highlights: [ 'Box-select on the deck works' ],
    changes: [
      { type: 'fix', text: 'Dragging a selection box over the deck now keeps the units it covers selected — the click the browser fires after the drag no longer clears them, so S, Delete and the inspector act on the whole group' },
    ],
  },
  {
    version: '3.27.6',
    date: '2026-10-25',
    highlights: [ 'Finer wave fronts' ],
    changes: [
      { type: 'ui', text: 'Waves map: the wave fronts are thin crescent slivers with a soft glow behind the bright edge, as on Ventusky — lighter on the eye, still sized by Hs' },
    ],
  },
  {
    version: '3.27.5',
    date: '2026-10-25',
    highlights: [ 'Calmer wind map' ],
    changes: [
      { type: 'ui', text: 'Wind map: about three times fewer streaks, so the flow reads at a glance without the shimmer' },
    ],
  },
  {
    version: '3.27.4',
    date: '2026-10-25',
    highlights: [ 'Waves drawn as wave fronts', 'Values on the map' ],
    changes: [
      { type: 'ui', text: 'Waves map in the style of Ventusky: crescent wave fronts bowed the way the sea runs, larger where it is higher, fading in and out as they travel; sea-state colours from blue through yellow and orange to deep red' },
      { type: 'feature', text: 'Values on the map: Hs in metres (or the wind in kn / m/s) written across the sea on a regular lattice, dark on light colours and white on dark; the "12" button by the zoom turns them off' },
      { type: 'ui', text: 'The cursor read-out shows the wind and the sea direction with small arrows' },
    ],
  },
  {
    version: '3.27.3',
    date: '2026-10-25',
    highlights: [ 'Streaks follow the chosen time' ],
    changes: [
      { type: 'fix', text: 'Wind map: moving the time line (dragging, Now, ← →) now changes the streaks at once — before, only Play did, so a jump kept the previous time\'s speeds; the map also opens with the streaks of the current hour' },
    ],
  },
  {
    version: '3.27.2',
    date: '2026-10-25',
    highlights: [ 'Calmer wind streaks' ],
    changes: [
      { type: 'ui', text: 'Wind map: the streaks move about three times slower (≈ 14 px/s at 20 kn), creep in light air and still run in a gale; each streak is a crisp line from bright head to faint tail, its length showing the speed' },
    ],
  },
  {
    version: '3.27.1',
    date: '2026-10-25',
    highlights: [ 'Streaks show the wind strength', 'PDF names with or without the white plate' ],
    changes: [
      { type: 'improvement', text: 'Wind map: the streaks now race in a gale and barely drift in a calm (speed grows faster than the wind), so strong and light areas read at a glance' },
      { type: 'feature', text: 'Export → "PDF: names on white plate" — on: each cargo name on a light plate (as before); off: the names as on screen, same print size, no plate. Remembered on this computer' },
    ],
  },
  {
    version: '3.27.0',
    date: '2026-10-25',
    highlights: [ 'Animated wind & waves map', 'No more Windy links' ],
    changes: [
      { type: 'feature', text: 'Wind & waves map of the working area: colour field and flowing streaks for the wind (with gusts in the read-out) or the sea (Hs, period, direction), the locations as pins with their values, a time line over the next 4 days with Play, zoom and pan, legend, and a read-out under the cursor' },
      { type: 'feature', text: 'Open it from the new tile right of the header weather, from the forecast window (Map) or from a location card' },
      { type: 'ui', text: 'The Windy links are gone — the planner has its own map and tables now' },
      { type: 'improvement', text: 'Works offline once loaded: the coastline is built in, the forecast grid (Open-Meteo, every 3 h, ~0.4°) is kept for later; only the grid coordinates are sent' },
      { type: 'ui', text: 'Animations → Off shows still arrows instead of moving streaks; Calm uses fewer streaks' },
    ],
  },
  {
    version: '3.26.3',
    date: '2026-10-25',
    highlights: [ 'Neater position field' ],
    changes: [
      { type: 'ui', text: 'Location card: the Map / Set button now sits inside the position field — one clean control, centred, with a clear frame and focus ring' },
    ],
  },
  {
    version: '3.26.2',
    date: '2026-10-25',
    highlights: [ 'Forecast tables slide smoothly', 'Softer time slice' ],
    changes: [
      { type: 'improvement', text: 'Field weather: all forecast tables now move together in one smooth motion — sideways swipe, Shift + wheel, drag with the mouse (it coasts on release), the thin bar under each table, or ← → / Home / End. No more stutter or tables lagging behind each other' },
      { type: 'improvement', text: 'While the forecast is open, the app behind it holds still (no blur, no ambient animation) so the computer spends its effort on the tables' },
      { type: 'ui', text: 'The red time slice is thinner and softer, fades at its ends and follows the mouse while the tables move' },
      { type: 'ui', text: 'Header: the weather block is captioned "Weather · <location>", so it is clear what the numbers are' },
    ],
  },
  {
    version: '3.26.1',
    date: '2026-10-25',
    highlights: [ 'Big animated sky icon in the header' ],
    changes: [
      { type: 'ui', text: 'Header weather: the sky icon is big again and stands beside the location name and numbers; it now animates steadily (rain falls, clouds drift) and no longer freezes after a weather refresh' },
      { type: 'ui', text: 'Smart Tools: the old port-city weather picker (Peterhead · Change) is gone — the header and the atmosphere follow your working locations; the section is now called Atmosphere' },
      { type: 'improvement', text: 'Animations → Off also pauses the header sky icon' },
    ],
  },
  {
    version: '3.26.0',
    date: '2026-10-25',
    highlights: [ 'Right side works as one workspace', 'Library sections movable from the keyboard' ],
    changes: [
      { type: 'ui', text: 'Library, Inspector and Smart Tools share the right side: when one replaces another (picking a block with the Library open, opening the Library from the Inspector) the old one fades out in place and the new one fades in — no more double slide' },
      { type: 'ui', text: 'Inspector: switching to another block refreshes the whole card in place, not only the title' },
      { type: 'feature', text: 'Cargo Library: the ⋮⋮ grip can be focused with Tab and moved with ↑ ↓; Smart Tools → Cargo Library order → Reset puts the sections back' },
      { type: 'fix', text: 'Esc closes About and Update History — and only them, the Inspector or 3D view behind stays as it was' },
    ],
  },
  {
    version: '3.25.0',
    date: '2026-10-25',
    highlights: [ 'Windows grow out of the button that opened them', 'Theme switch spreads from the button', 'Animations: Full / Calm / Off' ],
    changes: [
      { type: 'ui', text: 'One motion system for the whole app: windows launch from the control you pressed (a menu, a header pill, a button) and return into it when closed — no more instant vanishing' },
      { type: 'ui', text: 'Library and Smart Tools fly out of their header button and back into it' },
      { type: 'ui', text: 'Light / dark: the new theme spreads in a circle from the theme button' },
      { type: 'ui', text: 'Menus and popovers fade out instead of disappearing; they are frosted glass now, data panels stay solid' },
      { type: 'ui', text: 'Buttons give a small press; Cargo Library sections open and close smoothly; when several cargo blocks appear at once (opening a plan, sync, undo) they land in a quick wave from stern to bow' },
      { type: 'feature', text: 'Smart Tools → Animations: Full, Calm (short fades only, no moving sky — for the night watch) or Off. The first start follows the "reduce motion" setting of Windows' },
      { type: 'fix', text: 'Positions (location card, Vessel Setup, map) in the normal typeface — no zeros that read as 8' },
    ],
  },
  {
    version: '3.24.1',
    date: '2026-10-25',
    highlights: [ 'Forecast numbers as light as on Windy' ],
    changes: [
      { type: 'ui', text: 'Field weather table uses the same type as Windy — the system face (Segoe UI on Windows) at regular weight: wind, gusts and waves are no longer heavy and read cleaner on the colour bands; wind arrows in Windy\'s blue-grey' },
    ],
  },
  {
    version: '3.24.0',
    date: '2026-10-25',
    highlights: [ 'Field weather looks like Windy "Compare forecasts"', 'Header never overlaps', 'Cargo Library sections can be dragged' ],
    changes: [
      { type: 'ui', text: 'Field weather: dark panel with one white table per location — days split by thin lines, 3-hourly columns (00 03 06 …), sky icon and temperature, then wind, gusts, direction, waves, Hmax, swell and swell period as smooth colour bands; 5 days ahead' },
      { type: 'ui', text: 'Colours are Windy\'s own forecast-table scales (calm grey → cyan → green → orange → pink → purple for wind; lavender → orange for waves), also in the header and on the location cards' },
      { type: 'feature', text: 'Move the mouse over the forecast: a red time slice runs through every location at once; the tables scroll together' },
      { type: 'fix', text: 'Numbers in the weather are in a normal typeface — no more zeros that read as 8 on Windows' },
      { type: 'improvement', text: 'Port weather (Peterhead) removed from the header: the sky, the animation and the temperature follow the working location' },
      { type: 'ui', text: 'Header: Voyage, date and field weather never slide under each other — on a narrow window details fold away and the voyage goes on one line above the weather; Upload / Library / Smart Tools / Theme fold into a 2 × 2 block; Deck Used is large again with room around it; split-flap counters are clean at rest' },
      { type: 'ui', text: 'Cargo Library: Imported → Frequent → Other Cargo → Pipes → Non-standard unit → Custom Cargo. Hold the ⋮⋮ grip of a section and drag it to put it where you want; the order is kept on this computer' },
    ],
  },
  {
    version: '3.23.1',
    date: '2026-10-25',
    highlights: [ 'Positions and vessel setup sync between computers' ],
    changes: [
      { type: 'sync', text: 'Location positions and everything in Vessel Setup (locations, deck, zones, lashing) now travel with the cloud sync: set them on one computer, the other picks them up. The later edit wins; the deck-camera calibration stays on its own computer' },
    ],
  },
  {
    version: '3.23.0',
    date: '2026-10-25',
    highlights: [ 'Weather works out of the box', 'Click a location for its weather and position' ],
    changes: [
      { type: 'feature', text: 'Built-in locations come with their installation positions (NSTA register): Bleo Holm, GP3, Tartan, Claymore, Piper, Saltire, Montrose, Arbroath, Clyde, Fulmar, Auk, Beatrice — field weather shows at once, nothing to enter' },
      { type: 'feature', text: 'Click a location card: weather there now, 48 h forecast, Windy, and its position — paste it from the ECDIS and press Set' },
      { type: 'feature', text: 'Before a position is saved it is shown on a map (OpenStreetMap + OpenSeaMap) with the other locations around it; zoom in and out, drag the pin to correct it' },
    ],
  },
  {
    version: '3.22.4',
    date: '2026-10-25',
    highlights: [ 'Flip-clock counters', 'Only what is on board' ],
    changes: [
      { type: 'ui', text: 'Lifts on deck, Load, Backload, ROB and Transfer change like a flip clock — the top half of the plate folds down onto the new number' },
      { type: 'improvement', text: 'The counters show only what is really on board: no Load 0 after discharge, no ROB 0 when there is none; Transfer appears when there is one. Blocks fold in and out softly' },
      { type: 'ui', text: 'Weather pills in the header are one fixed size, whatever the number' },
    ],
  },
  {
    version: '3.22.3',
    date: '2026-10-25',
    highlights: [ 'Field weather only in the header' ],
    changes: [
      { type: 'improvement', text: 'The location cards no longer carry weather; the header shows it for the first location in the strip, or the one you click (or the location of the selected unit)' },
      { type: 'fix', text: 'Header weather no longer runs into the divider and the port weather; the date stays on one line' },
    ],
  },
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
