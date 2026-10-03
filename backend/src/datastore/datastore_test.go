package datastore

import (
	"context"
	"os"
	"testing"
	"time"

	"eylexander/ytdlp-ui/backend/src/models"
)

// Needs a real PostgreSQL, e.g. the dev compose one:
// TEST_DATABASE_URL=postgres://ytdlp:ytdlp@localhost:5433/ytdlp?sslmode=disable go test ./src/datastore
func TestRoundTrip(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	db, err := NewPostgres(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	j := models.Job{ID: "test-" + time.Now().Format("150405.000"), URL: "https://x.test", Status: models.StatusQueued,
		Options: models.Options{Mode: "audio", AudioFormat: "opus"}, CreatedAt: time.Now().Truncate(time.Microsecond)}
	t.Cleanup(func() { _ = db.DeleteDownload(ctx, j.ID) })
	if err := db.SaveDownload(ctx, j); err != nil {
		t.Fatal(err)
	}
	now := time.Now().Truncate(time.Microsecond)
	j.Status, j.Title, j.File, j.FinishedAt = models.StatusDone, "T", "t.opus", &now
	if err := db.SaveDownload(ctx, j); err != nil { // upsert path
		t.Fatal(err)
	}

	got := find(t, db, j.ID)
	if got == nil || got.Status != models.StatusDone || got.Title != "T" || got.Options.AudioFormat != "opus" ||
		got.FinishedAt == nil || !got.FinishedAt.Equal(now) || !got.CreatedAt.Equal(j.CreatedAt) {
		t.Fatalf("round trip mismatch: %+v", got)
	}
	if err := db.DeleteDownload(ctx, j.ID); err != nil {
		t.Fatal(err)
	}
	if find(t, db, j.ID) != nil {
		t.Error("job still present after delete")
	}
}

func find(t *testing.T, db *Postgres, id string) *models.Job {
	jobs, err := db.LoadDownloads(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, j := range jobs {
		if j.ID == id {
			return j
		}
	}
	return nil
}
