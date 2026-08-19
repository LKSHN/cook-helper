# The Rail

An installable, offline-friendly recipe and MEP (prep-list) reference for a kitchen.

## Live app

https://lkshn.github.io/cook-helper/
https://splendid-hamster-9ce1a2.netlify.app

## Stack

- Plain HTML/CSS/JS — no build step (`index.html`, `app.js`, `style.css`)
- Firebase Firestore + Storage for shared, offline-first data (`db.js`) — recipes and the MEP prep list sync across every device that opens the app
- A service worker (`sw.js`) caches the app shell so it opens with no signal; bump `CACHE_NAME` there whenever the shell files change, so devices actually pick up the update
- `manifest.json` makes it installable ("Add to Home Screen") as a standalone app

## Hosting

Static site, hosted on GitHub Pages, auto-deployed from `master` on every push. No build step, so nothing beyond a push is needed for a change to go live.

## Adding ideas

Drop feature ideas — rough notes are fine — into `IDEAS.md`. Point Claude at one, or say "build the next one," to have it picked up.
