
package observer

import (
	"net/http"

	"eqlite/src/conf"
	"eqlite/src/crypto/kms"
	"eqlite/src/proto"
	rpc "eqlite/src/rpc/mux"
	"eqlite/src/utils/log"
)

func registerNode() (err error) {
	var nodeID proto.NodeID

	if nodeID, err = kms.GetLocalNodeID(); err != nil {
		return
	}

	var nodeInfo *proto.Node
	if nodeInfo, err = kms.GetNodeInfo(nodeID); err != nil {
		return
	}

	err = rpc.PingBP(nodeInfo, conf.GConf.BP.NodeID)

	return
}

func startService() (service *Service, err error) {
	// register observer service to rpc server
	service, err = NewService()
	if err != nil {
		return
	}

	// start observer service
	service.start()

	return
}

func stopService(service *Service) (err error) {
	// stop subscription
	return service.stop()
}

// StartObserver starts the observer service and http API server.
func StartObserver(listenAddr string, version string) (service *Service, httpServer *http.Server, err error) {
	// start service
	if service, err = startService(); err != nil {
		log.WithError(err).Fatal("start observation failed")
	}

	// start explorer api
	httpServer, err = startAPI(service, listenAddr, version)
	if err != nil {
		log.WithError(err).Fatal("start explorer api failed")
	}

	// register node
	if err = registerNode(); err != nil {
		log.WithError(err).Fatal("register node failed")
	}
	return
}

// StopObserver stops the service and http API server returned by StartObserver.
func StopObserver(service *Service, httpServer *http.Server) (err error) {
	// stop explorer api
	if err = stopAPI(httpServer); err != nil {
		log.WithError(err).Fatal("stop explorer api failed")
	}

	// stop subscriptions
	if err = stopService(service); err != nil {
		log.WithError(err).Fatal("stop service failed")
	}
	return
}
