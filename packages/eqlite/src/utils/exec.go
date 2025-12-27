
package utils

import (
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

	"eqlite/src/utils/log"
)

// FJ is short for filepath.Join.
var FJ = filepath.Join

// CMD is the struct holding exec.Cmd and log path.
type CMD struct {
	Cmd     *exec.Cmd
	LogPath string
	LogFD   *os.File
}

// GetProjectSrcDir gets the src code root.
func GetProjectSrcDir() string {
	_, testFile, _, _ := runtime.Caller(0)
	return FJ(filepath.Dir(testFile), "../")
}

// RunCommand runs a command and capture its output to a log file,
//  if toStd is true also output to stdout and stderr.
func RunCommand(bin string, args []string, processName string, workingDir string, logDir string, toStd bool) (err error) {
	cmd, err := RunCommandNB(bin, args, processName, workingDir, logDir, toStd)
	if err != nil {
		log.WithFields(log.Fields{
			"bin":     bin,
			"args":    args,
			"process": processName,
		}).WithError(err).Error("start command failed")
		return
	}
	defer func() {
		_ = cmd.LogFD.Close()
	}()
	err = cmd.Cmd.Wait()
	if err != nil {
		log.WithFields(log.Fields{
			"path": cmd.Cmd.Path,
			"args": cmd.Cmd.Args,
		}).WithError(err).Error("wait command failed")
		return
	}
	return
}

// RunCommandNB starts a non-blocking command.
func RunCommandNB(bin string, args []string, processName string, workingDir string, logDir string, toStd bool) (cmd *CMD, err error) {
	cmd = new(CMD)
	err = os.Chdir(workingDir)
	if err != nil {
		log.WithField("wd", workingDir).Error("change working dir failed")
		return
	}

	cmd.LogPath = FJ(logDir, processName+".log")
	cmd.LogFD, err = os.Create(cmd.LogPath)
	if err != nil {
		log.WithField("path", cmd.LogPath).WithError(err).Error("create log file failed")
		return
	}

	cmd.Cmd = exec.Command(bin, args...)

	if toStd {
		cmd.Cmd.Stdout = io.MultiWriter(os.Stdout, cmd.LogFD)
		cmd.Cmd.Stderr = io.MultiWriter(os.Stderr, cmd.LogFD)
	} else {
		cmd.Cmd.Stdout = cmd.LogFD
		cmd.Cmd.Stderr = cmd.LogFD
	}

	err = cmd.Cmd.Start()
	if err != nil {
		log.WithError(err).Error("cmd.Start() failed")
		_ = cmd.LogFD.Close()
		cmd = nil
		return
	}

	return
}
