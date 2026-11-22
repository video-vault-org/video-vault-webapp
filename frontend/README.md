# VideoVault frontend

Independent React + TypeScript + Vite project. German and English interfaces, with a service worker for installation, offline app assets, and authenticated decrypted range streaming.

## Install and run

From the repository root:

```sh
npm ci
npm --prefix frontend ci
npm run build
npm start
```

The root build compiles the backend, builds `frontend/dist`, and copies it to `public`. Existing unrelated public files are preserved; generated assets are replaced. No CDN is used for application dependencies, fonts, crypto or MediaInfo's WASM.

For UI development use `npm --prefix frontend run dev` alongside the backend on port 3000. Vite proxies `/api`, `/login` and `/bootstrap`. The service worker is production-only: use the full build/backend for testing playback, downloads and offline reloads. Deploy with HTTPS; localhost is supported for development.

## Tests

```sh
npm --prefix frontend test
npm --prefix frontend run check
# Browser tests use the production build and an isolated backend fixture:
npm run build
cd frontend
npx playwright install chromium
npm run test:browser
```

An installed Chromium can be selected using `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome`. The browser tests use only an in-memory database and a temporary directory. Their deliberately public test credentials are **not** installed in the application's database. Production configuration, `.salt`, storage and JWT keys are untouched. External password lookup is stubbed in tests.

## Storage and security

- JWT, bootstrap, language and the user profile (wrapped keys only) are kept in localStorage. Every reload asks for the password to unlock locally. No plaintext password or unlocked master key is persisted.
- IndexedDB stores raw encrypted video records, a synchronization watermark, and encrypted fetched thumbnails per instance/user. Titles and descriptions are decrypted in memory after HMAC verification. Ordinary metadata and recorded are not encrypted.
- Initial sync uses `/api/video/0`; subsequent sync uses the maximum received `lastModified`. `/api/video/catalog` reconciles deletions. The timestamp protocol is not a transactional change log and assumes correctly increasing client timestamps.
- Filtering and sorting operate locally. Arrays compare lexicographically in stored order using each field's type; missing/empty values sort last. Text compares case-insensitively after NFC normalization, with ID as a deterministic tie breaker.
- Videos are online-only. The worker streams bounded plaintext blocks from the unlocked page, which authenticates full 34-KiB chunks before returning a requested subrange. The page must remain open during playback/download. Clear offline data through the footer.
- Upload encryption builds an encrypted Blob locally before multipart upload. This avoids persistent plaintext copies, but very large uploads can require significant browser memory. File replacement and multiple metadata edits are separate operations; partial changes can remain on failure, as on the backend.
- Invitations and resets use random temporary passwords in base64url JSON fragments `{type, username, password}`. Fragments are scrubbed immediately and the UI requires a password change; that requirement is not server-enforced. Treat copied links as credentials.
- Passwords require 12+ characters and at least three character categories. Pwned Passwords receives only the five-hex SHA-1 prefix with padding; a hit is rejected and an outage yields a warning. SHA-1 is not used for key derivation.
- Argon2id uses `argon2-browser`'s bundled WASM (v19, 19456 KiB, two passes, one lane, 32 bytes), matching the CLI. Web Crypto provides AES-KW, AES-GCM and HMAC-SHA-256. See the root security architecture for the binary format and trust boundaries.
- MediaInfo runs locally. Container, codec, profile, level, bit depth, chroma and audio warnings provide an estimate, not a universal browser-support guarantee. HandBrake recommendations are shown when appropriate.

A changed bootstrap configuration can be loaded using “Reload display settings”; otherwise the existing local bootstrap cache is retained. If the instance salt has deliberately been replaced, clear this origin's site data before signing in.
