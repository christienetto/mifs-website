# MIFS website

The product page for [MIFS](https://t.me/MIFSAppBot): send the best few seconds of a song
through iMessage and Telegram.

It's a static site (`index.html`, `styles.css`, `main.js`) with no build step, served by
GitHub Pages from the root of `main`.

## Preview locally

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

## Assets

Everything in `assets/` comes from the MIFS repo:

- `icon-512.png`, `apple-touch-icon.png`, `favicon.png`: the app icon.
- `art/`, `audio/`: the three CC0 demo songs from `server/seed/`, as WebP artwork and
  112 kbps AAC.
- `data/songs.js`: each song's waveform (RMS of 8 kHz mono at 10 points/s, the same
  analysis the app and server use) and synced lyrics, generated from `server/seed/`.
- `og.png`: the link preview image.

The in-page editor plays the songs straight from `assets/audio/`, seeking with HTTP range
requests. On a host without range support it loads the whole file first.
