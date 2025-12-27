#!/bin/bash
set -x

SCRIPT_DIR=$(cd `dirname $0`; pwd)
if [ -z "$WORKING_DIR" ]; then
    WORKING_DIR=$(cd "${SCRIPT_DIR}/../../.." && pwd)
fi
if [ -z "$LOG_DIR" ]; then
    LOG_DIR=/data/logs
fi

#Collect logs
cd ${LOG_DIR}
cd ..
rm -rf logs.zip

docker logs eqlite_bp_0 2> ${LOG_DIR}/eqlite_bp_0.log
docker logs eqlite_bp_1 2> ${LOG_DIR}/eqlite_bp_1.log
docker logs eqlite_bp_2 2> ${LOG_DIR}/eqlite_bp_2.log
docker logs eqlite_miner_0 2> ${LOG_DIR}/eqlite_miner_0.log
docker logs eqlite_miner_1 2> ${LOG_DIR}/eqlite_miner_1.log
docker logs eqlite_miner_2 2> ${LOG_DIR}/eqlite_miner_2.log
docker logs eqlite_miner_3 2> ${LOG_DIR}/eqlite_miner_3.log

#Clean
killall 500million
killall sar
killall python2

zip -r logs.zip logs

cd $WORKING_DIR
docker-compose down
make docker_clean
sudo git clean -dfx
sudo rm -rf /data/node_miner_0
sudo rm -rf /data/node_miner_1
sudo rm -rf /data/node_miner_2
sudo rm -rf /data/node_miner_3
