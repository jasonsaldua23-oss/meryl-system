from datetime import datetime


def normalize_product_id(product_id):
    if product_id is None:
        return ""
    normalized = str(product_id).strip()
    return normalized


def get_inventory_row(product_id, *, safe_int, table_exists, supabase):
    product_id = normalize_product_id(product_id)
    if not product_id or not table_exists("inventory"):
        return None
    rows = (
        supabase.table("inventory")
        .select("*")
        .eq("product_id", product_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    return rows[0] if rows else None


def upsert_inventory_record(
    product_id,
    stock_quantity,
    reorder_level=0,
    reference_id=None,
    *,
    safe_int,
    table_exists,
    get_inventory_row,
    supabase,
):
    product_id = normalize_product_id(product_id)
    if not product_id or not table_exists("inventory"):
        return None

    payload = {
        "product_id": product_id,
        "stock_quantity": max(0, safe_int(stock_quantity, 0)),
        "reorder_level": max(0, safe_int(reorder_level, 0)),
        "reference_id": reference_id,
        "last_updated": datetime.now().isoformat(),
    }
    compatible_payload = dict(payload)
    if compatible_payload.get("reference_id") in ("", None):
        compatible_payload.pop("reference_id", None)
    existing = get_inventory_row(product_id)
    if existing:
        try:
            return (
                supabase.table("inventory")
                .update(compatible_payload)
                .eq("product_id", product_id)
                .execute()
                .data
                or [existing]
            )[0]
        except Exception as exc:
            if "reference_id" not in str(exc):
                raise
            fallback_payload = dict(compatible_payload)
            fallback_payload.pop("reference_id", None)
            return (
                supabase.table("inventory")
                .update(fallback_payload)
                .eq("product_id", product_id)
                .execute()
                .data
                or [existing]
            )[0]
    try:
        created = supabase.table("inventory").insert(compatible_payload).execute().data or []
    except Exception as exc:
        if "reference_id" not in str(exc):
            raise
        fallback_payload = dict(compatible_payload)
        fallback_payload.pop("reference_id", None)
        created = supabase.table("inventory").insert(fallback_payload).execute().data or []
    return created[0] if created else payload


def build_product_sku(product, index):
    if product.get("sku"):
        return product["sku"]

    name = str(product.get("product_name", f"ITEM {index}")).upper()
    cleaned = "".join(ch for ch in name if ch.isalnum() or ch == " ").strip()
    parts = [part[:3] for part in cleaned.split()[:2]]
    prefix = "-".join(parts) if parts else "PRD"
    product_id = product.get("product_id", index)
    return f"{prefix}-{product_id}"


def build_category_lookup(*, ensure_default_categories, fetch_rows):
    ensure_default_categories()
    categories = fetch_rows("category")
    return {row["category_id"]: row.get("category_name", "General") for row in categories}


def build_category_options(*, ensure_default_categories, fetch_rows):
    ensure_default_categories()
    return [
        {
            "category_id": row.get("category_id"),
            "category_name": row.get("category_name", "General"),
        }
        for row in fetch_rows("category")
    ]


def build_filter_options(inventory_products, *, safe_float):
    brands = []
    categories = []
    sizes = []

    for product in inventory_products:
        brand = product.get("brand")
        if brand and brand not in brands:
            brands.append(brand)

        category = product.get("category")
        if category and category not in categories:
            categories.append(category)

        size = product.get("size")
        if size and size not in sizes:
            sizes.append(size)

    return {
        "brands": sorted(brands),
        "categories": sorted(categories),
        "sizes": sorted(
            sizes,
            key=lambda value: safe_float(value, 0)
            if str(value).replace(".", "", 1).isdigit()
            else str(value),
        ),
    }


def build_product_group_key(product, *, slugify_text):
    return slugify_text(
        f"{product.get('product_name', 'product')}-{product.get('brand', 'meryl')}"
    )


def build_price_lookup(*, fetch_rows, safe_int, safe_float):
    sales_details = fetch_rows("sales_details")
    sales_analytics = fetch_rows("sales_analytics")
    return_details = fetch_rows("return_details")

    price_lookup = {}

    sorted_sales_details = sorted(
        sales_details,
        key=lambda item: (safe_int(item.get("sales_id")), safe_int(item.get("sales_detail_id"))),
        reverse=True,
    )
    for detail in sorted_sales_details:
        product_id = detail.get("product_id")
        unit_price = safe_float(detail.get("price"), 0)
        if product_id and product_id not in price_lookup and unit_price > 0:
            price_lookup[product_id] = unit_price

    for item in sales_analytics:
        product_id = item.get("product_id")
        total_qty = safe_int(item.get("total_quantity_sold"), 0)
        total_sales = safe_float(item.get("total_sales"), 0)
        if product_id and product_id not in price_lookup and total_qty > 0:
            price_lookup[product_id] = total_sales / total_qty

    for item in return_details:
        product_id = item.get("product_id")
        qty = safe_int(item.get("quantity"), 0)
        refund_amount = safe_float(item.get("refund_amount"), 0)
        if product_id and product_id not in price_lookup and qty > 0:
            price_lookup[product_id] = refund_amount / qty

    return price_lookup


def build_stock_lookup(*, table_exists, fetch_rows, safe_int):
    inventory_rows = fetch_rows("inventory") if table_exists("inventory") else []
    if inventory_rows:
        stock_lookup = {}
        for row in inventory_rows:
            product_id = row.get("product_id")
            if not product_id:
                continue
            stock_lookup[product_id] = safe_int(row.get("stock_quantity"), 0)
        return stock_lookup

    inventory_logs = fetch_rows("inventory_log")
    stock_lookup = {}
    for row in inventory_logs:
        product_id = row.get("product_id")
        if not product_id:
            continue
        stock_lookup[product_id] = stock_lookup.get(product_id, 0) + safe_int(
            row.get("quantity_change"), 0
        )
    return stock_lookup


def normalize_inventory_products(
    products,
    *,
    build_category_lookup,
    build_price_lookup,
    build_stock_lookup,
    build_active_promotion_lookup,
    safe_float,
    safe_int,
    compute_promo_discount,
    build_product_sku,
    build_product_group_key,
):
    category_lookup = build_category_lookup()
    price_lookup = build_price_lookup()
    stock_lookup = build_stock_lookup()
    promotion_lookup = build_active_promotion_lookup()

    normalized = []
    for index, product in enumerate(products, start=1):
        product_id = product.get("product_id")
        category_name = category_lookup.get(product.get("category_id"), "General")
        base_price = safe_float(
            product.get("cost_price", product.get("price", price_lookup.get(product_id, 0))),
            0,
        )
        promo = promotion_lookup.get(product_id)
        promo_discount = compute_promo_discount(base_price, promo)
        final_price = max(base_price - promo_discount, 0)
        stock = safe_int(product.get("stock_quantity"), stock_lookup.get(product_id, 0))
        availability_status = "Available" if stock > 0 else "Not Available"
        normalized_product = {
            "product_id": product_id,
            "category_id": product.get("category_id"),
            "sku": build_product_sku(product, index),
            "product_name": product.get("product_name", "Unknown Product"),
            "brand": product.get("brand", "Meryl"),
            "category": category_name,
            "color": str(product.get("color", "Default")).strip() or "Default",
            "gender": str(product.get("gender", "")).strip() or "",
            "size": str(product.get("size", "-")).strip() or "-",
            "base_price": base_price,
            "final_price": final_price,
            "promo_name": promo.get("promo_name") if promo else None,
            "promo_discount": promo_discount,
            "promo_type": promo.get("discount_type") if promo else None,
            "promo_value": safe_float(promo.get("discount_value"), 0) if promo else 0,
            "stock_quantity": stock,
            "stock_label": f"{stock} units",
            "availability_status": availability_status,
            "availability_tone": "success" if stock > 0 else "danger",
        }
        normalized_product["group_key"] = build_product_group_key(
            {
                **normalized_product,
                "category_id": normalized_product.get("category_id"),
                "category": category_name,
            }
        )
        normalized.append(normalized_product)

    return normalized


def build_product_lookup(*, normalize_inventory_products, fetch_rows):
    return {item["product_id"]: item for item in normalize_inventory_products(fetch_rows("product"))}


def get_reorder_level(product, *, safe_int):
    return max(0, safe_int(product.get("reorder_level"), 0))


def build_inventory_form_data(form, *, safe_int, safe_float, db_product_status):
    stock_quantity = max(0, safe_int(form.get("stock_quantity"), 0))
    availability_status = "Available" if stock_quantity > 0 else "Not Available"

    category_id = str(form.get("category_id") or "").strip()
    if not category_id:
        return {
            "error": "Category is required.",
            "error_tone": "danger",
        }

    payload = {
        "product_name": form.get("product_name", "").strip(),
        "brand": form.get("brand", "").strip() or "Meryl",
        "category_id": category_id,
        "size": form.get("size", "").strip() or "-",
        "color": (form.get("color") or "Default").strip() or "Default",
        "gender": form.get("gender", "").strip() or "",
        "cost_price": safe_float(form.get("cost_price"), 0),
        "reorder_level": max(0, safe_int(form.get("reorder_level"), 0)),
        "status": db_product_status(availability_status),
    }

    if not payload["product_name"]:
        return {
            "error": "Product name is required.",
            "error_tone": "danger",
        }

    return {
        "error": None,
        "error_tone": None,
        "availability_status": availability_status,
        "stock_quantity": stock_quantity,
        "payload": payload,
    }


def build_inventory_log_payload(
    *,
    product_id,
    quantity_change,
    transaction_type,
    timestamp,
    reference_id=None,
):
    normalized_type = str(transaction_type or "").strip().lower().replace("_", " ")
    transaction_type_map = {
        "sale": "sale",
        "sold": "sale",
        "return": "return",
        "returned": "return",
        "adjustment": "adjustment",
        "adjust": "adjustment",
        "stock in": "restock",
        "stockin": "restock",
        "restock": "restock",
        "stock out": "adjustment",
        "stockout": "adjustment",
    }
    db_transaction_type = transaction_type_map.get(normalized_type, "adjustment")

    payload = {
        "product_id": product_id,
        "quantity_change": quantity_change,
        "transaction_type": db_transaction_type,
        "date_updated": timestamp,
    }
    if reference_id is not None:
        payload["reference_id"] = reference_id
    return payload
