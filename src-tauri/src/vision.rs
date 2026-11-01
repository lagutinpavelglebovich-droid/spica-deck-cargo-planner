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

struct Engine {
    device: String,
    det: Option<Session>,
    rec: Option<Session>,
    keys: Vec<String>,
    obj: Option<Session>,
    obj_res: usize,
    labels: Vec<String>,
}

static ENGINE: OnceLock<Mutex<Result<Engine, String>>> = OnceLock::new();
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

/// Which OpenVINO device to ask for: DECARGO_VISION_DEVICE, else CPU (the
/// bridge PC's 20-core CPU beats its small iGPU on these models; `vision_bench`
/// measures both).
fn wanted_device() -> String {
    std::env::var("DECARGO_VISION_DEVICE").unwrap_or_else(|_| "CPU".into())
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

fn load(base: &Path) -> Result<Engine, String> {
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
    let dev = wanted_device();
    /* OpenVINO first; if it cannot start on this machine, the plain CPU provider */
    let mut openvino = std::env::var("DECARGO_VISION_EP").map(|v| v != "cpu").unwrap_or(true);
    let mut device = format!("OpenVINO {dev}");
    let mut open = |name: &str| -> Result<Option<Session>, String> {
        let p = models.join(name);
        if !p.exists() {
            return Ok(None);
        }
        if openvino {
            match session(&p, &dev, &cache, true) {
                Ok(s) => return Ok(Some(s)),
                Err(e) => {
                    eprintln!("[vision] OpenVINO unavailable ({e}); using the CPU provider");
                    openvino = false;
                }
            }
        }
        session(&p, &dev, &cache, false).map(Some)
    };
    let det = open("ocr-det.onnx")?;
    let rec = open("ocr-rec.onnx")?;
    let obj = open("detector.onnx")?;
    if !openvino {
        device = "CPU".into();
    }
    let keys = std::fs::read_to_string(models.join("ocr-keys.txt")).unwrap_or_default();
    let mut kv: Vec<String> = vec!["blank".into()];
    kv.extend(keys.lines().map(|l| l.to_string()));
    kv.push(" ".into());
    let (obj_res, labels) = std::fs::read_to_string(models.join("detector.json"))
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
    if det.is_none() && obj.is_none() {
        return Err(format!("no models in {}", models.display()));
    }
    Ok(Engine { device, det, rec, keys: kv, obj, obj_res, labels })
}

fn engine(app: &tauri::AppHandle) -> &'static Mutex<Result<Engine, String>> {
    ENGINE.get_or_init(|| Mutex::new(load(&base_dir(app))))
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

fn read_text(e: &mut Engine, img: &Img, both: bool, max: usize) -> Result<Vec<TextHit>, String> {
    let (det, rec) = match (e.det.as_mut(), e.rec.as_mut()) {
        (Some(d), Some(r)) => (d, r),
        _ => return Err("OCR models missing".into()),
    };
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
fn detect_objects(e: &mut Engine, img: &Img, min_score: f32) -> Result<Vec<ObjHit>, String> {
    let r = e.obj_res;
    let obj = e.obj.as_mut().ok_or("detector model missing")?;
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
    tauri::async_runtime::spawn_blocking(move || {
        let g = engine(&app).lock().unwrap();
        match &*g {
            Ok(e) => Status { ok: true, device: e.device.clone(), error: String::new(), ocr: e.det.is_some() && e.rec.is_some(), detector: e.obj.is_some(), dir: dir.display().to_string() },
            Err(err) => Status { ok: false, device: String::new(), error: err.clone(), ocr: false, detector: false, dir: dir.display().to_string() },
        }
    })
    .await
    .unwrap_or(Status { ok: false, device: String::new(), error: "vision thread failed".into(), ocr: false, detector: false, dir: String::new() })
}

#[tauri::command]
pub async fn vision_ocr(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<Vec<TextHit>, String> {
    let (px, w, h) = frame(&request)?;
    let both = request.headers().get("x-both").map(|v| v != "0").unwrap_or(true);
    tauri::async_runtime::spawn_blocking(move || {
        let mut g = engine(&app).lock().unwrap();
        let e = g.as_mut().map_err(|e| e.clone())?;
        read_text(e, &Img { px: &px, w, h }, both, 40)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn vision_detect(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<Vec<ObjHit>, String> {
    let (px, w, h) = frame(&request)?;
    let min = request.headers().get("x-min").and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<f32>().ok()).unwrap_or(0.35);
    tauri::async_runtime::spawn_blocking(move || {
        let mut g = engine(&app).lock().unwrap();
        let e = g.as_mut().map_err(|e| e.clone())?;
        detect_objects(e, &Img { px: &px, w, h }, min)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Times each model on this machine (ms per run, after a warm-up).
#[tauri::command]
pub async fn vision_bench(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut g = engine(&app).lock().unwrap();
        let e = g.as_mut().map_err(|e| e.clone())?;
        let (w, h) = (960usize, 960usize);
        let px: Vec<u8> = (0..w * h * 4).map(|i| ((i * 7919) % 251) as u8).collect();
        let img = Img { px: &px, w, h };
        let mut out = serde_json::json!({ "device": e.device });
        if e.obj.is_some() {
            detect_objects(e, &img, 0.99)?;
            let t = Instant::now();
            for _ in 0..3 {
                detect_objects(e, &img, 0.99)?;
            }
            out["detector_ms"] = serde_json::json!(t.elapsed().as_millis() as f64 / 3.0);
        }
        if e.det.is_some() && e.rec.is_some() {
            let crop = Img { px: &px[..320 * 320 * 4], w: 320, h: 320 };
            read_text(e, &crop, false, 4)?;
            let t = Instant::now();
            for _ in 0..3 {
                read_text(e, &crop, true, 8)?;
            }
            out["ocr_ms"] = serde_json::json!(t.elapsed().as_millis() as f64 / 3.0);
        }
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

    #[test]
    fn engine_reads_and_detects() {
        let Ok(dir) = std::env::var("DECARGO_VISION_DIR") else { return };
        let mut e = load(Path::new(&dir)).expect("engine");
        eprintln!("device {}", e.device);
        /* CI on Windows: the OpenVINO build must start, and every model must run */
        if std::env::var("DECARGO_EXPECT_OPENVINO").is_ok() {
            assert!(e.device.starts_with("OpenVINO"), "OpenVINO did not start: {}", e.device);
            assert!(e.det.is_some() && e.rec.is_some() && e.obj.is_some(), "a model is missing");
            let (w, h) = (640usize, 480usize);
            let px: Vec<u8> = (0..w * h * 4).map(|i| ((i / 4 % w) as u8) ^ ((i / 4 / w) as u8)).collect();
            let img = Img { px: &px, w, h };
            let t = Instant::now();
            read_text(&mut e, &img, true, 8).expect("ocr runs");
            detect_objects(&mut e, &img, 0.5).expect("detector runs");
            eprintln!("synthetic run ok in {} ms", t.elapsed().as_millis());
        }
        if let Ok(p) = std::env::var("DECARGO_TEST_OCR") {
            let (px, w, h) = rgba(&p);
            read_text(&mut e, &Img { px: &px, w, h }, true, 40).unwrap();
            let t = Instant::now();
            let r = read_text(&mut e, &Img { px: &px, w, h }, true, 40).unwrap();
            eprintln!("ocr (warm) {} ms: {:?}", t.elapsed().as_millis(), r.iter().map(|x| (x.text.clone(), (x.score * 100.0).round())).collect::<Vec<_>>());
        }
        if let Ok(p) = std::env::var("DECARGO_TEST_DET") {
            let (px, w, h) = rgba(&p);
            detect_objects(&mut e, &Img { px: &px, w, h }, 0.35).unwrap();
            let t = Instant::now();
            let r = detect_objects(&mut e, &Img { px: &px, w, h }, 0.35).unwrap();
            eprintln!("det {} ms: {:?}", t.elapsed().as_millis(), r.iter().map(|x| (x.label.clone(), (x.score * 100.0).round(), x.x as i32, x.y as i32, x.w as i32, x.h as i32)).collect::<Vec<_>>());
        }
    }
}
