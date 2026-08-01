-- Run this in your Supabase project: SQL Editor > New Query
-- Safe to re-run — uses IF NOT EXISTS / OR REPLACE guards throughout.

-- ============================================================
-- REGISTRATIONS
-- ============================================================
create table if not exists registrations (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text not null,
  course text not null,
  created_at timestamptz default now(),

  -- Payment status fields, kept in sync by the verify-payment function
  -- and the Paystack webhook (both write through the service role key,
  -- so they bypass RLS below).
  paid boolean not null default false,
  payment_status text not null default 'pending', -- pending | success | failed
  payment_reference text,
  payment_date timestamptz,
  payment_amount numeric,
  payment_transaction_id bigint -- Paystack's numeric transaction id
);

-- If `registrations` already existed from an earlier version of this schema
-- (without payment columns), add them now without touching existing data.
alter table registrations add column if not exists paid boolean not null default false;
alter table registrations add column if not exists payment_status text not null default 'pending';
alter table registrations add column if not exists payment_reference text;
alter table registrations add column if not exists payment_date timestamptz;
alter table registrations add column if not exists payment_amount numeric;
alter table registrations add column if not exists payment_transaction_id bigint;

alter table registrations enable row level security;

-- The anon (public) key may only ever INSERT a new registration —
-- never read, update, or delete existing rows. All payment-status
-- writes happen server-side via the service role key in Netlify Functions.
drop policy if exists "Allow public inserts" on registrations;
create policy "Allow public inserts"
on registrations
for insert
to anon
with check (true);

-- ============================================================
-- PAYMENTS  (append-only ledger, one row per transaction attempt)
-- ============================================================
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references registrations(id) on delete cascade,
  reference text not null unique,
  amount numeric not null,
  status text not null default 'pending', -- pending | success | failed
  email text,
  paid_at timestamptz,
  transaction_id bigint, -- Paystack's numeric transaction id
  raw_response jsonb,
  created_at timestamptz default now()
);

-- If `payments` already existed from an earlier version of this schema,
-- add the column now without touching existing data.
alter table payments add column if not exists transaction_id bigint;

create index if not exists payments_registration_id_idx on payments(registration_id);

alter table payments enable row level security;

-- Intentionally NO policies for the anon key: the payments table is
-- written to and read from only by Netlify Functions using the
-- SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS entirely. The public
-- anon key has zero access to this table.

-- ============================================================
-- Viewing data yourself
-- ============================================================
-- Use the Supabase Table Editor / Dashboard (authenticated as you, the
-- project owner) to browse registrations and payments — no additional
-- policy is needed for that access path.
