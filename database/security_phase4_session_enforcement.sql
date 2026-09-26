-- ==============================================================================
-- MERYL SHOES SYSTEM - PHASE 4: SERVER-ENFORCED STAFF SESSIONS
-- Run this in the Supabase SQL Editor AFTER the matching frontend build is live
-- (the new frontend sends the x-meryl-session header; older builds do not).
--
-- Problems fixed:
--   * fix_frontend_data_access.sql granted anon full read/write on every table
--     (USING (true)), so anyone holding the public anon key could read and
--     modify customers, sales, payments, inventory and users without logging in.
--   * upsert_user skipped its admin check when p_actor_user_id was NULL, letting
--     anonymous callers create admins or reset any password.
--   * complete_sale trusted client prices/subtotals and the cashier id.
--   * reset_user_password_by_email(p_email, p_new_password) let any
--     authenticated Supabase user reset any staff password.
--   * login_user_by_email let anonymous callers enumerate staff accounts.
--   * Every SECURITY DEFINER function (including meryl_decrypt_text) was
--     executable by anon.
--
-- How sessions work after this migration:
--   * login_user(username, password) returns a random session_token. Only its
--     SHA-256 hash is stored in public.app_session.
--   * The frontend sends it on every request as the x-meryl-session header.
--   * Google / email-OTP logins carry a Supabase JWT; its verified email is
--     mapped to an active staff account.
--   * RLS policies call public.app_is_staff() / public.app_is_admin().
-- ==============================================================================

begin;

create extension if not exists pgcrypto with schema extensions;
set search_path to public, extensions;

-- ------------------------------------------------------------------------------
-- 1. Columns this migration depends on
-- ------------------------------------------------------------------------------
alter table public."user" add column if not exists avatar_url text;
alter table public."user" add column if not exists staff_code varchar(50);
alter table public.payment add column if not exists reference_number text;

-- ------------------------------------------------------------------------------
-- 2. Session store
-- ------------------------------------------------------------------------------
create table if not exists public.app_session (
  token_hash text primary key,
  user_id uuid not null references public."user"(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists idx_app_session_user_id on public.app_session(user_id);
create index if not exists idx_app_session_expires_at on public.app_session(expires_at);

alter table public.app_session enable row level security;
revoke all on table public.app_session from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 3. Identity helpers (used by RLS policies and RPCs)
-- ------------------------------------------------------------------------------
create or replace function public.app_role_group(p_role_name text)
returns text
language sql
immutable
as $$
  select case
    when x in ('admin', 'administrator', 'owner', 'admin owner', 'admin/owner') then 'admin'
    when x in ('sales', 'sales staff', 'cashier', 'cashier staff', 'sales cashier') then 'sales'
    when x in ('inventory', 'inventory staff', 'stock staff', 'warehouse staff') then 'inventory'
    else ''
  end
  from (select regexp_replace(lower(trim(coalesce(p_role_name, ''))), '[_-]+', ' ', 'g') as x) s
$$;

create or replace function public.app_hash_session_token(p_token text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(digest(p_token, 'sha256'), 'hex')
$$;

create or replace function public.app_request_session_token()
returns text
language plpgsql
stable
as $$
declare
  v_headers text := nullif(current_setting('request.headers', true), '');
begin
  if v_headers is null then
    return null;
  end if;
  return nullif(trim(coalesce(v_headers::json ->> 'x-meryl-session', '')), '');
exception when others then
  return null;
end;
$$;

-- Resolves the calling staff member, or NULL for anonymous callers.
create or replace function public.app_current_user_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_token text := public.app_request_session_token();
  v_claims jsonb;
  v_email text;
  v_user_id uuid;
begin
  if v_token is not null then
    select u.user_id
    into v_user_id
    from public.app_session s
    join public."user" u on u.user_id = s.user_id
    join public.role r on r.role_id = u.role_id
    where s.token_hash = public.app_hash_session_token(v_token)
      and s.expires_at > now()
      and lower(coalesce(u.status, 'active')) = 'active'
      and public.app_role_group(r.role_name) <> ''
    limit 1;

    if v_user_id is not null then
      return v_user_id;
    end if;
  end if;

  -- Supabase Auth session (Google OAuth / email OTP): map verified email to staff.
  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    v_claims := null;
  end;

  if coalesce(v_claims ->> 'role', '') = 'authenticated' then
    v_email := lower(trim(coalesce(v_claims ->> 'email', '')));
    if v_email <> '' then
      select u.user_id
      into v_user_id
      from public."user" u
      join public.role r on r.role_id = u.role_id
      where lower(trim(coalesce(u.email, ''))) = v_email
        and lower(coalesce(u.status, 'active')) = 'active'
        and public.app_role_group(r.role_name) <> ''
      limit 1;
    end if;
  end if;

  return v_user_id;
end;
$$;

create or replace function public.app_current_role_group()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select public.app_role_group(r.role_name)
    from public."user" u
    join public.role r on r.role_id = u.role_id
    where u.user_id = public.app_current_user_id()
  ), '')
$$;

create or replace function public.app_is_staff()
returns boolean
language sql
stable
as $$
  select public.app_current_user_id() is not null
$$;

create or replace function public.app_is_admin()
returns boolean
language sql
stable
as $$
  select public.app_current_role_group() = 'admin'
$$;

-- ------------------------------------------------------------------------------
-- 4. Authentication RPCs
-- ------------------------------------------------------------------------------
drop function if exists public.login_user(text, text);
drop function if exists public.login_user(text, text, boolean);

create function public.login_user(
  p_username text,
  p_password text,
  p_issue_session boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user jsonb;
  v_user_id uuid;
  v_status text;
  v_stored_hash text;
  v_is_valid boolean := false;
  v_token text;
  v_expires_at timestamptz;
begin
  if p_username is null or p_password is null
     or length(trim(p_username)) = 0 or length(trim(p_password)) = 0 then
    return null;
  end if;

  select
    u.user_id,
    coalesce(u.status, 'active'),
    u.password,
    jsonb_build_object(
      'user_id', u.user_id,
      'name', u.name,
      'username', lower(u.username),
      'role_id', u.role_id,
      'role_name', r.role_name,
      'status', coalesce(u.status, 'active'),
      'email', u.email,
      'avatar_url', u.avatar_url,
      'staff_code', u.staff_code
    )
  into v_user_id, v_status, v_stored_hash, v_user
  from public."user" u
  join public.role r on r.role_id = u.role_id
  where lower(trim(u.username)) = lower(trim(p_username))
     or lower(trim(coalesce(u.email, ''))) = lower(trim(p_username))
  limit 1;

  if v_user_id is null then
    return null;
  end if;

  if lower(coalesce(v_status, 'active')) <> 'active' then
    return jsonb_build_object(
      'error', 'inactive',
      'message', 'This account is inactive. Please contact the administrator.'
    );
  end if;

  if v_stored_hash like '$2%' then
    v_is_valid := (v_stored_hash = crypt(trim(p_password), v_stored_hash));
  elsif v_stored_hash = trim(p_password)
     or v_stored_hash = encode(digest(trim(p_password), 'sha256'), 'hex') then
    -- Legacy plaintext / SHA-256 hash: accept once and upgrade to bcrypt.
    v_is_valid := true;
    update public."user"
    set password = crypt(trim(p_password), gen_salt('bf', 10)),
        updated_at = now()
    where user_id = v_user_id;
  end if;

  if not v_is_valid then
    return null;
  end if;

  if p_issue_session then
    delete from public.app_session where expires_at < now() - interval '1 day';

    v_token := encode(gen_random_bytes(32), 'hex');
    v_expires_at := now() + interval '12 hours';
    insert into public.app_session (token_hash, user_id, expires_at)
    values (public.app_hash_session_token(v_token), v_user_id, v_expires_at);

    v_user := v_user || jsonb_build_object(
      'session_token', v_token,
      'session_expires_at', v_expires_at
    );
  end if;

  return v_user;
end;
$$;

create or replace function public.app_whoami()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'user_id', u.user_id,
    'name', u.name,
    'username', lower(u.username),
    'role_id', u.role_id,
    'role_name', r.role_name,
    'status', coalesce(u.status, 'active'),
    'email', u.email,
    'avatar_url', u.avatar_url,
    'staff_code', u.staff_code
  )
  from public."user" u
  join public.role r on r.role_id = u.role_id
  where u.user_id = public.app_current_user_id()
$$;

create or replace function public.app_logout()
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text := public.app_request_session_token();
begin
  if v_token is null then
    return false;
  end if;
  delete from public.app_session where token_hash = public.app_hash_session_token(v_token);
  return found;
end;
$$;

-- Only returns the profile of the email the caller has proven ownership of.
drop function if exists public.login_user_by_email(text);
create function public.login_user_by_email(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_claims jsonb;
  v_jwt_email text;
  v_user jsonb;
begin
  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    v_claims := null;
  end;
  v_jwt_email := lower(trim(coalesce(v_claims ->> 'email', '')));

  if p_email is null or v_jwt_email = '' or lower(trim(p_email)) <> v_jwt_email then
    return null;
  end if;

  select jsonb_build_object(
    'user_id', u.user_id,
    'name', u.name,
    'username', lower(u.username),
    'email', u.email,
    'role_id', u.role_id,
    'role_name', r.role_name,
    'status', coalesce(u.status, 'active'),
    'avatar_url', u.avatar_url,
    'staff_code', u.staff_code
  )
  into v_user
  from public."user" u
  join public.role r on r.role_id = u.role_id
  where lower(trim(coalesce(u.email, ''))) = v_jwt_email
    and lower(coalesce(u.status, 'active')) = 'active'
    and coalesce(trim(r.role_name), '') <> ''
  limit 1;

  return v_user;
end;
$$;

-- The (p_email, p_new_password) overload let any authenticated user reset any
-- staff password. The frontend only uses the single-argument version, which
-- takes the email from the verified recovery JWT.
drop function if exists public.reset_user_password_by_email(text, text);

-- ------------------------------------------------------------------------------
-- 5. User management RPC: actor comes from the session, never from the client
-- ------------------------------------------------------------------------------
drop function if exists public.upsert_user(uuid, uuid, text, text, text, uuid, text, text);
create function public.upsert_user(
  p_actor_user_id uuid default null, -- ignored; kept for client compatibility
  p_user_id uuid default null,
  p_name text default null,
  p_username text default null,
  p_password text default null,
  p_role_id uuid default null,
  p_status text default 'active',
  p_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor_id uuid := public.app_current_user_id();
  v_result_user jsonb;
  v_target_id uuid;
  v_pw_hash text := null;
  v_clean_status text;
begin
  if v_actor_id is null or not public.app_is_admin() then
    raise exception 'Only administrators can create or edit user accounts.';
  end if;

  v_clean_status := case
    when lower(trim(coalesce(p_status, 'active'))) = 'inactive' then 'inactive'
    else 'active'
  end;

  if p_password is not null and length(trim(p_password)) > 0 then
    if length(trim(p_password)) < 8 then
      raise exception 'Password must be at least 8 characters.';
    end if;
    v_pw_hash := crypt(trim(p_password), gen_salt('bf', 10));
  end if;

  if p_user_id is not null then
    update public."user"
    set name = coalesce(nullif(trim(p_name), ''), name),
        username = coalesce(nullif(lower(trim(p_username)), ''), username),
        password = coalesce(v_pw_hash, password),
        role_id = coalesce(p_role_id, role_id),
        status = v_clean_status,
        email = nullif(lower(trim(p_email)), ''),
        updated_at = now()
    where user_id = p_user_id
    returning user_id into v_target_id;

    if v_target_id is null then
      raise exception 'User account not found.';
    end if;

    -- Password or status change invalidates that user's existing sessions.
    if v_pw_hash is not null or v_clean_status = 'inactive' then
      delete from public.app_session where user_id = v_target_id;
    end if;
  else
    if v_pw_hash is null then
      raise exception 'A password is required for new accounts.';
    end if;

    insert into public."user" (name, username, password, role_id, status, email)
    values (
      trim(p_name),
      lower(trim(p_username)),
      v_pw_hash,
      p_role_id,
      v_clean_status,
      nullif(lower(trim(p_email)), '')
    )
    returning user_id into v_target_id;
  end if;

  select jsonb_build_object(
    'user_id', u.user_id,
    'name', u.name,
    'username', u.username,
    'role_id', u.role_id,
    'role_name', r.role_name,
    'status', u.status,
    'email', u.email,
    'avatar_url', u.avatar_url,
    'staff_code', u.staff_code,
    'created_at', u.created_at,
    'updated_at', u.updated_at
  )
  into v_result_user
  from public."user" u
  join public.role r on r.role_id = u.role_id
  where u.user_id = v_target_id;

  return v_result_user;
end;
$$;

-- ------------------------------------------------------------------------------
-- 6. POS checkout: cashier from session, prices from the database
-- ------------------------------------------------------------------------------
drop function if exists public.complete_sale(text, text, text, numeric, jsonb);
drop function if exists public.complete_sale(uuid, uuid, text, numeric, jsonb);
drop function if exists public.complete_sale(text, text, text, numeric, jsonb, text);

create function public.complete_sale(
  p_user_id text,          -- ignored; the cashier is the signed-in user
  p_customer_id text,
  p_payment_method text,
  p_amount_paid numeric,
  p_items jsonb,
  p_reference_number text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sales_id uuid := gen_random_uuid();
  v_payment_id uuid := gen_random_uuid();
  v_user_id uuid := public.app_current_user_id();
  v_customer_id uuid;
  v_method text := lower(coalesce(nullif(trim(p_payment_method), ''), 'cash'));
  v_reference text := null;
  v_total numeric(12, 2) := 0;
  v_change numeric(12, 2);
  v_item jsonb;
  v_product_id uuid;
  v_qty integer;
  v_price numeric(12, 2);
  v_discount numeric(12, 2);
  v_client_subtotal numeric;
  v_base numeric;
  v_expected numeric;
  v_subtotal numeric(12, 2);
  v_available integer;
begin
  if v_user_id is null then
    raise exception 'Your session has expired. Please sign in again.';
  end if;

  v_customer_id := nullif(trim(coalesce(p_customer_id, '')), '')::uuid;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty.';
  end if;

  if v_method = 'gcash' then
    v_reference := regexp_replace(coalesce(p_reference_number, ''), '\D', '', 'g');
    if v_reference !~ '^\d{13}$' then
      raise exception 'GCash Reference Number must be exactly 13 digits.';
    end if;
  end if;

  insert into public.sales_transaction (sales_id, customer_id, transaction_date, total_amount, user_id)
  values (v_sales_id, v_customer_id, now(), 0, v_user_id);

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_qty := coalesce((v_item ->> 'quantity')::integer, 0);
    v_discount := coalesce((v_item ->> 'discount_applied')::numeric, 0)::numeric(12, 2);
    v_client_subtotal := coalesce((v_item ->> 'subtotal')::numeric, -1);

    if v_product_id is null then
      raise exception 'Sale item is missing a product.';
    end if;
    if v_qty <= 0 then
      raise exception 'Sale quantity must be greater than zero.';
    end if;
    if v_discount < 0 or v_discount > 100 then
      raise exception 'Discount must be between 0 and 100 percent.';
    end if;

    select
      i.stock_quantity - coalesce(i.reserved_quantity, 0),
      coalesce(i.srp, p.cost_price, 0)::numeric(12, 2)
    into v_available, v_price
    from public.inventory i
    join public.product p on p.product_id = i.product_id
    where i.product_id = v_product_id
    for update of i;

    if v_available is null then
      raise exception 'No inventory record found for product %.', v_product_id;
    end if;
    if v_price <= 0 then
      raise exception 'Product % has no selling price set.', v_product_id;
    end if;
    if v_available < v_qty then
      raise exception 'Insufficient available stock for product %. Available: %, requested: %.',
        v_product_id, v_available, v_qty;
    end if;

    -- The client sends a discount percent rounded to 2 decimals, so allow that
    -- rounding (0.005% of the line) plus one centavo, and nothing more.
    v_base := v_price * v_qty;
    v_expected := v_base * (1 - v_discount / 100);
    if v_client_subtotal < 0 or abs(v_client_subtotal - v_expected) > (v_base * 0.00005 + 0.01) then
      raise exception 'Price for product % has changed. Please refresh the POS and try again.', v_product_id;
    end if;
    v_subtotal := round(v_client_subtotal, 2);
    v_total := v_total + v_subtotal;

    insert into public.sales_details (
      sales_detail_id, sales_id, product_id, quantity, price, discount_applied, subtotal
    )
    values (gen_random_uuid(), v_sales_id, v_product_id, v_qty, v_price, v_discount, v_subtotal);

    update public.inventory
    set stock_quantity = stock_quantity - v_qty,
        last_updated = now()
    where product_id = v_product_id;

    insert into public.inventory_log (
      inventory_log_id, product_id, quantity_change, transaction_type, reference_id, date_updated
    )
    values (gen_random_uuid(), v_product_id, -v_qty, 'sale', v_sales_id, now());
  end loop;

  if v_total <= 0 then
    raise exception 'Sale total must be greater than zero.';
  end if;
  if coalesce(p_amount_paid, 0) < v_total then
    raise exception 'Insufficient payment amount.';
  end if;

  v_change := (coalesce(p_amount_paid, 0) - v_total)::numeric(12, 2);

  update public.sales_transaction set total_amount = v_total where sales_id = v_sales_id;

  insert into public.payment (
    payment_id, sales_id, payment_method, amount_paid, change_amount, payment_status, reference_number
  )
  values (
    v_payment_id, v_sales_id, v_method, coalesce(p_amount_paid, 0)::numeric(12, 2),
    v_change, 'completed', v_reference
  );

  return jsonb_build_object(
    'sales_id', v_sales_id,
    'payment_id', v_payment_id,
    'total_amount', v_total,
    'change_amount', v_change
  );
end;
$$;

-- ------------------------------------------------------------------------------
-- 7. Audit log: actor comes from the session; entries cannot be edited
-- ------------------------------------------------------------------------------
create or replace function public.app_audit_set_actor()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.actor_user_id := public.app_current_user_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_log_set_actor on public.audit_log;
create trigger trg_audit_log_set_actor
before insert on public.audit_log
for each row execute function public.app_audit_set_actor();

drop function if exists public.write_audit_log(uuid, text, text, text, jsonb, jsonb, jsonb);
create function public.write_audit_log(
  p_actor_user_id uuid, -- ignored; the actor is the signed-in user
  p_action_type text,
  p_entity_type text,
  p_entity_id text default null,
  p_old_data jsonb default null,
  p_new_data jsonb default null,
  p_metadata jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.app_current_user_id();
  v_action text := coalesce(nullif(trim(p_action_type), ''), 'unknown_action');
  v_audit_id uuid;
begin
  if v_actor is null and upper(v_action) not in ('AUTH_FAILED_LOGIN', 'AUTH_ACCOUNT_LOCKED') then
    raise exception 'Not signed in.';
  end if;

  insert into public.audit_log (actor_user_id, action_type, entity_type, entity_id, old_data, new_data, metadata)
  values (
    v_actor,
    v_action,
    coalesce(nullif(trim(p_entity_type), ''), 'unknown_entity'),
    p_entity_id,
    p_old_data,
    p_new_data,
    p_metadata
  )
  returning audit_id into v_audit_id;

  return v_audit_id;
end;
$$;

-- ------------------------------------------------------------------------------
-- 8. User table guard: non-admins may only edit their own name/email/avatar
-- ------------------------------------------------------------------------------
create or replace function public.app_guard_user_update()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('anon', 'authenticated') and not public.app_is_admin() then
    if new.role_id is distinct from old.role_id
       or new.status is distinct from old.status
       or new.username is distinct from old.username
       or new.staff_code is distinct from old.staff_code then
      raise exception 'Only administrators can change username, role, status, or staff code.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_user_guard_update on public."user";
create trigger trg_user_guard_update
before update on public."user"
for each row execute function public.app_guard_user_update();

-- ------------------------------------------------------------------------------
-- 9. Row Level Security
-- ------------------------------------------------------------------------------
-- Drop every existing policy on public tables (including the USING (true) ones).
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- Business tables: any signed-in staff member, nobody else.
do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relname not in ('user', 'role', 'audit_log', 'app_session', 'password_reset_otp')
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e'
      )
  loop
    execute format('alter table public.%I enable row level security', t.relname);
    execute format('grant select, insert, update, delete on table public.%I to anon, authenticated', t.relname);
    execute format(
      'create policy app_staff_all on public.%I for all to anon, authenticated '
      'using ((select public.app_is_staff())) with check ((select public.app_is_staff()))',
      t.relname
    );
  end loop;
end $$;

-- role: staff read, admin write
alter table public.role enable row level security;
grant select, insert, update, delete on table public.role to anon, authenticated;
create policy role_select_staff on public.role for select to anon, authenticated
  using ((select public.app_is_staff()));
create policy role_write_admin on public.role for all to anon, authenticated
  using ((select public.app_is_admin())) with check ((select public.app_is_admin()));

-- user: staff read (never the password column), admin write, self profile edit
alter table public."user" enable row level security;
revoke all on table public."user" from public, anon, authenticated;
grant select (user_id, name, username, role_id, status, email, avatar_url, staff_code, created_at, updated_at)
  on table public."user" to anon, authenticated;
grant insert (name, username, role_id, status, email, avatar_url, staff_code)
  on table public."user" to anon, authenticated;
grant update (name, username, role_id, status, email, avatar_url, staff_code, updated_at)
  on table public."user" to anon, authenticated;
grant delete on table public."user" to anon, authenticated;

create policy user_select_staff on public."user" for select to anon, authenticated
  using ((select public.app_is_staff()));
create policy user_insert_admin on public."user" for insert to anon, authenticated
  with check ((select public.app_is_admin()));
create policy user_update_admin_or_self on public."user" for update to anon, authenticated
  using ((select public.app_is_admin()) or user_id = (select public.app_current_user_id()))
  with check ((select public.app_is_admin()) or user_id = (select public.app_current_user_id()));
create policy user_delete_admin on public."user" for delete to anon, authenticated
  using ((select public.app_is_admin()) and user_id <> (select public.app_current_user_id()));

-- audit_log: admin read, append-only; failed-login events may be written pre-login
alter table public.audit_log enable row level security;
revoke all on table public.audit_log from public, anon, authenticated;
grant select, insert on table public.audit_log to anon, authenticated;
create policy audit_select_admin on public.audit_log for select to anon, authenticated
  using ((select public.app_is_admin()));
create policy audit_insert_staff on public.audit_log for insert to anon, authenticated
  with check (
    (select public.app_is_staff())
    or upper(action_type) in ('AUTH_FAILED_LOGIN', 'AUTH_ACCOUNT_LOCKED')
  );

-- password_reset_otp: backend (service role) only
do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'password_reset_otp') then
    execute 'alter table public.password_reset_otp enable row level security';
    execute 'revoke all on table public.password_reset_otp from public, anon, authenticated';
  end if;
end $$;

-- Views run with their owner's rights and would bypass RLS; make them respect it.
-- public_product_catalog stays public on purpose (no cost or customer data).
do $$
declare
  v record;
begin
  for v in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'v'
      and c.relname <> 'public_product_catalog'
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e'
      )
  loop
    execute format('alter view public.%I set (security_invoker = true)', v.relname);
  end loop;
end $$;

-- ------------------------------------------------------------------------------
-- 10. Function privileges: nothing SECURITY DEFINER is callable unless listed
-- ------------------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

grant execute on function public.app_role_group(text) to anon, authenticated;
grant execute on function public.app_hash_session_token(text) to anon, authenticated;
grant execute on function public.app_request_session_token() to anon, authenticated;
grant execute on function public.app_current_user_id() to anon, authenticated;
grant execute on function public.app_current_role_group() to anon, authenticated;
grant execute on function public.app_is_staff() to anon, authenticated;
grant execute on function public.app_is_admin() to anon, authenticated;

grant execute on function public.login_user(text, text, boolean) to anon, authenticated;
grant execute on function public.app_whoami() to anon, authenticated;
grant execute on function public.app_logout() to anon, authenticated;
grant execute on function public.login_user_by_email(text) to authenticated;
grant execute on function public.upsert_user(uuid, uuid, text, text, text, uuid, text, text) to anon, authenticated;
grant execute on function public.complete_sale(text, text, text, numeric, jsonb, text) to anon, authenticated;
grant execute on function public.write_audit_log(uuid, text, text, text, jsonb, jsonb, jsonb) to anon, authenticated;

do $$
begin
  if to_regprocedure('public.reset_user_password_by_email(text)') is not null then
    execute 'grant execute on function public.reset_user_password_by_email(text) to authenticated';
  end if;
end $$;

-- ------------------------------------------------------------------------------
-- 11. Storage: public read stays, uploads/edits/deletes need a staff session
-- ------------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  drop policy if exists "user_avatars_authenticated_insert" on storage.objects;
  drop policy if exists "user_avatars_authenticated_update" on storage.objects;
  drop policy if exists "user_avatars_authenticated_delete" on storage.objects;
  drop policy if exists "return_receipts_insert" on storage.objects;
  drop policy if exists "return_receipts_update" on storage.objects;

  create policy "user_avatars_authenticated_insert" on storage.objects for insert
    with check (bucket_id = 'user-avatars' and (select public.app_is_staff()));
  create policy "user_avatars_authenticated_update" on storage.objects for update
    using (bucket_id = 'user-avatars' and (select public.app_is_staff()))
    with check (bucket_id = 'user-avatars' and (select public.app_is_staff()));
  create policy "user_avatars_authenticated_delete" on storage.objects for delete
    using (bucket_id = 'user-avatars' and (select public.app_is_staff()));
  create policy "return_receipts_insert" on storage.objects for insert
    with check (bucket_id = 'return-receipts' and (select public.app_is_staff()));
  create policy "return_receipts_update" on storage.objects for update
    using (bucket_id = 'return-receipts' and (select public.app_is_staff()))
    with check (bucket_id = 'return-receipts' and (select public.app_is_staff()));
end $$;

commit;
