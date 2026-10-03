package controller

import (
	"context"
	"os/exec"
	"strings"
	"time"

	"eylexander/ytdlp-ui/backend/src/models"
)

// Line prefixes we ask yt-dlp to print on stdout so the output is machine-readable.
const (
	prefixInfo     = "__INFO__"
	prefixProgress = "__PROG__"
	prefixFile     = "__FILE__"
)

func BuildArgs(o models.Options, dir, url string) []string {
	args := []string{
		"--no-playlist", // ponytail: one job = one file; add playlist support when needed
		"--no-simulate", "--progress", "--newline", "--no-colors",
		"-P", dir, "-o", "%(title).200B.%(ext)s",
		"--print", "before_dl:" + prefixInfo + "%(.{title,thumbnail,duration,uploader})j",
		"--progress-template", "download:" + prefixProgress + "%(progress.{status,downloaded_bytes,total_bytes,total_bytes_estimate,speed,eta})j",
		"--print", "after_move:" + prefixFile + "%(filepath)s",
	}
	if o.Mode == "audio" {
		args = append(args, "-f", "ba/b", "-x", "--audio-quality", "0")
		if o.AudioFormat != "best" {
			args = append(args, "--audio-format", o.AudioFormat)
		}
	} else {
		sort := ""
		if o.Quality != "best" {
			sort = "res:" + o.Quality
		}
		if o.Container == "mp4" {
			// Prefer streams that merge into mp4 without re-encoding.
			sort = strings.Trim(sort+",ext:mp4:m4a", ",")
		}
		args = append(args, "-f", "bv*+ba/b", "--merge-output-format", o.Container)
		if sort != "" {
			args = append(args, "-S", sort)
		}
		if o.Subtitles {
			args = append(args, "--embed-subs", "--sub-langs", o.SubLangs)
		}
	}
	if o.EmbedThumbnail {
		args = append(args, "--embed-thumbnail")
	}
	if o.EmbedMetadata {
		args = append(args, "--embed-metadata")
	}
	if o.SponsorBlock {
		args = append(args, "--sponsorblock-remove", "sponsor,selfpromo,interaction")
	}
	// Custom options come last so they override the defaults above (yt-dlp: last one wins).
	// Already validated by Options.Normalize, so the error can't happen here.
	custom, _ := models.ParseArgs(o.CustomArgs)
	args = append(args, custom...)
	// "--" keeps a URL from ever being parsed as an option.
	return append(args, "--", url)
}

// errorCodes maps yt-dlp error text to a stable code, stored in Job.Error. The frontend shows
// the matching "jobErrors.<code>" message in the user's language. First match wins.
var errorCodes = []struct{ match, code string }{
	{"is not a valid URL", "invalid_url"},
	{"Unsupported URL", "unsupported_url"},
	{"Private video", "private"},
	{"confirm your age", "age_restricted"},
	{"not a bot", "bot_check"},
	{"members-only", "members_only"},
	{"Premieres in", "premiere"},
	{"live event will begin", "live_not_started"},
	{"Video unavailable", "unavailable"},
	{"HTTP Error 429", "http_429"},
	{"HTTP Error 403", "http_403"},
	{"HTTP Error 404", "http_404"},
	{"Requested format is not available", "format_unavailable"},
	{"ffmpeg not found", "ffmpeg_missing"},
	{"ffprobe and ffmpeg not found", "ffmpeg_missing"},
	{"No space left on device", "disk_full"},
	{"Unable to download webpage", "network"},
	{"Name or service not known", "network"},
}

// ClassifyError turns yt-dlp's stderr into an error code plus the raw detail line.
func ClassifyError(stderr string) (code, detail string) {
	lines := strings.Split(strings.TrimSpace(stderr), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if strings.HasPrefix(lines[i], "ERROR:") {
			detail = strings.TrimSpace(lines[i])
			break
		}
	}
	if detail == "" && len(lines) > 0 {
		detail = strings.TrimSpace(lines[len(lines)-1])
	}
	for _, e := range errorCodes {
		if strings.Contains(detail, e.match) {
			return e.code, detail
		}
	}
	return "generic", detail
}

// YtDlpVersion returns the installed yt-dlp version, or "" if it can't run.
// Cached: the standalone binary unpacks itself on every run, so --version takes ~2s.
func (c *Controller) YtDlpVersion() string {
	c.versionMu.Lock()
	defer c.versionMu.Unlock()
	if c.version == "" {
		if out, err := exec.Command(c.cfg.YtDlp, "--version").Output(); err == nil {
			c.version = strings.TrimSpace(string(out))
		}
	}
	return c.version
}

var (
	ErrUpdating    = models.UserErr("update_running", "An update is already running", nil)
	ErrDownloading = models.UserErr("update_busy", "Wait for the running downloads to finish before updating yt-dlp", nil)
)

// UpdateYtDlp runs yt-dlp's self-updater on the given channel ("stable" or "nightly").
// It only works for the standalone binary (the Docker images); pip installs refuse with a message.
func (c *Controller) UpdateYtDlp(channel string) (output string, err error) {
	if !c.updateMu.TryLock() {
		return "", ErrUpdating
	}
	defer c.updateMu.Unlock()
	c.mu.Lock()
	busy := false
	for _, j := range c.jobs {
		busy = busy || j.Active()
	}
	c.mu.Unlock()
	if busy {
		return "", ErrDownloading
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	out, err := exec.CommandContext(ctx, c.cfg.YtDlp, "--update-to", channel).CombinedOutput()
	c.versionMu.Lock()
	c.version = ""
	c.versionMu.Unlock()
	return strings.TrimSpace(string(out)), err
}
