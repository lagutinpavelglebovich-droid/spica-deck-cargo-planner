# UI & Deck Planner Rules

## Cargo Blocks (.cb)

- Position/size set via inline style from `renderBlock()` using `cargo.x/y/w/h`
- `overflow: visible` required — hover controls sit at `-8px` outside bounds
- `contain: layout style` OK — but NEVER `contain: paint` (clips controls)
- `data-loc` attribute used for location filter targeting
- `data-dg` attribute used for DG-only filter
- `data-corner-badge` for visual corner badges

## Deck Canvas (.dcv)

- `overflow: visible` — required so cargo controls aren't clipped
- `.deck-outer` also `overflow: visible`
- Bay numbers (`.bay-num`), side labels (`.side-lbl`), zones (`.zone`) are children of `.dcv`
- Zone backgrounds use `repeating-linear-gradient` — html2canvas can't render these (handled in PDF export by temporary zone style swaps)

## Zoom

- `.deck-zoom-wrap` has `transition: transform 0.25s` for smooth zoom
- `will-change: transform` for GPU acceleration
- Zoom range: 0.3–2.0, stored in `zoomLevel` variable
- Zoom is persisted in plan envelope and restored on load

## Panels

- Library panel (`.cp`): `position: fixed`, right side, 380px, slides via `translateX`
- Location strip (`.locs-row`): collapsible, glassmorphism backdrop
- Bottom panel (`.bottom-panel`): holds coordinates, zoom%, count, autosave, save status
- Smart Tools (`.st-ov`): slide-in panel from right

## Header

- Must be layout-stable — no jumping when content changes
- Save status indicator has `min-width: 72px` to prevent shifts
- Menu bar (`.menubar`) is 26px HTML menu bar, not native
- `--bg` workspace color is dark (`#9a9b93`) for deck contrast

## Dark Mode

- All colors via CSS custom properties
- Dark overrides: `[data-theme="dark"] .selector { ... }`
- Every new UI element needs dark mode rules
- Never use hardcoded hex colors in styles — always `var(--xxx)`
