# Stage: builder
FROM eqlite/release-builder as builder

ARG BUILD_ARG

WORKDIR /go/src/github.com/EQLite/EQLite
COPY . .
RUN make clean
RUN GOOS=linux make ${BUILD_ARG}

