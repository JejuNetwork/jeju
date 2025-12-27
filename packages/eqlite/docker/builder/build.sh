#!/bin/bash

docker build -t eqlite/release-builder:latest . && \
docker push eqlite/release-builder
