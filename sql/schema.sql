create table if not exists public.employees (
  slug text primary key,
  display_name text not null,
  role text not null check (role in ('manager', 'sales', 'expense'))
);

insert into public.employees (slug, display_name, role) values
  ('svetlana', 'Svetlana de Monte Carlo', 'manager'),
  ('richard', 'Richard Darling', 'sales'),
  ('anastasia', 'Anastasia Ferrari', 'sales'),
  ('jeanclaude', 'Jean-Claude Berzins', 'sales'),
  ('kevin', 'Kevin von Whatever', 'expense')
on conflict (slug) do update set display_name = excluded.display_name, role = excluded.role;

create table if not exists public.telegram_visitors (
  telegram_user_id text primary key,
  chat_id text not null,
  display_name text not null default '',
  seen_at timestamptz not null default now()
);

create table if not exists public.telegram_links (
  telegram_user_id text primary key references public.telegram_visitors(telegram_user_id),
  employee_slug text not null references public.employees(slug),
  chat_id text not null,
  updated_at timestamptz not null default now()
);

create sequence if not exists public.sales_sheet_row_seq start with 2;
create sequence if not exists public.expenses_sheet_row_seq start with 2;

create table if not exists public.transactions (
  ref text primary key,
  kind text not null check (kind in ('sale', 'expense')),
  sheet_row integer not null,
  submitted_at timestamptz not null default now(),
  submitted_by text not null references public.employees(slug),
  source text not null check (source in ('telegram', 'website')),
  origin_chat_id text,
  customer text,
  project text check (project in ('A', 'B')),
  description text not null,
  amount_cents bigint not null check (amount_cents > 0),
  category text check (category in ('Materials', 'Travel', 'Other')),
  proposed_allocation text check (proposed_allocation in ('A', 'B', 'overhead')),
  final_allocation text check (final_allocation in ('A', 'B', 'overhead')),
  proposed_split jsonb,
  final_split jsonb,
  commission_cents jsonb,
  status text not null check (status in ('pending', 'approved', 'awaiting_allocation', 'allocated')),
  revision integer not null default 1,
  decided_at timestamptz,
  sheets_state text not null default 'pending' check (sheets_state in ('pending', 'syncing', 'synced', 'failed')),
  sheets_error text,
  notification_state text not null default 'not_applicable' check (notification_state in ('not_applicable', 'pending', 'sending', 'sent', 'failed', 'no_recipient')),
  notification_error text,
  notification_chat_id text,
  constraint sale_fields check (
    kind <> 'sale' or (customer is not null and project is not null and proposed_split is not null and category is null and proposed_allocation is null)
  ),
  constraint expense_fields check (
    kind <> 'expense' or (category is not null and proposed_allocation is not null and customer is null and project is null and proposed_split is null)
  ),
  unique (kind, sheet_row)
);

create or replace function public.assign_sheet_row() returns trigger language plpgsql as $$
begin
  if new.sheet_row is not null then
    raise exception 'sheet_row is assigned by the database';
  end if;
  new.sheet_row := case when new.kind = 'sale'
    then nextval('public.sales_sheet_row_seq')
    else nextval('public.expenses_sheet_row_seq') end;
  return new;
end;
$$;

drop trigger if exists transactions_assign_sheet_row on public.transactions;
create trigger transactions_assign_sheet_row before insert on public.transactions
for each row execute function public.assign_sheet_row();

create index if not exists transactions_submitter_idx on public.transactions (submitted_by, submitted_at desc);
create index if not exists transactions_status_idx on public.transactions (status, submitted_at desc);
create index if not exists telegram_links_employee_idx on public.telegram_links (employee_slug, updated_at desc);

alter table public.employees enable row level security;
alter table public.telegram_visitors enable row level security;
alter table public.telegram_links enable row level security;
alter table public.transactions enable row level security;
