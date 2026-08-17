-- IndustrialCyber allowlist
--
-- Run this once in the Supabase dashboard: SQL Editor, New query, paste, Run.
--
-- Individual email addresses only. There are no domain rules on purpose, so
-- adding a customer is always a deliberate act.

create table if not exists public.allowlist (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  expires_at  timestamptz,                      -- null means never expires
  note        text,
  created_at  timestamptz not null default now(),

  -- Stored lowercase so a login attempt can be matched with a plain equality
  -- test and nobody gets locked out by capitalising their own address.
  constraint allowlist_email_is_lowercase check (email = lower(email)),
  constraint allowlist_email_has_at check (position('@' in email) > 1)
);

-- Row level security on, and deliberately no policies at all.
--
-- With RLS enabled and no policy granting access, the publishable key can read
-- nothing from this table, which is what we want: the allowlist is not public
-- information. The secret key bypasses RLS, and only server code holds it.
alter table public.allowlist enable row level security;

-- Seed. Add the rest by hand, one row each, so nothing sensitive has to be
-- typed into a chat window:
--
--   insert into public.allowlist (email, note)
--   values ('someone@example.com', 'Fortinet, met at the Leeds session')
--   on conflict (email) do nothing;
--
-- To let someone in for a fixed period instead of forever:
--
--   insert into public.allowlist (email, expires_at, note)
--   values ('someone@example.com', now() + interval '30 days', 'trial')
--   on conflict (email) do nothing;
--
-- To revoke access immediately:
--
--   delete from public.allowlist where email = 'someone@example.com';

insert into public.allowlist (email, note)
values ('info@trustscope.co.uk', 'owner')
on conflict (email) do nothing;
