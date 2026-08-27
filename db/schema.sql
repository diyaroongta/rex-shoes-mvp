-- Factory OS schema. Apply once:  psql "$DATABASE_URL" -f db/schema.sql
-- Safe to re-run.

-- Order numbers come from a sequence, so two clerks saving simultaneously
-- can never be handed the same number.
create sequence if not exists order_no_seq start 2001;
create sequence if not exists pi_no_seq start 1;

create table if not exists orders (
  order_no     text primary key,
  order_date   date        not null,
  article_code text        not null,
  priority     integer     not null default 2 check (priority between 1 and 3),
  party        text        not null,
  lines        jsonb       not null,          -- [{combo, qty, label}]
  pi           jsonb       not null default '{}'::jsonb,
  active       boolean     not null default true,
  version      integer     not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table orders add column if not exists active boolean not null default true;
alter table orders add column if not exists version integer not null default 1;
alter table orders add column if not exists updated_at timestamptz not null default now();
update orders set party='—' where party is null or btrim(party)='';
alter table orders alter column party set not null;
alter table orders drop constraint if exists orders_priority_check;
alter table orders add constraint orders_priority_check check (priority between 1 and 3);

create index if not exists orders_priority_date_idx on orders (priority, order_date, order_no);

-- Issued PI master. Snapshot is deliberately independent of the live order
-- queue so deleting/closing an order never erases its commercial record.
create table if not exists proforma_invoices (
  pi_no      text primary key,
  pi_date    date,
  party      text,
  status     text        not null default 'produced',
  revision   integer     not null default 0,
  snapshot   jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every issued/revised state is immutable. proforma_invoices remains the fast
-- pointer to the latest state; this table is the commercial audit trail.
create table if not exists proforma_invoice_revisions (
  id          bigserial primary key,
  pi_no       text        not null,
  revision    integer     not null,
  status      text        not null,
  snapshot    jsonb       not null,
  recorded_at timestamptz not null default now()
);
create index if not exists proforma_invoice_revisions_pi_idx
  on proforma_invoice_revisions (pi_no, revision, recorded_at desc);

-- A PI can be archived (hidden from the working list, fully recoverable) or
-- permanently deleted. Archiving is the safe default because a PI is a
-- commercial record; deletion is refused while any of its orders carry a
-- recorded dispatch, since that evidence must never be destroyed.
alter table proforma_invoices add column if not exists archived boolean not null default false;
create index if not exists proforma_invoices_archived_idx on proforma_invoices (archived, pi_date desc);

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

-- Immutable snapshots of every BOM, packing, MRP, stock and routing change.
-- A bad upload can therefore be recovered without relying on a browser cache.
create table if not exists reference_data_history (
  revision_id bigserial primary key,
  change_type text        not null,
  article_code text,
  value       jsonb       not null,
  created_at  timestamptz not null default now()
);
create index if not exists reference_data_history_created_idx
  on reference_data_history (created_at desc);

-- Product catalogue: one row per article. Images are stored as resized data
-- URLs, which is fine at this scale; move to Vercel Blob if they get large.
create table if not exists catalogue (
  article_code text primary key,
  image        text,
  description  text,
  price        numeric,
  updated_at   timestamptz not null default now()
);

create table if not exists catalogue_history (
  revision_id bigserial primary key,
  article_code text        not null,
  value        jsonb       not null,
  created_at   timestamptz not null default now()
);
create index if not exists catalogue_history_article_idx
  on catalogue_history (article_code, created_at desc);

-- ---------------------------------------------------------------------------
-- Dispatch / packing reports. One row per dispatch event against an order, so
-- an order can be shipped in several parts. Pending = ordered − dispatched.
create table if not exists dispatches (
  id          serial primary key,
  order_no    text        not null references orders(order_no) on delete cascade,
  dispatched  jsonb       not null,          -- { combo: pairs } actually shipped
  cartons     jsonb,                         -- { combo: cartons } as packed
  kind        text        not null default 'partial'
                check (kind in ('partial','full','shortage')),
  note        text,
  dispatched_on date      not null default current_date,
  created_at  timestamptz not null default now()
);
create index if not exists dispatches_order_idx on dispatches (order_no);

-- A packing report can be mis-keyed, and the pairs have to be recoverable.
-- Removing one therefore moves it here rather than erasing it: the order's
-- pending balance is corrected, and what was recorded is still answerable for.
create table if not exists dispatches_removed (
  id            integer primary key,
  order_no      text        not null,
  dispatched    jsonb       not null,
  cartons       jsonb,
  kind          text,
  note          text,
  dispatched_on date,
  closes_order  boolean     not null default false,
  removed_at    timestamptz not null default now()
);
create index if not exists dispatches_removed_order_idx on dispatches_removed (order_no, removed_at desc);

-- ---------------------------------------------------------------------------
-- Parties (customers) and their commercial terms. Terms are set here and are
-- NOT editable on an individual PI — that is the point: an invoice must not be
-- able to quietly deviate from the agreed discount or payment schedule.
create table if not exists parties (
  name              text primary key,
  city              text,
  discount_pct      numeric not null default 40,
  deductions        jsonb   not null default '[]'::jsonb,   -- [{label, pct}] in order
  gst_pct           numeric not null default 5,
  payment_split_pct numeric not null default 50,
  dispatch_timeline text    not null default '45 days',
  order_nature      text,
  active            boolean not null default true,
  updated_at        timestamptz not null default now()
);

-- Closing an order short: the balance is accepted as never coming, so it stops
-- counting as pending. The shortfall stays recorded rather than being erased —
-- an order closed 40 pairs short must still be answerable for those 40.
alter table dispatches add column if not exists closes_order boolean not null default false;

-- Hard deletion must never erase dispatch evidence. The application archives
-- orders; this RESTRICT guard also protects against an accidental SQL delete.
alter table dispatches drop constraint if exists dispatches_order_no_fkey;
alter table dispatches add constraint dispatches_order_no_fkey
  foreign key (order_no) references orders(order_no) on delete restrict;
