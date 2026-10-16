# Chrome Web Store Listing & Privacy Guide

All required files have been generated and prepared in this repository:
- **Extension Package:** [`mybookmarks.zip`](../mybookmarks.zip)
- **Store Icon (`128x128`):** [`icon128.png`](../icon128.png)
- **Store Screenshot (`1280x800`, 24-bit RGB PNG):** [`screenshot-1280x800.png`](./screenshot-1280x800.png)
- **Small Promo Tile (`440x280`, 24-bit RGB PNG):** [`promo-tile-440x280.png`](./promo-tile-440x280.png)

---

## Step 1: One-Time Dashboard Setup (2 Minutes)

1. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) and sign in with your Google Business account (requires a one-time $5 registration fee if not yet registered).
2. Click **+ New item** and upload [`mybookmarks.zip`](../mybookmarks.zip).

### Store Listing Tab (Copy & Paste)

- **Category:** `Productivity` → `Workflow & Planning`
- **Language:** `English`
- **Store Icon:** Upload [`icon128.png`](../icon128.png)
- **Screenshots:** Upload [`store-assets/screenshot-1280x800.png`](./screenshot-1280x800.png)
- **Small Promo Tile:** Upload [`store-assets/promo-tile-440x280.png`](./promo-tile-440x280.png)
- **Detailed Description:**
  ```text
  Bookmark Set Manager allows you to maintain multiple bookmark sets and switch your active Chrome Bookmarks Bar in a single click—with automatic two-way syncing.

  KEY FEATURES
  • Instant Context Switching: Click any folder from your "Other Bookmarks" to load it directly into your Bookmarks Bar (e.g., Work, Personal, Client Projects, Research).
  • Automatic Two-Way Syncing: Add, edit, rename, or reorganize bookmarks on your Bookmarks Bar as usual—your changes are automatically saved back to the active set when you switch.
  • Visual Active Indicator: Quickly see which bookmark set is currently active in the toolbar popup.
  • Cross-Device Stability: Uses native Chrome Bookmarks with lightweight GUID tracking so your sets sync seamlessly across all your signed-in Chrome browsers.
  • 100% Local & Private: All bookmarks and configuration stay strictly inside your browser's native Chrome Bookmarks. Zero external servers, zero analytics, and zero data collection.

  HOW TO USE
  1. Create folders for each of your contexts inside Chrome's "Other Bookmarks" folder.
  2. Click the Bookmark Set Manager icon in your Chrome toolbar.
  3. Unlock full access with a one-time $10 USD license via ExtensionPay (Stripe).
  4. Click any folder to make it your active Bookmarks Bar—when you switch to another folder, any changes made on your Bookmarks Bar are automatically saved back to the previous folder.
  ```

### Privacy Practices Tab (Copy & Paste)

- **Single Purpose Description:**
  ```text
  Allows users to switch between multiple bookmark sets by syncing folders from "Other Bookmarks" into the active Chrome Bookmarks Bar.
  ```
- **Permission Justification (`bookmarks`):**
  ```text
  Required to read bookmark folders in "Other Bookmarks" and copy/sync the selected bookmark set to and from the user's Bookmarks Bar. No bookmark data ever leaves the user's browser.
  ```
- **Permission Justification (`storage`):**
  ```text
  Required by ExtensionPay (ExtPay.js) to store and cache the user's license/payment status locally so the extension stays unlocked across browser sessions.
  ```
- **Host Permission Justification (`https://extensionpay.com/*`):**
  ```text
  Required by ExtensionPay (ExtPay.js) so the extension can detect when the user completes their $10 license purchase or logs in on extensionpay.com and immediately unlock the extension.
  ```
- **Are you using remote code?**
  - Select **No, I am not using Remote code** (`ExtPay.js` is bundled directly inside the extension package).
- **Data Usage:**
  - Check **Authentication information** (for ExtensionPay email/license verification) and **Financial and payment information** (handled externally by ExtensionPay / Stripe checkout).
  - Check the **three certification boxes** confirming compliance with the Developer Program Policies.

---

## Step 2: Automated CLI Publishing with `gcloud` (For Updates)

Once your item is created in the dashboard, you can publish all future updates from the terminal using [`publish.sh`](../publish.sh):

```bash
# 1. Enable Chrome Web Store API and create the publisher service account in GCP
./publish.sh setup-gcloud

# 2. Add the printed Service Account email to:
#    Chrome Web Store Developer Console -> Account -> Chrome Web Store API

# 3. Export your IDs and publish directly from the terminal
export CWS_PUBLISHER_ID="your-publisher-id"
export CWS_ITEM_ID="your-32-character-item-id"
export CWS_SERVICE_ACCOUNT="cws-publisher@your-gcp-project.iam.gserviceaccount.com"

./publish.sh publish
```
