package controller

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	neturl "net/url"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"syscall"
	"time"

	"eylexander/ytdlp-ui/backend/src/datastore"
	"eylexander/ytdlp-ui/backend/src/models"
)

// Controller owns all download jobs and the login state.
// Each job's files live in <DATA_DIR>/downloads/<id>/.
type Controller struct {
	cfg     *models.Config
	db      datastore.DataStore
	dir     string
	mu      sync.Mutex
	jobs    map[string]*models.Job
	cancels map[string]context.CancelFunc
	sem     chan struct{}
	wg      sync.WaitGroup
	closing bool

	thumbs    string
	updateMu  sync.Mutex
	versionMu sync.Mutex
	version   string

	authMu  sync.Mutex
	account models.Account
	fails   map[string][]time.Time
}

func NewController(cfg *models.Config, db datastore.DataStore) (*Controller, error) {
	c := &Controller{
		cfg:     cfg,
		db:      db,
		dir:     filepath.Join(cfg.DataDir, "downloads"),
		thumbs:  filepath.Join(cfg.DataDir, "thumbnails"),
		jobs:    map[string]*models.Job{},
		cancels: map[string]context.CancelFunc{},
		sem:     make(chan struct{}, cfg.MaxConcurrent),
		fails:   map[string][]time.Time{},
	}
	for _, d := range []string{c.dir, c.thumbs} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return nil, err
		}
	}
	if err := c.loadAccount(); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), datastore.Timeout)
	defer cancel()
	saved, err := db.GetDownloads(ctx)
	if err != nil {
		return nil, fmt.Errorf("loading downloads: %w", err)
	}
	for _, j := range saved {
		if j.Active() {
			j.Status, j.Error = models.StatusFailed, "interrupted" // a jobErrors code, see ClassifyError
			os.RemoveAll(filepath.Join(c.dir, j.ID))
			c.saveLocked(j)
		} else if c.fixSize(j) {
			c.saveLocked(j) // rows saved before sizes came from the file (showed one stream only)
		}
		c.jobs[j.ID] = j
	}
	return c, nil
}

// snapshotLocked returns copies of all jobs, newest first. Caller holds c.mu.
func (c *Controller) snapshotLocked() []models.Job {
	list := make([]models.Job, 0, len(c.jobs))
	for _, j := range c.jobs {
		list = append(list, *j)
	}
	slices.SortFunc(list, func(a, b models.Job) int { return b.CreatedAt.Compare(a.CreatedAt) })
	return list
}

// saveLocked persists one job. Called on state changes only, never on progress ticks.
// ponytail: runs under c.mu so writes for a job can't land out of order; move to a per-job
// write queue if DB latency ever stalls the UI.
func (c *Controller) saveLocked(j *models.Job) {
	ctx, cancel := context.WithTimeout(context.Background(), datastore.Timeout)
	defer cancel()
	if err := c.db.SaveDownload(ctx, *j); err != nil {
		log.Printf("saving download %s: %v", j.ID, err)
	}
}

func (c *Controller) update(id string, persist bool, fn func(j *models.Job)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if j, ok := c.jobs[id]; ok {
		fn(j)
		if persist {
			c.saveLocked(j)
		}
	}
}

func (c *Controller) List() []models.Job {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.snapshotLocked()
}

// Create validates the request and queues a download. Errors are user-facing.
func (c *Controller) Create(link string, opts models.Options) (models.Job, error) {
	link = strings.TrimSpace(link)
	if u, err := neturl.Parse(link); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return models.Job{}, models.UserErr("invalid_link", "Please enter a valid link starting with http:// or https://", nil)
	}
	if err := opts.Normalize(); err != nil {
		if ue := (*models.UserError)(nil); errors.As(err, &ue) {
			return models.Job{}, ue
		}
		return models.Job{}, models.UserErr("invalid_options", "Invalid options: "+err.Error(), map[string]any{"detail": err.Error()})
	}

	idBytes := make([]byte, 6)
	rand.Read(idBytes)
	j := &models.Job{ID: hex.EncodeToString(idBytes), URL: link, Options: opts, Status: models.StatusQueued, CreatedAt: time.Now()}

	c.mu.Lock()
	if src := opts.ConvertFrom; src != "" {
		s, ok := c.jobs[src]
		if !ok || s.Status != models.StatusDone || s.File == "" {
			c.mu.Unlock()
			return models.Job{}, models.UserErr("convert_source_missing", "The original file isn't available anymore", nil)
		}
		j.URL, j.Title, j.Thumbnail, j.Uploader, j.Duration = s.URL, s.Title, s.Thumbnail, s.Uploader, s.Duration
		_ = os.Link(c.thumbPath(src), c.thumbPath(j.ID)) // share the cached thumbnail; fetched on first view otherwise
	}
	ctx, cancel := context.WithCancel(context.Background())
	c.jobs[j.ID], c.cancels[j.ID] = j, cancel
	c.saveLocked(j)
	resp := *j
	c.mu.Unlock()

	c.wg.Add(1)
	go func() {
		defer c.wg.Done()
		defer cancel()
		c.run(ctx, j.ID)
	}()
	return resp, nil
}

// Cancel stops a queued or running download. It reports false if nothing was running.
func (c *Controller) Cancel(id string) bool {
	c.mu.Lock()
	cancel, ok := c.cancels[id]
	c.mu.Unlock()
	if ok {
		cancel()
	}
	return ok
}

// Delete removes a job and its files, canceling it first if needed.
func (c *Controller) Delete(id string) (found bool, err error) {
	c.mu.Lock()
	if _, ok := c.jobs[id]; !ok {
		c.mu.Unlock()
		return false, nil
	}
	// Database first: if it fails, nothing changes and the user can retry.
	ctx, cancel := context.WithTimeout(context.Background(), datastore.Timeout)
	defer cancel()
	if err := c.db.DeleteDownload(ctx, id); err != nil {
		c.mu.Unlock()
		return true, fmt.Errorf("database: %w", err)
	}
	if stop, ok := c.cancels[id]; ok {
		stop() // run() removes the folder once the process is gone
	}
	delete(c.jobs, id)
	c.mu.Unlock()
	os.Remove(c.thumbPath(id))
	return true, os.RemoveAll(filepath.Join(c.dir, id))
}

// Shutdown kills running yt-dlp processes so they don't outlive the server.
func (c *Controller) Shutdown() {
	c.mu.Lock()
	c.closing = true
	for _, cancel := range c.cancels {
		cancel()
	}
	c.mu.Unlock()
	c.wg.Wait()
}

func (c *Controller) run(ctx context.Context, id string) {
	select {
	case c.sem <- struct{}{}:
		defer func() { <-c.sem }()
	case <-ctx.Done():
	}

	var j models.Job
	c.update(id, true, func(job *models.Job) {
		if ctx.Err() == nil {
			job.Status = models.StatusRunning
		}
		j = *job
	})
	dir := filepath.Join(c.dir, id)

	var stderr bytes.Buffer
	var err error
	convert := j.Options.ConvertFrom != ""
	cmd, handle := (*exec.Cmd)(nil), c.handleLine
	if !convert {
		cmd = exec.CommandContext(ctx, c.cfg.YtDlp, BuildArgs(j.Options, dir, j.URL)...)
	} else if src := c.Files([]string{j.Options.ConvertFrom}); len(src) == 0 {
		err = errSourceGone
	} else {
		cmd, handle = exec.CommandContext(ctx, "ffmpeg", ConvertArgs(j.Options, src[0].Path, dir)...), c.handleFFmpegLine
		err = os.MkdirAll(dir, 0o755)
	}
	if ctx.Err() == nil && err == nil {
		// Own process group so cancel also kills the ffmpeg children yt-dlp spawns.
		cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
		cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
		cmd.Stderr = &stderr
		stdout, _ := cmd.StdoutPipe()
		if err = cmd.Start(); err == nil {
			sc := bufio.NewScanner(stdout)
			sc.Buffer(make([]byte, 64*1024), 1024*1024)
			for sc.Scan() {
				handle(id, sc.Text())
			}
			_, _ = io.Copy(io.Discard, stdout) // drain so Wait can't block on a full pipe
			err = cmd.Wait()
		}
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.cancels, id)
	if c.closing {
		return // left "active" on disk; the next start marks it interrupted and cleans up
	}
	job := c.jobs[id] // nil if deleted meanwhile
	if ctx.Err() != nil || err != nil {
		os.RemoveAll(dir)
	}
	if job == nil {
		return
	}
	now := time.Now()
	job.FinishedAt, job.Speed, job.ETA = &now, 0, 0
	switch {
	case ctx.Err() != nil:
		job.Status = models.StatusCanceled
	case errors.Is(err, errSourceGone):
		job.Status, job.Error = models.StatusFailed, "source_missing"
	case errors.Is(err, exec.ErrNotFound) && convert:
		job.Status, job.Error, job.ErrorDetail = models.StatusFailed, "ffmpeg_missing", err.Error()
	case errors.Is(err, exec.ErrNotFound):
		job.Status, job.Error, job.ErrorDetail = models.StatusFailed, "ytdlp_missing", err.Error()
	case err != nil && convert:
		job.Status, job.Error, job.ErrorDetail = models.StatusFailed, "generic", strings.TrimSpace(stderr.String())
		if strings.Contains(job.ErrorDetail, "matches no streams") {
			job.Error = "no_audio"
		}
	case err != nil:
		job.Status = models.StatusFailed
		job.Error, job.ErrorDetail = ClassifyError(stderr.String())
		if job.ErrorDetail == "" {
			job.ErrorDetail = err.Error()
		}
	default:
		job.Status, job.Progress = models.StatusDone, 100
		if job.File == "" { // e.g. file already existed, so after_move never printed
			if entries, _ := os.ReadDir(dir); len(entries) > 0 {
				job.File = entries[0].Name()
			}
		}
		c.fixSize(job)
	}
	c.saveLocked(job)
}

// fixSize sets a finished job's size from its file: progress only reports one stream at a
// time, so a merged video would otherwise show the size of its audio. Reports a change.
func (c *Controller) fixSize(j *models.Job) bool {
	if j.Status != models.StatusDone || j.File == "" {
		return false
	}
	info, err := os.Stat(filepath.Join(c.dir, j.ID, j.File))
	if err != nil || info.Size() == j.Size {
		return false
	}
	j.Size = info.Size()
	return true
}

func (c *Controller) handleLine(id, line string) {
	switch {
	case strings.HasPrefix(line, prefixProgress):
		var p struct {
			Status     string  `json:"status"`
			Downloaded float64 `json:"downloaded_bytes"`
			Total      float64 `json:"total_bytes"`
			Estimate   float64 `json:"total_bytes_estimate"`
			Speed      float64 `json:"speed"`
			ETA        float64 `json:"eta"`
		}
		if json.Unmarshal([]byte(line[len(prefixProgress):]), &p) != nil {
			return
		}
		c.update(id, false, func(j *models.Job) {
			// Postprocessor progress goes to stderr, so a finished stream is the cue that
			// merging/converting starts. A following stream (e.g. audio) flips it back to running.
			if p.Status == "finished" {
				j.Status, j.Progress, j.Speed, j.ETA = models.StatusProcessing, 100, 0, 0
				return
			}
			total := max(p.Total, p.Estimate)
			j.Status, j.Speed, j.ETA, j.Size = models.StatusRunning, p.Speed, p.ETA, int64(total)
			if total > 0 {
				j.Progress = min(100, p.Downloaded/total*100)
			}
		})
	case strings.HasPrefix(line, prefixInfo):
		var info struct {
			Title, Thumbnail, Uploader string
			Duration                   float64
		}
		if json.Unmarshal([]byte(line[len(prefixInfo):]), &info) != nil {
			return
		}
		c.update(id, true, func(j *models.Job) {
			j.Title, j.Thumbnail, j.Uploader, j.Duration = info.Title, info.Thumbnail, info.Uploader, info.Duration
		})
		if info.Thumbnail != "" {
			go func() {
				if err := c.cacheThumbnail(id, info.Thumbnail); err != nil {
					log.Printf("caching thumbnail %s: %v (retried on first view)", id, err)
				}
			}()
		}
	case strings.HasPrefix(line, prefixFile):
		c.update(id, false, func(j *models.Job) { j.File = filepath.Base(line[len(prefixFile):]) })
	}
}
