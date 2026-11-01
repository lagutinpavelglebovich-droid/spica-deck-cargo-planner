#!/usr/bin/env python3
"""
v3.41 — assemble the native vision pack bundled with the app (src-tauri/vision):

  runtime/  ONNX Runtime 1.24.1 with the OpenVINO execution provider
            (+ OpenVINO 2025.4.1 runtime and, on Windows, the MSVC runtime)
  models/   ocr-det.onnx  PP-OCRv5 server text detection        (Apache-2.0)
            ocr-rec.onnx  PP-OCRv5 English text recognition     (Apache-2.0)
            ocr-keys.txt  its character list
            detector.onnx RF-DETR small, COCO classes           (Apache-2.0)
            detector.json input size + class names

Everything is pinned (package versions, Hugging Face revisions, SHA-256 of the
OCR files). The detector is exported here from the official Roboflow weights
(export_rfdetr.py) — that needs torch + transformers.

usage: python tools/vision/fetch-vision.py [--platform win|linux] [--out DIR] [--skip-detector]
"""
import argparse, hashlib, os, shutil, subprocess, sys, tempfile, urllib.request, zipfile, glob, json

ORT_OV = "onnxruntime-openvino==1.24.1"
OPENVINO = "openvino==2025.4.1"          # the version ORT-OpenVINO 1.24.1 is built against
OCR_REPO = "monkt/paddleocr-onnx"
OCR_REV = "7b02d0a30a07ba2b92ad1ff5a8941ae2c633de65"
OCR_FILES = {
    "ocr-det.onnx": ("detection/v5/det.onnx", "61824840edf6e74581898930b8091b1b2318f4b2705a2e8a40ad3de7ac480133"),
    "ocr-rec.onnx": ("languages/english/rec.onnx", "4e16deb22c4da6468bdca539b2cd3c8687825538b67109177c47d359ab994cd7"),
    "ocr-keys.txt": ("languages/english/dict.txt", "e025a66d31f327ba0c232e03f407ae8d105e1e709e7ccb3f408aa778c24e70d6"),
}
DET_REPO = "Roboflow/rf-detr-small"
DET_REV = "3bdc465063270f99769da5a1b4c00c68bd2d439d"

WIN_ORT_DLLS = ["onnxruntime.dll", "onnxruntime_providers_openvino.dll", "onnxruntime_providers_shared.dll"]
WIN_OV_FILES = ["openvino.dll", "openvino_intel_cpu_plugin.dll", "openvino_intel_gpu_plugin.dll", "openvino_auto_plugin.dll",
                "openvino_auto_batch_plugin.dll", "openvino_hetero_plugin.dll", "openvino_onnx_frontend.dll", "openvino_ir_frontend.dll",
                "tbb12.dll", "tbbbind_2_5.dll", "tbbmalloc.dll", "tbbmalloc_proxy.dll", "cache.json"]
WIN_CRT = ["vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll", "msvcp140_1.dll", "msvcp140_2.dll", "concrt140.dll"]

LICENSES = """Decargo — third-party components of the recognition engine (vision/)

ONNX Runtime 1.24.1 (OpenVINO build)   MIT License, (c) Microsoft Corporation / Intel Corporation
OpenVINO 2025.4.1 runtime              Apache License 2.0, (c) Intel Corporation
oneTBB                                 Apache License 2.0, (c) Intel Corporation
PP-OCRv5 models (PaddleOCR)            Apache License 2.0, (c) PaddlePaddle Authors — ONNX conversion: huggingface.co/monkt/paddleocr-onnx
RF-DETR small (Roboflow)               Apache License 2.0, (c) Roboflow, Inc. — exported from huggingface.co/Roboflow/rf-detr-small
Microsoft Visual C++ runtime (Windows) redistributed under the Visual Studio redistributable terms

Full licence texts: https://www.apache.org/licenses/LICENSE-2.0 · https://opensource.org/licenses/MIT
"""


def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def fetch(url, dst):
    print("  ↓", url)
    with urllib.request.urlopen(url) as r, open(dst, "wb") as f:
        shutil.copyfileobj(r, f)


def pip_download(spec, platform, tmp):
    args = [sys.executable, "-m", "pip", "download", "-q", "--no-deps", "--only-binary=:all:", "-d", tmp, spec]
    if platform == "win":
        args[4:4] = ["--platform", "win_amd64", "--python-version", "3.12"]
    subprocess.check_call(args)
    name = spec.split("==")[0].replace("-", "_")
    return glob.glob(os.path.join(tmp, name + "-*.whl"))[0]


def runtime(platform, out):
    rt = os.path.join(out, "runtime")
    os.makedirs(rt, exist_ok=True)
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp, zipfile.ZipFile(pip_download(ORT_OV, platform, tmp)) as ort:
        if platform == "win":
            for n in WIN_ORT_DLLS:
                with ort.open("onnxruntime/capi/" + n) as s, open(os.path.join(rt, n), "wb") as d:
                    shutil.copyfileobj(s, d)
            with zipfile.ZipFile(pip_download(OPENVINO, platform, tmp)) as ov:
                for n in WIN_OV_FILES:
                    with ov.open("openvino/libs/" + n) as s, open(os.path.join(rt, n), "wb") as d:
                        shutil.copyfileobj(s, d)
            sysdir = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32")
            for n in WIN_CRT:
                p = os.path.join(sysdir, n)
                if os.path.exists(p):
                    shutil.copy2(p, rt)
                else:
                    print("  (no", n, "on this machine)")
        else:
            # the Linux wheel carries the OpenVINO libraries itself
            for i in ort.infolist():
                f = i.filename
                if f.startswith("onnxruntime/capi/") and ".so" in f and "pybind11" not in f:
                    with ort.open(i) as s, open(os.path.join(rt, os.path.basename(f)), "wb") as d:
                        shutil.copyfileobj(s, d)
    print("runtime:", len(os.listdir(rt)), "files,", round(sum(os.path.getsize(os.path.join(rt, f)) for f in os.listdir(rt)) / 1e6), "MB")


def ocr_models(out):
    md = os.path.join(out, "models")
    os.makedirs(md, exist_ok=True)
    for name, (path, want) in OCR_FILES.items():
        dst = os.path.join(md, name)
        if not (os.path.exists(dst) and sha256(dst) == want):
            fetch(f"https://huggingface.co/{OCR_REPO}/resolve/{OCR_REV}/{path}", dst)
        got = sha256(dst)
        if got != want:
            sys.exit(f"SHA-256 mismatch for {name}: {got}")
    print("ocr models ok")


def detector(out):
    md = os.path.join(out, "models")
    os.makedirs(md, exist_ok=True)
    dst = os.path.join(md, "detector.onnx")
    here = os.path.dirname(os.path.abspath(__file__))
    subprocess.check_call([sys.executable, os.path.join(here, "export_rfdetr.py"), DET_REPO, DET_REV, dst])
    os.replace(dst + ".json", os.path.join(md, "detector.json"))
    print("detector ok:", round(os.path.getsize(dst) / 1e6), "MB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--platform", default="win" if os.name == "nt" else "linux", choices=["win", "linux"])
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "..", "src-tauri", "vision"))
    ap.add_argument("--skip-detector", action="store_true")
    a = ap.parse_args()
    out = os.path.abspath(a.out)
    runtime(a.platform, out)
    ocr_models(out)
    if not a.skip_detector:
        detector(out)
    with open(os.path.join(out, "LICENSES.txt"), "w", encoding="utf-8") as f:
        f.write(LICENSES)
    print("vision pack ready in", out)


if __name__ == "__main__":
    main()
