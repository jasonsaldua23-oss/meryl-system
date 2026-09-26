import { getRowById, listRows, removeRow } from "./_common";
import { supabase } from "../supabase";
import { BACKEND_BASE, getBackendAuthHeaders } from "../auth-context";

const PROMO_JOIN = "*, promo_product:promo_product(*, product:product(*))";

function withoutOptionalPromotionColumns(payload: any) {
  const { target_products: _targetProducts, ...fallback } = payload;
  return fallback;
}

function isMissingColumn(error: any, column: string) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes(column.toLowerCase()) && message.includes("column");
}

function missingTargetGoalError() {
  return new Error("Promotion target goal cannot be saved because the database is missing target_sales_goal. Run database/add_promotion_target_sales_goal.sql in Supabase first.");
}

export const promotionsApi = {
  list: () => listRows("promotion", PROMO_JOIN, "created_at"),
  getById: (id: string) => getRowById("promotion", id, PROMO_JOIN),
  create: async (payload: any) => {
    const createPayload = {
      promo_name: payload?.promo_name,
      discount_type: payload?.discount_type,
      discount_value: payload?.discount_value,
      target_sales_goal: payload?.target_sales_goal,
      target_products: payload?.target_products,
      start_date: payload?.start_date,
      end_date: payload?.end_date,
      status: payload?.status,
    } as any;

    // Prefer direct Supabase insert so optional promotion fields such as
    // target_sales_goal persist even when the Flask compatibility route lags.
    let dbCreate = await supabase
      .from("promotion")
      .insert(createPayload)
      .select("*")
      .single();

    if (dbCreate.error && isMissingColumn(dbCreate.error, "target_sales_goal")) {
      throw missingTargetGoalError();
    }

    if (dbCreate.error && isMissingColumn(dbCreate.error, "target_products")) {
      dbCreate = await supabase
        .from("promotion")
        .insert(withoutOptionalPromotionColumns(createPayload))
        .select("*")
        .single();
    }

    if (!dbCreate.error && dbCreate.data) {
      return dbCreate.data;
    }

    // Secondary fallback: Flask route (legacy compatibility).
    const response = await fetch(`${BACKEND_BASE}/api/promotions/public`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await getBackendAuthHeaders()) },
      credentials: "include",
      body: JSON.stringify(createPayload),
    });
    const raw = await response.text();
    let result: any = {};
    try {
      result = raw ? JSON.parse(raw) : {};
    } catch {
      result = {};
    }
    if (response.ok && result?.ok !== false) {
      return result.promotion ?? result;
    }

    throw new Error(
      result?.error ||
      dbCreate.error?.message ||
      `Unable to create promotion (HTTP ${response.status} ${response.statusText}) ${raw ? `- ${raw.slice(0, 300)}` : ""}`.trim(),
    );
  },
  update: async (id: string, payload: any) => {
    const updatePayload = {
      promo_name: payload?.promo_name,
      discount_type: payload?.discount_type,
      discount_value: payload?.discount_value,
      target_sales_goal: payload?.target_sales_goal,
      target_products: payload?.target_products,
      start_date: payload?.start_date,
      end_date: payload?.end_date,
      status: payload?.status,
    } as any;

    // Prefer direct Supabase update so local Flask session/config issues
    // do not block promotion edits from the modal.
    let dbUpdate = await supabase
      .from("promotion")
      .update(updatePayload)
      .eq("promo_id", id)
      .select("*")
      .single();

    if (dbUpdate.error && isMissingColumn(dbUpdate.error, "target_sales_goal")) {
      throw missingTargetGoalError();
    }

    if (dbUpdate.error && isMissingColumn(dbUpdate.error, "target_products")) {
      dbUpdate = await supabase
        .from("promotion")
        .update(withoutOptionalPromotionColumns(updatePayload))
        .eq("promo_id", id)
        .select("*")
        .single();
    }

    if (!dbUpdate.error && dbUpdate.data) {
      return dbUpdate.data;
    }

    // Secondary fallback: Flask route (legacy compatibility).
    const response = await fetch(`${BACKEND_BASE}/api/promotions/${encodeURIComponent(id)}/public`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(await getBackendAuthHeaders()) },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    const raw = await response.text();
    let result: any = {};
    try {
      result = raw ? JSON.parse(raw) : {};
    } catch {
      result = {};
    }

    if (!response.ok || result?.ok === false) {
      throw new Error(
        result?.error ||
          dbUpdate.error?.message ||
          `Unable to update promotion (HTTP ${response.status} ${response.statusText}) ${raw ? `- ${raw.slice(0, 300)}` : ""}`.trim(),
      );
    }
    return result.promotion ?? result;
  },
  remove: (id: string) => removeRow("promotion", id),
};
