from collections import defaultdict
from datetime import datetime, timedelta
import math


def build_predictive_context(
    demand_range="week",
    forecast_range="last6",
    demand_day=None,
    demand_week=None,
    demand_month=None,
    *,
    build_product_lookup,
    fetch_rows,
    build_sale_status_maps,
    safe_int,
    build_demand_range_buckets,
    build_forecast_periods,
    parse_iso_datetime,
    safe_float,
    get_reorder_level,
    weighted_moving_average_forecast,
    linear_regression_forecast,
    blended_recent_forecast,
    sync_prediction_results,
    format_prediction_period_label,
):
    products = build_product_lookup()
    sales_transactions = fetch_rows("sales_transaction")
    sales_details = fetch_rows("sales_details")
    completed_sales, _ = build_sale_status_maps()

    details_by_sale = defaultdict(list)
    details_by_sale_raw = defaultdict(list)
    for detail in sales_details:
        details_by_sale[safe_int(detail.get("sales_id"), 0)].append(detail)
        details_by_sale_raw[str(detail.get("sales_id") or "").strip()].append(detail)

    today = datetime.now().date()
    normalized_forecast_range, forecast_periods = build_forecast_periods(forecast_range)

    def parse_iso_day(day_value):
        try:
            return datetime.strptime(str(day_value or ""), "%Y-%m-%d").date()
        except ValueError:
            return today

    def parse_iso_week(week_value):
        try:
            return datetime.strptime(f"{str(week_value or '')}-1", "%G-W%V-%u").date()
        except ValueError:
            return today - timedelta(days=today.weekday())

    def parse_iso_month(month_value):
        try:
            parsed = datetime.strptime(str(month_value or ""), "%Y-%m")
            return parsed.date().replace(day=1)
        except ValueError:
            return today.replace(day=1)

    def build_day_buckets(selected_day):
        return [
            {
                "label": (selected_day - timedelta(days=offset)).strftime("%b %d"),
                "start": selected_day - timedelta(days=offset),
                "end": selected_day - timedelta(days=offset),
            }
            for offset in range(6, -1, -1)
        ]

    def build_week_buckets(week_start):
        return [
            {
                "label": (week_start + timedelta(days=offset)).strftime("%a"),
                "start": week_start + timedelta(days=offset),
                "end": week_start + timedelta(days=offset),
            }
            for offset in range(7)
        ]

    def build_month_buckets(month_start):
        next_month = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)
        month_end = next_month - timedelta(days=1)
        cursor = month_start
        week_index = 1
        buckets = []
        while cursor <= month_end:
            span_end = min(cursor + timedelta(days=6), month_end)
            buckets.append(
                {
                    "label": f"Week {week_index}",
                    "start": cursor,
                    "end": span_end,
                }
            )
            cursor = span_end + timedelta(days=1)
            week_index += 1
        return buckets

    requested_mode = (demand_range or "week").strip().lower()
    if requested_mode in {"last30", "weekly", "yearly"}:
        requested_mode = {"last30": "day", "weekly": "week", "yearly": "month"}[requested_mode]
    if requested_mode not in {"day", "week", "month"}:
        requested_mode = "week"

    selected_day_value = parse_iso_day(demand_day)
    selected_week_start = parse_iso_week(demand_week)
    selected_month_start = parse_iso_month(demand_month)

    if requested_mode == "day":
        demand_buckets = build_day_buckets(selected_day_value)
    elif requested_mode == "month":
        demand_buckets = build_month_buckets(selected_month_start)
    else:
        demand_buckets = build_week_buckets(selected_week_start)

    normalized_range = requested_mode
    forecast_month_keys = [period.strftime("%Y-%m") for period in forecast_periods]
    forecast_labels = [period.strftime("%b") for period in forecast_periods]
    monthly_sales = {month_key: 0.0 for month_key in forecast_month_keys}
    product_monthly_units = defaultdict(lambda: defaultdict(int))
    product_recent_units = defaultdict(int)
    category_series_lookup = defaultdict(lambda: defaultdict(int))
    category_totals_for_range = defaultdict(int)

    for sale in sales_transactions:
        sales_id = safe_int(sale.get("sales_id"), 0)
        if sales_id not in completed_sales:
            continue

        sale_date = parse_iso_datetime(sale.get("transaction_date"))
        if not sale_date:
            continue

        sale_day = sale_date.date()
        sale_month_key = sale_date.strftime("%Y-%m")
        if sale_month_key in monthly_sales:
            monthly_sales[sale_month_key] += safe_float(sale.get("total_amount"), 0)

        for detail in details_by_sale.get(sales_id, []):
            product_id = safe_int(detail.get("product_id"), 0)
            if product_id <= 0:
                continue

            quantity = safe_int(detail.get("quantity"), 0)
            product_monthly_units[product_id][sale_month_key] += quantity
            if (today - sale_day).days <= 30:
                product_recent_units[product_id] += quantity

            for bucket in demand_buckets:
                if not (bucket["start"] <= sale_day <= bucket["end"]):
                    continue
                category = products.get(product_id, {}).get("category", "General")
                category_series_lookup[category][bucket["label"]] += quantity
                category_totals_for_range[category] += quantity
                break

    forecast_rows = []
    category_totals = defaultdict(int)
    prediction_payloads = []
    for product_id, product in products.items():
        category = product.get("category", "General")
        size = product.get("size", "-")
        display_name = f"{product.get('product_name', 'Unknown')} - Size {size}"
        stock = safe_int(product.get("stock_quantity"), 0)
        reorder_level = get_reorder_level(product)
        sold = product_recent_units.get(product_id, 0)
        month_series = [product_monthly_units[product_id].get(month_key, 0) for month_key in forecast_month_keys]
        effective_series = [value for value in month_series if value > 0]
        moving_average = weighted_moving_average_forecast(effective_series, window=4)
        linear_forecast = linear_regression_forecast(effective_series)
        blended_forecast = blended_recent_forecast(month_series)
        predicted_demand = max(round(max(blended_forecast, sold)), sold)
        method = "Weighted Moving Average" if len(effective_series) < 3 else "Weighted Moving Average + Linear Regression"
        confidence_score = min(96, 58 + (len(effective_series) * 9))
        needs_restock = stock <= reorder_level or stock < predicted_demand
        promotion_candidate = sold <= 2 and stock > reorder_level

        category_totals[category] += predicted_demand
        forecast_rows.append(
            {
                "product_id": product_id,
                "product_name": product.get("product_name", "Unknown"),
                "display_name": display_name,
                "category": category,
                "size": size,
                "forecast": predicted_demand,
                "stock": stock,
                "sold": sold,
                "velocity": round(sold / 30, 1),
                "moving_average": round(moving_average, 2),
                "linear_forecast": round(linear_forecast, 2),
                "blended_forecast": round(blended_forecast, 2),
                "method": method,
                "reorder_level": reorder_level,
                "needs_restock": needs_restock,
                "promotion_candidate": promotion_candidate,
                "decision": "Restock" if needs_restock else "Monitor",
                "promotion_reason": "Low demand but high stock" if promotion_candidate else "Normal movement",
                "confidence_score": confidence_score,
            }
        )
        prediction_payloads.append(
            {
                "product_id": product_id,
                "predicted_demand": predicted_demand,
                "prediction_period": format_prediction_period_label(normalized_range),
                "prediction_date": today.isoformat(),
                "actual_sales": sold,
                "prediction_accuracy": confidence_score,
            }
        )

    sync_prediction_results(prediction_payloads)

    fast_moving = sorted(
        forecast_rows,
        key=lambda item: (item["sold"], item["forecast"]),
        reverse=True,
    )[:4]

    def build_promo_suggestion(row):
        if row["days"] >= 90:
            return ("clearance_sale", "Clearance Sale", 30)
        if row["days"] >= 60:
            return ("percentage", "Percentage Discount", 20)
        if row["days"] >= 45:
            return ("flash_sale", "Flash Sale", 15)
        return ("bundle_deal", "Bundle Deal", 10)

    slow_actions = ["Discount Campaign", "Bundle Offer", "Category Promotion"]
    slow_candidates = [
        row for row in forecast_rows
        if row["sold"] <= 2 or row["promotion_candidate"]
    ]
    if not slow_candidates:
        slow_candidates = sorted(forecast_rows, key=lambda item: (item["sold"], -item["stock"]))[:3]
    slow_moving = [
        {
            **row,
            "days": max(30, (row["stock"] - row["sold"]) * 6) if row["stock"] > row["sold"] else 30,
            "action": slow_actions[index % len(slow_actions)],
        }
        for index, row in enumerate(sorted(slow_candidates, key=lambda item: (item["sold"], -item["stock"]))[:3])
    ]
    for row in slow_moving:
        suggested_type, suggested_label, suggested_discount = build_promo_suggestion(row)
        row["suggested_type"] = suggested_type
        row["suggested_type_label"] = suggested_label
        row["suggested_discount"] = suggested_discount
        row["suggested_name"] = f"{row['product_name']} Slow-Moving Promo"
        row["suggested_duration_days"] = 14 if row["days"] <= 60 else 21
        row["target_product_id"] = row["product_id"]

    restock_candidates = [
        row for row in forecast_rows
        if row["needs_restock"]
    ]
    restock_rows = [
        {
            "product_name": row["product_name"],
            "display_name": row["display_name"],
            "stock": row["stock"],
            "forecast": row["forecast"],
            "urgency": "HIGH" if row["stock"] <= row["reorder_level"] else "MEDIUM",
            "stockout_days": max(3, math.ceil(row["stock"] / max(row["velocity"], 0.1))) if row["stock"] > 0 else 0,
            "order_qty": max(row["forecast"] - row["stock"], row["reorder_level"]),
            "method": row["method"],
        }
        for row in sorted(
            restock_candidates,
            key=lambda item: (item["stock"] - item["reorder_level"], item["forecast"] - item["stock"]),
        )
    ][:4]

    preferred_categories = ["Running Shoes", "Casual Shoes", "Basketball Shoes", "Formal Shoes", "Sandals"]
    chart_categories = [category for category in preferred_categories if category in category_totals_for_range]
    chart_categories.extend(
        category
        for category, _ in sorted(category_totals_for_range.items(), key=lambda item: item[1], reverse=True)
        if category not in chart_categories
    )
    chart_categories = chart_categories[:4]

    series_tones = ["cream", "gold", "soft", "pale"]
    chart_peak = max([value for bucket_values in category_series_lookup.values() for value in bucket_values.values()] + [0])
    category_chart = []
    for bucket in demand_buckets:
        series = []
        for category_index, category in enumerate(chart_categories):
            value = category_series_lookup[category][bucket["label"]]
            height = 26 if chart_peak <= 0 else max(26, round((value / chart_peak) * 140))
            series.append(
                {
                    "category": category,
                    "value": value,
                    "height": height,
                    "tone": series_tones[category_index % len(series_tones)],
                }
            )
        category_chart.append({"label": bucket["label"], "series": series})

    actual_values = [round(monthly_sales[month_key], 2) for month_key in forecast_month_keys]
    effective_actual_values = [value for value in actual_values if value > 0]
    global_moving_average = weighted_moving_average_forecast(effective_actual_values, window=4)
    global_linear_forecast = linear_regression_forecast(effective_actual_values)
    next_month_prediction = blended_recent_forecast(actual_values)

    predicted_values = []
    historical_baseline = []
    for actual in actual_values:
        if not historical_baseline:
            predicted_values.append(round(actual, 2))
        else:
            predicted_values.append(round(blended_recent_forecast(historical_baseline), 2))
        if actual > 0:
            historical_baseline.append(actual)

    accuracy_values = []
    for actual, predicted in zip(actual_values, predicted_values):
        if actual <= 0 or predicted <= 0:
            accuracy_values.append(0)
        else:
            error_ratio = abs(actual - predicted) / actual
            accuracy_values.append(max(0, min(99, round((1 - error_ratio) * 100))))

    peak_value = max(actual_values + predicted_values + [1])
    y_axis_labels = [round(peak_value * ratio) for ratio in (1, 0.75, 0.5, 0.25, 0)]
    point_count = max(len(forecast_periods), 1)
    if point_count == 1:
        x_coords = [500]
        point_positions = [50]
    else:
        step = 1000 / (point_count - 1)
        x_coords = [round(step * index, 1) for index in range(point_count)]
        point_positions = [round((index / (point_count - 1)) * 100, 2) for index in range(point_count)]

    def chart_y(value):
        if peak_value <= 0:
            return 360
        return round(360 - ((value / peak_value) * 320), 1)

    sales_forecast = {
        "months": forecast_labels,
        "actual_values": actual_values,
        "predicted_values": predicted_values,
        "accuracy_values": accuracy_values,
        "y_axis_labels": y_axis_labels,
        "point_positions": point_positions,
        "actual_points": " ".join(f"{x},{chart_y(value)}" for x, value in zip(x_coords, actual_values)),
        "predicted_points": " ".join(f"{x},{chart_y(value)}" for x, value in zip(x_coords, predicted_values)),
        "actual_y_points": [chart_y(value) for value in actual_values],
        "predicted_y_points": [chart_y(value) for value in predicted_values],
        "x_coords": x_coords,
        "point_count": point_count,
        "next_month_prediction": round(next_month_prediction, 2),
        "method_summary": "Weighted recent average plus linear trend from completed monthly sales",
        "input_summary": "Recent and past completed POS sales records",
        "moving_average": round(global_moving_average, 2),
        "linear_forecast": round(global_linear_forecast, 2),
    }

    completed_sales_ids = {str(item).strip() for item in completed_sales}
    customer_rows = fetch_rows("customer")
    customer_lookup = {
        str(row.get("customer_id") or "").strip(): row
        for row in customer_rows
    }
    customer_segment_map = defaultdict(
        lambda: {
            "transactions": 0,
            "total_spent": 0.0,
            "last_purchase": None,
            "category_counts": defaultdict(int),
            "used_promo_count": 0,
        }
    )
    active_promo_lookup = {}
    for product in products.values():
        product_name = str(product.get("product_name") or "").strip().lower()
        promo_name = str(product.get("promo_name") or "").strip()
        if product_name:
            active_promo_lookup[product_name] = bool(promo_name)

    for sale in sales_transactions:
        sale_id = str(sale.get("sales_id") or "").strip()
        if sale_id not in completed_sales_ids:
            continue

        customer_id = str(sale.get("customer_id") or "").strip()
        if not customer_id:
            continue

        sale_date = parse_iso_datetime(sale.get("transaction_date"))
        sale_amount = safe_float(sale.get("total_amount"), 0)
        entry = customer_segment_map[customer_id]
        entry["transactions"] += 1
        entry["total_spent"] += sale_amount
        if sale_date and (not entry["last_purchase"] or sale_date > entry["last_purchase"]):
            entry["last_purchase"] = sale_date

        for detail in details_by_sale_raw.get(sale_id, []):
            product_id = safe_int(detail.get("product_id"), 0)
            category = products.get(product_id, {}).get("category", "General")
            quantity = safe_int(detail.get("quantity"), 0)
            entry["category_counts"][category] += quantity
            product_name = str(products.get(product_id, {}).get("product_name") or "").strip().lower()
            if product_name and active_promo_lookup.get(product_name):
                entry["used_promo_count"] += 1

    customer_segments = []
    for customer_id, summary in customer_segment_map.items():
        customer = customer_lookup.get(customer_id, {})
        category_counts = summary["category_counts"]
        preferred_category = (
            max(category_counts.items(), key=lambda item: item[1])[0]
            if category_counts
            else "General"
        )
        transactions = summary["transactions"]
        total_spent = summary["total_spent"]
        promo_ratio = summary["used_promo_count"] / max(transactions, 1)
        recency_days = (
            (today - summary["last_purchase"].date()).days
            if summary["last_purchase"]
            else 999
        )
        avg_ticket = total_spent / max(transactions, 1)

        if recency_days > 45:
            segment = "Inactive Buyers"
            campaign = "Win-back promo"
        elif transactions >= 4 and total_spent >= 5000:
            segment = "Loyal High Spenders"
            campaign = "VIP early access"
        elif promo_ratio >= 0.4:
            segment = "Discount Responders"
            campaign = "Limited-time discount"
        elif preferred_category and preferred_category != "General":
            segment = f"{preferred_category} Buyers"
            campaign = "Category bundle offer"
        else:
            segment = "Frequent Buyers"
            campaign = "Loyalty points booster"

        customer_segments.append(
            {
                "name": customer.get("customer_name", "Walk-in Customer"),
                "segment": segment,
                "campaign": campaign,
                "preferred_category": preferred_category,
                "transactions": transactions,
                "avg_ticket": round(avg_ticket, 2),
                "total_spent": round(total_spent, 2),
                "recency_days": recency_days,
            }
        )

    customer_segments = sorted(
        customer_segments,
        key=lambda item: (item["recency_days"], -item["transactions"], -item["total_spent"]),
    )[:8]

    if forecast_rows:
        sync_prediction_results(
            [
                {
                    "product_id": row["product_id"],
                    "predicted_demand": row["forecast"],
                    "prediction_period": format_prediction_period_label(normalized_forecast_range),
                    "prediction_date": today.isoformat(),
                    "actual_sales": row["sold"],
                    "prediction_accuracy": row.get("confidence_score", 0),
                }
                for row in forecast_rows
            ]
        )

    return (
        dict(category_totals),
        category_chart,
        forecast_rows,
        fast_moving,
        slow_moving,
        restock_rows,
        customer_segments,
        chart_categories,
        sales_forecast,
        normalized_range,
        normalized_forecast_range,
        selected_day_value.isoformat(),
        f"{selected_week_start.isocalendar().year}-W{selected_week_start.isocalendar().week:02d}",
        selected_month_start.strftime("%Y-%m"),
    )


def build_reports_context(
    *,
    build_sale_status_maps,
    fetch_rows,
    build_product_lookup,
    normalize_inventory_products,
    build_customer_lookup,
    safe_int,
    parse_iso_datetime,
    safe_float,
    build_chart_points,
    sync_sales_summary_entry,
    get_reorder_level,
):
    completed_sales, _ = build_sale_status_maps()
    sales_transactions = fetch_rows("sales_transaction")
    sales_details = fetch_rows("sales_details")
    product_lookup = build_product_lookup()
    inventory_products = normalize_inventory_products(fetch_rows("product"))
    customer_lookup = build_customer_lookup()

    completed_transactions = [
        sale
        for sale in sales_transactions
        if safe_int(sale.get("sales_id"), 0) in completed_sales
    ]

    revenue_by_date = defaultdict(float)
    revenue_by_week = defaultdict(float)
    revenue_by_month = defaultdict(float)
    details_by_sale = defaultdict(list)
    for detail in sales_details:
        details_by_sale[safe_int(detail.get("sales_id"), 0)].append(detail)

    units_sold = 0
    product_totals = defaultdict(lambda: {"units": 0, "sales": 0.0})
    product_recent_units = defaultdict(int)
    completed_dates = []
    customer_target_map = defaultdict(
        lambda: {
            "transactions": 0,
            "total_spent": 0.0,
            "last_purchase": None,
            "category_counts": defaultdict(int),
        }
    )
    today = datetime.now().date()

    for sale in completed_transactions:
        sales_id = safe_int(sale.get("sales_id"), 0)
        sale_date = parse_iso_datetime(sale.get("transaction_date"))
        if not sale_date:
            continue

        sale_day = sale_date.strftime("%Y-%m-%d")
        sale_amount = safe_float(sale.get("total_amount"), 0)
        revenue_by_date[sale_day] += sale_amount
        week_start = (sale_date - timedelta(days=sale_date.weekday())).strftime("%Y-%m-%d")
        revenue_by_week[week_start] += sale_amount
        month_key = sale_date.strftime("%Y-%m")
        revenue_by_month[month_key] += sale_amount
        completed_dates.append(sale_date.date())

        customer_id = safe_int(sale.get("customer_id"), 0)
        if customer_id > 0:
            customer_entry = customer_target_map[customer_id]
            customer_entry["transactions"] += 1
            customer_entry["total_spent"] += sale_amount
            customer_entry["last_purchase"] = (
                sale_date
                if (not customer_entry["last_purchase"] or sale_date > customer_entry["last_purchase"])
                else customer_entry["last_purchase"]
            )

        for detail in details_by_sale.get(sales_id, []):
            product_id = detail.get("product_id")
            quantity = safe_int(detail.get("quantity"), 0)
            line_sales = safe_float(detail.get("subtotal"), 0)
            if line_sales <= 0:
                line_sales = max(
                    (safe_float(detail.get("price"), 0) * quantity) - safe_float(detail.get("discount_applied"), 0),
                    0,
                )
            units_sold += quantity
            product_totals[product_id]["units"] += quantity
            product_totals[product_id]["sales"] += line_sales
            if (today - sale_date.date()).days <= 30:
                product_recent_units[product_id] += quantity
            if customer_id > 0:
                customer_target_map[customer_id]["category_counts"][
                    product_lookup.get(product_id, {}).get("category", "General")
                ] += quantity

    revenue_points = [
        {"date": date_key, "value": round(value, 2)}
        for date_key, value in sorted(revenue_by_date.items())
    ]
    if not revenue_points:
        revenue_points = [{"date": datetime.now().strftime("%Y-%m-%d"), "value": 0.0}]

    revenue_chart = build_chart_points(revenue_points, "date", "value", min_height=92, max_height=240)
    total_revenue = round(sum(point["value"] for point in revenue_points), 2)
    max_revenue_value = max((point["value"] for point in revenue_points), default=0.0)
    revenue_breakdown = []
    for point in revenue_points:
        point_value = safe_float(point.get("value"), 0)
        revenue_breakdown.append(
            {
                "date": point.get("date", ""),
                "value": round(point_value, 2),
                "width": max(14, round((point_value / max(max_revenue_value, 1)) * 100)) if point_value > 0 else 14,
                "share": round((point_value / max(total_revenue, 1)) * 100) if point_value > 0 else 0,
            }
        )

    daily_summary = [
        {"label": point["date"], "value": point["value"]}
        for point in revenue_points[-5:][::-1]
    ]
    for point in revenue_points:
        sync_sales_summary_entry(point["date"])
    weekly_summary = [
        {"label": f"Week of {week_key}", "value": round(value, 2)}
        for week_key, value in sorted(revenue_by_week.items())[-4:][::-1]
    ]
    monthly_summary = [
        {
            "label": datetime.strptime(month_key, "%Y-%m").strftime("%b %Y"),
            "value": round(value, 2),
        }
        for month_key, value in sorted(revenue_by_month.items())[-4:][::-1]
    ]

    average_stock = (
        sum(max(safe_int(product.get("stock_quantity"), 0), 0) for product in inventory_products) / len(inventory_products)
        if inventory_products
        else 0
    )
    inventory_turnover = round(units_sold / max(average_stock, 1), 1) if units_sold else 0.0

    if completed_dates:
        tracked_days = max((max(completed_dates) - min(completed_dates)).days + 1, 1)
        avg_days_to_sell = max(1, round(tracked_days / max(len(completed_transactions), 1)))
    else:
        avg_days_to_sell = 0

    top_products = []
    for product_id, totals in sorted(
        product_totals.items(),
        key=lambda item: (item[1]["units"], item[1]["sales"]),
        reverse=True,
    )[:5]:
        product = product_lookup.get(product_id, {})
        base_price = safe_float(product.get("base_price"), 0)
        final_price = safe_float(product.get("final_price", base_price), base_price)
        if base_price > 0:
            margin = round(((final_price - base_price) / base_price) * 100, 1)
        else:
            margin = 0.0
        top_products.append(
            {
                "name": product.get("product_name", "Unknown Product"),
                "display_name": f"{product.get('product_name', 'Unknown Product')} - Size {product.get('size', '-')}",
                "category": product.get("category", "General"),
                "units": totals["units"],
                "sales": round(totals["sales"], 2),
                "margin": margin,
            }
        )

    slow_moving_products = []
    for product in inventory_products:
        recent_units = product_recent_units.get(product.get("product_id"), 0)
        reorder_level = get_reorder_level(product)
        slow_moving_products.append(
            {
                "display_name": f"{product.get('product_name', 'Unknown Product')} - Size {product.get('size', '-')}",
                "category": product.get("category", "General"),
                "units": recent_units,
                "stock": safe_int(product.get("stock_quantity"), 0),
                "threshold": reorder_level,
                "status": "Slow Moving" if recent_units <= 2 else "Normal",
                "action": "Use for promotion" if recent_units <= 2 else "Monitor",
            }
        )
    slow_moving_products = sorted(slow_moving_products, key=lambda item: (item["units"], -item["stock"]))[:5]

    inventory_status_rows = []
    for product in sorted(inventory_products, key=lambda item: safe_int(item.get("stock_quantity"), 0)):
        stock = safe_int(product.get("stock_quantity"), 0)
        reorder_level = get_reorder_level(product)
        if stock == 0:
            status = "Out of Stock"
            tone = "danger"
        elif stock <= reorder_level:
            status = "Low Stock"
            tone = "warning"
        else:
            status = "Sufficient"
            tone = "success"
        inventory_status_rows.append(
            {
                "display_name": f"{product.get('product_name', 'Unknown Product')} - Size {product.get('size', '-')}",
                "stock": stock,
                "reorder_level": reorder_level,
                "status": status,
                "tone": tone,
            }
        )
    inventory_status_rows = inventory_status_rows[:5]

    customer_targets = []
    for customer_id, summary in customer_target_map.items():
        customer = customer_lookup.get(customer_id, {})
        preferred_category = "General"
        if summary["category_counts"]:
            preferred_category = max(summary["category_counts"].items(), key=lambda item: item[1])[0]
        customer_targets.append(
            {
                "name": customer.get("customer_name", "Walk-in Customer"),
                "contact": customer.get("email") or customer.get("phone") or "-",
                "transactions": summary["transactions"],
                "total_spent": round(summary["total_spent"], 2),
                "preferred_category": preferred_category,
                "last_purchase": summary["last_purchase"].strftime("%Y-%m-%d") if summary["last_purchase"] else "N/A",
            }
        )
    customer_targets = sorted(
        customer_targets,
        key=lambda item: (item["transactions"], item["total_spent"]),
        reverse=True,
    )[:5]

    return (
        revenue_points,
        revenue_chart,
        revenue_breakdown,
        daily_summary,
        weekly_summary,
        monthly_summary,
        total_revenue,
        units_sold,
        inventory_turnover,
        avg_days_to_sell,
        top_products,
        slow_moving_products,
        inventory_status_rows,
        customer_targets,
    )
