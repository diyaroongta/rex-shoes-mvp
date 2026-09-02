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

-- Manual planning overrides for this order: an explicit queue position, a
-- pinned start date, a forced work centre per stage, a forced duration per
-- stage. The planner obeys all of them and reports what each one cost; see
-- shared/engine.js. Empty {} means "plan this automatically".
alter table orders add column if not exists plan_override jsonb not null default '{}'::jsonb;

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

-- ---------------------------------------------------------------------------
-- Accounts. Until now the portal had none: anyone with the URL could read and
-- edit every order. One row per person — the plan is several, each with a role,
-- so `role` is here from the start even while only 'admin' is issued.
--
-- Passwords are stored as scrypt hashes written by api/_lib/auth.js. There is
-- no plaintext password anywhere in this schema, this repo, or the environment
-- variables; accounts are created with: node scripts/create-user.mjs <username>
create table if not exists users (
  username       text primary key,               -- stored lower-case; compared lower-case
  password_hash  text        not null,           -- scrypt$N$r$p$salt$hash
  display_name   text,
  role           text        not null default 'admin',
  active         boolean     not null default true,
  -- Brute force against a single shared password on a public URL is the
  -- realistic attack here, so failures are counted and the account is held
  -- shut for a few minutes rather than being guessable at machine speed.
  failed_attempts integer    not null default 0,
  locked_until   timestamptz,
  last_login_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- The packing list as the packer counted it: per SIZE, with COUNTED cartons.
-- Kept beside `dispatched` rather than replacing it: `dispatched` is per size
-- range and drives the pending balance and the ledger, which is arithmetic the
-- app must keep doing. This is the document that travels with the lorry, and
-- its pairs must reconcile with `dispatched`.
alter table dispatches add column if not exists packing_list jsonb;

-- ---------------------------------------------------------------------------
-- Fabricators: who work can be sent to. The factory's own stitching lines and
-- outside job workers live in ONE table separated by `type`, so the job work
-- issue screen has a single "who is doing this" dropdown rather than two.
--
-- What each type requires differs and is enforced in shared/fabricators.js:
-- an internal line has no rate and is never payable; an external fabricator
-- must have a rate and a contact; a sample fabricator takes a flat charge.
create table if not exists fabricators (
  name           text primary key,
  type           text        not null check (type in ('internal_line','external','sample')),
  rate           numeric     not null default 0,      -- per piece, or flat for a sample
  tat_days       integer     not null default 0,      -- turnaround
  contact_person text,
  contact_phone  text,
  payable        boolean     not null default false,
  -- Deactivating must never erase history: a past job card has to keep making
  -- sense, so an inactive fabricator stays in the list and simply takes no new
  -- work. There is deliberately no delete.
  active         boolean     not null default true,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists fabricators_type_idx on fabricators (active, type, name);

-- ---------------------------------------------------------------------------
-- Job work: what has been sent out to a line or a fabricator, and what has
-- come back. ONE table for both, because the movement is identical — only the
-- slip it prints and whether it is payable differ, and both follow from the
-- fabricator's type (see shared/job-work.js).
--
-- `received` is cumulative: a partial return is normal, and the balance is
-- still OUT rather than short. `shortage` is only written when the job is
-- closed, at which point the balance is accepted as never coming back.
create table if not exists job_work (
  id              bigserial primary key,
  fabricator      text        not null references fabricators(name),
  fabricator_type text        not null,
  article         text        not null,
  stage           text        not null default 'STITCHING',
  order_no        text,                                   -- the production order, when it came from one
  qty             integer     not null check (qty > 0),   -- pieces issued
  received        integer     not null default 0,
  shortage        integer     not null default 0,
  status          text        not null default 'issued'
                    check (status in ('issued','partial','closed')),
  slip            text,                                   -- Job Work Challan / Internal Issue Slip
  sample          boolean     not null default false,
  sample_status   text        check (sample_status in ('pending','approved','rejected','revision')),
  rate            numeric     not null default 0,         -- snapshotted, so a later rate change
  payable         boolean     not null default false,     -- cannot rewrite a settled job
  note            text,
  issued_on       date        not null default current_date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists job_work_open_idx on job_work (status, fabricator, issued_on desc);

-- Hiding a dispatch is NOT undoing it. The goods really did ship, so the pairs
-- must keep counting against the order — the row is only taken off the history
-- list. Undoing (see dispatches_removed) is the other thing entirely: it says
-- the report was mis-keyed and puts the pairs back into pending.
alter table dispatches add column if not exists hidden boolean not null default false;

-- Roles are validated in shared/permissions.js, not by a CHECK constraint. The
-- constraint listed three roles; adding an Owner/Director or a Dispatch
-- Executive then meant a schema migration to hand somebody a login, and an
-- account whose role the app does not recognise is refused everything anyway.
alter table users drop constraint if exists users_role_check;
