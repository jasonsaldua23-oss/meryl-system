from datetime import datetime


def deny_sale_transaction(
    sales_id,
    sale,
    reason,
    *,
    get_current_user,
    resolve_db_user_row,
    safe_int,
    supabase,
    db_payment_status,
    db_payment_method,
    sync_sales_summary_entry,
):
    current_user = get_current_user() or {}
    db_user = resolve_db_user_row(current_user)
    user_id = str((db_user or {}).get("user_id") or "").strip()
    if not user_id:
        raise ValueError("Unable to resolve the administrator account in the database.")

    # No refund amount is stored (1-to-1 replacements, no cash refunds). The
    # retry covers databases that still have the old required total_refund column.
    return_payload = {
        "sales_id": sales_id,
        "user_id": user_id,
        "return_date": datetime.now().isoformat(),
    }
    try:
        return_record = supabase.table("returns").insert(return_payload).execute()
    except Exception:
        return_record = supabase.table("returns").insert({**return_payload, "total_refund": 0}).execute()
    return_id = str((return_record.data or [{}])[0].get("return_id") or "").strip()
    detail_rows = (
        supabase.table("sales_details")
        .select("product_id")
        .eq("sales_id", sales_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if return_id and detail_rows:
        detail_payload = {
            "return_id": return_id,
            "product_id": detail_rows[0].get("product_id"),
            "quantity_returned": 1,
            "reason": reason,
        }
        try:
            supabase.table("return_details").insert(detail_payload).execute()
        except Exception:
            supabase.table("return_details").insert({**detail_payload, "refund_amount": 0}).execute()
    payment_rows = (
        supabase.table("payment")
        .select("payment_id")
        .eq("sales_id", sales_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if payment_rows:
        supabase.table("payment").update({"payment_status": db_payment_status("failed")}).eq(
            "sales_id", sales_id
        ).execute()
    else:
        supabase.table("payment").insert(
            {
                "sales_id": sales_id,
                "payment_method": db_payment_method(sale.get("payment_method")),
                "amount_paid": 0,
                "change_amount": 0,
                "payment_status": db_payment_status("failed"),
            }
        ).execute()
    sync_sales_summary_entry(str(sale.get("transaction_date") or ""))
