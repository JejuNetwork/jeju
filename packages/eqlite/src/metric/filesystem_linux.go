

// +build !nofilesystem

package metric

import (
	"bufio"
	"os"
	"strings"
	"syscall"

	"eqlite/src/utils/log"
)

const (
	defIgnoredMountPoints = "^/(dev|proc|sys|var/lib/docker)($|/)"
	defIgnoredFSTypes     = "^(autofs|binfmt_misc|cgroup|configfs|debugfs|devpts|devtmpfs|fusectl|hugetlbfs|mqueue|overlay|proc|procfs|pstore|rpc_pipefs|securityfs|sysfs|tracefs)$"
	readOnly              = 0x1 // ST_RDONLY
)

// GetStats returns filesystem stats.
func (c *filesystemCollector) GetStats() ([]filesystemStats, error) {
	mps, err := mountPointDetails()
	if err != nil {
		return nil, err
	}
	stats := []filesystemStats{}
	for _, labels := range mps {
		if c.ignoredMountPointsPattern.MatchString(labels.mountPoint) {
			log.Debugf("ignoring mount point: %s", labels.mountPoint)
			continue
		}
		if c.ignoredFSTypesPattern.MatchString(labels.fsType) {
			log.Debugf("ignoring fs type: %s", labels.fsType)
			continue
		}

		buf := new(syscall.Statfs_t)
		err := syscall.Statfs(labels.mountPoint, buf)
		if err != nil {
			stats = append(stats, filesystemStats{
				labels:      labels,
				deviceError: 1,
			})
			log.Debugf("error on statfs() system call for %q: %s", labels.mountPoint, err)
			continue
		}

		var ro float64
		if (buf.Flags & readOnly) != 0 {
			ro = 1
		}

		stats = append(stats, filesystemStats{
			labels:    labels,
			size:      float64(buf.Blocks) * float64(buf.Bsize),
			free:      float64(buf.Bfree) * float64(buf.Bsize),
			avail:     float64(buf.Bavail) * float64(buf.Bsize),
			files:     float64(buf.Files),
			filesFree: float64(buf.Ffree),
			ro:        ro,
		})
	}
	return stats, nil
}

func mountPointDetails() ([]filesystemLabels, error) {
	file, err := os.Open(procFilePath("mounts"))
	if err != nil {
		return nil, err
	}
	defer file.Close()

	filesystems := []filesystemLabels{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		parts := strings.Fields(scanner.Text())

		// Ensure we handle the translation of \040 and \011
		// as per fstab(5).
		parts[1] = strings.Replace(parts[1], "\\040", " ", -1)
		parts[1] = strings.Replace(parts[1], "\\011", "\t", -1)

		filesystems = append(filesystems, filesystemLabels{
			device:     parts[0],
			mountPoint: parts[1],
			fsType:     parts[2],
		})
	}
	return filesystems, scanner.Err()
}
