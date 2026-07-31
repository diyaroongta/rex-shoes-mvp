-- Factory OS schema. Apply once:  psql "$DATABASE_URL" -f db/schema.sql
-- Safe to re-run.

-- Order numbers come from a sequence, so two clerks saving simultaneously
-- can never be handed the same number.
create sequence if not exists order_no_seq start 2001;

create table if not exists orders (
  order_no     text primary key,
  order_date   date        not null,
  article_code text        not null,
  priority     integer     not null default 2 check (priority >= 1),
  party        text,
  lines        jsonb       not null,          -- [{combo, qty, label}]
  pi           jsonb       not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists orders_priority_date_idx on orders (priority, order_date, order_no);

-- Shared config: machine capacities. One row, id = 1.
-- These are shared factory settings, not per-browser preferences.
create table if not exists settings (
  id         integer primary key,
  value      jsonb       not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Reference data (articles, combos, rates, materials, packing, work centres).
-- Stored as one JSON document because that is the exact shape the planner
-- consumes. Uploading a BOM writes here — no code change, no deploy.
-- If this table is empty the app falls back to the bundled shared/inputs.js
-- and seeds itself from it on first load.
create table if not exists reference_data (
  id         integer primary key,
  value      jsonb       not null,
  updated_at timestamptz not null default now()
);

-- Product catalogue: one row per article. Images are stored as resized data
-- URLs, which is fine at this scale; move to Vercel Blob if they get large.
create table if not exists catalogue (
  article_code text primary key,
  image        text,
  description  text,
  price        numeric,
  updated_at   timestamptz not null default now()
);
