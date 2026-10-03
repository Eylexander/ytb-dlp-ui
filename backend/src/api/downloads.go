package api

import (
	"encoding/json"
	"log"
	"mime"
	"net/http"
	"os"
	"strings"
	"time"

	"eylexander/ytdlp-ui/backend/src/controller"
	"eylexander/ytdlp-ui/backend/src/models"
)

func (a *API) ListDownloads(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, a.ctrl.List())
}

func (a *API) CreateDownload(w http.ResponseWriter, r *http.Request) {
	var body struct {
		URL     string         `json:"url"`
		Options models.Options `json:"options"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, errInvalidRequest)
		return
	}
	job, err := a.ctrl.Create(body.URL, body.Options)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, job)
}

func (a *API) CancelDownload(w http.ResponseWriter, r *http.Request) {
	if !a.ctrl.Cancel(r.PathValue("id")) {
		writeErr(w, http.StatusConflict, models.UserErr("not_running", "This download isn't running anymore", nil))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) DeleteDownload(w http.ResponseWriter, r *http.Request) {
	found, err := a.ctrl.Delete(r.PathValue("id"))
	switch {
	case !found:
		writeErr(w, http.StatusNotFound, models.UserErr("not_found", "Download not found", nil))
	case err != nil:
		writeErr(w, http.StatusInternalServerError, models.UserErr("delete_failed", "Deleting failed: "+err.Error(), map[string]any{"detail": err.Error()}))
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

func (a *API) DownloadFile(w http.ResponseWriter, r *http.Request) {
	path, name, ok := a.ctrl.File(r.PathValue("id"))
	if !ok {
		writeErr(w, http.StatusNotFound, models.UserErr("file_unavailable", "This file isn't available", nil))
		return
	}
	if _, err := os.Stat(path); err != nil {
		writeErr(w, http.StatusGone, models.UserErr("file_gone", "The file is no longer on the server", nil))
		return
	}
	if r.URL.Query().Has("download") {
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
	}
	http.ServeFile(w, r, path) // handles Range requests, so seeking works in the player
}

// Thumbnail serves the locally cached image, falling back to the original URL.
func (a *API) Thumbnail(w http.ResponseWriter, r *http.Request) {
	path, remote, ok := a.ctrl.Thumbnail(r.PathValue("id"))
	switch {
	case !ok:
		writeErr(w, http.StatusNotFound, models.UserErr("no_thumbnail", "No thumbnail", nil))
	case path == "":
		http.Redirect(w, r, remote, http.StatusFound)
	default:
		// A job's thumbnail never changes: let the browser keep it.
		w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
		http.ServeFile(w, r, path)
	}
}

// DownloadArchive streams the finished files of ?ids=a,b,c as one zip.
// ponytail: ids travel in the URL (so a plain link triggers the browser's download), which caps
// a request at roughly 600 items behind nginx's default 8k header buffer; switch to a POST form if that's hit.
func (a *API) DownloadArchive(w http.ResponseWriter, r *http.Request) {
	files := a.ctrl.Files(strings.Split(r.URL.Query().Get("ids"), ","))
	if len(files) == 0 {
		writeErr(w, http.StatusNotFound, models.UserErr("nothing_to_save", "None of the selected downloads has a file to save", nil))
		return
	}
	name := "ytdlp-ui-" + time.Now().Format("2006-01-02-150405") + ".zip"
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
	if err := controller.WriteZip(w, files); err != nil {
		// Headers are already sent, so the browser just sees a failed download.
		log.Printf("zip archive: %v", err)
	}
}
