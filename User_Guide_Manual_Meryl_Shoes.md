# USER'S GUIDE MANUAL
## INTEGRATED POS-DRIVEN INVENTORY WITH DATA ANALYTICS FOR TARGETING SALES MARKETING
### Meryl Shoes Enterprise System — Carlos Hilado Memorial State University (CHMSU)

---

# PART I: AUTHENTICATION & SECURITY GATEWAY

---

### Section 1.1: System Sign-In & Role Routing
#### Screen Description
The Authentication Gateway is the unified, secure entry point for all store personnel. It provides credential verification, Google OAuth integration, role-based automatic redirection, and real-time brute-force rate limiting.

#### Screenshot Callout Labels
* **Box 1 [Brand Header Banner]**: "Meryl Shoes Brand Banner displaying enterprise logo and system title."
* **Box 2 [Username / Email Input Field]**: "Enter your registered staff username or authorized corporate email address."
* **Box 3 [Password Input Field & Eye Icon]**: "Enter your secure account password. Click the eye icon to toggle character visibility."
* **Box 4 [Sign In Button]**: "Click 'Sign In' to authenticate credentials and be routed to your designated portal."
* **Box 5 [Continue with Google Button]**: "Click to authenticate seamlessly using an authorized organizational Google Account."
* **Box 6 [Forgot Password Link]**: "Click 'Forgot Password?' to initiate the self-service email OTP recovery flow."

#### STEPS
1. Open your web browser (Google Chrome or Microsoft Edge) and navigate to the application URL: `http://localhost:5173/login`.
2. In the **Username / Email** input field, type your assigned staff credentials (e.g., `admin`, `cashier1`, or `inventory1`).
3. In the **Password** input field, type your secret password.
4. Click the blue **Sign In** button.
5. Upon successful authentication, the system creates an RFC 7519 HS256 JWT session, sets encrypted HTTP-only cookies (`meryl_session`), displays: *"Login successful! Redirecting to dashboard..."*, and automatically redirects you to your designated portal:
   - **Administrators** &rarr; `/admin`
   - **Sales Staff / Cashiers** &rarr; `/sales`
   - **Inventory Custodians** &rarr; `/inventory`
6. **Multi-Tab Security & Encrypted Session Protection**: To ensure strict workstation compliance and prevent unauthorized walk-up access, user sessions are protected using cryptographic XOR-salt payload encryption (`_sec_session_state`) stored in tab-scoped session memory with zero plaintext credentials or sensitive keys retained in browser storage. Freshly launched browser tabs require explicit authentication, while the active working tab seamlessly maintains its verified state across page refreshes (F5). Once authenticated, the system leverages HTML5 `BroadcastChannel` (`meryl_cross_tab_sync`) and Supabase Realtime WebSockets to synchronize stock deductions, sales orders, and promotional updates instantaneously across all open windows.

---

### Section 1.2: Password Reset via Email OTP Modal
#### Screen Description
The self-service Password Reset modal enables authorized staff members to recover access to their accounts using time-based One-Time Passwords (OTP) transmitted directly to their registered email address. It features dynamic 8-digit OTP token support, a live 10-minute expiration countdown timer, and a 60-second rate-limiting cooldown on resend requests.

#### Screenshot Callout Labels
* **Box 1 [Recovery Email Input]**: "Enter the verified email address associated with your staff profile."
* **Box 2 [Send Recovery Code Button]**: "Click to generate and dispatch a 6 to 8-digit verification code to your email inbox."
* **Box 3 [OTP Expiration Countdown Pill]**: "Live ticking badge displaying remaining code validity (e.g., 'Expires in 09:59', amber under 1 minute, red 'Expired (00:00)')."
* **Box 4 [OTP Verification Input (6 to 8 Digits)]**: "Enter the 6 to 8-digit numeric verification code received in your email (e.g., 44009939)."
* **Box 5 [New Password & Confirmation Fields]**: "Input your new password (minimum 8 characters) and re-enter it to verify matching characters."
* **Box 6 [Verify OTP & Update Password Button]**: "Click to commit your new credentials; automatically disabled if the code has expired."
* **Box 7 [Resend OTP Button with Rate Limit Cooldown]**: "Shows live ticking rate limit cooldown (e.g., 'Resend OTP in 59s') to prevent email spam."

#### STEPS
1. From the login window, click the **Forgot Password?** link located below the password field.
2. In the modal prompt, enter your registered email address and click **Send Reset OTP**.
3. A 60-second security cooldown activates on the **Resend OTP** button and a 10-minute dynamic live timer starts ticking.
4. Check your Gmail inbox for the notification with subject *"Meryl Shoes Password Reset"* containing the 6 to 8-digit verification code.
5. Input the code into the **Email OTP code** field before the live expiration timer reaches zero (`00:00`).
6. Enter your desired new password in the **New Password** field, then re-enter it into the **Confirm Password** field.
7. Click **Verify OTP and Reset Password**. The system validates the token, updates your credentials in Supabase and the database, and displays: *"Password updated successfully! Please sign in with your new credentials."*

---

### Section 1.3: Account Lockout & Security Protection
#### Screen Description
To protect store data against brute-force attacks and unauthorized credential stuffing, the system incorporates an automatic security lockout mechanism triggered after 5 consecutive failed attempts.

#### Screenshot Callout Labels
* **Box 1 [Error Notification Banner]**: "Displays remaining login attempts before temporary account lockout."
* **Box 2 [Active Lockout Banner & Countdown Timer]**: "Appears after 5 failed attempts, showing live ticking seconds remaining (e.g., 'Account locked. Try again in 60s')."
* **Box 3 [Disabled Sign In Button]**: "The Sign In button is automatically disabled during the lockout window."

#### STEPS
1. If an incorrect password is entered, the system alerts the user: *"Invalid credentials. You have X attempts remaining."*
2. Upon the 5th consecutive failed attempt, the system automatically locks the username for a security cooldown window of 5 minutes (300 seconds).
3. The interface renders a prominent red alert displaying a live countdown timer ticking down the remaining seconds.
4. Wait until the timer reaches zero before attempting to sign in again, or contact the System Administrator to request an immediate manual lockout unlock via the User Management module.

---

### Section 1.4: Terminal Inactivity Auto-Lock & Unlock Modal
#### Screen Description
To prevent unauthorized transactions when a cashier or administrator steps away from the counter, the system automatically locks the terminal screen after 10 minutes of inactivity.

#### Screenshot Callout Labels
* **Box 1 [Security Shield Lockout Icon]**: "Visual indicator signaling that the active terminal session has been locked."
* **Box 2 [Locked Staff Profile Header]**: "Displays the locked staff username and role (e.g., 'Terminal Locked: Cashier Shift Active')."
* **Box 3 [Password Challenge Field]**: "Input field requiring the active employee's password to unlock the screen."
* **Box 4 [Unlock Terminal Button]**: "Validates credentials and immediately restores the active cart or transaction state."

#### STEPS
1. When no keyboard, mouse, or touch input is detected for 10 minutes, the terminal enters **Auto-Lock Mode**.
2. To resume work, enter your staff password into the **Password Challenge** field.
3. Click **Unlock Terminal**.
4. The system validates your credentials, clears the lock screen, and returns you to your exact active workspace with all cart lines preserved.

---

# PART II: ADMINISTRATOR PORTAL (/admin)

---

### Section 2.1: Admin Dashboard & Executive KPIs
#### Screen Description
The Executive Dashboard provides real-time situational awareness of store performance, financial revenue trends, inventory health, and fast-moving footwear styles.

#### Screenshot Callout Labels
* **Box 1 [Left Navigation Sidebar]**: "Comprehensive navigation menu providing one-click access to all 14 admin management modules."
* **Box 2 [Executive KPI Summary Cards]**: "Live metrics displaying Total Daily Revenue (₱), Items Sold Today, Total Footwear Stock In-Store, and Active Low Stock Warnings."
* **Box 3 [Revenue Overview Area Chart]**: "Interactive 7-day sales curve with tooltip hover detailing exact daily revenue totals."
* **Box 4 [Categories Inventory Mix Bar Chart]**: "Bar graph illustrating footwear breakdown (Casual, Running, Basketball) with clear percentage tooltips."
* **Box 5 [Recent Sales Activity Register]**: "Real-time log of the latest cashier transactions with customer names, amounts, and timestamps."
* **Box 6 [Top Selling Footwear Widget]**: "Leaderboard displaying the store's highest-velocity footwear models and unit sales."

#### STEPS
1. Upon logging in as Administrator, you are automatically directed to the **Dashboard** overview.
2. Review the top KPI cards to monitor today's gross revenue and active inventory status.
3. Hover your cursor over the **Revenue Overview** chart to inspect daily financial performance.
4. Examine the **Categories** graph to assess whether current inventory levels align with customer footwear preferences.
5. Click **View All** on the Recent Sales widget to navigate directly to the complete Sales Management ledger.

---

### Section 2.2: Master Point of Sale (POS) Checkout Operations
#### Screen Description
The Administrator POS interface provides full cashiering capabilities equipped with managerial override authority, custom discounting, price adjustments, and multi-tender processing.

#### Screenshot Callout Labels
* **Box 1 [Barcode SKU Scanner & Quick Search Bar]**: "Search bar accepting optical laser barcode scans or manual shoe model keywords."
* **Box 2 [Browse Product Catalog Button]**: "Opens the full-screen product search and size-selection modal."
* **Box 3 [Active Transaction Shopping Cart]**: "Itemized shopping cart displaying selected shoe models, chosen sizes, unit prices, and quantities."
* **Box 4 [Cart Line Modifiers & Void Button]**: "Buttons to increase/decrease quantity or immediately void an erroneous line item."
* **Box 5 [Promotions & BOGO Badge Indicator]**: "Auto-applied promotional deductions, percentage discounts, and BOGO bundles."
* **Box 6 [Cash Tender & Change Calculator]**: "Input field for customer cash tendered with automatic real-time change calculation."
* **Box 7 [Complete Payment & Checkout Button]**: "Finalizes checkout, commits stock deductions, and generates the official thermal sales receipt."

#### STEPS
1. Click **Point of Sale** in the left navigation sidebar.
2. Scan the footwear shoebox barcode using the handheld barcode scanner, or click **Browse** to open the product modal.
3. Select the customer's desired footwear size and quantity, then add the item to the cart.
4. To remove an accidental item, click the red **Trash/Void** button next to the corresponding cart line.
5. In the payment panel on the right, enter the amount of cash received in the **Amount Tendered** field (or enter GCash Reference Number).
6. The system automatically computes and displays the exact **Change Due**.
7. Click the golden **Complete Payment & Checkout** button. The sale is logged in the database, stock is deducted in real-time, and the printable Official Receipt modal appears.

---

### Section 2.3: POS Product Catalog Search & Sizing Modal (Add to Cart Flow)
#### Screen Description
Opens when the user clicks the Browse button or focuses on the product search bar. Allows cashiers to search the store's entire footwear inventory, inspect size runs, check real-time stock levels, choose quantities, and add shoes to the active cart.

#### Screenshot Callout Labels
* **Box 1 [Modal Search Header & Clear Button]**: "Search bar accepting model names, brands, colorways, sizes, or price queries with instant filter feedback."
* **Box 2 [Category Filter Pills]**: "Quick-filter buttons (All, Running, Casual, Basketball, Sandals, Formal) to narrow down catalog displays."
* **Box 3 [Footwear Catalog Table]**: "Displays shoe thumbnail, model title, brand, category, available size options, and SRP retail price."
* **Box 4 [EU Size Selector Matrix (Sizes 36–46)]**: "Selectable size buttons displaying live stock badges: Green (In Stock >5), Amber (Low Stock ≤5), or Red (Out of Stock 0)."
* **Box 5 [Quantity Stepper Control (- / +)]**: "Increment and decrement buttons plus numeric input field to select purchase quantity."
* **Box 6 [Add to Cart Confirmation Button]**: "Commits the selected footwear model, size, and quantity into the active POS shopping cart."

#### STEPS
1. In the POS terminal, click the **Browse** button next to the product search input.
2. Type the shoe model or brand (e.g., *Nike Air Max*) into the search field, or click a category pill (e.g., *Running*).
3. In the product table, locate the desired shoe and click on its row or the **Select** button.
4. The size selector drawer opens displaying available **EU Sizes (36 to 46)**. Click the customer's desired size (e.g., *Size 42*).
5. Inspect the stock badge to verify availability (e.g., *7 in stock*). If the size is out of stock, the button is disabled.
6. Use the **- / +** buttons or type directly into the quantity field to set the number of pairs.
7. Click the golden **Add to Cart** button. The modal closes, the cart updates with the selected line item, and subtotal amounts recalculate automatically.

---

### Section 2.4: POS Customer Directory Lookup & Fast Registration Modal
#### Screen Description
Opens when clicking the Browse button beside the Customer field in the POS payment panel. Allows cashiers to link transactions to existing registered shoppers or quickly enroll walk-in customers.

#### Screenshot Callout Labels
* **Box 1 [Customer Search Input]**: "Search field accepting customer full name, mobile number, or registered email address."
* **Box 2 [Customer Directory Register]**: "Table displaying Name, Email, Contact Number, and Action button."
* **Box 3 [Select Customer Action Button]**: "Associates the selected customer with the active cart to apply loyalty discounts and send digital receipts."
* **Box 4 [Walk-In Customer Shortcut]**: "Quick one-click option to process transactions without recording customer personal data."

#### STEPS
1. In the POS right-hand panel, click **Browse** under the Customer section.
2. In the modal search bar, type the customer's mobile number (e.g., *09171234567*) or name.
3. Click **Select** on the customer row. The modal closes and tags the customer profile to the sale.
4. If the customer does not wish to register, select **Walk-in Customer** to proceed anonymously.

---

### Section 2.5: Official Thermal Sales Receipt & Print Preview Modal
#### Screen Description
Automatically appears upon clicking Complete Payment & Checkout, or when clicking Print Receipt from the Sales History view. Formats the order into an official BIR-compliant thermal sales receipt.

#### Screenshot Callout Labels
* **Box 1 [Store Official Header]**: "Displays MERYL SHOES, Araneta Ave, Bacolod City, TIN: 004-247-660-000 VAT REGISTERED, and Contact Telephone."
* **Box 2 [Transaction Metadata]**: "Details OR/Invoice No., Date & Time, Cashier Name, Customer Name, and Terminal ID (POS-01)."
* **Box 3 [Itemized Sales Breakdown]**: "Shows shoe name, brand, color, size variant, unit price, quantity, and applied promotional/BOGO discounts."
* **Box 4 [Financial & Payment Totals]**: "Displays Subtotal, Total Discount, Net Amount Due, Payment Mode (Cash / GCash), Cash Received, and Change Given."
* **Box 5 [Tax Compliance Summary]**: "Itemizes 12% VATable Sales, VAT Amount, VAT-Exempt Sales, and Zero-Rated Sales."
* **Box 6 [7-Day Warranty & Return Policy Footer]**: "Prints official store policy: 'Shoes may be exchanged within 7 days with original receipt and box in unworn condition.'"
* **Box 7 [Barcode & Print Receipt Button]**: "Renders a scannable barcode of the OR number, with a golden 'Print Receipt' button to trigger thermal printing."

#### STEPS
1. After entering the customer's cash or GCash payment, click **Complete Payment & Checkout**.
2. The **Official Sales Receipt** modal opens displaying the complete receipt layout.
3. Verify that the items, sizes, discounts, and change amount match the transaction.
4. Click **Print Receipt** to dispatch the print job to the attached thermal receipt printer (or save as PDF).
5. Click **Close** to return to the POS register and begin a new sale.

---

### Section 2.6: POS Managerial Security Override & PIN Authorization Modal
#### Screen Description
Triggered whenever a cashier attempts a restricted managerial action: voiding an active cart line item, applying manual discounts, or overriding price limits.

#### Screenshot Callout Labels
* **Box 1 [Security Key Icon & Action Notice]**: "Displays the reason for override (e.g., 'Manager Authorization Required to Void Line Item')."
* **Box 2 [Manager Username Field]**: "Input field for authorized supervisor or administrator username."
* **Box 3 [Manager Password / PIN Field]**: "Secure password input to confirm managerial authority."
* **Box 4 [Authorize Action Button]**: "Validates manager credentials against database permissions and executes the restricted action."

#### STEPS
1. When attempting a restricted action (e.g., clicking **Void Cart Item**), the **Manager Authorization Required** modal appears.
2. The store supervisor or manager inputs their **Username** and **Password / PIN**.
3. Click **Authorize Action**.
4. The system validates the credentials, logs a `MANAGER_OVERRIDE` event in the Security Audit Trail, and executes the requested operation.

---

### Section 2.7: Product List – Master Footwear Catalog (Search, Category Filters & Active Records)
#### Screen Description
The Product List interface serves as the primary master data repository for Meryl Shoes. It enables store administrators to inspect all registered footwear styles across colorways and sizes, monitor total enrolled records, toggle archived/discontinued models, and rapidly filter inventory through dynamic keyword searches, category dropdowns, and quick-select category filter pills.

#### Screenshot Callout Labels
* **Box 1 [Product List / Master Data Header & Live Records Counter]**: "Header showing the active module title and a yellow pill badge displaying total enrolled records (e.g., '879 records')."
* **Box 2 [Show / Hide Archived Products Toggle]**: "Bordered toggle button that switches between displaying only active catalog styles or revealing soft-deleted/archived items."
* **Box 3 [+ Add Product Action Button]**: "Prominent golden button with plus icon that triggers the Add Product modal for master shoe enrollment."
* **Box 4 [Catalog Master Search Bar & Clear Button]**: "Search input with yellow magnifying glass icon and instant clear button (X) accepting SKU codes, shoe names, brands, categories, or colors."
* **Box 5 [Category Dropdown Filter]**: "Dropdown selector with filter icon showing all registered footwear categories alongside live variant counts per category."
* **Box 6 [Quick-Select Category Filter Pills]**: "Horizontal row of interactive pills (All, Basketball Shoes, Boots, Casual Shoes, Formal Shoes, Sandals, Sports Shoes) for fast 1-click catalog filtering."
* **Box 7 [Master Data Catalog Table]**: "Comprehensive table displaying Image thumbnails, matching SKU identifiers, Product titles, Brands, Categories, Colors, Target Departments, EU Sizes, Unit Prices (PHP), and Row Action controls."
* **Box 8 [Edit Variant Action Icon]**: "Yellow square edit pencil button on each product row that opens the Edit Product modal for attribute updates or deletion."
* **Box 9 [Matching SKU Hierarchy & Variant Alignment]**: "Standardized SKU format directly linked to the shoe model and variant attributes, ensuring the SKU displayed on product rows perfectly matches inventory stock records to prevent conflicting product information."
* **Box 10 [Table Pagination & Page Size Selector]**: "Interactive pagination bar featuring page size selection (10, 15, 25, 50, 100 items per page), live record counter ('Showing 1 to 10 of 879 products'), and previous/next/numbered navigation pills."
* **Box 11 [Multi-Dimensional Filters]**: "Comprehensive filtering bar offering Brand dropdown, Department/Gender selector (Men, Women, Kids, Unisex), and Stock Availability status filters with one-click 'Reset all' badge."

#### STEPS
1. Click **Product List** in the left navigation sidebar.
2. Review the live catalog records badge at the top right to verify total registered styles (e.g., `879 records`).
3. To filter by footwear style, click any of the **Quick-Select Category Pills** (e.g., *Basketball Shoes (2)*, *Casual Shoes*, or *All*), or select a category from the **Category Dropdown**.
4. Use the **Brand**, **Department**, or **Stock Status** dropdowns to further isolate specific product groups. Click **Reset all** to clear active filters.
5. Notice that all variant SKUs strictly match the product matrix hierarchy, ensuring that POS terminals and inventory logs use synchronized barcodes.
6. Use the **Table Pagination Bar** at the bottom of the table to navigate through large catalogs. Adjust items per page (10, 15, 25, 50, 100) or click page numbers directly. Changing filters automatically returns the view to Page 1.
7. Use the **Catalog Master Search Bar** to instantly find specific models by typing the SKU barcode, product name (e.g., *Street Runner*), brand (e.g., *Venus*, *Nike*), or color. Click the **X** button to quickly clear your search query.
8. Click **Show Archived** if you need to inspect or restore previously discontinued products.
9. To enroll a brand-new shoe model into the catalog, click the golden **+ Add Product** button.
10. To edit an existing footwear item, click the yellow **Edit** icon in the **Actions** column of the desired row.

---

### Section 2.8: Product List – Add Product Modal (Master Shoe Variant Enrollment)
#### Screen Description
Triggered by clicking the "+ Add Product" button on the Product List page. This modal allows administrators to enroll new footwear styles and variants into the master database by specifying commercial style titles, manufacturer brands, category taxonomies, EU sizing, colorways, target departments, unit costs, and high-resolution shoe imagery.

#### Screenshot Callout Labels
* **Box 1 [Modal Header & Dismiss Control]**: "Modal title 'Add Product' with quick-exit close icon (X) at the upper right."
* **Box 2 [Product Name & Brand Mandatory Inputs]**: "Required text fields for the commercial footwear style title (e.g., 'Street Runner') and manufacturer brand (e.g., 'Venus', 'Nike')."
* **Box 3 [Category Classification Dropdown]**: "Mandatory selector to assign the shoe style to an established category (Running Shoes, Casual Shoes, Basketball Shoes, Sandals, etc.)."
* **Box 4 [Size & Colorway Specifications]**: "Input fields to designate the specific EU shoe size (e.g., '42', '10', '43') and visual colorway (e.g., 'White', 'Black', 'Green')."
* **Box 5 [Department Demographic Selector]**: "Dropdown menu to assign customer demographic targeting: Men, Women, Kids, Unisex, or N/A."
* **Box 6 [Unit Price Currency Input]**: "Numeric field to set the base supplier cost / unit price for the shoe variant in Philippine Pesos (PHP)."
* **Box 7 [Product Image Upload & URL Panel]**: "Interactive media panel with image preview placeholder, 'Upload Image' button for local device files, and text field to paste direct web image URLs."
* **Box 8 [Save Product Submission Button]**: "Golden action button that validates required fields, commits the new footwear variant into Supabase, and updates the catalog."

#### STEPS
1. On the Product List page, click the golden **+ Add Product** button at the top right.
2. In the modal, enter the **Product Name \*** (e.g., *Air Force Classic*) and the manufacturer **Brand \*** (e.g., *Meryl*).
3. Open the **Category \*** dropdown and select the appropriate category (e.g., *Casual Shoes*).
4. Enter the shoe **Size** (e.g., *42*) and **Color** (e.g., *White*).
5. Select the target **Department** (e.g., *Men* or *Kids*) from the dropdown.
6. Enter the base **Unit Price** in Philippine Pesos (e.g., *1500*).
7. For the **Product Image (Optional)**, either click **Upload Image** to select a photo from your local computer, or paste a high-resolution image web URL directly into the text box.
8. Click **Save Product**. The modal closes, a confirmation notification appears, and the new footwear variant appears in the catalog table.

---

### Section 2.9: Product List – Edit Product Modal (Variant Attributes, Update Scope & Archiving)
#### Screen Description
Triggered by clicking the yellow Edit icon on any row in the Product List table. Allows administrators to modify footwear specifications, update product imagery, select an update scope across sibling variants, and safely delete or archive discontinued shoe models without corrupting past sales records.

#### Screenshot Callout Labels
* **Box 1 [Edit Product Header]**: "Modal title 'Edit Product' with quick-exit close icon (X)."
* **Box 2 [Pre-Populated Attribute Inputs]**: "Editable fields pre-filled with the selected variant's Product Name, Brand, Category, Size, Color, Department, and Unit Price."
* **Box 3 [Product Image Manager]**: "Image preview container displaying the current shoe photo with options to upload a replacement photo or paste a new URL."
* **Box 4 [UPDATE SCOPE Selector]**: "Three interactive selector pills allowing administrators to govern how edits propagate: 'This variant only', 'Selected variants', or 'All variants of base'."
* **Box 5 [Delete / Archive Product Action Button]**: "Red text button on the left that deactivates discontinued shoes to Inactive status while safeguarding historical sales transactions (switches to 'Restore Product' if already inactive)."
* **Box 6 [Update Product Confirmation Button]**: "Golden action button on the right that commits all edited attributes to Supabase and updates the catalog table."

#### STEPS
1. Locate the footwear item to modify in the **Product List** table and click the yellow **Edit** icon in the **Actions** column.
2. In the **Edit Product** modal, review and modify the attributes:
   - Edit the **Product Name**, **Brand**, or **Category**.
   - Adjust the **Size**, **Color**, **Department**, or **Unit Price**.
   - Update or replace the **Product Image** by uploading a new file or pasting an updated image URL.
3. Under **UPDATE SCOPE**, select how the modifications should be applied:
   - **This variant only**: Modifies only the currently selected size and color SKU.
   - **Selected variants**: Opens checkboxes to choose specific sibling variants within the shoe model family.
   - **All variants of base**: Propagates commercial attributes (Name, Brand, Category, Unit Price, Image) across all sizes and colors of this footwear style simultaneously.
4. If the footwear model has been discontinued or retired from sales, click the red **Delete / Archive Product** button on the bottom left. The system flags the item as inactive and hides it from POS registers.
5. To commit the edits, click the golden **Update Product** button. The system updates the records in real time and displays a success toast notification.

---

### Section 2.10: Product Settings – Footwear Parameters & Stock Health Dashboard
#### Screen Description
The Product Settings dashboard provides high-level inventory health metrics across all catalog variants and enables store managers to configure stock-in intake, retail markup rates, and automated Reorder Points (ROP).

#### Screenshot Callout Labels
* **Box 1 [Inventory KPI Metrics Bar]**: "Four summary stat cards displaying Total Variants, POS Available in-stock count, Low Stock Warnings, and Out of Stock counts."
* **Box 2 [Stock Health Status Filter Dropdown]**: "Dropdown selector to filter by inventory status: 'All Stock Statuses', 'In-Stock & Sellable', 'Low Stock (≤ Reorder)', 'Out of Stock', or 'Inactive Items'."
* **Box 3 [Category Filter Dropdown]**: "Filters the settings matrix by footwear classification."
* **Box 4 [Brand Filter Dropdown]**: "Dynamic brand filter selector (All Brands, Nike, Adidas, etc.) to evaluate specific manufacturer portfolios."
* **Box 5 [Variant Inventory Configuration Table]**: "Table listing SKU, Product Name, Brand, Unit Cost, SRP, On-Hand Stock, ROP, Gross Profit (rendered in high-contrast uniform white), and the Configure action icon."
* **Box 6 [Table Pagination Bar]**: "Interactive pagination controls (10, 15, 25, 50, 100 variants/page) with record counter ('Showing 1 to 10 of 882 variants') and navigation pills."
* **Box 7 [Configure Parameters Action Button]**: "Gear icon on each variant row that launches the Configure Product Parameters modal."

#### STEPS
1. Click **Product Settings** in the left navigation sidebar.
2. Review the four top KPI cards to monitor stock health (Total Variants, POS Available, Low Stock, Out of Stock). Notice that Gross Profit numbers are formatted in uniform white to maintain legibility.
3. Filter the table using the **Category**, **Brand**, or **Stock Status** dropdowns to isolate specific low-stock or high-turnover lines.
4. Use the **Table Pagination Bar** at the bottom to browse through variants; filter adjustments automatically return the table to Page 1.
5. Click the gear **Configure** button on any variant to adjust its inventory parameters.

---

### Section 2.11: Product Settings – Configure Product Parameters Modal (Stock-In, Markup % & POS Visibility)
#### Screen Description
Opens when clicking Configure Parameters (gear icon) on any product row. Used by managers to record delivery stock-ins, set reserved quantities, adjust retail markup percentages, verify live SRP calculations, establish safety reorder alert thresholds, record batch manufacturing/expiration dates, and toggle POS sellable status.

#### Screenshot Callout Labels
* **Box 1 [Product Identity & Department Specifications]**: "Header banner showing footwear thumbnail, style name, Brand, SKU barcode, Category, Color, Size, base Unit Cost, and target Department (Men, Women, Kids, Unisex)."
* **Box 2 [Stock Intake & Current Shelf Stock Panel]**: "Displays Current On-Hand units alongside the 'Add Stock Quantity (+Units)' input field that automatically projects new available shelf inventory."
* **Box 3 [Reserved / Held Stock & Supplier Base Cost]**: "Editable input for stock held aside for reservations or store transfers, plus supplier wholesale cost per pair in Philippine Pesos (₱)."
* **Box 4 [Markup % Calculator & Margin Multiplier]**: "Markup percentage input with quick preset buttons (20%, 35%, 50%, 90%), dynamic multiplier badge (e.g., `1.00x (+100% margin)`), and live calculated retail SRP (₱)."
* **Box 5 [Reorder Alert Level & Batch Quality Dates]**: "Safety reorder threshold (ROP Alert) field alongside calendar date pickers for Manufactured Date and Expiration/Warranty Date."
* **Box 6 [Sellable Status Toggle & Save Parameters Button]**: "Active (Sellable) vs. Inactive (Disabled) toggle buttons and the golden 'Save Parameters' button to commit changes across all POS terminals."

#### STEPS
1. In the Product Settings or Sellable Inventory table, click the **Gear icon (⚙️)** on the desired footwear row.
2. Review the **Product Identity & Department Specifications (Box 1)** to verify the shoe style, variant sizing, and department.
3. In **Add Stock Quantity (Box 2)**, type the number of received pairs (e.g., `24`) to increment physical inventory upon delivery.
4. If pairs need to be held for reservations or transfers, specify the quantity in **Reserved / Held Stock (Box 3)**.
5. In **Markup % (Box 4)**, select a preset button (e.g., *+35%*) or type a custom markup percentage. Observe the live margin multiplier (e.g., `0.35x (+35% margin)`) and the calculated retail **SRP**.
6. Set the **Reorder Level (Box 5)** (e.g., `10`) to trigger low-stock alerts when inventory drops, and pick the **Manufactured Date** and **Expiration Date**.
7. Ensure the status toggle **(Box 6)** is set to **Active (Sellable)**, then click **Save Parameters** to immediately commit the updates.

---

### Section 2.12: Sellable Inventory – Active Stock Monitoring & Category Filters
#### Screen Description
The Sellable Inventory portal provides centralized visibility over all active footwear items currently stocked and available for sale. It equips warehouse custodians and store supervisors with multi-attribute search, category filtering dropdowns and quick pills, stock availability indicators, and instant access to detailed stock audit specifications and inline parameter configuration.

#### Screenshot Callout Labels
* **Box 1 [Real-Time Search Input]**: "Real-time search input (Search by SKU, product, brand, category, or variant...) that immediately filters table rows as characters are typed."
* **Box 2 [Header Banner & Total Records Badge]**: "Header banner showing the yellow Warehouse icon, Sellable Inventory title, and a golden pill displaying total active inventory records (e.g., 8 records)."
* **Box 3 [Quick Classification Selector]**: "Quick classification selector (All Categories) located in the upper-right corner of the inventory card."
* **Box 4 [Interactive Category Filter Pills]**: "Horizontal row of filter pills showing live quantities per footwear category."
* **Box 5 [High-Contrast Inventory Data Table]**: "High-contrast data table displaying core columns (Image, Product, Variant, Price, Available, Gross Profit in uniform white, Status, Actions)."
* **Box 6 [Row Action Controls (Eye & Gear Buttons)]**: "Use the Eye icon to view detailed inventory audits, and the Gear icon to configure product settings."
* **Box 7 [Table Pagination Bar]**: "Controls items per page (10, 15, 25, 50, 100) and displays record count with page navigation buttons."
* **Box 8 [Multi-Dimensional Filters]**: "Dropdown controls for Brand, Department (Men, Women, Kids), and Stock Status (In Stock, Low Stock, Out of Stock)."

#### STEPS
1. Navigate to **Inventory** in the sidebar navigation (or access `/inventory`).
2. Review the list of active footwear products configured with sellable stock.
3. In the **Real-Time Search Input (Box 1)**, type a keyword (SKU barcode, shoe model, brand, colorway, or variant) to filter records in real time.
4. Observe the **Header Banner & Total Records Badge (Box 2)** to see the count of matching items.
5. Use the **Quick Classification Selector (Box 3)** or click any of the **Interactive Category Filter Pills (Box 4)** to isolate specific footwear styles.
6. Use the **Brand**, **Department**, or **Stock Status** dropdowns **(Box 8)** for fine-grained filtering.
7. Inspect the **High-Contrast Inventory Data Table (Box 5)**, observing that Gross Profit is rendered in uniform white and in-stock units are highlighted in green.
8. Navigate through pages using the **Table Pagination Bar (Box 7)**.
9. Under the **Row Action Controls (Box 6)**:
   - Click the **Eye icon** to view detailed inventory audits (physical on-hand vs. reservations, condition, and batch dates).
   - Click the **Gear icon** to configure product settings (restock intake, markups, ROP, department, and expiration dates).

---

### Section 2.13: Sellable Inventory – Item Variant Details & Stock Condition Modal
#### Screen Description
Opens when clicking the Eye icon (`View details`) on any footwear variant in the Sellable Inventory table. Renders a comprehensive 14-point audit dialog detailing physical inventory on hand versus customer reservations, sellable availability, automated condition checks, and batch manufacturing/expiration dates.

#### Screenshot Callout Labels
* **Box 1 [Variant Header Summary Card]**: "Displays shoe thumbnail photo, Brand, Model Name, Category, and detailed variant classification (Color, Size, Department)."
* **Box 2 [SKU & Identification Code]**: "Displays the unique SKU barcode reference and complete product title."
* **Box 3 [Stock Metrics, Pricing & Batch Quality Grid]**: "Two-column specifications grid itemizing complete variant inventory metrics:
  - **Stock Distribution**: Physical count on warehouse shelves (**On Hand**), stock reserved for pending orders or transfers (**Held**), and sellable units ready for POS checkouts (**Available**).
  - **Threshold & Pricing**: Minimum safety threshold triggering automated alerts (**Reorder**) and retail selling price formatted in Philippine Pesos (**Price**).
  - **Condition & Status**: Live automated health check indicator (**Condition**, e.g., *Brand New / In Stock*, *Low Stock*, *Out of Stock*, *Expired*) and sellable operational status (**Status**: *Active*).
  - **Batch Tracking Dates**: Recorded production batch date (**Manufacturer Date**) and warranty/shelf-life expiration date (**Expiration Date**)."

#### STEPS
1. On the **Sellable Inventory** table, click the **Eye icon** (`View details`) in the **Actions** column for the desired shoe variant.
2. The **Inventory Details** modal opens with the shoe thumbnail and title summary banner.
3. Review the **Stock Breakdown** pills:
   - **On Hand**: Total pairs physically present in the stockroom.
   - **Held**: Pairs currently reserved for customer layaways, pending pickup, or transfers.
   - **Available**: Physical pairs actively sellable on POS terminals (`On Hand - Held`).
4. Check the **Reorder** threshold to verify whether current on-hand units satisfy safe stock buffer levels.
5. Inspect the **Condition**, **Manufacturer Date**, and **Expiration Date** to ensure batch quality standards.
6. Click outside the modal or press the close icon to dismiss the inspection dialog.

---

### Section 2.14: Stock Audit Physical Reconciliation & Adjustment Modal
#### Screen Description
Opens when clicking Adjust Stock during routine stockroom physical inventory counts. Reconciles discrepancies caused by shrinkage, damaged boxes, or factory returns.

#### Screenshot Callout Labels
* **Box 1 [Current System Count Display]**: "Shows the recorded database quantity before physical audit."
* **Box 2 [Physical Recount Quantity Field]**: "Actual verified number of shoe pairs physically counted on shelves."
* **Box 3 [Quantity Discrepancy Delta (+ / -)]**: "Calculates the difference between system and actual counts in real-time."
* **Box 4 [Adjustment Reason Category Dropdown]**: "Select: Physical Stocktake Discrepancy, Damaged in Storage, Return to Supplier, or Factory Defect."
* **Box 5 [Audit Explanation Notes]**: "Mandatory remarks documenting the root cause of the inventory adjustment."
* **Box 6 [Commit Adjustment Button]**: "Applies corrected count and permanently records staff username and timestamp in the audit log."

#### STEPS
1. Locate the shoe row where a count discrepancy exists and click **Adjust Stock**.
2. In the **Physical Count** field, type the actual number of pairs found on the shelf.
3. Select the appropriate **Reason Category** from the dropdown.
4. Enter an explanatory note in the remarks field (e.g., *'One box water damaged during roof leak'*).
5. Click **Commit Adjustment**. The inventory level updates and an immutable log entry is generated.

---

### Section 2.15: Stock Movement Log & Audit Trail Ledger
#### Screen Description
The Inventory Movement Log (`/inventory-log`) provides an immutable, chronological audit trail recording every addition, deduction, transfer, and adjustment that occurs across store inventory. It equips store managers and warehouse custodians with high-level KPI cards (Stock In, Stock Out, Net Movement), real-time search, category filtering, and direct transaction reference traceability.

#### Screenshot Callout Labels
* **Box 1 [Inventory Flow KPI Summary Cards]**: "Summary KPI cards tracking overall inventory flow: Stock In (total received pairs), Stock Out (sales & deductions), and Net Movement."
* **Box 2 [Real-Time Search Input]**: "Real-time search field filtering logs by shoe model, brand, SKU, movement type, or transaction reference."
* **Box 3 [Movement Type Filter & Refresh Action]**: "Filter logs by movement category (Sales, Restocks, Holds, Adjustments) and click Refresh to pull live updates."
* **Box 4 [Chronological Movement Ledger Table]**: "Chronological audit ledger recording timestamp, shoe model, EU size, colorway, and SKU barcode for each stock event."
* **Box 5 [Movement Category & Quantity Delta Badges]**: "Color-coded classification pills (Restock, Sale, Reserved/Hold, Adjustment) with signed inventory deltas (+50, -1)."
* **Box 6 [Reference & Transaction Traceability Hash]**: "System transaction UUID or delivery reference linking the stock movement directly to sales receipts or restocks."
* **Box 7 [Direction / Flow Filter Dropdown]**: "Filter by net inventory flow: 'All Flows', 'Stock In (+)', or 'Stock Out (-)' to isolate incoming replenishment vs outgoing sales."
* **Box 8 [Table Pagination Bar]**: "Interactive pagination controls (10, 15, 25, 50 rows/page, default 15) with page numbers, record counter ('Showing 1 to 15 of 842 movements'), and auto-page reset."

#### STEPS
1. Click **Inventory Log** in the left navigation sidebar (or access `http://localhost:5173/inventory-log`).
2. Review the top KPI cards **(Box 1)** to monitor total **Stock In**, **Stock Out**, and **Net Movement**.
3. In the **Search input (Box 2)**, type a footwear style name, brand, SKU code, or movement reference to quickly filter log entries.
4. Select a movement filter from **Movement Types (Box 3)** and use the **Flow Filter (Box 7)** to view only incoming shipments or sales deductions.
5. Navigate through historical records using the **Table Pagination Bar (Box 8)** (adjust page size or click page pills).
6. In the **Movement Ledger Table (Box 4)**, inspect each row for the exact date/time, shoe model, EU sizing, and SKU identifier.
7. Verify the signed units in the **Qty Change column (Box 5)** to track additions (green) vs deductions (red).
8. Trace the transaction via the **Reference column (Box 6)** to verify corresponding customer receipt numbers or delivery shipment invoices.

---

### Section 2.16: Sales Transaction Management & Order Register
#### Screen Description
The Sales Management module (`/sales`) serves as the master sales transaction ledger for store administrators. It centralizes all completed cashier checkout orders, payment methods, transaction timestamps, items sold, receipt numbers, and provides instant lookup for audit compliance, customer inquiries, and receipt reprinting.

#### Screenshot Callout Labels
* **Box 1 [Receipt & Customer Search Bar]**: "Real-time search field allowing instant lookup by Official Receipt number (e.g., OR-2026-0042), transaction ID, or customer name."
* **Box 2 [Date Range & Cashier Filter Controls]**: "Calendar date pickers to isolate sales by day/week/month, alongside a cashier dropdown filter to audit specific staff shifts."
* **Box 3 [Sales Master Data Table]**: "Comprehensive ledger columns: Transaction ID, Receipt #, Timestamp, Items Sold count, Total Amount in PHP (₱), Payment Method (Cash/GCash), and Cashier Name."
* **Box 4 [Payment & Tender Method Badges]**: "Color-coded pills indicating tender type: Green for Cash checkouts, Blue for GCash digital wallet payments."
* **Box 5 [Order Inspection & Reprint Action Buttons]**: "Row action buttons: Blue Eye icon to view the itemized order breakdown, and Printer icon to generate an official duplicate thermal receipt."
* **Box 6 [Payment Mode Filter Dropdown]**: "Dropdown filter to isolate transactions by payment tender: 'All Modes', 'Cash', or 'GCash'."
* **Box 7 [Order Status Filter Dropdown]**: "Dropdown filter to isolate transaction statuses: 'All Status', 'Completed', 'Pending', or 'Voided'."
* **Box 8 [Table Pagination Bar]**: "Interactive pagination bar supporting 10, 15, 25, 50, or 100 transactions per page with page jump pills and active record counts."

#### STEPS
1. Click **Sales** in the left navigation sidebar (or navigate to `http://localhost:5173/sales`).
2. Review the chronological sales register to audit daily store transactions and total revenue.
3. In the **Search Bar (Box 1)**, type a customer name or Official Receipt number to locate a specific sale.
4. Use the **Date Range & Cashier Filters (Box 2)**, **Payment Mode Filter (Box 6)**, or **Order Status Filter (Box 7)** to narrow down transactions.
5. Use the **Table Pagination Bar (Box 8)** at the bottom to browse through transactions; changing filters automatically returns the view to Page 1.
6. In the **Sales Master Table (Box 3)**, inspect the transaction timestamp, items sold, and verify the payment tender type **(Box 4)**.
7. Under **Actions (Box 5)**:
   - Click the **Eye icon** (`View`) to open the **Itemized Order Details Modal**.
   - Click the **Printer icon** (`Reprint`) to generate a duplicate customer receipt.

---

### Section 2.17: Sale Details & Transaction Settlement Audit Modal
#### Screen Description
Opens when clicking the golden View Details icon (eye icon) on any transaction row in the Sales Records register. It provides an itemized breakdown of the completed transaction, displaying customer status, cashier identification with staff code, transaction date, payment tender method, purchased footwear styles with brand/size/colorway badges and applied discounts, followed by a comprehensive financial settlement and replacement audit summary.

#### Screenshot Callout Labels
* **Box 1 [Modal Header & Order Status Badge]**: "Displays the transaction identifier (e.g., 'Sale Details • SALES-055'), a green status badge ('COMPLETED'), and a quick-close (X) button."
* **Box 2 [Transaction Metadata Summary Card]**: "Four-column card detailing Customer type ('Walk-in Customer'), Cashier name and staff badge code ('Administrator ADM-001'), Transaction Date ('2026-09-17'), and Payment Method ('CASH')."
* **Box 3 [Purchased Items Register & Variant Badges]**: "Header indicating total pair count (e.g., 'PURCHASED ITEMS (2 PAIRS)') with an item card displaying shoe title ('Dunk Low Retro'), brand tag ('Nike'), size badge ('Size 42'), and colorway badge ('Black/White')."
* **Box 4 [Quantity Breakdown & Promotional Discount]**: "Shows unit pricing computation ('Qty: 2 pairs × PHP 2,295.00'), green discount badge ('Discount: 15% (-PHP 688.50)'), original strikethrough price ('PHP 4,590.00'), and final net item total ('PHP 3,901.50')."
* **Box 5 [Payment & Settlement Financial Summary]**: "Itemizes Gross Subtotal ('PHP 4,590.00'), Total Discount in green ('-PHP 688.50'), and large bold Total Net Amount ('PHP 3,901.50')."
* **Box 6 [Settlement Metadata & Replacement Tracker]**: "Footer strip showing Payment Mode ('CASH'), Replacements status ('0 items'), and Last Activity date ('2026-09-17')."

#### STEPS
1. In the left navigation sidebar, click **Sales** to open the **Sales Records** register.
2. Locate the target transaction using the search bar, date range pickers, or cashier dropdown filter.
3. In the **Actions** column of the transaction row, click the golden **View (eye icon)**.
4. The **Sale Details** modal opens centered on screen.
5. Review the **Transaction Metadata** card to verify customer identity, cashier credentials (`ADM-001`), transaction date, and payment method.
6. Inspect the **PURCHASED ITEMS** card to review shoe model, brand, EU size, colorway, unit cost, and applied promotional discounts.
7. Verify the financial figures in the **PAYMENT & SETTLEMENT** card (Gross Subtotal, Total Discount, and Total Net Amount).
8. Check the replacement tracker line at the bottom to verify if any warranty returns or size exchanges were associated with this sale.
9. Click the **[X]** button at the top right of the modal to close the view and return to the sales ledger.

---

### Section 2.18: Duplicate Thermal Sales Receipt Reprint Modal
#### Screen Description
Opens when clicking Reprint from either the Sales Management table or the Order Details modal. Re-renders the standardized 58mm/80mm thermal receipt formatted with store branding, BIR compliance indicators, transaction breakdowns, and an official duplicate watermark.

#### Screenshot Callout Labels
* **Box 1 [Store Branding & Branch Header]**: "Enterprise header featuring Meryl Shoes logo, store branch address, TIN, and terminal accreditation numbers."
* **Box 2 [Official Receipt & Cashier Credentials]**: "Official Receipt number, transaction date/time, POS register identifier, and cashier staff name."
* **Box 3 [Itemized Cart Listing Canvas]**: "Clean monospace table detailing item descriptions, sizes, quantities, unit prices, and line amounts."
* **Box 4 [Payment Tender & Change Calculation]**: "Summary lines showing Subtotal, Applied Discounts, Net VATable Sales, VAT Amount, Total Due, Cash/GCash Paid, and Change."
* **Box 5 [Official Duplicate Watermark & Barcode]**: "Security watermark designating the printout as an Official Duplicate Copy, along with a scannable transaction barcode."
* **Box 6 [Print Dispatch & Download Controls]**: "Action buttons: 'Print Receipt' to send the job to the thermal slip printer, and 'Save as PDF' for digital archiving."

#### STEPS
1. In the Sales table or Order Details dialog, click **Reprint Receipt**.
2. Review the **Receipt Canvas (Boxes 1–4)** on screen to ensure all items, payment amounts, and VAT details are accurate.
3. Verify the **Official Duplicate Notice (Box 5)** is present on the slip.
4. Click **Print Receipt (Box 6)** to print on the connected thermal receipt printer, or select **Save as PDF** to save an electronic copy.
5. Click **Close** to dismiss the modal.

---

### Section 2.19: Customer Directory & Loyalty Management CRM
#### Screen Description
The Customer Management module (`/customers`) manages the store's customer database, contact profiles, shoe sizing preferences, accumulated loyalty points, and purchase histories. It enables store managers to deliver personalized service, target promotional marketing campaigns, and monitor customer lifetime value.

#### Screenshot Callout Labels
* **Box 1 [Customer Directory Header & Total Count Badge]**: "Module title with a badge displaying the total number of registered customer profiles (e.g., 124 Customers)."
* **Box 2 [+ Add Customer Action Button]**: "Yellow action button with plus icon that triggers the Add Customer registration modal."
* **Box 3 [Customer Multi-Field Search Input]**: "Search input accepting customer full name, mobile phone number, or email address with instant filtering."
* **Box 4 [Customer Directory Data Table]**: "Data grid displaying Customer Name, Mobile Number, Email Address, Default Shoe Size Preference, Total Orders, Lifetime Spend (₱), and Action buttons."
* **Box 5 [Row Action Controls (History & Edit)]**: "Quick action buttons: Clock/History icon to open Customer Purchase Dossier, and Pencil/Edit icon to modify contact details and size preferences."
* **Box 6 [Customer Status Filter Dropdown]**: "Filter by customer status: 'All Status', 'Active', or 'Inactive'."
* **Box 7 [Demographic / Gender Filter Dropdown]**: "Filter profiles by gender category: 'All Genders', 'Male', 'Female', or 'Kids'."
* **Box 8 [Table Pagination Bar]**: "Interactive pagination controls (10, 15, 25, 50 per page) with record count and page pills."

#### STEPS
1. Click **Customers** in the left navigation sidebar (or navigate to `http://localhost:5173/customers`).
2. View the customer directory table **(Box 4)** to inspect active client profiles and lifetime spend totals.
3. In the **Search Bar (Box 3)**, type a customer's phone number or name to locate their record.
4. Use the **Status Filter (Box 6)** or **Gender Filter (Box 7)** to target specific customer demographics.
5. Navigate across customer pages using the **Table Pagination Bar (Box 8)**.
6. Click **+ Add Customer (Box 2)** to enroll a new shopper into the loyalty database.
7. Under **Actions (Box 5)**:
   - Click the **History icon** to view the customer's purchase history and preferred shoe sizes.
   - Click the **Pencil/Edit icon** to update contact details, address, or sizing preferences.

---

### Section 2.20: Add / Edit Customer Profile & Sizing Preferences Modal
#### Screen Description
Triggered by clicking "+ Add Customer" or the yellow Edit button on a customer record. Allows store personnel to enroll new shoppers or update contact info, delivery addresses, and default footwear sizing preferences for fast POS checkouts.

#### Screenshot Callout Labels
* **Box 1 [Modal Header & Exit Control]**: "Modal title 'Add Customer' or 'Edit Customer Profile' with close button (X)."
* **Box 2 [Full Name & Contact Phone Inputs]**: "Required fields for customer first/last name and 11-digit mobile phone number (e.g., 09171234567)."
* **Box 3 [Email Address Input]**: "Optional email field for dispatching digital PDF receipts, promotional vouchers, and warranty claim updates."
* **Box 4 [Shoe Sizing Preferences Selector]**: "Dropdown menu to record the customer's standard footwear size (EU 36–46) and preferred department (Men/Women/Kids)."
* **Box 5 [Customer Notes & Delivery Address]**: "Text area for recording residential delivery address, delivery instructions, or special footwear fit notes."
* **Box 6 [Save Customer Submission Button]**: "Yellow button validating mobile number format and saving the customer profile into Supabase."

#### STEPS
1. In Customer Management, click **+ Add Customer** (or click the **Pencil icon** on an existing customer).
2. Enter the customer's **Full Name \*** and **Mobile Number \*** in the designated fields **(Box 2)**.
3. Input the customer's **Email Address (Box 3)** to enable digital receipt transmission.
4. Select their **Preferred Shoe Size (Box 4)** (e.g., *Size 42 - Men*) to automatically pre-select sizes during future POS transactions.
5. Add any delivery address or special notes in **Customer Notes (Box 5)**.
6. Click **Save Customer (Box 6)** to commit the record.

---

### Section 2.21: Customer Purchase Dossier & Lifetime Spending Analytics Modal
#### Screen Description
Opens by clicking the History icon on any customer record in the CRM table. Provides store managers with a 360-degree historical spending dossier, displaying total lifetime purchases, average order value, preferred footwear styles, and itemized receipts.

#### Screenshot Callout Labels
* **Box 1 [Customer Summary Profile Card]**: "Header banner showing customer full name, mobile number, email, member enrollment date, and loyalty status badge."
* **Box 2 [Customer Spending KPI Cards]**: "Three metric cards displaying: Lifetime Spend (₱), Total Completed Transactions, and Average Basket Size."
* **Box 3 [Favorite Brands & Shoe Categories Pill Row]**: "Pill tags highlighting the shopper's most frequently purchased footwear brands (e.g., Nike, Adidas) and categories (Basketball, Running)."
* **Box 4 [Historical Orders Ledger Table]**: "Table listing past receipts: Date, Receipt #, Pairs Purchased, Total Amount (₱), Payment Type, and View Receipt action."
* **Box 5 [Order Details Drawer Trigger]**: "Action button allowing managers to open and reprint past receipts directly from the customer dossier."

#### STEPS
1. In the Customer Directory table, click the **Clock icon** on any customer row.
2. The **Customer Dossier** modal opens displaying their profile banner **(Box 1)**.
3. Review the **KPI Metrics (Box 2)** to analyze customer lifetime value and purchasing frequency.
4. Inspect the **Favorite Brands / Categories (Box 3)** to tailor recommendations for upcoming promotions.
5. In the **Orders Ledger (Box 4)**, review chronological past purchases, or click **View Receipt (Box 5)** to inspect an individual past order.
6. Click **Close** to return to the Customer Directory.

---

### Section 2.22: Replacement Management – Master Exchange Ledger & KPI Overview
#### Screen Description
The Replacement Management module (`/admin/returns` or `/replacement`) provides a centralized, real-time command center for tracking customer footwear exchanges, 1:1 size swaps, and manufacturer defect replacements. It features high-level situational KPI metric cards, an omni-channel search bar, multi-attribute staff and status dropdown filters, timeframe preset pills, custom date range pickers, and a chronological exchange register with one-click audit inspection.

#### Screenshot Callout Labels
* **Box 1 [Module Header & Exchange Icon]**: "Displays golden circular arrows icon with title 'Replacement Management', alongside total count pill (e.g., 'Total: 31 replacements')."
* **Box 2 [Executive Exchange KPI Summary Cards]**: "Four real-time metrics tracking store warranty volume:
  - **COMPLETED EXCHANGES**: Total finalized exchange records (e.g., `31 Processed exchange records`).
  - **ITEMS REPLACED**: Gross footwear units replaced across all transactions (e.g., `32 Total shoe units exchanged`).
  - **SIZE SWAPS**: Fit adjustments executed under 1:1 even exchange (e.g., `11 1:1 size or fit exchanges`).
  - **DEFECTIVE / DAMAGED**: Defective or damaged footwear claims isolated from inventory (e.g., `29 Defect or damage replacements`)."
* **Box 3 [+ Process Replacement Action Button]**: "Prominent golden action button triggering the multi-step 1:1 item exchange intake modal."
* **Box 4 [Omni-Search Bar]**: "Real-time search field accepting Replacement IDs (e.g., `EXC-031`), Receipt numbers (`RCP-059`), Customer names, or Shoe model keywords."
* **Box 5 [Staff & Status Filter Dropdowns]**: "Dropdown selectors to filter records by handling personnel ('All Staff', Administrators, Cashiers) and ticket lifecycle ('All Status', Completed, Pending)."
* **Box 6 [Timeframe Preset Filter Pills]**: "One-click temporal filters ('All', 'Daily', 'Weekly', 'Monthly', 'Quarterly', 'Annually') to instantly isolate specific operational reporting cycles."
* **Box 7 [Custom Date Range Calendar Pickers]**: "Dual date input fields ('From mm/dd/yyyy' and 'To mm/dd/yyyy') with calendar pickers for arbitrary historic date auditing."
* **Box 8 [Live Counter Badge]**: "Displays active record matches relative to total records (e.g., 'Showing 31 of 31 replacements')."
* **Box 9 [Replacement Master Data Table]**: "Comprehensive exchange ledger displaying: Replacement ID (`EXC-XXX`), Original Receipt # (`RCP-XXX`), Customer Name, Staff Badge Code (`ADM-001`, `CSH-001`), Handling Employee (`Administrator`, `Sales Staff`), Status Badge (`Completed`), Replacement Date, and Action controls."
* **Box 10 [Row Action Control (Golden Eye Icon)]**: "Golden eye button on each row opening the itemized replacement audit dossier."

#### STEPS
1. In the left navigation sidebar, click **Replacement** (highlighted in red).
2. Review the top KPI cards **(Box 2)** to monitor completed exchanges, total items replaced, size swaps, and defect write-offs.
3. In the **Search Bar (Box 4)**, type a customer name, Replacement ID (e.g., `EXC-031`), or original Receipt number (e.g., `RCP-059`) for instant lookup.
4. Filter records using the **Staff** or **Status** dropdowns **(Box 5)**, or click a timeframe pill **(Box 6)** (e.g., *Daily* or *Monthly*).
5. To audit a specific historical period, specify the **From** and **To** dates in the calendar inputs **(Box 7)**.
6. In the **Replacement Table (Box 9)**, verify the customer, staff handler, and green **Completed** status badge.
7. Click the golden **Eye icon (Box 10)** in the Actions column to inspect the original receipt, replaced variant, replacement unit, and reason notes.
8. To initiate a walk-in customer return or size swap, click the golden **+ Process Replacement (Box 3)** button.

---

### Section 2.23: Process Item Replacement Modal (5-Step 1:1 Even Exchange Flow)
#### Screen Description
Opens when clicking the "+ Process Replacement" button. Provides a structured 5-step workflow adhering strictly to Meryl Shoes' store warranty policy (1:1 even exchange for sizing or defective pairs at ₱0.00 price difference, no cash refunds or store credit). It integrates receipt validation, hardware camera QR scanning, receipt proof upload with Supabase Cloud Storage archiving, warehouse routing, replacement shoe/size selection, and replacement queue management.

#### Screenshot Callout Labels
* **Box 1 [Modal Header & Dismiss Control]**: "Modal title 'Process Item Replacement' with opposing exchange arrows icon and close button (X)."
* **Box 2 [Current Selection Summary Status Bar]**: "Three-column status card with '0 line(s) added' pill detailing active workflow progress:
  - **1. Sale / Receipt**: Displays selected receipt number and transaction date (or 'Not selected').
  - **2. Replaced Item**: Displays customer's returned shoe model and original size (or 'Not selected').
  - **3. Replacement Variant**: Displays chosen replacement unit, new size, and color (or 'Not selected')."
* **Box 3 [Step 1: Validate Receipt / Original Sale Banner & 7-Day Policy Badge]**: "Receipt validation section featuring a golden '7-Day Policy Check' compliance pill."
* **Box 4 [Receipt Scanner Input Bar & Action Buttons]**: "Input field accepting receipt numbers (e.g., `RCP-20260918-XXXX` or `SALES-001`) with three action buttons:
  - **Scan Camera**: Launches the live webcam viewfinder modal to scan receipt QR codes.
  - **Upload QR Photo**: File picker to upload a pre-captured QR code image.
  - **Verify**: Commits receipt lookup and verifies that purchase date is within the 7-day warranty window."
* **Box 5 [Browse All Sales Accordion Trigger]**: "'▼ Or Browse All Sales Instead' collapsible drawer allowing manual lookup from recent sales registers."
* **Box 6 [Receipt Proof Dropzone & Cloud Upload Button]**: "Dropzone canvas with 'Upload Receipt' button to capture or attach a photo of the printed receipt, uploaded to the encrypted Supabase Cloud Storage `return-receipts` bucket."
* **Box 7 [Replaced Item Inventory Action Dropdown]**: "Governs warehouse routing for the returned pair: 'Defective / Not Sellable' (routes to scrap/factory return) or 'Back to Stock (Restock)' (for unworn sizing swaps)."
* **Box 8 [Step 2: Select Replaced Product Table]**: "Displays purchased items from the validated sale with columns: SKU, Product, Sold count, Replaceable quantity, Replace Qty stepper, Price, and Action selector."
* **Box 9 [Step 3: Same Product Replacement & Size Picker]**: "Panel enforcing store policy (exchanges must be for the same shoe model). Displays the chosen replacement shoe with 'Choose Size / Variant' button to select new in-stock EU sizes (36–46)."
* **Box 10 [Replacement Queue Table]**: "Queue register displaying items prepared for exchange: Original Item, Replacement Item / Size, Qty, Policy ('1:1 Even Exchange'), and Action delete trash icon."
* **Box 11 [Step 4: Quantity Stepper (1:1 Even Exchange)]**: "Centered `[- 1 +]` stepper enforcing strict 1:1 replacement limit alongside '1 unit (1:1 Even Exchange)' badge."
* **Box 12 [Replacement Reason Dropdown]**: "Mandatory reason classification: 'Wrong size', 'Damaged item', 'Defective item', 'Wrong item received', or 'Others'."
* **Box 13 [Step 5: Add Selected Item & Finalize Replacement Action Buttons]**: "Two-tier submission controls:
  - **Add Selected Item**: Queues the configured exchange into the replacement register.
  - **Finalize Replacement (X items)**: Prominent golden button committing stock deductions, logging warehouse movements, and completing the transaction."

#### STEPS
1. In the Replacement Management dashboard, click **+ Process Replacement**.
2. **Step 1 — Validate Receipt**:
   - In the receipt input field, scan the receipt barcode, click **Scan Camera** to scan the QR code via webcam, or type the receipt number (e.g., `RCP-059`) and click **Verify**.
   - The system checks the transaction timestamp against the store's 7-day return policy and loads the order items.
3. **Capture Receipt Proof**:
   - Click **Upload Receipt** to snap a photo with the counter camera or upload an image file. The receipt image is stored in encrypted Supabase Cloud Storage.
4. **Set Warehouse Routing**:
   - In **Replaced Item Inventory Action**, select **Defective / Not Sellable** (for broken soles or tears) or **Back to Stock (Restock)** (for unworn size exchanges).
5. **Step 2 — Select Replaced Product**:
   - In the purchased products table, locate the returned shoe and click **Select**.
6. **Step 3 — Choose Replacement Variant**:
   - Click **Choose Size / Variant** to open available sizes and colors of the same shoe model. Select an available in-stock EU size (e.g., Size 42).
7. **Step 4 — Quantity & Reason**:
   - Ensure the quantity is set using the **Quantity Stepper** (`1 unit`).
   - Open the **Reason \*** dropdown and select the reason for return (e.g., *Wrong size* or *Defective item*).
8. **Step 5 — Queue & Finalize**:
   - Click **Add Selected Item** to add the line to the **Replacement Queue**.
   - Review the **Current Selection** cards at the top of the modal to ensure all details match.
   - Click the golden **Finalize Replacement** button.
   - The system executes the atomic inventory swap (deducting the replacement shoe and routing the returned unit), updates sales records, and confirms: *"Replacement processed successfully!"*

---

### Section 2.23.1: Live Camera Receipt QR Code Scanner Modal
#### Screen Description
Triggered by clicking the "Scan Camera" button in Step 1 of the Process Item Replacement modal. Opens a full-featured camera viewfinder modal with automated hardware camera stream initialization, targeting corner reticles, an animated laser scanning beam, focus distance tips, optical digital zoom toggles (1x, 1.5x, 2x), and a manual receipt number verification fallback.

#### Screenshot Callout Labels
* **Box 1 [Scanner Modal Header]**: "Modal title 'Scan Receipt QR Code' with yellow QR icon, subtitle instructions, and dismiss button (X)."
* **Box 2 [Webcam Focus Tip Guidance Banner]**: "Amber callout banner: 'Hold receipt 20–30 cm (8–12 inches) away so it stays in sharp focus. If the QR code looks small, use the 1.5x / 2x Zoom buttons below.'"
* **Box 3 [Live Camera Viewfinder Frame]**: "High-framerate video stream container with glowing yellow targeting corner reticles framing the scanning zone."
* **Box 4 [Animated Laser Scanning Beam]**: "Horizontal yellow animated scanning line tracking across the viewfinder to guide receipt QR code alignment."
* **Box 5 [Digital Zoom Control Toolbar]**: "Three magnification buttons ('ZOOM: 1x, 1.5x, 2x') allowing cashiers to zoom in on smaller printed thermal QR codes without moving the receipt closer."
* **Box 6 [Manual Receipt Number Verification Fallback]**: "Text field ('e.g. RCP-20260918-9374 or 9374') and golden 'Verify' button to type the receipt number directly if the QR code is smudged or creased."
* **Box 7 [Upload Receipt Photo Instead Button]**: "Alternative button to select a pre-captured photo of the receipt from the local workstation."
* **Box 8 [Cancel Dismiss Button]**: "Closes the camera scanner modal and returns to the Process Item Replacement dialog."

#### STEPS
1. In Step 1 of the Process Item Replacement modal, click **Scan Camera**.
2. When prompted by your web browser, allow camera access (pre-configured via system Permissions-Policy `camera=(self)`).
3. The live webcam feed activates inside the targeting reticle **(Box 3)** with the animated laser scanning line **(Box 4)**.
4. Hold the customer's printed thermal receipt approximately **20–30 cm (8–12 inches)** in front of the lens.
5. If the QR code appears too small or blurry on screen:
   - Click the **1.5x** or **2x** button in the **ZOOM** toolbar **(Box 5)** to enlarge the image digitally.
6. Center the QR code within the yellow corner brackets. The scanner automatically detects and decodes the QR token in real time.
7. Upon successful scan, an audio confirmation chime sounds, the modal closes automatically, and the receipt number is instantly populated and validated in Step 1.
8. *Fallback Options*:
   - If the receipt QR code is torn, stained, or unreadable, type the numeric receipt digits into the **Manual Input** field **(Box 6)** and click **Verify**.
   - Or click **Upload Receipt Photo Instead (Box 7)** to upload an image from disk.
   - Click **Cancel (Box 8)** at any time to return to the previous screen.

---

### Section 2.24: Claim Inspection, Receipt Proof & Manager Approval Modal
#### Screen Description
Opens when an Administrator clicks Review Claim on any pending claim ticket in /admin/returns. Used to evaluate cashier intake evidence and grant final approval.

#### Screenshot Callout Labels
* **Box 1 [Claim Dossier Header]**: "Displays Claim Ticket ID, Customer Name, Contact Number, Original Receipt Number, and Purchase Date."
* **Box 2 [Receipt Proof Image Viewer]**: "High-resolution preview of the uploaded original purchase receipt with zoom controls."
* **Box 3 [Defect Photo Evidence Viewer]**: "Visual inspection photo of the physical shoe defect uploaded during cashier intake."
* **Box 4 [Warehouse Disposition Selector]**: "Choose fate of defective pair: 'Return to Manufacturer (RTV)', 'Scrap / Write-off', or 'Restock to Inventory' (sizing exchanges)."
* **Box 5 [Approval Remarks Field]**: "Document administrative authorization notes or justification for rejection."
* **Box 6 [Approve Replacement Button]**: "Green button authorizing immediate release of replacement footwear to the customer."
* **Box 7 [Reject Claim Button]**: "Red button denying claim (e.g., customer wear-and-tear or missing box) with official explanation notice."

#### STEPS
1. In the **Pending Claims** table, click **Review Claim**.
2. Inspect the **Receipt Proof** image to confirm original purchase authenticity.
3. Review the **Defect Photo Evidence** to verify whether the flaw qualifies under manufacturing warranty.
4. In the **Warehouse Disposition** selector, choose **Return to Manufacturer** or **Scrap Write-off**.
5. Click **Approve Replacement**. The system logs approval, deducts the replacement shoe from active stock, logs the defective pair to scrap, and notifies the cashier.

---

### Section 2.25: Predictive Analytics & Sales Demand Forecasting
#### Screen Description
The Predictive Analytics module utilizes an advanced **Blended Statistical Ensemble Model** combining Weighted Moving Average (50%), Linear Trend Projection (30%), and Simple Moving Average (20%) with an 85% safety floor to forecast 7-day and 30-day footwear sales demand, establish low/high scenario confidence spreads, classify fast versus slow-moving inventory, and generate automated replenishment suggestions.

#### Screenshot Callout Labels
* **Box 1 [Forecast Horizon Selector]**: "Toggle between 7-Day Short-Term and 30-Day Monthly predictive demand models."
* **Box 2 [Sales Demand Forecast Chart & Scenario Bands]**: "Visual trend graph displaying historical sales alongside projected baseline units, framed by -15% Low Scenario and +25% High Scenario confidence spreads."
* **Box 3 [Ensemble Confidence Metric & Formula Card]**: "Displays dynamic model confidence (75%–92%) computed from data variance, volume, and trend stability, underpinned by the 50% WMA + 30% Trend + 20% SMA ensemble formula."
* **Box 4 [Fast-Moving Footwear Leaderboard]**: "Ranks styles with highest inventory turnover velocity and quickest days-to-stockout."
* **Box 5 [Slow-Moving Inventory Alert Panel]**: "Identifies low-turnover footwear tying up capital, recommending targeted discount promotions."
* **Box 6 [Automated Reorder Suggestions Table]**: "Displays system-calculated purchase order quantities based on sales velocity, lead times, and an 85% SMA safety floor."
* **Box 7 [Export Restock Plan Button]**: "Exports predictive sales data and restocking purchase orders to CSV or printable format."

#### STEPS
1. Click **Analytics** in the left navigation sidebar (or navigate to `http://localhost:5173/analytics`).
2. Select your desired forecast horizon (**7-Day** or **30-Day** forecast) **(Box 1)**.
3. Review the **Sales Demand Forecast** graph **(Box 2)**:
   - The central trend line indicates projected baseline units calculated via the blended ensemble:
     $$\text{Baseline} = (0.50 \times \text{WMA}) + (0.30 \times \text{Linear Trend}) + (0.20 \times \text{SMA})$$
   - Observe the shaded area representing the **Low Scenario (-15%)** and **High Scenario (+25%)** planning corridors.
4. Verify the **Forecast Confidence Score (Box 3)** to understand prediction reliability based on historical transaction frequency.
5. Inspect the **Fast-Moving Leaderboard (Box 4)** to spot top-selling shoe styles before they run out of stock.
6. Consult the **Automated Reorder Suggestions Table (Box 6)** to review suggested restocking quantities (protected by an 85% SMA safety floor to prevent under-ordering during fluctuating sales cycles).
7. Click **Export Restock Plan (Box 7)** to generate an official procurement worksheet for footwear vendors.

---

### Section 2.26: Targeted Promotions Management Ledger
#### Screen Description
The Promotions Management module enables administrators to design percentage discounts, create Buy-One-Get-One (BOGO) combo deals, browse active/scheduled campaigns with interactive table pagination, and broadcast automated promotional newsletters to targeted customer segments using Brevo / Gmail API integration.

#### Screenshot Callout Labels
* **Box 1 [Create Campaign Button]**: "Opens the promotion campaign builder wizard."
* **Box 2 [Active Promotions Register]**: "Table listing Campaign Name, Type, Discount Value, Date Range, Status (Active/Scheduled/Expired), and Actions."
* **Box 3 [Send Email Blast Action Button]**: "Launches the targeted customer email broadcaster modal."
* **Box 4 [Edit / Deactivate Campaign Buttons]**: "Modify active campaign parameters or pause discount rules."
* **Box 5 [Status Filter Dropdown]**: "Filter promotions by state: 'All Status', 'Active', 'Scheduled', or 'Expired'."
* **Box 6 [Table Pagination Bar]**: "Standardized pagination controls (10, 15, 25, 50 campaigns/page) with record counters and page jump navigation."

#### STEPS
1. Click **Promotions** in the left navigation sidebar (or navigate to `http://localhost:5173/promotions`).
2. Filter the campaign list using the **Status Filter (Box 5)** to focus on active or scheduled promotions.
3. Navigate across pages using the **Table Pagination Bar (Box 6)**.
4. Click **Create Campaign (Box 1)** to design a new discount promotion or BOGO offer.
5. Click **Send Email Blast (Box 3)** on an active campaign to dispatch marketing flyers to registered customers.
6. Use **Edit / Deactivate (Box 4)** to adjust discount parameters or deactivate expired promotions.

---

### Section 2.27: Create / Edit Promotional Campaign Modal (BOGO & % Off)
#### Screen Description
Opens by clicking the golden Create Campaign button. Configures new discount algorithms and BOGO rules across POS registers.

#### Screenshot Callout Labels
* **Box 1 [Promotion Name & Promo Code Inputs]**: "Campaign title (e.g., 'Summer Running Shoe Sale') and alphanumeric coupon code."
* **Box 2 [Discount Type Selector]**: "Choose structure: Percentage Discount (e.g., 20% Off), Fixed Amount (₱500 Off), or Buy-One-Get-One (BOGO)."
* **Box 3 [Discount Value Field]**: "Enter numerical percentage or peso deduction amount."
* **Box 4 [Qualifying Categories & Shoe Models]**: "Select which footwear categories (e.g., Running Shoes) or specific shoe brands qualify for the deal."
* **Box 5 [Campaign Schedule Date Pickers]**: "Set start date, end date, and optional flash sale active hours."
* **Box 6 [Save Campaign Button]**: "Activates the promotion rules immediately across all counter POS terminals."

#### STEPS
1. In the Promotions module, click **Create Campaign**.
2. Enter the **Campaign Title** and optional **Promo Code**.
3. Select **Percentage**, **Fixed**, or **BOGO** as the discount mechanism.
4. Specify the qualifying footwear categories (e.g., check *Basketball* and *Running*).
5. Set the active **Start** and **End Dates**.
6. Click **Save Campaign**. The discount is immediately active on POS registers.

---

### Section 2.28: Automated Marketing Email Blast & Dispatcher Modal
#### Screen Description
Opens by clicking Send Email Blast on an active promotional campaign. Dispatches targeted HTML marketing newsletters directly to registered customer email inboxes.

#### Screenshot Callout Labels
* **Box 1 [Audience Segmentation Selector]**: "Filter recipients: 'All Registered Shoppers', 'VIP High Spenders', or 'Shoppers Interested in Category'."
* **Box 2 [Target Recipient Counter]**: "Displays real-time count of eligible customer email inboxes matching the filter."
* **Box 3 [Email Subject Line Input]**: "Subject header visible in customer inbox (e.g., 'Exclusive 20% Off All Nike Running Shoes at Meryl Shoes!')."
* **Box 4 [Promotional Banner Image URL / Upload]**: "Attach marketing graphics or promotional flyer imagery."
* **Box 5 [Live HTML Email Preview Pane]**: "WYSIWYG preview showing exactly how the email will render on desktop and mobile inboxes."
* **Box 6 [Send Promotional Blast Button]**: "Executes automated email delivery via Brevo / Gmail API and logs delivery metrics."

#### STEPS
1. Locate the active promotion and click **Send Email Blast**.
2. Select your **Target Audience** (e.g., select *Shoppers with preferred category: Running*).
3. Verify the computed recipient count on screen.
4. Input an engaging **Email Subject Line**.
5. Review the **Live Email Preview** pane to verify formatting and discount details.
6. Click **Send Promotional Blast**. The system sends personalized promotional emails and confirms: *"Successfully dispatched X promotional emails!"*

---

### Section 2.29: Business Intelligence Reports & Document Export (PDF / CSV)
#### Screen Description
The Reports & Analytics module compiles financial statements, sales registers, cashier shift summaries, category breakdowns, and inventory valuation reports into formal executive PDF documents and raw CSV spreadsheet files. It includes flexible Date Range controls (Daily, Weekly, Monthly, Quarterly, Annually, and Custom Range with From/To calendar date pickers) allowing staff to audit any arbitrary historic timeframe.

#### Screenshot Callout Labels
* **Box 1 [Date Range Dropdown Selector]**: "Select period: Daily, Weekly, Monthly, Quarterly, Annually, or Custom Range."
* **Box 2 [From Date & To Date Calendar Pickers]**: "Active when Custom Range is selected; allows typing or selecting exact start and end dates (e.g., Jan 1–31, 2020)."
* **Box 3 [Report Type Dropdown Selector]**: "Select report view: Overview Report, Sales Report, Revenue Report, or Inventory Report."
* **Box 4 [Compare Previous Period Checkbox]**: "Toggles comparative delta indicators showing percentage growth or contraction versus the preceding period."
* **Box 5 [Export PDF Button]**: "Generates a formal, printable PDF document complete with store branding, charts, and audit tables."
* **Box 6 [Export CSV Button]**: "Downloads raw database rows into Excel-compatible CSV format for external accounting."

#### STEPS
1. Click **Reports** in the left navigation sidebar.
2. In the **Date Range** dropdown, choose your desired timeframe (e.g., *Daily*, *Monthly*, or *Custom Range*).
3. If **Custom Range** is chosen, select the **From Date** and **To Date** (e.g., `2020-01-01` to `2020-01-31`).
4. Select the **Report Type** (e.g., *Overview Report*, *Sales Report*, *Revenue Report*, or *Inventory Report*).
5. Review the updated KPI summary cards and performance graphs on screen.
6. Click **Export PDF** for a printable executive document or **Export CSV** for spreadsheet auditing.

---

### Section 2.30: User Account Management (RBAC) & Security Administration
#### Screen Description
The User Management module gives administrators full control over employee accounts, role-based access assignments, account status toggles, and security lockout unlocks.

#### Screenshot Callout Labels
* **Box 1 [Add New User Button]**: "Opens the employee registration form to create a new staff profile."
* **Box 2 [Staff Summary Table]**: "Lists Full Name, Username, Email, Assigned Role (Admin, Sales, Inventory), and Account Status (Active/Locked)."
* **Box 3 [Edit User Button]**: "Allows updating employee contact details or assigned role permissions."
* **Box 4 [Unlock Account Button]**: "Instantly clears failed login attempts and unlocks staff members who triggered the 5-attempt lockout."
* **Box 5 [Reset Password Button]**: "Opens the administrative password overwrite dialog to issue fresh credentials."

#### STEPS
1. Click **Users** in the left navigation sidebar.
2. Review employee accounts and active access statuses.
3. Click **Add User** to provision new personnel.
4. Click **Unlock** on any account displaying a locked status badge to restore immediate login access.

---

### Section 2.31: Add New Staff Account & Role Provisioning Modal
#### Screen Description
Opens by clicking the golden Add User button. Provisions an authorized store employee account with role-based permissions.

#### Screenshot Callout Labels
* **Box 1 [Full Name & Employee Code]**: "Employee's real name and company staff badge code (e.g., MS-STF-014)."
* **Box 2 [Username & Corporate Email]**: "Unique login handle and verified staff email for password recovery."
* **Box 3 [Role Assignment Dropdown]**: "Assign role: Administrator, Sales Staff / Cashier, or Inventory Custodian."
* **Box 4 [Temporary Password Field]**: "Set initial temporary password; employee will be prompted to update upon first login."
* **Box 5 [Create Account Button]**: "Commits new user to database and generates security audit trail entry."

#### STEPS
1. Click **Users** in the admin sidebar.
2. Click **Add User** at the top right.
3. Fill in the employee's **Full Name**, **Username**, and **Email**.
4. Select their assigned role from the dropdown (**Sales Staff** or **Inventory Staff**).
5. Enter an initial temporary password.
6. Click **Create Account**. Provide the login credentials to the employee.

---

### Section 2.32: Edit Staff Profile & Status Toggle Modal
#### Screen Description
Opens when clicking Edit on an employee row. Updates employee contact info or revokes system access upon resignation.

#### Screenshot Callout Labels
* **Box 1 [Employee Information Fields]**: "Editable fields for Full Name, Email, and Staff Code."
* **Box 2 [Role Reassignment Dropdown]**: "Modify permissions (e.g., promoting Sales Staff to Administrator)."
* **Box 3 [Account Status Toggle (Active / Inactive)]**: "Switch to immediately disable an employee account without deleting historical audit records."
* **Box 4 [Save Changes Button]**: "Commits profile updates to the database."

#### STEPS
1. In the Users table, click the **Edit** pencil icon next to the employee's name.
2. Modify details or reassign the role if necessary.
3. To suspend a former employee, toggle the status switch from **Active** to **Inactive**.
4. Click **Save Changes**. Inactive users are blocked from logging in immediately.

---

### Section 2.33: Administrative Employee Password Reset Modal
#### Screen Description
Opens when clicking Reset Password on a staff account. Allows administrators to issue fresh credentials to locked out or forgetful employees.

#### Screenshot Callout Labels
* **Box 1 [Staff Name Header]**: "Identifies the specific employee account undergoing credential reset."
* **Box 2 [New Password Input Field]**: "Input new secret password (minimum 8 characters)."
* **Box 3 [Confirm Password Field]**: "Re-type password to verify character matching."
* **Box 4 [Commit Password Reset Button]**: "Overwrites password hash in database and clears all failed login lockout counters."

#### STEPS
1. Locate the employee account in the User Management table.
2. Click **Reset Password**.
3. Enter the new temporary password twice.
4. Click **Commit Reset**. The password is updated and any active lockouts on the account are automatically cleared.

---

### Section 2.34: System Security & Activity Audit Trail Inspector
#### Screen Description
The Security & Audit Log module provides a tamper-evident, chronological trail of all critical system actions, failed logins, manager overrides, inventory adjustments, and price modifications. Backed by PostgreSQL Row-Level Security (RLS) policies and pgcrypto AES-256 field-level encryption for sensitive customer and transaction data, the audit trail ensures compliance with enterprise data privacy standards.

#### Screenshot Callout Labels
* **Box 1 [Security Event Filter Bar]**: "Filter logs by Event Type (Logins, Failed Attempts, Price Overrides, Order Voids), User, or Date."
* **Box 2 [Timestamp & IP Address Column]**: "Shows the exact date, time, and workstation IP address of the logged activity."
* **Box 3 [User & Role Identifier]**: "Identifies the specific employee username and role responsible for the event."
* **Box 4 [Action Details & Diff Inspector]**: "Displays before-and-after values for price changes or reason notes for voided transactions."
* **Box 5 [Security Export Button]**: "Exports the compliance audit trail for official IT governance reviews."

#### STEPS
1. Click **Security & Audit** in the navigation sidebar.
2. Review the chronological log table to inspect store activities.
3. To investigate suspicious activity, select **Failed Login Attempts** from the event filter.
4. Click any log entry to view full metadata, including payload data and timestamp details.

---

### Section 2.35: User Profile Customization & Avatar Upload Modal
#### Screen Description
Accessible across all portals by clicking your avatar or Profile & Settings in the bottom-left sidebar or top-right user menu. Allows users to upload profile pictures, update display names, and change passwords using email OTP verification. Profile images are uploaded directly to the Supabase Cloud Storage `user-avatars` bucket with public CDN delivery, client-side auto-downscaling to 512×512, IndexedDB persistence, and zero plaintext data in localStorage.

#### Screenshot Callout Labels
* **Box 1 [Settings Tabs (My Profile / Security & Credentials)]**: "Switch between personal profile details and password security."
* **Box 2 [Current Avatar Preview & Initial Fallback]**: "Displays active profile photo; falls back to a sleek colored circle with the user's initial if no photo is set."
* **Box 3 [Upload Photo Button & Auto-Downscaler]**: "Upload image from computer (PNG, JPG, WEBP); automatically resizes and compresses to 512×512 WebP/JPEG, streaming directly to Supabase Cloud Storage."
* **Box 4 [Remove Photo Button]**: "Clears uploaded picture and restores the default initial badge."
* **Box 5 [Display Name & Email Fields]**: "Update your profile full name and registered contact email address."
* **Box 6 [Save Changes Button (Cloud Storage Sync)]**: "Commits updates to Supabase Cloud Storage, database `avatar_url`, and IndexedDB with zero plaintext in `localStorage`, guaranteeing avatar persistence across all devices and sessions."
* **Box 7 [Security Tab: Request OTP & Reset Password]**: "Request a 6 to 8-digit OTP sent to your email to authorize self-service password updates with live countdown and 60s cooldown."

#### STEPS
1. Click your user avatar or **Profile & Settings** in the sidebar.
2. In the **My Profile** tab:
   - Click **Upload Photo** and select an image from your computer. The system automatically optimizes and downscales the photo to 512×512 and uploads it to Supabase Cloud Storage.
   - Edit your **Full Name** or **Email Address** if needed.
   - Click **Save Changes**. Your new profile picture appears instantly across top bars, sidebars, and persists across browser tab closes, refreshes, and multi-device sessions.
3. In the **Security & Credentials** tab:
   - Click **Send Verification Code** to dispatch an OTP to your email.
   - Enter the 6 to 8-digit code received.
   - Input your **New Password** and click **Update Password**.

---

# PART III: SALES STAFF / CASHIER PORTAL (/sales)

---

### Section 3.1: Frontline Cashier POS Terminal Overview
#### Screen Description
The Sales Staff layout provides cashiers with a high-speed, streamlined Point of Sale terminal optimized for barcode scanning, quick size selection, automated cashier identity UUID verification (preventing database type mismatches), and responsive customer checkout.

#### Screenshot Callout Labels
* **Box 1 [Cashier Navigation Sidebar]**: "Simplified menu containing Point of Sale, Sales History, Replacement, Customers, and Profile."
* **Box 2 [Active Cashier Banner & Shift Status]**: "Displays authenticated cashier display name, active station ID, verified Supabase UUID session tag, and live date/time."
* **Box 3 [Quick Search / Barcode Input Field]**: "Receives direct laser scanner inputs or keyboard product lookups."
* **Box 4 [Footwear Selection Grid]**: "Visual product cards displaying available shoe models, brand tags, and retail prices."
* **Box 5 [Cart Summary Sidebar]**: "Real-time checkout cart displaying items, sizes, quantities, discount tags, and subtotal."

#### STEPS
1. Sign in with your cashier credentials (`sales`). The system automatically validates your session and launches the **Point of Sale** terminal (`http://localhost:5173/pos`).
2. Verify that your cashier name appears in the top status banner **(Box 2)**.
3. Keep the cursor focused in the barcode search field **(Box 3)**, ready to scan shoebox barcodes.

---

### Section 3.2: Barcode Scanning, Sizing Modal & Add to Cart Flow
#### Screen Description
This workflow demonstrates how a cashier searches or scans footwear, interacts with the Size Selector Modal, checks real-time inventory counts, and adds items to the active cart.

#### Screenshot Callout Labels
* **Box 1 [Shoebox Barcode Scan Action]**: "Point laser scanner at shoebox barcode label; item is automatically recognized."
* **Box 2 [Product Search & Sizing Modal]**: "Pop-up modal displaying available EU sizes (36–46) with color-coded stock badges: Green (>5 in stock), Amber (Low stock ≤5), Red (Out of stock)."
* **Box 3 [Quantity Counter (- / +)]**: "Quick buttons to adjust number of pairs before adding to cart."
* **Box 4 [Add to Cart Confirmation Button]**: "Commits item to active checkout cart."
* **Box 5 [Cart Line Voiding (Trash Icon)]**: "Allows cashiers to immediately remove an erroneous line item."

#### STEPS
1. Scan the barcode on the shoebox using the laser scanner, or click **Browse** to open the product catalog modal.
2. In the **Select Size** section, click the customer's desired shoe size (e.g., *Size 41*).
3. Observe the stock indicator badge to verify availability.
4. Set the quantity using the **- / +** buttons.
5. Click **Add to Cart**.
6. The shoe appears in the right-hand **Shopping Cart** with its unit price and computed subtotal.
7. If the customer changes their mind, click the red **Trash/Void** icon on that cart line to remove it.

---

### Section 3.3: Customer Lookup, Tender Calculation, BOGO Promotions & Thermal Receipt
#### Screen Description
The checkout completion workflow calculates active discounts and Buy-One-Get-One (BOGO) promotions, computes cash tender and change, validates the cashier's authentic database UUID to ensure flawless PostgreSQL transaction logging, and triggers official receipt printing.

#### Screenshot Callout Labels
* **Box 1 [Auto-Applied BOGO / Promo Discount Banner]**: "Shows automatic discounts or BOGO savings applied to the total order."
* **Box 2 [Net Total Amount Due]**: "Displays the final balance due after subtracting all promotional discounts."
* **Box 3 [Cash Tendered Input Field]**: "Cashier types the physical cash received from the customer."
* **Box 4 [Change Due Display]**: "Large green numerical indicator showing exact change to return to the customer."
* **Box 5 [Complete Checkout Button]**: "Finalizes sale via atomic transaction, updates warehouse balances, and opens the Official Thermal Receipt modal."
* **Box 6 [Official Thermal Receipt Modal]**: "Modal rendering the formal 58mm/80mm receipt with cashier name, tax breakdown, 7-day warranty policy, and barcode."

#### STEPS
1. Verify the order items in the cart. Notice that qualifying BOGO or percentage deals are automatically deducted.
2. If attaching a customer loyalty profile, use the customer lookup bar or quick-enroll a walk-in shopper.
3. Announce the **Total Amount Due** to the customer.
4. Select payment tender:
   - For **Cash**: Enter the amount handed over into the **Amount Tendered** field.
   - For **GCash**: Enter the 13-digit transaction reference number.
5. Confirm the **Change Due** calculated by the system and hand the physical change to the customer.
6. Click **Complete Payment & Checkout**.
   - *Behind the Scenes*: The system verifies the cashier's active session UUID (guaranteeing clean transaction recording without UUID parsing errors), atomically deducts inventory balances, and generates an official sales record.
7. In the receipt preview modal, click **Print Receipt** to output the thermal receipt to the customer's printer. Click **Close** to reset the register for the next transaction.

---

### Section 3.4: Cashier Daily Shift Sales Journal & Duplicate Receipt Reprinting
#### Screen Description
The Daily Sales History page allows cashiers to inspect sales completed during their active shift and re-print receipts for customers who lost their original copies.

#### Screenshot Callout Labels
* **Box 1 [Shift Sales Register Table]**: "Chronological register of all sales completed by the cashier during the current shift."
* **Box 2 [Receipt Lookup Input]**: "Search bar to locate transactions by receipt number (e.g., OR-2026-0089)."
* **Box 3 [Shift Total Cash Summary Card]**: "Running total of gross cash collected in the drawer during the cashier's active shift."
* **Box 4 [Reprint Duplicate Receipt Button]**: "Re-opens the print dialog to issue an official duplicate customer receipt."

#### STEPS
1. Click **Sales History** in the left sidebar menu.
2. To find a previous transaction, type the receipt number into the search bar.
3. Review the order items to confirm the transaction with the customer.
4. Click the blue **Reprint** button to print an official duplicate receipt.
5. At shift close, review the **Shift Total Cash** card to balance physical cash in the register drawer.

---

### Section 3.5: Customer Replacement & Warranty Claim Intake Modal
#### Screen Description
The Replacement Intake module enables cashiers to record defective shoe returns from customers, check 7-day receipt validity, and issue an intake voucher for administrative approval.

#### Screenshot Callout Labels
* **Box 1 [Process Replacement Button]**: "Opens the structured 5-step return intake modal."
* **Box 2 [Receipt Number & 7-Day Policy Check]**: "Input to validate purchase date against 7-day warranty period."
* **Box 3 [Defect Reason Dropdown & Notes]**: "Select defect: Sole Detachment, Broken Stitching, Upper Material Tear, or Sizing Exchange."
* **Box 4 [Defect Photo & Receipt Camera Capture / Cloud Upload]**: "Snap live proof directly with the counter camera (enabled via Permissions-Policy) or upload an image file, stored in encrypted Supabase Storage."
* **Box 5 [Replacement Footwear Selection]**: "Choose the requested replacement style and size."
* **Box 6 [Submit Claim & Print Voucher Button]**: "Submits claim to the Admin approval queue and prints an intake voucher for the customer."

#### STEPS
1. Click **Replacement** in the sidebar menu and click **Process Replacement**.
2. Input the **Original Receipt Number** provided by the customer and verify that the 7-day warranty badge is green.
3. Select the returned shoe from the receipt items.
4. Choose the **Defect Category**, record notes, and capture defect and receipt photo proof using the counter camera.
5. Select the replacement shoe and size.
6. Click **Submit Replacement Claim**. Hand the printed voucher slip to the customer and inform them that the supervisor will finalize the approval.

---

### Section 3.6: Fast Counter Walk-In Customer Enrollment Modal
#### Screen Description
The Customer Directory enables frontline cashiers to quickly search returning customers by mobile number or enroll new walk-in customers to link transactions to promotional campaigns.

#### Screenshot Callout Labels
* **Box 1 [Phone Number Search Bar]**: "Fast lookup using customer mobile phone numbers."
* **Box 2 [Quick Add Customer Button (+)]**: "Opens a compact registration form designed for fast counter data entry."
* **Box 3 [Customer Full Name & Mobile Fields]**: "Required fields to register customer identity and SMS/email contact."
* **Box 4 [Save & Attach to Sale Button]**: "Saves the profile and automatically associates the customer with the active cart."

#### STEPS
1. While on POS or the Customers tab, click **+ Add Customer**.
2. Ask the customer for their **Full Name** and **Mobile Number**.
3. Input their information into the modal fields.
4. Click **Save & Attach**. The customer's profile is saved, making them eligible for store loyalty promotions and targeted newsletter discounts.

---

### Section 3.7: Cashier Profile Customization & Station Logout
#### Screen Description
Allows cashiers to customize their profile avatar, update account credentials, and safely sign out to secure the terminal drawer at shift conclusion.

#### Screenshot Callout Labels
* **Box 1 [Cashier Profile Card & Avatar]**: "Displays active profile photo and cashier username."
* **Box 2 [Profile & Settings Modal Trigger]**: "Opens the profile customization and password reset modal."
* **Box 3 [Sign Out Button]**: "Red button at the bottom of the sidebar to immediately terminate the session and lock the counter terminal."

#### STEPS
1. At the conclusion of your shift, click **Profile & Settings** to verify profile details.
2. Click the red **Sign Out** button.
3. The system clears session credentials and returns to the main login screen, securing the POS counter against unauthorized access.

---

# PART IV: INVENTORY STAFF PORTAL (/inventory)

---

### Section 4.1: Product List – Warehouse Footwear Catalog Browser
#### Screen Description
Allows inventory custodians to inspect footwear stock levels, view style colorways, and check real-time availability across all size compartments from the Product List view.

#### Screenshot Callout Labels
* **Box 1 [Warehouse Catalog Search & Filter]**: "Filter shoes by Brand, Category, or EU Size availability."
* **Box 2 [Footwear Thumbnail & Model Card]**: "Displays shoe image, style code, category, and total stockroom quantity."
* **Box 3 [Per-Size Availability Grid]**: "Breakdown showing remaining pairs for each size from EU 36 to EU 46."
* **Box 4 [Low Stock Warning Indicator]**: "Amber warning tag highlighting shoes that have reached the safety threshold."

#### STEPS
1. Log in with your inventory custodian credentials. The system opens the Product List catalog.
2. Filter the catalog by brand or model name to find the footwear item to inspect.
3. Click on any footwear card to view the exact physical quantities stored across each size compartment.

---

### Section 4.2: New Shipment Intake & Size Matrix Encoding Modal
#### Screen Description
Allows inventory staff to encode incoming footwear shipments, associate supplier delivery invoices, and configure size matrices.

#### Screenshot Callout Labels
* **Box 1 [New Shipment Intake Button]**: "Opens the shipment encoding modal form."
* **Box 2 [Supplier Invoice # & Delivery Date]**: "Input fields for supplier document tracking."
* **Box 3 [Footwear Model & Size Selection Grid]**: "Assign incoming quantities to specific shoe sizes (36–46)."
* **Box 4 [Barcode Label Tagging]**: "Assigns or validates scannable barcode SKU tags for shoeboxes."
* **Box 5 [Commit Shipment Intake Button]**: "Commits incoming boxes into inventory and generates a stock-in ledger record."

#### STEPS
1. Click **Product Settings** in the left navigation sidebar.
2. Click **New Shipment Intake**.
3. Enter the **Supplier Invoice Number** and select the delivery date.
4. Select the footwear model delivered, and type the received quantity beside each respective size box (e.g., *Size 40: 12 pairs, Size 41: 18 pairs*).
5. Click **Commit Shipment**. The stockroom levels update immediately, and a delivery intake entry is logged.

---

### Section 4.3: Stockroom Physical Inventory Monitoring & Adjustments Modal
#### Screen Description
Enables stock clerks to balance physical shelf counts against database figures and execute authorized count adjustments.

#### Screenshot Callout Labels
* **Box 1 [Stockroom Inventory Table]**: "Lists Footwear Model, Size, Current Shelf Count, and Status."
* **Box 2 [Physical Audit Count Field]**: "Allows clerks to enter verified shelf count numbers during routine audits."
* **Box 3 [Adjustment Reason Dropdown]**: "Select reason: Delivery Intake, Stocktake Adjustment, or Damaged Write-off."
* **Box 4 [Update Stock Count Button]**: "Saves reconciled stock quantity and creates an audit entry."

#### STEPS
1. Click **Inventory** in the sidebar.
2. Locate the specific shoe model and size variant being audited.
3. If a count discrepancy is found between physical boxes and the system, click **Adjust Count**.
4. Enter the actual physical count, choose the adjustment reason, and add explanatory remarks.
5. Click **Save Adjustment**. The database updates and logs the clerk's username and timestamp.

---

### Section 4.4: Warehouse Stock Movement Logs (Deliveries, Transfers & Scrap)
#### Screen Description
Provides a dedicated warehouse ledger tracking supplier deliveries, backroom-to-storefront replenishment transfers, and damaged scrap write-offs.

#### Screenshot Callout Labels
* **Box 1 [Movement Category Filter]**: "Filter by Supplier Delivery, Storefront Replenishment, or Damaged Scrap."
* **Box 2 [Chronological Log Table]**: "Shows Date/Time, Shoe Model, Size, Quantity (+/-), and Custodian Name."
* **Box 3 [Delivery Invoice / Scrap Reason Reference]**: "Displays reference document tracking numbers."
* **Box 4 [Export Log Button]**: "Downloads warehouse movement history in CSV format."

#### STEPS
1. Click **Inventory Log** in the sidebar.
2. Review the chronological records to confirm that recent shipments have been posted.
3. Select **Damaged Scrap** from the filter to verify that returned or damaged pairs have been isolated from active stock.
4. Click **Export CSV** to produce the official monthly stock movement report for store management.

---

### Section 4.5: Stock Custodian Profile & Station Logout
#### Screen Description
Allows inventory custodians to update their account credentials and log out of the warehouse workstation at the end of their shift.

#### Screenshot Callout Labels
* **Box 1 [Profile & Settings Modal Trigger]**: "Opens custodian profile management form."
* **Box 2 [Password Update Section]**: "Fields to set and confirm new password."
* **Box 3 [Sign Out Button]**: "Logs out user and locks warehouse workstation."

#### STEPS
1. Click **Profile & Settings** to update your account password if required.
2. At the end of your shift, click the red **Logout** button.
3. Confirm that the browser redirects to `/login` to ensure the warehouse terminal is secure.

