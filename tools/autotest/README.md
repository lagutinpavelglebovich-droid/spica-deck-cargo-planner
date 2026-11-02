# Deck camera autotest (development only)

Plays a lift video through the real app (web build in headless Chromium) with
the real recognition engine behind it, on a plan made for that video, and
checks what the camera reported: lift-offs (which unit), set-downs (which bay),
moves. Nothing here ships in the app.

- `autotest.cjs` — the runner. See the header for the three commands.
- `scenarios/*.json` — one per clip: calibration, units on the plan (metres
  from the stern / from port), optional load list, and what must happen.
- Videos are NOT in the repo (owner's footage). Put them in a folder as
  `c<clip>.webm` (VP9 — the test browser has no H.264) and point
  `DECARGO_CLIPS` at it. 10 fps is enough.
- Real plans instead of made-up units:
  - `"planFile": "plan.json"` — a plan saved from the app (File → Save),
    read from the `DECARGO_CLIPS` folder;
  - `"recording": "<name>.json"` — the log the app writes next to every
    **Record video** file (deck at the start, load list, calibration). With
    it a scenario needs only `expect`; the video is the file named in the log.
  Both stay beside the clips, never in the repo.
- Output: `out/<scenario>.json` (events, tracker log with why a still load
  was not a set-down, mini-window trace) and screenshots at every event.
