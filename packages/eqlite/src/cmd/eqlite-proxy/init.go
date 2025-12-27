
package main

import (
	"net/http"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	gorp "gopkg.in/gorp.v2"

	"eqlite/src/cmd/eqlite-proxy/api"
	"eqlite/src/cmd/eqlite-proxy/auth"
	"eqlite/src/cmd/eqlite-proxy/config"
	"eqlite/src/cmd/eqlite-proxy/model"
	"eqlite/src/cmd/eqlite-proxy/resolver"
	"eqlite/src/cmd/eqlite-proxy/storage"
	"eqlite/src/cmd/eqlite-proxy/task"
)

func initServer(cfg *config.Config) (server *http.Server, afterShutdown func(), err error) {
	e := gin.Default()
	e.Use(gin.Recovery())

	initCors(e)

	// init admin auth
	initAuth(e, cfg)

	// init storage
	var db *gorp.DbMap

	if db, err = initDB(e, cfg); err != nil {
		return
	}

	// init config
	initConfig(e, cfg)

	// init task manager
	tm := initTaskManager(e, cfg, db)

	// init rules manager
	initRulesManager(e)

	api.AddRoutes(e)

	server = &http.Server{
		Addr:    cfg.ListenAddr,
		Handler: e,
	}

	afterShutdown = func() {
		tm.Stop()
	}

	return
}

func initCors(e *gin.Engine) {
	corsCfg := cors.DefaultConfig()
	corsCfg.AllowAllOrigins = true
	corsCfg.AddAllowHeaders("X-EQLite-Token")
	e.Use(cors.New(corsCfg))
}

func initDB(e *gin.Engine, cfg *config.Config) (st *gorp.DbMap, err error) {
	st, err = storage.NewDatabase(cfg.Storage)
	if err != nil {
		return
	}

	// add tables
	model.AddTables(st)

	// create table if not exists
	if err = st.CreateTablesIfNotExists(); err != nil {
		return
	}

	e.Use(func(c *gin.Context) {
		c.Set("db", st)
		c.Next()
	})

	return
}

func initAuth(e *gin.Engine, cfg *config.Config) (authz *auth.AdminAuth) {
	authz = auth.NewAdminAuth(cfg.AdminAuth)

	e.Use(func(c *gin.Context) {
		c.Set("auth", authz)
		c.Next()
	})

	return
}

func initTaskManager(e *gin.Engine, cfg *config.Config, db *gorp.DbMap) (tm *task.Manager) {
	tm = task.NewManager(cfg, db)

	tm.Register(model.TaskCreateDB, api.CreateDatabaseTask)
	tm.Register(model.TaskApplyToken, api.ApplyTokenTask)
	tm.Register(model.TaskTopUp, api.TopUpTask)
	tm.Register(model.TaskCreateProject, api.CreateProjectTask)

	tm.Start()

	e.Use(func(c *gin.Context) {
		c.Set("task", tm)
		c.Next()
	})

	return
}

func initRulesManager(e *gin.Engine) (rm *resolver.RulesManager) {
	rm = &resolver.RulesManager{}

	e.Use(func(c *gin.Context) {
		c.Set("rules", rm)
		c.Next()
	})

	return
}

func initConfig(e *gin.Engine, cfg *config.Config) {
	e.Use(func(c *gin.Context) {
		c.Set("config", cfg)
		c.Next()
	})
}
