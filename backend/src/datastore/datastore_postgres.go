package datastore

import (
	"context"
	"fmt"

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

-- The single login. The CHECK keeps it to one row.
CREATE TABLE IF NOT EXISTS account (
	id            SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
	username      TEXT NOT NULL,
	password_hash TEXT NOT NULL
);
`

type PostgresDatastore struct {
	pool *pgxpool.Pool
}

// NewPostgresDatastore connects and creates the schema if needed.
func NewPostgresDatastore(ctx context.Context, url string) (*PostgresDatastore, error) {
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
	return &PostgresDatastore{pool: pool}, nil
}

func (ds *PostgresDatastore) Close() { ds.pool.Close() }
