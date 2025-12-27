
package metric

import (
	"testing"
	"time"

	. "github.com/smartystreets/goconvey/convey"

	"eqlite/src/consistent"
	"eqlite/src/crypto/asymmetric"
	"eqlite/src/crypto/kms"
	"eqlite/src/proto"
	"eqlite/src/route"
	rpc "eqlite/src/rpc/mux"
	"eqlite/src/utils"
	"eqlite/src/utils/log"
)

const PubKeyStorePath = "./public.keystore"

func TestCollectClient_UploadMetrics(t *testing.T) {
	defer utils.RemoveAll(PubKeyStorePath + "*")
	log.SetLevel(log.DebugLevel)
	addr := "127.0.0.1:0"
	masterKey := []byte("abc")

	cc := NewCollectClient()
	cs := NewCollectServer()

	server, err := rpc.NewServerWithService(rpc.ServiceMap{MetricServiceName: cs})
	if err != nil {
		log.Fatal(err)
	}

	route.NewDHTService(PubKeyStorePath, new(consistent.KMSStorage), false)
	server.InitRPCServer(addr, "../keys/test.key", masterKey)
	go server.Serve()

	publicKey, err := kms.GetLocalPublicKey()
	nonce := asymmetric.GetPubKeyNonce(publicKey, 10, 100*time.Millisecond, nil)
	serverNodeID := proto.NodeID(nonce.Hash.String())
	kms.SetPublicKey(serverNodeID, nonce.Nonce, publicKey)
	kms.SetLocalNodeIDNonce(nonce.Hash.CloneBytes(), &nonce.Nonce)
	route.SetNodeAddrCache(&proto.RawNodeID{Hash: nonce.Hash}, server.Listener.Addr().String())

	Convey("get metric and upload by RPC", t, func() {
		err = cc.UploadMetrics(serverNodeID)
		v, ok := cs.NodeMetric.Load(serverNodeID)
		So(ok, ShouldBeTrue)
		//log.Debugf("NodeMetric：%#v", v)

		m, _ := v.(SimpleMetricMap)
		mfb, err := cc.GatherMetricBytes()
		So(err, ShouldBeNil)
		So(len(m), ShouldEqual, len(mfb))
		So(len(m), ShouldBeGreaterThan, 2)
	})

	Convey("get metric and upload by simply called without node id", t, func() {
		req := &proto.UploadMetricsReq{
			MFBytes:  nil,
			Envelope: proto.Envelope{},
		}
		err = cs.UploadMetrics(req, &proto.UploadMetricsResp{})
		So(err, ShouldNotBeNil)
	})
}
