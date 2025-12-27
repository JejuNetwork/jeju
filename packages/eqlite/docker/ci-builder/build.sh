#!/bin/bash

docker build -t eqlite/build:latest . && \
docker push eqlite/build
