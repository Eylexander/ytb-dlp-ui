package test

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/pbkdf2"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"eylexander/ytdlp-ui/backend/src/controller"
	"eylexander/ytdlp-ui/backend/src/models"
)

func TestBuildArgs(t *testing.T) {
	o := models.Options{Quality: "720", Subtitles: true}
	if err := o.Normalize(); err != nil {
		t.Fatal(err)
	}
	args := controller.BuildArgs(o, "/d", "https://x.test/v")
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
	joined = strings.Join(controller.BuildArgs(a, "/d", "u"), " ")
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
	msg, detail := controller.ClassifyError("WARNING: foo\nERROR: [youtube] abc: Private video. Sign in\n")
	if msg != "private" || detail != "ERROR: [youtube] abc: Private video. Sign in" {
		t.Errorf("got %q / %q", msg, detail)
	}
	if msg, _ := controller.ClassifyError("something odd"); msg != "generic" {
		t.Errorf("fallback: got %q", msg)
	}
}

// noStore stands in for PostgreSQL so a Controller can be built without a database.
type noStore struct{}

func (noStore) Close()                                              {}
func (noStore) GetDownloads(context.Context) ([]*models.Job, error) { return nil, nil }
func (noStore) SaveDownload(context.Context, models.Job) error      { return nil }
func (noStore) DeleteDownload(context.Context, string) error        { return nil }
func (noStore) GetAccount(context.Context) (*models.Account, error) {
	// User "u", password "p", hashed with 1 iteration so tests stay fast (same format as
	// controller.hashPassword, which stores the iteration count in the hash).
	salt := []byte("salt")
	key, _ := pbkdf2.Key(sha256.New, "p", salt, 1, 32)
	enc := base64.RawStdEncoding.EncodeToString
	return &models.Account{Username: "u", PasswordHash: "pbkdf2-sha256$1$" + enc(salt) + "$" + enc(key)}, nil
}
func (noStore) SaveAccount(context.Context, models.Account) error { return nil }

func newController(t *testing.T, secret string) *controller.Controller {
	cfg := &models.Config{Secret: []byte(secret), DataDir: t.TempDir(), MaxConcurrent: 1}
	c, err := controller.NewController(cfg, noStore{})
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestToken(t *testing.T) {
	a := newController(t, "k")
	tok, _, err := a.Login("u", "p", "1.1.1.1")
	if err != nil {
		t.Fatal(err)
	}
	if u, ok := a.VerifyToken(tok); !ok || u != "u" {
		t.Fatalf("valid token rejected: %q %v", u, ok)
	}
	if _, ok := a.VerifyToken(tok + "x"); ok {
		t.Error("tampered token accepted")
	}
	if _, ok := newController(t, "other").VerifyToken(tok); ok {
		t.Error("token signed with another secret accepted")
	}
}

func TestUpdateAccount(t *testing.T) {
	c := newController(t, "k")
	old, _, err := c.Login("u", "p", "ip")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := c.UpdateAccount("ip", "nope", "v", "newpassword"); err != controller.ErrWrongPassword {
		t.Fatalf("want ErrWrongPassword, got %v", err)
	}
	var ue *models.UserError
	if _, _, err := c.UpdateAccount("ip", "p", "v", "short"); !errors.As(err, &ue) || ue.Code != "password_too_short" {
		t.Fatalf("want password_too_short, got %v", err)
	}
	tok, _, err := c.UpdateAccount("ip", "p", " v ", "newpassword")
	if err != nil {
		t.Fatal(err)
	}
	if u, ok := c.VerifyToken(tok); !ok || u != "v" {
		t.Errorf("new token rejected: %q %v", u, ok)
	}
	if _, ok := c.VerifyToken(old); ok {
		t.Error("session from before the change still valid")
	}
	if _, _, err := c.Login("u", "p", "ip"); err != controller.ErrBadCredentials {
		t.Errorf("old credentials should fail, got %v", err)
	}
	if _, _, err := c.Login("v", "newpassword", "ip"); err != nil {
		t.Errorf("new credentials rejected: %v", err)
	}
}

func TestLoginLockout(t *testing.T) {
	const maxFails = 5 // controller.maxFails
	c := newController(t, "k")
	if _, _, err := c.Login("u", "p", "1.1.1.1"); err != nil {
		t.Fatalf("valid login failed: %v", err)
	}
	for range maxFails {
		if _, _, err := c.Login("u", "bad", "1.1.1.1"); err != controller.ErrBadCredentials {
			t.Fatalf("want ErrBadCredentials, got %v", err)
		}
	}
	var ue *models.UserError
	if _, _, err := c.Login("u", "p", "1.1.1.1"); !errors.As(err, &ue) || ue.Code != "too_many_attempts" {
		t.Errorf("want too_many_attempts after %d failures, got %v", maxFails, err)
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
	args := controller.BuildArgs(o, "/d", "https://x.test/v")
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
	write := func(name, body string) controller.File {
		p := filepath.Join(dir, fmt.Sprint(len(body)), name)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
		return controller.File{Path: p, Name: name}
	}
	files := []controller.File{write("a.mp4", "1"), write("a.mp4", "22"), write("b.mp3", "333"), write("A.mp4", "4444")}

	var buf bytes.Buffer
	if err := controller.WriteZip(&buf, files); err != nil {
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

func TestConvert(t *testing.T) {
	for _, bad := range []models.Options{
		{Mode: "audio", AudioFormat: "mp3", ConvertFrom: "../etc"},
		{Mode: "audio", AudioFormat: "best", ConvertFrom: "0123456789ab"},
		{Mode: "video", AudioFormat: "mp3", ConvertFrom: "0123456789ab"},
		{Mode: "audio", AudioFormat: "mp3", AudioBitrate: "999", ConvertFrom: "0123456789ab"},
	} {
		if bad.Normalize() == nil {
			t.Errorf("expected %+v to be rejected", bad)
		}
	}
	o := models.Options{Mode: "audio", AudioFormat: "flac", AudioBitrate: "320", CustomArgs: "--exec x", ConvertFrom: "0123456789ab"}
	if err := o.Normalize(); err != nil || o.AudioBitrate != "" || o.CustomArgs != "" {
		t.Fatalf("lossless must drop bitrate and custom args: %+v, %v", o, err)
	}

	// With ffmpeg installed, run real conversions through the controller.
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed")
	}
	data := t.TempDir()
	srcDir := filepath.Join(data, "downloads", "0123456789ab")
	if err := os.MkdirAll(srcDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command("ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=d=1:s=64x64", "-f", "lavfi", "-i", "sine=d=1",
		"-shortest", filepath.Join(srcDir, "clip.mp4")).CombinedOutput(); err != nil {
		t.Fatalf("making the test clip: %v %s", err, out)
	}
	src := &models.Job{ID: "0123456789ab", URL: "https://x.test/v", Status: models.StatusDone, File: "clip.mp4", Title: "Clip", Duration: 1, Size: 1}
	c, err := controller.NewController(&models.Config{Secret: []byte("k"), DataDir: data, MaxConcurrent: 2}, oneJobStore{job: src})
	if err != nil {
		t.Fatal(err)
	}
	if info, _ := os.Stat(filepath.Join(srcDir, "clip.mp4")); c.List()[0].Size != info.Size() {
		t.Errorf("startup must fix a done job's size from its file: got %d, want %d", c.List()[0].Size, info.Size())
	}
	ids := map[string]string{}
	for _, f := range []string{"mp3", "m4a", "opus", "flac", "wav"} {
		j, err := c.Create(src.URL, models.Options{Mode: "audio", AudioFormat: f, ConvertFrom: src.ID})
		if err != nil {
			t.Fatal(err)
		}
		ids[j.ID] = f
	}
	if _, err := c.Create(src.URL, models.Options{Mode: "audio", AudioFormat: "mp3", ConvertFrom: "ba9876543210"}); err == nil {
		t.Error("converting a missing job must fail")
	}
	deadline := time.Now().Add(20 * time.Second)
	for _, j := range c.List() {
		f, ok := ids[j.ID]
		if !ok {
			continue
		}
		for ; j.Active() && time.Now().Before(deadline); time.Sleep(50 * time.Millisecond) {
			for _, k := range c.List() {
				if k.ID == j.ID {
					j = k
				}
			}
		}
		if j.Status != models.StatusDone || j.File != "clip."+f || j.Title != "Clip" || j.Size == 0 {
			t.Errorf("%s: %+v", f, j)
		}
	}
}

// oneJobStore is a noStore that starts with one saved job.
type oneJobStore struct {
	noStore
	job *models.Job
}

func (s oneJobStore) GetDownloads(context.Context) ([]*models.Job, error) {
	return []*models.Job{s.job}, nil
}
