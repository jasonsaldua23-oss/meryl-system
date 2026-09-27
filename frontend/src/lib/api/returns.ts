import { createRow, getRowById, listRows, removeRow, updateRow } from "./_common";
import { supabase } from "../supabase";

const RETURNS_JOIN = "*, sales_transaction:sales_transaction(*, customer:customer(*)), user:user(user_id, name, username, role_id, email, avatar_url, staff_code), return_details:return_details(*, product:product_id(*, category(*), inventory(*)))";
const RETURNS_DETAILS_JOIN = RETURNS_JOIN;

export const returnsApi = {
  list: () => listRows("returns", RETURNS_JOIN, "return_date"),
  listByUser: async (userId: string) => {
    const { data, error } = await supabase
      .from("returns")
      .select(RETURNS_JOIN)
      .eq("user_id", userId)
      .order("return_date", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },
  getById: (id: string) => getRowById("returns", id, RETURNS_DETAILS_JOIN),
  create: (payload: any) => createRow("returns", payload),
  update: (id: string, payload: any) => updateRow("returns", id, payload),
  remove: (id: string) => removeRow("returns", id),
};
