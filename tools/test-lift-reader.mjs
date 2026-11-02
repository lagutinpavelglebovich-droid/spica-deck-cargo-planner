// node tools/test-lift-reader.mjs — piece-of-number matching (v3.42)
import { pickByFragments, digitPieces, makeMatcher } from '../src/liftReader.js';
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if(!c) fail++; };
const deck = [{ id: 1, ccu: 'GB 609' }, { id: 2, ccu: 'KA 1807' }, { id: 3, ccu: 'KA 2158' }, { id: 4, ccu: 'AME 3130' }];
let r = pickByFragments([{ d: '09', s: 1.5 }], deck);
ok(r && r.c.id === 1 && r.frag === '09', '"09" seen twice → GB 609 (only one with 09)');
ok(!pickByFragments([{ d: '09', s: 0.9 }], deck), '"09" seen once → not enough for 2 digits');
ok(!pickByFragments([{ d: '18', s: 2 }], deck.concat([{ id: 5, ccu: 'ACE 1818' }])), '"18" fits two units → nothing');
r = pickByFragments([{ d: '807', s: 0.8 }], deck);
ok(r && r.c.id === 2 && !r.sure, '"807" once → KA 1807, not sure');
r = pickByFragments([{ d: '807', s: 0.9 }, { d: '18', s: 1.3 }, { d: '1807', s: 0.7 }], deck);
ok(r && r.c.id === 2 && r.sure && r.frag === '1807', 'several pieces agreeing → sure');
ok(!pickByFragments([{ d: '609', s: 1 }, { d: '2158', s: 1 }], deck), 'pieces pointing at two units → nothing');
ok(!pickByFragments([{ d: '44', s: 3 }], deck), 'piece that fits none → nothing');
ok(JSON.stringify(digitPieces('GB 6O9')) === '["609"]', 'O between digits read as 0');
ok(digitPieces('20FT').length === 0 && digitPieces('MGW 2500').length === 0, 'sizes and weights are not pieces');
ok(JSON.stringify(digitPieces('KA-18 07')) === '["1807"]', 'spaces inside one reading are joined');
/* the full-number matcher is unchanged */
const m = makeMatcher(deck.map(c => ({ ccu: c.ccu })));
ok(m('GB609') && m('GB609').c.ccu === 'GB 609', 'full number still matches');
console.log(fail ? fail + ' failed' : 'all pass'); process.exit(fail ? 1 : 0);
