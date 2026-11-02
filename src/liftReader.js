/* ════════════════════════════════════════════════════════════
   LIFT READER — unit-number matching (v3.17; v3.40 keeps only this part)
   A reading of the load's number votes for a unit from the candidates
   (load list, Imported queue, deck), weighing the usual misreads
   (1/T, 0/O, 8/B…) and the digit group. Following the load and reading
   it live is in liftTrack.js and deckCamera.js (Watch lifts).
════════════════════════════════════════════════════════════ */

/* ── matching ──────────────────────────────────────────────── */
const N = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const CONF = new Set(['1T', 'T1', '1I', 'I1', 'IT', 'TI', '0O', 'O0', '0D', 'D0', 'OD', 'DO', '8B', 'B8', '5S', 'S5', '2Z', 'Z2',
                      '6G', 'G6', '0Q', 'Q0', '7T', 'T7', '1L', 'L1', '4A', 'A4', '3B', 'B3', '8S', 'S8', 'CG', 'GC', 'CL', 'LC']);
function wlev(a, b){
  let d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for(let i = 1; i <= a.length; i++){
    const p = d.slice(); d[0] = i;
    for(let j = 1; j <= b.length; j++){
      const sub = a[i - 1] === b[j - 1] ? 0 : (CONF.has(a[i - 1] + b[j - 1]) ? 0.3 : 1);
      d[j] = Math.min(p[j] + 1, d[j - 1] + 1, p[j - 1] + sub);
    }
  }
  return d[b.length];
}
function digitKey(ccu){
  const g = String(ccu || '').toUpperCase().replace(/CCT\s*23\s*-?/, 'CCT23 ').match(/\d{3,}/g);
  return g ? g[g.length - 1] : '';
}
/* the digits of a unit's id that come before its key group ("CCT23-820" → "23") */
function digitsBefore(ccu, key){
  const all = N(ccu).replace(/\D/g, '');
  return key && all.endsWith(key) ? all.slice(0, all.length - key.length) : '';
}
/* stencilled weights and capacities are not unit numbers */
const WEIGHT_WORDS = /\b(MGW|MAX\s*GROSS|GROSS|TARE|PAYLOAD|NET|KGS?|LBS?|SWL|WLL|MAX)\b/i;
/* Candidates → matcher. A reading votes for the best unit within cost 0.8,
   or by a unique digit group (≥ 3 digits) found in it. */
export function makeMatcher(cands){
  const list = cands.map(c => { const d = digitKey(c.ccu); return Object.assign({}, c, { n: N(c.ccu), d, pre: digitsBefore(c.ccu, d) }); }).filter(c => c.n.length >= 3);
  /* digit groups that point at exactly one candidate */
  const keys = list.filter(c => c.d && list.filter(o => o.d && (o.d.endsWith(c.d) || c.d.endsWith(o.d))).length === 1);
  return text => {
    const r = N(text);
    if(r.length < 3) return null;
    let best = null;
    for(const c of list){
      const L = c.n.length;
      for(const ln of [L - 1, L, L + 1]){
        if(ln < 3) continue;
        for(let i = 0; i <= Math.max(0, r.length - ln); i++){
          const cost = wlev(r.slice(i, i + ln), c.n);
          if(!best || cost < best.cost) best = { cost, c };
        }
      }
    }
    /* v3.37.2 — only look-alike substitutions (1/I, 0/O, 8/B…) count as a
       reading of the unit; one plainly wrong character ("ABC129" for
       ABC123) is a weaker "near" vote that alone cannot make a lift Sure */
    if(best && r.length >= best.c.n.length - 1){
      if(best.cost <= 0.8) return { c: best.c, how: 'text', cost: best.cost };
      /* an ISO id read without its check digit ("ABCU 123456" for ABCU 123456-7) */
      const cn = best.c.n;
      if(cn.length >= 8 && /\d$/.test(cn) && r.includes(cn.slice(0, -1))) return { c: best.c, how: 'text', cost: best.cost };
      if(best.c.n.length >= 6 && best.cost <= 1.0) return { c: best.c, how: 'near', cost: best.cost };
    }
    /* a digit group that ends with a candidate's number: "23820" → CCT23-820.
       v3.37.2: at least 4 digits, the extra leading digits must be the
       unit's own ("5820" is not CCT23-820), and weight stencils
       ("MGW 5820 KG", "TARE 1820") never vote. */
    if(WEIGHT_WORDS.test(String(text || ''))) return null;
    const dg = (r.replace(/O/g, '0').match(/\d{4,}/g) || []);
    for(const g of dg){
      const c = keys.find(k => g.endsWith(k.d) && g.length - k.d.length <= 3 && k.pre.endsWith(g.slice(0, g.length - k.d.length)));
      if(c) return { c, how: 'digits' };
    }
    return null;
  };
}

/* v3.42 — a number read only in pieces ("09", "60"). Within a short list of
   units that can be the load — the ones that stood where it was picked up, or
   the ones still waiting to come aboard — a piece of digits that fits exactly
   one of them picks it. A 2-digit piece counts only when it was seen at least
   twice; pieces that fit several units say nothing; the winner must have at
   least twice the support of the next.
   frags: [{ d: '609', s: weight }]  cands: [{ id, ccu, … }]
   → { c, frag, score, sure } or null */
export function pickByFragments(frags, cands){
  const list = (cands || []).map(c => ({ c, d: N(c.ccu).replace(/\D/g, '') })).filter(o => o.d.length >= 2);
  const good = (frags || []).filter(f => f && f.d && f.d.length >= 2 && (f.d.length >= 3 ? f.s >= 0.6 : f.s >= 1.2));
  if(!list.length || !good.length) return null;
  const score = new Map();
  good.forEach(f => {
    const hits = list.filter(o => o.d.includes(f.d));
    if(hits.length !== 1) return;
    const w = f.s * (f.d.length >= 4 ? 3 : f.d.length === 3 ? 2 : 1);
    score.set(hits[0], (score.get(hits[0]) || 0) + w);
  });
  const top = [...score.entries()].sort((a, b) => b[1] - a[1]);
  if(!top.length || (top[1] && top[1][1] > top[0][1] * 0.5)) return null;
  const [best, sc] = top[0];
  const frag = good.filter(f => best.d.includes(f.d)).sort((a, b) => b.d.length - a.d.length || b.s - a.s)[0].d;
  return { c: best.c, frag, score: Math.round(sc * 100) / 100, sure: sc >= 2.4 };
}
/* digit pieces of one reading: runs of 2+ digits ("GB 6O9" → "609"); sizes
   and weights ("20FT", "2500KG") are not pieces of a unit number */
export function digitPieces(text){
  if(WEIGHT_WORDS.test(String(text || ''))) return [];
  const n = N(text).replace(/(\d)O(?=\d)/g, '$10');
  if(/^\d+(FT|KGS?|LBS?|T|M3|CBM|MM|CM|M)$/.test(n)) return [];
  return n.match(/\d{2,}/g) || [];
}
