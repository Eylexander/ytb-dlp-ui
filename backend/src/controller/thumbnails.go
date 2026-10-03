package controller

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Thumbnails are copied to <DATA_DIR>/thumbnails/<id> so the browser only ever talks to
// this server: no external image CDNs, and they keep working once the remote is gone.

func (c *Controller) thumbPath(id string) string { return filepath.Join(c.thumbs, id) }

func (c *Controller) cacheThumbnail(id, url string) error {
	if !strings.HasPrefix(url, "https://") && !strings.HasPrefix(url, "http://") {
		return fmt.Errorf("not an http(s) URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("thumbnail: %s", resp.Status)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, 5<<20))
	if err != nil {
		return err
	}
	if ct := http.DetectContentType(b); !strings.HasPrefix(ct, "image/") {
		return fmt.Errorf("thumbnail is %s, not an image", ct)
	}
	// Temp file + rename: the prefetch and an on-demand request may race.
	tmp, err := os.CreateTemp(c.thumbs, id+".*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		return err
	}
	tmp.Close()
	return os.Rename(tmp.Name(), c.thumbPath(id))
}

// Thumbnail returns the cached thumbnail, fetching it on first use (older jobs).
// If caching fails, remote is the original URL to fall back to.
func (c *Controller) Thumbnail(id string) (path, remote string, ok bool) {
	c.mu.Lock()
	if j, found := c.jobs[id]; found {
		remote = j.Thumbnail
	}
	c.mu.Unlock()
	if remote == "" {
		return "", "", false
	}
	path = c.thumbPath(id)
	if _, err := os.Stat(path); err == nil {
		return path, remote, true
	}
	if err := c.cacheThumbnail(id, remote); err != nil {
		log.Printf("caching thumbnail %s: %v", id, err)
		return "", remote, true
	}
	return path, remote, true
}
