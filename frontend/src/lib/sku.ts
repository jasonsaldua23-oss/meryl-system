/**
 * Utility functions for Stock Keeping Unit (SKU) management
 * Meryl Shoes POS-Driven Inventory System
 *
 * Each exact product variant (model, color, size) has its own permanent, unique SKU.
 * Format standard: MS-XXXXXX (e.g., MS-000001).
 * Encoded as Code 128 barcodes for internal store operations.
 */

/**
 * Normalizes a SKU string by trimming whitespace and converting to uppercase.
 */
export function normalizeSku(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

/**
 * Validates whether a given string is a valid SKU format.
 * Accepts standard MS-000001 format or alphanumeric strings up to 32 characters.
 */
export function isValidSku(value: unknown): boolean {
  const norm = normalizeSku(value);
  if (!norm || norm.length > 32) return false;
  // Accepts MS-000001, MS-123456, or general alphanumeric with hyphens/underscores
  return /^[A-Z0-9_-]{3,32}$/.test(norm);
}

/**
 * Extracts numeric sequence value from standard MS-XXXXXX SKU.
 */
export function parseSkuNumber(sku: string | null | undefined): number | null {
  const norm = normalizeSku(sku);
  const match = norm.match(/^MS-(\d+)$/);
  if (match && match[1]) {
    const num = parseInt(match[1], 10);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

/**
 * Generates the next sequential SKU based on the highest existing SKU in the product catalog.
 * Guarantees a stable format like MS-000001, MS-000002, etc.
 */
export function generateNextSku(existingProducts: Array<{ sku?: string | null }>): string {
  let maxNum = 0;
  for (const p of existingProducts) {
    const num = parseSkuNumber(p.sku);
    if (num !== null && num > maxNum) {
      maxNum = num;
    }
  }
  const nextNum = maxNum + 1;
  return `MS-${String(nextNum).padStart(6, "0")}`;
}

/**
 * Generates an array of sequential SKUs for bulk creation (e.g. adding multiple sizes).
 */
export function generateBulkNextSkus(
  existingProducts: Array<{ sku?: string | null }>,
  count: number,
): string[] {
  let maxNum = 0;
  for (const p of existingProducts) {
    const num = parseSkuNumber(p.sku);
    if (num !== null && num > maxNum) {
      maxNum = num;
    }
  }
  const result: string[] = [];
  for (let i = 1; i <= count; i++) {
    result.push(`MS-${String(maxNum + i).padStart(6, "0")}`);
  }
  return result;
}

/**
 * Compares two SKUs in a case-insensitive, trimmed manner.
 */
export function isMatchingSku(target: unknown, query: unknown): boolean {
  const normTarget = normalizeSku(target);
  const normQuery = normalizeSku(query);
  if (!normTarget || !normQuery) return false;
  return normTarget === normQuery;
}

/**
 * Formats a SKU for complete display, falling back to a provided placeholder or "N/A".
 */
export function formatSkuDisplay(sku: unknown, fallback = "N/A"): string {
  const norm = normalizeSku(sku);
  return norm || fallback;
}

