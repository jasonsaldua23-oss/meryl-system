from collections import defaultdict


def build_sale_status_maps(*, fetch_rows, safe_int, parse_iso_datetime, datetime_cls):
    completed_sales = set()
    for row in fetch_rows("inventory_log"):
        transaction_type = str(row.get("transaction_type", "")).strip().lower()
        if transaction_type not in {"sale", "sale_completed"}:
            continue
        sales_id = str(row.get("reference_id") or "").strip()
        if sales_id:
            completed_sales.add(sales_id)

    denied_sales = {}
    return_rows = sorted(
        fetch_rows("returns"),
        key=lambda item: parse_iso_datetime(item.get("return_date")) or datetime_cls.min,
        reverse=True,
    )
    return_detail_rows = fetch_rows("return_details")
    reason_by_return_id = {}
    for detail in return_detail_rows:
        return_id = str(detail.get("return_id") or "").strip()
        reason = str(detail.get("reason") or "").strip()
        if return_id and reason and return_id not in reason_by_return_id:
            reason_by_return_id[return_id] = reason

    for row in return_rows:
        sales_id = str(row.get("sales_id") or "").strip()
        return_id = str(row.get("return_id") or "").strip()
        if not sales_id or sales_id in denied_sales:
            continue
        reason = reason_by_return_id.get(return_id, "").strip()
        if reason and reason.lower() != "return processed":
            denied_sales[sales_id] = reason

    # Fallback source of truth: payment status.
    # If a transaction was marked failed by admin flow, it is denied.
    # Also treat paid/completed payments as completed sales.
    payment_rows = fetch_rows("payment")
    for payment in payment_rows:
        sales_id = str(payment.get("sales_id") or "").strip()
        payment_status = str(payment.get("payment_status") or "").strip().lower()
        if not sales_id:
            continue
        if payment_status in {"completed", "paid", "success", "successful"}:
            completed_sales.add(sales_id)
        if payment_status == "failed" and sales_id not in denied_sales:
            denied_sales[sales_id] = "Declined by administrator"

    return completed_sales, denied_sales


def sync_sales_summary_entry(
    summary_date=None,
    *,
    table_exists,
    datetime_cls,
    build_sale_status_maps,
    fetch_rows,
    safe_int,
    safe_float,
    defaultdict_cls,
    parse_iso_datetime,
    supabase,
):
    """No-op: sales_summary is kept up to date by the database itself.

    A trigger refreshes each store day (Asia/Manila) whenever a sale changes;
    see database/phase6_stored_analytics_and_cleanup.sql. This older writer
    used UTC dates and would overwrite those rows, so it no longer runs.
    """
    return


def build_chart_points(items, label_key, value_key, min_height=72, max_height=240, *, safe_float):
    values = [safe_float(item.get(value_key), 0) for item in items]
    peak = max(values, default=0)
    chart_points = []

    for item in items:
        value = safe_float(item.get(value_key), 0)
        ratio = (value / peak) if peak else 0
        height = min_height + ((max_height - min_height) * ratio if peak else 0)
        chart_points.append(
            {
                **item,
                "label": item.get(label_key, ""),
                "value": value,
                "height": round(height, 1),
                "ratio": round(ratio * 100, 1),
            }
        )

    return chart_points


def build_sales_rows(
    *,
    build_product_lookup,
    build_customer_lookup,
    build_sale_status_maps,
    fetch_rows,
    parse_iso_datetime,
    datetime_cls,
    safe_int,
    safe_float,
):
    def normalize_id(value):
        return str(value or "").strip()

    product_lookup = build_product_lookup()
    customer_lookup = build_customer_lookup()
    completed_sales, denied_sales = build_sale_status_maps()
    sales_transactions = sorted(
        fetch_rows("sales_transaction"),
        key=lambda item: parse_iso_datetime(item.get("transaction_date")) or datetime_cls.min,
        reverse=True,
    )

    sales_details = fetch_rows("sales_details")
    details_by_sale = {}
    for detail in sales_details:
        sale_id_key = normalize_id(detail.get("sales_id"))
        if sale_id_key:
            details_by_sale.setdefault(sale_id_key, []).append(detail)

    sales_rows = []
    for index, sale in enumerate(sales_transactions, start=1):
        sales_id = normalize_id(sale.get("sales_id"))
        if not sales_id:
            continue
        sale_details = details_by_sale.get(sales_id, [])
        customer = customer_lookup.get(sale.get("customer_id"), {})
        sale_date = parse_iso_datetime(sale.get("transaction_date"))
        total_qty = sum(safe_int(detail.get("quantity"), 0) for detail in sale_details)

        detail_summaries = []
        for detail in sale_details:
            product = product_lookup.get(detail.get("product_id"), {})
            detail_summaries.append(
                f"{product.get('product_name', 'Unknown Product')} (Size {product.get('size', '-')}) x{safe_int(detail.get('quantity'), 0)}"
            )

        if sale_details:
            first_product = product_lookup.get(sale_details[0].get("product_id"), {})
            product_name = first_product.get("product_name", "Mixed Items")
            if len(sale_details) > 1:
                product_name = f"{product_name} +{len(sale_details) - 1} more"
        else:
            product_name = "Mixed Items"

        status = "Pending"
        reason = ""
        if sales_id in denied_sales:
            status = "Denied"
            reason = denied_sales[sales_id]
        elif sales_id in completed_sales:
            status = "Completed"

        compact_order_id = sales_id.replace("-", "").upper()[:8]
        if not compact_order_id:
            compact_order_id = f"{index:03d}"

        sales_rows.append(
            {
                "sale_id": sales_id,
                "order_id": f"ORD-{compact_order_id}",
                "customer_name": customer.get("customer_name", "Walk-in Customer"),
                "product_name": product_name,
                "product_details": " | ".join(detail_summaries) if detail_summaries else "No item details",
                "quantity": total_qty,
                "amount": safe_float(sale.get("total_amount"), 0),
                "payment_method": str(sale.get("payment_method", "cash")).upper(),
                "status": status,
                "reason": reason,
                "status_tone": "success" if status == "Completed" else "danger" if status == "Denied" else "warning",
                "date": sale_date.strftime("%b %d, %Y") if sale_date else "N/A",
                "can_complete": status == "Pending",
                "can_deny": status == "Pending",
            }
        )

    return sales_rows
