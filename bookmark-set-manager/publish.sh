#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Bookmark Set Manager - Packaging & Chrome Web Store API v2 Publish Script
# ==============================================================================
# Usage:
#   ./publish.sh package                 # Only build clean mybookmarks.zip
#   ./publish.sh setup-gcloud            # Enable Chrome Web Store API & create Service Account via gcloud
#   ./publish.sh upload                  # Package & upload draft to Chrome Web Store
#   ./publish.sh publish                 # Package, upload, and submit for review / publish
#
# Upload/publish read these from 1Password (op CLI) unless already set in the env:
#   CWS_PUBLISHER_ID     op://Employee/Bookmark Set Manager - Chrome Web Store/publisher_id
#   CWS_ITEM_ID          op://Employee/Bookmark Set Manager - Chrome Web Store/item_id
#   CWS_SERVICE_ACCOUNT  op://Employee/Bookmark Set Manager - Chrome Web Store/service_account (optional)
# Override the item location with OP_CWS_ITEM="op://<vault>/<item>".
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ZIP_FILE="mybookmarks.zip"
EXTENSION_FILES=(
  manifest.json
  background.js
  popup.html
  popup.js
  ExtPay.js
  icon16.png
  icon19.png
  icon32.png
  icon38.png
  icon48.png
  icon128.png
)

OP_CWS_ITEM="${OP_CWS_ITEM:-op://Employee/Bookmark Set Manager - Chrome Web Store}"

# Read a field from the 1Password item; prints nothing if the field is missing.
op_field() {
  op read "${OP_CWS_ITEM}/$1" 2>/dev/null || true
}

load_secrets() {
  if [[ -n "${CWS_PUBLISHER_ID:-}" && -n "${CWS_ITEM_ID:-}" ]]; then
    return
  fi
  if ! command -v op >/dev/null 2>&1; then
    echo "Error: 1Password CLI 'op' not found and CWS_PUBLISHER_ID/CWS_ITEM_ID are not set." >&2
    exit 1
  fi
  echo "==> Loading Chrome Web Store IDs from 1Password (${OP_CWS_ITEM})..."
  CWS_PUBLISHER_ID="${CWS_PUBLISHER_ID:-$(op_field publisher_id)}"
  CWS_ITEM_ID="${CWS_ITEM_ID:-$(op_field item_id)}"
  CWS_SERVICE_ACCOUNT="${CWS_SERVICE_ACCOUNT:-$(op_field service_account)}"
}

build_package() {
  echo "==> Building clean extension package: ${ZIP_FILE}..."
  rm -f "$ZIP_FILE"
  zip -r "$ZIP_FILE" "${EXTENSION_FILES[@]}"
  echo "==> Created ${ZIP_FILE} ($(du -h "$ZIP_FILE" | cut -f1))"
}

setup_gcloud() {
  if ! command -v gcloud >/dev/null 2>&1; then
    echo "Error: 'gcloud' CLI is not installed or not in PATH."
    echo "Install it on Arch/Omarchy with: yay -S google-cloud-cli (or curl https://sdk.cloud.google.com | bash)"
    exit 1
  fi

  PROJECT_ID="$(gcloud config get-value project 2>/dev/null || true)"
  if [[ -z "$PROJECT_ID" ]]; then
    echo "Error: No active gcloud project set. Run: gcloud config set project YOUR_PROJECT_ID"
    exit 1
  fi

  echo "==> Enabling Chrome Web Store API on project: ${PROJECT_ID}..."
  gcloud services enable chromewebstore.googleapis.com --project="$PROJECT_ID"

  SA_NAME="cws-publisher"
  SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

  if ! gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT_ID" >/dev/null 2>&1; then
    echo "==> Creating service account: ${SA_EMAIL}..."
    gcloud iam service-accounts create "$SA_NAME" \
      --display-name="Chrome Web Store Publisher" \
      --project="$PROJECT_ID"
  else
    echo "==> Service account already exists: ${SA_EMAIL}"
  fi

  cat <<EOF

================================================================================
NEXT STEP IN CHROME WEB STORE DEVELOPER CONSOLE:
1. Open https://chrome.google.com/webstore/devconsole
2. Go to 'Account' (left sidebar) -> 'Chrome Web Store API' section.
3. Paste this Service Account email and click Save:
   ${SA_EMAIL}
4. Store the service account in 1Password (publisher/item IDs are already there):
   op item edit "Bookmark Set Manager - Chrome Web Store" --vault Employee \\
     'service_account[text]=${SA_EMAIL}'
   ./publish.sh publish
================================================================================
EOF
}

get_access_token() {
  if [[ -n "${CWS_ACCESS_TOKEN:-}" ]]; then
    echo "$CWS_ACCESS_TOKEN"
    return
  fi

  if ! command -v gcloud >/dev/null 2>&1; then
    echo "Error: gcloud not found and CWS_ACCESS_TOKEN is not set." >&2
    exit 1
  fi

  if [[ -n "${CWS_SERVICE_ACCOUNT:-}" ]]; then
    gcloud auth print-access-token \
      --impersonate-service-account="$CWS_SERVICE_ACCOUNT" \
      --scopes="https://www.googleapis.com/auth/chromewebstore"
  else
    gcloud auth print-access-token \
      --scopes="https://www.googleapis.com/auth/chromewebstore"
  fi
}

upload_package() {
  load_secrets
  : "${CWS_PUBLISHER_ID:?Error: Set CWS_PUBLISHER_ID (from Chrome Web Store Console -> Account)}"
  : "${CWS_ITEM_ID:?Error: Set CWS_ITEM_ID (your 32-character extension ID)}"

  build_package

  echo "==> Fetching OAuth2 access token..."
  TOKEN="$(get_access_token)"

  UPLOAD_URL="https://chromewebstore.googleapis.com/upload/v2/publishers/${CWS_PUBLISHER_ID}/items/${CWS_ITEM_ID}:upload"
  echo "==> Uploading ${ZIP_FILE} to Chrome Web Store..."
  RESPONSE="$(curl -sS -X POST \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/zip" \
    --data-binary "@${ZIP_FILE}" \
    "$UPLOAD_URL")"

  echo "$RESPONSE"
  if echo "$RESPONSE" | grep -q '"uploadState": *"FAILURE"'; then
    echo "Error: Upload failed." >&2
    exit 1
  fi
  echo "==> Upload complete."
}

publish_item() {
  upload_package

  TOKEN="$(get_access_token)"
  PUBLISH_URL="https://chromewebstore.googleapis.com/v2/publishers/${CWS_PUBLISHER_ID}/items/${CWS_ITEM_ID}:publish"
  echo "==> Submitting item ${CWS_ITEM_ID} for publication..."
  RESPONSE="$(curl -sS -X POST \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{}' \
    "$PUBLISH_URL")"

  echo "$RESPONSE"
  echo "==> Publish request finished."
}

ACTION="${1:-package}"
case "$ACTION" in
  package)
    build_package
    ;;
  setup-gcloud)
    setup_gcloud
    ;;
  upload)
    upload_package
    ;;
  publish)
    publish_item
    ;;
  *)
    echo "Usage: $0 {package|setup-gcloud|upload|publish}"
    exit 1
    ;;
esac
