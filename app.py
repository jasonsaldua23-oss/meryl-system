from collections import defaultdict
from datetime import datetime, timedelta
from functools import wraps
import hashlib
import hmac
import json
import logging
import math
import os
import random
import smtplib
from email.message import EmailMessage
from pathlib import Path
import re
import urllib.request

from dotenv import load_dotenv
from flask import Flask, Response, abort, jsonify, redirect, render_template, request, send_from_directory, session, url_for, g
from supabase import create_client
from app_modules.auth.app_jwt import create_jwt_token, verify_jwt_token
from app_modules.auth.app_auth_store import (
    find_auth_account as store_find_auth_account,
    generate_staff_code as store_generate_staff_code,
    hash_password as store_hash_password,
    load_auth_accounts as store_load_auth_accounts,
    save_auth_accounts as store_save_auth_accounts,
)
from app_modules.shared.app_helpers import (
    APP_ROLE_TO_DB_ROLE_NAME,
    DEFAULT_CATEGORY_NAMES,
    STAFF_ROLES,
    canonical_app_role_name,
    db_payment_method,
    db_payment_status,
    db_product_status,
    db_promotion_status,
    db_promotion_type,
    db_user_status,
    format_currency,
    format_promotion_discount,
    format_promotion_type,
    format_role_label,
    format_short_date,
    normalize_account_status,
    normalize_promotion_type,
    normalize_staff_role,
    parse_iso_datetime,
    safe_float,
    safe_int,
    slugify_text,
)
from app_modules.shared.app_customers import (
    build_customer_form_data as customer_build_form_data,
    build_customer_lookup as customer_build_lookup,
    build_customer_rows as customer_build_rows,
    delete_customer_record as customer_delete_record,
    get_or_create_customer as customer_get_or_create,
)
from app_modules.shared.app_pages import (
    build_customers_page_context as page_build_customers_context,
    build_dashboard_context as page_build_dashboard_context,
    build_inventory_page_context as page_build_inventory_context,
    build_predictive_page_context as page_build_predictive_context,
    build_reports_page_context as page_build_reports_context,
    build_sales_export_csv_content as page_build_sales_export_csv_content,
    build_sales_page_context as page_build_sales_context,
    build_staff_accounts_page_context as page_build_staff_accounts_context,
)
from app_modules.inventory.app_inventory import (
    build_category_lookup as inventory_build_category_lookup,
    build_category_options as inventory_build_category_options,
    build_filter_options as inventory_build_filter_options,
    build_inventory_form_data as inventory_build_form_data,
    build_inventory_log_payload as inventory_build_log_payload,
    build_price_lookup as inventory_build_price_lookup,
    build_product_group_key as inventory_build_product_group_key,
    build_product_lookup as inventory_build_product_lookup,
    build_product_sku as inventory_build_product_sku,
    build_stock_lookup as inventory_build_stock_lookup,
    get_inventory_row as inventory_get_row,
    get_reorder_level as inventory_get_reorder_level,
    normalize_inventory_products as inventory_normalize_products,
    upsert_inventory_record as inventory_upsert_record,
)
from app_modules.inventory.app_inventory_flow import (
    complete_sale_inventory as inventory_flow_complete_sale,
    delete_inventory_product as inventory_flow_delete_product,
)
from app_modules.sales.app_sales import (
    build_chart_points as sales_build_chart_points,
    build_sale_status_maps as sales_build_status_maps,
    build_sales_rows as sales_build_rows,
    sync_sales_summary_entry as sales_sync_summary_entry,
)
from app_modules.sales.app_sales_flow import (
    deny_sale_transaction as sales_flow_deny_transaction,
)
from app_modules.analytics.app_promotions import (
    build_active_promotion_lookup as promotion_build_active_lookup,
    build_promotions_context as promotion_build_context,
    compute_promo_discount as promotion_compute_discount,
    get_gmail_runtime_state as promotion_get_gmail_runtime_state,
    send_promotion_notifications_via_gmail as promotion_send_notifications_via_gmail,
    sync_promotion_notifications as promotion_sync_notifications,
    sync_promotion_products as promotion_sync_products,
)
from app_modules.analytics.app_predictive import (
    build_predictive_context as predictive_build_context,
    build_reports_context as predictive_build_reports_context,
)
from app_modules.analytics.app_inventory_analytics import (
    build_inventory_turnover_context as analytics_build_inventory_turnover_context,
)
from app_modules.analytics.app_returns_predictor import (
    build_returns_analysis_context as analytics_build_returns_analysis_context,
)
from app_modules.analytics.app_pricing_engine import (
    build_pricing_context as analytics_build_pricing_context,
)
from app_modules.analytics.app_product_snapshot_persistence import (
    rebuild_product_analytics_snapshots,
)
from app_modules.sales.app_pos import (
    add_product_to_cart as pos_add_product_to_cart,
    build_receipt_payload as pos_build_receipt_payload,
    build_pos_page_context as pos_build_page_context,
    build_pos_catalog as pos_build_catalog,
    get_receipt_from_session as pos_get_receipt_from_session,
    normalize_cart_items as pos_normalize_cart_items,
    remove_cart_item as pos_remove_cart_item,
)
from app_modules.sales.app_sync import (
    format_prediction_period_label as sync_format_prediction_period_label,
    sync_prediction_results as sync_prediction_results_helper,
    sync_sales_analytics_entry as sync_sales_analytics_entry_helper,
)
from app_modules.sales.app_forecast import (
    blended_recent_forecast as forecast_blended_recent,
    build_demand_range_buckets as forecast_build_demand_buckets,
    build_forecast_periods as forecast_build_periods,
    linear_regression_forecast as forecast_linear_regression,
    moving_average_forecast as forecast_moving_average,
    weighted_moving_average_forecast as forecast_weighted_moving_average,
)
from app_modules.shared.app_ui import (
    build_admin_login_payload as ui_build_admin_login_payload,
    build_current_user_context as ui_build_current_user_context,
    build_login_form_data as ui_build_login_form_data,
    build_navigation_items as ui_build_navigation_items,
    build_render_context as ui_build_render_context,
    build_session_user_payload as ui_build_session_user_payload,
    build_staff_login_payload as ui_build_staff_login_payload,
    build_system_notifications as ui_build_system_notifications,
    get_access_denied_notice as ui_get_access_denied_notice,
    get_invalid_login_notice as ui_get_invalid_login_notice,
    get_login_required_notice as ui_get_login_required_notice,
    get_logout_notice as ui_get_logout_notice,
    get_logout_redirect as ui_get_logout_redirect,
    get_missing_account_notice as ui_get_missing_account_notice,
    get_missing_account_redirect as ui_get_missing_account_redirect,
    get_account_settings_fallback_redirect as ui_get_account_settings_fallback_redirect,
    get_post_login_redirect as ui_get_post_login_redirect,
)
from app_modules.auth.app_staff import (
    build_staff_form_data as staff_build_form_data,
    build_staff_rows as staff_build_rows,
    get_protected_staff_notice as staff_get_protected_notice,
    is_protected_staff_account as staff_is_protected_account,
    sync_staff_user_record as staff_sync_user_record,
    upsert_staff_account as staff_upsert_account,
)

# Load environment variables from .env file
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY") or os.getenv("JWT_SECRET") or "meryl-secure-production-jwt-key-2026-secret"
is_prod = os.getenv("FLASK_ENV") == "production" or not os.getenv("FLASK_DEBUG")
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="None" if is_prod else "Lax",
    SESSION_COOKIE_SECURE=is_prod,
)


ALLOWED_ORIGINS = {
    "https://merylshoesbacolod.shop",
    "https://www.merylshoesbacolod.shop",
    "http://merylshoesbacolod.shop",
    "http://www.merylshoesbacolod.shop",
    "https://meryl-system.onrender.com",
    "http://localhost:5173",
    "http://localhost:5000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5000",
}

# Dynamically support additional origins from environment variables
for env_var in ("ALLOWED_ORIGINS", "FRONTEND_URL"):
    val = os.getenv(env_var, "")
    if val:
        for item in val.split(","):
            cleaned = item.strip().rstrip("/")
            if cleaned:
                ALLOWED_ORIGINS.add(cleaned)


@app.before_request
def handle_cors_preflight():
    if request.method == "OPTIONS":
        origin = request.headers.get("Origin")
        if origin and (origin in ALLOWED_ORIGINS or (os.getenv("FLASK_ENV") != "production" and ("localhost" in origin or "127.0.0.1" in origin))):
            res = Response("", status=204)
            res.headers["Access-Control-Allow-Origin"] = origin
            res.headers["Access-Control-Allow-Credentials"] = "true"
            res.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Requested-With, apikey, X-Meryl-Session"
            res.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
            return res
        return Response("Forbidden Origin", status=403)


@app.after_request
def add_security_headers(response):
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=(self)"

    # Restrict CORS to trusted origins only (prevent arbitrary-origin reflection)
    origin = request.headers.get("Origin")
    if origin and (origin in ALLOWED_ORIGINS or (os.getenv("FLASK_ENV") != "production" and ("localhost" in origin or "127.0.0.1" in origin))):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Requested-With, apikey, X-Meryl-Session"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"

    # Tightened CSP: no unsafe-eval, no unsafe-inline in script-src, narrowed origins
    supabase_origin = os.getenv("SUPABASE_URL", "https://vylmcqmxpxqkldosowrs.supabase.co").rstrip("/")
    supabase_ws = supabase_origin.replace("https://", "wss://").replace("http://", "ws://")
    csp = (
        "default-src 'self'; "
        f"script-src 'self' {supabase_origin}; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com data:; "
        "img-src 'self' data: blob: https:; "
        "media-src 'self' blob: data:; "
        f"connect-src 'self' {supabase_origin} {supabase_ws} https://api.brevo.com https://merylshoesbacolod.shop https://www.merylshoesbacolod.shop; "
        "frame-ancestors 'self';"
    )
    response.headers["Content-Security-Policy"] = csp
    return response

REACT_DIST_DIR = Path(__file__).resolve().parent / "frontend" / "dist"
REACT_ASSETS_DIR = REACT_DIST_DIR / "assets"

# Supabase initialization (lazy-loaded)
_supabase_client = None
_supabase_error = None


def get_supabase():
    """
    Lazy-load and return the Supabase client.
    Raises an exception if credentials are missing or connection fails.
    """
    global _supabase_client, _supabase_error

    if _supabase_client is not None:
        return _supabase_client

    if _supabase_error is not None:
        raise RuntimeError(_supabase_error)

    url = os.getenv("SUPABASE_URL")
    # The backend is a trusted server: it uses the service-role key, which
    # bypasses RLS. The anon key only works for data a signed-in staff session
    # may see, which the backend's own requests do not carry.
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
    if not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
        logger.warning("SUPABASE_SERVICE_ROLE_KEY is not set; backend database access will be limited by RLS.")

    if not url or not key:
        error_msg = (
            "Missing SUPABASE_URL or SUPABASE_KEY environment variables. "
            "Please set these in your .env file or environment configuration."
        )
        _supabase_error = error_msg
        logger.error(error_msg)
        raise RuntimeError(error_msg)

    try:
        _supabase_client = create_client(url, key)
        logger.info("✓ Supabase client initialized successfully")
        return _supabase_client
    except Exception as e:
        error_msg = f"Failed to initialize Supabase client: {str(e)}"
        _supabase_error = error_msg
        logger.error(error_msg)
        raise RuntimeError(error_msg)


# Provide a property to access supabase
def supabase():
    """Accessor function for lazy-loaded Supabase client"""
    return get_supabase()


ADMIN_CREDENTIALS = {
    "username": "admin",
    "name": "Administrator",
    "role": "admin",
}
AUTH_STORE_PATH = Path(__file__).resolve().parent / "auth_accounts.json"
DB_TABLE_EXISTS_CACHE = {}
app.jinja_env.filters["currency"] = format_currency


def get_role_id_for_app_role(role):
    app_role = canonical_app_role_name(role)
    role_name = APP_ROLE_TO_DB_ROLE_NAME.get(app_role, "Sales Staff")
    if not table_exists("role"):
        return 0
    for row in fetch_raw_rows("role"):
        if str(row.get("role_name", "")).strip().lower() == role_name.lower():
            return safe_int(row.get("role_id"), 0)
    return 0




def get_inventory_row(product_id):
    return inventory_get_row(
        product_id,
        safe_int=safe_int,
        table_exists=table_exists,
        supabase=supabase(),
    )


def upsert_inventory_record(product_id, stock_quantity, reorder_level=10, reference_id=None):
    return inventory_upsert_record(
        product_id,
        stock_quantity,
        reorder_level,
        reference_id,
        safe_int=safe_int,
        table_exists=table_exists,
        get_inventory_row=get_inventory_row,
        supabase=supabase(),
    )


def resolve_db_user_row(current_user=None):
    current_user = current_user or get_current_user() or {}
    username = str(current_user.get("username", "")).strip()
    if not username:
        return None

    existing_user = next(
        (row for row in fetch_rows("user") if str(row.get("username", "")).strip().lower() == username.lower()),
        None,
    )
    if existing_user:
        return existing_user

    app_role = canonical_app_role_name(current_user.get("role"))
    if app_role == "admin":
        return create_user_profile(
            current_user.get("name") or ADMIN_CREDENTIALS["name"],
            username,
            app_role,
            current_user.get("password") or os.getenv("ADMIN_PASSWORD", "admin123"),
            current_user.get("status") or "active",
        )

    account = find_auth_account(current_user.get("staff_code") or username)
    if account:
        return sync_staff_user_record(account, previous_username=username)
    return None


def table_exists(table_name):
    if table_name in DB_TABLE_EXISTS_CACHE:
        return DB_TABLE_EXISTS_CACHE[table_name]
    try:
        supabase().table(table_name).select("*").limit(1).execute()
        DB_TABLE_EXISTS_CACHE[table_name] = True
    except Exception:
        DB_TABLE_EXISTS_CACHE[table_name] = False
    return DB_TABLE_EXISTS_CACHE[table_name]


def fetch_raw_rows(table_name, query="*"):
    return supabase().table(table_name).select(query).execute().data or []


def adapt_product_payload_for_schema(payload, error):
    """
    Gracefully handle legacy product schemas that do not yet include
    newer columns like `brand` or `gender`.
    """
    error_text = str(error)
    updated_payload = dict(payload)
    adapted = False
    adaptation_notes = []

    if (
        "Could not find the 'brand' column of 'product'" in error_text
        and "brand" in updated_payload
    ):
        updated_payload.pop("brand", None)
        adapted = True
        adaptation_notes.append("missing_brand_column")

    if (
        "Could not find the 'gender' column of 'product'" in error_text
        and "gender" in updated_payload
    ):
        updated_payload.pop("gender", None)
        adapted = True
        adaptation_notes.append("missing_gender_column")

    if "product_status_check" in error_text or "violates check constraint" in error_text:
        current_status = str(updated_payload.get("status") or "").strip().lower()
        if current_status in ("available", "active", ""):
            updated_payload["status"] = "active"
            adapted = True
            adaptation_notes.append("status_mapped")
        elif current_status in ("not available", "not_available", "inactive", "discontinued"):
            updated_payload["status"] = "inactive"
            adapted = True
            adaptation_notes.append("status_mapped")

    return updated_payload, adapted, adaptation_notes


def adapt_customer_payload_for_schema(payload, error):
    """
    Gracefully handle legacy customer schemas that may not include
    newer columns like `address` or `status`.
    """
    error_text = str(error)
    updated_payload = dict(payload)
    adapted = False
    adaptation_notes = []

    # Example error: Could not find the 'address' column of 'customer' in the schema cache
    match = re.search(r"Could not find the '([^']+)' column of 'customer'", error_text)
    if match:
        missing_column = match.group(1)
        if missing_column in updated_payload:
            updated_payload.pop(missing_column, None)
            adapted = True
            adaptation_notes.append(f"missing_{missing_column}_column")

    return updated_payload, adapted, adaptation_notes


def execute_customer_write_with_schema_fallback(operation, payload):
    """
    Execute a customer insert/update operation with compatibility retries for
    legacy schemas missing one or more columns.
    """
    working_payload = dict(payload)
    adaptation_notes = []

    while True:
        try:
            operation(working_payload)
            return adaptation_notes
        except Exception as exc:
            compatible_payload, was_adapted, new_notes = adapt_customer_payload_for_schema(working_payload, exc)
            if not was_adapted:
                raise
            working_payload = compatible_payload
            adaptation_notes.extend(new_notes)


def normalize_user_rows(rows):
    role_lookup = {}
    if table_exists("role"):
        role_lookup = {
            safe_int(row.get("role_id"), 0): row.get("role_name", "")
            for row in fetch_raw_rows("role")
        }

    normalized = []
    for row in rows:
        normalized_row = dict(row)
        if "role" not in normalized_row or not normalized_row.get("role"):
            normalized_row["role"] = canonical_app_role_name(
                role_lookup.get(safe_int(normalized_row.get("role_id"), 0), "")
            )
        else:
            normalized_row["role"] = canonical_app_role_name(normalized_row.get("role"))
        normalized_row["status"] = str(normalized_row.get("status") or "active").strip().lower()
        normalized.append(normalized_row)
    return normalized


def normalize_customer_rows(rows):
    normalized = []
    for row in rows:
        normalized_row = dict(row)
        customer_name = normalized_row.get("customer_name") or normalized_row.get("name") or "Unknown Customer"
        phone = normalized_row.get("phone") or normalized_row.get("contact_number")
        normalized_row["customer_name"] = customer_name
        normalized_row["name"] = customer_name
        normalized_row["phone"] = phone
        normalized_row["contact_number"] = phone
        normalized_row["address"] = normalized_row.get("address")
        normalized_row["status"] = str(normalized_row.get("status") or "active").strip().lower()
        if not normalized_row.get("created_at") and normalized_row.get("date_registered"):
            normalized_row["created_at"] = normalized_row.get("date_registered")
        normalized.append(normalized_row)
    return normalized


def normalize_product_rows(rows):
    inventory_lookup = {}
    if table_exists("inventory"):
        inventory_lookup = {}
        for row in fetch_raw_rows("inventory"):
            row_product_id = str(row.get("product_id") or "").strip()
            if not row_product_id:
                continue
            inventory_lookup[row_product_id] = row

    normalized = []
    for index, row in enumerate(rows, start=1):
        normalized_row = dict(row)
        product_id = str(normalized_row.get("product_id") or "").strip()
        inventory_row = inventory_lookup.get(product_id, {})
        normalized_row["stock_quantity"] = safe_int(
            normalized_row.get("stock_quantity", inventory_row.get("stock_quantity")),
            0,
        )
        normalized_row["reorder_level"] = safe_int(
            normalized_row.get("reorder_level", inventory_row.get("reorder_level")),
            10,
        )
        normalized_row["reference_id"] = normalized_row.get("reference_id", inventory_row.get("reference_id"))
        normalized_row["updated_at"] = normalized_row.get("updated_at") or inventory_row.get("last_updated")
        normalized_row["sku"] = normalized_row.get("sku") or build_product_sku(normalized_row, index)
        normalized_row["status"] = str(normalized_row.get("status") or "Available")
        normalized.append(normalized_row)
    return normalized


def normalize_sales_transaction_rows(rows):
    normalized = []
    for row in rows:
        normalized_row = dict(row)
        payment_method = str(normalized_row.get("payment_method") or "cash").strip()
        normalized_row["payment_method"] = payment_method.lower()
        normalized.append(normalized_row)
    return normalized


def normalize_sales_analytics_rows(rows):
    normalized = []
    for row in rows:
        normalized_row = dict(row)
        normalized_row["sales_analytics_id"] = normalized_row.get("sales_analytics_id", normalized_row.get("analytics_id"))
        normalized.append(normalized_row)
    return normalized


def normalize_return_transaction_rows(rows):
    reason_lookup = {}
    if table_exists("return_details"):
        for detail in fetch_raw_rows("return_details"):
            return_id = safe_int(detail.get("return_id"), 0)
            if return_id <= 0 or return_id in reason_lookup:
                continue
            reason = str(detail.get("reason") or "").strip()
            if reason:
                reason_lookup[return_id] = reason

    sales_lookup = {
        safe_int(row.get("sales_id"), 0): row
        for row in fetch_raw_rows("sales_transaction")
        if safe_int(row.get("sales_id"), 0) > 0
    }
    normalized = []
    for row in rows:
        normalized_row = dict(row)
        sale = sales_lookup.get(safe_int(normalized_row.get("sales_id"), 0), {})
        normalized_row["customer_id"] = normalized_row.get("customer_id", sale.get("customer_id"))
        normalized_row["payment_method"] = normalized_row.get("payment_method") or sale.get("payment_method")
        normalized_row["reason"] = normalized_row.get("reason") or reason_lookup.get(
            safe_int(normalized_row.get("return_id"), 0),
            "Return processed",
        )
        normalized.append(normalized_row)
    return normalized


def normalize_return_detail_rows(rows):
    normalized = []
    for row in rows:
        normalized_row = dict(row)
        normalized_row["quantity"] = normalized_row.get("quantity", normalized_row.get("quantity_returned"))
        normalized.append(normalized_row)
    return normalized


def fetch_rows(table_name, query="*"):
    source_table = {"return_transaction": "returns"}.get(table_name, table_name)
    rows = fetch_raw_rows(source_table, query)

    if table_name == "user":
        return normalize_user_rows(rows)
    if table_name == "customer":
        return normalize_customer_rows(rows)
    if table_name == "product":
        return normalize_product_rows(rows)
    if table_name == "sales_transaction":
        return normalize_sales_transaction_rows(rows)
    if table_name == "sales_analytics":
        return normalize_sales_analytics_rows(rows)
    if table_name == "return_transaction":
        return normalize_return_transaction_rows(rows)
    if table_name == "return_details":
        return normalize_return_detail_rows(rows)
    return rows


def set_notice(message, tone="success"):
    session["notice"] = {"message": message, "tone": tone}


def pop_notice():
    return session.pop("notice", None)


def hash_password(password):
    return store_hash_password(password)


def load_auth_accounts():
    return store_load_auth_accounts(AUTH_STORE_PATH)


def save_auth_accounts(accounts):
    store_save_auth_accounts(AUTH_STORE_PATH, accounts, safe_int)


def find_auth_account(identifier, role=None):
    return store_find_auth_account(AUTH_STORE_PATH, identifier, role)


def generate_staff_code(accounts):
    return store_generate_staff_code(accounts, safe_int)


def sync_staff_user_record(account, previous_username=None):
    return staff_sync_user_record(
        account,
        previous_username,
        get_role_id_for_app_role=get_role_id_for_app_role,
        db_user_status=db_user_status,
        fetch_rows=fetch_rows,
        safe_int=safe_int,
        supabase=supabase(),
        hash_password=hash_password,
    )


def upsert_staff_account(existing_code, name, username, email, password, role, status):
    return staff_upsert_account(
        existing_code,
        name,
        username,
        email,
        password,
        role,
        status,
        load_auth_accounts=load_auth_accounts,
        generate_staff_code=generate_staff_code,
        hash_password=hash_password,
        normalize_staff_role=normalize_staff_role,
        normalize_account_status=normalize_account_status,
        save_auth_accounts=save_auth_accounts,
        sync_staff_user_record=sync_staff_user_record,
    )


def build_staff_rows():
    return staff_build_rows(
        load_auth_accounts=load_auth_accounts,
        fetch_rows=fetch_rows,
        canonical_app_role_name=canonical_app_role_name,
        safe_int=safe_int,
        format_role_label=format_role_label,
        normalize_account_status=normalize_account_status,
        format_short_date=format_short_date,
    )


def build_staff_form_data(form, include_role_status=True):
    return staff_build_form_data(form, include_role_status=include_role_status)


def is_protected_staff_account(staff_code, username):
    return staff_is_protected_account(
        staff_code,
        username,
        admin_username=ADMIN_CREDENTIALS["username"],
    )


def get_protected_staff_notice():
    return staff_get_protected_notice()


def build_system_notifications(current_user=None):
    return ui_build_system_notifications(
        current_user,
        table_exists=table_exists,
        fetch_raw_rows=fetch_raw_rows,
        build_customer_lookup=build_customer_lookup,
        fetch_rows=fetch_rows,
        parse_iso_datetime=parse_iso_datetime,
        safe_int=safe_int,
    )


def ensure_core_role_accounts():
    if not table_exists("user"):
        return
    existing_admin = next(
        (row for row in fetch_rows("user") if str(row.get("username", "")).strip().lower() == ADMIN_CREDENTIALS["username"].lower()),
        None,
    )
    if not existing_admin:
        admin_pw = os.getenv("ADMIN_PASSWORD", "admin123")
        create_user_profile(ADMIN_CREDENTIALS["name"], ADMIN_CREDENTIALS["username"], "admin", password=admin_pw, status="active")


def sync_sales_summary_entry(summary_date=None):
    return sales_sync_summary_entry(
        summary_date,
        table_exists=table_exists,
        datetime_cls=datetime,
        build_sale_status_maps=build_sale_status_maps,
        fetch_rows=fetch_rows,
        safe_int=safe_int,
        safe_float=safe_float,
        defaultdict_cls=defaultdict,
        parse_iso_datetime=parse_iso_datetime,
        supabase=supabase(),
    )


def format_prediction_period_label(value):
    return sync_format_prediction_period_label(value)


def sync_promotion_notifications(promo_id):
    return promotion_sync_notifications(
        promo_id,
        safe_int=safe_int,
        table_exists=table_exists,
        supabase=supabase(),
        build_sale_status_maps=build_sale_status_maps,
        fetch_rows=fetch_rows,
        build_customer_lookup=build_customer_lookup,
    )


def send_promotion_notifications_via_gmail(promo_id):
    return promotion_send_notifications_via_gmail(
        promo_id,
        supabase=supabase(),
        table_exists=table_exists,
        fetch_rows=fetch_rows,
        safe_int=safe_int,
        sender_email=(
            os.getenv("GMAIL_SENDER_EMAIL", "").strip()
            or os.getenv("GMAIL_APP_EMAIL", "").strip()
        ),
        sender_name=os.getenv("GMAIL_SENDER_NAME", "Meryl Shoes").strip() or "Meryl Shoes",
        client_id=os.getenv("GMAIL_CLIENT_ID", "").strip(),
        client_secret=os.getenv("GMAIL_CLIENT_SECRET", "").strip(),
        refresh_token=os.getenv("GMAIL_REFRESH_TOKEN", "").strip(),
    )


# Backward-compatible helper name for legacy Flask routes.
def send_promotion_notifications_via_brevo(promo_id):
    return send_promotion_notifications_via_gmail(promo_id)


def ensure_default_categories():
    try:
        categories = fetch_rows("category")
        existing_names = {str(row.get("category_name", "")).strip().lower() for row in categories}
        missing_names = [
            {"category_name": name}
            for name in DEFAULT_CATEGORY_NAMES
            if name.strip().lower() not in existing_names
        ]
        if missing_names:
            supabase().table("category").insert(missing_names).execute()
    except Exception:
        pass


def send_otp_email(recipient_email, otp_code, display_name):
    smtp_email = (os.getenv("GMAIL_APP_EMAIL") or "").strip()
    smtp_password = (os.getenv("GMAIL_APP_PASSWORD") or "").replace(" ", "").strip()
    smtp_host = (os.getenv("SMTP_HOST") or "smtp.gmail.com").strip()
    smtp_port = int(os.getenv("SMTP_PORT") or "587")

    if not smtp_email or not smtp_password:
        raise RuntimeError(
            "Email OTP is not configured. Set GMAIL_APP_EMAIL and GMAIL_APP_PASSWORD first."
        )

    message = EmailMessage()
    message["Subject"] = "Your Meryl Shoes OTP Code"
    message["From"] = smtp_email
    message["To"] = recipient_email
    message.set_content(
        "\n".join(
            [
                f"Hello {display_name},",
                "",
                f"Your OTP code is: {otp_code}",
                "This code expires in 10 minutes.",
                "",
                "If you did not request this, you can ignore this email.",
            ]
        )
    )

    try:
        if smtp_port == 465:
            with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=4) as server:
                server.login(smtp_email, smtp_password)
                server.send_message(message)
                return
        else:
            with smtplib.SMTP(smtp_host, smtp_port, timeout=4) as server:
                server.starttls()
                server.login(smtp_email, smtp_password)
                server.send_message(message)
                return
    except smtplib.SMTPAuthenticationError as auth_err:
        logger.error(f"Gmail SMTP authentication failed for {smtp_email}: {auth_err}")
        raise RuntimeError(
            "Gmail authentication failed: Username and Password not accepted. "
            "Please use a 16-character Google App Password (not your personal Gmail password) from myaccount.google.com/apppasswords."
        ) from auth_err
    except (smtplib.SMTPConnectError, TimeoutError, OSError) as conn_err:
        logger.warning(f"SMTP connection on port {smtp_port} failed ({conn_err}), attempting SSL on port 465...")
        try:
            with smtplib.SMTP_SSL(smtp_host, 465, timeout=4) as server:
                server.login(smtp_email, smtp_password)
                server.send_message(message)
                return
        except smtplib.SMTPAuthenticationError as auth_err:
            raise RuntimeError(
                "Gmail authentication failed: Username and Password not accepted. "
                "Please use a 16-character Google App Password (not your personal Gmail password) from myaccount.google.com/apppasswords."
            ) from auth_err
        except Exception as fallback_err:
            logger.error(f"Fallback SMTP_SSL also failed: {fallback_err}")
            raise RuntimeError(f"Unable to connect to Gmail SMTP server: {conn_err}") from conn_err


def find_active_user_management_account_by_email(email):
    normalized_email = str(email or "").strip().lower()
    if not normalized_email:
        return None

    if table_exists("user"):
        role_lookup = {
            str(role.get("role_id")): role
            for role in fetch_rows("role")
        } if table_exists("role") else {}

        for user_row in fetch_rows("user"):
            if str(user_row.get("email") or "").strip().lower() != normalized_email:
                continue
            if str(user_row.get("status") or "active").strip().lower() != "active":
                return None
            role = role_lookup.get(str(user_row.get("role_id")))
            role_name = str((role or {}).get("role_name") or user_row.get("role_name") or "staff").strip()
            user_row["role_name"] = role_name
            return user_row

    for account in load_auth_accounts():
        if str(account.get("email") or "").strip().lower() == normalized_email:
            if str(account.get("status") or "active").strip().lower() != "active":
                return None
            return account

    return None


def update_staff_password_by_email(email, new_password):
    normalized_email = str(email or "").strip().lower()
    clean_password = str(new_password or "")
    if len(clean_password) < 8:
        raise ValueError("Password must be at least 8 characters.")

    accounts = load_auth_accounts()
    password_updated = False
    hashed = hash_password(clean_password)
    for account in accounts:
        if str(account.get("email") or "").strip().lower() != normalized_email:
            continue
        account.pop("password", None)
        account["password_hash"] = hashed
        account["updated_at"] = datetime.now().isoformat()
        password_updated = True
        sync_staff_user_record(account)

    if password_updated:
        save_auth_accounts(accounts)

    user_payload = {
        "password": hashed,
        "updated_at": datetime.now().isoformat(),
    }
    result = (
        supabase()
        .table("user")
        .update(user_payload)
        .eq("email", normalized_email)
        .eq("status", db_user_status("active"))
        .execute()
    )
    if not (result.data or password_updated):
        raise ValueError("No active User Management account matches this email.")

    return True


def create_user_profile(name, username, role, password=None, status="active"):
    try:
        existing_rows = fetch_rows("user")
        existing_user = next(
            (
                row
                for row in existing_rows
                if str(row.get("username", "")).strip().lower() == username.lower()
            ),
            None,
        )
        if existing_user:
            return existing_user

        role_id = get_role_id_for_app_role(role)
        if role_id <= 0:
            return None

        raw_pw = password or (
            os.getenv("ADMIN_PASSWORD", "admin123") if canonical_app_role_name(role) == "admin" else "staff123"
        )
        hashed_pw = raw_pw if str(raw_pw).startswith("$2") else hash_password(raw_pw)

        created = (
            supabase().table("user")
            .insert(
                {
                    "name": name,
                    "username": username,
                    "password": hashed_pw,
                    "role_id": role_id,
                    "status": db_user_status(status),
                }
            )
            .execute()
            .data
            or []
        )
        if created:
            return created[0]
    except Exception:
        return None

    return None


def get_current_user():
    return ui_build_current_user_context(
        session.get("current_user"),
        build_system_notifications=build_system_notifications,
    )


def get_navigation_items():
    return ui_build_navigation_items(get_current_user())


def render_page(template_name, **context):
    return render_template(
        template_name,
        **ui_build_render_context(
            pop_notice=pop_notice,
            get_current_user=get_current_user,
            get_navigation_items=get_navigation_items,
            extra_context=context,
        ),
    )


def has_react_shell():
    return (REACT_DIST_DIR / "index.html").exists()


def render_react_shell():
    if not has_react_shell():
        abort(404)
    response = send_from_directory(str(REACT_DIST_DIR), "index.html")
    # The React index references hashed chunks. Prevent stale cached HTML from
    # pointing browsers to chunks that were replaced by a newer deployment.
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


def get_post_login_redirect(role):
    return ui_get_post_login_redirect(role)


def get_account_settings_fallback_redirect(role):
    return ui_get_account_settings_fallback_redirect(role)


def build_login_form_data(form):
    return ui_build_login_form_data(form)


def build_session_user_payload(user):
    return ui_build_session_user_payload(user)


def build_admin_login_payload(admin_credentials):
    return ui_build_admin_login_payload(admin_credentials)


def build_staff_login_payload(account):
    return ui_build_staff_login_payload(account)


def get_missing_account_notice():
    return ui_get_missing_account_notice()


def get_missing_account_redirect(role, for_save=False):
    return ui_get_missing_account_redirect(role, for_save=for_save)


def get_logout_notice():
    return ui_get_logout_notice()


def get_logout_redirect():
    return ui_get_logout_redirect()


def get_login_required_notice():
    return ui_get_login_required_notice()


def get_access_denied_notice():
    return ui_get_access_denied_notice()


def get_invalid_login_notice():
    return ui_get_invalid_login_notice()


def resolve_request_identity():
    """Verify the caller of a React API request.

    Accepts the staff session token (X-Meryl-Session, issued by the login_user
    database function) or a Supabase access token (Authorization: Bearer, from
    Google/email-OTP sign-in). Both are checked by asking the database who the
    caller is, so a forged or revoked token resolves to nobody.
    """
    supabase_url = (os.getenv("SUPABASE_URL") or "").rstrip("/")
    anon_key = os.getenv("SUPABASE_ANON_KEY") or os.getenv("SUPABASE_KEY") or ""
    session_token = (request.headers.get("X-Meryl-Session") or "").strip()
    auth_header = (request.headers.get("Authorization") or "").strip()
    bearer = auth_header[7:].strip() if auth_header.lower().startswith("bearer ") else ""

    if not supabase_url or not anon_key or not (session_token or bearer):
        return None

    headers = {
        "apikey": anon_key,
        "Authorization": f"Bearer {bearer or anon_key}",
        "Content-Type": "application/json",
    }
    if session_token:
        headers["x-meryl-session"] = session_token

    try:
        whoami_request = urllib.request.Request(
            f"{supabase_url}/rest/v1/rpc/app_whoami",
            data=b"{}",
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(whoami_request, timeout=8) as response:
            user = json.loads(response.read().decode("utf-8") or "null")
    except Exception as exc:
        logger.warning(f"Session verification failed: {exc}")
        return None

    if not isinstance(user, dict) or not user.get("user_id"):
        return None
    if str(user.get("status") or "active").strip().lower() != "active":
        return None
    return user


def current_request_user():
    """Flask cookie session if present, otherwise a verified token identity."""
    if session.get("current_user"):
        return session["current_user"]
    if "verified_identity" not in g:
        identity = resolve_request_identity()
        g.verified_identity = (
            {
                "user_id": str(identity.get("user_id")),
                "username": identity.get("username"),
                "name": identity.get("name"),
                "role": identity.get("role_name"),
                "email": identity.get("email"),
            }
            if identity
            else None
        )
    return g.verified_identity


def login_required(view_func):
    @wraps(view_func)
    def wrapped_view(*args, **kwargs):
        if not current_request_user():
            if request.path.startswith("/api/"):
                return {"ok": False, "error": "authentication_required"}, 401
            set_notice(get_login_required_notice(), "warning")
            return redirect(url_for("login"))
        return view_func(*args, **kwargs)

    return wrapped_view


def roles_required(*allowed_roles):
    def decorator(view_func):
        @wraps(view_func)
        def wrapped_view(*args, **kwargs):
            current_user = current_request_user()
            if not current_user:
                if request.path.startswith("/api/"):
                    return {"ok": False, "error": "authentication_required"}, 401
                set_notice(get_login_required_notice(), "warning")
                return redirect(url_for("login"))

            # Stored role names vary ("Administrator", "admin", "Sales Staff"); compare canonical forms.
            current_role = canonical_app_role_name(current_user.get("role"))
            if current_role not in {canonical_app_role_name(role) for role in allowed_roles}:
                if request.path.startswith("/api/"):
                    return {"ok": False, "error": "forbidden"}, 403
                set_notice(get_access_denied_notice(), "warning")
                return redirect("/")
            return view_func(*args, **kwargs)

        return wrapped_view

    return decorator


# Request lifecycle hooks for robustness
@app.before_request
def before_request():
    """Called before each request. Can be used for setup."""
    # Store connection status in Flask's g object for this request
    try:
        supabase()
        g.supabase_connected = True
    except Exception as e:
        g.supabase_connected = False
        g.supabase_error = str(e)


# Health check endpoint (no auth required)
@app.route("/health", methods=["GET"])
def health_check():
    """Sanitized health check endpoint without leaking internal database topology."""
    return {"status": "healthy"}, 200


# Error handler for Supabase initialization failures
@app.errorhandler(RuntimeError)
def handle_runtime_error(error):
    """Handle runtime errors, particularly Supabase initialization failures."""
    error_msg = str(error)
    if "Supabase" in error_msg or "environment variables" in error_msg:
        logger.error(f"Configuration error: {error_msg}")
        return render_template("error.html",
            title="Configuration Error",
            message="The application is not properly configured. Please set SUPABASE_URL and SUPABASE_KEY environment variables.",
            details=error_msg
        ), 500
    return render_template("error.html",
        title="Application Error",
        message="An unexpected error occurred",
        details=error_msg
    ), 500


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "GET" and has_react_shell():
        return render_react_shell()

    ensure_core_role_accounts()
    if request.method == "POST":
        form_data = build_login_form_data(request.form)
        user = authenticate_login(form_data["username"], form_data["password"])
        if user:
            session["current_user"] = build_session_user_payload(user)
            set_notice(f"Welcome back, {user.get('name', 'User')}.")
            return redirect(get_post_login_redirect(user.get("role")))
        set_notice(get_invalid_login_notice(), "danger")
    return render_page("login.html")


@app.route("/")
def dashboard():
    if has_react_shell():
        return render_react_shell()

    context = page_build_dashboard_context(
        build_sales_rows=build_sales_rows,
        normalize_inventory_products=normalize_inventory_products,
        fetch_rows=fetch_rows,
        safe_float=safe_float,
        build_product_lookup=build_product_lookup,
        safe_int=safe_int,
    )
    return render_page("dashboard.html", **context)


@app.route("/sales")
def sales():
    if has_react_shell():
        return render_react_shell()

    context = page_build_sales_context(
        build_sales_rows=build_sales_rows,
        datetime_cls=datetime,
        safe_float=safe_float,
    )
    return render_page("sales.html", **context)


@app.route("/sales/export.csv")
@login_required
@roles_required("admin")
def sales_export_csv():
    csv_content = page_build_sales_export_csv_content(
        build_sales_rows=build_sales_rows,
        format_currency=format_currency,
    )
    response = Response(csv_content, mimetype="text/csv")
    response.headers["Content-Disposition"] = "attachment; filename=sales-records.csv"
    return response


@app.route("/inventory")
def inventory():
    if has_react_shell():
        return render_react_shell()

    context = page_build_inventory_context(
        normalize_inventory_products=normalize_inventory_products,
        fetch_rows=fetch_rows,
        build_filter_options=build_filter_options,
        safe_int=safe_int,
        build_category_options=build_category_options,
    )
    return render_page("inventory.html", **context)


@app.route("/admin")
def admin_shell():
    if has_react_shell():
        return render_react_shell()
    return redirect("/")


@app.route("/auth/callback")
def auth_callback_shell():
    if has_react_shell():
        return render_react_shell()
    return redirect("/")


@app.route("/auth/reset-password")
def auth_reset_password_shell():
    if has_react_shell():
        return render_react_shell()
    return redirect("/")


@app.route("/assets/<path:filename>")
def react_assets(filename):
    if not REACT_ASSETS_DIR.exists():
        abort(404)
    response = send_from_directory(str(REACT_ASSETS_DIR), filename)
    response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return response


@app.route("/favicon.ico")
@app.route("/favicon.svg")
@app.route("/favicon.png")
@app.route("/favicon-32x32.png")
@app.route("/favicon-16x16.png")
@app.route("/favicon-192x192.png")
@app.route("/apple-touch-icon.png")
@app.route("/Meryl_Logo_Red.svg")
def react_root_icons():
    filename = request.path.lstrip("/")
    dist_file = REACT_DIST_DIR / filename
    if dist_file.exists():
        response = send_from_directory(str(REACT_DIST_DIR), filename)
        response.headers["Cache-Control"] = "public, max-age=86400"
        return response
    public_file = Path(__file__).resolve().parent / "frontend" / "public" / filename
    if public_file.exists():
        response = send_from_directory(str(public_file.parent), filename)
        response.headers["Cache-Control"] = "public, max-age=86400"
        return response
    abort(404)


@app.route("/customers")
@login_required
@roles_required("admin")
def customers():
    context = page_build_customers_context(
        build_customer_rows=build_customer_rows,
        safe_int=safe_int,
    )
    return render_page("customers.html", **context)


@app.route("/staff")
@login_required
@roles_required("admin")
def staff_accounts():
    context = page_build_staff_accounts_context(
        ensure_core_role_accounts=ensure_core_role_accounts,
        build_staff_rows=build_staff_rows,
        generate_staff_code=generate_staff_code,
        load_auth_accounts=load_auth_accounts,
    )
    return render_page("staff_accounts.html", **context)


@app.route("/staff/save", methods=["POST"])
@login_required
@roles_required("admin")
def staff_accounts_save():
    try:
        form_data = build_staff_form_data(request.form)
    except ValueError as exc:
        set_notice(str(exc), "danger")
        return redirect("/staff")

    if is_protected_staff_account(form_data["staff_code"], form_data["username"]):
        set_notice(get_protected_staff_notice(), "warning")
        return redirect("/staff")

    try:
        saved_account = upsert_staff_account(
            form_data["staff_code"],
            form_data["name"],
            form_data["username"],
            form_data["email"],
            form_data["password"],
            form_data["role"],
            form_data["status"],
        )
        set_notice(f"Staff account {saved_account.get('staff_code')} saved successfully.")
    except ValueError as exc:
        set_notice(str(exc), "danger")
    except Exception as exc:
        set_notice(f"Unable to save staff account: {exc}", "danger")
    return redirect("/staff")


@app.route("/account/settings")
@login_required
@roles_required("sales_staff", "inventory_staff")
def account_settings():
    current_user = session.get("current_user", {})
    account = find_auth_account(current_user.get("staff_code") or current_user.get("username"))
    if not account:
        set_notice(get_missing_account_notice(), "warning")
        return redirect(get_missing_account_redirect(current_user.get("role")))
    return render_page("account_settings.html", account=account)


@app.route("/account/settings/save", methods=["POST"])
@login_required
@roles_required("sales_staff", "inventory_staff")
def account_settings_save():
    current_user = session.get("current_user", {})
    account = find_auth_account(current_user.get("staff_code") or current_user.get("username"))
    if not account:
        set_notice(get_missing_account_notice(), "warning")
        return redirect(get_missing_account_redirect(current_user.get("role"), for_save=True))

    try:
        form_data = build_staff_form_data(request.form, include_role_status=False)
    except ValueError as exc:
        set_notice(str(exc), "danger")
        return redirect("/account/settings")

    try:
        saved_account = upsert_staff_account(
            account.get("staff_code"),
            form_data["name"],
            form_data["username"],
            form_data["email"],
            form_data["password"],
            account.get("role"),
            account.get("status"),
        )
        session["current_user"] = build_session_user_payload(saved_account)
        set_notice("Your account details were updated successfully.")
    except ValueError as exc:
        set_notice(str(exc), "danger")
    except Exception as exc:
        set_notice(f"Unable to update account settings: {exc}", "danger")
    return redirect("/account/settings")


@app.route("/predictive")
@login_required
@roles_required("admin")
def predictive():
    demand_range = (request.args.get("demand_range") or "week").strip().lower()
    forecast_range = (request.args.get("forecast_range") or "last6").strip().lower()
    demand_day = (request.args.get("demand_day") or "").strip()
    demand_week = (request.args.get("demand_week") or "").strip()
    demand_month = (request.args.get("demand_month") or "").strip()
    context = page_build_predictive_context(
        demand_range=demand_range,
        forecast_range=forecast_range,
        demand_day=demand_day,
        demand_week=demand_week,
        demand_month=demand_month,
        build_predictive_context=build_predictive_context,
        safe_float=safe_float,
        round_fn=round,
    )
    return render_page("predictive.html", **context)


def build_chart_points(items, label_key, value_key, min_height=72, max_height=240):
    return sales_build_chart_points(
        items,
        label_key,
        value_key,
        min_height,
        max_height,
        safe_float=safe_float,
    )


def build_product_sku(product, index):
    return inventory_build_product_sku(product, index)


def build_category_lookup():
    return inventory_build_category_lookup(
        ensure_default_categories=ensure_default_categories,
        fetch_rows=fetch_rows,
    )


def build_category_options():
    return inventory_build_category_options(
        ensure_default_categories=ensure_default_categories,
        fetch_rows=fetch_rows,
    )


def sync_promotion_products(promo_id, target_category_id=None, target_product_id=None):
    return promotion_sync_products(
        promo_id,
        target_category_id,
        target_product_id,
        supabase=supabase(),
        safe_int=safe_int,
    )


def build_filter_options(inventory_products):
    return inventory_build_filter_options(inventory_products, safe_float=safe_float)


def build_product_group_key(product):
    return inventory_build_product_group_key(product, slugify_text=slugify_text)


def get_or_create_customer(customer_name, email="", phone="", address=""):
    return customer_get_or_create(
        customer_name,
        email,
        phone,
        address,
        fetch_rows=fetch_rows,
        supabase=supabase(),
        normalize_customer_rows=normalize_customer_rows,
    )


def build_pos_catalog(products):
    return pos_build_catalog(
        products,
        build_product_group_key=build_product_group_key,
        safe_float=safe_float,
        safe_int=safe_int,
    )


def build_sale_status_maps():
    return sales_build_status_maps(
        fetch_rows=fetch_rows,
        safe_int=safe_int,
        parse_iso_datetime=parse_iso_datetime,
        datetime_cls=datetime,
    )


def sync_sales_analytics_entry(product_id, quantity_delta, amount_delta):
    return sync_sales_analytics_entry_helper(
        product_id,
        quantity_delta,
        amount_delta,
        safe_int=safe_int,
        supabase=supabase(),
        safe_float=safe_float,
    )


def complete_sale_inventory(sales_id):
    return inventory_flow_complete_sale(
        sales_id,
        build_sale_status_maps=build_sale_status_maps,
        supabase=supabase(),
        safe_int=safe_int,
        get_inventory_row=get_inventory_row,
        upsert_inventory_record=upsert_inventory_record,
        sync_sales_analytics_entry=sync_sales_analytics_entry,
        safe_float=safe_float,
        table_exists=table_exists,
        db_payment_status=db_payment_status,
        sync_sales_summary_entry=sync_sales_summary_entry,
    )


def build_forecast_periods(forecast_range):
    return forecast_build_periods(forecast_range, datetime_cls=datetime)


def build_demand_range_buckets(demand_range):
    return forecast_build_demand_buckets(
        demand_range,
        datetime_cls=datetime,
        timedelta_cls=timedelta,
    )


def build_price_lookup():
    return inventory_build_price_lookup(
        fetch_rows=fetch_rows,
        safe_int=safe_int,
        safe_float=safe_float,
    )


def build_stock_lookup():
    return inventory_build_stock_lookup(
        table_exists=table_exists,
        fetch_rows=fetch_rows,
        safe_int=safe_int,
    )


def build_active_promotion_lookup():
    return promotion_build_active_lookup(
        fetch_rows=fetch_rows,
        parse_iso_datetime=parse_iso_datetime,
    )


def compute_promo_discount(base_price, promo):
    return promotion_compute_discount(
        base_price,
        promo,
        normalize_promotion_type=normalize_promotion_type,
        safe_float=safe_float,
    )


def normalize_cart_items(cart):
    return pos_normalize_cart_items(
        cart,
        safe_float=safe_float,
        safe_int=safe_int,
    )


def normalize_inventory_products(products):
    return inventory_normalize_products(
        products,
        build_category_lookup=build_category_lookup,
        build_price_lookup=build_price_lookup,
        build_stock_lookup=build_stock_lookup,
        build_active_promotion_lookup=build_active_promotion_lookup,
        safe_float=safe_float,
        safe_int=safe_int,
        compute_promo_discount=compute_promo_discount,
        build_product_sku=build_product_sku,
        build_product_group_key=build_product_group_key,
    )


def build_product_lookup():
    return inventory_build_product_lookup(
        normalize_inventory_products=normalize_inventory_products,
        fetch_rows=fetch_rows,
    )


def build_user_lookup():
    return {row["user_id"]: row for row in fetch_rows("user")}


def build_customer_lookup():
    return customer_build_lookup(fetch_rows=fetch_rows)


def verify_credentials_server(identifier, password):
    clean_identifier = str(identifier or "").strip().lower()
    clean_password = str(password or "").strip()
    if not clean_identifier or not clean_password:
        return None

    # 1. Try Supabase login_user RPC via direct HTTP to bypass SDK pydantic parsing differences
    sb_url = os.getenv("SUPABASE_URL", "https://vylmcqmxpxqkldosowrs.supabase.co").rstrip("/")
    sb_key = os.getenv("SUPABASE_ANON_KEY") or os.getenv("SUPABASE_KEY")
    if not sb_key or sb_key.startswith("sb_publishable_"):
        sb_key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5bG1jcW14cHhxa2xkb3Nvd3JzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NjI0MTAsImV4cCI6MjA5MzAzODQxMH0.NxMMQZ3nFQmpYua-zsd5RNgdaA6zgBIm0XR3NDlds2c"

    try:
        rpc_url = f"{sb_url}/rest/v1/rpc/login_user"
        rpc_headers = {
            "apikey": sb_key,
            "Authorization": f"Bearer {sb_key}",
            "Content-Type": "application/json",
        }
        # Only verifying credentials here; the backend keeps its own cookie session.
        rpc_body = json.dumps(
            {"p_username": clean_identifier, "p_password": clean_password, "p_issue_session": False}
        ).encode("utf-8")
        req = urllib.request.Request(rpc_url, data=rpc_body, headers=rpc_headers, method="POST")
        with urllib.request.urlopen(req, timeout=8) as resp:
            if resp.status == 200:
                raw_payload = resp.read().decode("utf-8")
                data = json.loads(raw_payload)
                if isinstance(data, dict):
                    if data.get("error") == "inactive" or str(data.get("status", "")).lower() == "inactive":
                        raise ValueError("This account is inactive. Please contact the administrator.")
                    if data.get("user_id"):
                        return {
                            "user_id": str(data.get("user_id")),
                            "name": data.get("name") or "User",
                            "username": data.get("username") or clean_identifier,
                            "role_name": data.get("role_name") or "",
                            "role_id": str(data.get("role_id") or ""),
                            "status": data.get("status") or "active",
                            "email": data.get("email") or "",
                            "avatar_url": data.get("avatar_url") or "",
                        }
    except Exception as exc:
        if "inactive" in str(exc).lower():
            raise
        logger.warning(f"login_user direct RPC check error: {exc}")

    # 2. Query user table directly with bcrypt / sha256
    try:
        users = supabase().table("user").select("user_id, name, username, password, role_id, status, email, avatar_url").ilike("username", clean_identifier).limit(1).execute().data or []
        if not users:
            users = supabase().table("user").select("user_id, name, username, password, role_id, status, email, avatar_url").ilike("email", clean_identifier).limit(1).execute().data or []
        if not users:
            users = supabase().table("user").select("user_id, name, username, password, role_id, status, email, avatar_url").ilike("name", clean_identifier).limit(1).execute().data or []
        if users:
            row = users[0]
            status = str(row.get("status") or "active").lower()
            if status in {"inactive", "disabled", "deactivated"}:
                raise ValueError("This account is inactive. Please contact the administrator.")

            db_pw = str(row.get("password") or "")
            matched = False
            if db_pw.startswith("$2"):
                try:
                    import bcrypt
                    matched = bcrypt.checkpw(clean_password.encode("utf-8"), db_pw.encode("utf-8"))
                except Exception:
                    pass
            elif db_pw:
                sha = hashlib.sha256(clean_password.encode("utf-8")).hexdigest()
                if hmac.compare_digest(db_pw, sha) or db_pw == clean_password:
                    matched = True
                    # Auto-upgrade legacy password to bcrypt
                    try:
                        upgraded = hash_password(clean_password)
                        supabase().table("user").update({"password": upgraded}).eq("user_id", row.get("user_id")).execute()
                        logger.info(f"Auto-upgraded user {clean_identifier} password to bcrypt")
                    except Exception as up_err:
                        logger.warning(f"Could not auto-upgrade password for {clean_identifier}: {up_err}")

            if matched:
                role_id = row.get("role_id")
                role_name = "Administrator"
                if role_id:
                    role_rows = supabase().table("role").select("role_name").eq("role_id", role_id).limit(1).execute().data or []
                    if role_rows:
                        role_name = role_rows[0].get("role_name") or "Administrator"

                # Sanitize avatar_url to ensure large base64 or invalid strings never get returned or placed in JWT
                raw_avatar = str(row.get("avatar_url") or "").strip()
                safe_avatar = raw_avatar if (raw_avatar.startswith("http://") or raw_avatar.startswith("https://")) and len(raw_avatar) < 512 and not raw_avatar.startswith("data:") else ""

                return {
                    "user_id": str(row.get("user_id")),
                    "name": row.get("name") or "User",
                    "username": row.get("username") or clean_identifier,
                    "role_name": role_name,
                    "role_id": str(role_id or ""),
                    "status": row.get("status") or "active",
                    "email": row.get("email") or "",
                    "avatar_url": safe_avatar,
                }
    except Exception as exc:
        if "inactive" in str(exc).lower():
            raise
        logger.warning(f"Direct user table lookup error: {exc}")

    # 3. Fallback to auth_accounts.json if present
    account = find_auth_account(clean_identifier)
    if account:
        status = str(account.get("status") or "active").lower()
        if status in {"inactive", "disabled", "deactivated"}:
            raise ValueError("This account is inactive. Please contact the administrator.")
        pw_hash = account.get("password_hash")
        matched = (pw_hash == hash_password(clean_password)) if pw_hash else (account.get("password") == clean_password)
        if matched:
            role_name = format_role_label(account.get("role", "sales_staff"))
            resolved_user_id = str(account.get("user_id") or "").strip()

            # Ensure resolved_user_id is a valid UUID by looking up the user in Supabase
            if not resolved_user_id or not re.match(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", resolved_user_id, re.I):
                try:
                    db_user_res = (
                        supabase()
                        .table("user")
                        .select("user_id, role_id")
                        .ilike("username", clean_identifier)
                        .limit(1)
                        .execute()
                    )
                    if db_user_res.data and db_user_res.data[0].get("user_id"):
                        resolved_user_id = str(db_user_res.data[0]["user_id"])
                except Exception:
                    pass

            if not resolved_user_id or not re.match(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", resolved_user_id, re.I):
                import uuid
                resolved_user_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"meryl:user:{clean_identifier}"))

            return {
                "user_id": resolved_user_id,
                "name": account.get("name") or "Staff User",
                "username": account.get("username") or clean_identifier,
                "role_name": role_name,
                "role_id": str(account.get("staff_code") or ""),
                "status": account.get("status") or "active",
                "email": account.get("email") or "",
                "avatar_url": "",
            }

    return None


def authenticate_login(identifier, password):
    try:
        user_info = verify_credentials_server(identifier, password)
        if user_info:
            return {
                "name": user_info["name"],
                "username": user_info["username"],
                "role": user_info["role_name"],
                "email": user_info["email"],
                "user_id": user_info["user_id"],
                "status": user_info["status"],
            }
    except Exception:
        return None
    return None


def build_sales_rows():
    return sales_build_rows(
        build_product_lookup=build_product_lookup,
        build_customer_lookup=build_customer_lookup,
        build_sale_status_maps=build_sale_status_maps,
        fetch_rows=fetch_rows,
        parse_iso_datetime=parse_iso_datetime,
        datetime_cls=datetime,
        safe_int=safe_int,
        safe_float=safe_float,
    )


def build_customer_rows():
    return customer_build_rows(
        fetch_rows=fetch_rows,
        build_sale_status_maps=build_sale_status_maps,
        safe_int=safe_int,
        safe_float=safe_float,
        parse_iso_datetime=parse_iso_datetime,
        datetime_cls=datetime,
    )


def get_reorder_level(product):
    return inventory_get_reorder_level(product, safe_int=safe_int)


def moving_average_forecast(values, window=3):
    return forecast_moving_average(values, window=window, safe_float=safe_float)


def weighted_moving_average_forecast(values, window=4):
    return forecast_weighted_moving_average(values, window=window, safe_float=safe_float)


def linear_regression_forecast(values):
    return forecast_linear_regression(values, safe_float=safe_float)


def blended_recent_forecast(values):
    return forecast_blended_recent(
        values,
        safe_float=safe_float,
        moving_average_forecast_fn=moving_average_forecast,
        weighted_moving_average_forecast_fn=weighted_moving_average_forecast,
        linear_regression_forecast_fn=linear_regression_forecast,
    )


def sync_prediction_results(prediction_payloads):
    return sync_prediction_results_helper(
        prediction_payloads,
        fetch_rows=fetch_rows,
        safe_int=safe_int,
        safe_float=safe_float,
        supabase=supabase(),
        table_exists=table_exists,
    )


def build_predictive_context(demand_range="week", forecast_range="last6", demand_day=None, demand_week=None, demand_month=None):
    return predictive_build_context(
        demand_range,
        forecast_range,
        demand_day=demand_day,
        demand_week=demand_week,
        demand_month=demand_month,
        build_product_lookup=build_product_lookup,
        fetch_rows=fetch_rows,
        build_sale_status_maps=build_sale_status_maps,
        safe_int=safe_int,
        build_demand_range_buckets=build_demand_range_buckets,
        build_forecast_periods=build_forecast_periods,
        parse_iso_datetime=parse_iso_datetime,
        safe_float=safe_float,
        get_reorder_level=get_reorder_level,
        weighted_moving_average_forecast=weighted_moving_average_forecast,
        linear_regression_forecast=linear_regression_forecast,
        blended_recent_forecast=blended_recent_forecast,
        sync_prediction_results=sync_prediction_results,
        format_prediction_period_label=format_prediction_period_label,
    )


def build_promotions_context():
    return promotion_build_context(
        fetch_rows=fetch_rows,
        build_product_lookup=build_product_lookup,
        safe_float=safe_float,
        safe_int=safe_int,
        normalize_promotion_type=normalize_promotion_type,
        format_promotion_type=format_promotion_type,
        format_promotion_discount=format_promotion_discount,
        format_short_date=format_short_date,
        build_chart_points=build_chart_points,
    )


def build_reports_context():
    return predictive_build_reports_context(
        build_sale_status_maps=build_sale_status_maps,
        fetch_rows=fetch_rows,
        build_product_lookup=build_product_lookup,
        normalize_inventory_products=normalize_inventory_products,
        build_customer_lookup=build_customer_lookup,
        safe_int=safe_int,
        parse_iso_datetime=parse_iso_datetime,
        safe_float=safe_float,
        build_chart_points=build_chart_points,
        sync_sales_summary_entry=sync_sales_summary_entry,
        get_reorder_level=get_reorder_level,
    )


@app.route("/promotions")
@login_required
@roles_required("admin")
def promotions():
    (
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
    ) = build_promotions_context()
    return render_page(
        "promotions.html",
        campaign_rows=campaign_rows,
        active_count=active_count,
        total_revenue=total_revenue,
        total_units=total_units,
        average_effectiveness=average_effectiveness,
        promotion_chart=promotion_chart,
        category_impact=category_impact,
        discount_effectiveness=discount_effectiveness,
        discount_ticks=discount_ticks,
        promotion_comparison=promotion_comparison,
        category_distribution=category_distribution,
        category_options=build_category_options(),
    )


@app.route("/promotions/save", methods=["POST"])
@login_required
@roles_required("admin")
def promotions_save():
    promo_id = safe_int(request.form.get("promo_id"), 0)
    promo_name = (request.form.get("promo_name") or "").strip()
    raw_discount_type = (request.form.get("discount_type") or "percentage").strip().lower()
    discount_type = db_promotion_type(raw_discount_type)
    discount_value = safe_float(request.form.get("discount_value"), 0)
    target_category_value = (request.form.get("target_category_id") or "all").strip().lower()
    target_product_id = safe_int(request.form.get("target_product_id"), 0)
    start_date = (request.form.get("start_date") or "").strip()
    end_date = (request.form.get("end_date") or "").strip()
    status = db_promotion_status(request.form.get("status") or "active")

    if not promo_name or not start_date or not end_date:
        set_notice("Promotion name, start date, and end date are required.", "danger")
        return redirect("/promotions")

    payload = {
        "promo_name": promo_name,
        "discount_type": discount_type,
        "discount_value": discount_value,
        "start_date": start_date,
        "end_date": end_date,
        "status": status,
    }

    target_category_id = None if target_category_value == "all" else safe_int(target_category_value)

    try:
        if promo_id > 0:
            supabase().table("promotion").update(payload).eq("promo_id", promo_id).execute()
            linked_count = sync_promotion_products(promo_id, target_category_id, target_product_id)
            sync_promotion_notifications(promo_id)
            delivery = send_promotion_notifications_via_brevo(promo_id)
            if delivery.get("enabled"):
                set_notice(
                    f"Promotion updated. Linked products: {linked_count}. Emails sent: {delivery.get('sent', 0)}, failed: {delivery.get('failed', 0)}."
                )
            else:
                set_notice(
                    f"Promotion updated. Linked products: {linked_count}. Email send skipped ({delivery.get('reason', 'not configured')}).",
                    "warning",
                )
        else:
            created = supabase().table("promotion").insert(payload).execute().data or []
            if not created:
                raise ValueError("Promotion was not created.")
            new_promo_id = created[0]["promo_id"]
            linked_count = sync_promotion_products(new_promo_id, target_category_id, target_product_id)
            sync_promotion_notifications(new_promo_id)
            delivery = send_promotion_notifications_via_brevo(new_promo_id)
            if delivery.get("enabled"):
                set_notice(
                    f"Promotion created. Linked products: {linked_count}. Emails sent: {delivery.get('sent', 0)}, failed: {delivery.get('failed', 0)}."
                )
            else:
                set_notice(
                    f"Promotion created. Linked products: {linked_count}. Email send skipped ({delivery.get('reason', 'not configured')}).",
                    "warning",
                )
    except Exception as exc:
        set_notice(f"Unable to save promotion: {exc}", "danger")

    return redirect("/promotions")


@app.route("/promotions/delete/<int:promo_id>", methods=["POST"])
@login_required
@roles_required("admin")
def promotions_delete(promo_id):
    try:
        if table_exists("notification"):
            supabase().table("notification").delete().eq("promo_id", promo_id).execute()
        supabase().table("promo_product").delete().eq("promo_id", promo_id).execute()
        supabase().table("promotion").delete().eq("promo_id", promo_id).execute()
        set_notice("Promotion deleted successfully.")
    except Exception as exc:
        set_notice(f"Unable to delete promotion: {exc}", "danger")
    return redirect("/promotions")


def parse_promotion_date(value):
    value = str(value or "").strip()[:10]
    if not value:
        raise ValueError("empty")
    # Primary expected format (HTML date input)
    try:
        return datetime.fromisoformat(value).date()
    except ValueError:
        pass
    # Fallback for localized dd/mm/yyyy display/input
    for fmt in ("%d/%m/%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    raise ValueError("invalid")


def validate_promotion_date_range(start_date, end_date, *, allow_past_start=False):
    today = datetime.now().date()
    start_raw = str(start_date or "").strip()[:10]
    end_raw = str(end_date or "").strip()[:10]
    if not start_raw or not end_raw:
        return False, "Start date and end date are required."

    try:
        start = parse_promotion_date(start_raw)
        end = parse_promotion_date(end_raw)
    except ValueError:
        return False, "Start date and end date must be valid dates."
    if start < today and not allow_past_start:
        return False, "Start date cannot be in the past."
    if end < today:
        return False, "End date cannot be in the past."
    if end < start:
        return False, "End date cannot be earlier than the start date."
    return True, ""


def normalize_promotion_api_payload(payload, *, allow_past_start=False):
    payload = payload or {}
    promo_name = str(payload.get("promo_name") or "").strip()
    start_date = str(payload.get("start_date") or "").strip()[:10]
    end_date = str(payload.get("end_date") or "").strip()[:10]
    is_valid, error = validate_promotion_date_range(
        start_date,
        end_date,
        allow_past_start=allow_past_start,
    )
    if not promo_name:
        return None, "Promotion name is required."
    if not is_valid:
        return None, error

    try:
        start_iso = parse_promotion_date(start_date).isoformat()
        end_iso = parse_promotion_date(end_date).isoformat()
    except ValueError:
        return None, "Start date and end date must be valid dates."

    raw_discount_type = normalize_promotion_type(payload.get("discount_type") or "percentage")
    normalized_discount_type = db_promotion_type(payload.get("discount_type") or "percentage")
    discount_value = safe_float(payload.get("discount_value"), 0)
    # Some schemas enforce discount_value > 0. Keep BOGO representable and valid.
    if raw_discount_type == "bogo" and discount_value <= 0:
        discount_value = 50
    if normalized_discount_type in {"percentage", "fixed"} and discount_value <= 0:
        discount_value = 1

    normalized = {
        "promo_name": promo_name,
        "discount_type": normalized_discount_type,
        "discount_value": discount_value,
        "start_date": start_iso,
        "end_date": end_iso,
        "status": db_promotion_status(payload.get("status") or "inactive"),
    }
    if "target_products" in payload:
        normalized["target_products"] = str(payload.get("target_products") or "All Products").strip() or "All Products"
    return normalized, ""


def promotion_write_without_optional_columns(write_fn, payload):
    try:
        return write_fn(payload)
    except Exception as exc:
        message = str(exc).lower()
        if "target_products" in message and "column" in message and "target_products" in payload:
            fallback_payload = {key: value for key, value in payload.items() if key != "target_products"}
            return write_fn(fallback_payload)
        raise


@app.route("/api/promotions/public", methods=["POST"])
@login_required
def api_promotion_create_public():
    payload, error = normalize_promotion_api_payload(request.get_json(silent=True) or {})
    if error:
        return {"ok": False, "error": error}, 400
    requested_id = str((request.get_json(silent=True) or {}).get("promo_id") or "").strip()
    if requested_id and requested_id.isdigit():
        payload["promo_id"] = int(requested_id)

    try:
        def insert(row):
            return supabase().table("promotion").insert(row).execute().data or []

        created = promotion_write_without_optional_columns(insert, payload)
        if not created:
            raise ValueError("Promotion was not created.")
        return {"ok": True, "promotion": created[0], **created[0]}
    except Exception as exc:
        logger.exception("Promotion create failed")
        return {"ok": False, "error": str(exc) or "Unknown promotion update error"}, 500


@app.route("/api/promotions/<promo_id>/public", methods=["PATCH"])
@login_required
def api_promotion_update_public(promo_id):
    promo_id = str(promo_id or "").strip()
    if not promo_id:
        return {"ok": False, "error": "missing_promo_id"}, 400

    raw_payload = request.get_json(silent=True) or {}
    requested_start_date = str(raw_payload.get("start_date") or "").strip()[:10]
    allow_past_start = False
    try:
        existing_rows = (
            supabase()
            .table("promotion")
            .select("start_date")
            .eq("promo_id", promo_id)
            .limit(1)
            .execute()
            .data
            or []
        )
        existing_start_date = str((existing_rows[0] or {}).get("start_date") or "").strip()[:10] if existing_rows else ""
        allow_past_start = bool(existing_start_date and requested_start_date and existing_start_date == requested_start_date)
    except Exception:
        allow_past_start = False

    payload, error = normalize_promotion_api_payload(
        raw_payload,
        allow_past_start=allow_past_start,
    )
    if error:
        return {"ok": False, "error": error}, 400

    try:
        def update(row):
            return (
                supabase()
                .table("promotion")
                .update(row)
                .eq("promo_id", promo_id)
                .execute()
                .data
                or []
            )

        updated = promotion_write_without_optional_columns(update, payload)
        if not updated:
            raise ValueError("Promotion was not updated.")
        return {"ok": True, "promotion": updated[0], **updated[0]}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}, 500


@app.route("/api/promotions/<promo_id>/notify", methods=["POST"])
@login_required
def api_promotion_notify(promo_id):
    try:
        promo_id = str(promo_id or "").strip()
        if not promo_id:
            return {"ok": False, "error": "missing_promo_id"}, 400

        sync_promotion_notifications(promo_id)
        delivery = send_promotion_notifications_via_brevo(promo_id)
        delivery_results = {}
        for result in (delivery.get("results", []) if isinstance(delivery, dict) else []):
            customer_key = str(result.get("customer_id") or "").strip()
            email_key = str(result.get("email") or "").strip().lower()
            if customer_key:
                delivery_results[f"customer:{customer_key}"] = result
            if email_key:
                delivery_results[f"email:{email_key}"] = result

        recipients = []
        if table_exists("notification"):
            customer_lookup = {}
            for row in (supabase().table("customer").select("customer_id, email").execute().data or []):
                key = str(row.get("customer_id") or "").strip()
                if key:
                    customer_lookup[key] = str(row.get("email") or "").strip()

            rows = (
                supabase()
                .table("notification")
                .select("notification_id, customer_id, promo_id, email_status, date_sent")
                .eq("promo_id", promo_id)
                .execute()
                .data
                or []
            )
            recipients = []
            for row in rows:
                customer_id = str(row.get("customer_id") or "").strip()
                email = customer_lookup.get(customer_id, "")
                delivery_result = delivery_results.get(f"customer:{customer_id}") or delivery_results.get(
                    f"email:{email.lower()}"
                ) or {}
                recipients.append(
                    {
                        **row,
                        "email": email,
                        "email_status": delivery_result.get("status") or row.get("email_status"),
                        "send_error": delivery_result.get("reason") or "",
                    }
                )

        return {
            "ok": True,
            "promo_id": promo_id,
            "delivery": delivery,
            "recipients": recipients,
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}, 500


@app.route("/api/promotions/<promo_id>/notify/public", methods=["POST"])
@login_required
def api_promotion_notify_public(promo_id):
    """
    Legacy alias of the notify route. React sessions authenticate with the
    X-Meryl-Session / Bearer headers accepted by login_required.
    """
    try:
        promo_id = str(promo_id or "").strip()
        if not promo_id:
            return {"ok": False, "error": "missing_promo_id"}, 400

        sync_promotion_notifications(promo_id)
        delivery = send_promotion_notifications_via_brevo(promo_id)
        delivery_results = {}
        for result in (delivery.get("results", []) if isinstance(delivery, dict) else []):
            customer_key = str(result.get("customer_id") or "").strip()
            email_key = str(result.get("email") or "").strip().lower()
            if customer_key:
                delivery_results[f"customer:{customer_key}"] = result
            if email_key:
                delivery_results[f"email:{email_key}"] = result

        recipients = []
        if table_exists("notification"):
            customer_lookup = {}
            for row in (supabase().table("customer").select("customer_id, email").execute().data or []):
                key = str(row.get("customer_id") or "").strip()
                if key:
                    customer_lookup[key] = str(row.get("email") or "").strip()

            rows = (
                supabase()
                .table("notification")
                .select("notification_id, customer_id, promo_id, email_status, date_sent")
                .eq("promo_id", promo_id)
                .execute()
                .data
                or []
            )
            recipients = []
            for row in rows:
                customer_id = str(row.get("customer_id") or "").strip()
                email = customer_lookup.get(customer_id, "")
                delivery_result = delivery_results.get(f"customer:{customer_id}") or delivery_results.get(
                    f"email:{email.lower()}"
                ) or {}
                recipients.append(
                    {
                        **row,
                        "email": email,
                        "email_status": delivery_result.get("status") or row.get("email_status"),
                        "send_error": delivery_result.get("reason") or "",
                    }
                )

        return {
            "ok": True,
            "promo_id": promo_id,
            "delivery": delivery,
            "recipients": recipients,
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}, 500


@app.route("/api/promotions/<promo_id>", methods=["DELETE"])
@login_required
def api_promotion_delete(promo_id):
    try:
        promo_id = str(promo_id or "").strip()
        if not promo_id:
            return {"ok": False, "error": "missing_promo_id"}, 400

        if table_exists("notification"):
            supabase().table("notification").delete().eq("promo_id", promo_id).execute()
        if table_exists("promo_product"):
            supabase().table("promo_product").delete().eq("promo_id", promo_id).execute()

        supabase().table("promotion").delete().eq("promo_id", promo_id).execute()
        return {"ok": True, "promo_id": promo_id}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}, 500


def build_gmail_health_payload():
    sender_email = (
        os.getenv("GMAIL_SENDER_EMAIL", "").strip()
        or os.getenv("GMAIL_APP_EMAIL", "").strip()
    )
    sender_name = os.getenv("GMAIL_SENDER_NAME", "Meryl Shoes").strip() or "Meryl Shoes"
    client_id = os.getenv("GMAIL_CLIENT_ID", "").strip()
    client_secret = os.getenv("GMAIL_CLIENT_SECRET", "").strip()
    refresh_token = os.getenv("GMAIL_REFRESH_TOKEN", "").strip()

    notification_table_ready = table_exists("notification")
    promotion_table_ready = table_exists("promotion")

    issues = []
    if not sender_email:
        issues.append("GMAIL_SENDER_EMAIL is missing")
    if not client_id:
        issues.append("GMAIL_CLIENT_ID is missing")
    if not client_secret:
        issues.append("GMAIL_CLIENT_SECRET is missing")
    if not refresh_token:
        issues.append("GMAIL_REFRESH_TOKEN is missing")
    if not notification_table_ready:
        issues.append("notification table is missing")
    if not promotion_table_ready:
        issues.append("promotion table is missing")
    gmail_runtime = promotion_get_gmail_runtime_state()
    if not gmail_runtime.get("connected", True) and gmail_runtime.get("last_error"):
        issues.append(f"gmail_runtime: {gmail_runtime.get('last_error')}")

    return {
        "ok": len(issues) == 0,
        "gmail": {
            "sender_email_configured": bool(sender_email),
            "sender_email": sender_email if sender_email else None,
            "sender_name": sender_name,
            "client_id_configured": bool(client_id),
            "client_secret_configured": bool(client_secret),
            "refresh_token_configured": bool(refresh_token),
            "runtime_connected": bool(gmail_runtime.get("connected", True)),
            "runtime_last_error": gmail_runtime.get("last_error") or None,
            "runtime_updated_at": gmail_runtime.get("updated_at"),
        },
        "database": {
            "notification_table_ready": notification_table_ready,
            "promotion_table_ready": promotion_table_ready,
        },
        "issues": issues,
    }


@app.route("/api/integrations/gmail/health", methods=["GET"])
def api_gmail_health():
    try:
        return build_gmail_health_payload()
    except Exception as exc:
        return {"ok": False, "error": str(exc)}, 500


@app.route("/api/integrations/gmail/health/public", methods=["GET"])
def api_gmail_health_public():
    try:
        payload = build_gmail_health_payload()
        gmail = payload.get("gmail", {})
        return {
            "ok": payload.get("ok", False),
            "gmail": {
                "sender_email_configured": gmail.get("sender_email_configured", False),
                "sender_name": gmail.get("sender_name"),
                "client_id_configured": gmail.get("client_id_configured", False),
                "client_secret_configured": gmail.get("client_secret_configured", False),
                "refresh_token_configured": gmail.get("refresh_token_configured", False),
            },
            "database": payload.get("database", {}),
            "issues": payload.get("issues", []),
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}, 500


# Backward-compatible health URLs. They now report Gmail configuration because
# Brevo has been removed as the promotion email provider.
@app.route("/api/integrations/brevo/health", methods=["GET"])
def api_brevo_health():
    return api_gmail_health()


@app.route("/api/integrations/brevo/health/public", methods=["GET"])
def api_brevo_health_public():
    return api_gmail_health_public()


@app.route("/api/auth/password-reset/request", methods=["POST"])
def api_password_reset_request():
    payload = request.get_json(silent=True) or {}
    email = str(payload.get("email") or "").strip().lower()
    if not email:
        return {"ok": False, "error": "Email is required."}, 400

    user_row = find_active_user_management_account_by_email(email)
    if not user_row:
        return {
            "ok": False,
            "error": "Your account is not authorized to reset a password. Please contact the administrator.",
        }, 403

    otp_code = f"{random.SystemRandom().randint(10000000, 99999999)}"
    expires_at = datetime.utcnow() + timedelta(minutes=10)

    try:
        supabase().table("password_reset_otp").delete().eq("email", email).is_("used_at", "null").execute()
        supabase().table("password_reset_otp").insert(
            {
                "email": email,
                "otp_hash": hash_password(otp_code),
                "expires_at": expires_at.isoformat(),
                "failed_attempts": 0,
            }
        ).execute()
    except Exception as db_exc:
        logger.exception("Failed to store password reset OTP in database")
        return {"ok": False, "error": f"Database error: {db_exc}"}, 500

    logger.info(f"[PASSWORD RESET OTP] Generated OTP for {email}")

    is_production = str(os.getenv("FLASK_ENV", "")).strip().lower() == "production"
    email_sent = False
    email_error_msg = ""

    try:
        send_otp_email(email, otp_code, user_row.get("name") or "Meryl Shoes user")
        email_sent = True
    except Exception as exc:
        logger.exception("Password reset OTP email delivery failed")
        raw_error = str(exc).strip()
        if "535" in raw_error or "BadCredentials" in raw_error or "Username and Password not accepted" in raw_error:
            email_error_msg = (
                "Gmail authentication failed. Please configure a 16-character Google App Password (not your personal Gmail password) in GMAIL_APP_PASSWORD."
            )
        else:
            email_error_msg = raw_error

    if email_sent:
        return {"ok": True, "message": "OTP sent. Check your registered email."}

    return {"ok": False, "error": email_error_msg or "Unable to send password reset OTP right now. Please check email settings or contact administrator."}, 500


@app.route("/api/auth/password-reset/verify", methods=["POST"])
def api_password_reset_verify():
    payload = request.get_json(silent=True) or {}
    email = str(payload.get("email") or "").strip().lower()
    otp_code = str(payload.get("otp") or "").strip()
    new_password = str(payload.get("new_password") or "")

    if not email or not otp_code or not new_password:
        return {"ok": False, "error": "Email, OTP, and new password are required."}, 400
    if len(new_password.strip()) < 8:
        return {"ok": False, "error": "Password must be at least 8 characters."}, 400

    user_row = find_active_user_management_account_by_email(email)
    if not user_row:
        return {
            "ok": False,
            "error": "Your account is not authorized to reset a password. Please contact the administrator.",
        }, 403

    try:
        rows = (
            supabase()
            .table("password_reset_otp")
            .select("*")
            .eq("email", email)
            .is_("used_at", "null")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
            .data
            or []
        )
        reset_row = rows[0] if rows else None
        if not reset_row:
            return {"ok": False, "error": "OTP expired or invalid. Please request a new OTP."}, 400

        reset_id = reset_row.get("reset_id")
        failed_attempts = safe_int(reset_row.get("failed_attempts"), 0)
        if failed_attempts >= 5:
            return {"ok": False, "error": "Too many failed attempts. Please request a new OTP."}, 429

        expires_at = parse_iso_datetime(reset_row.get("expires_at"))
        if expires_at:
            current_time = datetime.now(expires_at.tzinfo) if expires_at.tzinfo else datetime.utcnow()
        else:
            current_time = datetime.utcnow()
        if expires_at and expires_at < current_time:
            return {"ok": False, "error": "OTP expired. Please request a new OTP."}, 400

        if hash_password(otp_code) != reset_row.get("otp_hash"):
            supabase().table("password_reset_otp").update(
                {"failed_attempts": failed_attempts + 1}
            ).eq("reset_id", reset_id).execute()
            return {"ok": False, "error": "Invalid OTP code."}, 400

        update_staff_password_by_email(email, new_password.strip())
        supabase().table("password_reset_otp").update(
            {"used_at": datetime.utcnow().isoformat()}
        ).eq("reset_id", reset_id).execute()
    except Exception as exc:
        logger.exception("Password reset OTP verification failed")
        return {"ok": False, "error": str(exc) or "Unable to reset password right now."}, 500

    return {"ok": True, "message": "Password updated successfully."}


@app.route("/api/auth/login", methods=["POST"])
def api_auth_login():
    payload = request.get_json(silent=True) or {}
    username = str(payload.get("username") or "").strip()
    password = str(payload.get("password") or "").strip()

    if not username or not password:
        return {"ok": False, "error": "Username and password are required."}, 400

    try:
        user_info = verify_credentials_server(username, password)
        if not user_info:
            return {"ok": False, "error": "Invalid username or password."}, 401

        raw_avatar = str(user_info.get("avatar_url") or "").strip()
        jwt_avatar = raw_avatar if (raw_avatar.startswith("http://") or raw_avatar.startswith("https://")) and len(raw_avatar) < 512 and not raw_avatar.startswith("data:") else ""

        token = create_jwt_token({
            "user_id": user_info["user_id"],
            "username": user_info["username"],
            "name": user_info["name"],
            "role_name": user_info["role_name"],
            "role_id": user_info["role_id"],
            "email": user_info["email"],
            "status": user_info["status"],
            "avatar_url": jwt_avatar,
        }, expires_in_seconds=24 * 3600)

        response = Response(
            json.dumps({"ok": True, "token": token, "user": user_info}),
            status=200,
            mimetype="application/json",
        )

        is_secure = request.is_secure or request.headers.get("X-Forwarded-Proto") == "https"
        cookie_samesite = "None" if is_secure else "Lax"
        # 1. Secure HTTP-only session cookie (expires on browser close)
        response.set_cookie(
            "meryl_session",
            token,
            httponly=True,
            secure=is_secure,
            samesite=cookie_samesite,
            path="/",
        )
        # 2. Companion session cookie (expires on browser close)
        response.set_cookie(
            "meryl_token",
            token,
            httponly=False,
            secure=is_secure,
            samesite=cookie_samesite,
            path="/",
        )

        session["current_user"] = {
            "user_id": user_info["user_id"],
            "username": user_info["username"],
            "name": user_info["name"],
            "role": user_info["role_name"],
            "email": user_info["email"],
        }

        return response
    except ValueError as val_err:
        return {"ok": False, "error": str(val_err)}, 403
    except Exception as exc:
        logger.exception("API Login Error")
        return {"ok": False, "error": "Authentication server error. Please try again."}, 500


@app.route("/api/auth/sync-session", methods=["POST"])
def api_auth_sync_session():
    # Identity comes only from a verified token, never from the request body.
    identity = resolve_request_identity()
    if not identity:
        return {"ok": False, "error": "authentication_required"}, 401

    try:
        user_row = identity
        role_name = str(identity.get("role_name") or "")
        role_id = identity.get("role_id")
        email = str(identity.get("email") or "").strip().lower()

        raw_avatar = str(user_row.get("avatar_url") or "").strip()
        jwt_avatar = raw_avatar if (raw_avatar.startswith("http://") or raw_avatar.startswith("https://")) and len(raw_avatar) < 512 and not raw_avatar.startswith("data:") else ""

        user_info = {
            "user_id": str(user_row.get("user_id")),
            "username": str(user_row.get("username") or ""),
            "name": str(user_row.get("name") or "User"),
            "role_name": role_name,
            "role_id": str(role_id or ""),
            "email": str(user_row.get("email") or email),
            "status": str(user_row.get("status") or "active"),
            "avatar_url": jwt_avatar,
        }

        token = create_jwt_token(user_info, expires_in_seconds=24 * 3600)

        response = Response(
            json.dumps({"ok": True, "token": token, "user": user_info}),
            status=200,
            mimetype="application/json",
        )

        is_secure = request.is_secure or request.headers.get("X-Forwarded-Proto") == "https"
        cookie_samesite = "None" if is_secure else "Lax"
        response.set_cookie(
            "meryl_session",
            token,
            httponly=True,
            secure=is_secure,
            samesite=cookie_samesite,
            path="/",
        )
        response.set_cookie(
            "meryl_token",
            token,
            httponly=False,
            secure=is_secure,
            samesite=cookie_samesite,
            path="/",
        )

        session["current_user"] = {
            "user_id": user_info["user_id"],
            "username": user_info["username"],
            "name": user_info["name"],
            "role": user_info["role_name"],
            "email": user_info["email"],
        }

        return response
    except Exception as exc:
        logger.exception("Session sync error")
        return {"ok": False, "error": str(exc)}, 500


@app.route("/api/auth/me", methods=["GET"])
def api_auth_me():
    token = request.cookies.get("meryl_session") or request.cookies.get("meryl_token")
    if not token:
        auth_header = request.headers.get("Authorization") or ""
        if auth_header.lower().startswith("bearer "):
            token = auth_header[7:].strip()

    if not token:
        return {"ok": False, "error": "No active authentication session found."}, 401

    try:
        claims = verify_jwt_token(token)
        user_info = {
            "user_id": claims.get("user_id"),
            "name": claims.get("name"),
            "username": claims.get("username"),
            "role_name": claims.get("role_name"),
            "role_id": claims.get("role_id"),
            "email": claims.get("email"),
            "status": claims.get("status", "active"),
            "avatar_url": claims.get("avatar_url", ""),
        }
        return {"ok": True, "user": user_info}, 200
    except ValueError as err:
        return {"ok": False, "error": str(err)}, 401
    except Exception:
        return {"ok": False, "error": "Invalid session token"}, 401


@app.route("/api/auth/logout", methods=["POST"])
def api_auth_logout():
    response = Response(
        json.dumps({"ok": True, "message": "Logged out successfully"}),
        status=200,
        mimetype="application/json",
    )
    is_secure = request.is_secure or request.headers.get("X-Forwarded-Proto") == "https"
    cookie_samesite = "None" if is_secure else "Lax"
    response.delete_cookie("meryl_session", path="/", secure=is_secure, samesite=cookie_samesite)
    response.delete_cookie("meryl_token", path="/", secure=is_secure, samesite=cookie_samesite)
    session.clear()
    return response


@app.route("/api/auth/authorize-manager", methods=["POST"])
def api_auth_authorize_manager():
    payload = request.get_json(silent=True) or {}
    username = str(payload.get("username") or "").strip()
    password = str(payload.get("password") or "").strip()

    if not username or not password:
        return {"ok": False, "error": "Manager username and password are required."}, 400

    try:
        user_info = verify_credentials_server(username, password)
        if not user_info:
            return {"ok": False, "error": "Invalid manager credentials."}, 401

        role_lower = str(user_info.get("role_name") or "").lower()
        if "admin" not in role_lower and "manager" not in role_lower:
            return {"ok": False, "error": "Authorization failed. Administrator or Manager credentials required."}, 403

        return {
            "ok": True,
            "manager": {
                "user_id": user_info["user_id"],
                "name": user_info["name"],
                "username": user_info["username"],
                "role_name": user_info["role_name"],
            }
        }, 200
    except Exception as exc:
        return {"ok": False, "error": str(exc)}, 403


@app.route("/reports")
@login_required
@roles_required("admin", "inventory_staff")
def reports():
    context = page_build_reports_context(
        build_reports_context=build_reports_context,
    )
    return render_page("reports.html", **context)


@app.route("/inventory-analytics")
@login_required
@roles_required("admin", "inventory_staff")
def inventory_analytics():
    context = analytics_build_inventory_turnover_context(
        fetch_rows=fetch_rows,
        build_product_lookup=build_product_lookup,
        safe_int=safe_int,
        safe_float=safe_float,
    )
    return render_page("inventory_analytics.html", **context)


@app.route("/returns-analysis")
@login_required
@roles_required("admin")
def returns_analysis():
    context = analytics_build_returns_analysis_context(
        fetch_rows=fetch_rows,
        build_product_lookup=build_product_lookup,
        safe_int=safe_int,
        safe_float=safe_float,
    )
    return render_page("returns_analysis.html", **context)


@app.route("/pricing-recommendations")
@login_required
@roles_required("admin")
def pricing_recommendations():
    context = analytics_build_pricing_context(
        fetch_rows=fetch_rows,
        build_product_lookup=build_product_lookup,
        safe_int=safe_int,
        safe_float=safe_float,
    )
    return render_page("pricing_recommendations.html", **context)


# ===== JSON API Endpoints for React Frontend =====
@app.route("/api/analytics/inventory-turnover")
@login_required
@roles_required("admin", "inventory_staff")
def api_inventory_turnover():
    """JSON API endpoint for inventory turnover analytics."""
    from flask import jsonify
    try:
        context = analytics_build_inventory_turnover_context(
            fetch_rows=fetch_rows,
            build_product_lookup=build_product_lookup,
            safe_int=safe_int,
            safe_float=safe_float,
        )
        return jsonify(context), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/analytics/returns-analysis")
@login_required
@roles_required("admin")
def api_returns_analysis():
    """JSON API endpoint for returns analysis."""
    from flask import jsonify
    try:
        context = analytics_build_returns_analysis_context(
            fetch_rows=fetch_rows,
            build_product_lookup=build_product_lookup,
            safe_int=safe_int,
            safe_float=safe_float,
        )
        return jsonify(context), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/analytics/pricing-recommendations")
@login_required
@roles_required("admin")
def api_pricing_recommendations():
    """JSON API endpoint for pricing recommendations."""
    from flask import jsonify
    try:
        context = analytics_build_pricing_context(
            fetch_rows=fetch_rows,
            build_product_lookup=build_product_lookup,
            safe_int=safe_int,
            safe_float=safe_float,
        )
        return jsonify(context), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/analytics/product/rebuild", methods=["POST"])
@login_required
@roles_required("admin")
def api_rebuild_product_analytics():
    """Rebuild persisted product analytics snapshots/dimensions/recommendations."""
    from flask import jsonify
    try:
        body = request.get_json(silent=True) or {}
        periods = body.get("periods")
        if periods and isinstance(periods, list):
            requested_periods = [str(item).strip().lower() for item in periods if str(item).strip()]
        else:
            requested_periods = None
        start_date = str(body.get("start_date") or "").strip() or None
        end_date = str(body.get("end_date") or "").strip() or None

        result = rebuild_product_analytics_snapshots(
            fetch_rows=fetch_rows,
            table_exists=table_exists,
            supabase=supabase(),
            periods=requested_periods,
            custom_start_date=start_date,
            custom_end_date=end_date,
        )
        return jsonify(result), 200
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.route("/api/analytics/product/snapshots", methods=["GET"])
@login_required
@roles_required("admin", "inventory_staff")
def api_product_analytics_snapshots():
    """Fetch persisted product analytics by period."""
    from flask import jsonify
    try:
        period = str(request.args.get("period") or "monthly").strip().lower()
        start_date = str(request.args.get("start_date") or "").strip()
        end_date = str(request.args.get("end_date") or "").strip()
        snapshot_query = supabase().table("analytics_product_snapshot").select("*").eq("period_key", period)
        dimension_query = supabase().table("analytics_dimension_snapshot").select("*").eq("period_key", period)
        recommendation_query = (
            supabase()
            .table("analytics_recommendation")
            .select("*, product:product(product_id, product_name, brand, size, color, category_id)")
            .eq("period_key", period)
        )
        if start_date and end_date:
            snapshot_query = snapshot_query.eq("period_start", start_date).eq("period_end", end_date)
            dimension_query = dimension_query.eq("period_start", start_date).eq("period_end", end_date)
            recommendation_query = recommendation_query.eq("period_start", start_date).eq("period_end", end_date)

        snapshots = snapshot_query.order("rank_position", desc=False).order("units_sold", desc=True).execute().data or []
        dimensions = dimension_query.order("dimension_type", desc=False).order("rank_position", desc=False).execute().data or []
        recommendations = recommendation_query.order("severity", desc=False).execute().data or []
        return jsonify(
            {
                "ok": True,
                "period": period,
                "start_date": start_date or None,
                "end_date": end_date or None,
                "snapshots": snapshots,
                "dimensions": dimensions,
                "recommendations": recommendations,
            }
        ), 200
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.route("/pos")
@login_required
def pos():
    context = pos_build_page_context(
        normalize_inventory_products=normalize_inventory_products,
        fetch_rows=fetch_rows,
        build_pos_catalog=build_pos_catalog,
        build_filter_options=build_filter_options,
        normalize_cart_items=normalize_cart_items,
        session_obj=session,
    )
    return render_page(
        "pos.html",
        **context,
    )


@app.route("/pos/add", methods=["POST"])
@login_required
def pos_add():
    group_key = (request.form.get("product_group") or "").strip()
    selected_size = (request.form.get("size") or "").strip()
    qty = max(1, safe_int(request.form.get("quantity"), 1))
    discount = max(0, safe_int(request.form.get("discount"), 0))

    products = normalize_inventory_products(fetch_rows("product"))
    product = next(
        (
            item
            for item in products
            if item.get("group_key") == group_key and str(item.get("size", "")).strip() == selected_size
        ),
        None,
    )
    if not group_key:
        set_notice("Select a product first.", "danger")
        return redirect("/pos")
    if not selected_size:
        set_notice("Select a size first.", "warning")
        return redirect("/pos")
    if not product:
        set_notice("Product variant not found.", "danger")
        return redirect("/pos")
    if qty > safe_int(product.get("stock_quantity"), 0):
        set_notice("Quantity exceeds available stock.", "warning")
        return redirect("/pos")

    cart = session.get("cart", [])
    cart = pos_add_product_to_cart(
        cart,
        product,
        selected_size=selected_size,
        qty=qty,
        discount=discount,
        safe_int=safe_int,
        safe_float=safe_float,
    )
    session["cart"] = cart
    set_notice(f"{product['product_name']} (Size {selected_size}) added to cart.")

    return redirect("/pos")


@app.route("/pos/remove/<int:item_index>", methods=["POST"])
@login_required
def pos_remove(item_index):
    cart = normalize_cart_items(session.get("cart", []))
    cart, removed_item, error_message = pos_remove_cart_item(cart, item_index)
    session["cart"] = cart
    if removed_item:
        set_notice(f"{removed_item.get('product_name', 'Item')} removed from cart.")
    else:
        set_notice(error_message or "Cart item not found.", "warning")
    return redirect("/pos")


@app.route("/pos/checkout", methods=["POST"])
@login_required
def pos_checkout():
    cart = normalize_cart_items(session.get("cart", []))
    session["cart"] = cart
    if not cart:
        set_notice("Cart is empty.", "warning")
        return redirect("/pos")

    subtotal = sum(float(item["base_subtotal"]) for item in cart)
    discount_total = sum(float(item["discount_amount"]) for item in cart)
    total = subtotal - discount_total

    selected_customer_id = str(request.form.get("customer_id") or "").strip()
    manual_customer_name = (request.form.get("customer_name") or "").strip()
    manual_customer_email = (request.form.get("new_customer_email") or "").strip().lower()
    manual_customer_phone = (request.form.get("new_customer_phone") or "").strip()
    manual_customer_address = (request.form.get("new_customer_address") or "").strip()
    customer_rows = fetch_rows("customer")
    selected_customer = next(
        (
            row
            for row in customer_rows
            if str(row.get("customer_id") or "").strip() == selected_customer_id
        ),
        None,
    )
    is_add_new_customer = selected_customer_id == "__new__"
    if is_add_new_customer and not manual_customer_name:
        set_notice("Enter customer name for new customer.", "warning")
        return redirect("/pos")

    customer_name = (selected_customer.get("customer_name") if selected_customer else manual_customer_name) or "Walk-in Customer"
    payment_method = request.form.get("payment_method") or "cash"
    cash_received_input = safe_float(request.form.get("cash_received"), 0)
    current_user = get_current_user() or {}
    db_user = resolve_db_user_row(current_user)
    user_id = str((db_user or {}).get("user_id") or "").strip()
    if is_add_new_customer:
        customer = get_or_create_customer(
            customer_name,
            email=manual_customer_email,
            phone=manual_customer_phone,
            address=manual_customer_address,
        )
    else:
        customer = selected_customer or get_or_create_customer(customer_name)
    customer_id = str(customer.get("customer_id") or "").strip()

    if not user_id:
        set_notice("Unable to resolve the logged-in staff account in the database.", "danger")
        return redirect("/pos")

    if str(payment_method).strip().lower() == "cash":
        if cash_received_input < total:
            set_notice("Cash received is less than total amount due.", "warning")
            return redirect("/pos")
        amount_paid = cash_received_input
        change_amount = max(cash_received_input - total, 0)
    else:
        amount_paid = total
        change_amount = 0

    try:
        sale = (
            supabase().table("sales_transaction")
            .insert(
                {
                    "total_amount": total,
                    "customer_id": customer_id or None,
                    "transaction_date": datetime.now().isoformat(),
                    "user_id": user_id,
                }
            )
            .execute()
        )

        sales_id = str((sale.data or [{}])[0].get("sales_id") or "").strip()
        if not sales_id:
            raise ValueError("Sales transaction was not created.")

        supabase().table("payment").insert(
            {
                "sales_id": sales_id,
                "payment_method": db_payment_method(payment_method),
                "amount_paid": amount_paid,
                "change_amount": change_amount,
                "payment_status": db_payment_status("pending"),
            }
        ).execute()
        receipt_timestamp = datetime.now()
        receipt_payload = pos_build_receipt_payload(
            sales_id=sales_id,
            customer_name=customer_name,
            cashier_name=current_user.get("name", "Admin User"),
            payment_method=payment_method,
            subtotal=subtotal,
            discount_total=discount_total,
            total=total,
            cash_received=amount_paid,
            change_amount=change_amount,
            cart=cart,
            receipt_timestamp=receipt_timestamp,
        )

        for item in cart:
            discounted_subtotal = safe_float(item["subtotal"], 0)
            (
                supabase().table("sales_details")
                .insert(
                    {
                        "sales_id": sales_id,
                        "product_id": item["product_id"],
                        "quantity": item["quantity"],
                        "price": item["price"],
                        "discount_applied": item["discount_amount"],
                        "subtotal": discounted_subtotal,
                    }
                )
                .execute()
            )

        session["receipt"] = receipt_payload
        session["last_receipt"] = receipt_payload

        session["cart"] = []
        set_notice("Payment recorded. Sale is now pending admin approval.")
        return redirect("/pos")
    except Exception as exc:
        set_notice(f"Unable to complete payment: {exc}", "danger")
        return redirect("/pos")


@app.route("/sales/complete/<sales_id>", methods=["POST"])
@login_required
@roles_required("admin")
def sales_complete(sales_id):
    try:
        complete_sale_inventory(sales_id)
        set_notice("Transaction completed successfully.")
    except Exception as exc:
        set_notice(f"Unable to complete transaction: {exc}", "danger")
    return redirect("/sales")


@app.route("/sales/deny/<sales_id>", methods=["POST"])
@login_required
@roles_required("admin")
def sales_deny(sales_id):
    reason = (request.form.get("reason") or "").strip()
    if not reason:
        set_notice("Decline reason is required.", "warning")
        return redirect("/sales")

    completed_sales, denied_sales = build_sale_status_maps()
    if sales_id in completed_sales:
        set_notice("Completed transactions cannot be denied.", "danger")
        return redirect("/sales")
    if sales_id in denied_sales:
        set_notice("Transaction is already denied.", "warning")
        return redirect("/sales")

    sale_rows = supabase().table("sales_transaction").select("*").eq("sales_id", sales_id).execute().data or []
    if not sale_rows:
        set_notice("Transaction not found.", "danger")
        return redirect("/sales")

    sale = sale_rows[0]
    try:
        sales_flow_deny_transaction(
            sales_id,
            sale,
            reason,
            get_current_user=get_current_user,
            resolve_db_user_row=resolve_db_user_row,
            safe_int=safe_int,
            supabase=supabase(),
            db_payment_status=db_payment_status,
            db_payment_method=db_payment_method,
            sync_sales_summary_entry=sync_sales_summary_entry,
        )
        set_notice("Transaction denied successfully.")
    except Exception as exc:
        set_notice(f"Unable to deny transaction: {exc}", "danger")
    return redirect("/sales")


@app.route("/pos/receipt")
@login_required
def pos_receipt():
    receipt = pos_get_receipt_from_session(session)
    if not receipt:
        return redirect("/pos")
    return render_page("receipt.html", receipt=receipt)


@app.route("/inventory/add", methods=["POST"])
@login_required
@roles_required("admin", "inventory_staff")
def inventory_add():
    form_data = inventory_build_form_data(
        request.form,
        safe_int=safe_int,
        safe_float=safe_float,
        db_product_status=db_product_status,
    )
    if form_data["error"]:
        set_notice(form_data["error"], form_data["error_tone"])
        return redirect("/inventory")
    stock_quantity = form_data["stock_quantity"]
    payload = form_data["payload"]

    brand_column_missing = False
    try:
        created = supabase().table("product").insert(payload).execute().data or []
    except Exception as exc:
        compatible_payload, was_adapted, adaptation_notes = adapt_product_payload_for_schema(payload, exc)
        brand_column_missing = "missing_brand_column" in adaptation_notes
        if not was_adapted:
            set_notice(f"Unable to add product: {exc}", "danger")
            return redirect("/inventory")
        try:
            created = supabase().table("product").insert(compatible_payload).execute().data or []
        except Exception as retry_exc:
            set_notice(f"Unable to add product: {retry_exc}", "danger")
            return redirect("/inventory")

    try:
        product_id = str((created[0] if created else {}).get("product_id") or "").strip()
        if product_id:
            upsert_inventory_record(product_id, stock_quantity, payload["reorder_level"])
            if stock_quantity > 0:
                supabase().table("inventory_log").insert(
                    inventory_build_log_payload(
                        product_id=product_id,
                        quantity_change=stock_quantity,
                        transaction_type="restock",
                        timestamp=datetime.now().isoformat(),
                    )
                ).execute()
        if brand_column_missing:
            set_notice(
                "Product added, but brand was not saved because your database is missing the product.brand column.",
                "warning",
            )
        else:
            set_notice("Product added successfully.")
    except Exception as exc:
        set_notice(f"Unable to add product: {exc}", "danger")
    return redirect("/inventory")


@app.route("/inventory/update/<product_id>", methods=["POST"])
@login_required
@roles_required("admin", "inventory_staff")
def inventory_update(product_id):
    form_data = inventory_build_form_data(
        request.form,
        safe_int=safe_int,
        safe_float=safe_float,
        db_product_status=db_product_status,
    )
    if form_data["error"]:
        set_notice(form_data["error"], form_data["error_tone"])
        return redirect("/inventory")
    stock_quantity = form_data["stock_quantity"]
    payload = form_data["payload"]

    brand_column_missing = False
    try:
        previous_inventory = get_inventory_row(product_id) or {}
        previous_stock = safe_int(previous_inventory.get("stock_quantity"), 0)
        try:
            supabase().table("product").update(payload).eq("product_id", product_id).execute()
        except Exception as exc:
            compatible_payload, was_adapted, adaptation_notes = adapt_product_payload_for_schema(payload, exc)
            brand_column_missing = "missing_brand_column" in adaptation_notes
            if not was_adapted:
                raise
            supabase().table("product").update(compatible_payload).eq("product_id", product_id).execute()
        upsert_inventory_record(product_id, stock_quantity, payload["reorder_level"])
        stock_delta = stock_quantity - previous_stock
        if stock_delta != 0:
            supabase().table("inventory_log").insert(
                inventory_build_log_payload(
                    product_id=product_id,
                    quantity_change=stock_delta,
                    transaction_type="restock" if stock_delta > 0 else "adjustment",
                    timestamp=datetime.now().isoformat(),
                )
            ).execute()
        if brand_column_missing:
            set_notice(
                "Product updated, but brand was not saved because your database is missing the product.brand column.",
                "warning",
            )
        else:
            set_notice("Product updated successfully.")
    except Exception as exc:
        set_notice(f"Unable to update product: {exc}", "danger")
    return redirect("/inventory")


@app.route("/inventory/delete/<product_id>", methods=["POST"])
@login_required
@roles_required("admin", "inventory_staff")
def inventory_delete(product_id):
    try:
        result = inventory_flow_delete_product(product_id, supabase=supabase())
        if result.get("blocked"):
            set_notice(
                "This product cannot be deleted because it already has sales history. You can update it instead or set its stock to 0.",
                "warning",
            )
            return redirect("/inventory")
        set_notice("Product deleted successfully.")
    except Exception as exc:
        set_notice(f"Unable to delete product: {exc}", "danger")
    return redirect("/inventory")


@app.route("/customers/add", methods=["POST"])
@login_required
def customers_add():
    form_data = customer_build_form_data(request.form)
    if form_data["error"]:
        set_notice(form_data["error"], form_data["error_tone"])
        return redirect("/customers")

    try:
        payload = form_data["payload"]
        create_payload = {
            **payload,
            "date_registered": datetime.now().date().isoformat(),
        }
        adaptation_notes = execute_customer_write_with_schema_fallback(
            lambda write_payload: supabase().table("customer").insert(write_payload).execute(),
            create_payload,
        )
        address_missing = "missing_address_column" in adaptation_notes
        status_missing = "missing_status_column" in adaptation_notes

        if address_missing and status_missing:
            set_notice(
                "Customer added, but address and status were not saved because your database is missing customer.address and customer.status columns.",
                "warning",
            )
        elif address_missing:
            set_notice(
                "Customer added, but address was not saved because your database is missing the customer.address column.",
                "warning",
            )
        elif status_missing:
            set_notice(
                "Customer added, but status was not saved because your database is missing the customer.status column.",
                "warning",
            )
        else:
            set_notice("Customer added successfully.")
    except Exception as exc:
        set_notice(f"Unable to add customer: {exc}", "danger")
    return redirect("/customers")


@app.route("/customers/update/<customer_id>", methods=["POST"])
@login_required
@roles_required("admin")
def customers_update(customer_id):
    form_data = customer_build_form_data(request.form)
    if form_data["error"]:
        set_notice(form_data["error"], form_data["error_tone"])
        return redirect("/customers")

    try:
        payload = form_data["payload"]
        existing_customer = (
            supabase().table("customer")
            .select("customer_id")
            .eq("customer_id", customer_id)
            .limit(1)
            .execute()
        )
        if not existing_customer.data:
            set_notice("Customer record was not found.", "danger")
            return redirect("/customers")

        adaptation_notes = execute_customer_write_with_schema_fallback(
            lambda write_payload: supabase().table("customer").update(write_payload).eq("customer_id", customer_id).execute(),
            payload,
        )
        address_missing = "missing_address_column" in adaptation_notes
        status_missing = "missing_status_column" in adaptation_notes

        if address_missing and status_missing:
            set_notice(
                "Customer updated, but address and status were not saved because your database is missing customer.address and customer.status columns.",
                "warning",
            )
        elif address_missing:
            set_notice(
                "Customer updated, but address was not saved because your database is missing the customer.address column.",
                "warning",
            )
        elif status_missing:
            set_notice(
                "Customer updated, but status was not saved because your database is missing the customer.status column.",
                "warning",
            )
        else:
            set_notice("Customer updated successfully.")
    except Exception as exc:
        set_notice(f"Unable to update customer: {exc}", "danger")
    return redirect("/customers")


@app.route("/customers/delete/<customer_id>", methods=["POST"])
@login_required
@roles_required("admin")
def customers_delete(customer_id):
    try:
        result = customer_delete_record(customer_id, supabase=supabase())
        if result.get("blocked"):
            set_notice(
                "This customer cannot be deleted because there is already sales history linked to this record.",
                "danger",
            )
            return redirect("/customers")
        if result.get("deleted"):
            set_notice("Customer deleted successfully.")
        else:
            set_notice("Customer record was not found.", "danger")
    except Exception as exc:
        set_notice(f"Unable to delete customer: {exc}", "danger")
    return redirect("/customers")


@app.route("/logout")
def logout():
    session.clear()
    set_notice(get_logout_notice(), "success")
    return redirect(get_logout_redirect())


if __name__ == "__main__":
    logger.info("=" * 80)
    logger.info("🚀 Meryl Shoes Enterprise System Starting")
    logger.info("=" * 80)

    # Log environment status
    logger.info("📋 Environment Configuration:")
    url_set = bool(os.getenv("SUPABASE_URL"))
    key_set = bool(os.getenv("SUPABASE_KEY"))
    logger.info(f"   • SUPABASE_URL: {'✓ configured' if url_set else '✗ missing'}")
    logger.info(f"   • SUPABASE_KEY: {'✓ configured' if key_set else '✗ missing'}")

    if url_set and key_set:
        logger.info("   → Will attempt to initialize Supabase on first request")
    else:
        logger.warning("   ⚠️  Supabase is not configured!")
        logger.warning("   → Application will run but database features will be unavailable")
        logger.warning("   → Set SUPABASE_URL and SUPABASE_KEY environment variables to enable database functionality")

    logger.info("=" * 80)
    logger.info("✓ Flask app initialized successfully")
    logger.info("  → Visit /health to check status")
    logger.info("  → Visit /login to access the application")
    logger.info("=" * 80)

    app.run(debug=True)
