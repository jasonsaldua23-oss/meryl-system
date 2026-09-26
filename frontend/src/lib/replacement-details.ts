/**
 * Helpers for reading replacement (1:1 exchange) records.
 *
 * Older records only kept the replacement in the free-text note written by the
 * Return Management form, e.g.
 *   "Replacement | Replaced: Kobe 6 (Size 40) | Replacement: Kobe 6 (Size 41) |
 *    Rule: Even exchange | Inventory action: Return to Stock | Reason: Customer changed preference"
 * so these helpers recover the product, size and customer reason from that note
 * when the structured replacement columns are empty.
 */

export type ReplacementNote = {
  replacementName: string;
  replacementSize: string;
  inventoryAction: string;
  customerReason: string;
};

type ProductLike = { product_id?: string; name: string; size?: string; color?: string };

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function splitNameAndSize(label: string) {
  const match = label.match(/^(.*?)\s*\(\s*size\s+([^)]+)\)\s*$/i);
  if (!match) return { name: label.trim(), size: "" };
  return { name: match[1].trim(), size: match[2].trim() };
}

export function parseReplacementNote(note: unknown): ReplacementNote {
  const segments = String(note ?? "")
    .split("|")
    .map((segment) => segment.trim())
    .filter(Boolean);

  let replacementLabel = "";
  let inventoryAction = "";
  let customerReason = "";

  for (const segment of segments) {
    const [rawKey, ...rest] = segment.split(":");
    const key = normalize(rawKey);
    const value = rest.join(":").trim();
    if (!value) continue;
    if (key === "replacement") replacementLabel = value;
    else if (key === "inventory action") inventoryAction = value;
    // The note starts with "Reason: Replacement" in older records; the customer's
    // reason is the last "Reason:" segment that is not that label.
    else if (key === "reason" && normalize(value) !== "replacement") customerReason = value;
  }

  const { name, size } = splitNameAndSize(replacementLabel);
  return { replacementName: name, replacementSize: size, inventoryAction, customerReason };
}

/**
 * Finds the product handed to the customer. Tries the stored product id, then the
 * name + size from the note (preferring the returned item's color, since
 * exchanges are same-model), then the name alone.
 */
export function resolveReplacementProduct<T extends ProductLike>(
  products: Iterable<T>,
  replacementProductId: unknown,
  note: ReplacementNote,
  returnedColor?: string,
): T | undefined {
  const all = [...products];
  const id = String(replacementProductId ?? "");
  if (id) {
    const byId = all.find((product) => String(product.product_id ?? "") === id);
    if (byId) return byId;
  }
  if (!note.replacementName) return undefined;

  const sameName = all.filter((product) => normalize(product.name) === normalize(note.replacementName));
  const sameSize = note.replacementSize
    ? sameName.filter((product) => normalize(product.size) === normalize(note.replacementSize))
    : sameName;
  const candidates = sameSize.length > 0 ? sameSize : sameName;
  return (
    candidates.find((product) => returnedColor && normalize(product.color) === normalize(returnedColor)) ??
    candidates[0]
  );
}
