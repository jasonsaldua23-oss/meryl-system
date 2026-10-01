-- Run once in the Supabase SQL Editor.
-- Customer emails must be unique regardless of capitalization or surrounding spaces.
-- Existing duplicate emails must be corrected before this migration can be applied;
-- PostgreSQL will stop with the conflicting values rather than discard customer data.
-- To find existing conflicts first:
-- SELECT LOWER(TRIM(email)) AS email, ARRAY_AGG(customer_id), COUNT(*)
-- FROM public.customer WHERE email IS NOT NULL AND TRIM(email) <> ''
-- GROUP BY LOWER(TRIM(email)) HAVING COUNT(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_unique_email_lower
ON public.customer (LOWER(TRIM(email)))
WHERE email IS NOT NULL AND TRIM(email) <> '';
