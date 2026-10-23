# Submission checklist
- [ ] Public repo with an **anonymous name** (e.g. `wind-day-ahead-desk`) – no real name/employer in repo name, commits, README, or git author (`git config user.name/email` set to an anonymous identity *before* committing).
- [ ] README: live URL and video link filled in; AI-tools disclosure present.
- [ ] Deployed app URL works (Decision and Accuracy views load, no API errors).
- [ ] YouTube video uploaded as **Unlisted**, ≤ 10 min, Part 1 ≤ 5 min and Part 2 ≤ 5 min; no personal info visible on screen (browser bookmarks, email, usernames).
- [ ] `cd backend && pytest` passes (60 tests); `docker compose up --build` works from a clean clone; `scripts/smoke.sh <live URL>` passes.
- [ ] **Open every link (repo, live app, video) in an incognito window** and confirm they work while logged out.
- [ ] Run `scripts/smoke.sh https://<deployment>` – it must print `ALL OK` (checks the API routes, not just the homepage).
- [ ] `git log --format='%an %ae'` shows only the anonymous identity; `git config user.name/email` set *before* the first commit.
