begin;

create sequence if not exists pi_no_seq start 1;

alter table orders add column if not exists active boolean not null default true;
alter table orders add column if not exists version integer not null default 1;
alter table orders add column if not exists updated_at timestamptz not null default now();
update orders set party='—' where party is null or btrim(party)='';
alter table orders alter column party set not null;
alter table orders drop constraint if exists orders_priority_check;
alter table orders add constraint orders_priority_check check (priority between 1 and 3);

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

alter table dispatches add column if not exists closes_order boolean not null default false;
alter table dispatches drop constraint if exists dispatches_order_no_fkey;
alter table dispatches add constraint dispatches_order_no_fkey
  foreign key (order_no) references orders(order_no) on delete restrict;

create table if not exists schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);
insert into schema_migrations(version) values ('001_integrity_and_pi_history')
on conflict (version) do nothing;

commit;
