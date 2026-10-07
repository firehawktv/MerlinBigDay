# Class Bird Count

Independent classroom tool for counting birds on October Big Day. Not affiliated with Cornell Lab of Ornithology, eBird, or Merlin.

- `/` students count birds. First name is optional; otherwise they get an anonymous "Birder #1234". Works offline and syncs later.
- `/teacher` is password-protected: by bird, by student, class totals (combined and highest-count), CSV and eBird-format exports, and an "accepting new counts" switch.

Node 20+, one SQLite file on disk, no build step.

## Run locally

    npm install
    TEACHER_PASSWORD=something-long npm start     # http://127.0.0.1:3000
    npm test

## Deploy on CloudPanel (Ubuntu)

1. Add Site > Create a Node.js Site: domain `birds.cooney.fun`, Node 22 (20+ works), app port `3000`.
2. SSH in as the site user, clone this repo into the site root, then `npm ci --omit=dev`.
3. `cp .env.example .env`, then edit `.env` (or set the same variables in CloudPanel's Node.js settings). `TEACHER_PASSWORD` is required, 8+ characters; the server won't start without it. Create the `DB_PATH` folder first. Restart the app after any change; no `npm ci` needed.
4. App start command: `npm start`. Issue the Let's Encrypt certificate under SSL/TLS so students get HTTPS (required for offline mode and installing to the home screen).
5. Open `https://birds.cooney.fun/teacher` and log in.

Back up the `.db` file after the event if you want to keep the data.

## Notes

- The eBird file uses the **highest single count per species**, so a bird seen by several kids isn't double-counted. Species students typed in by hand are left out of it.
- Try the eBird file on eBird's upload page before the event day; their importer is picky about location and date. Set `SITE_LAT` and `SITE_LON` for best results.
- Data stored: optional first name, a random ID, counts, and timestamps. No emails, accounts, or location.

## Bird photos

Each bird shows a thumbnail; tapping it opens a full-screen viewer (pinch or scroll-wheel to zoom, drag to pan, tap / swipe / X / Esc / back button to close). Birds without a photo show a 🐦 placeholder, so the app works with or without photos.

Photos come from [Wikimedia Commons](https://commons.wikimedia.org), the lead image of each bird's Wikipedia article. They are downloaded once and **served from this site**, so students' devices never contact a third party. Only Public Domain, CC0, CC BY and CC BY-SA images are kept. Several require crediting the photographer, so the viewer shows the credit and a link to the source.

    node scripts/fetch-photos.mjs                  # fetch any species still missing a photo
    node scripts/fetch-photos.mjs --only "Blue Jay"  # redo one
    node scripts/fetch-photos.mjs --force          # redo all

Commons serves a few images as huge lossless PNGs; `python3 scripts/optimize-photos.py` (needs Pillow) converts them to JPEG. Behind a proxy, run Node with `NODE_USE_ENV_PROXY=1`.

Run it on a machine that can reach wikipedia.org and commons.wikimedia.org, check the result, and commit `public/photos/`. The script lists any species it couldn't match. To pick a different picture for a bird (for example if the lead image is a female or a flight shot), add `"Blue Jay": "File:Exact_Commons_filename.jpg"` to `scripts/photo-overrides.json` and rerun with `--only`.
