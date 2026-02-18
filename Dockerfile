# TalkCody API Service - Optimized Dockerfile
# Build time reduced from 4-5min to ~30s for code-only changes
# Usage: DOCKER_BUILDKIT=1 docker build -f Dockerfile.optimized .

# =============================================================================
# Stage 1: Planner - Analyze dependencies
# =============================================================================
FROM rust:1-slim AS planner
WORKDIR /app

# Install cargo-chef for dependency caching
RUN cargo install cargo-chef --locked

# Copy Cargo files for planning
COPY src-tauri/Cargo.toml ./src-tauri/Cargo.toml
COPY src-tauri/build.rs ./src-tauri/build.rs
COPY src-tauri/tauri.conf.json ./src-tauri/tauri.conf.json
COPY packages/shared/src/data/models-config.json ./packages/shared/src/data/models-config.json
COPY src/services/codex-instructions.md ./src/services/codex-instructions.md

WORKDIR /app/src-tauri
RUN cargo chef prepare --recipe-path recipe.json

# =============================================================================
# Stage 2: Dependency Cache - Build only dependencies (cached layer)
# =============================================================================
FROM rust:1-slim AS cacher
WORKDIR /app

# Install cargo-chef
RUN cargo install cargo-chef --locked

# Install build dependencies (without cache mount to avoid lock conflicts in parallel builds)
RUN apt-get update && apt-get install -y \
    pkg-config libssl-dev libsqlite3-dev libglib2.0-dev \
    libgtk-3-dev libwebkit2gtk-4.1-dev cmake clang protobuf-compiler && \
    rm -rf /var/lib/apt/lists/*

# Copy recipe and build dependencies only
COPY --from=planner /app/src-tauri/recipe.json ./src-tauri/recipe.json
WORKDIR /app/src-tauri

# Build dependencies - this layer is cached when only source code changes
# Use release profile but with faster build settings for dependencies
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/app/src-tauri/target \
    cargo chef cook --release --recipe-path recipe.json --bin api_service

# =============================================================================
# Stage 3: Builder - Build the actual application
# =============================================================================
FROM rust:1-slim AS builder
WORKDIR /app

# Install build dependencies (without cache mount to avoid lock conflicts in parallel builds)
RUN apt-get update && apt-get install -y \
    pkg-config libssl-dev libsqlite3-dev libglib2.0-dev \
    libgtk-3-dev libwebkit2gtk-4.1-dev cmake clang protobuf-compiler && \
    rm -rf /var/lib/apt/lists/*

# Copy pre-built dependencies from cacher stage
COPY --from=cacher /app/src-tauri/target ./src-tauri/target
COPY --from=cacher /usr/local/cargo /usr/local/cargo

# Copy all source files
COPY src-tauri/Cargo.toml ./src-tauri/Cargo.toml
COPY src-tauri/build.rs ./src-tauri/build.rs
COPY src-tauri/tauri.conf.json ./src-tauri/tauri.conf.json
COPY src-tauri/tauri.conf.dev.json ./src-tauri/tauri.conf.dev.json
COPY src-tauri/capabilities ./src-tauri/capabilities
COPY src-tauri/icons ./src-tauri/icons
COPY src-tauri/src ./src-tauri/src
COPY packages/shared/src/data/models-config.json ./packages/shared/src/data/models-config.json
COPY src/services/codex-instructions.md ./src/services/codex-instructions.md

# Build the application - only recompiles changed source files
WORKDIR /app/src-tauri
ENV CARGO_NET_GIT_FETCH_WITH_CLI=true
ENV CARGO_BUILD_JOBS=4

RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/app/src-tauri/target,id=talkcody_target \
    cargo build --release --bin api_service && \
    # Copy binary to a known location outside cache
    cp target/release/api_service /tmp/api_service

# =============================================================================
# Stage 4: Runtime - Minimal production image
# =============================================================================
FROM debian:testing-slim AS runtime

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates libssl3 libsqlite3-0 libglib2.0-0 \
    libgtk-3-0 libwebkit2gtk-4.1-0 && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -s /bin/bash appuser && \
    mkdir -p /data/talkcody /data/workspace && \
    chown -R appuser:appuser /data

# Copy binary from builder (outside cache mount)
COPY --from=builder /tmp/api_service /usr/local/bin/api_service
RUN chown appuser:appuser /usr/local/bin/api_service

USER appuser

ENV HOST=0.0.0.0
ENV PORT=8080
ENV DATA_ROOT=/data/talkcody
ENV WORKSPACE_ROOT=/data/workspace

EXPOSE 8080

CMD ["api_service"]
