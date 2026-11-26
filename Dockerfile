ARG NODE_BUILD_IMAGE=node:26-bookworm@sha256:893ea48106e988a5f91e69629d6472600daa9d0494adf7db87eb0b886ce82255
ARG NODE_RUNTIME_IMAGE=node:26-bookworm-slim@sha256:0042e17d232a87a2cd485be1da7900fca4d10a4ad11b29e9285da1d2e54798c9

FROM ${NODE_BUILD_IMAGE} AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts --no-audit --no-fund && npm rebuild argon2 esbuild
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN --mount=type=cache,target=/root/.npm npm --prefix frontend ci --ignore-scripts --no-audit --no-fund && npm --prefix frontend rebuild esbuild
COPY tsconfig.json tsconfig.build.json ./
COPY lib ./lib
COPY frontend ./frontend
COPY scripts/build-frontend.mjs ./scripts/build-frontend.mjs
COPY img/default.* ./img/
RUN npm run build

# Native modules are installed for the target CPU and the same Debian/glibc as the runtime.
FROM ${NODE_BUILD_IMAGE} AS dependencies
WORKDIR /dependencies
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm rebuild argon2

FROM ${NODE_RUNTIME_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    VIDEO_VAULT_PORT=3210 \
    STATIC_DIRECTORY=/opt/video-vault/public
WORKDIR /opt/video-vault
COPY package.json package-lock.json ./
COPY --from=dependencies /dependencies/node_modules ./node_modules
COPY --from=build /build/built ./built
COPY --from=build /build/public ./public
COPY img/default.* ./default-images/
COPY docker/entrypoint.sh /usr/local/bin/video-vault
COPY docker/healthcheck.mjs ./docker-healthcheck.mjs
RUN chmod 755 /usr/local/bin/video-vault && mkdir /data && chown node:node /data \
    && chown node:node public/index.html public/sw.js public/logo.png public/videovault-logo.png public/icon-32.png public/icon-192.png public/icon-512.png \
    && chmod -R a-w public/assets public/.frontend-integrity.json public/.sw.template.js \
    && node --input-type=module -e "await import('argon2'); await import('node:sqlite');"
USER node
WORKDIR /data
VOLUME ["/data"]
EXPOSE 3210
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "/opt/video-vault/docker-healthcheck.mjs"]
ENTRYPOINT ["/usr/local/bin/video-vault"]
CMD ["start"]
