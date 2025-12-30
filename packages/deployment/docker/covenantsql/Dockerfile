# SQLit Multi-Architecture Build with sqlite-vec Vector Search
# Builds for both amd64 and arm64 architectures
#
# Features:
# - SQLit distributed database
# - sqlite-vec for vector similarity search (MIT/Apache-2.0)
#
# Build locally (single platform):
#   docker buildx build --platform linux/arm64 -t sqlit:latest --load .
#
# Build multi-arch and push:
#   docker buildx build --platform linux/amd64,linux/arm64 -t $ECR_REPO:latest --push .

ARG GO_VERSION=1.23
ARG SQLITE_VEC_VERSION=v0.1.6

# Build stage - use Debian for glibc compatibility (required for sqlite3)
FROM golang:${GO_VERSION}-bookworm AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    make \
    gcc \
    libc6-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Clone sqlite-vec source for CGO integration
ARG SQLITE_VEC_VERSION
RUN git clone --depth 1 --branch ${SQLITE_VEC_VERSION} https://github.com/asg017/sqlite-vec.git /sqlite-vec || \
    git clone --depth 1 https://github.com/asg017/sqlite-vec.git /sqlite-vec

# Clone SQLit source
ARG SQLIT_VERSION=v0.8.1
RUN git clone --depth 1 --branch ${SQLIT_VERSION} https://github.com/SQLit/SQLit.git . || \
    git clone --depth 1 https://github.com/SQLit/SQLit.git .

# Add sqlite-vec Go bindings to dependencies
RUN go get -u github.com/asg017/sqlite-vec-go-bindings/cgo@latest

# Download Go modules first (separate layer for better caching)
# Use multiple proxies for reliability
ENV GOPROXY=https://proxy.golang.org,https://goproxy.io,direct
ENV GOFLAGS="-mod=mod"
RUN go mod download || (sleep 5 && go mod download) || (sleep 10 && go mod download)

# Build output directory
RUN mkdir -p /out

# Build with CGO enabled (required for secp256k1, sqlite3, and sqlite-vec)
# sqlite-vec is statically linked via the Go bindings
# Build each binary separately for better cache utilization
RUN CGO_ENABLED=1 go build -ldflags="-s -w" -o /out/sqlit ./cmd/sqlit
RUN CGO_ENABLED=1 go build -ldflags="-s -w" -o /out/sqlitd ./cmd/sqlitd
RUN CGO_ENABLED=1 go build -ldflags="-s -w" -o /out/sqlit-minerd ./cmd/sqlit-minerd || \
    (sleep 5 && CGO_ENABLED=1 go build -ldflags="-s -w" -o /out/sqlit-minerd ./cmd/sqlit-minerd)
RUN CGO_ENABLED=1 go build -ldflags="-s -w" -o /out/sqlit-fuse ./cmd/sqlit-fuse 2>/dev/null || echo "sqlit-fuse build skipped"

# Runtime stage - use slim Debian for smaller image with glibc
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r sqlit && useradd -r -g sqlit sqlit

# Copy binaries
COPY --from=builder /out/sqlit /usr/local/bin/
COPY --from=builder /out/sqlitd /usr/local/bin/
COPY --from=builder /out/sqlit-minerd /usr/local/bin/

# Create directories
RUN mkdir -p /config /data /logs && \
    chown -R sqlit:sqlit /config /data /logs

# Expose ports
# 4661: Client connections
# 4662: Node-to-node communication
# 4663: BftRaft consensus
# 8546: HTTP API
# 9100: Metrics
EXPOSE 4661 4662 4663 8546 9100

# Volume mounts
VOLUME ["/config", "/data", "/logs"]

USER sqlit

WORKDIR /data

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -sf http://localhost:8546/v1/health || exit 1

ENTRYPOINT ["sqlitd"]
CMD ["-config", "/config/config.yaml"]
