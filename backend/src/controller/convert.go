package controller

import (
	"errors"
	"path/filepath"
	"strconv"
	"strings"

	"eylexander/ytdlp-ui/backend/src/models"
)

// errSourceGone fails a conversion whose source file was deleted before it started.
var errSourceGone = errors.New("source file is gone")

// ConvertArgs builds the ffmpeg command that turns src (a finished download) into an
// audio file in dir. Progress comes on stdout as key=value lines (see handleFFmpegLine).
func ConvertArgs(o models.Options, src, dir string) []string {
	base := strings.TrimSuffix(filepath.Base(src), filepath.Ext(src))
	args := []string{
		"-nostdin", "-hide_banner", "-loglevel", "error", "-y",
		"-i", src, "-map", "0:a:0", "-progress", "pipe:1", "-nostats",
	}
	codec := map[string]string{"mp3": "libmp3lame", "m4a": "aac", "opus": "libopus", "flac": "flac", "wav": "pcm_s16le"}
	args = append(args, "-c:a", codec[o.AudioFormat])
	if o.AudioFormat == "opus" && o.AudioBitrate == "320" {
		o.AudioBitrate = "256" // libopus refuses more than 256 kbps per channel, so mono sources would fail
	}
	if o.AudioBitrate != "" {
		args = append(args, "-b:a", o.AudioBitrate+"k")
	}
	return append(args, filepath.Join(dir, base+"."+o.AudioFormat))
}

// handleFFmpegLine reads ffmpeg's -progress output: out_time_us, total_size and speed (e.g. "3.2x").
func (c *Controller) handleFFmpegLine(id, line string) {
	key, val, _ := strings.Cut(line, "=")
	n, err := strconv.ParseFloat(strings.TrimSuffix(val, "x"), 64)
	if err != nil {
		return // "N/A" before the first packet
	}
	c.update(id, false, func(j *models.Job) {
		switch {
		case key == "total_size":
			j.Size = int64(n)
		case key == "out_time_us" && j.Duration > 0:
			j.Progress = min(100, n/1e6/j.Duration*100)
		case key == "speed" && n > 0 && j.Duration > 0:
			j.ETA = j.Duration * (100 - j.Progress) / 100 / n
		}
	})
}
