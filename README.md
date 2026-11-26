# VideoVault

![VideoVault logo](./logo.png)

A shared, end-to-end encrypted video archive with a React PWA and a TypeScript backend. Videos, thumbnails, titles, descriptions and comments are encrypted on the client. Accounts share archive keys, protected separately by each account's password.

Read the [security architecture](https://video-vault.de/SECURITY-ARCHITECTURE.html) for the protection model, visible metadata and security limits. The German/English document is maintained separately at `../video-vault-docs/SECURITY-ARCHITECTURE.html` in the shared workspace and is not bundled with the application or its releases.

## Requirements and build

Use Node.js **26** and npm. Run all commands below from the repository root. If you select PostgreSQL, MongoDB, DynamoDB or S3 storage, their services must be available and their credentials configured. Provision any required external databases and S3 buckets separately; `config:init` only writes configuration. DynamoDB table provisioning is described below.

```sh
npm ci --ignore-scripts
npm rebuild argon2 esbuild
npm --prefix frontend ci --ignore-scripts
npm --prefix frontend rebuild esbuild
npm run build
```

The backend is compiled into `built/`. The frontend is built into `frontend/dist/` and copied to `public/`, including the service worker template and offline asset list. The backend serves the frontend; no separate frontend server is needed for normal use.

## Initialize a new installation

Run these after building and before the first server start:

```sh
npm run config:init
npm run meta:init
npm run frontend:init
npm run admin:init
```

| Command         | Purpose                                                                                                                                                                                                                                                                                                             |
|-----------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `config:init`   | Asks for the application title, then database and storage settings. Saves `conf/app.json`, `conf/db.json` and `conf/storage.json`. Defaults: title `VideoVault`, SQLite at `./video-vault.db`, local storage at `./storage`. Existing database/storage settings can be kept; replacing files requires confirmation. |
| `meta:init`     | Configures recording-date display/filtering, metadata fields, filters and sorting. Saves `conf/meta.json`. Optional: without it, there are no extra metadata fields, recording dates omit the time and act as a filter, and videos sort by recording date descending, then title ascending.                         |
| `frontend:init` | Selects a complete logo/icon set from `img/` and saves `conf/images.json`. Optional: without it, the `default` set is used. See [image setup](./img/README.md).                                                                                                                                                     |
| `admin:init`    | Creates the first administrator in the configured database. Asks separately for username, display name and a masked password. Uses the instance salt automatically and refuses to run if an administrator already exists. The browser generates the shared archive keys on the first successful sign-in.            |

The initialization commands create `./.salt` when absent. This public instance salt is part of login derivation; retain it with the installation's data. Passwords require at least twelve characters and three of four character categories: uppercase, lowercase, numbers and special characters. Known breached passwords are rejected; an unavailable breach check produces a warning and allows continuation.

Use a persistent database for an installation. The in-memory database and storage adapters are for testing: data does not survive a process restart, so an administrator created by a separate initialization process will not be retained there.

The first account has the **admin role only**. After signing in, enable its **editor** role in user management to upload/manage videos; assign **moderator** separately if needed. Roles are independent.

### DynamoDB configuration

The table and index definitions are in [dynamodb/create-tables.json](./dynamodb/create-tables.json), using the AWS CLI `create-table` JSON format. The file contains an array of table definitions; pass each object separately when creating tables manually.

Match the `TableName` prefixes to the DynamoDB prefix selected in `config:init` (`conf/db.json` → `conf.tablePrefix`). The JSON uses `video-vault-`; the CLI derives a suggestion from the application title and lets you override it.

The adapter creates missing tables when permitted and accepts matching pre-created tables without requiring `CreateTable`. Definitions and required IAM permissions are also documented in [DynamoDBDatabaseAdapter.ts](./lib/db/adapters/DynamoDBDatabaseAdapter.ts).

## Start

```sh
npm start
```

An interactive start asks for the port. Press **Enter** to use **3210**, then open the application through your HTTPS reverse proxy. Without an interactive terminal, the default is also 3210.

Set `VIDEO_VAULT_PORT` to choose a port without a prompt:

```sh
VIDEO_VAULT_PORT=4000 npm start
```

The variable takes precedence over the prompt; the chosen port is not saved. `HOST` defaults to `0.0.0.0`, and `STATIC_DIRECTORY` defaults to `./public`. Use HTTPS for access over a network; for local HTTP development, explicitly set `HOST=127.0.0.1 VIDEO_VAULT_INSECURE_LOCAL_COOKIES=true` (disabled with `NODE_ENV=production`; never enable this for network access). This is required for browser-independent local HTTP cookies, even though service workers and browser cryptography support HTTP loopback. API documentation is available at `/docs/`.

Keep database, stored files, `conf/` and `.salt` with the installation. Startup writes the configured title into the static HTML, copies the selected images and updates the service worker's branding version, so the static directory must be writable. Restart to apply title or image changes; a frontend rebuild is not required.

The backend serves `/` and `/index.html` with Open Graph metadata: the configured title, the fixed description “Our Videos - Protected” and the selected logo. The absolute logo URL is derived from the request. Behind an HTTPS reverse proxy, set `VIDEO_VAULT_TRUST_PROXY` to its IP address or trusted CIDR range (comma-separated for multiple entries), and configure it to overwrite `X-Forwarded-Host` and `X-Forwarded-Proto` with the original public host and protocol. By default, forwarded headers are trusted only from loopback addresses `127.0.0.1` and `::1`. A non-empty `VIDEO_VAULT_TRUST_PROXY` replaces this default list entirely; an unset or blank value retains the loopback default.

Authentication uses persistent server-side sessions and host-only HttpOnly, Secure, SameSite=Strict cookies. `SESSION_TTL_SECONDS` overrides the fixed one-hour lifetime. GET `/session` returns public expiry metadata and a CSRF token; send that token in `X-CSRF-Token` on every write, including `/login`. POST `/api/logout` revokes this session; POST `/api/logout-everywhere` revokes all your sessions. Deleting a user revokes all their sessions. Every password or username change also invalidates all existing sessions of the changed user, including their current one, and requires signing in again. This applies to both own-account and administrative changes. Offline unlocking remains possible until the cached expiry, and cannot receive revocations while disconnected. Sessions do not expose archive keys.

For DynamoDB, provision the two additional `sessions` and `session-versions` tables using [dynamodb/create-tables.json](./dynamodb/create-tables.json). Enable TTL on the `sessions` attribute `ttl` to reclaim expired records; never expire `session-versions`. Expiry and revocation are checked on every request even before TTL cleanup. The other persistent adapters clean expired session rows when a new session is created. For the default DynamoDB prefix:

```sh
aws dynamodb update-time-to-live --table-name video-vault-sessions --time-to-live-specification Enabled=true,AttributeName=ttl
```

This provisioning command requires `dynamodb:UpdateTimeToLive`. Use your configured table prefix.

Correct proxy host/protocol forwarding is also required for CSRF origin checks on browser writes.

After source changes, rebuild with `npm run build` and restart the server. Stop with Ctrl+C or SIGTERM for a graceful shutdown.

## Docker and downloadable releases

The [Docker and release guide](./docker/README.md) explains the container, persistent data, initialization, HTTPS reverse proxy, Docker Hub/GitHub setup and publishing a version.

```sh
npm run docker:build
docker compose run --rm app config:init
docker compose run --rm app admin:init
docker compose up -d --no-build
```

The container runs without root privileges and serves HTTP on port 3210. Compose exposes it on host loopback only; HTTPS terminates at your external reverse proxy. Instance data is retained in the `/data` volume.

The **Release ZIP and Docker** GitHub workflow builds and tests the app, creates a version tag and GitHub Release with a portable ZIP and SHA-256 checksum, and publishes an AMD64/ARM64 image to Docker Hub. The ZIP includes installation instructions; it requires Node.js 26 and `npm ci --omit=dev --ignore-scripts` followed by `npm rebuild argon2` on the target machine. The separate **Docker release** workflow can retry image publication for an existing tag.

## Development and tests

See [frontend/README.md](./frontend/README.md) for frontend development, offline behavior and browser tests.

```sh
npm run lint
npm test
npm run test:frontend
```

Backend integration tests use Testcontainers and need Docker for the external database/storage adapters.

Build and deployment protections, artifact verification and required GitHub account/repository settings are described in the [build integrity guide](./docker/README.md#build-integrity-and-repository-settings). Use `npm run security:check` and `npm run test:security` alongside the existing checks.
