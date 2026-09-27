-- ==============================================================================
-- MERYL SHOES SYSTEM - PHASE 6: STORED ANALYTICS + SCHEMA CLEANUP
-- Run in the Supabase SQL Editor AFTER the matching app update is live
-- (Hostinger + Render deployed), and after security_phase4 / phase5.
-- Safe to run more than once.
--
-- 1. Creates the analytics tables the manuscript documents but the database
--    lacked, and keeps them filled automatically from real sales:
--      sales_summary       (Table 33) one row per store day
--      sales_analytics     (Table 32) one row per product per month
--      prediction          (Table 34) monthly demand forecast per product
--      prediction_history  (Table 35) forecast vs. actual, with accuracy
--    Everything uses store time (Asia/Manila).
-- 2. Replacement details get real columns for the pair given to the customer
--    (new_product_id, new_quantity, inventory_action; Table 28) instead of
--    keeping it only inside a text note.
-- 3. Removes columns with no purpose:
--      returns.total_refund, return_details.refund_amount  (always 0: the store
--      gives no cash refunds, replacements are 1-to-1)
--      customer.birth_date  (never written by the app; age is recorded instead,
--      and any stored birth date is copied into age first)
-- ==============================================================================

begin;

set search_path to public, extensions;

-- ------------------------------------------------------------------------------
-- 1. Replacement details: store the replacement pair in columns
-- ------------------------------------------------------------------------------
alter table public.return_details add column if not exists new_product_id uuid;
alter table public.return_details add column if not exists new_quantity integer;
alter table public.return_details add column if not exists inventory_action varchar(50);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'return_details_new_product_id_fkey') then
    alter table public.return_details
      add constraint return_details_new_product_id_fkey
      foreign key (new_product_id) references public.product(product_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'return_details_new_quantity_check') then
    alter table public.return_details
      add constraint return_details_new_quantity_check check (new_quantity is null or new_quantity > 0);
  end if;
end $$;

-- Older replacements kept these facts only in the note; copy them out.
update public.return_details
set inventory_action = nullif(trim(substring(reason from 'Inventory action: ([^|]+)')), '')
where inventory_action is null and reason like '%Inventory action:%';

update public.return_details
set new_quantity = quantity_returned
where new_quantity is null and reason like 'Replacement%' and quantity_returned > 0;

-- ------------------------------------------------------------------------------
-- 2. Remove columns with no purpose
-- ------------------------------------------------------------------------------
alter table public.returns drop column if exists total_refund;
alter table public.return_details drop column if exists refund_amount;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'customer' and column_name = 'birth_date'
  ) then
    alter table public.customer add column if not exists age integer;
    execute $sql$
      update public.customer
      set age = date_part('year', age(current_date, birth_date::date))::int
      where age is null and birth_date is not null
    $sql$;
    alter table public.customer drop column birth_date;
  end if;
end $$;

-- ------------------------------------------------------------------------------
-- 3. Analytics tables (definitions follow Tables 32–35)
-- ------------------------------------------------------------------------------
create table if not exists public.sales_summary (
  summary_id uuid primary key default gen_random_uuid(),
  total_revenue numeric(12, 2) not null,
  total_transaction integer not null,
  total_item_sold integer not null,
  summary_date date not null,
  created_at timestamptz default now()
);
-- Derived data: rebuilt below, so clear it before adding the unique key.
delete from public.sales_summary;
create unique index if not exists sales_summary_summary_date_key on public.sales_summary (summary_date);

create table if not exists public.sales_analytics (
  analytics_id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.product(product_id) on delete cascade,
  total_sales numeric(12, 2) not null default 0,
  total_quantity_sold integer not null default 0,
  average_sales numeric(12, 2) default 0,
  ranking integer,
  trend_type varchar(50) default 'stable' check (trend_type in ('top_seller', 'slow_mover', 'stable')),
  time_period varchar(20) default 'monthly' check (time_period in ('daily', 'weekly', 'monthly')),
  period_start date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.sales_analytics add column if not exists period_start date;
create unique index if not exists sales_analytics_product_period_key
  on public.sales_analytics (product_id, time_period, period_start);

create table if not exists public.prediction (
  prediction_id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.product(product_id) on delete cascade,
  predicted_demand integer not null,
  prediction_period varchar(20) default 'monthly' check (prediction_period in ('weekly', 'monthly', 'quarterly')),
  prediction_date date not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create unique index if not exists prediction_product_period_date_key
  on public.prediction (product_id, prediction_period, prediction_date);

create table if not exists public.prediction_history (
  history_id uuid primary key default gen_random_uuid(),
  prediction_id uuid not null references public.prediction(prediction_id) on delete cascade,
  actual_sales integer,
  prediction_accuracy numeric(5, 2),
  created_at timestamptz default now()
);
create index if not exists prediction_history_prediction_idx on public.prediction_history (prediction_id);

-- Staff can read them; only the database itself writes them.
do $$
declare
  t text;
begin
  foreach t in array array['sales_summary', 'sales_analytics', 'prediction', 'prediction_history'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to anon, authenticated', t);
    execute format('drop policy if exists app_staff_all on public.%I', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_staff', t);
    execute format(
      'create policy %I on public.%I for select to anon, authenticated using ((select public.app_is_staff()))',
      t || '_select_staff', t);
  end loop;
end $$;

-- ------------------------------------------------------------------------------
-- 4. Forecast formula (same as app_forecast.py blended_recent_forecast)
--    0.5 x Weighted Moving Average (last 4, weights 1..4)
--  + 0.3 x Linear Regression (least squares, next point)
--  + 0.2 x Simple Moving Average (last 3)
--    never below 85% of the latest month or below the simple average.
--    Months without sales are skipped, as in the app.
-- ------------------------------------------------------------------------------
create or replace function public.app_forecast_blend(p_values numeric[])
returns numeric
language plpgsql
immutable
as $$
declare
  v numeric[];
  n integer;
  w integer;
  s integer;
  wma numeric := 0;
  wsum numeric := 0;
  sma numeric := 0;
  sx numeric := 0; sy numeric := 0; sxy numeric := 0; sx2 numeric := 0;
  slope numeric; intercept numeric; lr numeric;
  denom numeric;
  latest numeric;
  i integer;
begin
  select coalesce(array_agg(x order by ord), '{}') into v
  from unnest(p_values) with ordinality as u(x, ord)
  where x > 0;
  n := coalesce(array_length(v, 1), 0);
  if n = 0 then return 0; end if;
  if n = 1 then return round(v[1], 2); end if;
  latest := v[n];

  s := least(3, n);
  for i in n - s + 1 .. n loop sma := sma + v[i]; end loop;
  sma := round(sma / s, 2);

  w := least(4, n);
  for i in 1 .. w loop
    wma := wma + v[n - w + i] * i;
    wsum := wsum + i;
  end loop;
  wma := round(wma / wsum, 2);

  if n = 2 then return round(greatest(wma, sma, latest), 2); end if;

  for i in 1 .. n loop
    sx := sx + i; sy := sy + v[i]; sxy := sxy + i * v[i]; sx2 := sx2 + i * i;
  end loop;
  denom := n * sx2 - sx * sx;
  if denom = 0 then
    lr := latest;
  else
    slope := (n * sxy - sx * sy) / denom;
    intercept := (sy - slope * sx) / n;
    lr := greatest(round(intercept + slope * (n + 1), 2), 0);
  end if;

  return round(greatest(wma * 0.5 + lr * 0.3 + sma * 0.2, latest * 0.85, sma), 2);
end;
$$;

-- ------------------------------------------------------------------------------
-- 5. Rebuild functions (store time: Asia/Manila)
-- ------------------------------------------------------------------------------
create or replace function public.app_refresh_sales_summary(p_day date)
returns void
language plpgsql
security definer
set search_path = public
set timezone = 'UTC'
as $$
declare
  v_count integer;
  v_revenue numeric;
  v_items integer;
begin
  if p_day is null then return; end if;
  select count(*), coalesce(sum(st.total_amount), 0),
         coalesce(sum((select sum(d.quantity) from public.sales_details d where d.sales_id = st.sales_id)), 0)
  into v_count, v_revenue, v_items
  from public.sales_transaction st
  where (st.transaction_date::timestamptz at time zone 'Asia/Manila')::date = p_day;

  if v_count = 0 then
    delete from public.sales_summary where summary_date = p_day;
  else
    insert into public.sales_summary (summary_date, total_revenue, total_transaction, total_item_sold)
    values (p_day, v_revenue, v_count, v_items)
    on conflict (summary_date) do update
      set total_revenue = excluded.total_revenue,
          total_transaction = excluded.total_transaction,
          total_item_sold = excluded.total_item_sold;
  end if;
end;
$$;

-- Monthly totals per product, ranked, with the same Fast / Slow thresholds as
-- the analytics page (top_seller >= max(3, 1.3 x average), slow_mover <= max(1, 0.5 x average)).
create or replace function public.app_refresh_sales_analytics(p_month date)
returns void
language plpgsql
security definer
set search_path = public
set timezone = 'UTC'
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
begin
  if p_month is null then return; end if;
  delete from public.sales_analytics where time_period = 'monthly' and period_start = v_month;

  insert into public.sales_analytics
    (product_id, total_sales, total_quantity_sold, average_sales, ranking, trend_type, time_period, period_start, updated_at)
  select a.product_id, a.total, a.qty,
         round(a.total / nullif(a.qty, 0), 2),
         rank() over (order by a.qty desc, a.total desc),
         case
           when a.qty >= greatest(3, 1.3 * s.avg_qty) then 'top_seller'
           when a.qty <= greatest(1, 0.5 * s.avg_qty) then 'slow_mover'
           else 'stable'
         end,
         'monthly', v_month, now()
  from (
    select d.product_id, sum(d.quantity)::integer as qty, sum(d.subtotal) as total
    from public.sales_details d
    join public.sales_transaction st on st.sales_id = d.sales_id
    where date_trunc('month', st.transaction_date::timestamptz at time zone 'Asia/Manila')::date = v_month
    group by d.product_id
  ) a
  cross join (
    select avg(qty) as avg_qty from (
      select sum(d.quantity) as qty
      from public.sales_details d
      join public.sales_transaction st on st.sales_id = d.sales_id
      where date_trunc('month', st.transaction_date::timestamptz at time zone 'Asia/Manila')::date = v_month
      group by d.product_id
    ) q
  ) s
  where a.qty > 0;
end;
$$;

-- For each finished month: what the formula would have predicted from the
-- months before it, the actual pairs sold, and the accuracy
-- (1 - |actual - predicted| / actual) x 100, capped at 99, as in app_predictive.py.
-- Plus the forecast for next month.
create or replace function public.app_refresh_product_predictions(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public
set timezone = 'UTC'
as $$
declare
  v_current date := date_trunc('month', now() at time zone 'Asia/Manila')::date;
  v_months date[];
  v_units numeric[];
  v_n integer;
  i integer;
  v_pred integer;
  v_actual integer;
  v_prediction_id uuid;
begin
  if p_product_id is null then return; end if;
  delete from public.prediction where product_id = p_product_id and prediction_period = 'monthly';

  select coalesce(array_agg(m order by m), '{}'), coalesce(array_agg(u order by m), '{}')
  into v_months, v_units
  from (
    select date_trunc('month', st.transaction_date::timestamptz at time zone 'Asia/Manila')::date as m,
           sum(d.quantity)::numeric as u
    from public.sales_details d
    join public.sales_transaction st on st.sales_id = d.sales_id
    where d.product_id = p_product_id
    group by 1
    having sum(d.quantity) > 0
  ) monthly;

  v_n := coalesce(array_length(v_months, 1), 0);
  if v_n = 0 then return; end if;

  for i in 2 .. v_n loop
    exit when v_months[i] >= v_current;   -- only finished months get an accuracy
    v_pred := round(public.app_forecast_blend(v_units[1:i - 1]));
    v_actual := v_units[i]::integer;
    insert into public.prediction (product_id, predicted_demand, prediction_period, prediction_date)
    values (p_product_id, v_pred, 'monthly', v_months[i])
    returning prediction_id into v_prediction_id;
    insert into public.prediction_history (prediction_id, actual_sales, prediction_accuracy)
    values (
      v_prediction_id, v_actual,
      case when v_actual <= 0 or v_pred <= 0 then 0
           else greatest(0, least(99, round((1 - abs(v_actual - v_pred)::numeric / v_actual) * 100)))
      end
    );
  end loop;

  insert into public.prediction (product_id, predicted_demand, prediction_period, prediction_date)
  values (p_product_id, round(public.app_forecast_blend(v_units)), 'monthly', (v_current + interval '1 month')::date);
end;
$$;

-- ------------------------------------------------------------------------------
-- 6. Keep them current: every sale line and sale change refreshes its day,
--    its month and the product's forecast.
-- ------------------------------------------------------------------------------
create or replace function public.app_sales_details_rollup()
returns trigger
language plpgsql
security definer
set search_path = public
set timezone = 'UTC'
as $$
declare
  r record;
  v_at timestamptz;
begin
  for r in
    select * from (values (new.sales_id, new.product_id), (old.sales_id, old.product_id)) as x(sales_id, product_id)
    where sales_id is not null
  loop
    select st.transaction_date::timestamptz into v_at from public.sales_transaction st where st.sales_id = r.sales_id;
    if v_at is not null then
      perform public.app_refresh_sales_summary((v_at at time zone 'Asia/Manila')::date);
      perform public.app_refresh_sales_analytics((v_at at time zone 'Asia/Manila')::date);
    end if;
    perform public.app_refresh_product_predictions(r.product_id);
  end loop;
  return null;
end;
$$;

create or replace function public.app_sales_transaction_rollup()
returns trigger
language plpgsql
security definer
set search_path = public
set timezone = 'UTC'
as $$
declare
  v_product uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.transaction_date is not null then
    perform public.app_refresh_sales_summary((old.transaction_date::timestamptz at time zone 'Asia/Manila')::date);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.transaction_date is not null then
    perform public.app_refresh_sales_summary((new.transaction_date::timestamptz at time zone 'Asia/Manila')::date);
  end if;
  -- A deleted sale takes its lines with it: rebuild that month and the forecasts.
  if tg_op = 'DELETE' and old.transaction_date is not null then
    perform public.app_refresh_sales_analytics((old.transaction_date::timestamptz at time zone 'Asia/Manila')::date);
    for v_product in select distinct product_id from public.prediction loop
      perform public.app_refresh_product_predictions(v_product);
    end loop;
  end if;
  return null;
end;
$$;

drop trigger if exists sales_details_rollup on public.sales_details;
create trigger sales_details_rollup
  after insert or update of quantity, subtotal, product_id, sales_id or delete on public.sales_details
  for each row execute function public.app_sales_details_rollup();

drop trigger if exists sales_transaction_rollup on public.sales_transaction;
create trigger sales_transaction_rollup
  after insert or update of total_amount, transaction_date or delete on public.sales_transaction
  for each row execute function public.app_sales_transaction_rollup();

-- Rebuild everything from the sales on record (also callable by an admin).
create or replace function public.refresh_sales_rollups()
returns jsonb
language plpgsql
security definer
set search_path = public
set timezone = 'UTC'
as $$
declare
  v_day date;
  v_month date;
  v_product uuid;
begin
  -- Callers through the app's API run as anon/authenticated and must be admins;
  -- the SQL Editor and the service role may always rebuild.
  if coalesce(nullif(current_setting('role', true), ''), 'none') in ('anon', 'authenticated')
     and not public.app_is_admin() then
    raise exception 'Only an administrator can rebuild analytics.';
  end if;

  delete from public.sales_summary;
  for v_day in
    select distinct (transaction_date::timestamptz at time zone 'Asia/Manila')::date
    from public.sales_transaction where transaction_date is not null
  loop
    perform public.app_refresh_sales_summary(v_day);
  end loop;

  delete from public.sales_analytics where time_period = 'monthly';
  for v_month in
    select distinct date_trunc('month', transaction_date::timestamptz at time zone 'Asia/Manila')::date
    from public.sales_transaction where transaction_date is not null
  loop
    perform public.app_refresh_sales_analytics(v_month);
  end loop;

  delete from public.prediction where prediction_period = 'monthly';
  for v_product in select distinct product_id from public.sales_details loop
    perform public.app_refresh_product_predictions(v_product);
  end loop;

  return jsonb_build_object(
    'sales_summary_rows', (select count(*) from public.sales_summary),
    'sales_analytics_rows', (select count(*) from public.sales_analytics),
    'prediction_rows', (select count(*) from public.prediction),
    'prediction_history_rows', (select count(*) from public.prediction_history)
  );
end;
$$;

revoke all on function public.app_refresh_sales_summary(date) from public, anon, authenticated;
revoke all on function public.app_refresh_sales_analytics(date) from public, anon, authenticated;
revoke all on function public.app_refresh_product_predictions(uuid) from public, anon, authenticated;
revoke all on function public.app_sales_details_rollup() from public, anon, authenticated;
revoke all on function public.app_sales_transaction_rollup() from public, anon, authenticated;
revoke all on function public.refresh_sales_rollups() from public, anon, authenticated;
grant execute on function public.refresh_sales_rollups() to anon, authenticated;
grant execute on function public.app_forecast_blend(numeric[]) to anon, authenticated;

-- Fill them from existing sales now.
select public.refresh_sales_rollups();

commit;
