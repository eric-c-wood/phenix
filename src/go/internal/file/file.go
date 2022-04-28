package file

import (
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"phenix/internal/common"
	"phenix/internal/mm"
	"phenix/internal/mm/mmcli"
)

var DefaultClusterFiles ClusterFiles = new(MMClusterFiles)

type ClusterFiles interface {
	// Get list of VM disk images, container filesystems, or both.
	// Assumes disk images have `.qc2` or `.qcow2` extension.
	// Assumes container filesystems have `_rootfs.tgz` suffix.
	// Alternatively, we could force the use of subdirectories w/ known names
	// (such as `base-images` and `container-fs`).
	GetImages(kind ImageKind) ([]ImageDetails, error)

	GetExperimentFileNames(exp, filter string) (ExperimentFiles, error)

	// Looks in experiment directory on each cluster node for matching filenames
	// that end in both `.SNAP` and `.qc2`.
	GetExperimentSnapshots(exp string) ([]string, error)

	// Should leverage meshage and iomeshage to make a `file` API call on the
	// destination cluster node for the given path.
	CopyFile(path, dest string, status CopyStatus) error

	// Should leverage meshage and iomeshage to make a `file get` API call on all
	// mesh nodes for the given path.
	SyncFile(path string, status CopyStatus) error

	DeleteFile(path string) error
}

func GetImages(kind ImageKind) ([]ImageDetails, error) {
	return DefaultClusterFiles.GetImages(kind)
}

func GetExperimentFileNames(exp, filter string) (ExperimentFiles, error) {
	return DefaultClusterFiles.GetExperimentFileNames(exp, filter)
}

func GetExperimentSnapshots(exp string) ([]string, error) {
	return DefaultClusterFiles.GetExperimentSnapshots(exp)
}

func CopyFile(path, dest string, status CopyStatus) error {
	return DefaultClusterFiles.CopyFile(path, dest, status)
}

func SyncFile(path string, status CopyStatus) error {
	return DefaultClusterFiles.SyncFile(path, status)
}

func DeleteFile(path string) error {
	return DefaultClusterFiles.DeleteFile(path)
}

type MMClusterFiles struct{}

func (MMClusterFiles) GetImages(kind ImageKind) ([]ImageDetails, error) {
	// Using a map here to weed out duplicates.
	details := make(map[string]ImageDetails)

	// First get file listings from mesh, then from headnode.
	commands := []string{"mesh send all file list", "file list"}

	// First, get file listings from cluster nodes.

	cmd := mmcli.NewCommand()

	for _, command := range commands {
		cmd.Command = command

		for _, row := range mmcli.RunTabular(cmd) {
			// Only looking in the base directory for now.
			if row["dir"] != "" {
				continue
			}

			image := ImageDetails{
				Name:     row["name"],
				FullPath: "/" + row["name"],
			}

			if strings.HasSuffix(image.Name, ".qc2") || strings.HasSuffix(image.Name, ".qcow2") {
				image.Kind = VM_IMAGE
			} else if strings.HasSuffix(image.Name, "_rootfs.tgz") {
				image.Kind = CONTAINER_IMAGE
			} else {
				continue
			}

			var err error

			image.Size, err = strconv.Atoi(row["size"])
			if err != nil {
				return nil, fmt.Errorf("getting size of file: %w", err)
			}

			details[image.Name] = image
		}
	}

	var images []ImageDetails

	for name := range details {
		images = append(images, details[name])
	}

	return images, nil
}

func (MMClusterFiles) GetExperimentFileNames(exp, filter string) (ExperimentFiles, error) {
	// Using a map here to weed out duplicates.
	matches := make(map[string]ExperimentFile)
	var category string

	dir := fmt.Sprintf("/%s/files", exp)

	// First get file listings from mesh, then from headnode.
	commands := []string{
		"mesh send all file list " + dir,
		"file list " + dir,
	}

	cmd := mmcli.NewCommand()

	// Build a Boolean expression tree and determine
	// the fields that should be searched
	filterTree := BuildTree(filter)

	for _, command := range commands {
		cmd.Command = command

		for _, row := range mmcli.RunTabular(cmd) {
			// Only looking for files.
			if row["dir"] != "" {
				continue
			}

			name := filepath.Base(row["name"])

			switch extension := filepath.Ext(name); extension {
			case ".pcap":
				category = "Packet Capture"
			case ".elf":
				category = "ELF Memory Snapshot"
			case ".SNAP":
				category = "VM Memory Snapshot"
			default:
				category = "Unknown"

			}

			fileSize, _ := strconv.Atoi(row["size"])

			if _, ok := matches[name]; !ok {

				matches[name] = ExperimentFile{
					Name:     name,
					Size:     fileSize,
					Category: category,
				}
			}
		}

	}

	// Add the file modification dates
	fillInFileDates(exp, matches)

	experimentFiles := ExperimentFiles{}

	for _, expFile := range matches {

		// Add categories for qcow images prior to filtering
		switch extension := filepath.Ext(expFile.Name); extension {
		case ".qc2", ".qcow2":
			rootName := strings.TrimSuffix(expFile.Name, extension)
			if _, ok := matches[rootName+".SNAP"]; ok {
				expFile.Category = "VM Disk Snapshot"
			} else {
				expFile.Category = "Backing Image"
			}

		}

		// Apply any filters
		if len(filter) > 0 {
			if filterTree == nil {
				continue
			}
			if !filterTree.Evaluate(&expFile) {
				continue
			}
		}

		experimentFiles = append(experimentFiles, expFile)
	}

	return experimentFiles, nil
}

func (MMClusterFiles) GetExperimentSnapshots(exp string) ([]string, error) {
	// Using a map here to weed out duplicates and to ensure each snapshot has
	// both a memory snapshot (.snap) and a disk snapshot (.qc2).
	matches := make(map[string]string)

	files, err := GetExperimentFileNames(exp, "")
	if err != nil {
		return nil, fmt.Errorf("getting experiment file names: %w", err)
	}

	for _, f := range files {
		ext := filepath.Ext(f.Name)

		switch ext {
		case ".qc2", ".qcow2":
			ss := strings.TrimSuffix(f.Name, ext)

			if m, ok := matches[ss]; !ok {
				matches[ss] = "qcow"
			} else if m == "snap" {
				matches[ss] = "both"
			}
		case ".SNAP", ".snap":
			ss := strings.TrimSuffix(f.Name, ext)

			if m, ok := matches[ss]; !ok {
				matches[ss] = "snap"
			} else if m == "qcow" {
				matches[ss] = "both"
			}
		}
	}

	var snapshots []string

	for ss := range matches {
		if matches[ss] == "both" {
			snapshots = append(snapshots, ss)
		}
	}

	return snapshots, nil
}

func (MMClusterFiles) CopyFile(path, dest string, status CopyStatus) error {
	cmd := mmcli.NewCommand()

	if mm.IsHeadnode(dest) {
		cmd.Command = fmt.Sprintf(`file get %s`, path)
	} else {
		cmd.Command = fmt.Sprintf(`mesh send %s file get %s`, dest, path)
	}

	if err := mmcli.ErrorResponse(mmcli.Run(cmd)); err != nil {
		return fmt.Errorf("copying file to destination: %w", err)
	}

	if mm.IsHeadnode(dest) {
		cmd.Command = fmt.Sprintf(`file status`)
	} else {
		cmd.Command = fmt.Sprintf(`mesh send %s file status`, dest)
	}

	for {
		var found bool

		for _, row := range mmcli.RunTabular(cmd) {
			if row["filename"] == path {
				comp := strings.Split(row["completed"], "/")

				parts, _ := strconv.ParseFloat(comp[0], 64)
				total, _ := strconv.ParseFloat(comp[1], 64)

				if status != nil {
					status(parts / total)
				}

				found = true
				break
			}
		}

		// If the file is done transferring, then it will not have been present in
		// the results from `file status`.
		if !found {
			break
		}
	}

	return nil
}

func (MMClusterFiles) SyncFile(path string, status CopyStatus) error {
	cmd := mmcli.NewCommand()
	cmd.Command = "mesh send all file get " + path

	if err := mmcli.ErrorResponse(mmcli.Run(cmd)); err != nil {
		return fmt.Errorf("syncing file to cluster nodes: %w", err)
	}

	if status != nil {
		// TODO: use mesh to get file status transfer for file from each node.
	}

	return nil
}

func (MMClusterFiles) DeleteFile(path string) error {
	// NOTE: this is replicated in `internal/mm/minimega.go` to avoid cyclical
	// dependency between mm and file packages.

	// First delete file from mesh, then from headnode.
	commands := []string{"mesh send all file delete", "file delete"}

	cmd := mmcli.NewCommand()

	for _, command := range commands {
		cmd.Command = fmt.Sprintf("%s %s", command, path)

		if err := mmcli.ErrorResponse(mmcli.Run(cmd)); err != nil {
			return fmt.Errorf("deleting file from cluster nodes: %w", err)
		}
	}

	return nil
}

func fillInFileDates(expName string, expFiles map[string]ExperimentFile) {

	dirPath := fmt.Sprintf("%s/images/%s/files", common.PhenixBase, expName)

	// First get file listings from mesh, then from headnode.
	commands := []string{
		"mesh send all shell ls -alht --full-time " + dirPath,
		"shell ls -alht --full-time " + dirPath,
	}

	cmd := mmcli.NewCommand()

	for _, command := range commands {
		cmd.Command = command

		for response := range mmcli.Run(cmd) {
			for _, r := range response.Resp {
				if len(r.Response) == 0 {
					continue
				}

				lines := strings.Split(r.Response, "\n")

				for _, line := range lines {
					fields := strings.Fields(line)
					if len(fields) < 9 {
						continue
					}

					directoryFlag := fields[0:1][0][0:1]
					if directoryFlag == "d" {
						continue
					}

					fileModDate := strings.Join(fields[5:7], " ")
					fileName := fields[8:9][0]

					if expFile, ok := expFiles[fileName]; ok {
						expFile.Date = strings.Split(fileModDate, ".")[0]
						t, _ := time.Parse("2006-01-02 15:04:05", expFile.Date)
						expFile.DateTime = t
						expFiles[fileName] = expFile
					}

				}
			}

		}

	}

}
