"""Decargo UI sound palette — physically modelled, rendered offline.
One family: felted wood + soft glass. Felt-mallet excitation into modal
resonators, a whisper of contact noise, a tiny room. 48 kHz mono WAV."""
import numpy as np, wave, json, os, sys
SR = 48000
rng = np.random.default_rng(20261026)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'assets', 'sounds'); os.makedirs(OUT, exist_ok=True)

def t_(n): return np.arange(n) / SR
def db(x): return 10 ** (x / 20)

# ── materials: mode ratios, relative amps, T60 scale per mode ───────────
MAT = {
  # small hardwood block / marimba-ish bar (free-free bar ratios)
  'wood':  dict(r=[1.0, 2.76, 5.40, 8.93], a=[1.0, 0.42, 0.16, 0.06], t=[1.0, 0.45, 0.22, 0.12]),
  # tuned felted glass (rounded bell, mostly harmonic, gentle inharmonic shimmer)
  'glass': dict(r=[1.0, 2.0, 3.01, 4.17, 5.43], a=[1.0, 0.30, 0.12, 0.05, 0.025], t=[1.0, 0.65, 0.42, 0.28, 0.2]),
  # ceramic / porcelain tap
  'ceram': dict(r=[1.0, 2.32, 4.25, 6.63], a=[1.0, 0.38, 0.16, 0.07], t=[1.0, 0.5, 0.3, 0.18]),
  # soft plastic / mechanism detent (heavily damped, inharmonic)
  'detent':dict(r=[1.0, 1.71, 2.63, 3.92], a=[1.0, 0.55, 0.3, 0.16], t=[1.0, 0.7, 0.5, 0.35]),
}

def mallet(ms, hardness=1.0):
    """felt mallet force pulse: raised-sine with a soft tail (felt compression)"""
    n = max(4, int(ms / 1000 * SR))
    p = np.sin(np.pi * np.arange(n) / n) ** (1.6 / hardness)
    return p / p.sum()

def strike(f0, mat='wood', t60=0.25, mal_ms=None, dur=None, bright=1.0, detune=0.0, damp_hi=1.0, hard=None):
    """felt mallet contact time scales with pitch: T = hard / f0 keeps the
    fundamental in the pulse's main lobe (a too-long pulse notches it out)"""
    m = MAT[mat]; dur = dur or t60 * 1.4 + 0.02
    if hard is None: hard = {'wood': 0.32, 'glass': 0.26, 'ceram': 0.24, 'detent': 0.16}[mat]
    mal_ms = hard / f0 * 1000
    n = int(dur * SR); tt = t_(n); y = np.zeros(n)
    for k, (r, a, ts) in enumerate(zip(m['r'], m['a'], m['t'])):
        f = f0 * r * (1 + detune * (k % 2 * 2 - 1) * 0.003)
        if f > SR * 0.45: continue
        T = t60 * ts * (damp_hi ** k)
        y += a * (bright ** k) * np.sin(2 * np.pi * f * tt + rng.uniform(0, 0.4)) * np.exp(-6.91 * tt / T)
    y = np.convolve(y, mallet(mal_ms))[:n]
    return y

def contact(ms=4, lo=1800, hi=6000, level=0.08):
    """the 'touch' of felt on a surface: a few ms of band-limited noise"""
    n = int(ms / 1000 * SR); x = rng.standard_normal(n)
    X = np.fft.rfft(x); f = np.fft.rfftfreq(n, 1 / SR)
    X *= np.exp(-0.5 * ((np.log(np.maximum(f, 1)) - np.log(np.sqrt(lo * hi))) / (0.5 * np.log(hi / lo))) ** 2)
    x = np.fft.irfft(X, n); x *= np.hanning(n * 2)[n:] if n > 4 else 1
    x *= np.minimum(1, np.arange(n) / max(1, n * 0.15))
    return x / (np.abs(x).max() + 1e-9) * level

def thump(f=70, ms=60, level=0.4):
    """weight under a placed unit: a short damped low body"""
    n = int(ms / 1000 * SR * 2.5); tt = t_(n)
    fr = f * (1 + 0.35 * np.exp(-tt * 60))
    ph = 2 * np.pi * np.cumsum(fr) / SR
    y = np.sin(ph) * np.exp(-tt / (ms / 1000 / 2.3)) * np.minimum(1, tt / 0.0015) * level
    k = int(0.02 * SR); y[-k:] *= np.cos(np.linspace(0, np.pi / 2, k)) ** 2
    return y

def air(ms=90, f0=900, f1=2400, level=0.05):
    """a soft breath (panel motion): band noise sweeping f0→f1"""
    n = int(ms / 1000 * SR); x = rng.standard_normal(n); y = np.zeros(n)
    fc = np.geomspace(f0, f1, n); low = band = 0.0; q = 1 / 1.6
    for i in range(n):
        fq = 2 * np.sin(np.pi * fc[i] / SR); hp = x[i] - low - q * band; band += fq * hp; low += fq * band; y[i] = band
    # soften: a two-pole low-pass at ~3.5 kHz so the breath never hisses
    a = np.exp(-2 * np.pi * 3500 / SR)
    for _ in range(2):
        z = np.zeros_like(y); p = 0.0
        for i, v in enumerate(y): p = (1 - a) * v + a * p; z[i] = p
        y = z
    return y / (np.abs(y).max() + 1e-9) * np.sin(np.pi * np.arange(n) / n) ** 1.5 * level

def mix(n_ms, *parts):
    n = int(n_ms / 1000 * SR); y = np.zeros(n)
    for (t0, x, g) in parts:
        i = int(t0 / 1000 * SR); x = x[: max(0, n - i)]; y[i:i + len(x)] += x * g
    return y

def room(y, wet=0.10):
    """tiny room: a few early reflections and a short soft tail — no wash"""
    out = y.copy()
    for ms, g in ((6.1, .30), (11.3, .22), (17.9, .15), (26.2, .10)):
        i = int(ms / 1000 * SR); out[i:] += y[:len(y) - i] * g * wet * 3
    n = int(0.09 * SR); ir = rng.standard_normal(n) * np.exp(-t_(n) / 0.025)
    ir = np.convolve(ir, np.ones(6) / 6, 'same')
    out += np.convolve(y, ir)[:len(y)] * wet * 0.04
    return out

def finish(y, fade_ms=8, hp=60):
    y = y - np.mean(y)
    # gentle high-pass against DC/rumble (one-pole)
    a = np.exp(-2 * np.pi * hp / SR); z = np.zeros_like(y); prev_x = prev_y = 0.0
    for i, v in enumerate(y): prev_y = a * (prev_y + v - prev_x); prev_x = v; z[i] = prev_y
    y = z; n = int(fade_ms / 1000 * SR); y[-n:] *= np.cos(np.linspace(0, np.pi / 2, n)) ** 2
    y[:24] *= np.linspace(0, 1, 24)
    # trim trailing silence below -70 dB
    thr = db(-70) * np.abs(y).max(); idx = np.where(np.abs(y) > thr)[0]
    return y[: idx[-1] + 1 + int(0.004 * SR)] if len(idx) else y

# ── level classes (loudness of the body, peak-capped) ───────────────────
# loudness of the loudest 20 ms (dBFS RMS) — the ear judges these short
# sounds by their body, not their peak. Hierarchy: ticks < contacts <
# completions < alerts, about 3 dB per step.
LEVEL = {'tick': -27, 'contact': -24, 'gesture': -24, 'complete': -21, 'alert': -18}
def st_loud(y):
    w = int(0.02 * SR); env = np.convolve(y ** 2, np.ones(w) / w, 'same')
    return 10 * np.log10(env.max() + 1e-12)
def level(y, cls):
    y = y * db(LEVEL[cls] - st_loud(y))
    pk = np.abs(y).max()
    if pk > db(-6): y *= db(-6) / pk
    return y

SOUNDS = {}
def S(name, cls, y, label, group, default=True):
    SOUNDS[name] = dict(y=level(finish(room(y)), cls), cls=cls, label=label, group=group, default=default)

# ── ACTIONS ─────────────────────────────────────────────────────────────
for v, (f, d) in enumerate([(262, 0), (254, 0.4), (270, -0.3)]):       # cargo set down (3 variants)
    S(f'drop{v+1}', 'contact', mix(260,
        (0, contact(5, 900, 4000, 0.10), 1),
        (0.4, thump(64 + v * 3, 55, 0.55), 1),
        (0.6, strike(f, 'wood', 0.16, mal_ms=4.5, bright=0.85, detune=d), 0.55),
        (1.0, strike(f * 1.5, 'wood', 0.09, mal_ms=3.5, bright=0.7), 0.12)), 'Cargo placed', 'actions')
for v, f in enumerate([1046, 1108]):                                    # snap detent
    S(f'snap{v+1}', 'tick', mix(80, (0, contact(2.2, 2500, 8000, 0.09), 1), (0.3, strike(f, 'detent', 0.035, mal_ms=0.9, bright=0.8), 0.7)), 'Snap to edge', 'actions')
S('select', 'tick', mix(70, (0, contact(1.6, 3000, 9000, 0.05), 1), (0.2, strike(1397, 'ceram', 0.04, mal_ms=1.3, bright=0.6), 0.5)), 'Select', 'actions', default=False)
S('multi', 'tick', mix(110, (0, strike(1397, 'ceram', 0.04, mal_ms=1.3, bright=0.6), 0.45), (34, strike(1568, 'ceram', 0.05, mal_ms=1.3, bright=0.6), 0.5), (0, contact(1.6, 3000, 9000, 0.05), 1)), 'Box select', 'actions')
S('remove', 'gesture', mix(240,
    (0, contact(3, 1500, 5000, 0.06), 1),
    (0.3, strike(523, 'wood', 0.08, mal_ms=3, bright=0.7), 0.55),
    (52, strike(392, 'wood', 0.12, mal_ms=4, bright=0.6), 0.6),
    (10, air(150, 2000, 600, 0.03), 1)), 'Cargo removed', 'actions')
S('rotate', 'tick', mix(110,
    (0, strike(880, 'detent', 0.03, mal_ms=0.9, bright=0.8), 0.6), (0, contact(1.8, 2500, 8000, 0.07), 1),
    (38, strike(988, 'detent', 0.035, mal_ms=0.9, bright=0.8), 0.7), (38, contact(1.8, 2500, 8000, 0.07), 1)), 'Rotate', 'actions')
S('duplicate', 'gesture', mix(230,
    (0, strike(587, 'wood', 0.09, mal_ms=2.6, bright=0.75), 0.55), (0, contact(2.5, 2000, 7000, 0.05), 1),
    (68, strike(880, 'wood', 0.11, mal_ms=2.4, bright=0.75), 0.55), (68, contact(2.5, 2000, 7000, 0.05), 1)), 'Duplicate', 'actions')
S('undo', 'gesture', mix(220,
    (0, strike(659, 'wood', 0.08, mal_ms=3, bright=0.7), 0.5), (62, strike(523, 'wood', 0.12, mal_ms=3.5, bright=0.65), 0.55),
    (0, air(110, 1900, 800, 0.02), 1)), 'Undo', 'actions')
S('redo', 'gesture', mix(220,
    (0, strike(523, 'wood', 0.08, mal_ms=3, bright=0.7), 0.5), (62, strike(659, 'wood', 0.12, mal_ms=3.5, bright=0.7), 0.55),
    (0, air(110, 800, 1900, 0.02), 1)), 'Redo', 'actions')

# ── RESULTS ─────────────────────────────────────────────────────────────
S('save', 'contact', mix(340,
    (0, contact(3.5, 1200, 4500, 0.06), 1),
    (0.3, strike(392, 'wood', 0.17, mal_ms=4, bright=0.75), 0.6),
    (6, strike(1568, 'glass', 0.30, mal_ms=2.5, bright=0.5), 0.10)), 'Plan saved', 'results')
S('export', 'complete', mix(620,
    (0, strike(784, 'glass', 0.42, mal_ms=3.2, bright=0.55), 0.55),
    (46, strike(1175, 'glass', 0.48, mal_ms=3.0, bright=0.5), 0.5),
    (0, strike(392, 'wood', 0.18, mal_ms=5, bright=0.6), 0.35),
    (0, contact(3, 1500, 6000, 0.05), 1)), 'Export done', 'results')
S('import', 'complete', mix(560,
    (0, strike(587, 'glass', 0.38, mal_ms=3.4, bright=0.55), 0.5),
    (52, strike(880, 'glass', 0.44, mal_ms=3.2, bright=0.5), 0.5),
    (0, strike(294, 'wood', 0.2, mal_ms=5, bright=0.6), 0.35),
    (0, contact(3, 1500, 6000, 0.05), 1)), 'List imported', 'results')
S('sync', 'contact', mix(420,
    (0, strike(1319, 'glass', 0.32, mal_ms=3.6, bright=0.45), 0.5),
    (0, strike(659, 'glass', 0.22, mal_ms=4.5, bright=0.5), 0.3)), 'Plan received', 'results')

# ── ALERTS ──────────────────────────────────────────────────────────────
def knock(f):   # sober, present: ceramic body + wood, no siren
    return mix(330, (0, contact(3, 1200, 5000, 0.07), 1), (0.2, strike(f, 'ceram', 0.20, mal_ms=3.2, bright=0.7), 0.6), (0.4, strike(f / 2, 'wood', 0.12, mal_ms=5, bright=0.6), 0.35))
S('warning', 'alert', mix(520, (0, knock(554), 1), (150, knock(523), 1.0)), 'DG warning', 'alerts')
S('resolved', 'complete', mix(420,
    (0, strike(659, 'glass', 0.18, mal_ms=3.4, bright=0.5), 0.45),
    (70, strike(494, 'wood', 0.2, mal_ms=4.2, bright=0.65), 0.6), (70, contact(3, 1200, 4500, 0.05), 1)), 'DG cleared', 'alerts')
S('error', 'alert', mix(260,
    (0, strike(233, 'wood', 0.07, mal_ms=5, bright=0.55), 0.7), (0, contact(4, 800, 3000, 0.06), 1),
    (85, strike(220, 'wood', 0.09, mal_ms=5, bright=0.55), 0.7), (85, contact(4, 800, 3000, 0.06), 1)), 'Not allowed', 'alerts')

# ── INTERFACE (off by default) ──────────────────────────────────────────
S('open', 'tick', mix(140, (0, air(120, 600, 1700, 0.05), 1), (60, strike(1175, 'ceram', 0.04, mal_ms=1.6, bright=0.5), 0.3)), 'Panel open', 'interface', default=False)
S('close', 'tick', mix(140, (0, air(120, 1700, 600, 0.05), 1), (55, strike(988, 'ceram', 0.04, mal_ms=1.8, bright=0.5), 0.3)), 'Panel close', 'interface', default=False)
S('toggleOn', 'tick', mix(80, (0, strike(1319, 'detent', 0.03, mal_ms=0.9, bright=0.8), 0.6), (0, contact(1.8, 3000, 9000, 0.06), 1)), 'Switch on', 'interface', default=False)
S('toggleOff', 'tick', mix(80, (0, strike(988, 'detent', 0.03, mal_ms=1.1, bright=0.7), 0.6), (0, contact(1.8, 2500, 8000, 0.05), 1)), 'Switch off', 'interface', default=False)

meta = {}
for k, v in SOUNDS.items():
    y = v['y']; pcm = (np.clip(y, -1, 1) * 32767).astype('<i2')
    with wave.open(f'{OUT}/{k}.wav', 'wb') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    spec = np.abs(np.fft.rfft(y)); f = np.fft.rfftfreq(len(y), 1 / SR)
    meta[k] = dict(loud=round(st_loud(y), 1), ms=round(len(y) / SR * 1000), peak_db=round(20 * np.log10(np.abs(y).max()), 1), centroid=int((spec * f).sum() / spec.sum()), cls=v['cls'], label=v['label'], group=v['group'], default=v['default'])
json.dump(meta, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sound-meta.json'), 'w'), indent=1)
for k, m in meta.items(): print(f"{k:10s} L {m['loud']:6.1f}  {m['ms']:4d} ms  peak {m['peak_db']:6.1f} dB  centroid {m['centroid']:5d} Hz  {m['cls']}")
print('total KB', sum(os.path.getsize(f'{OUT}/{k}.wav') for k in meta) // 1024)
