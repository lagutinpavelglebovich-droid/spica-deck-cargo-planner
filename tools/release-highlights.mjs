// Prints the highlights of one version from src/releaseNotes.js as a
// single line — CI puts it into latest.json "notes", which the app's
// update card shows ("Decargo 3.35.0 — <highlights>").
// usage: node tools/release-highlights.mjs 3.35.0
import { RELEASE_NOTES } from '../src/releaseNotes.js';
const v = (process.argv[2] || '').replace(/^v/, '');
const e = RELEASE_NOTES.find(r => r.version === v);
const line = e && Array.isArray(e.highlights) ? e.highlights.join(' · ') : '';
process.stdout.write(line);
