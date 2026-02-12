# TalkCody API Service Dockerfile
# For fly.io deployment

# Use Rust official image
FROM rust:1.75-slim as builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy Cargo files first for better caching
COPY Cargo.toml Cargo.lock ./
COPY src-tauri/Cargo.toml src-tauri/Cargo.lock ./

# Create the src-tauri directory structure
RUN mkdir -p src-tauri/src

# Copy src-tauri source
COPY src-tauri/src src-tauri/src

# Build the API service binary
RUN cargo build --release --bin api_service

# Final stage - minimal runtime image
FROM debian:bookworm-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -s /bin/bash appuser

# Copy binary from builder
COPY --from=builder /app/target/release/api_service /usr/local/bin/api_service

# Set ownership
RUN chown -R appuser:appuser /usr/local/bin

# Switch to non-root user
USER appuser

# Set environment variables with defaults
ENV HOST=0.0.0.0
ENV PORT=8080

# Expose port
EXPOSE 8080

# Run the service
CMD ["api_service"]
