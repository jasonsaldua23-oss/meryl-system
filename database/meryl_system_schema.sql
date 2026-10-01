-- Meryl Shoes Enterprise System - Database Schema
-- Database: Supabase PostgreSQL
-- Created: 2024

-- ============================================
-- 1. ROLE TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS role (
  role_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_name VARCHAR(50) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 2. USER TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS "user" (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  username VARCHAR(50) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role_id UUID NOT NULL REFERENCES role(role_id) ON DELETE RESTRICT,
  status VARCHAR(20) CHECK (status IN ('active', 'inactive')) DEFAULT 'active',
  email VARCHAR(100),
  avatar_url TEXT,
  staff_code VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 3. CUSTOMER TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS customer (
  customer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100),
  contact_number VARCHAR(15),
  address VARCHAR(255),
  status VARCHAR(20) CHECK (status IN ('active', 'inactive')) DEFAULT 'active',
  date_registered TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 4. CATEGORY TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS category (
  category_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_name VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 5. PRODUCT TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS product (
  product_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name VARCHAR(150) NOT NULL,
  brand VARCHAR(100) DEFAULT 'Meryl',
  category_id UUID NOT NULL REFERENCES category(category_id) ON DELETE RESTRICT,
  size VARCHAR(10),
  color VARCHAR(50),
  cost_price DECIMAL(10, 2) NOT NULL,
  reorder_level INT DEFAULT 0,
  status VARCHAR(20) CHECK (status IN ('active', 'inactive')) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 6. INVENTORY TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS inventory (
  inventory_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL UNIQUE REFERENCES product(product_id) ON DELETE CASCADE,
  stock_quantity INT NOT NULL DEFAULT 0,
  reorder_level INT DEFAULT 0,
  srp DECIMAL(10, 2) DEFAULT 0,
  inventory_status VARCHAR(20) DEFAULT 'inactive' CHECK (inventory_status IN ('active', 'inactive')),
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 7. INVENTORY_LOG TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS inventory_log (
  inventory_log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES product(product_id) ON DELETE CASCADE,
  quantity_change INT NOT NULL,
  transaction_type VARCHAR(20) CHECK (transaction_type IN ('sale', 'return', 'adjustment', 'restock')),
  reference_id UUID,
  date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 8. SALES_TRANSACTION TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS sales_transaction (
  sales_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  total_amount DECIMAL(12, 2) NOT NULL,
  user_id UUID NOT NULL REFERENCES "user"(user_id) ON DELETE RESTRICT,
  customer_id UUID REFERENCES customer(customer_id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 9. SALES_DETAILS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS sales_details (
  sales_detail_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_id UUID NOT NULL REFERENCES sales_transaction(sales_id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES product(product_id) ON DELETE RESTRICT,
  quantity INT NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  discount_applied DECIMAL(10, 2) DEFAULT 0,
  subtotal DECIMAL(12, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 10. PAYMENT TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS payment (
  payment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_id UUID NOT NULL UNIQUE REFERENCES sales_transaction(sales_id) ON DELETE CASCADE,
  payment_method VARCHAR(50) CHECK (payment_method IN ('cash', 'card', 'online', 'check')) NOT NULL,
  amount_paid DECIMAL(12, 2) NOT NULL,
  change_amount DECIMAL(12, 2) DEFAULT 0,
  payment_status VARCHAR(20) CHECK (payment_status IN ('pending', 'completed', 'failed')) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 11. RETURNS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS returns (
  return_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_id UUID NOT NULL REFERENCES sales_transaction(sales_id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES "user"(user_id) ON DELETE RESTRICT,
  return_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  total_refund DECIMAL(12, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 12. RETURN_DETAILS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS return_details (
  return_detail_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES returns(return_id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES product(product_id) ON DELETE RESTRICT,
  quantity_returned INT NOT NULL,
  reason VARCHAR(255),
  refund_amount DECIMAL(12, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 13. PROMOTION TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS promotion (
  promo_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_name VARCHAR(150) NOT NULL,
  discount_type VARCHAR(20) CHECK (discount_type IN ('percentage', 'fixed')) NOT NULL,
  discount_value DECIMAL(10, 2) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(20) CHECK (status IN ('active', 'inactive', 'expired')) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 14. PROMO_PRODUCT TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS promo_product (
  promo_product_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_id UUID NOT NULL REFERENCES promotion(promo_id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES product(product_id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 15. NOTIFICATION TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS notification (
  notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customer(customer_id) ON DELETE CASCADE,
  promo_id UUID NOT NULL REFERENCES promotion(promo_id) ON DELETE CASCADE,
  email_status VARCHAR(20) CHECK (email_status IN ('sent', 'failed', 'pending')) DEFAULT 'pending',
  date_sent TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 16. SALES_ANALYTICS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS sales_analytics (
  analytics_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES product(product_id) ON DELETE CASCADE,
  total_sales DECIMAL(12, 2) NOT NULL DEFAULT 0,
  total_quantity_sold INT NOT NULL DEFAULT 0,
  average_sales DECIMAL(12, 2) DEFAULT 0,
  ranking INT,
  trend_type VARCHAR(50) CHECK (trend_type IN ('top_seller', 'slow_mover', 'stable')) DEFAULT 'stable',
  time_period VARCHAR(20) CHECK (time_period IN ('daily', 'weekly', 'monthly')) DEFAULT 'daily',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 17. SALES_SUMMARY TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS sales_summary (
  summary_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  total_revenue DECIMAL(12, 2) NOT NULL,
  total_transaction INT NOT NULL,
  total_item_sold INT NOT NULL,
  summary_date DATE NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 18. PREDICTION TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS prediction (
  prediction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES product(product_id) ON DELETE CASCADE,
  predicted_demand INT NOT NULL,
  prediction_period VARCHAR(20) CHECK (prediction_period IN ('weekly', 'monthly', 'quarterly')) DEFAULT 'monthly',
  prediction_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 19. PREDICTION_HISTORY TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS prediction_history (
  history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id UUID NOT NULL REFERENCES prediction(prediction_id) ON DELETE CASCADE,
  actual_sales INT,
  prediction_accuracy DECIMAL(5, 2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================
CREATE INDEX idx_user_role_id ON "user"(role_id);
CREATE INDEX idx_product_category_id ON product(category_id);
CREATE INDEX idx_inventory_product_id ON inventory(product_id);
CREATE INDEX idx_inventory_log_product_id ON inventory_log(product_id);
CREATE INDEX idx_sales_transaction_user_id ON sales_transaction(user_id);
CREATE INDEX idx_sales_transaction_customer_id ON sales_transaction(customer_id);
CREATE INDEX idx_sales_details_sales_id ON sales_details(sales_id);
CREATE INDEX idx_sales_details_product_id ON sales_details(product_id);
CREATE INDEX idx_return_sales_id ON returns(sales_id);
CREATE INDEX idx_return_user_id ON returns(user_id);
CREATE INDEX idx_return_details_return_id ON return_details(return_id);
CREATE INDEX idx_promo_product_promo_id ON promo_product(promo_id);
CREATE INDEX idx_promo_product_product_id ON promo_product(product_id);
CREATE INDEX idx_sales_analytics_product_id ON sales_analytics(product_id);
CREATE INDEX idx_prediction_product_id ON prediction(product_id);

-- ============================================
-- INSERT DEFAULT ROLES
-- ============================================
INSERT INTO role (role_name) VALUES
  ('admin'),
  ('cashier'),
  ('inventory_staff')
ON CONFLICT (role_name) DO NOTHING;

-- ============================================
-- INSERT DEFAULT ADMIN USER (Password: admin123)
-- ============================================
-- Note: bcrypt hash of "admin123" - replace with actual bcrypt hash
INSERT INTO "user" (name, username, password, role_id, status, email)
SELECT
  'Administrator',
  'admin',
  '$2y$10$abc123', -- Replace with actual bcrypt hash
  role_id,
  'active',
  'admin@merylshoes.com'
FROM role
WHERE role_name = 'admin'
ON CONFLICT (username) DO NOTHING;
