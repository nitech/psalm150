FROM oven/bun:1.3.4-alpine AS web-builder
WORKDIR /source/web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web/ ./
COPY shared/ /source/shared/
RUN bun run build

FROM rust:1.94-bookworm AS api-builder
WORKDIR /source/api
COPY api/ ./
RUN cargo build --locked --release

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=api-builder /source/api/target/release/psa150-server /usr/local/bin/psa150-server
COPY --from=web-builder /source/web/dist /app/web/dist
ENV PSA150_BIND=0.0.0.0:8080
ENV PSA150_WEB_DIST=/app/web/dist
EXPOSE 8080
USER 65532:65532
ENTRYPOINT ["psa150-server"]
