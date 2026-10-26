# Publishing & Payment Accounts Note

## 1. Google Chrome Web Store Developer Account
- **Console URL:** https://chrome.google.com/webstore/devconsole
- **Registered Email:** `damien.sawyer@daddigital.com`
- **Extension Name:** Bookmark Set Manager

## 2. ExtensionPay & Stripe Account ($10 USD License)
- **Dashboard URL:** https://extensionpay.com/home
- **Registered Email:** `support@daddigital.com`
- **ExtensionPay ID (`EXTPAY_ID`):** `bookmark-set-manager`
- **Price Plan:** $10.00 USD (One-time payment via Stripe)

> **Note:** Having different emails for ExtensionPay (`support@daddigital.com`) and the Google Chrome Web Store Developer Console (`damien.sawyer@daddigital.com`) is completely fine—they do not need to match for ExtensionPay or Chrome Web Store to work.

## 3. 1Password
- **Item:** `Bookmark Set Manager - Chrome Web Store` (vault `Employee`)
- **Fields:** `publisher_id`, `item_id`, `contact_email`, `developer_account`, `extensionpay_id`, optional `service_account`
- `bookmark-set-manager/publish.sh` reads these via `op read`; env vars `CWS_PUBLISHER_ID` / `CWS_ITEM_ID` / `CWS_SERVICE_ACCOUNT` override them.
