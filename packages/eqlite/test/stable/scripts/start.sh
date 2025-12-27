#!/bin/bash
set -xeuo pipefail

role=$1

SCRIPT_DIR=$(cd `dirname $0`; pwd)
if [ -z "$WORKING_DIR" ]; then
    WORKING_DIR=$(cd "${SCRIPT_DIR}/../../.." && pwd)
fi
if [ -z "$RUNNING_DIR" ]; then
    RUNNING_DIR=$(cd "${SCRIPT_DIR}/.." && pwd)
fi
if [ -z "$LOG_DIR" ]; then
    LOG_DIR=/data/logs
fi

cd ${WORKING_DIR}

build_client(){
    cd ${RUNNING_DIR}
    go build -o 500million
    docker cp eqlite_bp_1:/app/eqlite ${RUNNING_DIR}
    sleep 3s
}

case $role in
    bp)
        # start bp
        docker-compose up --no-start eqlite_bp_0 eqlite_bp_1 eqlite_bp_2
        docker-compose start eqlite_bp_0 eqlite_bp_1 eqlite_bp_2
        ;;
    miner0)
        cp -r ${RUNNING_DIR}/node_miner_0 /data
        # start miner
        docker-compose up --no-start eqlite_miner_0
        docker-compose start eqlite_miner_0
        ;;
    miner1)
        cp -r ${RUNNING_DIR}/node_miner_1 /data
        # start miner
        docker-compose up --no-start eqlite_miner_1
        docker-compose start eqlite_miner_1
        ;;
    miner2)
        cp -r ${RUNNING_DIR}/node_miner_2 /data
        # start miner
        docker-compose up --no-start eqlite_miner_2
        docker-compose start eqlite_miner_2
        ;;
    miner3)
        cp -r ${RUNNING_DIR}/node_miner_3 /data
        # start miner
        docker-compose up --no-start eqlite_miner_3
        docker-compose start eqlite_miner_3
        ;;
    client)
        build_client

        ${RUNNING_DIR}/eqlite create -config ${RUNNING_DIR}/node_c/config.yaml \
            -wait-tx-confirm -db-node 4 -db-advance-payment 2000000000
        dsn=$(cat ${RUNNING_DIR}/node_c/.dsn | tail -n1)

        #Start client
        nohup ${RUNNING_DIR}/500million -config ${RUNNING_DIR}/node_c/config.yaml \
            -dsn ${dsn} > ${LOG_DIR}/client.log 2>&1 &
        ;;
    client_eventual)
        build_client

        ${RUNNING_DIR}/eqlite create -config ${RUNNING_DIR}/node_c/config.yaml \
            -wait-tx-confirm -db-node 4 -db-advance-payment 2000000000 -db-eventual-consistency
        dsn_eventual=$(cat ${RUNNING_DIR}/node_c/.dsn | tail -n1)

        #Start eventual client
        nohup ${RUNNING_DIR}/500million -config ${RUNNING_DIR}/node_c/config.yaml \
            -dsn ${dsn_eventual} > ${LOG_DIR}/client_eventual.log 2>&1 &
        ;;
esac


