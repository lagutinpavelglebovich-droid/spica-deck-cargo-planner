# Native vision pack

Filled by `tools/vision/fetch-vision.py` (CI does it before every Windows build):

- `runtime/` — ONNX Runtime 1.24.1 with the OpenVINO execution provider, OpenVINO 2025.4.1, MSVC runtime
- `models/` — PP-OCRv5 text detection + English recognition, RF-DETR small detector
- `LICENSES.txt` — third-party licences

Not committed (large binaries). Without it the app falls back to the built-in WASM reader.
