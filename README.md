# Doubles Tennis Tracker — Static PWA (no build step)

This version needs **no Node, no npm, no Vite, no GitHub Actions**. It's
plain static files: open `index.html` in a browser, or upload the whole
folder to any static host (including GitHub Pages set to "Deploy from a
branch") and it just works.

React and the icon library load from a CDN (esm.sh) via an import map in
`index.html` — that's what lets `app.js` stay dependency-free. Tailwind's
CDN build handles the styling utility classes at runtime.

## What's in here

```
index.html       ← entry point, loads app.js + the CDN import map
app.js            ← the whole app, pre-compiled to plain JS (generated — don't hand-edit)
manifest.json     ← PWA manifest (name, icons, colors)
sw.js             ← service worker for offline caching
icons/            ← app icons (192, 512, maskable, favicon, apple touch icon)
src/App.jsx       ← the actual React source, for reference / future edits
src/entry.jsx     ← tiny mount script (createRoot + render)
```

Only `index.html`, `app.js`, `manifest.json`, `sw.js`, and `icons/` are
needed to run the site. `src/` is kept for whenever you want to change the
app — see "Making changes" below.

## Deploy to GitHub Pages (drag-and-drop, no build)

1. Create a repo on github.com (or reuse your existing one).
2. On the repo page, **Add file → Upload files**, and drag in everything
   from this folder (`index.html`, `app.js`, `manifest.json`, `sw.js`,
   the `icons/` folder — `src/` is optional to upload). Commit.
3. Go to **Settings → Pages**. Under "Build and deployment," set
   **Source** to **"Deploy from a branch"**, branch **main**, folder
   **/ (root)**. Save.
4. Wait about a minute, then visit
   `https://<your-username>.github.io/<repo-name>/`.

No Actions workflow, no "queued" builds, no `npm install` — GitHub is
just serving the files as-is, which is exactly what a build-free app
needs.

If you'd previously set Source to "GitHub Actions" for the old version of
this project, switch it back to "Deploy from a branch" as described
above — this version doesn't use a workflow at all.

## Run it locally

Any static file server works, e.g.:

```bash
npx serve .
```

or in Python:

```bash
python3 -m http.server 8080
```

Then open the printed `localhost` URL. (Opening `index.html` directly as
a `file://` URL mostly works too, but service workers and some fetches
are blocked under `file://` by browsers — use a local server if you want
to test offline/install behavior.)

## Making changes

`app.js` is a compiled bundle, not meant to be hand-edited. To change the
app:

1. Edit `src/App.jsx` (or ask Claude to do it for you).
2. Rebuild with esbuild (requires Node, just for this one step):

   ```bash
   npx esbuild src/entry.jsx \
     --bundle --format=esm --jsx=automatic --minify \
     --outfile=app.js \
     --external:react --external:react-dom \
     --external:react-dom/client --external:react/jsx-runtime \
     --external:lucide-react
   ```

3. Re-upload the new `app.js` to your repo (or `git commit` + push if
   using git). No other files change.

## Notes

- Data (in-progress match + match history) persists in the browser's
  `localStorage`, per-browser/per-device, not synced anywhere.
- The service worker caches the app shell on first visit so it works
  offline afterward. If you update `app.js` and don't see the change,
  do a hard refresh (Ctrl/Cmd+Shift+R) or clear the service worker in
  DevTools → Application → Service Workers.
- Install prompt (Android/desktop Chrome/Edge) appears automatically on
  the setup screen when the browser decides the app is installable. On
  iOS, use Safari's Share → Add to Home Screen instead.
