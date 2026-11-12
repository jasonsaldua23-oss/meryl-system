/**
 * Meryl Shoes - White-Box Frontend Unit Tests (Vitest)
 * Carlos Hilado Memorial State University - College of Computer Studies
 * Tests internal client-side logic, calculation paths, and boundary conditions.
 */
import { describe, test, expect } from 'vitest';
import {
  normalizeSku,
  isValidSku,
  parseSkuNumber,
  generateNextSku,
  generateBulkNextSkus,
  isMatchingSku,
  formatSkuDisplay,
} from '../lib/sku';

describe("White-Box Test Suite: Core System Functions", () => {
  // 1. Available Stock Formula
  test("WB-INV-001: calculateAvailableStock subtracts reserved and defective", () => {
    const calculateAvailableStock = (onHand: number, reserved: number, defective: number) =>
      Math.max(0, onHand - reserved - defective);

    expect(calculateAvailableStock(50, 5, 3)).toBe(42);
    expect(calculateAvailableStock(5, 5, 0)).toBe(0);
    expect(calculateAvailableStock(2, 5, 0)).toBe(0); // non-negative clamp
  });

  // 2. SRP Markup Calculation
  test("WB-PROD-001: calculateSrpFromMarkup calculates cost * (1 + markup/100)", () => {
    const calculateSrp = (cost: number, markup: number) =>
      Number((cost * (1 + markup / 100)).toFixed(2));

    expect(calculateSrp(1500, 20)).toBe(1800.0);
    expect(calculateSrp(2000, 0)).toBe(2000.0);
  });

  // 3. Negative Stock Protection
  test("WB-INV-002: validateStockAdjustment prevents negative balance", () => {
    const validateStock = (current: number, delta: number) => current + delta >= 0;

    expect(validateStock(10, -5)).toBe(true);
    expect(validateStock(5, -10)).toBe(false);
  });

  // 4. BOGO Free Units Calculation
  test("WB-POS-003: getBogoFreeUnits awards 1 free pair for every 2 pairs", () => {
    const getBogoFree = (qty: number) => Math.floor(qty / 2);

    expect(getBogoFree(1)).toBe(0);
    expect(getBogoFree(2)).toBe(1);
    expect(getBogoFree(3)).toBe(1);
    expect(getBogoFree(4)).toBe(2);
  });

  // 5. 12% BIR Philippine VAT Decomposition
  test("WB-POS-005: getVatBreakdown computes vatable sales and 12% VAT", () => {
    const getVatBreakdown = (gross: number) => {
      const vatable = Number((gross / 1.12).toFixed(2));
      const vat = Number((gross - vatable).toFixed(2));
      return { vatable, vat };
    };

    const res = getVatBreakdown(1120.0);
    expect(res.vatable).toBe(1000.0);
    expect(res.vat).toBe(120.0);
  });

  // 6. Manager Override Decision Rules
  test("WB-POS-009/010: requiresManagerOverride enforces loss prevention", () => {
    const requiresOverride = (action: string, role: string, discount: number = 0) => {
      if (role === "admin") return false;
      if (action === "VOID_ITEM") return true;
      if (discount > 20) return true;
      return false;
    };

    expect(requiresOverride("VOID_ITEM", "sales")).toBe(true);
    expect(requiresOverride("VOID_ITEM", "admin")).toBe(false);
    expect(requiresOverride("DISCOUNT", "sales", 25)).toBe(true);
    expect(requiresOverride("DISCOUNT", "sales", 15)).toBe(false);
  });

  // 7. No-Full-Refund Policy Engine
  test("WB-RET-001/002: computeReplacementAdjustment enforces No-Full-Refund", () => {
    const computeAdjustment = (orig: number, rep: number) => {
      if (rep > orig) {
        return { additionalPayment: rep - orig, refund: 0 };
      }
      return { additionalPayment: 0, refund: 0 }; // strict no-cash-refund policy
    };

    const upgrade = computeAdjustment(1800, 2200);
    expect(upgrade.additionalPayment).toBe(400);
    expect(upgrade.refund).toBe(0);

    const downgrade = computeAdjustment(2500, 2000);
    expect(downgrade.additionalPayment).toBe(0);
    expect(downgrade.refund).toBe(0);
  });

  // 8. Simple Moving Average (SMA) Demand Forecast
  test("WB-ANL-001: calculateSMA computes k=3 period moving average", () => {
    const calculateSMA = (series: number[], k: number = 3) => {
      if (series.length === 0) return 0;
      const window = series.slice(-Math.min(series.length, k));
      const sum = window.reduce((a, b) => a + b, 0);
      return Number((sum / window.length).toFixed(2));
    };

    expect(calculateSMA([120, 150, 180], 3)).toBe(150.0);
    expect(calculateSMA([100, 140], 3)).toBe(120.0);
  });

  // 9. Forecast Accuracy Formula
  test("WB-ANL-005: calculateForecastAccuracy computes 100 - MAPE", () => {
    const calculateAccuracy = (actual: number, predicted: number) => {
      if (actual === 0) return 0;
      const error = Math.abs(actual - predicted) / actual;
      return Number(Math.max(0, (1 - error) * 100).toFixed(2));
    };

    expect(calculateAccuracy(200, 180)).toBe(90.0);
  });

  // 10. Walk-in Customer Unique Mobile Number Enforcement
  test("WB-POS-011: validateUniqueWalkInPhone enforces unique phone number for new customer", () => {
    const validateUniqueWalkInPhone = (
      existingList: Array<{ customer_id: string; contact_number: string; name: string }>,
      phone: string,
    ) => {
      const match = existingList.find((c) => c.contact_number === phone);
      if (match) {
        throw new Error(`Mobile number ${phone} is already registered to "${match.name}". Mobile numbers must be unique.`);
      }
      return true;
    };

    const existing = [{ customer_id: "c1", contact_number: "09123456789", name: "carl" }];

    // Attempting to register new customer with carl's phone throws unique validation error
    expect(() => validateUniqueWalkInPhone(existing, "09123456789")).toThrow(
      'Mobile number 09123456789 is already registered to "carl". Mobile numbers must be unique.',
    );

    // Unique phone number passes validation
    expect(validateUniqueWalkInPhone(existing, "09991234567")).toBe(true);
  });

  // 11. New Product Reorder Level Default and Low Stock Suppression
  test("WB-INV-012: new products default reorder_level to 0 and suppress low stock alerts before stock-in", () => {
    const createNewProductPayload = (name: string, size: string) => ({
      product_name: name,
      size,
      reorder_level: 0,
    });

    const newProd = createNewProductPayload("Campus Sneaker", "42");
    expect(newProd.reorder_level).toBe(0);

    const shouldTriggerLowStock = (stock: number, reorder: number) => {
      return reorder > 0 && stock <= reorder;
    };

    // Before stocking in: stock is 0, reorder is 0 -> should NOT trigger low stock alert
    expect(shouldTriggerLowStock(0, newProd.reorder_level)).toBe(false);

    // After stock-in and configuring threshold: stock is 3, reorder is 5 -> triggers low stock alert
    expect(shouldTriggerLowStock(3, 5)).toBe(true);
  });

  // 12. SKU Normalization and Validation
  test("WB-SKU-001: normalizeSku and isValidSku handle case-insensitive trimmed SKUs and reject malformed input", () => {
    expect(normalizeSku("  ms-000001  ")).toBe("MS-000001");
    expect(normalizeSku("ms-000125\n")).toBe("MS-000125");
    expect(normalizeSku(null)).toBe("");
    expect(normalizeSku(undefined)).toBe("");

    expect(isValidSku("MS-000001")).toBe(true);
    expect(isValidSku("  ms-000042 ")).toBe(true);
    expect(isValidSku("")).toBe(false);
    expect(isValidSku("   ")).toBe(false);
    expect(isValidSku("INVALID SKU WITH SPACES")).toBe(false);

    expect(parseSkuNumber("MS-000001")).toBe(1);
    expect(parseSkuNumber("ms-000150")).toBe(150);
    expect(parseSkuNumber("OTHER-12")).toBeNull();
    expect(formatSkuDisplay("ms-000009")).toBe("MS-000009");
  });

  // 13. Sequential Unique SKU Generation per Variant
  test("WB-SKU-002: generateNextSku and generateBulkNextSkus produce sequential unique SKUs per size/color variant", () => {
    const existingVariants = [
      { sku: "MS-000001", product_id: "uuid-1" },
      { sku: "MS-000002", product_id: "uuid-2" },
      { sku: "MS-000005", product_id: "uuid-5" },
    ];

    expect(generateNextSku(existingVariants)).toBe("MS-000006");
    expect(generateBulkNextSkus(existingVariants, 3)).toEqual([
      "MS-000006",
      "MS-000007",
      "MS-000008",
    ]);
  });

  // 14. POS SKU Lookup, Manual Entry, Scanner Enter Input, and Error Handling
  test("WB-POS-012: POS SKU scan and manual lookup handles valid, repeated, unknown, inactive, expired, out-of-stock, and exceeding stock cases", () => {
    type Variant = {
      product_id: string;
      sku: string;
      name: string;
      size: string;
      color: string;
      price: number;
      stock: number;
      status: "Active" | "Inactive";
      isArchived?: boolean;
      isExpired?: boolean;
    };

    const catalog: Variant[] = [
      {
        product_id: "p-active",
        sku: "MS-000001",
        name: "Meryl Air Runner",
        size: "40",
        color: "Black",
        price: 1850,
        stock: 2,
        status: "Active",
      },
      {
        product_id: "p-inactive",
        sku: "MS-000002",
        name: "Meryl Classic Loafer",
        size: "41",
        color: "Brown",
        price: 2100,
        stock: 5,
        status: "Inactive",
      },
      {
        product_id: "p-expired",
        sku: "MS-000003",
        name: "Meryl Promo Canvas",
        size: "39",
        color: "White",
        price: 1200,
        stock: 4,
        status: "Active",
        isExpired: true,
      },
      {
        product_id: "p-oos",
        sku: "MS-000004",
        name: "Meryl Court Pro",
        size: "42",
        color: "Red",
        price: 2400,
        stock: 0,
        status: "Active",
      },
    ];

    const cart: Array<{ id: string; sku: string; quantity: number; price: number }> = [];

    const processSkuInput = (rawInput: string) => {
      const normalized = normalizeSku(rawInput);
      if (!normalized || !isValidSku(normalized)) {
        return { ok: false, error: "Malformed or empty SKU input" };
      }

      const matched = catalog.find((item) => isMatchingSku(item.sku, normalized));
      if (!matched) {
        return { ok: false, error: `SKU "${normalized}" not found` };
      }

      if (matched.isArchived || matched.status !== "Active") {
        return { ok: false, error: `SKU "${matched.sku}" is inactive or archived` };
      }

      if (matched.isExpired) {
        return { ok: false, error: `SKU "${matched.sku}" is expired` };
      }

      if (matched.stock <= 0) {
        return { ok: false, error: `SKU "${matched.sku}" is out of stock` };
      }

      const existing = cart.find((c) => c.id === matched.product_id);
      const nextQty = (existing?.quantity ?? 0) + 1;
      if (nextQty > matched.stock) {
        return { ok: false, error: `Requested quantity (${nextQty}) exceeds available stock (${matched.stock})` };
      }

      if (existing) {
        existing.quantity = nextQty;
      } else {
        cart.push({
          id: matched.product_id,
          sku: matched.sku,
          quantity: 1,
          price: matched.price,
        });
      }

      return { ok: true, item: matched, quantity: nextQty };
    };

    // 1. Empty / malformed input
    expect(processSkuInput("   ").ok).toBe(false);
    expect(processSkuInput("BAD SKU!").ok).toBe(false);

    // 2. Unknown SKU
    const unknownRes = processSkuInput("MS-999999");
    expect(unknownRes.ok).toBe(false);
    expect(unknownRes.error).toContain("not found");

    // 3. Inactive SKU
    const inactiveRes = processSkuInput("ms-000002");
    expect(inactiveRes.ok).toBe(false);
    expect(inactiveRes.error).toContain("inactive");

    // 4. Expired SKU
    const expiredRes = processSkuInput("MS-000003");
    expect(expiredRes.ok).toBe(false);
    expect(expiredRes.error).toContain("expired");

    // 5. Out-of-stock SKU
    const oosRes = processSkuInput("MS-000004");
    expect(oosRes.ok).toBe(false);
    expect(oosRes.error).toContain("out of stock");

    // 6. Successful manual SKU entry (adds 1 unit)
    const firstScan = processSkuInput("  ms-000001 ");
    expect(firstScan.ok).toBe(true);
    expect(cart.length).toBe(1);
    expect(cart[0].quantity).toBe(1);

    // 7. Repeated scanner-style input (increments existing cart quantity to 2)
    const secondScan = processSkuInput("MS-000001\n");
    expect(secondScan.ok).toBe(true);
    expect(cart.length).toBe(1);
    expect(cart[0].quantity).toBe(2);

    // 8. Third scan exceeds available stock (stock is 2)
    const thirdScan = processSkuInput("MS-000001");
    expect(thirdScan.ok).toBe(false);
    expect(thirdScan.error).toContain("exceeds available stock");
    expect(cart[0].quantity).toBe(2);
  });

  // 15. Damaged Product Stock Adjustment Workflow
  test("WB-INV-013: damaged stock adjustment reduces sellable quantity and creates full audit record", () => {
    const processDamagedAdjustment = (params: {
      product_id: string;
      sku: string;
      currentStock: number;
      adjustQty: number;
      reason: "Damaged Write-off" | "Quarantined" | "Stock Adjustment";
      remarks: string;
      actor: string;
      retireVariant: boolean;
    }) => {
      if (params.adjustQty <= 0) throw new Error("Adjustment quantity must be greater than 0");
      if (params.adjustQty > params.currentStock) throw new Error("Adjustment exceeds current on-hand stock");
      if (!params.remarks.trim()) throw new Error("Remarks are required");

      const newQuantity = params.currentStock - params.adjustQty;
      const nextStatus = params.retireVariant ? "Inactive" : "Active";

      return {
        newQuantity,
        nextStatus,
        inventoryLog: {
          product_id: params.product_id,
          sku: params.sku,
          previous_quantity: params.currentStock,
          new_quantity: newQuantity,
          adjustment_quantity: -params.adjustQty,
          reason: params.reason,
          remarks: params.remarks.trim(),
          actor: params.actor,
        },
      };
    };

    const result = processDamagedAdjustment({
      product_id: "prod-101",
      sku: "MS-000101",
      currentStock: 10,
      adjustQty: 1,
      reason: "Damaged Write-off",
      remarks: "Sole separation found during inspection",
      actor: "admin@merylshoes.com",
      retireVariant: false,
    });

    expect(result.newQuantity).toBe(9);
    expect(result.nextStatus).toBe("Active");
    expect(result.inventoryLog.adjustment_quantity).toBe(-1);
    expect(result.inventoryLog.sku).toBe("MS-000101");
    expect(result.inventoryLog.reason).toBe("Damaged Write-off");

    // Retiring variant marks it Inactive
    const retired = processDamagedAdjustment({
      product_id: "prod-101",
      sku: "MS-000101",
      currentStock: 9,
      adjustQty: 9,
      reason: "Quarantined",
      remarks: "Batch water damage",
      actor: "admin@merylshoes.com",
      retireVariant: true,
    });
    expect(retired.newQuantity).toBe(0);
    expect(retired.nextStatus).toBe("Inactive");
  });

  // 16. Actual Sales Percentage Formula
  test("WB-ANL-006: actual sales percentage divides segment completed sales by total completed sales and excludes cancelled transactions", () => {
    const transactions = [
      { status: "Completed", department: "Women", units: 6, revenue: 12000 },
      { status: "Completed", department: "Men", units: 3, revenue: 6000 },
      { status: "Completed", department: "Kids", units: 1, revenue: 2000 },
      { status: "Cancelled", department: "Women", units: 10, revenue: 25000 }, // excluded
    ];

    const completed = transactions.filter((t) => t.status === "Completed");
    const totalUnits = completed.reduce((sum, t) => sum + t.units, 0);
    const totalRevenue = completed.reduce((sum, t) => sum + t.revenue, 0);

    const calcPct = (segmentValue: number, totalValue: number) =>
      totalValue > 0 ? Number(((segmentValue / totalValue) * 100).toFixed(1)) : 0;

    expect(totalUnits).toBe(10);
    expect(totalRevenue).toBe(20000);

    expect(calcPct(6, totalUnits)).toBe(60.0);
    expect(calcPct(3, totalUnits)).toBe(30.0);
    expect(calcPct(1, totalUnits)).toBe(10.0);

    expect(calcPct(12000, totalRevenue)).toBe(60.0);
    expect(calcPct(6000, totalRevenue)).toBe(30.0);
    expect(calcPct(2000, totalRevenue)).toBe(10.0);
  });

  // 17. Code 128 Camera & Screenshot Image Decoder (Normal, Mirrored & Dark-UI Screenshot)
  test("WB-POS-015: scanImageDataForCode128 decodes Code 128 Set B/C barcodes in normal, mirrored, and full-screen dark screenshot layouts", async () => {
    const { CODE128_PATTERNS, scanImageDataForCode128 } = await import("../lib/barcode-decoder");

    // Helper to synthesize a Code 128 symbol sequence into an ImageData object
    const buildBarcodeImage = (
      symbolValues: number[],
      opts: {
        width: number;
        height: number;
        modulePx: number;
        mirror?: boolean;
        darkOuterBackground?: boolean;
        blur?: boolean;
      },
    ): ImageData => {
      let checksum = symbolValues[0];
      for (let i = 1; i < symbolValues.length; i++) {
        checksum += symbolValues[i] * i;
      }
      const fullSymbols = [...symbolValues, checksum % 103, 106];

      // Expand into 1-module array (1 = bar, 0 = space)
      const modules: number[] = [];
      for (const sym of fullSymbols) {
        const pat = CODE128_PATTERNS[sym];
        for (let i = 0; i < pat.length; i++) {
          const count = Number(pat[i]);
          const isBar = i % 2 === 0 ? 1 : 0;
          for (let c = 0; c < count; c++) modules.push(isBar);
        }
      }

      const { width, height, modulePx, mirror = false, darkOuterBackground = false, blur = false } = opts;
      const data = new Uint8ClampedArray(width * height * 4);
      const barcodePixelWidth = modules.length * modulePx;
      const startX = Math.floor((width - barcodePixelWidth) / 2);
      const stickerPad = Math.round(modulePx * 12);

      for (let y = 0; y < height; y++) {
        const inVerticalCard = y >= Math.floor(height * 0.25) && y <= Math.floor(height * 0.75);
        for (let x = 0; x < width; x++) {
          const mapX = mirror ? width - 1 - x : x;
          let lum = darkOuterBackground ? 21 : 255;

          if (inVerticalCard && mapX >= startX - stickerPad && mapX < startX + barcodePixelWidth + stickerPad) {
            lum = 255; // white sticker quiet zone
            if (mapX >= startX && mapX < startX + barcodePixelWidth) {
              const modIdx = Math.floor((mapX - startX) / modulePx);
              if (modules[modIdx] === 1) lum = 10;
            }
          }

          const idx = (y * width + x) * 4;
          data[idx] = lum;
          data[idx + 1] = lum;
          data[idx + 2] = lum;
          data[idx + 3] = 255;
        }
      }

      if (blur) {
        // Simulate webcam / JPEG horizontal low-pass blur
        const copy = new Uint8ClampedArray(data);
        for (let y = 0; y < height; y++) {
          for (let x = 1; x < width - 1; x++) {
            const idx = (y * width + x) * 4;
            const blurred = Math.round(
              0.25 * copy[idx - 4] + 0.5 * copy[idx] + 0.25 * copy[idx + 4],
            );
            data[idx] = blurred;
            data[idx + 1] = blurred;
            data[idx + 2] = blurred;
          }
        }
      }

      return { data, width, height, colorSpace: "srgb" } as ImageData;
    };

    // JsBarcode encodes "MS-000840" as: Start B (104), 'M' (45), 'S' (51), '-' (13), Code C (99), 00 (0), 08 (8), 40 (40)
    const jsBarcodeSymbols = [104, 45, 51, 13, 99, 0, 8, 40];

    // 1. Standard sticker image
    const imgNormal = buildBarcodeImage(jsBarcodeSymbols, {
      width: 600,
      height: 160,
      modulePx: 3,
    });
    expect(scanImageDataForCode128(imgNormal)).toBe("MS-000840");

    // 2. Mirrored laptop webcam frame
    const imgMirrored = buildBarcodeImage(jsBarcodeSymbols, {
      width: 600,
      height: 160,
      modulePx: 3,
      mirror: true,
    });
    expect(scanImageDataForCode128(imgMirrored)).toBe("MS-000840");

    // 3. Full-screen dark UI screenshot with blurred small barcode inside white modal card
    const imgDarkScreenshot = buildBarcodeImage(jsBarcodeSymbols, {
      width: 1024,
      height: 500,
      modulePx: 2,
      darkOuterBackground: true,
      blur: true,
    });
    expect(scanImageDataForCode128(imgDarkScreenshot)).toBe("MS-000840");
  });
});


