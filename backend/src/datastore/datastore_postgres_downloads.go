package datastore

import (
	"context"

	"eylexander/ytdlp-ui/backend/src/models"

	"github.com/jackc/pgx/v5"
)

const columns = `id, url, options, status, title, thumbnail, uploader, duration, progress, size, file, error, error_detail, created_at, finished_at`

func (ds *PostgresDatastore) GetDownloads(ctx context.Context) ([]*models.Job, error) {
	rows, err := ds.pool.Query(ctx, `SELECT `+columns+` FROM downloads`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (*models.Job, error) {
		var j models.Job
		err := row.Scan(&j.ID, &j.URL, &j.Options, &j.Status, &j.Title, &j.Thumbnail, &j.Uploader,
			&j.Duration, &j.Progress, &j.Size, &j.File, &j.Error, &j.ErrorDetail, &j.CreatedAt, &j.FinishedAt)
		return &j, err
	})
}

// SaveDownload inserts or fully updates one job.
func (ds *PostgresDatastore) SaveDownload(ctx context.Context, j models.Job) error {
	_, err := ds.pool.Exec(ctx, `
		INSERT INTO downloads (`+columns+`)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
		ON CONFLICT (id) DO UPDATE SET
			status = EXCLUDED.status, title = EXCLUDED.title, thumbnail = EXCLUDED.thumbnail,
			uploader = EXCLUDED.uploader, duration = EXCLUDED.duration, progress = EXCLUDED.progress,
			size = EXCLUDED.size, file = EXCLUDED.file, error = EXCLUDED.error,
			error_detail = EXCLUDED.error_detail, finished_at = EXCLUDED.finished_at`,
		j.ID, j.URL, j.Options, j.Status, j.Title, j.Thumbnail, j.Uploader,
		j.Duration, j.Progress, j.Size, j.File, j.Error, j.ErrorDetail, j.CreatedAt, j.FinishedAt)
	return err
}

func (ds *PostgresDatastore) DeleteDownload(ctx context.Context, id string) error {
	_, err := ds.pool.Exec(ctx, `DELETE FROM downloads WHERE id = $1`, id)
	return err
}
