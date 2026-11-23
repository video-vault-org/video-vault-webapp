# Docker and releases

## Container layout

The multi-stage image uses Node.js 26 on Debian Bookworm and runs as the unprivileged `node` user (UID/GID 1000). Build tools and development dependencies stay out of the final image. Production dependencies, including native Argon2, are installed for the target CPU. Published images support `linux/amd64` and `linux/arm64`.

The backend serves HTTP on **3210 inside the container**. TLS terminates **outside the application container**, at an existing reverse proxy such as Caddy, nginx or Traefik. There is no HTTPS implementation in the backend and no certificate management in the image.

`compose.yaml` publishes `127.0.0.1:3210` on the host by default. This is suitable for a proxy on the same host and for local browser access. `VIDEO_VAULT_HTTP_PORT=4000` changes the host mapping to `127.0.0.1:4000`; the container port remains 3210. Example for a host-installed Caddy:

```caddyfile
videos.example.com {
    reverse_proxy 127.0.0.1:3210
}
```

Configure the proxy upload limits and timeouts for the combined video/thumbnail size, and allow HTTP Range requests for playback and downloads.

If the proxy is another container, attach it to the same Docker network and forward to `app:3210`. The loopback host port is not reachable as `localhost` from a separate container. You can remove the published port entirely when using only a shared proxy network. Browsers need HTTPS for network access; plain HTTP works on localhost/loopback.

All instance data lives in the `video-vault-data` volume mounted at `/data`: configuration, `.salt`, JWT signing keys, SQLite database, local storage, temporary uploads and custom branding sets under `img/`. Default branding is refreshed from the image at each invocation; custom prefixes are retained. Static application files live separately in `/opt/video-vault/public` and are writable by the application for branding preparation. Do not mount an empty directory over that static path.

Back up the data volume and any external database/S3 data consistently. Do not delete `.salt` or run `docker compose down -v` unless you intend to delete the installation. If you use a host bind mount instead of a named volume, make its directory writable by UID/GID 1000. Keep database and local storage paths relative to `/data`, or explicitly mount any other chosen paths. A database hostname such as `localhost` refers to this container, not the Docker host or a different container.

The image includes an HTTP health check against `/bootstrap`; Compose forwards termination through its init process and allows 60 seconds for graceful shutdown. Logs go to stdout/stderr as JSON when no terminal is attached. The service has no Linux capabilities and cannot acquire new privileges in the provided Compose configuration.

## Build and initialize locally

```sh
npm run docker:build
# Equivalent: docker build -t video-vault:local .

docker compose run --rm app config:init
docker compose run --rm app meta:init      # optional
docker compose run --rm app frontend:init  # optional
docker compose run --rm app admin:init

docker compose up -d --no-build
docker compose logs -f app
```

The `run` commands are interactive and use the same persistent volume as the server. `config:init` defaults to SQLite and local storage, which work directly with this layout. `admin:init` creates the initial account; the first browser sign-in generates and wraps the shared archive keys.

## Run a published image

Set the image explicitly, for example in a local `.env` beside `compose.yaml`:

```dotenv
VIDEO_VAULT_IMAGE=your-namespace/video-vault:1.2.3
VIDEO_VAULT_HTTP_PORT=3210
```

Then pull before initializing a new installation:

```sh
docker compose pull app
docker compose run --rm --no-deps app config:init
docker compose run --rm --no-deps app admin:init
docker compose up -d --no-build
```

For an existing installation, back up first, change the pinned version, run `docker compose pull app` and `docker compose up -d --no-build`. Initialization is not repeated. Custom branding can be copied into `/data/img` and selected with `frontend:init`. This development application has no automatic schema migrations; schema changes may require recreating the database.

To push manually, first create your Docker Hub repository, then authenticate interactively (credentials must never be build arguments):

```sh
docker login
docker buildx build --platform linux/amd64,linux/arm64 \
  -t your-namespace/video-vault:1.2.3 --push .
```

The official GitHub workflow also publishes version labels, build provenance and an SBOM.

## Prepare Docker Hub and GitHub

1. Create a Docker Hub account or organization and a repository, for example `your-namespace/video-vault`. Choose public or private visibility. Users must log in to pull a private image.
2. Create a Docker Hub access token with **Read & Write**, owned by an account allowed to push to that repository. No delete access is needed. Use a token rather than your password.
3. In the GitHub repository, open **Settings → Secrets and variables → Actions → Secrets** and add:
   - `DOCKERHUB_USERNAME`: the Docker Hub login username of the token owner.
   - `DOCKERHUB_TOKEN`: that access token.
4. Under the **Variables** tab, add `DOCKERHUB_IMAGE`, for example `your-namespace/video-vault` (lowercase, without a tag or registry prefix).
5. Enable GitHub Actions and permit the pinned official `actions/*` and `docker/*` actions if your organization restricts actions. The release job requests `contents: write` for the built-in `GITHUB_TOKEN`; repository/organization policies and tag rules must allow it to create `v*` tags, Releases and release assets. No GitHub personal access token is needed.
6. Commit and push the workflow and supporting files to the default branch. Manual workflows appear in Actions once present on that branch.

## Publish a version

In **Actions → Release ZIP and Docker → Run workflow**, select the default branch and enter a version such as `1.2.3` or `1.3.0-rc.1`. A leading `v` is accepted. The workflow:

1. Refuses an existing version tag, installs locked dependencies, runs lint, backend/frontend tests and packaging tests.
2. Builds the complete backend and frontend.
3. Creates `video-vault-v1.2.3.zip` and its `.sha256` checksum, using only built application files, default branding, package manifests, DynamoDB definitions and documentation. The ZIP contains no instance data or `node_modules`; recipients install the production dependencies on their own platform. Installation instructions are included as `INSTALL.md`.
4. Creates the Git tag `v1.2.3` at the exact source commit and a GitHub Release with both files and generated release notes.
5. Calls **Docker release** explicitly to build and push both CPU variants from that same commit. This explicit call is necessary because a Release created by `GITHUB_TOKEN` does not trigger a separate release-event workflow.

A stable image receives `1.2.3` and `v1.2.3`; the image for GitHub's current latest stable Release also receives `latest`. Pre-releases receive their exact version tags and never `latest`. Rebuilding an older Release does not roll back `latest`.

The **Also publish the Docker Hub image** checkbox defaults to `enabled`. Disable it for ZIP-only releases. ZIP publication and Docker publication are separate steps: a Docker failure does not undo an already published ZIP or tag. Fix the credentials/build issue and run **Docker release** manually with the existing `v1.2.3` tag to retry; do not rerun the ZIP workflow with that version.

**Docker release** also runs for GitHub Releases published manually in the UI, provided their tags match the version format. That path publishes the image only; use the combined workflow for ZIP assets and automatic tagging. There are no pushes on ordinary commits or pull requests.

To package a local build without publishing:

```sh
npm ci
npm --prefix frontend ci
npm run build
npm run release:zip -- 1.2.3
```

This needs the `zip` command (and `unzip` for packaging tests); GitHub's Ubuntu runner includes both. Output goes to ignored `release/`. Verify a downloaded ZIP with `sha256sum -c video-vault-v1.2.3.zip.sha256`, extract it and follow `INSTALL.md`. The complete workflows require Docker for the integration tests; GitHub-hosted Ubuntu runners provide it.
