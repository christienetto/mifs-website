# MIFS website

The product page for MIFS: share the feeling, and quote your favourite artists, by sending the best
few seconds of a song as a bubble that plays right in the chat.

It's a static site (`index.html`, `styles.css`, `main.js`) with no build step, served by
GitHub Pages from the root of `main`.

## Preview locally

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

## Where the music comes from

Nothing in this repo is audio. The page's editor streams each song's 30-second preview and
artwork straight from Apple's iTunes catalog, and fetches synced lyrics from
[LRCLIB](https://lrclib.net) in the browser, the same way the app does.

`assets/data/songs.js` holds, for each song:

- its iTunes track ID, preview and artwork URLs (refreshed from the iTunes Lookup API on load),
- `offset`: where the preview starts in the full song, so LRCLIB's timestamps line up with it,
- `start`: the moment the page opens on,
- `waveform`: the preview's RMS at 10 points/s (8 kHz mono), the same analysis the app runs,
- `lrclib`: the LRCLIB lyrics ID, and `fixes` for lines LRCLIB has wrong.

To change a song, look it up with `https://itunes.apple.com/search?term=…&entity=song`, find
where the preview sits in the song (compare its words with the song's LRCLIB lyrics), and
recompute the waveform from the preview.

## Other assets

- `icon-512.png`, `apple-touch-icon.png`, `favicon.png`: the app icon.
- `og.png`: the link preview image.

## Updates

Release notes live in the `#updates` section of `index.html`, newest first. Add an entry as
a new `<li class="update">` at the top of the timeline and move the `Latest` tag to it.
