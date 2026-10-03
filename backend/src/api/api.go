package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"os/exec"
	"syscall"

	"eylexander/ytdlp-ui/backend/src/controller"
	"eylexander/ytdlp-ui/backend/src/models"
)

const cookieName = "ytdlp_session"

type API struct {
	cfg  *models.Config
	ctrl *controller.Controller
}

func NewAPI(cfg *models.Config, ctrl *controller.Controller) *API {
	return &API{cfg: cfg, ctrl: ctrl}
}

// Health reports whether the tools downloads depend on are installed.
func (a *API) Health(w http.ResponseWriter, r *http.Request) {
	_, ffErr := exec.LookPath("ffmpeg")
	_, denoErr := exec.LookPath("deno")
	var disk syscall.Statfs_t
	_ = syscall.Statfs(a.cfg.DataDir, &disk) // stays zero on error: the UI then hides the disk info
	writeJSON(w, http.StatusOK, map[string]any{
		"diskFree":    disk.Bavail * uint64(disk.Bsize),
		"diskTotal":   disk.Blocks * uint64(disk.Bsize),
		"ytdlp":       a.ctrl.YtDlpVersion(),
		"ffmpeg":      ffErr == nil,
		"deno":        denoErr == nil,
		"allowedArgs": models.AllowedArgs(),
	})
}

func (a *API) UpdateYtDlp(w http.ResponseWriter, r *http.Request) {
	var body struct{ Channel string }
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&body); err != nil ||
		(body.Channel != "stable" && body.Channel != "nightly") {
		writeErr(w, http.StatusBadRequest, models.UserErr("invalid_channel", "Channel must be stable or nightly", nil))
		return
	}
	out, err := a.ctrl.UpdateYtDlp(body.Channel)
	switch {
	case errors.Is(err, controller.ErrUpdating), errors.Is(err, controller.ErrDownloading):
		writeErr(w, http.StatusConflict, err)
	case err != nil:
		writeJSON(w, http.StatusBadGateway, map[string]string{"code": "update_failed", "error": "The update failed. See the output below.", "output": out})
	default:
		writeJSON(w, http.StatusOK, map[string]string{"output": out, "version": a.ctrl.YtDlpVersion()})
	}
}

func NotFound(w http.ResponseWriter, r *http.Request) {
	writeErr(w, http.StatusNotFound, models.UserErr("unknown_endpoint", "Unknown API endpoint", nil))
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// writeErr sends {"error": english, "code": ..., "params": ...}. The frontend translates code
// (messages "apiErrors") and falls back to the English text for plain errors.
func writeErr(w http.ResponseWriter, status int, err error) {
	body := map[string]any{"error": err.Error()}
	var ue *models.UserError
	if errors.As(err, &ue) {
		body["code"], body["params"] = ue.Code, ue.Params
	}
	writeJSON(w, status, body)
}

var errInvalidRequest = models.UserErr("invalid_request", "Invalid request", nil)
