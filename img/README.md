# Frontend images

The `default.*.png` files are copies of the original frontend images. Each selectable set requires:

- `<prefix>.logo.png`
- `<prefix>.icon-32.png` (32 × 32 favicon)
- `<prefix>.icon-192.png` (192 × 192 app/touch icon)
- `<prefix>.icon-512.png` (512 × 512 app icon)

Keep PNG format and the indicated icon sizes. Prefixes consist of 1–64 ASCII letters, digits, hyphens and underscores, beginning with a letter or digit. Incomplete sets, directories and symbolic links are not offered.

Run `npm run frontend:init` after building the backend, select a set, then restart the server. Configuration is stored in `conf/images.json`; without configuration, `default` is used. See [frontend setup](../frontend/README.md#custom-logo-and-icons) for cache and deployment details.

The header uses the selected set. The “Powered by VideoVault” footer always uses `default.logo.png` via the separate `/videovault-logo.png` path. Retain `default.logo.png` even if you use a different set. Its contents are included in the image version, so changes to the original footer logo also invalidate the app cache.
