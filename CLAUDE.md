# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
# Dev stack in Docker (hot reload: air for Go, next dev for the UI)
docker compose -f docker/docker-compose.yml up -d --build   # UI http://localhost:3000 (first login: grep "created the account" in the backend log), API :8080, PostgreSQL host port 5433
docker compose -f docker/docker-compose.yml logs -f backend
docker compose -f docker/docker-compose.yml down

# Images (same flags as the portfolio repo: -dev -frontend -backend -nc -push)
./build.sh
docker compose -f docker/docker-compose.prod.yml up -d      # needs POSTGRES_PASSWORD in docker/.env (see .env.prod.example)

# Backend without Docker, from backend/ (needs yt-dlp + ffmpeg on PATH, or YTDLP_PATH).
# DATABASE_URL defaults to the dev compose Postgres on localhost:5433: `docker compose -f ../docker/docker-compose.yml up -d database`
go run ./src/cmd
go test ./...                                    # all tests live in backend/test/; TestRoundTrip skips without a DB
TEST_DATABASE_URL=postgres://ytdlp:ytdlp@localhost:5433/ytdlp?sslmode=disable go test ./test
go test ./test -run TestBuildArgs                # single test
go vet ./... && gofmt -l .
go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.14.0 run ./...   # same version as CI; config in backend/.golangci.yml

# Frontend without Docker, from frontend/
npm run dev        # :3000, proxies /api/* to API_URL (default http://localhost:8080)
npm run build      # static export to frontend/out/ (also type-checks)
npm run typecheck
npm run check:i18n # en-US/fr-FR have the same keys and {placeholders}
```

There is no frontend linter besides `tsc`, and no frontend tests.

**CI/CD (`.github/`, same setup as the author's BlurayManager repo):**
- `ci.yml` runs on PRs and on pushes to branches other than `master`: gofmt, vet, `go test -race` against a PostgreSQL service container (so the datastore test runs), golangci-lint, then frontend typecheck and build.
- `docker-publish.yml` runs on pushes to `master`. It calls `ci.yml` first, then builds and pushes `eylexander/ytdlp-ui-{backend,frontend}:latest` and `:<sha>` to Docker Hub, only for the side whose files changed (`dorny/paths-filter`). It needs the `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` repo secrets.
- Keep the golangci-lint version in sync between CI and the command above. `.golangci.yml` deliberately excludes ST1005: error strings are user-facing sentences.

Both compose files set an explicit `name:`. Keep it: the default project name would be the folder name `docker`, which collides with the author's other repos that use the same layout. Compose would then replace their `frontend`/`backend` containers.

## Layout

The layout mirrors github.com/Eylexander/portfolio: `backend/src/{cmd,api,controller,datastore,models,server}`, tests in `backend/test/` (package `test`, exported API only), `backend/.air.toml`, `frontend/src/{app,components,hooks,lib,providers,types}`, and `docker/` holding `{backend,frontend}{,.dev}.Dockerfile`, a dev `docker-compose.yml`, a `docker-compose.prod.yml`, and `nginx.conf`. Each Dockerfile's build context is its own folder (`./backend` or `./frontend`).

## Architecture

There is no Node at runtime. `next build` emits a static site (`output: "export"`). In prod, the frontend image is nginx serving that export. `docker/nginx.conf` is mounted by the prod compose and proxies `/api` to `ytdlp_backend:8080` with buffering off, so videos stream and seek. The Go backend is API-only. In dev, `next.config.js` switches by build phase: rewrites to `API_URL` under `next dev`, static export otherwise. Either way the browser sees one origin, so the session cookie needs no CORS.

**Backend (`backend/src/`, module `eylexander/ytdlp-ui/backend`)**
- `cmd/main.go`: reads the env config into `models.Config` and handles SIGINT/SIGTERM.
- `server/`: `server.Run` registers the routes (Go 1.22 `METHOD /path/{id}` mux patterns) and calls `ctrl.Shutdown()` on exit.
- `api/`: thin HTTP handlers, plus the `RequireAuth` middleware. Errors go out as `{"error": "..."}` and the UI shows that message verbatim, so write it for end users.
- `controller/`: all logic.
  - `controller.go`: the job manager.
  - `ytdlp.go`: `BuildArgs`, plus `ClassifyError`, which maps yt-dlp stderr to friendly messages through the `friendlyErrors` table (first match wins, so order matters).
  - `ytdlp.go` also holds `UpdateYtDlp`: `yt-dlp --update-to stable|nightly`, refused while downloads run. `YtDlpVersion` is cached because the one-file binary takes ~2s per run, and an update clears the cache.
  - `thumbnails.go`: copies each job's remote thumbnail to `DATA_DIR/thumbnails/<id>`, prefetched when metadata arrives and fetched on first request for older jobs. Served with immutable cache headers, so the browser never contacts the original site's image servers.
  - `auth.go`: a single account in the `account` table (one row, PBKDF2 hash from stdlib `crypto/pbkdf2`). The first start creates `admin` with a random password printed once to the log (`rand.Text()`); the login is then changed in Settings (`PUT /api/account`, needs the current password). Sessions are stateless HMAC tokens in a cookie. The signature covers the password hash and the token's username must match, so changing either logs out every other session. There is also a per-IP login lockout. `TRUST_PROXY=true` makes it key on `X-Real-IP`; that variable is set only in the prod compose, where the backend is reachable only through nginx.
- `datastore/`: portfolio layout: `datastore.go` is the `DataStore` interface, `datastore_postgres.go` the pgx connection and schema, `datastore_postgres_<entity>.go` the queries. pgx is the only non-stdlib dependency. Tests build a `Controller` on a no-op `DataStore`. There is one `downloads` table, created with `CREATE TABLE IF NOT EXISTS` on startup (no migration tool). `options` is JSONB, so a new download option needs no schema change. Speed and ETA are never stored.
- `models/`: `Job`, `Options` (with `Normalize()` doing **allowlist validation**), `Config`, and `args.go` (the custom options allowlist).

**Storage model:** the controller keeps every job in memory and serves `GET /api/downloads` and live progress from there. PostgreSQL is the durable copy. It is loaded once at startup and upserted one row at a time on state changes (`saveLocked`, under the controller mutex so writes for a job stay ordered), but not on progress ticks. Each job's files live in `DATA_DIR/downloads/<jobID>/`, so deleting a job means removing the row first, then `RemoveAll` on that folder.

**How yt-dlp output is parsed:** yt-dlp is told to print prefixed lines on stdout (`__INFO__` metadata JSON before download, `__PROG__` progress JSON, `__FILE__` final path after move). `handleLine` dispatches on those prefixes. Postprocessor progress goes to **stderr**, so a `__PROG__` line with `status: "finished"` is what flips a job to `processing`. Stderr is buffered only to build the error message. Keep `--` before the URL so user input can never be parsed as a flag.

**Job lifecycle:** `queued` → `running` ⇄ `processing` → `done` | `failed` | `canceled`. `MAX_CONCURRENT` is enforced by the `sem` channel. yt-dlp runs in its own process group so cancel also kills its ffmpeg children (Unix-only `syscall` usage). On shutdown, which includes air restarts (`send_interrupt = true`), `closing` leaves running jobs "active" on disk. The next start turns any active job into `failed` ("Interrupted by a server restart") and deletes its folder. Retry (`retryJob` in `lib/api-client.ts`) is a new `POST /api/downloads` with the old url and options, followed by deleting the old entry, so retries don't pile up duplicates.

**Frontend (`frontend/src/`)**
- `app/(app)/layout.tsx` is the authenticated shell: auth guard through `/api/me`, nav, theme toggle, and a banner when `/api/health` reports yt-dlp or ffmpeg missing. `app/login/` sits outside that group.
- `lib/api-client.ts`: `api()` fetch wrapper. It throws `ApiError` with the server's message and redirects to `/login/` on 401.
- `hooks/useJobs.ts` polls `/api/downloads` every 1s while anything is active and every 15s otherwise (there is no SSE or WebSocket).
- `types/download.ts` mirrors `models.Job`/`models.Options`, and also has `Health` (`/api/health`: tool versions, disk free/total from `statfs` on `DATA_DIR`, allowed custom options).
- The download form accepts several links (whitespace/newline separated) and sends one `POST /api/downloads` per link from the client. There is no batch endpoint. Links that fail stay in the box.
- `components/JobCard.tsx` renders one job everywhere and holds the `<dialog>` player, which uses the browser's native `<video>`/`<audio>` controls on `/api/downloads/{id}/file`. Go's `http.ServeFile` handles Range requests.

**Self-updating yt-dlp:** both images install the standalone binary at `/opt/yt-dlp/yt-dlp` (`YTDLP_PATH`), owned by the app user so `--update-to` can replace it. The prod compose keeps `/opt/yt-dlp` on the `ytdlp_bin` volume, so an update survives container recreation. The catch: a newer image won't replace the binary until that volume is removed. Self-update doesn't work for pip installs, and yt-dlp's error is shown to the user.

**Bulk actions (History):** multi-select applies only to visible (filtered) cards. Delete and retry loop over the single-item endpoints from the client. "Download" is a plain link for one file (`/api/downloads/{id}/file?download=1`). For several it opens a menu: one zip (`GET /api/downloads/archive?ids=a,b,c`, which streams an uncompressed zip via `controller.WriteZip`, with deduplicated names) or separate files (client-side anchor clicks spaced 500ms apart; Chrome asks once to allow multiple downloads).

**Audio conversion:** "Convert" on a finished job (`components/ConvertButton.tsx`) is a normal `POST /api/downloads` whose options carry `convertFrom: <jobID>`, `audioFormat` and `audioBitrate`. `run()` then starts ffmpeg (`controller/convert.go`: `ConvertArgs`, with progress parsed from `-progress pipe:1`) on that job's file instead of yt-dlp. The new job copies the source's title, thumbnail (hard link) and duration. It goes through the same lifecycle, queue and cancel, and retry works unchanged. The source job is left untouched.

**Dev-stack caveat:** air restarts the backend on every Go save, and a restart turns all queued or running downloads into "Interrupted by a server restart" failures. The dev stack is also used for real downloads, so when testing against it, create and act on your own test jobs only. Never use select-all or other bulk actions over existing history.

**Locales (en-US, fr-FR):** configured like the author's portfolio repo: `src/i18n.ts` (locale list, `locale` cookie, then browser language), `messages/<locale>.json` with PascalCase namespaces, next-intl. The site is a static export, so detection runs in the browser: `providers/IntlProvider.tsx` renders nothing until the locale is known, to avoid a flash of English.
- The language is chosen in Settings (Language section). The `LocaleSwitcher` pill only appears on the login page.
- `t()` keys are type-checked against `en-US.json` (the `AppConfig` augmentation in `i18n.ts`), and `npm run check:i18n` (also in CI) keeps `fr-FR.json` in sync. Add every new string to both files.
- **Server messages are codes:** API errors send `{"error": English, "code", "params"}` (`models.UserError` → `api.writeErr`), and `api()` translates `ApiErrors.<code>`. Failed jobs store a code in `Job.Error` (`ClassifyError` → `JobErrors.<code>`). `translateCode()` falls back to the English text for unknown codes and for old rows that stored sentences. A new user-facing backend error needs a `models.UserErr("code", …)` **and** a key in both message files.
- Sizes go through `formatBytes` (Intl units: "48,8 Go" in French), and dates through `toLocaleString(locale)`.

**Static-export constraints:** there are no dynamic route segments (`[id]`), no server actions and no route handlers. Use query params or modals instead. `trailingSlash: true`, so internal links look like `/history/`.

## Adding a download option

The option has to pass through all of these, or the backend will reject or ignore it:
1. Add the field to `Options` in `backend/src/models/download.go`, with a default plus an allowlist or regex check in `Normalize()`.
2. Map it to flags in `BuildArgs()` (`backend/src/controller/ytdlp.go`) and extend `TestBuildArgs`.
3. Add the field to `Options` in `frontend/src/types/download.ts` and to `DEFAULTS` and the form in `app/(app)/page.tsx`. The form saves options to localStorage and merges them over `DEFAULTS`.

Simpler alternative: users can already pass most yt-dlp options through **custom options** (`Options.CustomArgs`). `models/args.go` splits the string shell-style and checks every flag against `allowedArgs` (flag → takes a value?). It must stay an **allowlist**. A blocklist can't keep up with options that run commands (`--exec`, `--netrc-cmd`), load code (`--plugin-dirs`), redefine options (`--alias`) or touch server paths (`-o`, `--cookies`, `--config-locations`). `BuildArgs` appends the custom tokens after the built-in ones (yt-dlp: last one wins) and before `--`.

## Design

The styling copies the design tokens from the author's other projects (eylexander.fr portfolio and BlurayManager): HSL CSS variables in `globals.css` (warm paper light theme, obsidian dark `.dark` theme, purple primary), exposed as Tailwind colors in `tailwind.config.ts`. Use the semantic classes (`bg-card`, `text-muted-foreground`, `border-border`, `text-primary`, `bg-success/10`…) and the component classes `.card`, `.input`, `.label`, `.btn` + `.btn-primary`/`.btn-secondary`/`.btn-ghost`, `.btn-icon` rather than raw palette colors. Icons come from `lucide-react` and toasts from `react-hot-toast`.
