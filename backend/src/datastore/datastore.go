package datastore

import (
	"context"
	"fmt"
	"time"

	"eylexander/ytdlp-ui/backend/src/models"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Speed and ETA are live-only and never stored; options are JSONB so new download
// parameters need no migration.
const schema = `
CREATE TABLE IF NOT EXISTS downloads (
	id           TEXT PRIMARY KEY,
	url          TEXT NOT NULL,
	options      JSONB NOT NULL,
	status       TEXT NOT NULL,
	title        TEXT NOT NULL DEFAULT '',
	thumbnail    TEXT NOT NULL DEFAULT '',
	uploader     TEXT NOT NULL DEFAULT '',
	duration     DOUBLE PRECISION NOT NULL DEFAULT 0,
	progress     DOUBLE PRECISION NOT NULL DEFAULT 0,
	size         BIGINT NOT NULL DEFAULT 0,
	file         TEXT NOT NULL DEFAULT '',
	error        TEXT NOT NULL DEFAULT '',
	error_detail TEXT NOT NULL DEFAULT '',
	created_at   TIMESTAMPTZ NOT NULL,
	finished_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS downloads_created_at_idx ON downloads (created_at DESC);
`

const columns = `id, url, options, status, title, thumbnail, uploader, duration, progress, size, file, error, error_detail, created_at, finished_at`

type Postgres struct {
	pool *pgxpool.Pool
}

// NewPostgres connects and creates the schema if needed.
func NewPostgres(ctx context.Context, url string) (*Postgres, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("invalid DATABASE_URL: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("can't reach PostgreSQL: %w", err)
	}
	if _, err := pool.Exec(ctx, schema); err != nil {
		pool.Close()
		return nil, fmt.Errorf("creating schema: %w", err)
	}
	return &Postgres{pool: pool}, nil
}

func (p *Postgres) Close() { p.pool.Close() }

func (p *Postgres) LoadDownloads(ctx context.Context) ([]*models.Job, error) {
	rows, err := p.pool.Query(ctx, `SELECT `+columns+` FROM downloads ORDER BY created_at DESC`)
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
func (p *Postgres) SaveDownload(ctx context.Context, j models.Job) error {
	_, err := p.pool.Exec(ctx, `
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

func (p *Postgres) DeleteDownload(ctx context.Context, id string) error {
	_, err := p.pool.Exec(ctx, `DELETE FROM downloads WHERE id = $1`, id)
	return err
}

// Timeout bounds every query issued by the controller.
const Timeout = 5 * time.Second
