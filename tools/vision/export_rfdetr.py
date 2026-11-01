#!/usr/bin/env python3
"""
Export the official Roboflow RF-DETR detector (Apache-2.0) to ONNX.
usage: python export_rfdetr.py Roboflow/rf-detr-small <revision> out.onnx
Writes out.onnx and out.onnx.json ({res, id2label}). Checks the ONNX output
against PyTorch on a random input.
"""
import sys, json
import numpy as np
import torch
import torch.nn.functional as F
from transformers import RfDetrForObjectDetection

_interp = F.interpolate
def _interp_noaa(*a, **k):
    # the input size is fixed, so the position-embedding resize is a constant;
    # bicubic with antialias has no ONNX export
    k['antialias'] = False
    return _interp(*a, **k)

repo, rev, out = sys.argv[1], sys.argv[2], sys.argv[3]
m = RfDetrForObjectDetection.from_pretrained(repo, revision=rev).eval()
res = m.config.backbone_config.image_size


class Wrap(torch.nn.Module):
    def __init__(s, m):
        super().__init__()
        s.m = m

    def forward(s, x):
        o = s.m(pixel_values=x)
        return o.logits, o.pred_boxes


x = torch.randn(1, 3, res, res)
F.interpolate = _interp_noaa
with torch.no_grad():
    torch.onnx.export(Wrap(m).eval(), (x,), out, input_names=['images'], output_names=['logits', 'boxes'], opset_version=17, dynamo=False)
F.interpolate = _interp
json.dump({'res': res, 'id2label': m.config.id2label, 'source': f'{repo}@{rev}'}, open(out + '.json', 'w'))

import onnxruntime as ort
m.eval()
# a smooth test picture (noise makes the top-k query order arbitrary): compare
# the strongest detections, not query-by-query
yy, xx = np.mgrid[0:res, 0:res] / res
img = np.stack([np.sin(xx * 9) * 0.5 + 0.5, np.cos(yy * 7) * 0.5 + 0.5, (xx * yy) ** 0.5])
img[:, res // 3:res // 2, res // 4:res // 2] = 0.9
t = torch.from_numpy(((img - np.array([0.485, 0.456, 0.406])[:, None, None]) / np.array([0.229, 0.224, 0.225])[:, None, None])[None].astype(np.float32))
with torch.no_grad():
    ref = m(pixel_values=t)
lo, bo = ort.InferenceSession(out, providers=['CPUExecutionProvider']).run(None, {'images': t.numpy()})
top = lambda l: np.sort((1 / (1 + np.exp(-l[0]))).max(-1))[::-1][:20]
d = float(np.abs(top(lo) - top(ref.logits.numpy())).max())
print('exported', out, 'res', res, 'top-20 score diff vs torch', d)
if d > 0.02:
    sys.exit('ONNX output differs from PyTorch')
