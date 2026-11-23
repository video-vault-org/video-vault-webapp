# Install the built VideoVault release

This ZIP contains the compiled backend, built frontend, default images, DynamoDB table definitions and documentation. It contains no configuration, users, instance salt, JWT signing keys, uploaded files or npm dependencies.

1. Install Node.js 26 and npm for your operating system and CPU.
2. Extract the ZIP and open a terminal in the `video-vault` directory.
3. Run `npm ci --omit=dev` to install the runtime dependencies. Native modules are installed for your own system; do not copy node_modules from another CPU or operating system.
4. Run `npm run config:init`, optionally `npm run meta:init` and `npm run frontend:init`, then `npm run admin:init`.
5. Run `npm start`. The default port is 3210; `VIDEO_VAULT_PORT` overrides it. For unattended operation use a service manager.
6. Open http://localhost:3210 locally. For network access put an HTTPS reverse proxy in front of the HTTP backend. The backend does not handle TLS.

The first browser sign-in creates the archive keys. Give the initial admin the editor role in user management to enable uploads.

Keep the `conf`, `jwtkeys`, `storage` (if local storage), `.salt` and SQLite database with the installation. Back them up together. Relative paths in the configuration refer to the working directory from which the app and its CLI commands run. `public` must be writable so startup can prepare branding.

For upgrades, stop the server, back up instance data, replace built code/static files/default images and the two package files, run `npm ci --omit=dev` again and restart. Do not replace configuration or instance data with files from another installation. The application is currently in development and does not provide schema migrations; an update may require recreating the database.

Read the [project README](https://github.com/video-vault-org/video-vault-webapp) for configuration details and `SECURITY-ARCHITECTURE.html` in a browser for the security model. Source build commands in the project documentation apply to a source checkout, not this prebuilt ZIP.
