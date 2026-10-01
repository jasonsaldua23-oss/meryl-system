import { describe, expect, it } from "vitest";
import { exactIlikePattern, findCustomerWithEmail, isValidCustomerEmail, normalizeCustomerEmail } from "../lib/customer-validation";

describe("customer email validation", () => {
  it("normalizes email case and whitespace", () => {
    expect(normalizeCustomerEmail("  Customer@Example.COM ")).toBe("customer@example.com");
  });

  it("requires a valid email address", () => {
    expect(isValidCustomerEmail("customer@example.com")).toBe(true);
    expect(isValidCustomerEmail("customer@example")).toBe(false);
    expect(isValidCustomerEmail("")).toBe(false);
  });

  it("escapes wildcard characters in an exact database lookup", () => {
    expect(exactIlikePattern("name_100%@example.com")).toBe("name\\_100\\%@example.com");
  });

  it("detects duplicates case-insensitively and can exclude the edited customer", () => {
    const customers = [{ customer_id: "one", email: "Customer@Example.com" }];
    expect(findCustomerWithEmail(customers, "customer@example.COM")?.customer_id).toBe("one");
    expect(findCustomerWithEmail(customers, "customer@example.com", "one")).toBeNull();
  });
});
