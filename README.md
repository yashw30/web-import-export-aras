# web-import-export-aras

Export and import Aras packages straight from the Aras page you are signed in to, as a userscript. No URL, database or password to type: the environment and the session come from the page.

Press **Ctrl+Shift+P** anywhere in the Aras client (or click the blue tab on the right edge) and a drawer opens on the right.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (or Violentmonkey) in Chrome or Edge.
2. In Tampermonkey: **Create a new script** and paste `scripts/web-import-export-aras.user.js` (a few lines; it has `@noframes`, so it starts only in the top window). It fetches the tool from this repo (`output/compiled.js`) whenever an Aras page opens, so later updates need no reinstall.
3. Reload your Aras tab and press Ctrl+Shift+P.

To publish a new version: `npm run build`, then commit and push `output/compiled.js` (GitHub's raw cache can take a few minutes to update). `dist/web-import-export-aras.user.js` is the same tool as one self-contained script, for use without GitHub.

## What it does

- **Connects by itself** to the Aras tab it is in (server address, database and the session's access token). Each browser tab has its own drawer, so two Aras servers never mix. **Disconnect** clears everything the drawer holds.
- **Export:** tick whole packages, or open a package to pick an item type or single items; filter by name; **All** ticks every package shown. Save to a folder (the picker opens in Downloads the first time and the choice is remembered) or as a zip. Optionally also export the items the selection refers to.
- **Open item:** Ctrl+Shift+P opens the tool when it is closed and closes it when it is open. While the tool is open, each tab you select asks (once the tab has finished loading) whether to add its item to the export: **Add to export** keeps everything ticked before, so opening four tabs and adding each exports those four items together. An item no package holds offers **Add to package…** instead. With the tool closed nothing pops up.
- **Import:** pick the `.mf` manifest (the first time you also allow its folder or a parent of it; later manifests inside it need one click). A zip or a folder works too. Folder names are matched to the manifest's letter case. Tick the packages, optional merge mode, **Import selected packages**.
- **Errors:** an engine failure shows as a card with the actual cause in one line (for example `Property "Instance Data" ... exceeds the maximum length of 30 characters.`), the package and item it happened on, and the full server text one click away. Export and Import each keep their own status, errors and log.

## How it is built

- `src/main.ts`: the entry. Mounts the drawer in a shadow DOM and listens for the shortcut (on the page and on its same-origin frames).
- `src/panel.ts`: the drawer's behaviour. It runs the engine library's browser build in a Web Worker started from a Blob; requests go out from the page with the Aras client's own token.
- `src/page-bridge.ts`: reads from the Aras client: `aras` (database, server address, token), package lists and contents through its IOM, and the item open in the visible tab.
- `src/errors.ts`, `src/import-prep.ts`, `src/export-select.ts`: pure logic, with tests (`npm test`).
- `build.mjs`: esbuild; bundles everything and the engine's Worker into one `.user.js`.
- The engine is [`import-export-libs-js`](https://github.com/omkarbhale/import-export-libs-js), pinned to the same commit as aras-power-search.

## Notes

- Chrome and Edge only (the folder pickers are Chromium-only). In Firefox Ctrl+Shift+P is reserved by the browser; use the blue tab.
- The package list and contents are read with the Aras client's synchronous IOM, which blocks the Aras page for a moment on a very large package list.
- Aras 14 is the target. Aras 12 has not been tried.
- Test the first runs on a dev server.
- `test/mock/Client/index.html` is a stand-in Aras page (a fake `window.aras`) for trying the drawer without a server: `python -m http.server 8765`, then open `/test/mock/Client/index.html`.
