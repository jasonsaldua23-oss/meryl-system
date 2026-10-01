import React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { PointOfSale } from "../app/components/PointOfSale";

const fixtures = vi.hoisted(() => ({ customers: [] as any[] }));

vi.mock("../lib/hooks", () => ({
  useProducts: () => ({ data: [] }),
  useInventory: () => ({ data: [] }),
  useCustomers: () => ({ data: fixtures.customers }),
  usePromotions: () => ({ data: [] }),
}));
vi.mock("../lib/auth-context", () => ({
  useAuth: () => ({ user: { username: "cashier", role_name: "sales" }, validateCredentials: vi.fn() }),
  getRoleGroup: () => "sales",
}));
vi.mock("../lib/api/audit-logger", () => ({ logAuditEvent: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: {} }));

describe("POS page startup", () => {
  it.each([
    { customers: [] },
    { customers: [{ customer_id: "customer-1", name: "Customer One", contact_number: "09123456789" }] },
  ])("renders without initialization errors with customer data $customers", ({ customers }) => {
    fixtures.customers = customers;
    const client = new QueryClient();
    try {
      const html = renderToString(
        <QueryClientProvider client={client}>
          <PointOfSale />
        </QueryClientProvider>,
      );
      expect(html).toContain("Product Selection");
      expect(html).toContain("Search Products");
      expect(html).toContain("Complete Payment &amp; Checkout");
    } finally {
      client.clear();
    }
  });
});
