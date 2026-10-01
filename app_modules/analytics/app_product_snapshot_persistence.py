from datetime import datetime, timedelta


PERIOD_DAYS = {
    "daily": 1,
    "weekly": 7,
    "monthly": 30,
    "quarterly": 90,
    "annually": 365,
}
VALID_PERIODS = {"daily", "weekly", "monthly", "quarterly", "annually", "custom"}


def _safe_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _safe_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _parse_dt(value):
    if not value:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    raw = raw.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        try:
            return datetime.strptime(raw[:10], "%Y-%m-%d")
        except ValueError:
            return None


def _period_start(period_key, now):
    days = PERIOD_DAYS.get(period_key, 30)
    return now - timedelta(days=days)


def _parse_date(value):
    if not value:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        return datetime.strptime(raw[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _resolve_window(period_key, now, custom_start_date=None, custom_end_date=None):
    normalized = str(period_key or "monthly").strip().lower()
    if normalized not in VALID_PERIODS:
        normalized = "monthly"
    if normalized == "custom":
        start_date = _parse_date(custom_start_date)
        end_date = _parse_date(custom_end_date)
        if not start_date or not end_date:
            raise ValueError("Custom range requires valid start_date and end_date in YYYY-MM-DD format.")
        if start_date > end_date:
            raise ValueError("Custom range is invalid: start_date must be before or equal to end_date.")
        start_dt = datetime.combine(start_date, datetime.min.time())
        end_dt = datetime.combine(end_date, datetime.max.time())
        return normalized, start_dt, end_dt, start_date.isoformat(), end_date.isoformat(), f"custom:{start_date.isoformat()}:{end_date.isoformat()}"
    start_dt = _period_start(normalized, now)
    end_dt = now
    return normalized, start_dt, end_dt, start_dt.date().isoformat(), now.date().isoformat(), normalized


def _movement_label(units_sold, stock_quantity):
    if units_sold <= 0:
        return "dead_stock"
    turnover = (units_sold / stock_quantity) if stock_quantity > 0 else float(units_sold)
    if turnover >= 0.4:
        return "fast"
    if turnover >= 0.12:
        return "steady"
    return "slow"


def rebuild_product_analytics_snapshots(
    *,
    fetch_rows,
    table_exists,
    supabase,
    periods=None,
    custom_start_date=None,
    custom_end_date=None,
):
    periods = periods or ["daily", "weekly", "monthly", "quarterly", "annually"]
    periods = [str(period).strip().lower() for period in periods if str(period).strip()]
    if not periods:
        periods = ["monthly"]
    now = datetime.now()

    products = fetch_rows("product")
    inventory_rows = fetch_rows("inventory") if table_exists("inventory") else []
    sales_rows = fetch_rows("sales_transaction")
    sales_detail_rows = fetch_rows("sales_details")
    payment_rows = fetch_rows("payment") if table_exists("payment") else []

    inventory_by_product = {
        str(row.get("product_id") or "").strip(): row
        for row in inventory_rows
        if str(row.get("product_id") or "").strip()
    }
    product_by_id = {
        str(row.get("product_id") or "").strip(): row
        for row in products
        if str(row.get("product_id") or "").strip()
    }

    completed_sales_ids = set()
    if payment_rows:
        for pay in payment_rows:
            status = str(pay.get("payment_status") or "").strip().lower()
            if status in {"completed", "paid"}:
                completed_sales_ids.add(str(pay.get("sales_id") or "").strip())
    else:
        completed_sales_ids = {str(s.get("sales_id") or "").strip() for s in sales_rows}

    sale_date_by_id = {}
    for sale in sales_rows:
        sid = str(sale.get("sales_id") or "").strip()
        if not sid:
            continue
        dt = _parse_dt(sale.get("transaction_date") or sale.get("created_at"))
        sale_date_by_id[sid] = dt

    sales_by_product = {}
    for detail in sales_detail_rows:
        sales_id = str(detail.get("sales_id") or "").strip()
        product_id = str(detail.get("product_id") or "").strip()
        if not sales_id or not product_id:
            continue
        if sales_id not in completed_sales_ids:
            continue
        sale_dt = sale_date_by_id.get(sales_id)
        if not sale_dt:
            continue
        bucket = sales_by_product.setdefault(product_id, [])
        bucket.append(
            {
                "sale_dt": sale_dt,
                "quantity": _safe_float(detail.get("quantity"), 0),
                "subtotal": _safe_float(detail.get("subtotal"), 0),
                "price": _safe_float(detail.get("price"), 0),
            }
        )

    all_snapshot_rows = []
    all_dimension_rows = []
    all_recommendation_rows = []

    delete_scopes = []
    for period in periods:
        period_key, window_start, window_end, window_start_date, window_end_date, scope_key = _resolve_window(
            period,
            now,
            custom_start_date=custom_start_date,
            custom_end_date=custom_end_date,
        )
        delete_scopes.append((period_key, window_start_date, window_end_date, scope_key))
        period_products = []
        for product_id, product in product_by_id.items():
            inv = inventory_by_product.get(product_id, {})
            stock_quantity = _safe_int(inv.get("stock_quantity"), 0)
            reorder_level = _safe_int(inv.get("reorder_level"), _safe_int(product.get("reorder_level"), 0))
            srp = _safe_float(inv.get("srp"), 0)
            unit_price = srp if srp > 0 else _safe_float(product.get("cost_price"), 0)

            txns = sales_by_product.get(product_id, [])
            window_txns = [t for t in txns if window_start <= t["sale_dt"] <= window_end]
            units_sold = sum(t["quantity"] for t in window_txns)
            revenue = sum(t["subtotal"] if t["subtotal"] > 0 else (t["price"] * t["quantity"]) for t in window_txns)
            turnover = (units_sold / stock_quantity) if stock_quantity > 0 else (units_sold if units_sold > 0 else 0)
            movement = _movement_label(units_sold, stock_quantity)

            category_name = str(
                product.get("category_name")
                or product.get("category", "")
                or ""
            ).strip()
            brand = str(product.get("brand") or "").strip()
            size = str(product.get("size") or "").strip()

            row = {
                "product_id": product_id,
                "period_key": period_key,
                "period_start": window_start_date,
                "period_end": window_end_date,
                "window_scope": scope_key,
                "units_sold": int(round(units_sold)),
                "revenue": round(revenue, 2),
                "average_unit_price": round((revenue / units_sold), 2) if units_sold > 0 else round(unit_price, 2),
                "stock_quantity": stock_quantity,
                "turnover_ratio": round(turnover, 4),
                "movement_label": movement,
                "brand": brand or None,
                "size_label": size or None,
                "category_name": category_name or None,
                "computed_at": now.isoformat(),
            }
            period_products.append(row)
            all_snapshot_rows.append(row)

            if movement in {"slow", "dead_stock"} and stock_quantity > 0:
                suggestion = "bundle_or_bogo" if movement == "dead_stock" else "markdown"
                all_recommendation_rows.append(
                    {
                        "product_id": product_id,
                        "period_key": period_key,
                        "recommendation_type": suggestion,
                        "title": f"{'Markdown' if suggestion == 'markdown' else 'Bundle/BOGO'} {product.get('product_name') or 'Product'}",
                        "message": (
                            f"{stock_quantity} units on hand and {int(round(units_sold))} sold in the {period_key} view."
                        ),
                        "period_start": window_start_date,
                        "period_end": window_end_date,
                        "window_scope": scope_key,
                        "severity": "high" if movement == "dead_stock" else "medium",
                        "suggested_discount_min": 10 if suggestion == "markdown" else None,
                        "suggested_discount_max": 15 if suggestion == "markdown" else None,
                        "status": "open",
                        "computed_at": now.isoformat(),
                    }
                )
            if reorder_level > 0 and stock_quantity <= reorder_level:
                all_recommendation_rows.append(
                    {
                        "product_id": product_id,
                        "period_key": period,
                        "recommendation_type": "restock_before_promoting",
                        "title": f"Protect stock for {product.get('product_name') or 'Product'}",
                        "message": f"Stock {stock_quantity}, reorder at {reorder_level}.",
                        "period_start": window_start_date,
                        "period_end": window_end_date,
                        "window_scope": scope_key,
                        "severity": "high",
                        "suggested_discount_min": None,
                        "suggested_discount_max": None,
                        "status": "open",
                        "computed_at": now.isoformat(),
                    }
                )

        # ranking + dimension summaries
        period_products_sorted = sorted(period_products, key=lambda x: (x["units_sold"], x["revenue"]), reverse=True)
        for idx, p in enumerate(period_products_sorted, start=1):
            p["rank_position"] = idx

        for dimension_key, row_key in (("brand", "brand"), ("size", "size_label"), ("category", "category_name")):
            totals = {}
            for p in period_products:
                dim_val = str(p.get(row_key) or "").strip()
                if not dim_val:
                    continue
                entry = totals.setdefault(dim_val, {"units": 0, "revenue": 0.0})
                entry["units"] += _safe_int(p.get("units_sold"), 0)
                entry["revenue"] += _safe_float(p.get("revenue"), 0)
            total_units = sum(v["units"] for v in totals.values()) or 1
            ranked = sorted(totals.items(), key=lambda x: (x[1]["units"], x[1]["revenue"]), reverse=True)
            for idx, (dim_val, agg) in enumerate(ranked, start=1):
                all_dimension_rows.append(
                    {
                        "period_key": period,
                        "period_start": window_start_date,
                        "period_end": window_end_date,
                        "window_scope": scope_key,
                        "dimension_type": dimension_key,
                        "dimension_value": dim_val,
                        "units": int(agg["units"]),
                        "revenue": round(agg["revenue"], 2),
                        "share_percent": round((agg["units"] / total_units) * 100, 2),
                        "rank_position": idx,
                        "computed_at": now.isoformat(),
                    }
                )

    if table_exists("analytics_product_snapshot"):
        for period_key, start_date, end_date, _scope_key in delete_scopes:
            supabase.table("analytics_product_snapshot").delete().eq("period_key", period_key).eq("period_start", start_date).eq("period_end", end_date).execute()
        if all_snapshot_rows:
            supabase.table("analytics_product_snapshot").insert(all_snapshot_rows).execute()

    if table_exists("analytics_dimension_snapshot"):
        for period_key, start_date, end_date, _scope_key in delete_scopes:
            supabase.table("analytics_dimension_snapshot").delete().eq("period_key", period_key).eq("period_start", start_date).eq("period_end", end_date).execute()
        if all_dimension_rows:
            supabase.table("analytics_dimension_snapshot").insert(all_dimension_rows).execute()

    if table_exists("analytics_recommendation"):
        for period_key, start_date, end_date, _scope_key in delete_scopes:
            supabase.table("analytics_recommendation").delete().eq("period_key", period_key).eq("period_start", start_date).eq("period_end", end_date).execute()
        if all_recommendation_rows:
            supabase.table("analytics_recommendation").insert(all_recommendation_rows).execute()

    return {
        "ok": True,
        "snapshots_written": len(all_snapshot_rows),
        "dimension_rows_written": len(all_dimension_rows),
        "recommendations_written": len(all_recommendation_rows),
        "periods": periods,
        "start_date": custom_start_date,
        "end_date": custom_end_date,
        "computed_at": now.isoformat(),
    }
