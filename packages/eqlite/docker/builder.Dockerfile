# Stage 1: Build environment
FROM golang:1.23-alpine AS builder

# Install build dependencies (including ICU for sqlite_icu)
RUN apk add --no-cache \
    git \
    make \
    gcc \
    g++ \
    musl-dev \
    sqlite-dev \
    linux-headers \
    ca-certificates \
    icu-dev

# Set Go environment
ENV CGO_ENABLED=1
ENV GOOS=linux
ENV GO111MODULE=on

ARG BUILD_ARG=release

WORKDIR /go/src/eqlite
COPY . .

# Build dynamic binaries (static linking with ICU/C++ is problematic)
RUN make clean && make -j$(nproc) build-release
