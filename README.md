# yoinks

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
  <img src="assets/logo-light.svg" alt="yoinks" width="288">
</picture>

yoink any video. paste. yoink. done.

> [!NOTE]
> **Fork personal.** Este repositorio es un fork de
> [**yoinks**](https://github.com/pablostanley/yoinks), creado por
> [Pablo Stanley](https://github.com/pablostanley) y publicado bajo licencia MIT.
> Es una versión modificada para **uso personal**, no oficial y sin relación
> con el autor original ni respaldada por él. Todo el crédito del proyecto
> base es suyo; si buscas la versión oficial, usa la de su repositorio o
> `npm install -g yoinks`.
>
> **Qué agrega este fork**
> - Varios links a la vez: como argumentos, pegados, o desde un `.txt` / `.md`
>   (separados por espacios, comas o saltos de línea, con comentarios `#` y `//`).
> - Lista de revisión antes de descargar: título, sitio, duración, tamaño,
>   links inválidos y repetidos marcados, y `o` para ver la miniatura.
> - Una calidad para todo el lote y descargas una tras otra.
> - Selector nativo de archivos (`^o`) y de carpeta de destino (`^d`).
> - Una carpeta por plataforma: `~/Downloads/yoinks/Instagram`, `…/TikTok`, …
> - Modo música (`^g` o `--music`): mp3 con portada y etiquetas en
>   `~/Music/Artista/`, y álbumes o playlists en `Artista/Álbum/01 Canción.mp3`.
> - Íconos para accesos directos de escritorio (`npm run icons`).

Download videos from YouTube, X/Twitter, Instagram, Threads, TikTok and
1,800+ other sites — right from your terminal. Paste a url, pick a
resolution (or audio-only mp3), done. No popups, no fake download buttons,
no sketchy redirects.

<img src="assets/home.png" alt="yoinks home screen — paste a link and hit yoink" width="100%">

## Install

This fork isn't published to npm (`npm install -g yoinks` gets the original).
Install it from source:

```sh
git clone https://github.com/christian-tong/yoinks.git
cd yoinks
npm ci
npm run build
npm install -g .     # links the global `yoinks` command to this folder
```

Requires Node 18+. Everything else (yt-dlp, ffmpeg) is fetched or bundled
automatically.

## Usage

```sh
$ yoinks https://youtu.be/dQw4w9WgXcQ    # straight to the format picker
$ yoinks <url> <url> …                    # several at once
$ yoinks links.md                        # every link in a .txt / .md / any text file
$ yoinks --music album.md                # music: mp3 with cover art and tags
$ yoinks                                 # prompts for a url — paste one or many
$ yoinks --theme light                   # force the light palette
```

With more than one link you get a review list first: title, site, length,
uploader and rough size for each. `space` picks, `a` toggles all, `o` opens
the thumbnail in your browser to double-check it's the right video. Then
choose one quality for the whole batch and they download one after another.
Links that can't be fetched are marked and skipped; up to 100 per run.

Link files are forgiving: links can be split by spaces, commas or new lines,
`youtube.com/…` without `https://` is fixed for you, and lines starting with
`#` or `//` (or a trailing ` # note`) are comments. Typos like `htps://…` and
repeated videos show up in the review list instead of vanishing.

```md
# road trip
https://youtu.be/abc, https://www.tiktok.com/@a/video/1   # the funny one
// later
instagram.com/reel/xyz
```

On the home screen, `^o` opens your file browser to pick a list (or drag the
file onto the terminal and hit enter), and `^d` picks where downloads go.
Videos are sorted into a folder per site — `~/Downloads/yoinks/Instagram`,
`…/TikTok`, `…/YouTube` — so they never mix.

**Music mode** (`^g` on the home screen, or `--music`) saves mp3s with the
cover art (cropped square) and artist / title / album tags filled in, into
`~/Music/<artist>/<song>.mp3`. Album and playlist links expand into their
songs and land in `~/Music/<artist>/<album>/01 <song>.mp3`. After a batch,
`o` opens the folder.

yoinks takes over the terminal (full-screen, centered — and restores your
scrollback on exit). Pick a format with ↑/↓ (or j/k, or number keys) and
hit enter. `esc` goes back, `^c` quits. Or just use the mouse — the yoink
button, the format list and the footer hints are all clickable, and
clicking the logo takes you back home. The saved file paths are printed to
your terminal when you're done.

The default `auto` theme uses your terminal's own foreground and background,
so it follows light and dark terminal themes without guessing. Press `^t` or
click the theme control in the footer to cycle through `auto`, `light`, and
`dark` for the current session. Use `--theme auto`, `--theme light`, or
`--theme dark` to choose the starting theme for one launch.

<img src="assets/download-options.png" alt="yoinks format picker — resolutions with estimated file sizes, plus audio-only mp3" width="100%">

## How it works

- Powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp). On first run,
  yoinks downloads the standalone yt-dlp binary to `~/.yoinks/bin` —
  no Python required. If you already have yt-dlp installed, it uses yours.
- ffmpeg (needed for merging high-res streams and mp3 extraction) is found
  on your PATH, with `ffmpeg-static` as a bundled fallback.
- The UI is [Ink](https://github.com/vadimdemedes/ink) — React for the
  terminal.

## Development

```sh
npm install
npm run build        # bundle to dist/ with tsup
npm run dev          # rebuild on change
node dist/cli.js <url>
npm run typecheck
```

To try it as a global command without publishing: `npm link`, then run
`yoinks` anywhere.

## Roadmap

- [ ] `--best` / `--mp3` flags to skip the picker (scriptable mode)
- [ ] `-o <dir>` to choose the output folder
- [ ] Playlist / thread-with-multiple-videos support
- [ ] Clipboard detection: launch bare and auto-suggest the url you copied
- [ ] Self-update for the bundled yt-dlp binary (`yt-dlp -U`)
- [x] Publish to npm (`npm i -g yoinks` / `npx yoinks`)
- [ ] `curl yoinks.sh | sh` installer

## A note on fair use

yoinks is a personal-archiving tool. Downloading content may violate a
platform's terms of service — only download what you have the right to
keep, and be excellent to creators.

## License

[MIT](LICENSE) — the original copyright notice of Pablo Stanley is kept, as
the license requires; the modifications in this fork are released under the
same MIT terms.

Third-party software used at runtime keeps its own license:

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — Unlicense (downloaded on first
  run, not included in this repo)
- [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) — GPL-3.0-or-later
  (installed by npm, not included in this repo); the FFmpeg binaries it
  provides are under their own GPL/LGPL terms
- [Ink](https://github.com/vadimdemedes/ink), ink-select-input, ink-spinner,
  [React](https://github.com/facebook/react) — MIT
