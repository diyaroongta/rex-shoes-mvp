-- Daily shop-floor actuals. Safe to re-run.
create table if not exists production_logs (
  id                bigserial primary key,
  production_on     date        not null,
  shift             text        not null,
  work_center       text        not null,
  order_no          text        not null,
  article           text        not null,
  stage             text        not null,
  good_pairs        integer     not null default 0 check (good_pairs >= 0),
  rejected_pairs    integer     not null default 0 check (rejected_pairs >= 0),
  downtime_minutes  integer     not null default 0 check (downtime_minutes between 0 and 1440),
  downtime_reason   text,
  supervisor        text,
  note              text,
  import_key        text,
  created_by        text,
  created_at        timestamptz not null default now(),
  voided_by         text,
  voided_at         timestamptz
);
create index if not exists production_logs_day_idx
  on production_logs (production_on desc, work_center, shift);
create index if not exists production_logs_order_idx
  on production_logs (order_no, production_on desc);
alter table production_logs add column if not exists import_key text;
create unique index if not exists production_logs_import_key_idx
  on production_logs (import_key) where import_key is not null;
