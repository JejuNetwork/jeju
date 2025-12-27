# Stage: all runner
FROM alpine:3.9

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

RUN apk --no-cache add ca-certificates icu-libs musl

WORKDIR /app
COPY --from=eqlite/eqlite-builder /go/src/eqlite/bin/* /app/
ENTRYPOINT [ "./docker-entry.sh" ]
EXPOSE 4661
