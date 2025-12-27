#!/bin/sh

# echo nameserver 114.114.114.114 > /etc/resolv.conf

[ -s "${EQLITE_ALERT}" ] && [ -x "${EQLITE_ALERT}" ] && (eval "${EQLITE_ALERT}")

case "${EQLITE_ROLE}" in
miner)
    exec /app/eqlite-minerd -config "${EQLITE_CONF}" -metric-web "${METRIC_WEB_ADDR}" "${@}"
    ;;
blockproducer)
    exec /app/eqlited -config "${EQLITE_CONF}" -metric-web "${METRIC_WEB_ADDR}" "${@}"
    ;;
explorer)
    exec /app/eqlite explorer -config "${EQLITE_CONF}" "${@}" "${EQLITE_OBSERVER_ADDR}"
    ;;
adapter)
    exec /app/eqlite adapter -config "${EQLITE_CONF}" "${@}" "${EQLITE_ADAPTER_ADDR}"
    ;;
mysql-adapter)
    exec /app/eqlite-mysql-adapter -config "${EQLITE_CONF}" "${@}"
    ;;
cli)
    exec /app/eqlite console -config ${EQLITE_CONF} "${@}"
    ;;
faucet)
    exec /app/eqlite-faucet -config ${EQLITE_CONF} "${@}"
    ;;
esac

