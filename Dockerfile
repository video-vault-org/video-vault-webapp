# syntax=docker/dockerfile:1
ARG NODE_VERSION=26

FROM node:${NODE_VERSION}-bookworm AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN --mount=type=cache,target=/root/.npm npm --prefix frontend ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY lib ./lib
COPY frontend ./frontend
COPY scripts/build-frontend.mjs ./scripts/build-frontend.mjs
COPY img/default.* ./img/
COPY SECURITY-ARCHITECTURE.html ./
RUN npm run build

# Native modules are installed for the target CPU and the same Debian/glibc as the runtime.
FROM node:${NODE_VERSION}-bookworm AS dependencies
WORKDIR /dependencies
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --no-fund

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    VIDEO_VAULT_PORT=3210 \
    STATIC_DIRECTORY=/opt/video-vault/public
WORKDIR /opt/video-vault
COPY package.json package-lock.json ./
COPY --from=dependencies /dependencies/node_modules ./node_modules
COPY --from=build /build/built ./built
COPY --from=build --chown=node:node /build/public ./public
COPY img/default.* ./default-images/
COPY docker/entrypoint.sh /usr/local/bin/video-vault
COPY docker/healthcheck.mjs ./docker-healthcheck.mjs
RUN chmod 755 /usr/local/bin/video-vault && mkdir /data && chown node:node /data \
    && node --input-type=module -e "await import('argon2'); await import('node:sqlite');"
USER node
WORKDIR /data
VOLUME ["/data"]
EXPOSE 3210
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "/opt/video-vault/docker-healthcheck.mjs"]
ENTRYPOINT ["/usr/local/bin/video-vault"]
CMD ["start"]
