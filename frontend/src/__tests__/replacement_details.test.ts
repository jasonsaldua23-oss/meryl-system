import { describe, expect, it } from "vitest";
import { parseReplacementNote, resolveReplacementProduct } from "../lib/replacement-details";

const products = [
  { product_id: "kobe-40-green", name: "Kobe 6", size: "40", color: "Green" },
  { product_id: "kobe-41-black", name: "Kobe 6", size: "41", color: "Black" },
  { product_id: "kobe-41-green", name: "Kobe 6", size: "41", color: "Green" },
  { product_id: "af1-41-white", name: "Air Force 1", size: "41", color: "White" },
];

describe("parseReplacementNote", () => {
  it("reads the legacy note format", () => {
    const note = parseReplacementNote(
      "Reason: Replacement | Replaced: Kobe 6 (Size 40) | Replacement: Kobe 6 (Size 41) | Rule: No refund/store credit. Replacement only. | Inventory action: Return to Stock | Reason: Customer changed preference",
    );
    expect(note).toEqual({
      replacementName: "Kobe 6",
      replacementSize: "41",
      inventoryAction: "Return to Stock",
      customerReason: "Customer changed preference",
    });
  });

  it("reads the current note format", () => {
    const note = parseReplacementNote(
      "Replacement | Replaced: Kobe 6 (Size 40) | Replacement: Kobe 6 (Size 41) | Rule: Even exchange | Inventory action: Defective / Not Sellable | Reason: Defective sole",
    );
    expect(note.replacementName).toBe("Kobe 6");
    expect(note.replacementSize).toBe("41");
    expect(note.customerReason).toBe("Defective sole");
  });

  it("handles empty notes", () => {
    expect(parseReplacementNote(null)).toEqual({
      replacementName: "",
      replacementSize: "",
      inventoryAction: "",
      customerReason: "",
    });
  });
});

describe("resolveReplacementProduct", () => {
  const note = parseReplacementNote("Replacement: Kobe 6 (Size 41)");

  it("prefers the stored product id", () => {
    expect(resolveReplacementProduct(products, "af1-41-white", note, "Green")?.product_id).toBe("af1-41-white");
  });

  it("matches name + size from the note, preferring the returned item's color", () => {
    expect(resolveReplacementProduct(products, null, note, "Green")?.product_id).toBe("kobe-41-green");
  });

  it("falls back to name + size when the color is not available", () => {
    expect(resolveReplacementProduct(products, "", note, "Red")?.product_id).toBe("kobe-41-black");
  });

  it("returns undefined when there is nothing to match", () => {
    expect(resolveReplacementProduct(products, "", parseReplacementNote(""), "Green")).toBeUndefined();
  });
});
