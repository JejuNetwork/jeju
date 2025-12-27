# Stage: runtime
# Use Alpine 3.22 to match golang:1.23-alpine ICU version
FROM alpine:3.22

ARG COMMIT
ARG VERSION

LABEL \
    name="eqlite" \
    homepage="https://github.com/jejunetwork/jeju.git" \
    maintainer="hello@jejunetwork.org" \
    authors="Jeju Network" \
    commit="${COMMIT}" \
    version="${VERSION}"

ENV VERSION=${VERSION}
ENV EQLITE_ROLE=miner
ENV EQLITE_CONF=config.yaml

# Include ICU libs for dynamic linking and other runtime dependencies
RUN apk --no-cache add ca-certificates icu-libs musl libgcc libstdc++ sqlite-libs

WORKDIR /app
COPY --from=eqlite/eqlite-builder:latest /go/src/eqlite/bin/eqlited /app/
COPY --from=eqlite/eqlite-builder:latest /go/src/eqlite/bin/eqlite-minerd /app/
COPY --from=eqlite/eqlite-builder:latest /go/src/eqlite/bin/eqlite /app/
COPY --from=eqlite/eqlite-builder:latest /go/src/eqlite/bin/eqlite-fuse /app/
COPY --from=eqlite/eqlite-builder:latest /go/src/eqlite/bin/eqlite-mysql-adapter /app/
COPY --from=eqlite/eqlite-builder:latest /go/src/eqlite/bin/eqlite-proxy /app/
COPY docker/docker-entry.sh /app/
RUN chmod +x /app/docker-entry.sh
ENTRYPOINT [ "./docker-entry.sh" ]
EXPOSE 4661
