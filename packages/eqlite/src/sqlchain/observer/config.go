
package observer

import (
	"os"

	yaml "gopkg.in/yaml.v2"

	"eqlite/src/utils/log"
)

// Database defines single database subscription status.
type Database struct {
	ID       string `yaml:"ID"`
	Position string `yaml:"Position"`
}

// Config defines subscription settings for observer.
type Config struct {
	Databases []Database `yaml:"Databases"`
}

type configWrapper struct {
	Observer *Config `yaml:"Observer"`
}

func loadConfig(path string) (config *Config, err error) {
	var (
		content []byte
		wrapper = &configWrapper{}
	)
	if content, err = os.ReadFile(path); err != nil {
		log.WithError(err).Error("failed to read config file")
		return
	}
	if err = yaml.Unmarshal(content, wrapper); err != nil {
		log.WithError(err).Error("failed to unmarshal config file")
		return
	}
	config = wrapper.Observer
	return
}
