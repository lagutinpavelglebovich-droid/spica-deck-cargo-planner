// ════════════════════════════════════════════════════════════
// VISION — v3.41 native engine for the deck camera
//
// ONNX Runtime loaded at run time from the bundled `vision/runtime` folder
// (the OpenVINO build: Intel CPU / iGPU), with the plain CPU provider as the
// fallback. Models are bundled in `vision/models`:
//   • PP-OCRv5 server text detection + English recognition (Apache-2.0)
//   • RF-DETR small object detector, COCO classes (Apache-2.0)
// The WebView sends raw RGBA pixels (tauri raw IPC body, size in headers) and
// gets boxes / text back. When the runtime or a model is missing (dev builds,
// macOS) the commands say so and the front end keeps its own WASM reader.
// ════════════════════════════════════════════════════════════
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use ort::ep;
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::Tensor;
use serde::Serialize;
use tauri::Manager;

/* number reading and the people detector are separate, each behind its own
   lock, so they run side by side on different cores */
struct Ocr {
    det: Session,
    rec: Session,
    keys: Vec<String>,
    device: String,
}
struct Obj {
    s: Session,
    res: usize,
    labels: Vec<String>,
    device: String,
}
struct Engine {
    ocr: Mutex<Option<Ocr>>,
    obj: Mutex<Option<Obj>>,
    models: PathBuf,
    cache: PathBuf,
    conf: PathBuf,
    openvino: bool,
}

static ENGINE: OnceLock<Result<Engine, String>> = OnceLock::new();
static BASE: OnceLock<PathBuf> = OnceLock::new();

#[derive(Serialize, Clone)]
pub struct Status {
    ok: bool,
    device: String,
    error: String,
    ocr: bool,
    detector: bool,
    dir: String,
}

#[derive(Serialize)]
pub struct TextHit {
    text: String,
    score: f32,
    cx: f32,
    cy: f32,
    w: f32,
    h: f32,
    a: f32,
}

#[derive(Serialize)]
pub struct ObjHit {
    label: String,
    score: f32,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
}

/* ── setup ─────────────────────────────────────────────────── */
fn base_dir(app: &tauri::AppHandle) -> PathBuf {
    BASE.get_or_init(|| {
        if let Ok(d) = std::env::var("DECARGO_VISION_DIR") {
            return PathBuf::from(d);
        }
        /* `tauri dev` on the Mac: the pack lives in src-tauri/vision of the checkout */
        if cfg!(debug_assertions) {
            let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vision");
            if dev.join("runtime").exists() {
                return dev;
            }
        }
        app.path().resource_dir().map(|r| r.join("vision")).unwrap_or_else(|_| PathBuf::from("vision"))
    })
    .clone()
}

fn runtime_lib(dir: &Path) -> Option<PathBuf> {
    let names: &[&str] = if cfg!(windows) { &["onnxruntime.dll"] } else if cfg!(target_os = "macos") { &["libonnxruntime.dylib"] } else { &["libonnxruntime.so"] };
    for n in names {
        let p = dir.join(n);
        if p.exists() {
            return Some(p);
        }
    }
    /* versioned file names (libonnxruntime.so.1.24.1) */
    std::fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).find(|p| {
        p.file_name().and_then(|f| f.to_str()).map(|f| f.starts_with("libonnxruntime.so") || f.starts_with("libonnxruntime.") && f.ends_with(".dylib")).unwrap_or(false)
    })
}

/// The device each part uses ("CPU" / "GPU"), saved by the speed test in
/// vision.json next to the app's settings. Default CPU; DECARGO_VISION_DEVICE
/// overrides both.
fn devices(conf: &Path) -> (String, String) {
    if let Ok(d) = std::env::var("DECARGO_VISION_DEVICE") {
        return (d.clone(), d);
    }
    let v: serde_json::Value = std::fs::read_to_string(conf).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let pick = |k: &str| v[k].as_str().filter(|d| *d == "CPU" || d.starts_with("GPU")).unwrap_or("CPU").to_string();
    (pick("ocr"), pick("detector"))
}

fn session(path: &Path, device: &str, cache: &Path, openvino: bool) -> Result<Session, String> {
    let mut b = Session::builder().map_err(|e| e.to_string())?;
    b = b.with_optimization_level(GraphOptimizationLevel::Level3).map_err(|e| e.to_string())?;
    if openvino {
        let ov = ep::OpenVINO::default().with_device_type(device).with_cache_dir(cache.to_string_lossy()).build().error_on_failure();
        b = b.with_execution_providers([ov]).map_err(|e| e.to_string())?;
    } else {
        let threads = std::thread::available_parallelism().map(|n| n.get().min(8)).unwrap_or(4);
        b = b.with_intra_threads(threads).map_err(|e| e.to_string())?;
    }
    b.commit_from_file(path).map_err(|e| e.to_string())
}

fn open_ocr(models: &Path, cache: &Path, openvino: bool, dev: &str) -> Result<Option<Ocr>, String> {
    let (d, r) = (models.join("ocr-det.onnx"), models.join("ocr-rec.onnx"));
    if !d.exists() || !r.exists() {
        return Ok(None);
    }
    let keys = std::fs::read_to_string(models.join("ocr-keys.txt")).unwrap_or_default();
    let mut kv: Vec<String> = vec!["blank".into()];
    kv.extend(keys.lines().map(|l| l.to_string()));
    kv.push(" ".into());
    Ok(Some(Ocr { det: session(&d, dev, cache, openvino)?, rec: session(&r, dev, cache, openvino)?, keys: kv, device: if openvino { dev.to_string() } else { "CPU".into() } }))
}

fn open_obj(models: &Path, cache: &Path, openvino: bool, dev: &str) -> Result<Option<Obj>, String> {
    let p = models.join("detector.onnx");
    if !p.exists() {
        return Ok(None);
    }
    let (res, labels) = std::fs::read_to_string(models.join("detector.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .map(|v| {
            let res = v["res"].as_u64().unwrap_or(512) as usize;
            let mut l = vec![String::new(); 128];
            if let Some(m) = v["id2label"].as_object() {
                for (k, n) in m {
                    if let (Ok(i), Some(s)) = (k.parse::<usize>(), n.as_str()) {
                        if i < l.len() {
                            l[i] = s.to_string();
                        }
                    }
                }
            }
            (res, l)
        })
        .unwrap_or((512, vec![]));
    Ok(Some(Obj { s: session(&p, dev, cache, openvino)?, res, labels, device: if openvino { dev.to_string() } else { "CPU".into() } }))
}

fn load(base: &Path, conf: PathBuf) -> Result<Engine, String> {
    let rt = base.join("runtime");
    let models = base.join("models");
    let lib = runtime_lib(&rt).ok_or_else(|| format!("no ONNX Runtime in {}", rt.display()))?;
    /* the OpenVINO provider and its plugins sit next to onnxruntime: let Windows find them */
    if cfg!(windows) {
        let path = std::env::var("PATH").unwrap_or_default();
        std::env::set_var("PATH", format!("{};{}", rt.display(), path));
    }
    ort::init_from(&lib).map_err(|e| format!("ONNX Runtime: {e}"))?.with_name("decargo-vision").commit();
    let cache = dirs::cache_dir().unwrap_or_else(std::env::temp_dir).join("Decargo").join("vision-cache");
    let _ = std::fs::create_dir_all(&cache);
    let (d_ocr, d_obj) = devices(&conf);
    let mut openvino = std::env::var("DECARGO_VISION_EP").map(|v| v != "cpu").unwrap_or(true);
    /* OpenVINO first (on the saved device, then its CPU); if it cannot start
       on this machine, the plain CPU provider */
    let mut try_part = |f: &dyn Fn(bool, &str) -> Result<bool, String>, dev: &str| -> Result<(), String> {
        if openvino {
            if f(true, dev).is_ok() {
                return Ok(());
            }
            if dev != "CPU" && f(true, "CPU").is_ok() {
                return Ok(());
            }
            eprintln!("[vision] OpenVINO unavailable; using the CPU provider");
            openvino = false;
        }
        f(false, "CPU").map(|_| ())
    };
    let ocr: Mutex<Option<Ocr>> = Mutex::new(None);
    let obj: Mutex<Option<Obj>> = Mutex::new(None);
    try_part(&|ov, dev| open_ocr(&models, &cache, ov, dev).map(|o| { let some = o.is_some(); *ocr.lock().unwrap() = o; some }), &d_ocr)?;
    try_part(&|ov, dev| open_obj(&models, &cache, ov, dev).map(|o| { let some = o.is_some(); *obj.lock().unwrap() = o; some }), &d_obj)?;
    if ocr.lock().unwrap().is_none() && obj.lock().unwrap().is_none() {
        return Err(format!("no models in {}", models.display()));
    }
    Ok(Engine { ocr, obj, models, cache, conf, openvino })
}

fn engine(app: &tauri::AppHandle) -> Result<&'static Engine, String> {
    ENGINE
        .get_or_init(|| {
            let conf = app.path().app_config_dir().map(|d| d.join("vision.json")).unwrap_or_else(|_| PathBuf::from("vision.json"));
            load(&base_dir(app), conf)
        })
        .as_ref()
        .map_err(|e| e.clone())
}

fn device_text(e: &Engine) -> String {
    let o = e.ocr.lock().unwrap().as_ref().map(|o| o.device.clone());
    let d = e.obj.lock().unwrap().as_ref().map(|d| d.device.clone());
    let base = if e.openvino { "OpenVINO" } else { "ONNX Runtime" };
    match (o, d) {
        (Some(a), Some(b)) if a == b => format!("{base} {a}"),
        (Some(a), Some(b)) => format!("{base} · reading {a} · people {b}"),
        (Some(a), None) | (None, Some(a)) => format!("{base} {a}"),
        _ => base.into(),
    }
}

/* ── pixels ────────────────────────────────────────────────── */
struct Img<'a> {
    px: &'a [u8],
    w: usize,
    h: usize,
}
impl Img<'_> {
    /// bilinear sample (RGBA source), out of bounds → mid grey
    #[inline]
    fn sample(&self, x: f32, y: f32) -> [f32; 3] {
        if x < -0.5 || y < -0.5 || x > self.w as f32 - 0.5 || y > self.h as f32 - 0.5 {
            return [128.0; 3];
        }
        let x = x.clamp(0.0, (self.w - 1) as f32);
        let y = y.clamp(0.0, (self.h - 1) as f32);
        let (x0, y0) = (x.floor() as usize, y.floor() as usize);
        let (x1, y1) = ((x0 + 1).min(self.w - 1), (y0 + 1).min(self.h - 1));
        let (fx, fy) = (x - x0 as f32, y - y0 as f32);
        let p = |xx: usize, yy: usize, c: usize| self.px[(yy * self.w + xx) * 4 + c] as f32;
        let mut o = [0.0; 3];
        for c in 0..3 {
            let a = p(x0, y0, c) * (1.0 - fx) + p(x1, y0, c) * fx;
            let b = p(x0, y1, c) * (1.0 - fx) + p(x1, y1, c) * fx;
            o[c] = a * (1.0 - fy) + b * fy;
        }
        o
    }
    /// area-averaged resize for strong downscales, bilinear otherwise → CHW f32
    fn tensor(&self, ow: usize, oh: usize, mean: [f32; 3], std: [f32; 3], bgr: bool) -> Vec<f32> {
        let n = ow * oh;
        let mut out = vec![0f32; 3 * n];
        let sx = self.w as f32 / ow as f32;
        let sy = self.h as f32 / oh as f32;
        let k = (sx.max(sy)).floor().max(1.0) as usize;
        for y in 0..oh {
            for x in 0..ow {
                let mut acc = [0f32; 3];
                if k > 1 {
                    let (x0, y0) = ((x as f32 * sx) as usize, (y as f32 * sy) as usize);
                    let mut cnt = 0f32;
                    for yy in y0..(y0 + sy.ceil() as usize).min(self.h) {
                        for xx in x0..(x0 + sx.ceil() as usize).min(self.w) {
                            let q = (yy * self.w + xx) * 4;
                            acc[0] += self.px[q] as f32;
                            acc[1] += self.px[q + 1] as f32;
                            acc[2] += self.px[q + 2] as f32;
                            cnt += 1.0;
                        }
                    }
                    for v in acc.iter_mut() {
                        *v /= cnt.max(1.0);
                    }
                } else {
                    acc = self.sample((x as f32 + 0.5) * sx - 0.5, (y as f32 + 0.5) * sy - 0.5);
                }
                let i = y * ow + x;
                let (r, g, b) = (acc[0] / 255.0, acc[1] / 255.0, acc[2] / 255.0);
                let ch = if bgr { [b, g, r] } else { [r, g, b] };
                for c in 0..3 {
                    out[c * n + i] = (ch[c] - mean[c]) / std[c];
                }
            }
        }
        out
    }
}

/* ── OCR: PP-OCR DB detection + CTC recognition (same steps as vision.js) ── */
fn hull(mut pts: Vec<(f32, f32)>) -> Vec<(f32, f32)> {
    pts.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap().then(a.1.partial_cmp(&b.1).unwrap()));
    pts.dedup();
    if pts.len() < 3 {
        return pts;
    }
    let cr = |o: (f32, f32), a: (f32, f32), b: (f32, f32)| (a.0 - o.0) * (b.1 - o.1) - (a.1 - o.1) * (b.0 - o.0);
    let mut lo: Vec<(f32, f32)> = vec![];
    for &p in &pts {
        while lo.len() >= 2 && cr(lo[lo.len() - 2], lo[lo.len() - 1], p) <= 0.0 {
            lo.pop();
        }
        lo.push(p);
    }
    let mut up: Vec<(f32, f32)> = vec![];
    for &p in pts.iter().rev() {
        while up.len() >= 2 && cr(up[up.len() - 2], up[up.len() - 1], p) <= 0.0 {
            up.pop();
        }
        up.push(p);
    }
    lo.pop();
    up.pop();
    lo.extend(up);
    lo
}

/// minimum-area rectangle around a hull → (cx, cy, w, h, angle)
fn min_rect(h: &[(f32, f32)]) -> (f32, f32, f32, f32, f32) {
    if h.len() < 3 {
        let (mut x0, mut x1, mut y0, mut y1) = (f32::MAX, f32::MIN, f32::MAX, f32::MIN);
        for p in h {
            x0 = x0.min(p.0);
            x1 = x1.max(p.0);
            y0 = y0.min(p.1);
            y1 = y1.max(p.1);
        }
        return ((x0 + x1) / 2.0, (y0 + y1) / 2.0, x1 - x0 + 1.0, y1 - y0 + 1.0, 0.0);
    }
    let mut best = (f32::MAX, 0.0, 0.0, 0.0, 0.0, 0.0);
    for i in 0..h.len() {
        let (p, q) = (h[i], h[(i + 1) % h.len()]);
        let a = (q.1 - p.1).atan2(q.0 - p.0);
        let (c, s) = (a.cos(), a.sin());
        let (mut u0, mut u1, mut v0, mut v1) = (f32::MAX, f32::MIN, f32::MAX, f32::MIN);
        for r in h {
            let u = r.0 * c + r.1 * s;
            let v = -r.0 * s + r.1 * c;
            u0 = u0.min(u);
            u1 = u1.max(u);
            v0 = v0.min(v);
            v1 = v1.max(v);
        }
        let area = (u1 - u0) * (v1 - v0);
        if area < best.0 {
            let (mu, mv) = ((u0 + u1) / 2.0, (v0 + v1) / 2.0);
            best = (area, mu * c - mv * s, mu * s + mv * c, u1 - u0 + 1.0, v1 - v0 + 1.0, a);
        }
    }
    (best.1, best.2, best.3, best.4, best.5)
}

struct TBox {
    cx: f32,
    cy: f32,
    w: f32,
    h: f32,
    a: f32,
}

fn detect_text(det: &mut Session, img: &Img) -> Result<Vec<TBox>, String> {
    let (w0, h0) = (img.w as f32, img.h as f32);
    /* PaddleOCR: smaller side up to 736, sides multiple of 32, longer side ≤ 1600 */
    let mut s = (736.0 / w0.min(h0)).max(1.0);
    if w0.max(h0) * s > 1600.0 {
        s = 1600.0 / w0.max(h0);
    }
    let w = (((w0 * s) / 32.0).round() as usize * 32).max(32);
    let h = (((h0 * s) / 32.0).round() as usize * 32).max(32);
    let data = img.tensor(w, h, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225], true);
    let t = Tensor::from_array(([1usize, 3, h, w], data)).map_err(|e| e.to_string())?;
    let out = det.run(ort::inputs![t]).map_err(|e| e.to_string())?;
    let (_, prob) = out[0].try_extract_tensor::<f32>().map_err(|e| e.to_string())?;
    let prob = prob.to_vec();
    drop(out);
    let mut lab = vec![0u8; w * h];
    let mut boxes = vec![];
    let mut stack = vec![];
    for i in 0..w * h {
        if lab[i] != 0 || prob[i] <= 0.3 {
            continue;
        }
        let mut pts = vec![];
        let (mut sum, mut n) = (0f32, 0usize);
        lab[i] = 1;
        stack.push(i);
        while let Some(k) = stack.pop() {
            let (x, y) = (k % w, k / w);
            pts.push((x as f32, y as f32));
            sum += prob[k];
            n += 1;
            let mut push = |q: usize| {
                if lab[q] == 0 && prob[q] > 0.3 {
                    lab[q] = 1;
                    stack.push(q);
                }
            };
            if x > 0 { push(k - 1); }
            if x + 1 < w { push(k + 1); }
            if y > 0 { push(k - w); }
            if y + 1 < h { push(k + w); }
        }
        if n < 12 || sum / (n as f32) < 0.6 {
            continue;
        }
        let (cx, cy, rw, rh, a) = min_rect(&hull(pts));
        if rw.min(rh) < 3.0 {
            continue;
        }
        let d = rw * rh * 1.5 / (2.0 * (rw + rh)); /* unclip 1.5 */
        boxes.push(TBox { cx, cy, w: rw + 2.0 * d, h: rh + 2.0 * d, a });
    }
    let (sx, sy) = (w0 / w as f32, h0 / h as f32);
    let k = (sx + sy) / 2.0;
    Ok(boxes.into_iter().map(|b| TBox { cx: b.cx * sx, cy: b.cy * sy, w: b.w * k, h: b.h * k, a: b.a }).collect())
}

fn recognise(rec: &mut Session, keys: &[String], img: &Img, b: &TBox, flip: bool) -> Result<(String, f32), String> {
    let (mut a, mut bw, mut bh) = (b.a, b.w, b.h);
    if bh > bw {
        a += std::f32::consts::FRAC_PI_2;
        std::mem::swap(&mut bw, &mut bh);
    }
    if flip {
        a += std::f32::consts::PI;
    }
    let oh = 48usize;
    let ow = ((oh as f32 * bw / bh).round() as usize).clamp(16, 640);
    let (c, s) = (a.cos(), a.sin());
    let n = ow * oh;
    let mut data = vec![0f32; 3 * n];
    for y in 0..oh {
        for x in 0..ow {
            /* output pixel → box frame → source */
            let u = (x as f32 + 0.5 - ow as f32 / 2.0) * bw / ow as f32;
            let v = (y as f32 + 0.5 - oh as f32 / 2.0) * bh / oh as f32;
            let p = img.sample(b.cx + u * c - v * s - 0.5, b.cy + u * s + v * c - 0.5);
            let i = y * ow + x;
            /* BGR, (x/255 − 0.5)/0.5 */
            data[i] = (p[2] / 255.0 - 0.5) / 0.5;
            data[n + i] = (p[1] / 255.0 - 0.5) / 0.5;
            data[2 * n + i] = (p[0] / 255.0 - 0.5) / 0.5;
        }
    }
    let t = Tensor::from_array(([1usize, 3, oh, ow], data)).map_err(|e| e.to_string())?;
    let out = rec.run(ort::inputs![t]).map_err(|e| e.to_string())?;
    let (shape, p) = out[0].try_extract_tensor::<f32>().map_err(|e| e.to_string())?;
    let (tt, cc) = (shape[1] as usize, shape[2] as usize);
    let (mut text, mut last, mut sc, mut cnt) = (String::new(), 0usize, 0f32, 0usize);
    for i in 0..tt {
        let row = &p[i * cc..(i + 1) * cc];
        let (mut m, mut mv) = (0usize, f32::MIN);
        for (j, &v) in row.iter().enumerate() {
            if v > mv {
                mv = v;
                m = j;
            }
        }
        if m != 0 && m != last {
            if let Some(k) = keys.get(m) {
                text.push_str(k);
            }
            sc += mv;
            cnt += 1;
        }
        last = m;
    }
    Ok((text, if cnt > 0 { sc / cnt as f32 } else { 0.0 }))
}

fn read_text(e: &mut Ocr, img: &Img, both: bool, max: usize) -> Result<Vec<TextHit>, String> {
    let (det, rec) = (&mut e.det, &mut e.rec);
    let boxes = detect_text(det, img)?;
    let mut res = vec![];
    for b in boxes.iter().take(max) {
        let r1 = recognise(rec, &e.keys, img, b, false)?;
        let r2 = if both { recognise(rec, &e.keys, img, b, true)? } else { (String::new(), 0.0) };
        let (text, score) = if r2.1 > r1.1 { r2 } else { r1 };
        if !text.trim().is_empty() {
            res.push(TextHit { text, score, cx: b.cx, cy: b.cy, w: b.w, h: b.h, a: b.a });
        }
    }
    Ok(res)
}

/* ── objects: RF-DETR (cx, cy, w, h normalised; sigmoid class scores) ── */
fn detect_objects(e: &mut Obj, img: &Img, min_score: f32) -> Result<Vec<ObjHit>, String> {
    let r = e.res;
    let obj = &mut e.s;
    let data = img.tensor(r, r, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225], false);
    let t = Tensor::from_array(([1usize, 3, r, r], data)).map_err(|e| e.to_string())?;
    let out = obj.run(ort::inputs![t]).map_err(|e| e.to_string())?;
    let (ls, lo) = out[0].try_extract_tensor::<f32>().map_err(|e| e.to_string())?;
    let (_, bo) = out[1].try_extract_tensor::<f32>().map_err(|e| e.to_string())?;
    let (q, c) = (ls[1] as usize, ls[2] as usize);
    let mut hits = vec![];
    for i in 0..q {
        let row = &lo[i * c..(i + 1) * c];
        let (mut m, mut mv) = (0usize, f32::MIN);
        for (j, &v) in row.iter().enumerate() {
            if v > mv {
                mv = v;
                m = j;
            }
        }
        let sc = 1.0 / (1.0 + (-mv).exp());
        if sc < min_score {
            continue;
        }
        let b = &bo[i * 4..i * 4 + 4];
        let (w, h) = (img.w as f32, img.h as f32);
        hits.push(ObjHit {
            label: e.labels.get(m).cloned().filter(|s| !s.is_empty()).unwrap_or_else(|| format!("class{m}")),
            score: sc,
            x: (b[0] - b[2] / 2.0) * w,
            y: (b[1] - b[3] / 2.0) * h,
            w: b[2] * w,
            h: b[3] * h,
        });
    }
    hits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap());
    Ok(hits)
}

/* ── raw IPC body: RGBA bytes, size in headers ──────────────── */
fn frame(req: &tauri::ipc::Request) -> Result<(Vec<u8>, usize, usize), String> {
    let hv = |k: &str| req.headers().get(k).and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<usize>().ok());
    let (w, h) = (hv("x-w").ok_or("x-w missing")?, hv("x-h").ok_or("x-h missing")?);
    let px = match req.body() {
        tauri::ipc::InvokeBody::Raw(b) => b.clone(),
        _ => return Err("expected raw RGBA body".into()),
    };
    if w == 0 || h == 0 || px.len() < w * h * 4 {
        return Err(format!("bad frame {w}x{h}, {} bytes", px.len()));
    }
    Ok((px, w, h))
}

/* ── commands ──────────────────────────────────────────────── */
#[tauri::command]
pub async fn vision_status(app: tauri::AppHandle) -> Status {
    let dir = base_dir(&app);
    tauri::async_runtime::spawn_blocking(move || match engine(&app) {
        Ok(e) => Status { ok: true, device: device_text(e), error: String::new(), ocr: e.ocr.lock().unwrap().is_some(), detector: e.obj.lock().unwrap().is_some(), dir: dir.display().to_string() },
        Err(err) => Status { ok: false, device: String::new(), error: err, ocr: false, detector: false, dir: dir.display().to_string() },
    })
    .await
    .unwrap_or(Status { ok: false, device: String::new(), error: "vision thread failed".into(), ocr: false, detector: false, dir: String::new() })
}

#[tauri::command]
pub async fn vision_ocr(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<Vec<TextHit>, String> {
    let (px, w, h) = frame(&request)?;
    let both = request.headers().get("x-both").map(|v| v != "0").unwrap_or(true);
    tauri::async_runtime::spawn_blocking(move || {
        let e = engine(&app)?;
        let mut g = e.ocr.lock().unwrap();
        let o = g.as_mut().ok_or("OCR models missing")?;
        read_text(o, &Img { px: &px, w, h }, both, 40)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn vision_detect(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<Vec<ObjHit>, String> {
    let (px, w, h) = frame(&request)?;
    let min = request.headers().get("x-min").and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<f32>().ok()).unwrap_or(0.35);
    tauri::async_runtime::spawn_blocking(move || {
        let e = engine(&app)?;
        let mut g = e.obj.lock().unwrap();
        let d = g.as_mut().ok_or("detector model missing")?;
        detect_objects(d, &Img { px: &px, w, h }, min)
    })
    .await
    .map_err(|e| e.to_string())?
}

/* the speed test: typical work for each part (one 512 px detector pass; one
   text search on a 640×224 crop plus 8 line reads, both directions) */
fn time_obj(d: &mut Obj, img: &Img) -> Result<f64, String> {
    detect_objects(d, img, 0.99)?;
    let t = Instant::now();
    for _ in 0..3 {
        detect_objects(d, img, 0.99)?;
    }
    Ok(t.elapsed().as_secs_f64() * 1000.0 / 3.0)
}
fn time_ocr(o: &mut Ocr, img: &Img) -> Result<f64, String> {
    let b = TBox { cx: 160.0, cy: 112.0, w: 240.0, h: 40.0, a: 0.0 };
    let run = |o: &mut Ocr| -> Result<(), String> {
        detect_text(&mut o.det, img)?;
        for _ in 0..8 {
            recognise(&mut o.rec, &o.keys, img, &b, false)?;
        }
        Ok(())
    };
    run(o)?;
    let t = Instant::now();
    for _ in 0..2 {
        run(o)?;
    }
    Ok(t.elapsed().as_secs_f64() * 1000.0 / 2.0)
}

/// Times both parts on this computer's CPU and — with OpenVINO — its graphics
/// chip, keeps the faster device for each, and remembers the choice.
#[tauri::command]
pub async fn vision_bench(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let e = engine(&app)?;
        let pic = |w: usize, h: usize| -> Vec<u8> { (0..w * h * 4).map(|i| { let (x, y) = (i / 4 % w, i / 4 / w); (((x / 7) ^ (y / 5)) * 37 % 256) as u8 }).collect() };
        let (p512, p640) = (pic(512, 512), pic(640, 224));
        let (i512, i640) = (Img { px: &p512, w: 512, h: 512 }, Img { px: &p640, w: 640, h: 224 });
        let devs: Vec<&str> = if e.openvino { vec!["CPU", "GPU"] } else { vec!["CPU"] };
        let mut out = serde_json::json!({});
        let mut chosen = serde_json::json!({});
        /* people detector */
        if e.obj.lock().unwrap().is_some() {
            let mut best: Option<(f64, Obj)> = None;
            for dev in &devs {
                let part = if *dev == e.obj.lock().unwrap().as_ref().map(|d| d.device.clone()).unwrap_or_default() {
                    e.obj.lock().unwrap().take()
                } else {
                    open_obj(&e.models, &e.cache, e.openvino, dev).ok().flatten()
                };
                if let Some(mut p) = part {
                    match time_obj(&mut p, &i512) {
                        Ok(ms) => {
                            out["detector"][*dev] = serde_json::json!(ms.round());
                            if best.as_ref().map(|b| ms < b.0).unwrap_or(true) {
                                best = Some((ms, p));
                            }
                        }
                        Err(err) => out["detector"][*dev] = serde_json::json!(err),
                    }
                }
            }
            if let Some((ms, p)) = best {
                chosen["detector"] = serde_json::json!(p.device);
                out["detector_ms"] = serde_json::json!(ms.round());
                *e.obj.lock().unwrap() = Some(p);
            }
        }
        /* number reading */
        if e.ocr.lock().unwrap().is_some() {
            let mut best: Option<(f64, Ocr)> = None;
            for dev in &devs {
                let part = if *dev == e.ocr.lock().unwrap().as_ref().map(|o| o.device.clone()).unwrap_or_default() {
                    e.ocr.lock().unwrap().take()
                } else {
                    open_ocr(&e.models, &e.cache, e.openvino, dev).ok().flatten()
                };
                if let Some(mut p) = part {
                    match time_ocr(&mut p, &i640) {
                        Ok(ms) => {
                            out["ocr"][*dev] = serde_json::json!(ms.round());
                            if best.as_ref().map(|b| ms < b.0).unwrap_or(true) {
                                best = Some((ms, p));
                            }
                        }
                        Err(err) => out["ocr"][*dev] = serde_json::json!(err),
                    }
                }
            }
            if let Some((ms, p)) = best {
                chosen["ocr"] = serde_json::json!(p.device);
                out["ocr_ms"] = serde_json::json!(ms.round());
                *e.ocr.lock().unwrap() = Some(p);
            }
        }
        if let Some(d) = e.conf.parent() {
            let _ = std::fs::create_dir_all(d);
        }
        let _ = std::fs::write(&e.conf, serde_json::to_string_pretty(&chosen).unwrap_or_default());
        out["device"] = serde_json::json!(device_text(e));
        out["chosen"] = chosen;
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

/* ── tests: run against the Linux ORT library and the real models when
   DECARGO_VISION_DIR points at a folder with runtime/ and models/ ── */
#[cfg(test)]
mod tests {
    use super::*;

    fn rgba(path: &str) -> (Vec<u8>, usize, usize) {
        let d = std::fs::read(path).unwrap();
        /* tests take raw .rgba files: 8-byte header (w, h as u32 LE) + pixels */
        let w = u32::from_le_bytes(d[0..4].try_into().unwrap()) as usize;
        let h = u32::from_le_bytes(d[4..8].try_into().unwrap()) as usize;
        (d[8..].to_vec(), w, h)
    }

    /* Development only: the engine behind a local socket, so the web build of
       the app can be driven headless against the real models (tools/vision/
       autotest). Runs only with DECARGO_VISION_SERVE=<port> (and DECARGO_VISION_DIR).
       Request: one JSON line {cmd: "ocr"|"det"|"status", w, h, both, min, max}
       then w*h*4 RGBA bytes (none for status); reply: one JSON line. */
    #[test]
    fn serve() {
        use std::io::{BufRead, BufReader, Read, Write};
        let (Ok(port), Ok(dir)) = (std::env::var("DECARGO_VISION_SERVE"), std::env::var("DECARGO_VISION_DIR")) else { return };
        let e = load(Path::new(&dir), std::env::temp_dir().join("decargo-vision-serve.json")).expect("engine");
        eprintln!("vision serve on {port} · {}", device_text(&e));
        let l = std::net::TcpListener::bind(format!("127.0.0.1:{port}")).expect("bind");
        for conn in l.incoming() {
            let Ok(c) = conn else { continue };
            let mut rd = BufReader::new(c.try_clone().unwrap());
            let mut wr = c;
            loop {
                let mut line = String::new();
                if rd.read_line(&mut line).unwrap_or(0) == 0 { break; }
                let q: serde_json::Value = match serde_json::from_str(line.trim()) { Ok(v) => v, Err(_) => break };
                let cmd = q["cmd"].as_str().unwrap_or("");
                let (w, h) = (q["w"].as_u64().unwrap_or(0) as usize, q["h"].as_u64().unwrap_or(0) as usize);
                let mut px = vec![0u8; if cmd == "status" { 0 } else { w * h * 4 }];
                if rd.read_exact(&mut px).is_err() { break; }
                let img = Img { px: &px, w, h };
                let out = match cmd {
                    "ocr" => e.ocr.lock().unwrap().as_mut().map(|o| serde_json::to_string(&read_text(o, &img, q["both"].as_bool().unwrap_or(true), q["max"].as_u64().unwrap_or(40) as usize).unwrap_or_default()).unwrap()),
                    "det" => e.obj.lock().unwrap().as_mut().map(|d| serde_json::to_string(&detect_objects(d, &img, q["min"].as_f64().unwrap_or(0.45) as f32).unwrap_or_default()).unwrap()),
                    _ => Some(format!("{{\"ok\":true,\"device\":{}}}", serde_json::to_string(&device_text(&e)).unwrap())),
                }.unwrap_or_else(|| "null".into());
                if writeln!(wr, "{out}").is_err() { break; }
            }
        }
    }

    #[test]
    fn engine_reads_and_detects() {
        let Ok(dir) = std::env::var("DECARGO_VISION_DIR") else { return };
        let e = load(Path::new(&dir), std::env::temp_dir().join("decargo-vision-test.json")).expect("engine");
        eprintln!("device {}", device_text(&e));
        let mut og = e.ocr.lock().unwrap();
        let mut dg = e.obj.lock().unwrap();
        /* CI on Windows: the OpenVINO build must start, and every model must run */
        if std::env::var("DECARGO_EXPECT_OPENVINO").is_ok() {
            assert!(e.openvino, "OpenVINO did not start: {}", device_text(&e));
            assert!(og.is_some() && dg.is_some(), "a model is missing");
            let (w, h) = (640usize, 480usize);
            let px: Vec<u8> = (0..w * h * 4).map(|i| ((i / 4 % w) as u8) ^ ((i / 4 / w) as u8)).collect();
            let img = Img { px: &px, w, h };
            let t = Instant::now();
            read_text(og.as_mut().unwrap(), &img, true, 8).expect("ocr runs");
            detect_objects(dg.as_mut().unwrap(), &img, 0.5).expect("detector runs");
            eprintln!("synthetic run ok in {} ms", t.elapsed().as_millis());
        }
        if let (Ok(p), Some(o)) = (std::env::var("DECARGO_TEST_OCR"), og.as_mut()) {
            let (px, w, h) = rgba(&p);
            read_text(o, &Img { px: &px, w, h }, true, 40).unwrap();
            let t = Instant::now();
            let r = read_text(o, &Img { px: &px, w, h }, true, 40).unwrap();
            eprintln!("ocr (warm) {} ms: {:?}", t.elapsed().as_millis(), r.iter().map(|x| (x.text.clone(), (x.score * 100.0).round())).collect::<Vec<_>>());
        }
        if let (Ok(p), Some(d)) = (std::env::var("DECARGO_TEST_DET"), dg.as_mut()) {
            let (px, w, h) = rgba(&p);
            detect_objects(d, &Img { px: &px, w, h }, 0.35).unwrap();
            let t = Instant::now();
            let r = detect_objects(d, &Img { px: &px, w, h }, 0.35).unwrap();
            eprintln!("det {} ms: {:?}", t.elapsed().as_millis(), r.iter().map(|x| (x.label.clone(), (x.score * 100.0).round(), x.x as i32, x.y as i32, x.w as i32, x.h as i32)).collect::<Vec<_>>());
        }
        if let (Some(o), Some(d)) = (og.as_mut(), dg.as_mut()) {
            let (p512, p640): (Vec<u8>, Vec<u8>) = ((0..512 * 512 * 4).map(|i| (i % 251) as u8).collect(), (0..640 * 224 * 4).map(|i| (i % 241) as u8).collect());
            eprintln!("bench: detector {:.0} ms, reading {:.0} ms", time_obj(d, &Img { px: &p512, w: 512, h: 512 }).unwrap(), time_ocr(o, &Img { px: &p640, w: 640, h: 224 }).unwrap());
        }
    }
}
