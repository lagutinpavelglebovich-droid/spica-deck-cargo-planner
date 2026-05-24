# PDF fonts (TTF sources)

This directory holds the TTF source files used by `scripts/embed-fonts.py`
to regenerate `src/inter-fonts.js` (the base64-embedded font bundle for
jsPDF VFS).

These TTF files are gitignored — only the generated base64 artifact is
committed. To regenerate from a fresh clone, download the sources below
into this directory and run:

    python3 scripts/embed-fonts.py

## Sources (all OFL-licensed)

- Inter-Regular.ttf, Inter-Bold.ttf
  https://github.com/rsms/inter/tree/master/docs/font-files
  (or any rsms/inter v4.0 release)

- Manrope-ExtraBold.ttf (weight 800, latin subset is fine)
  https://fontsource.org/fonts/manrope (download weight 800)
  or https://github.com/sharanda/manrope

- JetBrainsMono-Regular.ttf, JetBrainsMono-Medium.ttf
  https://github.com/JetBrains/JetBrainsMono/tree/master/fonts/ttf
