# SQLit Release Builder
# Base image for building static Go binaries with musl libc
FROM golang:1.23-alpine

# Install build dependencies
RUN apk add --no-cache \
    git \
    make \
    gcc \
    musl-dev \
    sqlite-dev \
    linux-headers \
    ca-certificates

# Set Go environment for static builds
ENV CGO_ENABLED=1
ENV GOOS=linux
ENV GOARCH=amd64
ENV GO111MODULE=on

# Create working directory
WORKDIR /go/src/sqlit

# Pre-cache common Go modules
RUN go install golang.org/x/tools/cmd/goimports@latest

