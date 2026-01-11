#!/bin/bash

# TalkCody Release Finalization Script
# This script merges all platform manifest fragments into a final manifest.json
# and generates latest.json for the updater system.
#
# Usage: VERSION=0.1.8 ./.github/scripts/finalize-release.sh

set -e  # Exit on error

echo "========================================="
echo "TalkCody Release Finalization"
echo "========================================="
echo ""

# Color definitions
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check required tools
echo "📋 Checking required tools..."

if ! command -v jq &> /dev/null; then
    echo -e "${RED}❌ Error: jq not installed${NC}"
    exit 1
fi

if ! command -v wrangler &> /dev/null; then
    echo -e "${RED}❌ Error: wrangler not installed${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} All required tools are installed"
echo ""

# Get version from environment or tauri.conf.json
if [ -n "$VERSION" ]; then
    echo "📖 Using version from environment: v${VERSION}"
else
    echo "📖 Reading version from tauri.conf.json..."
    VERSION=$(jq -r '.version' src-tauri/tauri.conf.json)
fi

if [ -z "$VERSION" ] || [ "$VERSION" == "null" ]; then
    echo -e "${RED}❌ Error: Cannot read version${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Version: ${BLUE}v${VERSION}${NC}"
echo ""

# Configure wrangler authentication
if [ -n "$CLOUDFLARE_API_TOKEN" ]; then
    export CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN"
fi
if [ -n "$CLOUDFLARE_ACCOUNT_ID" ]; then
    export CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID"
fi

# Constants
R2_BUCKET="talkcody"
VERSION_PATH="releases/v${VERSION}"
CDN_BASE="https://cdn.talkcody.com"

# All supported platforms
PLATFORMS=(
    "linux-x86_64"
    "windows-x86_64"
    "darwin-x86_64"
    "darwin-aarch64"
)

# Platform manifest fragment file patterns
PLATFORM_FRAGMENTS=(
    "platform-manifest-linux-x86_64.json"
    "platform-manifest-windows-x86_64.json"
    "platform-manifest-macos-x86_64.json"
    "platform-manifest-macos-aarch64.json"
)

# Step 1: Download all platform manifest fragments
echo "📥 Step 1/4: Downloading platform manifest fragments..."

TEMP_DIR="/tmp/talkcody-finalize-$$"
mkdir -p "$TEMP_DIR"

DOWNLOADED_FRAGMENTS=()
MISSING_PLATFORMS=()

for i in "${!PLATFORMS[@]}"; do
    PLATFORM_ID="${PLATFORMS[$i]}"
    FRAGMENT_FILE="${PLATFORM_FRAGMENTS[$i]}"
    LOCAL_PATH="$TEMP_DIR/$FRAGMENT_FILE"
    
    echo -n "  Downloading ${FRAGMENT_FILE}... "
    
    if wrangler r2 object get "${R2_BUCKET}/${VERSION_PATH}/${FRAGMENT_FILE}" \
        --file "$LOCAL_PATH" --remote 2>/dev/null; then
        echo -e "${GREEN}✓${NC}"
        DOWNLOADED_FRAGMENTS+=("$LOCAL_PATH")
    else
        echo -e "${YELLOW}Not found${NC}"
        MISSING_PLATFORMS+=("$PLATFORM_ID")
    fi
done

echo ""

# Check if we have at least one platform
if [ ${#DOWNLOADED_FRAGMENTS[@]} -eq 0 ]; then
    echo -e "${RED}❌ Error: No platform manifest fragments found${NC}"
    echo "   Please ensure at least one build job has completed successfully"
    rm -rf "$TEMP_DIR"
    exit 1
fi

echo -e "${GREEN}✓${NC} Downloaded ${#DOWNLOADED_FRAGMENTS[@]} platform fragments"

if [ ${#MISSING_PLATFORMS[@]} -gt 0 ]; then
    echo -e "${YELLOW}  Missing platforms: ${MISSING_PLATFORMS[*]}${NC}"
fi

echo ""

# Step 2: Merge platform fragments into final manifest.json
echo "🔄 Step 2/4: Merging platform fragments..."

# Try to download existing manifest.json from R2 first
R2_MANIFEST_PATH="${R2_BUCKET}/${VERSION_PATH}/manifest.json"
EXISTING_MANIFEST_FILE="$TEMP_DIR/existing-manifest.json"
HAS_EXISTING_MANIFEST=false

echo "  Checking for existing manifest.json on R2..."
for i in $(seq 1 3); do
    if wrangler r2 object get "${R2_MANIFEST_PATH}" --file "$EXISTING_MANIFEST_FILE" --remote 2>/dev/null; then
        if jq empty "$EXISTING_MANIFEST_FILE" 2>/dev/null; then
            HAS_EXISTING_MANIFEST=true
            echo -e "${BLUE}  Found existing manifest.json, will merge platforms${NC}"
            break
        else
            echo -e "${YELLOW}  Downloaded manifest.json is invalid, retrying...${NC}"
            rm -f "$EXISTING_MANIFEST_FILE"
        fi
    fi
    if [ $i -lt 3 ]; then
        echo "  Retry $i/3..."
        sleep 2
    fi
done

# Initialize platforms JSON and version info
if [ "$HAS_EXISTING_MANIFEST" = true ]; then
    # Use existing manifest as base (preserves Mac ARM local release data)
    PLATFORMS_JSON=$(cat "$EXISTING_MANIFEST_FILE" | jq '.platforms // {}')
    VERSION_FROM_FRAGMENT=$(cat "$EXISTING_MANIFEST_FILE" | jq -r '.version')
    PUB_DATE=$(cat "$EXISTING_MANIFEST_FILE" | jq -r '.pub_date')
    echo "  Base version: $VERSION_FROM_FRAGMENT"
    echo "  Base publish date: $PUB_DATE"
else
    # Fall back to first fragment (original behavior)
    PLATFORMS_JSON='{}'
    FIRST_FRAGMENT=$(cat "${DOWNLOADED_FRAGMENTS[0]}")
    VERSION_FROM_FRAGMENT=$(echo "$FIRST_FRAGMENT" | jq -r '.version')
    PUB_DATE=$(echo "$FIRST_FRAGMENT" | jq -r '.pub_date')
    echo "  Version: $VERSION_FROM_FRAGMENT"
    echo "  Publish Date: $PUB_DATE"
fi

# Merge all fragments
for FRAGMENT_PATH in "${DOWNLOADED_FRAGMENTS[@]}"; do
    FRAGMENT=$(cat "$FRAGMENT_PATH")
    PLATFORM_ID=$(echo "$FRAGMENT" | jq -r '.platform_id')
    URL=$(echo "$FRAGMENT" | jq -r '.url')
    SIGNATURE=$(echo "$FRAGMENT" | jq -r '.signature')
    DOWNLOAD_URL=$(echo "$FRAGMENT" | jq -r '.download_url')
    
    echo "  Adding platform: $PLATFORM_ID"
    
    PLATFORMS_JSON=$(echo "$PLATFORMS_JSON" | jq \
        --arg platform "$PLATFORM_ID" \
        --arg url "$URL" \
        --arg sig "$SIGNATURE" \
        --arg download_url "$DOWNLOAD_URL" \
        '.[$platform] = {url: $url, signature: $sig, download_url: $download_url}')
done

# Generate final manifest.json
MANIFEST_FILE="$TEMP_DIR/manifest.json"
MANIFEST_JSON=$(jq -n \
    --arg version "$VERSION_FROM_FRAGMENT" \
    --arg pub_date "$PUB_DATE" \
    --argjson platforms "$PLATFORMS_JSON" \
    '{
        version: $version,
        pub_date: $pub_date,
        notes: ("Release v" + $version),
        platforms: $platforms
    }')

echo "$MANIFEST_JSON" | jq '.' > "$MANIFEST_FILE"

echo -e "${GREEN}✓${NC} Manifest merged successfully"
echo ""

# Step 3: Generate latest.json
echo "📝 Step 3/4: Generating latest.json..."

LATEST_FILE="$TEMP_DIR/latest.json"
LATEST_JSON=$(jq -n \
    --arg version "$VERSION_FROM_FRAGMENT" \
    --arg pub_date "$PUB_DATE" \
    --arg manifest_url "${CDN_BASE}/releases/v${VERSION}/manifest.json" \
    '{
        version: $version,
        pub_date: $pub_date,
        notes: ("Release v" + $version),
        manifest_url: $manifest_url
    }')

echo "$LATEST_JSON" | jq '.' > "$LATEST_FILE"

echo -e "${GREEN}✓${NC} latest.json generated"
echo ""

# Step 4: Upload to R2
echo "📤 Step 4/4: Uploading to R2..."

# Helper function to upload with retry
upload_with_retry() {
    local file="$1"
    local remote_path="$2"
    local content_type="$3"
    local max_retries=3
    local retry_count=0

    while [ $retry_count -lt $max_retries ]; do
        if wrangler r2 object put "${remote_path}" \
            --file "$file" \
            --content-type "$content_type" \
            --remote 2>&1; then
            return 0
        fi

        retry_count=$((retry_count + 1))
        if [ $retry_count -lt $max_retries ]; then
            echo -e "${YELLOW}  Upload failed, retrying in 5s (${retry_count}/${max_retries})...${NC}"
            sleep 5
        fi
    done

    echo -e "${RED}  Upload failed after ${max_retries} retries${NC}"
    return 1
}

echo "  Uploading manifest.json..."
if ! upload_with_retry "$MANIFEST_FILE" "${R2_BUCKET}/${VERSION_PATH}/manifest.json" "application/json"; then
    rm -rf "$TEMP_DIR"
    exit 1
fi

echo "  Uploading latest.json..."
if ! upload_with_retry "$LATEST_FILE" "${R2_BUCKET}/latest.json" "application/json"; then
    rm -rf "$TEMP_DIR"
    exit 1
fi

echo -e "${GREEN}✓${NC} Files uploaded successfully"
echo ""

# Clean up
rm -rf "$TEMP_DIR"

# Done
echo "========================================="
echo -e "${GREEN}🎉 Release Finalization Complete!${NC}"
echo "========================================="
echo ""
echo "📦 Release Info:"
echo "  Version: ${BLUE}v${VERSION}${NC}"
echo "  Platforms: ${#DOWNLOADED_FRAGMENTS[@]}"
echo ""
echo "🌐 Manifest URL:"
echo "  ${BLUE}${CDN_BASE}/releases/v${VERSION}/manifest.json${NC}"
echo ""
echo "🔄 Update API:"
echo "  ${BLUE}${CDN_BASE}/latest.json${NC}"
echo ""
