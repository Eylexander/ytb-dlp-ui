package models

import (
	"fmt"
	"regexp"
	"slices"
	"time"
)

const (
	StatusQueued     = "queued"
	StatusRunning    = "running"
	StatusProcessing = "processing"
	StatusDone       = "done"
	StatusFailed     = "failed"
	StatusCanceled   = "canceled"
)

// Options are the user-selectable download parameters.
type Options struct {
	Mode           string `json:"mode"`        // video | audio
	Quality        string `json:"quality"`     // best | 2160 | 1440 | 1080 | 720 | 480 | 360
	Container      string `json:"container"`   // mp4 | mkv | webm
	AudioFormat    string `json:"audioFormat"` // best | mp3 | m4a | opus | flac | wav
	Subtitles      bool   `json:"subtitles"`
	SubLangs       string `json:"subLangs"`
	EmbedThumbnail bool   `json:"embedThumbnail"`
	EmbedMetadata  bool   `json:"embedMetadata"`
	SponsorBlock   bool   `json:"sponsorBlock"`
	CustomArgs     string `json:"customArgs,omitempty"` // validated by ParseArgs
	// ConvertFrom is a job ID: instead of downloading, ffmpeg converts that job's file to audio.
	ConvertFrom  string `json:"convertFrom,omitempty"`
	AudioBitrate string `json:"audioBitrate,omitempty"` // kbps for lossy conversions: 96 | 128 | 192 | 256 | 320
}

var (
	subLangsRe = regexp.MustCompile(`^[A-Za-z0-9.*,_-]{1,100}$`)
	jobIDRe    = regexp.MustCompile(`^[0-9a-f]{12}$`)
)

// Normalize fills defaults and rejects anything outside the allowlists.
func (o *Options) Normalize() error {
	def := func(s *string, d string) {
		if *s == "" {
			*s = d
		}
	}
	def(&o.Mode, "video")
	def(&o.Quality, "best")
	def(&o.Container, "mp4")
	def(&o.AudioFormat, "best")
	def(&o.SubLangs, "en.*")
	switch {
	case !slices.Contains([]string{"video", "audio"}, o.Mode):
		return fmt.Errorf("unknown mode %q", o.Mode)
	case !slices.Contains([]string{"best", "2160", "1440", "1080", "720", "480", "360"}, o.Quality):
		return fmt.Errorf("unknown quality %q", o.Quality)
	case !slices.Contains([]string{"mp4", "mkv", "webm"}, o.Container):
		return fmt.Errorf("unknown container %q", o.Container)
	case !slices.Contains([]string{"best", "mp3", "m4a", "opus", "flac", "wav"}, o.AudioFormat):
		return fmt.Errorf("unknown audio format %q", o.AudioFormat)
	case !subLangsRe.MatchString(o.SubLangs):
		return UserErr("invalid_sub_langs", fmt.Sprintf("invalid subtitle languages %q (example: en.*,fr)", o.SubLangs), map[string]any{"value": o.SubLangs})
	}
	if o.ConvertFrom == "" {
		o.AudioBitrate = ""
		_, err := ParseArgs(o.CustomArgs)
		return err
	}
	// Conversions only use the audio format and bitrate; drop the rest so it isn't shown or stored.
	o.CustomArgs, o.Subtitles, o.SponsorBlock, o.EmbedThumbnail, o.EmbedMetadata = "", false, false, false, false
	if o.AudioFormat == "flac" || o.AudioFormat == "wav" {
		o.AudioBitrate = "" // lossless
	} else {
		def(&o.AudioBitrate, "320")
	}
	switch {
	case !jobIDRe.MatchString(o.ConvertFrom):
		return fmt.Errorf("invalid source %q", o.ConvertFrom)
	case o.Mode != "audio" || o.AudioFormat == "best":
		return fmt.Errorf("a conversion needs an audio format")
	case o.AudioBitrate != "" && !slices.Contains([]string{"96", "128", "192", "256", "320"}, o.AudioBitrate):
		return fmt.Errorf("unknown bitrate %q", o.AudioBitrate)
	}
	return nil
}

type Job struct {
	ID          string     `json:"id"`
	URL         string     `json:"url"`
	Options     Options    `json:"options"`
	Status      string     `json:"status"`
	Title       string     `json:"title,omitempty"`
	Thumbnail   string     `json:"thumbnail,omitempty"`
	Uploader    string     `json:"uploader,omitempty"`
	Duration    float64    `json:"duration,omitempty"`
	Progress    float64    `json:"progress"`
	Speed       float64    `json:"speed,omitempty"`
	ETA         float64    `json:"eta,omitempty"`
	Size        int64      `json:"size,omitempty"`
	File        string     `json:"file,omitempty"`
	Error       string     `json:"error,omitempty"`
	ErrorDetail string     `json:"errorDetail,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
	FinishedAt  *time.Time `json:"finishedAt,omitempty"`
}

func (j *Job) Active() bool {
	return j.Status == StatusQueued || j.Status == StatusRunning || j.Status == StatusProcessing
}
