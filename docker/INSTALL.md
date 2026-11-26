# Install the built VideoVault release

This ZIP contains the compiled backend, built frontend, default images, DynamoDB table definitions and documentation. It contains no configuration, users, instance salt, uploaded files or npm dependencies.

1. Install Node.js 26 and npm for your operating system and CPU.
2. Extract the ZIP and open a terminal in the `video-vault` directory.
3. Run `npm ci --omit=dev --ignore-scripts` followed by `npm rebuild argon2` to install the runtime dependencies. Native modules are installed for your own system; do not copy node_modules from another CPU or operating system.
4. Run `npm run config:init`, optionally `npm run meta:init` and `npm run frontend:init`, then `npm run admin:init`.
5. Run `npm start`. The default port is 3210; `VIDEO_VAULT_PORT` overrides it. For unattended operation use a service manager.
6. Open http://localhost:3210 locally. For network access put an HTTPS reverse proxy in front of the HTTP backend. The backend does not handle TLS.

The first browser sign-in creates the archive keys. Give the initial admin the editor role in user management to enable uploads.

Keep the `conf`, `storage` (if local storage), `.salt` and SQLite database with the installation. Back them up together. Relative paths in the configuration refer to the working directory from which the app and its CLI commands run. Only the existing branding output files (`public/index.html`, `public/sw.js`, the logo and icons) need to be writable for startup. Keep `built/`, `node_modules/`, `public/assets/`, `public/.frontend-integrity.json` and `public/.sw.template.js` owned by a separate deployment user and read-only to the server account. Preserve dotfiles when deploying.

For upgrades, stop the server, back up instance data, replace built code/static files/default images and the two package files, run `npm ci --omit=dev --ignore-scripts` followed by `npm rebuild argon2` again and restart. Do not replace configuration or instance data with files from another installation.

Read the [project README](https://github.com/video-vault-org/video-vault-webapp) for configuration details. Source build commands in the project documentation apply to a source checkout, not this prebuilt ZIP.

Authentication uses database-backed sessions with HttpOnly, Secure, SameSite=Strict cookies. Serve the application over HTTPS using an external reverse proxy and configure VIDEO_VAULT_TRUST_PROXY for that proxy; it must overwrite forwarded host/protocol headers so CSRF origin checks see the public HTTPS origin. SESSION_TTL_SECONDS sets the fixed lifetime (default 3600). Local HTTP development outside production mode requires HOST=127.0.0.1 and VIDEO_VAULT_INSECURE_LOCAL_COOKIES=true. For DynamoDB, also create sessions and session-versions from the included table definitions and enable TTL on sessions.ttl. Never apply TTL to session-versions.
