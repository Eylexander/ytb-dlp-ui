package controller

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"eylexander/ytdlp-ui/backend/src/models"
)

// File is a finished download on disk.
type File struct {
	Path string
	Name string
}

// Files returns the files of the given jobs that are done and still on disk, in order.
func (c *Controller) Files(ids []string) []File {
	c.mu.Lock()
	defer c.mu.Unlock()
	var files []File
	for _, id := range ids {
		j, ok := c.jobs[id]
		if !ok || j.Status != models.StatusDone || j.File == "" {
			continue
		}
		path := filepath.Join(c.dir, id, j.File)
		if _, err := os.Stat(path); err == nil {
			files = append(files, File{Path: path, Name: j.File})
		}
	}
	return files
}

// WriteZip streams files into a zip without compression: media is already compressed,
// so storing is as small and needs no CPU. Duplicate names get " (2)", " (3)"…
func WriteZip(w io.Writer, files []File) error {
	zw := zip.NewWriter(w)
	seen := map[string]int{}
	for _, f := range files {
		name := f.Name
		if n := seen[strings.ToLower(name)]; n > 0 {
			ext := filepath.Ext(name)
			name = fmt.Sprintf("%s (%d)%s", strings.TrimSuffix(name, ext), n+1, ext)
		}
		seen[strings.ToLower(f.Name)]++
		if err := addToZip(zw, f.Path, name); err != nil {
			return fmt.Errorf("%s: %w", f.Name, err)
		}
	}
	return zw.Close()
}

func addToZip(zw *zip.Writer, path, name string) error {
	src, err := os.Open(path)
	if err != nil {
		return err
	}
	defer src.Close()
	info, err := src.Stat()
	if err != nil {
		return err
	}
	dst, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Store, Modified: info.ModTime()})
	if err != nil {
		return err
	}
	_, err = io.Copy(dst, src)
	return err
}
