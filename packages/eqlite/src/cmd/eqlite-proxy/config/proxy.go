
package config

import (
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
	validator "gopkg.in/go-playground/validator.v9"
	yaml "gopkg.in/yaml.v2"

	"eqlite/src/utils/log"
)

// StorageConfig defines the persistence options for proxy service.
type StorageConfig struct {
	// use local sqlite3 database for persistence or not.
	UseLocalDatabase bool   `yaml:"UseLocalDatabase"`
	DatabaseID       string `yaml:"DatabaseID" validate:"required"`
}

// AdminAuthConfig defines the admin auth feature config for proxy service.
type AdminAuthConfig struct {
	// enable github oauth for admin feature, otherwise use admin password instead.
	OAuthEnabled bool          `yaml:"OAuthEnabled"`
	OAuthExpires time.Duration `yaml:"OAuthExpires" validate:"required,gt=0"`

	// available if admin oauth enabled, used for public proxy service.
	GithubAppID     []string `yaml:"GithubAppID" validate:"required_with=OAuthEnabled,dive,required"`
	GithubAppSecret []string `yaml:"GithubAppSecret" validate:"required_with=OAuthEnabled,dive,required"`

	// available if admin oauth disabled, used for private proxy service.
	AdminPassword string   `yaml:"AdminPassword" validate:"required_without=OAuthEnabled"`
	AdminProjects []string `yaml:"AdminProjects" validate:"required_without=OAuthEnabled,dive,required,len=64"`
}

// UserAuthConfig defines the user auth feature config for proxy service.
type UserAuthConfig struct {
	// globally enabled oauth/openid providers for all projects.
	Providers []string `yaml:"Providers" validate:"required"`

	// provider specific configs, first key is provider id, second key is provide config item.
	Extra map[string]gin.H `yaml:"Extra"`
}

// Config defines the configurable options for proxy service.
type Config struct {
	ListenAddr string `yaml:"ListenAddr" validate:"required"`
	// platform wildcard hosts for proxy to accept and dispatch requests.
	// project specific hosts is defined in project admin settings.
	Hosts []string `yaml:"Hosts" validate:"dive,required"`

	// persistence config for proxy service.
	Storage *StorageConfig `yaml:"Storage" validate:"required"`

	// admin auth config for proxy service.
	AdminAuth *AdminAuthConfig `yaml:"AdminAuth" validate:"required"`

	// user auth config for proxy service.
	UserAuth *UserAuthConfig `yaml:"UserAuth" validate:"required"`
}

type confWrapper struct {
	Proxy *Config `yaml:"Proxy"`
}

// Validate checks config validity.
func (c *Config) Validate() (err error) {
	validate := validator.New()
	if err = validate.Struct(*c); err != nil {
		return
	}
	if c.Storage != nil {
		if err = validate.Struct(*c.Storage); err != nil {
			return
		}
	}
	if c.AdminAuth != nil {
		if err = validate.Struct(*c.AdminAuth); err != nil {
			return
		}

		if len(c.AdminAuth.GithubAppID) != len(c.AdminAuth.GithubAppSecret) {
			err = errors.Wrap(ErrInvalidProxyConfig, "mismatched admin appid and appsecret")
			return
		}
	}
	if c.UserAuth != nil {
		if err = validate.Struct(*c.UserAuth); err != nil {
			return
		}
	}

	return
}

// LoadConfig load the common eqlite client config again for extra config.
func LoadConfig(listenAddr string, configPath string) (config *Config, err error) {
	var configBytes []byte
	if configBytes, err = os.ReadFile(configPath); err != nil {
		log.WithError(err).Error("read config file failed")
		return
	}

	configWrapper := &confWrapper{}
	if err = yaml.Unmarshal(configBytes, configWrapper); err != nil {
		log.WithError(err).Error("unmarshal config file failed")
		return
	}

	if configWrapper.Proxy == nil {
		err = ErrInvalidProxyConfig
		log.WithError(err).Error("could not read proxy config")
		return
	}

	config = configWrapper.Proxy

	// override config
	if listenAddr != "" {
		config.ListenAddr = listenAddr
	}

	err = config.Validate()

	return
}
