import { describe, expect, it } from "vitest";
import { buildAudience, selectAudience } from "../lib/promotion-audience";

const NOW = new Date(2026, 8, 26);
const customers = [
  { customer_id: "a", name: "Ana", email: "ana@mail.com", gender: "Female", birth_date: "2000-01-15", status: "active" },
  { customer_id: "b", name: "Ben", email: "ben@mail.com", gender: "Male", age: 40, status: "active" },
  { customer_id: "c", name: "Cara", email: "", gender: "Female", age: 22, status: "active" },
  { customer_id: "d", name: "Dan", email: "09171234567@walkin.local", gender: "Male", age: 30, status: "active" },
  { customer_id: "e", name: "Eve", email: "eve@mail.com", gender: "Female", age: 50, status: "inactive" },
];
const completed = (customer_id: string) => ({ customer_id, payment: { payment_status: "completed" } });
const sales = [completed("b"), completed("b"), completed("b"), completed("a"), { customer_id: "a", payment: { payment_status: "failed" } }];
const audience = buildAudience(customers, sales, NOW);

describe("promotion email audience (Use Case 9)", () => {
  it("excludes inactive customers and derives age from birth date", () => {
    expect(audience.map((c) => c.customer_id)).toEqual(["a", "b", "c", "d"]);
    expect(audience.find((c) => c.customer_id === "a")?.age).toBe(26);
  });

  it("VIP = 3+ completed purchases", () => {
    expect(audience.filter((c) => c.isVip).map((c) => c.customer_id)).toEqual(["b"]);
  });

  it("filters by gender and age bracket, skipping unreachable emails", () => {
    const women = selectAudience(audience, { gender: "female", ageBracket: "all", vipOnly: false });
    expect(women.recipients.map((c) => c.customer_id)).toEqual(["a"]);
    expect(women.withoutEmail).toBe(1);
    const twenties = selectAudience(audience, { gender: "all", ageBracket: "25-34", vipOnly: false });
    expect(twenties.recipients.map((c) => c.customer_id)).toEqual(["a"]);
    expect(twenties.withoutEmail).toBe(1); // walk-in placeholder address
  });

  it("VIP only", () => {
    expect(selectAudience(audience, { gender: "all", ageBracket: "all", vipOnly: true }).recipients.map((c) => c.customer_id)).toEqual(["b"]);
  });
});
