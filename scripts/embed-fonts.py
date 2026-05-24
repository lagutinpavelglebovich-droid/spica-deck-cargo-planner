#!/usr/bin/env python3
"""Embed TTF fonts as base64 strings for jsPDF VFS.

Reads TTF files from src/fonts/ and writes src/inter-fonts.js with one
single-line export per font. jsPDF expects giant single-line base64
blobs that can be passed to doc.addFileToVFS / doc.addFont.

Existing Inter Regular + Inter Bold are preserved byte-identical when
the same source TTFs (rsms/inter v4.0 extras/ttf) live in src/fonts/.

To add a new font: drop the TTF into src/fonts/, add an entry to FONTS
below, then run: python3 scripts/embed-fonts.py
"""

import base64
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FONT_DIR = ROOT / "src" / "fonts"
OUT = ROOT / "src" / "inter-fonts.js"

FONTS = [
    ("interRegularB64",         "Inter-Regular.ttf"),
    ("interBoldB64",            "Inter-Bold.ttf"),
    ("manropeExtraBoldB64",     "Manrope-ExtraBold.ttf"),
    ("jetBrainsMonoRegularB64", "JetBrainsMono-Regular.ttf"),
    ("jetBrainsMonoMediumB64",  "JetBrainsMono-Medium.ttf"),
]

HEADER = (
    "/* Auto-generated — TTF font data for jsPDF embedding.\n"
    "   Sources:\n"
    "     - Inter v4.0 (rsms/inter, extras/ttf/) — OFL\n"
    "     - Manrope ExtraBold (fontsource latin slice, weight 800) — OFL\n"
    "     - JetBrains Mono Regular + Medium (JetBrains/JetBrainsMono) — OFL\n"
    "   Do not edit manually. Regenerate with: python3 scripts/embed-fonts.py */\n\n"
)


def encode(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


def main() -> int:
    if not FONT_DIR.is_dir():
        print(f"ERROR: font directory not found: {FONT_DIR}", file=sys.stderr)
        return 1

    missing = [name for _, name in FONTS if not (FONT_DIR / name).is_file()]
    if missing:
        print("ERROR: missing TTF files in src/fonts/:", file=sys.stderr)
        for m in missing:
            print(f"  - {m}", file=sys.stderr)
        return 1

    lines = [HEADER]
    for export_name, filename in FONTS:
        b64 = encode(FONT_DIR / filename)
        lines.append(f"export const {export_name} = '{b64}';\n")

    OUT.write_text("".join(lines))
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size:,} bytes, {len(FONTS)} fonts)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
