# yt-dlp UI

A small self-hosted web interface for [yt-dlp](https://github.com/yt-dlp/yt-dlp): paste a link, pick the quality, download, and watch the result in your browser.

- **Login**: a single account set by environment variables, with brute-force lockout (5 failures per 15 minutes per IP)
- **Download parameters**: several links at once, video or audio-only (best quality by default), quality (360p to 4K), container (MP4/MKV/WebM), audio format (MP3/M4A/Opus/FLAC), embedded subtitles, thumbnail and metadata, SponsorBlock removal, plus custom yt-dlp options from a safe allowlist
- **Download history**: live progress, queue (concurrent-download limit), cancel, retry, delete, search, and filters by type (audio/video) and status. Multi-select (Shift+click for ranges) lets you retry, delete, or save several downloads at once as a single .zip, and "Download all" saves everything shown. Thumbnails are stored on the server, so the browser never loads images from the original sites
- **English and French**: detected from the browser, changeable in Settings. Server errors and download errors are translated too
- **Settings**: update yt-dlp in place (stable or nightly) without a new release, check server tools, and see free disk space (also shown in the header, with a warning when it runs low)
- **Error handling**: yt-dlp errors are translated into plain-language messages, and the raw error stays one click away
- **Playback**: the browser's native `<video>`/`<audio>` player, with seeking (HTTP Range)

Stack: a Go backend that runs yt-dlp and stores the history in PostgreSQL, and a Next.js + Tailwind frontend exported as static files and served by nginx.

## Development (Docker)

```sh
docker compose -f docker/docker-compose.yml up -d --build
```

Open http://localhost:3000 and log in as `admin` with the password the backend printed on its first start (`docker compose -f docker/docker-compose.yml logs backend | grep "created the account"`). The Go backend reloads on save (air), and so does the UI (next dev). Downloaded files go to the `ytdlp_data_dev` volume. The history goes to PostgreSQL, reachable from the host at `localhost:5433` (user, password and database are all `ytdlp`).

## Production

```sh
./build.sh                                   # builds eylexander/ytdlp-ui-{backend,frontend}:latest
cp docker/.env.prod.example docker/.env      # set POSTGRES_PASSWORD, SESSION_SECRET
docker compose -f docker/docker-compose.prod.yml up -d
```

On the first start the backend creates the account `admin` with a random password, printed once in its log:

```sh
docker compose -f docker/docker-compose.prod.yml logs ytdlp_backend | grep "created the account"
```

Open http://localhost, log in, and change the username and password in **Settings → Account**. Forgot the password? Delete the account row and restart; a new random password is printed:

```sh
docker compose -f docker/docker-compose.prod.yml exec ytdlp_database psql -U ytdlp -c 'DELETE FROM account'
docker compose -f docker/docker-compose.prod.yml restart ytdlp_backend
```

 YouTube changes often. If downloads start failing with HTTP 403 or extraction errors, open **Settings → Update yt-dlp** (try the nightly channel if stable doesn't help). The updated binary is kept in the `ytdlp_bin` volume. To go back to the version in the image, remove that volume.

## CI/CD

GitHub Actions (`.github/workflows/`):
- **CI** runs on every pull request and every push to a branch other than `master`: Go format/vet/lint, Go tests against a real PostgreSQL, and the frontend typecheck and build.
- **Build & Push Docker Images** runs on pushes to `master`. It runs CI first, then pushes `eylexander/ytdlp-ui-backend` and `eylexander/ytdlp-ui-frontend` (`latest` plus the commit SHA) to Docker Hub, rebuilding only the side that changed. It can also be started by hand from the Actions tab.

Set the `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` repository secrets. Dependabot (`.github/dependabot.yml`) opens grouped update PRs for Go, npm, Docker base images and Actions.

## Configuration (backend)

| Variable | Default | |
|---|---|---|
| `SESSION_SECRET` | random | Signs session cookies. If unset, everyone is logged out on restart |
| `MAX_CONCURRENT` | `2` | Downloads running at the same time; the rest wait in the queue |
| `COOKIE_SECURE` | `false` | Set to `true` when served over HTTPS |
| `TRUST_PROXY` | `false` | Use nginx's `X-Real-IP` for the login lockout (set in the prod compose) |
| `DATABASE_URL` | `postgres://ytdlp:ytdlp@localhost:5433/ytdlp?sslmode=disable` | PostgreSQL holding the download history (the table is created automatically) |
| `DATA_DIR` | `./data` | Where downloaded files live (`downloads/<id>/`) |
| `YTDLP_PATH` | `yt-dlp` | yt-dlp binary |
| `ADDR` | `:8080` | Listen address |

## Development without Docker

Requires Go ≥ 1.24, Node ≥ 20, plus `yt-dlp` and `ffmpeg` on your PATH (and `deno` for full YouTube support). For the database, start only the dev PostgreSQL: `docker compose -f docker/docker-compose.yml up -d database`.

```sh
cd backend && go run ./src/cmd                      # API on :8080
cd frontend && npm install && npm run dev           # UI on :3000, proxies /api to :8080
```
