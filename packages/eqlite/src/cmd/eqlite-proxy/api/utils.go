
package api

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"

	"eqlite/src/cmd/eqlite-proxy/auth"
	"eqlite/src/cmd/eqlite-proxy/config"
	"eqlite/src/cmd/eqlite-proxy/model"
	"eqlite/src/cmd/eqlite-proxy/task"
	"eqlite/src/proto"
	"eqlite/src/route"
	"eqlite/src/rpc"
	"eqlite/src/rpc/mux"
	"eqlite/src/types"
)

func abortWithError(c *gin.Context, code int, err error) {
	if err != nil {
		_ = c.Error(err)
		c.AbortWithStatusJSON(code, gin.H{
			"success": false,
			"msg":     err.Error(),
		})
	}
}

func responseWithData(c *gin.Context, code int, data interface{}) {
	c.JSON(code, gin.H{
		"success": true,
		"msg":     "",
		"data":    data,
	})
}

func getSession(c *gin.Context) *model.Session {
	return c.MustGet("session").(*model.Session)
}

func getDeveloperID(c *gin.Context) int64 {
	return getSession(c).MustGetInt("developer_id")
}

func getUserID(c *gin.Context) int64 {
	return getSession(c).MustGetInt("user_id")
}

func getAdminAuth(c *gin.Context) *auth.AdminAuth {
	return c.MustGet("auth").(*auth.AdminAuth)
}

func getTaskManager(c *gin.Context) *task.Manager {
	return c.MustGet("task").(*task.Manager)
}

func getConfig(c *gin.Context) *config.Config {
	return c.MustGet("config").(*config.Config)
}

func getCurrentProject(c *gin.Context) *model.Project {
	return c.MustGet("project").(*model.Project)
}

func getDatabaseProfile(dbID proto.DatabaseID) (profile *types.SQLChainProfile, err error) {
	req := &types.QuerySQLChainProfileReq{
		DBID: dbID,
	}
	resp := &types.QuerySQLChainProfileResp{}

	err = mux.RequestBP(route.MCCQuerySQLChainProfile.String(), req, resp)
	if err != nil {
		err = errors.Wrapf(err, "query chain profile failed")
		return
	}

	profile = &resp.Profile

	return
}

func getDatabaseLeaderNodeID(dbID proto.DatabaseID) (nodeID proto.NodeID, err error) {
	profile, err := getDatabaseProfile(dbID)
	if err != nil {
		return
	}

	if len(profile.Miners) == 0 {
		err = errors.New("not enough miners")
		return
	}

	nodeID = profile.Miners[0].NodeID

	return
}

func getNodePCaller(nodeID proto.NodeID) rpc.PCaller {
	return mux.NewPersistentCaller(nodeID)
}

func formatUnixTime(t int64) interface{} {
	if t == 0 {
		return nil
	}
	return time.Unix(t, 0).UTC().String()
}
