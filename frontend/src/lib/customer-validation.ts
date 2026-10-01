export type CustomerEmailRecord = {
  customer_id?: string | null;
  email?: string | null;
};

export function normalizeCustomerEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function isValidCustomerEmail(value: unknown) {
  const email = normalizeCustomerEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Escape LIKE wildcards so PostgREST `ilike` performs an exact email lookup. */
export function exactIlikePattern(value: unknown) {
  return normalizeCustomerEmail(value).replace(/[\\%_]/g, "\\$&");
}

export function findCustomerWithEmail<T extends CustomerEmailRecord>(
  customers: T[],
  email: unknown,
  excludeCustomerId?: string | null,
): T | null {
  const normalized = normalizeCustomerEmail(email);
  if (!normalized) return null;
  return customers.find((customer) =>
    customer.customer_id !== excludeCustomerId &&
    normalizeCustomerEmail(customer.email) === normalized,
  ) ?? null;
}
