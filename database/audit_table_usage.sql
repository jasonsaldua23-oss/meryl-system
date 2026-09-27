-- ==============================================================================
-- MERYL SHOES SYSTEM - DATABASE USAGE AUDIT (read-only, changes nothing)
-- Run in the Supabase SQL Editor. Shows, for every table and column in public,
-- how many rows have a value and how many different values there are, so you
-- can see which tables are empty and which columns are never used or always
-- hold the same value (for example refund amounts that are always 0).
-- ==============================================================================

with cols as (
  select c.table_name, c.column_name, c.ordinal_position, c.data_type
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
),
stats as (
  select
    table_name,
    column_name,
    ordinal_position,
    data_type,
    (xpath('/row/n/text()', query_to_xml(
      format('select count(*) as n from public.%I', table_name), false, true, '')))[1]::text::bigint as table_rows,
    (xpath('/row/n/text()', query_to_xml(
      format('select count(%I) as n from public.%I', column_name, table_name), false, true, '')))[1]::text::bigint as rows_with_value,
    (xpath('/row/n/text()', query_to_xml(
      format('select count(distinct %I::text) as n from public.%I', column_name, table_name), false, true, '')))[1]::text::bigint as distinct_values
  from cols
)
select
  table_name,
  column_name,
  data_type,
  table_rows,
  rows_with_value,
  distinct_values,
  case
    when table_rows = 0 then 'TABLE EMPTY'
    when rows_with_value = 0 then 'NEVER FILLED'
    when distinct_values = 1 and table_rows > 1 then 'SAME VALUE IN EVERY ROW'
    else ''
  end as flag
from stats
order by table_name, ordinal_position;
