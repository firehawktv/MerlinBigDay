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
3. Set the environment variables from `.env.example` in the site's Node.js settings. `TEACHER_PASSWORD` is required; the server won't start without it. Create the `DB_PATH` folder first.
4. App start command: `npm start`. Issue the Let's Encrypt certificate under SSL/TLS so students get HTTPS (required for offline mode and installing to the home screen).
5. Open `https://birds.cooney.fun/teacher` and log in.

Back up the `.db` file after the event if you want to keep the data.

## Notes

- The eBird file uses the **highest single count per species**, so a bird seen by several kids isn't double-counted. Species students typed in by hand are left out of it.
- Try the eBird file on eBird's upload page before the event day; their importer is picky about location and date. Set `SITE_LAT` and `SITE_LON` for best results.
- Data stored: optional first name, a random ID, counts, and timestamps. No emails, accounts, or location.
