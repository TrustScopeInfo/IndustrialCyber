-- ============================================================================
-- IndustrialCyber access control
--
-- Run this in the Supabase dashboard: SQL Editor, New query, paste, Run.
-- It is safe to run again. Nothing here deletes data.
--
-- Sections:
--   1  people                      who may sign in
--   2  demos                       what there is to see
--   3  grants                      who may see which one
--   4  audit                       who changed access, for whom, when
--   5  views seen                  who opened which demo, when
--   6  access requests             who asked for a demo they cannot see
--   7  the last super admin guard
--   8  the effective access view
--   9  the write functions
--  10  self tests
--  11  seed
-- ============================================================================


-- 1. People ------------------------------------------------------------------
--
-- Being on this list means you may sign in. Since per demo grants exist, it no
-- longer means you may see anything.

create table if not exists public.allowlist (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  expires_at  timestamptz,                    -- null means never expires
  note        text,
  created_at  timestamptz not null default now(),
  constraint allowlist_email_is_lowercase check (email = lower(email)),
  constraint allowlist_email_has_at       check (position('@' in email) > 1)
);

alter table public.allowlist
  add column if not exists is_super_admin boolean not null default false,
  add column if not exists all_demos      boolean not null default false;

alter table public.allowlist enable row level security;


-- 2. Demos -------------------------------------------------------------------
--
-- Exists so a grant cannot point at a demo that is not real. This is a second
-- place demos are listed, the first being lib/demos.ts in the code, so the
-- build refuses to ship when the two disagree. See scripts/check-demos.mjs.

create table if not exists public.demos (
  slug      text primary key,
  name      text not null,
  added_at  timestamptz not null default now(),
  constraint demos_slug_shape check (slug ~ '^[a-z0-9-]+$')
);

alter table public.demos enable row level security;

insert into public.demos (slug, name) values
  ('syrup-room', 'Syrup room'),
  ('substation', 'Digital substation'),
  ('warehouse',  'Distribution centre'),
  ('water',      'Water treatment')
on conflict (slug) do nothing;


-- 3. Grants ------------------------------------------------------------------
--
-- One row per person per demo, so the question reads the same from either end.

create table if not exists public.demo_access (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references public.allowlist(id) on delete cascade,
  demo_slug   text not null references public.demos(slug)   on delete cascade,
  granted_at  timestamptz not null default now(),
  granted_by  uuid references public.allowlist(id) on delete set null,
  unique (person_id, demo_slug)
);

alter table public.demo_access
  add column if not exists expires_at timestamptz;   -- null means never expires

create index if not exists demo_access_by_demo   on public.demo_access (demo_slug);
create index if not exists demo_access_by_person on public.demo_access (person_id);

alter table public.demo_access enable row level security;


-- 4. Audit -------------------------------------------------------------------
--
-- Access changes only. Deliberately not cleaned up when people are: the id
-- columns go null on delete rather than cascading, and the addresses are kept
-- as plain text, so "who gave that person the substation, and when" is still
-- answerable after the person has been removed entirely.

create table if not exists public.access_audit (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  actor_id      uuid references public.allowlist(id) on delete set null,
  actor_email   text not null,
  subject_id    uuid references public.allowlist(id) on delete set null,
  subject_email text not null,
  action        text not null,
  demo_slug     text,
  detail        jsonb,
  constraint access_audit_action_known check (action in (
    'person_added','person_removed','person_expiry_set',
    'admin_granted','admin_revoked',
    'all_demos_granted','all_demos_revoked',
    'demo_granted','demo_revoked'
  ))
);

create index if not exists access_audit_recent on public.access_audit (at desc);
create index if not exists access_audit_subject on public.access_audit (subject_email, at desc);

alter table public.access_audit enable row level security;


-- 5. Views seen --------------------------------------------------------------
--
-- Separate from the audit on purpose. The audit is about who changed access.
-- This is about what a prospect actually looked at, which cannot be worked out
-- afterwards from anything else.
--
-- Two deliberate differences from the audit table:
--   the person id cascades, so deleting somebody removes their viewing history
--   rather than leaving their behaviour on file after they have gone
--   the slug is plain text with no foreign key, so retiring a demo does not
--   erase the record that it was watched

create table if not exists public.demo_views (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  person_id  uuid not null references public.allowlist(id) on delete cascade,
  demo_slug  text not null
);

create index if not exists demo_views_by_demo   on public.demo_views (demo_slug, at desc);
create index if not exists demo_views_by_person on public.demo_views (person_id, at desc);

alter table public.demo_views enable row level security;


-- 6. Access requests ---------------------------------------------------------
--
-- Somebody signed in, saw a demo they have no grant for, and asked for it.
-- Recorded here first and emailed second, so a request is never lost because
-- the mail failed.

create table if not exists public.access_requests (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  person_id  uuid references public.allowlist(id) on delete set null,
  email      text not null,
  demo_slug  text not null,
  notified   boolean not null default false
);

create index if not exists access_requests_recent on public.access_requests (at desc);

alter table public.access_requests enable row level security;


-- 7. Never lose the last super admin ----------------------------------------
--
-- This has to be checked once per statement, not once per row.
--
-- A row level BEFORE trigger cannot do it. Given two admins and
--     update allowlist set is_super_admin = false where is_super_admin;
-- the trigger fires once per row, and neither firing can see the other row's
-- pending change, because a statement's own changes are not visible to it.
-- Each one looks around, sees the other admin still standing, and allows the
-- demotion. Both succeed and nobody is left. Section 10 proves it.
--
-- A statement level AFTER trigger counts once, after the whole statement has
-- landed, so it sees the real outcome. The transition table tells it whether
-- the statement touched an admin at all, so ordinary edits are not disturbed
-- and a system that legitimately has no admins yet is not deadlocked.

create or replace function public.guard_last_super_admin()
returns trigger language plpgsql as $$
declare
  touched_an_admin boolean;
  remaining        int;
begin
  select exists (
    select 1 from removed
     where is_super_admin and (expires_at is null or expires_at > now())
  ) into touched_an_admin;

  if not touched_an_admin then
    return null;
  end if;

  select count(*) into remaining
    from public.allowlist
   where is_super_admin and (expires_at is null or expires_at > now());

  if remaining = 0 then
    raise exception
      'Refusing to leave the system with no super admin. Give the flag to somebody else first.'
      using errcode = 'restrict_violation';
  end if;

  return null;
end $$;

-- Two triggers rather than one, because a trigger that uses a transition table
-- may only be defined for a single event.
drop trigger if exists allowlist_guard_admin_update on public.allowlist;
create trigger allowlist_guard_admin_update
  after update on public.allowlist
  referencing old table as removed
  for each statement execute function public.guard_last_super_admin();

drop trigger if exists allowlist_guard_admin_delete on public.allowlist;
create trigger allowlist_guard_admin_delete
  after delete on public.allowlist
  referencing old table as removed
  for each statement execute function public.guard_last_super_admin();


-- 8. Effective access --------------------------------------------------------
--
--   who can see the substation:
--     select email, via from effective_demo_access where demo_slug = 'substation';
--   what can this person see:
--     select demo_slug, via from effective_demo_access where email = 'x@y.com';

drop view if exists public.effective_demo_access;
create view public.effective_demo_access
with (security_invoker = true) as
select
  p.id    as person_id,
  p.email as email,
  d.slug  as demo_slug,
  case when p.is_super_admin then 'super admin'
       when p.all_demos      then 'all demos'
       else 'granted' end as via
from public.allowlist p
cross join public.demos d
where (p.expires_at is null or p.expires_at > now())
  and (
    p.is_super_admin
    or p.all_demos
    or exists (
      select 1 from public.demo_access g
       where g.person_id = p.id
         and g.demo_slug = d.slug
         and (g.expires_at is null or g.expires_at > now())
    )
  );


-- 9. Writes ------------------------------------------------------------------
--
-- Every change to access goes through one of these. The change and its audit
-- row happen in a single transaction, so there is no path that alters who can
-- see what without leaving a record. Each one checks the actor is an active
-- super admin on its own, which is not a substitute for the route handler
-- checking as well.

create or replace function public.require_super_admin(p_actor_id uuid)
returns public.allowlist
language plpgsql security definer set search_path = public as $$
declare v_actor public.allowlist;
begin
  select * into v_actor from allowlist
   where id = p_actor_id
     and is_super_admin
     and (expires_at is null or expires_at > now());
  if not found then
    raise exception 'Not a super admin, or the admin account has expired'
      using errcode = 'insufficient_privilege';
  end if;
  return v_actor;
end $$;

create or replace function public.find_person(p_email text)
returns public.allowlist
language plpgsql security definer set search_path = public as $$
declare v_person public.allowlist;
begin
  select * into v_person from allowlist where email = lower(p_email);
  if not found then
    raise exception 'No such person: %', p_email using errcode = 'no_data_found';
  end if;
  return v_person;
end $$;


create or replace function public.add_person(
  p_actor_id uuid, p_email text, p_note text default null,
  p_all_demos boolean default false)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_actor   public.allowlist;
  v_email   text := lower(trim(p_email));
  v_id      uuid;
begin
  v_actor := require_super_admin(p_actor_id);

  insert into allowlist (email, note, all_demos)
  values (v_email, p_note, p_all_demos)
  on conflict (email) do nothing
  returning id into v_id;

  if v_id is null then
    raise exception 'Already on the list: %', v_email using errcode = 'unique_violation';
  end if;

  insert into access_audit (actor_id, actor_email, subject_id, subject_email, action, detail)
  values (v_actor.id, v_actor.email, v_id, v_email, 'person_added',
          jsonb_build_object('note', p_note, 'all_demos', p_all_demos));

  return v_id;
end $$;


create or replace function public.remove_person(p_actor_id uuid, p_email text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor   public.allowlist;
  v_subject public.allowlist;
begin
  v_actor   := require_super_admin(p_actor_id);
  v_subject := find_person(p_email);

  -- Written before the delete, because after it the subject id is gone.
  insert into access_audit (actor_id, actor_email, subject_id, subject_email, action)
  values (v_actor.id, v_actor.email, v_subject.id, v_subject.email, 'person_removed');

  delete from allowlist where id = v_subject.id;
end $$;


create or replace function public.set_super_admin(
  p_actor_id uuid, p_email text, p_on boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor   public.allowlist;
  v_subject public.allowlist;
begin
  v_actor   := require_super_admin(p_actor_id);
  v_subject := find_person(p_email);

  update allowlist set is_super_admin = p_on where id = v_subject.id;

  insert into access_audit (actor_id, actor_email, subject_id, subject_email, action)
  values (v_actor.id, v_actor.email, v_subject.id, v_subject.email,
          case when p_on then 'admin_granted' else 'admin_revoked' end);
end $$;


create or replace function public.set_all_demos(
  p_actor_id uuid, p_email text, p_on boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor   public.allowlist;
  v_subject public.allowlist;
begin
  v_actor   := require_super_admin(p_actor_id);
  v_subject := find_person(p_email);

  update allowlist set all_demos = p_on where id = v_subject.id;

  insert into access_audit (actor_id, actor_email, subject_id, subject_email, action)
  values (v_actor.id, v_actor.email, v_subject.id, v_subject.email,
          case when p_on then 'all_demos_granted' else 'all_demos_revoked' end);
end $$;


create or replace function public.set_person_expiry(
  p_actor_id uuid, p_email text, p_expires_at timestamptz)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor   public.allowlist;
  v_subject public.allowlist;
begin
  v_actor   := require_super_admin(p_actor_id);
  v_subject := find_person(p_email);

  update allowlist set expires_at = p_expires_at where id = v_subject.id;

  insert into access_audit (actor_id, actor_email, subject_id, subject_email, action, detail)
  values (v_actor.id, v_actor.email, v_subject.id, v_subject.email, 'person_expiry_set',
          jsonb_build_object('expires_at', p_expires_at));
end $$;


create or replace function public.grant_demo(
  p_actor_id uuid, p_email text, p_demo_slug text,
  p_expires_at timestamptz default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor   public.allowlist;
  v_subject public.allowlist;
begin
  v_actor   := require_super_admin(p_actor_id);
  v_subject := find_person(p_email);

  insert into demo_access (person_id, demo_slug, granted_by, expires_at)
  values (v_subject.id, p_demo_slug, v_actor.id, p_expires_at)
  on conflict (person_id, demo_slug)
  do update set granted_by = excluded.granted_by,
                granted_at = now(),
                expires_at = excluded.expires_at;

  insert into access_audit (actor_id, actor_email, subject_id, subject_email,
                            action, demo_slug, detail)
  values (v_actor.id, v_actor.email, v_subject.id, v_subject.email,
          'demo_granted', p_demo_slug,
          jsonb_build_object('expires_at', p_expires_at));
end $$;


create or replace function public.revoke_demo(
  p_actor_id uuid, p_email text, p_demo_slug text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor   public.allowlist;
  v_subject public.allowlist;
begin
  v_actor   := require_super_admin(p_actor_id);
  v_subject := find_person(p_email);

  delete from demo_access
   where person_id = v_subject.id and demo_slug = p_demo_slug;

  insert into access_audit (actor_id, actor_email, subject_id, subject_email,
                            action, demo_slug)
  values (v_actor.id, v_actor.email, v_subject.id, v_subject.email,
          'demo_revoked', p_demo_slug);
end $$;


-- Called by the app when a demo is actually opened. No admin rights needed,
-- and no audit row, because this is not a change to access.
create or replace function public.log_demo_view(p_person_id uuid, p_demo_slug text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into demo_views (person_id, demo_slug) values (p_person_id, p_demo_slug);
end $$;


-- 10. Self tests -------------------------------------------------------------
--
-- Both of these always end by raising an exception carrying their report. That
-- is on purpose. PostgREST wraps each call in a transaction, so raising rolls
-- the whole thing back and the test cannot leave anything behind, not even the
-- synthetic rows it created, and not even if it fails half way through.
--
-- Run them with: npm run selftest
--
-- They also refuse to run at all once this is a live system. Creating synthetic
-- admins, demoting every admin in one statement and deleting the last one are
-- reasonable things to do to an empty database and not reasonable things to do
-- to one with customers in it, however carefully the transaction is rolled
-- back. The check is inside the functions rather than in the script, so it
-- cannot be got round by calling the function from somewhere else.

create or replace function public.assert_selftest_is_safe()
returns void
language plpgsql security definer set search_path = public as $$
declare
  customers int;
  seen      int;
  requests  int;
begin
  -- Real people are those who are not administrators and not the synthetic
  -- addresses the tests themselves use. Administrators do not count, because
  -- there has to be at least one of those before anything works at all.
  select count(*) into customers from allowlist
   where not is_super_admin and email not like '%@example.invalid';

  select count(*) into seen     from demo_views;
  select count(*) into requests from access_requests;

  if customers > 0 or seen > 0 or requests > 0 then
    raise exception 'SELFTEST REFUSED|%', format(
      'This database is in use: %s people on the allowlist who are not administrators, '
      || '%s recorded demo views, %s access requests.'
      || chr(10) || chr(10)
      || 'These tests create synthetic administrators, demote every administrator in one '
      || 'statement and delete the last one. That is fine on an empty database and not fine '
      || 'here, whatever the transaction does afterwards.'
      || chr(10) || chr(10)
      || 'Run them against a scratch Supabase project instead.',
      customers, seen, requests)
      using errcode = 'insufficient_privilege';
  end if;
end $$;


create or replace function public.selftest_admin_guard()
returns void
language plpgsql security definer set search_path = public as $$
declare
  report   text := '';
  nl       text := chr(10);
  before   int;
  after_   int;
  refused  boolean;
  passed   boolean := true;
begin
  perform assert_selftest_is_safe();

  -- Three synthetic admins, so the test does not depend on a real one already
  -- existing and gives the same answer on an empty database.
  insert into allowlist (email, note, is_super_admin) values
    ('selftest-a@example.invalid', 'self test', true),
    ('selftest-b@example.invalid', 'self test', true),
    ('selftest-c@example.invalid', 'self test', true);

  select count(*) into before from allowlist
   where is_super_admin and (expires_at is null or expires_at > now());
  report := report || format('active admins before: %s', before) || nl;

  -- The case a row level trigger gets wrong: one statement, every admin.
  refused := false;
  begin
    update allowlist set is_super_admin = false where is_super_admin;
  exception when others then
    refused := true;
    report := report || format('multi row demotion refused with: %s', sqlerrm) || nl;
  end;

  select count(*) into after_ from allowlist
   where is_super_admin and (expires_at is null or expires_at > now());
  report := report || format('active admins after that statement: %s', after_) || nl;

  if refused and after_ = before then
    report := report || 'PASS  one statement demoting every admin was refused' || nl;
  else
    passed := false;
    report := report || 'FAIL  one statement demoting every admin got through' || nl;
  end if;

  -- Demoting all but one must still be allowed.
  refused := false;
  begin
    update allowlist set is_super_admin = false
     where email in ('selftest-a@example.invalid', 'selftest-b@example.invalid');
  exception when others then
    refused := true;
  end;
  if refused then
    passed := false;
    report := report || 'FAIL  demoting all but one admin was blocked, it should be allowed' || nl;
  else
    report := report || 'PASS  demoting all but one admin was allowed' || nl;
  end if;

  -- Deleting the last admin must be refused.
  refused := false;
  begin
    delete from allowlist where is_super_admin;
  exception when others then
    refused := true;
  end;
  if refused then
    report := report || 'PASS  deleting the last admin was refused' || nl;
  else
    passed := false;
    report := report || 'FAIL  deleting the last admin got through' || nl;
  end if;

  -- Expiring the last admin must be refused, since it has the same effect.
  refused := false;
  begin
    update allowlist set expires_at = now() - interval '1 day' where is_super_admin;
  exception when others then
    refused := true;
  end;
  if refused then
    report := report || 'PASS  expiring the last admin was refused' || nl;
  else
    passed := false;
    report := report || 'FAIL  expiring the last admin got through' || nl;
  end if;

  raise exception 'SELFTEST %|%', case when passed then 'PASS' else 'FAIL' end, nl || report;
end $$;


create or replace function public.selftest_access_functions()
returns void
language plpgsql security definer set search_path = public as $$
declare
  report   text := '';
  nl       text := chr(10);
  passed   boolean := true;
  v_actor  uuid;
  v_new    uuid;
  n        int;
begin
  perform assert_selftest_is_safe();

  insert into allowlist (email, note, is_super_admin)
  values ('selftest-admin@example.invalid', 'self test', true)
  returning id into v_actor;

  -- add_person
  begin
    v_new := add_person(v_actor, 'SelfTest-Sub@Example.Invalid', 'added by self test');
    report := report || 'PASS  add_person' || nl;
  exception when others then
    passed := false; report := report || format('FAIL  add_person: %s', sqlerrm) || nl;
  end;

  -- the address must have been stored lowercase
  select count(*) into n from allowlist where email = 'selftest-sub@example.invalid';
  if n = 1 then report := report || 'PASS  address stored lowercase' || nl;
  else passed := false; report := report || 'FAIL  address not stored lowercase' || nl; end if;

  -- grant_demo, then revoke_demo
  begin
    perform grant_demo(v_actor, 'selftest-sub@example.invalid', 'syrup-room');
    select count(*) into n from effective_demo_access
     where email = 'selftest-sub@example.invalid' and demo_slug = 'syrup-room';
    if n = 1 then report := report || 'PASS  grant_demo, and the view sees it' || nl;
    else passed := false; report := report || 'FAIL  grant_demo did not reach the view' || nl; end if;
  exception when others then
    passed := false; report := report || format('FAIL  grant_demo: %s', sqlerrm) || nl;
  end;

  begin
    perform revoke_demo(v_actor, 'selftest-sub@example.invalid', 'syrup-room');
    select count(*) into n from effective_demo_access
     where email = 'selftest-sub@example.invalid' and demo_slug = 'syrup-room';
    if n = 0 then report := report || 'PASS  revoke_demo' || nl;
    else passed := false; report := report || 'FAIL  revoke_demo left access behind' || nl; end if;
  exception when others then
    passed := false; report := report || format('FAIL  revoke_demo: %s', sqlerrm) || nl;
  end;

  -- an expired grant must not count
  begin
    perform grant_demo(v_actor, 'selftest-sub@example.invalid', 'water',
                       now() - interval '1 hour');
    select count(*) into n from effective_demo_access
     where email = 'selftest-sub@example.invalid' and demo_slug = 'water';
    if n = 0 then report := report || 'PASS  an expired grant gives no access' || nl;
    else passed := false; report := report || 'FAIL  an expired grant still gives access' || nl; end if;
  exception when others then
    passed := false; report := report || format('FAIL  grant_demo with expiry: %s', sqlerrm) || nl;
  end;

  -- set_all_demos
  begin
    perform set_all_demos(v_actor, 'selftest-sub@example.invalid', true);
    select count(*) into n from effective_demo_access
     where email = 'selftest-sub@example.invalid';
    if n = (select count(*) from demos) then
      report := report || 'PASS  set_all_demos covers every demo' || nl;
    else
      passed := false; report := report || 'FAIL  set_all_demos did not cover every demo' || nl;
    end if;
  exception when others then
    passed := false; report := report || format('FAIL  set_all_demos: %s', sqlerrm) || nl;
  end;

  -- set_super_admin and set_person_expiry
  begin
    perform set_super_admin(v_actor, 'selftest-sub@example.invalid', true);
    perform set_super_admin(v_actor, 'selftest-sub@example.invalid', false);
    report := report || 'PASS  set_super_admin both ways' || nl;
  exception when others then
    passed := false; report := report || format('FAIL  set_super_admin: %s', sqlerrm) || nl;
  end;

  begin
    perform set_person_expiry(v_actor, 'selftest-sub@example.invalid', now() + interval '30 days');
    report := report || 'PASS  set_person_expiry' || nl;
  exception when others then
    passed := false; report := report || format('FAIL  set_person_expiry: %s', sqlerrm) || nl;
  end;

  -- an expired person sees nothing, whatever they were granted
  begin
    perform set_person_expiry(v_actor, 'selftest-sub@example.invalid', now() - interval '1 day');
    select count(*) into n from effective_demo_access where email = 'selftest-sub@example.invalid';
    if n = 0 then report := report || 'PASS  an expired person sees nothing' || nl;
    else passed := false; report := report || 'FAIL  an expired person still sees demos' || nl; end if;
    perform set_person_expiry(v_actor, 'selftest-sub@example.invalid', null);
  exception when others then
    passed := false; report := report || format('FAIL  person expiry: %s', sqlerrm) || nl;
  end;

  -- log_demo_view
  begin
    perform log_demo_view(v_new, 'syrup-room');
    select count(*) into n from demo_views where person_id = v_new;
    if n = 1 then report := report || 'PASS  log_demo_view' || nl;
    else passed := false; report := report || 'FAIL  log_demo_view wrote nothing' || nl; end if;
  exception when others then
    passed := false; report := report || format('FAIL  log_demo_view: %s', sqlerrm) || nl;
  end;

  -- a non admin must be refused
  begin
    perform grant_demo(v_new, 'selftest-sub@example.invalid', 'syrup-room');
    passed := false;
    report := report || 'FAIL  a non admin was allowed to grant access' || nl;
  exception when others then
    report := report || 'PASS  a non admin was refused' || nl;
  end;

  -- remove_person, and the audit must survive it
  begin
    perform remove_person(v_actor, 'selftest-sub@example.invalid');
    select count(*) into n from access_audit
     where subject_email = 'selftest-sub@example.invalid';
    if n > 0 then
      report := report || format('PASS  remove_person, and %s audit rows survived the deletion', n) || nl;
    else
      passed := false; report := report || 'FAIL  the audit trail went with the person' || nl;
    end if;
  exception when others then
    passed := false; report := report || format('FAIL  remove_person: %s', sqlerrm) || nl;
  end;

  raise exception 'SELFTEST %|%', case when passed then 'PASS' else 'FAIL' end, nl || report;
end $$;


-- 10b. Who may call any of this ----------------------------------------------
--
-- PostgREST publishes every function in this schema at /rest/v1/rpc/<name>, and
-- Postgres grants EXECUTE to everybody by default. Left alone, find_person
-- would answer "is this address one of your customers" to anyone who asked with
-- the publishable key, which is exactly what the identical wording on the login
-- page exists to prevent. None of these are meant to be called from a browser.

revoke execute on function
  public.require_super_admin(uuid),
  public.find_person(text),
  public.add_person(uuid, text, text, boolean),
  public.remove_person(uuid, text),
  public.set_super_admin(uuid, text, boolean),
  public.set_all_demos(uuid, text, boolean),
  public.set_person_expiry(uuid, text, timestamptz),
  public.grant_demo(uuid, text, text, timestamptz),
  public.revoke_demo(uuid, text, text),
  public.log_demo_view(uuid, text),
  public.assert_selftest_is_safe(),
  public.selftest_admin_guard(),
  public.selftest_access_functions()
from public, anon, authenticated;

grant execute on function
  public.require_super_admin(uuid),
  public.find_person(text),
  public.add_person(uuid, text, text, boolean),
  public.remove_person(uuid, text),
  public.set_super_admin(uuid, text, boolean),
  public.set_all_demos(uuid, text, boolean),
  public.set_person_expiry(uuid, text, timestamptz),
  public.grant_demo(uuid, text, text, timestamptz),
  public.revoke_demo(uuid, text, text),
  public.log_demo_view(uuid, text),
  public.assert_selftest_is_safe(),
  public.selftest_admin_guard(),
  public.selftest_access_functions()
to service_role;


-- 11. Seed -------------------------------------------------------------------
--
-- The first super admin has to be made here, because there is no other way to
-- create one.

insert into public.allowlist (email, note, is_super_admin, all_demos)
values ('info@trustscope.co.uk', 'owner', true, true)
on conflict (email) do update
  set is_super_admin = true, all_demos = true;

-- To add somebody by hand before the admin screen exists, replacing the id
-- with your own from: select id, email from allowlist;
--
--   select add_person('<your-id>'::uuid, 'someone@example.com', 'Fortinet, Leeds');
--   select grant_demo('<your-id>'::uuid, 'someone@example.com', 'syrup-room');
--
-- To take it away again:
--
--   select revoke_demo('<your-id>'::uuid, 'someone@example.com', 'syrup-room');
--   select remove_person('<your-id>'::uuid, 'someone@example.com');
