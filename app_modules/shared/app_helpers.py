from datetime import datetime


DEFAULT_CATEGORY_NAMES = [
    "Running Shoes",
    "Basketball Shoes",
    "Casual Shoes",
    "Sandals",
    "Kid",
    "Men",
    "Women",
]

STAFF_ROLES = {"sales_staff", "inventory_staff"}

ROLE_NAME_TO_APP_ROLE = {
    "administrator": "admin",
    "admin": "admin",
    "sales staff": "sales_staff",
    "sales_staff": "sales_staff",
    "cashier": "sales_staff",
    "inventory staff": "inventory_staff",
    "inventory_staff": "inventory_staff",
}

APP_ROLE_TO_DB_ROLE_NAME = {
    "admin": "Administrator",
    "sales_staff": "Sales Staff",
    "inventory_staff": "Inventory Staff",
}


def parse_iso_datetime(value):
    if not value:
        return None

    normalized = str(value).replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        return None


def format_short_date(value):
    parsed = parse_iso_datetime(value)
    if parsed:
        return parsed.strftime("%m/%d/%Y")
    return str(value or "N/A")


def normalize_promotion_type(discount_type):
    normalized = str(discount_type or "").strip().lower().replace("-", "_").replace(" ", "_")
    alias_groups = {
        "percentage": {"percentage", "percentage_discount", "flash_sale", "seasonal_sale"},
        "fixed": {"fixed", "fixed_amount", "clearance_sale", "markdown_sale"},
        "bogo": {"bogo", "__type_bogo__", "buy_one_get_one", "bundle_deal"},
    }
    for base_type, aliases in alias_groups.items():
        if normalized in aliases:
            return base_type
    return normalized


def format_promotion_type(discount_type):
    normalized = normalize_promotion_type(discount_type)
    labels = {
        "percentage": ("Percentage", "Percentage Discount"),
        "fixed": ("Fixed", "Fixed Amount"),
        "bogo": ("BOGO", "Buy One Get One"),
        "flash_sale": ("Flash Sale", "Flash Sale Discount"),
        "seasonal_sale": ("Seasonal", "Seasonal Discount"),
        "clearance_sale": ("Clearance", "Clearance Price Cut"),
        "markdown_sale": ("Markdown", "Markdown Discount"),
        "bundle_deal": ("Bundle", "Bundle Deal"),
    }
    alias_labels = {
        "flash_sale": ("Flash Sale", "Flash Sale Discount"),
        "seasonal_sale": ("Seasonal", "Seasonal Discount"),
        "clearance_sale": ("Clearance", "Clearance Price Cut"),
        "markdown_sale": ("Markdown", "Markdown Discount"),
        "bundle_deal": ("Bundle", "Bundle Deal"),
    }
    raw_value = str(discount_type or "").strip().lower().replace("-", "_").replace(" ", "_")
    if raw_value in alias_labels:
        return alias_labels[raw_value]
    fallback = str(discount_type or "Promotion").replace("_", " ").title()
    return labels.get(normalized, (fallback, fallback))


def format_currency(value):
    return f"{float(value):,.2f}"


def safe_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def safe_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def format_promotion_discount(discount_type, discount_value):
    normalized = normalize_promotion_type(discount_type)
    if normalized == "percentage":
        return f"{safe_float(discount_value, 0):.1f}%"
    if normalized == "fixed":
        return f"PHP {format_currency(safe_float(discount_value, 0))}"
    if normalized == "bogo":
        return "Buy 1 Get 1"
    return str(discount_value or "N/A")


def canonical_app_role_name(value):
    normalized = str(value or "").strip().lower()
    return ROLE_NAME_TO_APP_ROLE.get(normalized, normalized or "sales_staff")


def db_user_status(status):
    normalized = str(status or "").strip().lower()
    mapping = {"active": "Active", "inactive": "Inactive", "blocked": "Blocked"}
    return mapping.get(normalized, "Active")


def db_payment_method(value):
    normalized = str(value or "").strip().lower()
    mapping = {
        "cash": "cash",
        "card": "card",
        "gcash": "online",
        "online": "online",
        "check": "check",
    }
    return mapping.get(normalized, "cash")


def db_payment_status(value):
    normalized = str(value or "").strip().lower()
    mapping = {
        "pending": "pending",
        "paid": "completed",
        "completed": "completed",
        "failed": "failed",
        "refunded": "failed",
    }
    return mapping.get(normalized, "pending")


def db_product_status(value):
    normalized = str(value or "").strip().lower()
    mapping = {
        "available": "active",
        "active": "active",
        "not available": "inactive",
        "not_available": "inactive",
        "inactive": "inactive",
        "discontinued": "inactive",
    }
    return mapping.get(normalized, "active")


def db_promotion_type(value):
    normalized = normalize_promotion_type(value)
    mapping = {
        "percentage": "percentage",
        "fixed": "fixed",
        # The live schema allows only percentage/fixed. BOGO is represented
        # as a 0% promotion and interpreted by the UI/POS using the promo name marker.
        "bogo": "percentage",
    }
    return mapping.get(normalized, "percentage")


def db_promotion_status(value):
    normalized = str(value or "").strip().lower()
    mapping = {
        "active": "active",
        # The live schema has no scheduled value. Scheduled promos are stored
        # inactive until their start date makes them valid for POS rules.
        "scheduled": "inactive",
        "inactive": "inactive",
        "expired": "expired",
    }
    return mapping.get(normalized, "active")


def normalize_staff_role(role):
    normalized = str(role or "").strip().lower()
    return normalized if normalized in STAFF_ROLES else "sales_staff"


def format_role_label(role):
    return str(role or "staff").replace("_", " ").title()


def normalize_account_status(status):
    normalized = str(status or "").strip().lower()
    return normalized if normalized in {"active", "inactive"} else "active"


def slugify_text(value):
    cleaned = []
    previous_dash = False
    for char in str(value or "").strip().lower():
        if char.isalnum():
            cleaned.append(char)
            previous_dash = False
        elif not previous_dash:
            cleaned.append("-")
            previous_dash = True
    return "".join(cleaned).strip("-")
