# Phase 1 fonts

Local Latin WOFF2 files from the `@fontsource/sora`, `@fontsource/inter`, and
`@fontsource/jetbrains-mono` npm packages, each version 5.3.0. All three font
families are distributed under SIL Open Font License 1.1; their full license
texts are included alongside the files as `sora-OFL.txt`, `inter-OFL.txt`, and
`jetbrains-mono-OFL.txt`.

`build.py` embeds these assets into the generated page. No font CDN requests
are needed. Sora: headings (500/600/700). Inter: interface (400/500/600/700).
JetBrains Mono: addresses, hashes and technical labels (400).

The earlier Schibsted Grotesk assets remain available for compatibility but
are no longer embedded by the dashboard build.
