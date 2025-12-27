
package model

import (
	"github.com/gin-gonic/gin"
	gorp "gopkg.in/gorp.v2"
)

// GetDB returns the database mapping object from gin context.
func GetDB(c *gin.Context) *gorp.DbMap {
	return c.MustGet("db").(*gorp.DbMap)
}
