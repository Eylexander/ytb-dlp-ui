package controller

import (
	"archive/zip"
	"bytes"
	"errors"
	"eylexander/ytdlp-ui/backend/src/models"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestBuildArgs(t *testing.T) {
	o := models.Options{Quality: "720", Subtitles: true}
	if err := o.Normalize(); err != nil {
		t.Fatal(err)
	}
	args := BuildArgs(o, "/d", "https://x.test/v")
	joined := strings.Join(args, " ")
	for _, want := range []string{"-S res:720,ext:mp4:m4a", "--merge-output-format mp4", "--sub-langs en.*", "-P /d"} {
		if !strings.Contains(joined, want) {
			t.Errorf("missing %q in %s", want, joined)
		}
	}
	if !slices.Equal(args[len(args)-2:], []string{"--", "https://x.test/v"}) {
		t.Errorf("URL must follow --, got %v", args[len(args)-2:])
	}

	a := models.Options{Mode: "audio", AudioFormat: "opus"}
	if err := a.Normalize(); err != nil {
		t.Fatal(err)
	}
	joined = strings.Join(BuildArgs(a, "/d", "u"), " ")
	if !strings.Contains(joined, "-x --audio-quality 0 --audio-format opus") || strings.Contains(joined, "merge-output") {
		t.Errorf("bad audio args: %s", joined)
	}

	for _, bad := range []models.Options{{Mode: "x"}, {Quality: "999"}, {SubLangs: "en --exec rm"}} {
		if bad.Normalize() == nil {
			t.Errorf("expected %+v to be rejected", bad)
		}
	}
}

func TestClassifyError(t *testing.T) {
	msg, detail := ClassifyError("WARNING: foo\nERROR: [youtube] abc: Private video. Sign in\n")
	if msg != "private" || detail != "ERROR: [youtube] abc: Private video. Sign in" {
		t.Errorf("got %q / %q", msg, detail)
	}
	if msg, _ := ClassifyError("something odd"); msg != "generic" {
		t.Errorf("fallback: got %q", msg)
	}
}

func TestToken(t *testing.T) {
	a := &Controller{cfg: &models.Config{Secret: []byte("k")}}
	tok := a.newToken("me|x", time.Now().Add(time.Hour))
	if u, ok := a.VerifyToken(tok); !ok || u != "me|x" {
		t.Fatalf("valid token rejected: %q %v", u, ok)
	}
	if _, ok := a.VerifyToken(tok + "x"); ok {
		t.Error("tampered token accepted")
	}
	if _, ok := a.VerifyToken(a.newToken("me", time.Now().Add(-time.Second))); ok {
		t.Error("expired token accepted")
	}
	if _, ok := (&Controller{cfg: &models.Config{Secret: []byte("other")}}).VerifyToken(tok); ok {
		t.Error("token signed with another secret accepted")
	}
}

func TestLoginLockout(t *testing.T) {
	c := &Controller{cfg: &models.Config{User: "u", Password: "p", Secret: []byte("k")}, fails: map[string][]time.Time{}}
	if _, _, err := c.Login("u", "p", "1.1.1.1"); err != nil {
		t.Fatalf("valid login failed: %v", err)
	}
	for range maxFails {
		if _, _, err := c.Login("u", "bad", "1.1.1.1"); err != ErrBadCredentials {
			t.Fatalf("want ErrBadCredentials, got %v", err)
		}
	}
	if _, _, err := c.Login("u", "p", "1.1.1.1"); !errors.As(err, new(LockedError)) {
		t.Errorf("want LockedError after %d failures, got %v", maxFails, err)
	}
	if _, _, err := c.Login("u", "p", "2.2.2.2"); err != nil {
		t.Errorf("other IP should not be locked: %v", err)
	}
}

func TestCustomArgs(t *testing.T) {
	o := models.Options{CustomArgs: `--limit-rate 2M --embed-chapters --download-sections "*1:00-2:00" --user-x`}
	var ue *models.UserError
	if err := o.Normalize(); !errors.As(err, &ue) || ue.Code != "arg_not_allowed" || ue.Params["arg"] != "--user-x" {
		t.Fatalf("unknown flag should be rejected, got %v", err)
	}
	o = models.Options{CustomArgs: `-r 2M --embed-chapters --download-sections "*1:00 - 2:00" --audio-quality=5`}
	if err := o.Normalize(); err != nil {
		t.Fatal(err)
	}
	if o.AudioFormat != "best" {
		t.Errorf("audio format should default to best, got %q", o.AudioFormat)
	}
	args := BuildArgs(o, "/d", "https://x.test/v")
	tail := args[len(args)-8:]
	want := []string{"-r", "2M", "--embed-chapters", "--download-sections", "*1:00 - 2:00", "--audio-quality=5", "--", "https://x.test/v"}
	if !slices.Equal(tail, want) {
		t.Errorf("custom args must sit right before --: got %q", tail)
	}

	for _, bad := range []string{
		"--exec 'rm -rf /'", "-o /etc/x", "--exec=id", "--alias x", "--cookies /etc/passwd",
		"https://other.test", "--embed-chapters=1", "--limit-rate", `--user-agent "x`, "--", "-rx",
	} {
		if _, err := models.ParseArgs(bad); err == nil {
			t.Errorf("%q should be rejected", bad)
		}
	}
	// A value that looks like a flag is passed as the value, which is how yt-dlp parses it too.
	if _, err := models.ParseArgs("--add-headers --exec"); err != nil {
		t.Errorf("value starting with - should be accepted as a value: %v", err)
	}
}

func TestWriteZip(t *testing.T) {
	dir := t.TempDir()
	write := func(name, body string) File {
		p := filepath.Join(dir, fmt.Sprint(len(body)), name)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
		return File{Path: p, Name: name}
	}
	files := []File{write("a.mp4", "1"), write("a.mp4", "22"), write("b.mp3", "333"), write("A.mp4", "4444")}

	var buf bytes.Buffer
	if err := WriteZip(&buf, files); err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, f := range zr.File {
		rc, _ := f.Open()
		body, _ := io.ReadAll(rc)
		rc.Close()
		got = append(got, f.Name+"="+string(body))
	}
	want := []string{"a.mp4=1", "a (2).mp4=22", "b.mp3=333", "A (3).mp4=4444"}
	if !slices.Equal(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}
