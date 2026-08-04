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
  work_status text not null,
  education text not null,
  state_of_residence text not null,
  date_of_birth date not null,
  aware_of_beginner_course text not null default 'Yes', -- 'Yes' | 'No'
  interested_in_volunteering text not null default 'Yes', -- 'Yes' | 'No'
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

-- Profile fields added for the expanded registration form. Existing rows
-- get sensible defaults so the NOT NULL constraints below don't fail on
-- historical data; new registrations always submit real values.
alter table registrations add column if not exists work_status text not null default 'Not specified';
alter table registrations add column if not exists education text not null default 'Not specified';
alter table registrations add column if not exists aware_of_beginner_course text not null default 'Yes';
alter table registrations add column if not exists interested_in_volunteering text not null default 'Yes';

-- State of residence and date of birth, added for the expanded
-- registration form. Existing rows get a safe backfill so the NOT NULL
-- constraints don't fail on historical data; new registrations always
-- submit real values (date_of_birth has no meaningful "default", so
-- historical rows are backfilled with a clearly-placeholder date rather
-- than guessing).
alter table registrations add column if not exists state_of_residence text not null default 'Not specified';
alter table registrations add column if not exists date_of_birth date not null default '1900-01-01';

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
-- SPONSOR_REGISTRATIONS
-- ============================================================
-- Fully separate from `registrations` — the sponsor flow (sponsor.html /
-- sponsor.js) never touches the course-registration tables, so it can't
-- affect that flow.
create table if not exists sponsor_registrations (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  phone text not null,
  email text not null,
  number_of_sponsorships int not null constraint sponsor_registrations_count_check check (number_of_sponsorships >= 1),
  sponsor_preference text not null default 'Yes (Let CodeBloom Africa choose for me)',
  social_media_acknowledgement text not null check (social_media_acknowledgement in ('Yes', 'No')),
  created_at timestamptz default now(),

  -- Payment status fields, kept in sync by the verify-sponsor-payment
  -- function and the Paystack webhook (both write through the service
  -- role key, so they bypass RLS below).
  paid boolean not null default false,
  payment_status text not null default 'pending', -- pending | success | failed
  payment_reference text,
  payment_date timestamptz,
  payment_amount numeric, -- number_of_sponsorships × ₦10,000
  payment_transaction_id bigint -- Paystack's numeric transaction id
);

-- If `sponsor_registrations` already existed from an earlier version of
-- this schema (1-10 cap, no acknowledgement column), bring it up to date
-- without touching existing data.
alter table sponsor_registrations drop constraint if exists sponsor_registrations_number_of_sponsorships_check;
alter table sponsor_registrations drop constraint if exists sponsor_registrations_count_check;
alter table sponsor_registrations add constraint sponsor_registrations_count_check check (number_of_sponsorships >= 1);
alter table sponsor_registrations add column if not exists social_media_acknowledgement text;
update sponsor_registrations set social_media_acknowledgement = 'No' where social_media_acknowledgement is null;
alter table sponsor_registrations alter column social_media_acknowledgement set not null;
alter table sponsor_registrations drop constraint if exists sponsor_registrations_social_media_acknowledgement_check;
alter table sponsor_registrations add constraint sponsor_registrations_social_media_acknowledgement_check check (social_media_acknowledgement in ('Yes', 'No'));

alter table sponsor_registrations enable row level security;

-- The anon (public) key may only ever INSERT a new sponsor registration —
-- never read, update, or delete existing rows. All payment-status writes
-- happen server-side via the service role key in Netlify Functions.
drop policy if exists "Allow public sponsor inserts" on sponsor_registrations;
create policy "Allow public sponsor inserts"
on sponsor_registrations
for insert
to anon
with check (true);

-- ============================================================
-- SPONSOR_PAYMENTS  (append-only ledger, one row per transaction attempt)
-- ============================================================
create table if not exists sponsor_payments (
  id uuid primary key default gen_random_uuid(),
  sponsor_id uuid not null references sponsor_registrations(id) on delete cascade,
  reference text not null unique,
  amount numeric not null,
  currency text not null default 'NGN',
  status text not null default 'pending', -- pending | success | failed
  email text,
  paid_at timestamptz,
  transaction_id bigint, -- Paystack's numeric transaction id
  raw_response jsonb, -- full Paystack transaction payload, for audit/support
  created_at timestamptz default now()
);

create index if not exists sponsor_payments_sponsor_id_idx on sponsor_payments(sponsor_id);

alter table sponsor_payments enable row level security;

-- Intentionally NO policies for the anon key: the sponsor_payments table
-- is written to and read from only by Netlify Functions using the
-- SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS entirely. The public
-- anon key has zero access to this table.

-- ============================================================
-- Viewing data yourself
-- ============================================================
-- Use the Supabase Table Editor / Dashboard (authenticated as you, the
-- project owner) to browse registrations and payments — no additional
-- policy is needed for that access path.
