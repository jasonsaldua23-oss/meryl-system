from collections import defaultdict
from datetime import datetime
from datetime import timedelta, timezone
import base64
import hashlib
import hmac
from email.message import EmailMessage
from html import escape
import json
import os
import urllib.parse
import urllib.request
import urllib.error

_GMAIL_RUNTIME_STATE = {
    "connected": True,
    "last_error": "",
    "updated_at": None,
}


def _set_gmail_runtime_state(*, connected, last_error=""):
    _GMAIL_RUNTIME_STATE["connected"] = bool(connected)
    _GMAIL_RUNTIME_STATE["last_error"] = str(last_error or "").strip()
    _GMAIL_RUNTIME_STATE["updated_at"] = datetime.now().isoformat()


def get_gmail_runtime_state():
    return dict(_GMAIL_RUNTIME_STATE)


def sync_promotion_notifications(
    promo_id,
    *,
    safe_int,
    table_exists,
    supabase,
    build_sale_status_maps,
    fetch_rows,
    build_customer_lookup,
    customer_ids=None,
):
    """Create pending notification rows for a promotion.

    customer_ids: the recipients chosen by the administrator (Use Case 9: filter
    customer cohorts, then dispatch). When omitted, falls back to past buyers of
    the promoted products, then to all active customers with an email.
    """
    promo_id = str(promo_id or "").strip()
    if not promo_id or not table_exists("notification"):
        return
    selected_ids = None if customer_ids is None else {str(cid).strip() for cid in customer_ids if str(cid).strip()}

    supabase.table("notification").delete().eq("promo_id", promo_id).execute()

    promo_product_rows = (
        supabase.table("promo_product").select("product_id").eq("promo_id", promo_id).execute().data or []
    )
    customer_lookup = build_customer_lookup()
    if selected_ids is not None:
        # Only the chosen cohort, and only active customers with an email.
        customer_ids = {
            cid for cid in selected_ids
            if str(customer_lookup.get(cid, {}).get("email") or "").strip()
            and str(customer_lookup.get(cid, {}).get("status") or "active").strip().lower() == "active"
        }
        product_ids = set()
    else:
        customer_ids = set()
    product_ids = product_ids if selected_ids is not None else {str(row.get("product_id") or "").strip() for row in promo_product_rows if row.get("product_id")}

    if product_ids:
        completed_sales, _ = build_sale_status_maps()
        completed_sales_ids = {str(sale_id).strip() for sale_id in completed_sales}
        sales_transactions = {
            str(row.get("sales_id") or "").strip(): row
            for row in fetch_rows("sales_transaction")
            if row.get("sales_id") is not None
        }
        for detail in fetch_rows("sales_details"):
            if str(detail.get("product_id") or "").strip() not in product_ids:
                continue
            sales_id = str(detail.get("sales_id") or "").strip()
            if sales_id not in completed_sales_ids:
                continue
            customer_id = str(sales_transactions.get(sales_id, {}).get("customer_id") or "").strip()
            if customer_id:
                customer_ids.add(customer_id)

    if not customer_ids and selected_ids is None:
        # React-created promotions may not have promo_product link rows yet.
        # For marketing campaigns, fall back to active customers with email.
        customer_ids = {
            str(customer_id).strip()
            for customer_id, customer in customer_lookup.items()
            if str(customer.get("email") or "").strip()
            and str(customer.get("status") or "active").strip().lower() == "active"
        }

    notification_payloads = []
    for customer_id in customer_ids:
        customer = customer_lookup.get(customer_id, {})
        if not str(customer.get("email") or "").strip():
            continue
        if customer.get("promo_opt_out"):
            continue  # unsubscribed from promotional emails
        notification_payloads.append(
            {
                "customer_id": customer_id,
                "promo_id": promo_id,
                "email_status": "pending",
                "date_sent": datetime.now().isoformat(),
            }
        )

    if notification_payloads:
        supabase.table("notification").insert(notification_payloads).execute()


def _gmail_access_token(*, client_id, client_secret, refresh_token):
    payload = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=payload,
        method="POST",
        headers={"content-type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        data = json.loads(response.read().decode("utf-8"))
    token = str(data.get("access_token") or "").strip()
    if not token:
        raise RuntimeError("gmail_access_token_missing")
    return token


# Store logo shown at the top of promotion emails. It is attached inside the
# email (Content-ID) rather than linked, so it shows without "load images" and
# does not depend on the website being reachable.
LOGO_CID = "meryl-logo"
_LOGO_PATH = os.path.join(os.path.dirname(__file__), "assets", "meryl_logo_email.jpg")
try:
    with open(_LOGO_PATH, "rb") as _logo_file:
        _LOGO_BYTES = _logo_file.read()
except OSError:
    _LOGO_BYTES = b""


def unsubscribe_token(customer_id, secret):
    """Signature for a customer's unsubscribe link (HMAC, so links cannot be guessed)."""
    return hmac.new(str(secret).encode("utf-8"), f"unsubscribe:{customer_id}".encode("utf-8"), hashlib.sha256).hexdigest()[:32]


def verify_unsubscribe_token(customer_id, token, secret):
    if not secret or not customer_id or not token:
        return False
    return hmac.compare_digest(unsubscribe_token(customer_id, secret), str(token))


def unsubscribe_url(base_url, customer_id, secret):
    if not base_url or not secret or not customer_id:
        return ""
    query = urllib.parse.urlencode({"c": customer_id, "t": unsubscribe_token(customer_id, secret)})
    return f"{base_url.rstrip('/')}/api/promotions/unsubscribe?{query}"


def _gmail_send_message(*, access_token, sender_email, sender_name, recipient_email, subject, html_content, unsubscribe_link=""):
    message = EmailMessage()
    message["To"] = recipient_email
    message["From"] = f"{sender_name} <{sender_email}>" if sender_name else sender_email
    message["Subject"] = subject
    if unsubscribe_link:
        # Lets Gmail and other apps show their own "Unsubscribe" button (RFC 8058 one-click).
        message["List-Unsubscribe"] = f"<{unsubscribe_link}>"
        message["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    message.set_content(
        "This email contains a Meryl Shoes promotion. Please view it in an HTML-capable email app."
    )
    message.add_alternative(html_content, subtype="html")
    if _LOGO_BYTES and f"cid:{LOGO_CID}" in html_content:
        html_part = message.get_payload()[1]
        html_part.add_related(_LOGO_BYTES, maintype="image", subtype="jpeg", cid=f"<{LOGO_CID}>", filename="meryl-shoes-logo.jpg")

    raw = base64.urlsafe_b64encode(message.as_bytes()).decode("utf-8")
    payload = json.dumps({"raw": raw}).encode("utf-8")
    request = urllib.request.Request(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        data=payload,
        method="POST",
        headers={
            "authorization": f"Bearer {access_token}",
            "content-type": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def _gmail_error_reason(error_body, fallback):
    """Return a short, UI-safe Gmail error message."""
    body = str(error_body or "").strip()
    if body:
        try:
            parsed = json.loads(body)
            error = parsed.get("error") if isinstance(parsed, dict) else None
            error_code = str(error if isinstance(error, str) else "").strip().lower()
            error_desc = str(parsed.get("error_description") or "").strip()
            if error_code == "invalid_grant" or "expired" in error_desc.lower() or "revoked" in error_desc.lower() or error_desc.lower() == "bad request":
                return "Gmail refresh token expired or revoked. Please update GMAIL_REFRESH_TOKEN via Google Cloud Console / OAuth Playground."
            if isinstance(error, dict):
                message = str(error.get("message") or "").strip()
                status = str(error.get("status") or "").strip()
                if status and message:
                    return f"{status}: {message}"
                if message:
                    return message
            if error_desc:
                return error_desc
        except Exception:
            pass
        return body[:500]
    return fallback


def _clean_promo_name(promo_name):
    name = str(promo_name or "Promotion").strip()
    for token in ("__TYPE_BOGO__", "__TYPE_BUNDLE__"):
        name = name.replace(token, "")
    return name.strip(" -") or "Promotion"


def _campaign_kind(discount_type, promo_name):
    raw = f"{discount_type or ''} {promo_name or ''}".lower()
    if "__type_bogo__" in raw or "bogo" in raw or "buy one" in raw:
        return "bogo"
    if "__type_bundle__" in raw or "bundle" in raw:
        return "bundle"
    if "fixed" in raw or "amount" in raw:
        return "fixed"
    return "percentage"


def _money(value):
    try:
        amount = float(value or 0)
    except (TypeError, ValueError):
        amount = 0
    if amount.is_integer():
        return f"PHP {int(amount):,}"
    return f"PHP {amount:,.2f}"


def _discount_label(kind, discount_value):
    try:
        amount = float(discount_value or 0)
    except (TypeError, ValueError):
        amount = 0

    if kind == "bogo":
        return "Buy 1 Get 1"
    if kind == "bundle":
        return "Bundle Deal"
    if kind == "fixed":
        return f"{_money(amount)} OFF"
    if amount.is_integer():
        return f"{int(amount)}% OFF"
    return f"{amount:g}% OFF"


def _product_price(product):
    for key in ("srp", "selling_price", "selling_price_php", "price", "unit_price", "base_price", "cost_price"):
        if product.get(key) not in (None, ""):
            return _money(product.get(key))
    return "Ask in store"


def _attach_stock(product_rows, inventory_rows, category_rows):
    """Give each product its shelf price, sellable stock and category name,
    using the same inventory rules as the POS."""
    inventory_by_product = {
        str(row.get("product_id") or "").strip(): row for row in inventory_rows if row.get("product_id")
    }
    category_names = {
        str(row.get("category_id") or "").strip(): str(row.get("category_name") or "").strip()
        for row in category_rows
    }
    enriched = []
    for product in product_rows:
        row = dict(product)
        inventory = inventory_by_product.get(str(row.get("product_id") or "").strip(), {})
        on_hand = _to_number(inventory.get("stock_quantity", row.get("stock_quantity")))
        reserved = _to_number(inventory.get("reserved_quantity") or inventory.get("held_stock"))
        row["available_stock"] = max(0, on_hand - reserved)
        row["expiration_date"] = str(inventory.get("expiration_date") or "")[:10]
        if _to_number(inventory.get("srp")) > 0:
            row["srp"] = inventory.get("srp")
        if not row.get("category_name"):
            row["category_name"] = category_names.get(str(row.get("category_id") or "").strip(), "")
        enriched.append(row)
    return enriched


def _to_number(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _is_sellable(product, today):
    """Mirrors the POS: active, in stock (after holds) and not expired."""
    status = str(product.get("status") or "active").strip().lower()
    if status not in ("active", "available"):
        return False
    if _to_number(product.get("available_stock", product.get("stock_quantity"))) <= 0:
        return False
    expiration = str(product.get("expiration_date") or "")[:10]
    return not expiration or expiration >= today


def _top_picks(products, limit=2):
    """One card per style (brand + name), listing every size still in stock,
    best-stocked styles first."""
    styles = {}
    for product in products:
        name = str(product.get("product_name") or product.get("name") or "").strip()
        brand = str(product.get("brand") or "").strip()
        key = (brand.lower(), name.lower())
        style = styles.setdefault(key, {"product": product, "sizes": set(), "stock": 0.0})
        style["stock"] += _to_number(product.get("available_stock", product.get("stock_quantity")))
        size = str(product.get("size") or "").strip()
        if size and size.upper() != "N/A":
            style["sizes"].add(size)
    ranked = sorted(styles.values(), key=lambda style: style["stock"], reverse=True)
    picks = []
    for style in ranked[:limit]:
        pick = dict(style["product"])
        pick["sizes_in_stock"] = sorted(style["sizes"], key=lambda s: (_to_number(s) == 0, _to_number(s), s))
        picks.append(pick)
    return picks


def _product_matches_target(product, target_text):
    parsed = _parse_target_products(target_text)
    if not parsed["categories"] and not parsed["products"]:
        return True

    product_name = str(product.get("product_name") or product.get("name") or "").strip().lower()
    category_name = str(product.get("category_name") or product.get("category") or "").strip().lower()

    if parsed["products"]:
        if product_name not in parsed["products"]:
            return False
        return not parsed["categories"] or category_name in parsed["categories"]
    return category_name in parsed["categories"]


def _parse_target_products(target_text):
    raw = str(target_text or "").strip()
    if not raw or raw.lower() in ("all", "all products"):
        return {"categories": set(), "products": set()}

    categories = set()
    products = set()
    for segment in raw.split("|"):
        value = segment.strip()
        if not value:
            continue
        lowered = value.lower()
        if lowered.startswith("categories:"):
            categories.update(
                item.strip().lower()
                for item in value[len("categories:"):].split(",")
                if item.strip()
            )
            continue
        if lowered.startswith("products:"):
            products.update(
                item.strip().lower()
                for item in value[len("products:"):].split(",")
                if item.strip()
            )
            continue
        if lowered.endswith(" category"):
            categories.add(value[:-len(" category")].strip().lower())
            continue
        products.add(lowered)
    return {"categories": categories, "products": products}


def _target_label(target_products, matching_products, *, linked_product_ids=None):
    parsed = _parse_target_products(target_products)
    linked_product_ids = linked_product_ids or set()
    if not parsed["categories"] and not parsed["products"] and not linked_product_ids:
        return "All Products"
    matched_names = sorted(
        {
            str(product.get("product_name") or product.get("name") or "").strip()
            for product in matching_products
            if str(product.get("product_name") or product.get("name") or "").strip()
        }
    )
    if parsed["products"]:
        return "Products: " + ", ".join(matched_names or sorted(parsed["products"]))
    if parsed["categories"]:
        category_names = sorted(
            {
                str(product.get("category_name") or product.get("category") or "").strip()
                for product in matching_products
                if str(product.get("category_name") or product.get("category") or "").strip()
            }
        )
        return "Categories: " + ", ".join(category_names or sorted(parsed["categories"]))
    names = sorted(
        {
            str(product.get("product_name") or product.get("name") or "").strip()
            for product in matching_products
            if str(product.get("product_name") or product.get("name") or "").strip()
        }
    )
    return "Products: " + ", ".join(names[:4]) if names else "Selected Products"


def _top_pick_reason(product, kind):
    category = str(product.get("category_name") or product.get("category") or "footwear").strip()
    if kind == "bogo":
        return "Great for pairing with a second style while this offer is active."
    if kind == "bundle":
        return "Easy to mix into a value set for everyday rotation."
    if kind == "fixed":
        return "A practical pick when you want comfort with extra savings."
    if "running" in category.lower():
        return "Lightweight comfort with support for daily walks and commutes."
    if "casual" in category.lower():
        return "An easy everyday pair that works with relaxed outfits."
    return "A customer-ready style selected from our current collection."


def _build_promotion_email(
    *,
    customer_name,
    promo_id,
    promo_name,
    discount_type,
    discount_value,
    start_date,
    end_date,
    target_products,
    product_rows,
    promo_product_rows,
    unsubscribe_link="",
):
    kind = _campaign_kind(discount_type, promo_name)
    clean_name = _clean_promo_name(promo_name)
    discount = _discount_label(kind, discount_value)

    templates = {
        "percentage": {
            "subject": f"Step up your game: {discount} your next pair",
            "preview": "Don't walk, run. These styles are moving fast.",
            "headline": "Ready to upgrade your rotation?",
            "body": (
                "Whether you are hitting the pavement or dressing up for a night out, "
                f"we have the perfect pair waiting for you. For a limited time, enjoy {discount} "
                "on selected regular-priced footwear."
            ),
            "cta": "Shop the discounted collection",
        },
        "fixed": {
            "subject": f"A little treat from Meryl Shoes: {discount}",
            "preview": "Save more on your next pair before this offer ends.",
            "headline": "Your next pair just got easier to grab.",
            "body": (
                f"We set aside a {discount} offer for selected styles, so you can refresh "
                "your footwear rotation without stretching the budget."
            ),
            "cta": "Claim your savings",
        },
        "bogo": {
            "subject": "Buy one, get one: your next pair is waiting",
            "preview": "Pair up your favorites while this promo is active.",
            "headline": "Two pairs, one smarter deal.",
            "body": (
                "Pick one pair for daily wear and another for backup, gifting, or a new look. "
                "This Buy 1 Get 1 promotion is available only while qualifying stocks last."
            ),
            "cta": "View BOGO picks",
        },
        "bundle": {
            "subject": "Bundle and save on your next shoe haul",
            "preview": "Build your rotation with a smarter deal.",
            "headline": "Build a set that works harder for you.",
            "body": (
                "Bundle-ready styles help you cover more days, outfits, and activities in one purchase. "
                "Choose qualifying items and enjoy the campaign offer at checkout."
            ),
            "cta": "Build your bundle",
        },
    }
    template = templates.get(kind, templates["percentage"])

    linked_product_ids = {
        str(row.get("product_id") or "").strip()
        for row in promo_product_rows
        if str(row.get("promo_id") or "").strip() == str(promo_id or "").strip()
        and str(row.get("product_id") or "").strip()
    }
    if linked_product_ids:
        matching_products = [
            product for product in product_rows
            if str(product.get("product_id") or "").strip() in linked_product_ids
        ]
    else:
        matching_products = [
            product for product in product_rows if _product_matches_target(product, target_products)
        ]
    # Only recommend what a customer can actually buy today.
    today = datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d")  # Asia/Manila (no DST)
    top_picks = _top_picks([product for product in matching_products if _is_sellable(product, today)])

    html = _render_promotion_email(
        kind=kind,
        template=template,
        campaign=clean_name,
        discount=discount,
        discount_value=discount_value,
        customer_name=customer_name,
        start_date=start_date,
        end_date=end_date,
        target_label=_target_label(target_products, matching_products, linked_product_ids=linked_product_ids),
        top_picks=top_picks,
        unsubscribe_link=unsubscribe_link,
    )

    return {"subject": template["subject"], "html": html}



# ------------------------------------------------------------------------------
# Promotion email layout
# ------------------------------------------------------------------------------
STORE_EMAIL_INFO = {
    "name": "Meryl Shoes",
    "tagline": "Official Retailer & Shoe Center",
    "address": "Araneta Ave, Bacolod, 6100 Negros Occidental",
    "phone": "(034) 435 0128",
    "hours": "Open daily, 7:30 AM - 7:30 PM",
    "maps_url": "https://maps.app.goo.gl/jBPiubj4Y89b7aDh8",  # the store's Google Maps pin
}
_EMAIL_RED = "#D71920"
_EMAIL_RED_DARK = "#A30F15"
_EMAIL_YELLOW = "#FFD60A"
_EMAIL_INK = "#1B1B1F"
_EMAIL_MUTED = "#6B6B73"
_EMAIL_LINE = "#E7E5E0"
_EMAIL_BG = "#F2F1EE"
_EMAIL_FONT = "Arial,Helvetica,sans-serif"


def _email_date(value, *, with_year=False):
    try:
        parsed = datetime.strptime(str(value or "")[:10], "%Y-%m-%d")
    except ValueError:
        return ""
    return parsed.strftime("%b %d, %Y" if with_year else "%b %d").replace(" 0", " ")


def _email_amount(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _sale_price(kind, price, discount_value):
    """Price after the offer for percent / peso-off promotions (None otherwise)."""
    amount = _email_amount(discount_value) or 0
    if price is None or price <= 0:
        return None
    if kind == "percentage" and 0 < amount < 100:
        return round(price * (1 - amount / 100), 2)
    if kind == "fixed" and 0 < amount < price:
        return round(price - amount, 2)
    return None


def _pick_card(product, kind, discount_value):
    name = escape(str(product.get("product_name") or product.get("name") or "Featured pair"))
    brand = escape(str(product.get("brand") or "Meryl Shoes").upper())
    color = str(product.get("color") or "").strip()
    sizes = product.get("sizes_in_stock") or []
    details = []
    if color and color.lower() not in ("default", "n/a"):
        details.append(escape(color))
    if sizes:
        details.append(("Sizes " if len(sizes) > 1 else "Size ") + escape(", ".join(sizes)))
    detail_line = " &middot; ".join(details)

    price = None
    for key in ("srp", "selling_price", "price", "unit_price"):
        price = _email_amount(product.get(key))
        if price:
            break
    sale = _sale_price(kind, price, discount_value)
    if sale is not None:
        price_html = (
            f"<span style='font-size:20px;font-weight:bold;color:{_EMAIL_RED}'>{escape(_money(sale))}</span>"
            f"&nbsp;&nbsp;<span style='font-size:13px;color:{_EMAIL_MUTED};text-decoration:line-through'>{escape(_money(price))}</span>"
        )
    elif price:
        price_html = f"<span style='font-size:20px;font-weight:bold;color:{_EMAIL_INK}'>{escape(_money(price))}</span>"
    else:
        price_html = f"<span style='font-size:14px;color:{_EMAIL_MUTED}'>Ask in store for the price</span>"
    if kind == "bogo":
        price_html += f"<div style='font-size:12px;color:{_EMAIL_RED};font-weight:bold;padding-top:4px'>Buy 1, get the 2nd pair free</div>"
    elif kind == "bundle":
        price_html += f"<div style='font-size:12px;color:{_EMAIL_RED};font-weight:bold;padding-top:4px'>Extra savings when bundled</div>"

    image_url = str(product.get("image_url") or "").strip()
    if image_url.startswith("https://"):
        image_cell = (
            f"<img src='{escape(image_url)}' width='112' height='112' alt='{name}' "
            f"style='display:block;width:112px;height:112px;object-fit:cover;border-radius:10px;border:0;background:{_EMAIL_BG}'>"
        )
    else:
        initial = escape((str(product.get("product_name") or "M").strip()[:1] or "M").upper())
        image_cell = (
            f"<table role='presentation' width='112' cellpadding='0' cellspacing='0' style='border-collapse:collapse'>"
            f"<tr><td width='112' height='112' align='center' valign='middle' "
            f"style='width:112px;height:112px;background:{_EMAIL_BG};border-radius:10px;font:bold 40px {_EMAIL_FONT};color:{_EMAIL_RED}'>{initial}</td></tr></table>"
        )

    return (
        f"<table role='presentation' width='100%' cellpadding='0' cellspacing='0' "
        f"style='border-collapse:separate;border:1px solid {_EMAIL_LINE};border-radius:14px;margin:0 0 14px'>"
        "<tr>"
        f"<td width='112' valign='top' style='padding:14px 0 14px 14px'>{image_cell}</td>"
        f"<td valign='middle' style='padding:14px 16px;font-family:{_EMAIL_FONT}'>"
        f"<div style='font-size:11px;font-weight:bold;letter-spacing:1px;color:{_EMAIL_MUTED}'>{brand}</div>"
        f"<div style='font-size:18px;font-weight:bold;color:{_EMAIL_INK};padding:2px 0 4px'>{name}</div>"
        + (f"<div style='font-size:13px;color:{_EMAIL_MUTED};padding-bottom:8px'>{detail_line}</div>" if detail_line else "")
        + f"<div>{price_html}</div>"
        "</td>"
        "</tr>"
        "</table>"
    )


def _render_promotion_email(*, kind, template, campaign, discount, discount_value, customer_name,
                            start_date, end_date, target_label, top_picks, unsubscribe_link=""):
    store = STORE_EMAIL_INFO
    first_name = (str(customer_name or "").strip().split() or [""])[0]
    greeting = f"Hi {escape(first_name.title())}," if first_name else "Hi there,"
    starts = _email_date(start_date)
    ends = _email_date(end_date, with_year=True)
    window = f"{starts} &ndash; {ends}" if starts and ends else (f"Until {ends}" if ends else "For a limited time")

    big_offer = {
        "bogo": "BUY 1 GET 1",
        "bundle": "BUNDLE &amp; SAVE",
    }.get(kind, escape(discount))
    offer_sub = {
        "percentage": "on selected regular-priced footwear",
        "fixed": "on your next pair of selected styles",
        "bogo": "on selected styles while stocks last",
        "bundle": "when you pair selected styles together",
    }.get(kind, "on selected footwear")
    covers = escape(target_label) if target_label and target_label != "All Products" else "All regular-priced footwear"

    logo = (
        f"<img src='cid:{LOGO_CID}' width='170' alt='Meryl Shoes' "
        "style='display:block;margin:0 auto;width:170px;height:auto;border:0'>"
        if _LOGO_BYTES
        else f"<div style='font:bold 26px {_EMAIL_FONT};color:{_EMAIL_RED}'>MERYL SHOES</div>"
    )

    picks_html = "".join(_pick_card(product, kind, discount_value) for product in top_picks)
    picks_section = (
        f"<tr><td style='padding:8px 32px 6px;font-family:{_EMAIL_FONT}'>"
        f"<div style='font-size:12px;font-weight:bold;letter-spacing:2px;color:{_EMAIL_RED}'>PICKED FOR YOU</div>"
        f"<div style='font-size:22px;font-weight:bold;color:{_EMAIL_INK};padding:4px 0 14px'>In stock and on sale now</div>"
        f"{picks_html}"
        "</td></tr>"
        if picks_html
        else ""
    )

    steps = [
        ("1", "Visit Meryl Shoes", "Araneta Ave, Bacolod"),
        ("2", "Pick your pair", covers),
        ("3", "Pay at the counter", "The discount is applied automatically"),
    ]
    steps_html = "".join(
        f"<td width='33%' valign='top' style='padding:0 6px;font-family:{_EMAIL_FONT};text-align:center'>"
        f"<div style='width:30px;height:30px;line-height:30px;margin:0 auto 8px;border-radius:15px;"
        f"background:{_EMAIL_YELLOW};color:{_EMAIL_INK};font-weight:bold;font-size:14px'>{num}</div>"
        f"<div style='font-size:14px;font-weight:bold;color:{_EMAIL_INK}'>{title}</div>"
        f"<div style='font-size:12px;color:{_EMAIL_MUTED};line-height:1.45;padding-top:3px'>{text}</div>"
        "</td>"
        for num, title, text in steps
    )

    return (
        # Inbox preview text (hidden in the body).
        f"<div style='display:none;max-height:0;overflow:hidden;opacity:0;color:transparent'>{escape(template['preview'])}</div>"
        f"<table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='background:{_EMAIL_BG};border-collapse:collapse'>"
        "<tr><td align='center' style='padding:24px 12px'>"
        "<table role='presentation' width='600' cellpadding='0' cellspacing='0' "
        "style='width:100%;max-width:600px;background:#ffffff;border-collapse:separate;border-radius:16px;overflow:hidden'>"

        # Logo
        f"<tr><td align='center' style='padding:22px 24px 16px;background:#ffffff'>{logo}</td></tr>"

        # Hero
        f"<tr><td align='center' bgcolor='{_EMAIL_RED}' style='background:{_EMAIL_RED};"
        f"background-image:linear-gradient(135deg,{_EMAIL_RED},{_EMAIL_RED_DARK});padding:34px 28px 30px;font-family:{_EMAIL_FONT}'>"
        f"<div style='font-size:12px;font-weight:bold;letter-spacing:3px;color:{_EMAIL_YELLOW}'>{escape(campaign.upper())}</div>"
        f"<div style='font-size:56px;line-height:1.05;font-weight:bold;color:#ffffff;padding:10px 0 6px'>{big_offer}</div>"
        f"<div style='font-size:16px;color:#ffe9e9;padding-bottom:18px'>{offer_sub}</div>"
        f"<span style='display:inline-block;background:{_EMAIL_YELLOW};color:{_EMAIL_INK};font-size:13px;"
        f"font-weight:bold;border-radius:999px;padding:8px 16px'>{window}</span>"
        "</td></tr>"

        # Message
        f"<tr><td style='padding:28px 32px 8px;font-family:{_EMAIL_FONT};color:{_EMAIL_INK}'>"
        f"<div style='font-size:16px;padding-bottom:10px'>{greeting}</div>"
        f"<div style='font-size:22px;font-weight:bold;line-height:1.25;padding-bottom:10px'>{escape(template['headline'])}</div>"
        f"<div style='font-size:15px;line-height:1.6;color:#3A3A40'>{escape(template['body'])}</div>"
        "</td></tr>"

        # Call to action
        f"<tr><td align='center' style='padding:22px 32px 26px'>"
        f"<a href='{store['maps_url']}' style='display:inline-block;background:{_EMAIL_INK};color:#ffffff;"
        f"font:bold 15px {_EMAIL_FONT};text-decoration:none;border-radius:10px;padding:15px 28px'>Get directions to the store</a>"
        f"<div style='font:13px {_EMAIL_FONT};color:{_EMAIL_MUTED};padding-top:10px'>No code needed. Show this email or just shop in store.</div>"
        "</td></tr>"

        # Top picks
        f"{picks_section}"

        # How to redeem
        f"<tr><td style='padding:14px 26px 26px'>"
        f"<table role='presentation' width='100%' cellpadding='0' cellspacing='0' "
        f"style='background:#FFF8D6;border-radius:14px;border-collapse:separate'>"
        f"<tr><td colspan='3' align='center' style='padding:18px 12px 12px;font:bold 12px {_EMAIL_FONT};letter-spacing:2px;color:{_EMAIL_INK}'>HOW TO REDEEM</td></tr>"
        f"<tr>{steps_html}</tr>"
        "<tr><td colspan='3' style='height:18px;line-height:18px'>&nbsp;</td></tr>"
        "</table>"
        "</td></tr>"

        # Footer
        f"<tr><td align='center' style='background:{_EMAIL_INK};padding:26px 28px;font-family:{_EMAIL_FONT};color:#C9C9CF'>"
        f"<div style='font-size:15px;font-weight:bold;color:#ffffff'>{store['name']}</div>"
        f"<div style='font-size:12px;color:{_EMAIL_YELLOW};padding:2px 0 10px'>{store['tagline']}</div>"
        f"<div style='font-size:13px;line-height:1.6'>{store['address']}<br>Tel. {store['phone']} &middot; {store['hours']}</div>"
        "<div style='font-size:11px;line-height:1.6;color:#8E8E96;padding-top:14px'>"
        f"Offer valid {window} on selected in-stock items while supplies last. "
        "One promotion per item. Replacements follow our 7-day, one-exchange policy; no cash refunds.<br>"
        "You are receiving this because you are a Meryl Shoes customer. "
        + (
            f"<a href='{escape(unsubscribe_link)}' style='color:#C9C9CF;text-decoration:underline'>Unsubscribe from promotional emails</a>."
            if unsubscribe_link
            else "Reply &quot;unsubscribe&quot; to stop promotional emails."
        )
        + "</div>"
        "</td></tr>"

        "</table>"
        "</td></tr></table>"
    )

def send_promotion_notifications_via_gmail(
    promo_id,
    *,
    supabase,
    table_exists,
    fetch_rows,
    safe_int,
    sender_email,
    sender_name,
    client_id,
    client_secret,
    refresh_token,
    unsubscribe_secret="",
    public_base_url="",
):
    """
    Send promotion emails through Gmail API based on notification rows produced by
    `sync_promotion_notifications`.
    """
    if not table_exists("notification"):
        print("GMAIL DEBUG: notification table missing")
        return {"enabled": False, "sent": 0, "failed": 0, "reason": "notification_table_missing"}

    promo_id = str(promo_id or "").strip()
    if not promo_id:
        print(f"GMAIL DEBUG: Invalid promo_id: {promo_id}")
        return {"enabled": False, "sent": 0, "failed": 0, "reason": "invalid_promo_id"}

    missing_config = []
    if not sender_email:
        missing_config.append("GMAIL_SENDER_EMAIL")
    if not client_id:
        missing_config.append("GMAIL_CLIENT_ID")
    if not client_secret:
        missing_config.append("GMAIL_CLIENT_SECRET")
    if not refresh_token:
        missing_config.append("GMAIL_REFRESH_TOKEN")
    if missing_config:
        print(f"GMAIL DEBUG: Missing config: {', '.join(missing_config)}")
        return {
            "enabled": False,
            "sent": 0,
            "failed": 0,
            "reason": f"missing_{'_'.join(missing_config).lower()}",
        }

    promo_lookup = {str(row.get("promo_id") or "").strip(): row for row in fetch_rows("promotion")}
    promo = promo_lookup.get(promo_id, {})
    promo_name = str(promo.get("promo_name") or "Promotion").strip()
    discount_type = str(promo.get("discount_type") or "").strip()
    discount_value = promo.get("discount_value")
    start_date = str(promo.get("start_date") or "").strip()[:10]
    end_date = str(promo.get("end_date") or "").strip()[:10]
    target_products = str(promo.get("target_products") or promo.get("target_product") or "All Products").strip()
    product_rows = _attach_stock(
        fetch_rows("product"),
        fetch_rows("inventory") if table_exists("inventory") else [],
        fetch_rows("category") if table_exists("category") else [],
    )
    promo_product_rows = fetch_rows("promo_product")

    notification_rows = (
        supabase.table("notification")
        .select("notification_id, email_status, customer_id")
        .eq("promo_id", promo_id)
        .execute()
        .data
        or []
    )

    customer_lookup = {}
    for row in fetch_rows("customer"):
        key = str(row.get("customer_id") or "").strip()
        if key:
            customer_lookup[key] = row

    pending_recipients = []
    for row in notification_rows:
        customer_id = str(row.get("customer_id") or "").strip()
        customer = customer_lookup.get(customer_id, {})
        pending_recipients.append(
            {
                "notification_id": row.get("notification_id"),
                "customer_id": customer_id,
                "email": str(customer.get("email") or "").strip(),
                "status": "pending",
                "reason": "",
            }
        )

    print(f"GMAIL DEBUG: Found {len(notification_rows)} customers to notify for promo_id={promo_id}")
    if not notification_rows:
        return {"enabled": True, "sent": 0, "failed": 0, "reason": "no_customers_found", "results": []}

    try:
        access_token = _gmail_access_token(
            client_id=client_id,
            client_secret=client_secret,
            refresh_token=refresh_token,
        )
        _set_gmail_runtime_state(connected=True, last_error="")
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8") if e.fp else ""
        reason = _gmail_error_reason(error_body, f"gmail_token_http_{e.code}")
        lowered_reason = reason.lower()
        if "invalid_grant" in lowered_reason or "expired" in lowered_reason or "revoked" in lowered_reason:
            _set_gmail_runtime_state(connected=False, last_error=reason)
        print(f"GMAIL TOKEN HTTP ERROR {e.code}: {error_body}")
        return {
            "enabled": False,
            "sent": 0,
            "failed": len(notification_rows),
            "reason": reason,
            "results": [{**recipient, "status": "failed", "reason": reason} for recipient in pending_recipients],
        }
    except Exception as e:
        reason = f"{type(e).__name__}: {e}"
        _set_gmail_runtime_state(connected=False, last_error=reason)
        print(f"GMAIL TOKEN ERROR: {type(e).__name__}: {e}")
        return {
            "enabled": False,
            "sent": 0,
            "failed": len(notification_rows),
            "reason": reason,
            "results": [{**recipient, "status": "failed", "reason": reason} for recipient in pending_recipients],
        }

    sent = 0
    failed = 0
    results = []
    for row in notification_rows:
        customer_id = str(row.get("customer_id") or "").strip()
        customer = customer_lookup.get(customer_id, {})
        email = str(customer.get("email") or "").strip()
        reason = ""
        if not email:
            reason = "Customer has no email address."
            print(f"GMAIL DEBUG: Customer {row.get('customer_id')} has no email - skipping")
            failed += 1
            try:
                supabase.table("notification").update(
                    {"email_status": "failed", "date_sent": datetime.now().isoformat()}
                ).eq("notification_id", row.get("notification_id")).execute()
            except Exception:
                pass
            results.append(
                {
                    "notification_id": row.get("notification_id"),
                    "customer_id": customer_id,
                    "email": "",
                    "status": "failed",
                    "reason": reason,
                }
            )
            continue

        if customer.get("promo_opt_out"):
            # Unsubscribed after the campaign was queued: do not send, drop the row.
            try:
                supabase.table("notification").delete().eq("notification_id", row.get("notification_id")).execute()
            except Exception:
                pass
            results.append(
                {
                    "notification_id": row.get("notification_id"),
                    "customer_id": customer_id,
                    "email": email,
                    "status": "skipped",
                    "reason": "Unsubscribed from promotional emails.",
                }
            )
            continue

        link = unsubscribe_url(public_base_url, customer_id, unsubscribe_secret)
        customer_name = str(customer.get("customer_name") or customer.get("name") or "there").strip()
        email_campaign = _build_promotion_email(
            customer_name=customer_name,
            promo_id=promo_id,
            promo_name=promo_name,
            discount_type=discount_type,
            discount_value=discount_value,
            start_date=start_date,
            end_date=end_date,
            target_products=target_products,
            product_rows=product_rows,
            promo_product_rows=promo_product_rows,
            unsubscribe_link=link,
        )

        status = "sent"
        try:
            _gmail_send_message(
                access_token=access_token,
                sender_email=sender_email,
                sender_name=sender_name or "Meryl Shoes",
                recipient_email=email,
                subject=email_campaign["subject"],
                html_content=email_campaign["html"],
                unsubscribe_link=link,
            )
            print(f"GMAIL: Email sent to {email}")
            sent += 1
        except urllib.error.HTTPError as e:
            status = "failed"
            error_body = e.read().decode("utf-8") if e.fp else ""
            reason = _gmail_error_reason(error_body, f"gmail_http_{e.code}")
            lowered_reason = reason.lower()
            if "invalid_grant" in lowered_reason or "expired" in lowered_reason or "revoked" in lowered_reason:
                _set_gmail_runtime_state(connected=False, last_error=reason)
            print(f"GMAIL HTTP ERROR {e.code} for {email}: {error_body}")
            failed += 1
        except urllib.error.URLError as e:
            status = "failed"
            reason = f"Gmail connection error: {e.reason}"
            print(f"GMAIL URL ERROR for {email}: {e.reason}")
            failed += 1
        except TimeoutError:
            status = "failed"
            reason = "Gmail request timed out."
            print(f"GMAIL TIMEOUT for {email}")
            failed += 1
        except Exception as e:
            status = "failed"
            reason = f"{type(e).__name__}: {e}"
            print(f"GMAIL UNEXPECTED ERROR for {email}: {type(e).__name__}: {e}")
            failed += 1

        try:
            supabase.table("notification").update(
                {"email_status": status, "date_sent": datetime.now().isoformat()}
            ).eq("notification_id", row.get("notification_id")).execute()
        except Exception:
            # Best effort status update only.
            pass

        results.append(
            {
                "notification_id": row.get("notification_id"),
                "customer_id": customer_id,
                "email": email,
                "status": status,
                "reason": reason,
            }
        )

    return {
        "enabled": True,
        "sent": sent,
        "failed": failed,
        "skipped": sum(1 for result in results if result.get("status") == "skipped"),
        "reason": "",
        "results": results,
        "errors": [result for result in results if result.get("status") == "failed"],
    }


# Backward-compatible name for older imports/call sites while Brevo is removed.
def send_promotion_notifications_via_brevo(*args, **kwargs):
    kwargs.pop("api_key", None)
    return send_promotion_notifications_via_gmail(*args, **kwargs)

def sync_promotion_products(
    promo_id,
    target_category_id=None,
    target_product_id=None,
    *,
    supabase,
    safe_int,
):
    supabase.table("promo_product").delete().eq("promo_id", promo_id).execute()

    product_query = supabase.table("product").select("product_id")
    if safe_int(target_product_id, 0) > 0:
        product_query = product_query.eq("product_id", safe_int(target_product_id, 0))
    elif target_category_id not in (None, "", "all"):
        product_query = product_query.eq("category_id", target_category_id)
    products = product_query.execute().data or []
    if not products:
        return 0

    supabase.table("promo_product").insert(
        [{"promo_id": promo_id, "product_id": row["product_id"]} for row in products]
    ).execute()
    return len(products)


def build_active_promotion_lookup(
    *,
    fetch_rows,
    parse_iso_datetime,
):
    promotions = fetch_rows("promotion")
    promo_products = fetch_rows("promo_product")
    now = datetime.now().date()

    active_promotions = {}
    for promo in promotions:
        status = str(promo.get("status", "")).lower()
        start_date = parse_iso_datetime(promo.get("start_date")) or datetime.min
        end_date = parse_iso_datetime(promo.get("end_date")) or datetime.max
        if status != "active":
            continue
        if not (start_date.date() <= now <= end_date.date()):
            continue
        active_promotions[promo["promo_id"]] = promo

    product_promotions = {}
    for row in promo_products:
        promo = active_promotions.get(row.get("promo_id"))
        product_id = row.get("product_id")
        if promo and product_id:
            product_promotions[product_id] = promo

    return product_promotions


def compute_promo_discount(base_price, promo, *, normalize_promotion_type, safe_float):
    if not promo or base_price <= 0:
        return 0

    discount_type = normalize_promotion_type(promo.get("discount_type", ""))
    discount_value = safe_float(promo.get("discount_value"), 0)

    if discount_type == "percentage":
        return base_price * (discount_value / 100)
    if discount_type == "fixed":
        return discount_value
    return 0


def build_promotions_context(
    *,
    fetch_rows,
    build_product_lookup,
    safe_float,
    safe_int,
    normalize_promotion_type,
    format_promotion_type,
    format_promotion_discount,
    format_short_date,
    build_chart_points,
):
    promotions = fetch_rows("promotion")
    promo_products = fetch_rows("promo_product")
    products = build_product_lookup()
    analytics = {row.get("product_id"): row for row in fetch_rows("sales_analytics")}

    products_by_promo = {}
    for row in promo_products:
        products_by_promo.setdefault(row.get("promo_id"), []).append(row.get("product_id"))

    category_sales = defaultdict(float)
    discount_bands = {
        "10-20%": {"sales": 0, "units": 0, "campaigns": 0},
        "20-30%": {"sales": 0, "units": 0, "campaigns": 0},
        "30-40%": {"sales": 0, "units": 0, "campaigns": 0},
        "40-50%": {"sales": 0, "units": 0, "campaigns": 0},
    }
    campaign_rows = []
    total_revenue = 0
    total_units = 0
    active_count = 0

    for promo in promotions:
        promo_id = promo.get("promo_id")
        product_ids = products_by_promo.get(promo_id, [])
        linked_products = [products.get(product_id, {}) for product_id in product_ids if products.get(product_id)]
        product_names = [item.get("product_name", "Unknown Product") for item in linked_products]
        categories = [item.get("category", "General") for item in linked_products if item.get("category")]
        unique_categories = list(dict.fromkeys(categories))
        unique_category_ids = list(
            dict.fromkeys(
                item.get("category_id")
                for item in linked_products
                if item.get("category_id") is not None
            )
        )
        unique_product_names = list(dict.fromkeys(product_names))
        revenue = sum(safe_float(analytics.get(product_id, {}).get("total_sales"), 0) for product_id in product_ids)
        units = sum(
            safe_int(analytics.get(product_id, {}).get("total_quantity_sold"), 0)
            for product_id in product_ids
        )
        effectiveness = min(100, 60 + units * 8)
        status = str(promo.get("status", "inactive")).title()
        if status == "Active":
            active_count += 1
        total_revenue += revenue
        total_units += units

        for product_id in product_ids:
            category = products.get(product_id, {}).get("category", "General")
            category_sales[category] += safe_float(analytics.get(product_id, {}).get("total_sales"), 0)

        discount_value = safe_float(promo.get("discount_value"), 0)
        raw_discount_type = str(promo.get("discount_type", "")).strip().lower()
        discount_type = normalize_promotion_type(raw_discount_type)
        type_label, type_detail_label = format_promotion_type(raw_discount_type)
        discount_display = format_promotion_discount(raw_discount_type, promo.get("discount_value"))
        effective_percent = discount_value if discount_type == "percentage" else min(discount_value / 10, 35)
        if effective_percent <= 20:
            band_key = "10-20%"
        elif effective_percent <= 30:
            band_key = "20-30%"
        elif effective_percent <= 40:
            band_key = "30-40%"
        else:
            band_key = "40-50%"
        discount_bands[band_key]["sales"] += revenue
        discount_bands[band_key]["units"] += units
        discount_bands[band_key]["campaigns"] += 1

        target_label = "All Products"
        if len(unique_categories) == 1 and unique_categories[0] != "General":
            target_label = f"{unique_categories[0]} Category"
        elif len(unique_product_names) == 1:
            target_label = unique_product_names[0]
        elif unique_product_names:
            remaining_products = len(unique_product_names) - 2
            target_label = ", ".join(unique_product_names[:2])
            if remaining_products > 0:
                target_label = f"{target_label} +{remaining_products} more"

        base_name = str(promo.get("promo_name", "Promotion")).strip() or "Promotion"
        display_name = base_name
        if target_label != "All Products" and target_label.lower() not in base_name.lower():
            suffix = unique_product_names[0] if unique_product_names else target_label.replace(" Category", "")
            display_name = f"{base_name} - {suffix}"

        campaign_rows.append(
            {
                "promo_id": promo_id,
                "promo_name": base_name,
                "display_name": display_name,
                "target_label": target_label,
                "target_products": ", ".join(unique_product_names) if unique_product_names else "All Products",
                "target_category_id": unique_category_ids[0] if len(unique_category_ids) == 1 else "all",
                "discount_type_raw": discount_type,
                "start_date": str(promo.get("start_date", ""))[:10],
                "end_date": str(promo.get("end_date", ""))[:10],
                "status_raw": str(promo.get("status", "inactive")).lower(),
                "type": type_label,
                "type_detail": type_detail_label,
                "discount": promo.get("discount_value", 0),
                "discount_display": discount_display,
                "period": f"{promo.get('start_date', '')} to {promo.get('end_date', '')}",
                "start_date_display": format_short_date(promo.get("start_date")),
                "end_date_display": format_short_date(promo.get("end_date")),
                "status": status,
                "sales": revenue,
                "units": units,
                "effectiveness": effectiveness,
            }
        )

    average_effectiveness = (
        sum(row["effectiveness"] for row in campaign_rows) / len(campaign_rows) if campaign_rows else 0
    )
    promotion_chart = build_chart_points(campaign_rows, "promo_name", "sales")
    category_impact = build_chart_points(
        [{"category": category, "sales": sales} for category, sales in category_sales.items()],
        "category",
        "sales",
        min_height=24,
        max_height=100,
    )
    discount_effectiveness = build_chart_points(
        [
            {
                "band": band,
                "sales": values["sales"],
                "units": values["units"],
                "campaigns": values["campaigns"],
            }
            for band, values in discount_bands.items()
        ],
        "band",
        "sales",
    )

    max_revenue = max((row["sales"] for row in campaign_rows), default=0)
    max_roi = max((row["effectiveness"] for row in campaign_rows), default=0)
    promotion_comparison = []
    for row in campaign_rows[:4]:
        revenue_ratio = row["sales"] / max_revenue if max_revenue else 0
        roi_ratio = row["effectiveness"] / max_roi if max_roi else 0
        promotion_comparison.append(
            {
                "label": row["promo_name"],
                "revenue": row["sales"],
                "roi": row["effectiveness"],
                "revenue_height": 24 + revenue_ratio * 150,
                "roi_height": 24 + roi_ratio * 150,
            }
        )

    unit_peak = max((entry.get("units", 0) for entry in discount_effectiveness), default=0)
    for item in discount_effectiveness:
        item["sales_height"] = 24 + (item["ratio"] / 100) * 190
        unit_ratio = (item.get("units", 0) / unit_peak) if unit_peak else 0
        item["conversion_height"] = 24 + unit_ratio * 190

    sales_tick_peak = max((item.get("value", 0) for item in discount_effectiveness), default=0)
    if sales_tick_peak <= 0:
        discount_ticks = [0, 0, 0, 0, 0]
    else:
        discount_ticks = [round(sales_tick_peak * ratio) for ratio in (1, 0.75, 0.5, 0.25, 0)]

    total_category_sales = sum(item["value"] for item in category_impact) or 1
    pie_palette = ["cream", "gold", "soft", "pale"]
    category_distribution = []
    for index, item in enumerate(category_impact[:4]):
        percent = round((item["value"] / total_category_sales) * 100)
        category_distribution.append(
            {
                "label": item["label"],
                "value": item["value"],
                "percent": percent,
                "tone": pie_palette[index % len(pie_palette)],
            }
        )

    return (
        campaign_rows,
        active_count,
        total_revenue,
        total_units,
        average_effectiveness,
        promotion_chart,
        category_impact,
        discount_effectiveness,
        discount_ticks,
        promotion_comparison,
        category_distribution,
    )
