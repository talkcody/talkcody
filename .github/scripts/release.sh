#!/bin/bash

# TalkCody Unified Release Script
# Supports both Linux and Windows platforms
# Usage: PLATFORM=linux|windows ARCH=x86_64|aarch64 ./.github/scripts/release.sh

set -e  # Exit on error

echo "========================================="
echo "TalkCody Release Process"
echo "========================================="
echo ""

# Color definitions
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Get platform and architecture
PLATFORM=${PLATFORM:-linux}
ARCH=${ARCH:-x86_64}

echo -e "${BLUE}Platform: ${PLATFORM}${NC}"
echo -e "${BLUE}Architecture: ${ARCH}${NC}"
echo ""

# Validate platform
if [ "$PLATFORM" != "linux" ] && [ "$PLATFORM" != "windows" ]; then
    echo -e "${RED}❌ Error: Unsupported platform: $PLATFORM${NC}"
    echo "   Supported platforms: linux, windows"
    exit 1
fi

# Set platform-specific variables
case "$PLATFORM" in
    linux)
        BUNDLE_DIR="src-tauri/target/release/bundle/appimage"
        ARTIFACT_PATTERN="*.AppImage"
        ARTIFACT_EXT="AppImage"
        PLATFORM_ID="linux-${ARCH}"
        UPDATER_PREFIX="talkcody"
        ;;
    windows)
        BUNDLE_DIR="src-tauri/target/release/bundle/msi"
        ARTIFACT_PATTERN="*.msi"
        ARTIFACT_EXT="msi"
        if [ "$ARCH" = "x86_64" ]; then
            PLATFORM_ID="windows-x86_64"
            WIN_ARCH="x64"
        elif [ "$ARCH" = "aarch64" ]; then
            PLATFORM_ID="windows-aarch64"
            WIN_ARCH="aarch64"
        else
            echo -e "${RED}❌ Error: Unsupported Windows architecture: $ARCH${NC}"
            exit 1
        fi
        UPDATER_PREFIX="talkcody"
        ;;
esac

# Check required environment variables
if [ -z "$TAURI_SIGNING_PRIVATE_KEY" ]; then
    echo -e "${RED}❌ Error: TAURI_SIGNING_PRIVATE_KEY not set${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} TAURI_SIGNING_PRIVATE_KEY is set"

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

# Step 1: Find build artifacts
echo "🔍 Step 1/5: Finding build artifacts..."

ARTIFACT_FILE=$(find "$BUNDLE_DIR" -name "$ARTIFACT_PATTERN" 2>/dev/null | head -n 1)

if [ -z "$ARTIFACT_FILE" ]; then
    echo -e "${RED}❌ Error: Build artifact not found in $BUNDLE_DIR${NC}"
    echo "  Expected pattern: $ARTIFACT_PATTERN"
    echo "  Please ensure 'bun run tauri build' was run successfully"
    exit 1
fi

ARTIFACT_FILENAME=$(basename "$ARTIFACT_FILE")
echo -e "${GREEN}✓${NC} Found artifact: $ARTIFACT_FILENAME"
echo ""

# Step 2: Find Tauri-generated updater bundle and signature
echo "📦 Step 2/5: Finding Tauri-generated updater artifacts..."

# Tauri automatically generates updater bundles with minisign signatures
# when TAURI_SIGNING_PRIVATE_KEY is set and createUpdaterArtifacts: true
# We need to find these artifacts instead of creating our own

if [ "$PLATFORM" = "linux" ]; then
    # Linux: Tauri generates *.AppImage.tar.gz and *.AppImage.tar.gz.sig
    UPDATER_BUNDLE=$(find "$BUNDLE_DIR" -name "*.AppImage.tar.gz" -not -name "*.sig" 2>/dev/null | head -n 1)
    UPDATER_SIG=$(find "$BUNDLE_DIR" -name "*.AppImage.tar.gz.sig" 2>/dev/null | head -n 1)
elif [ "$PLATFORM" = "windows" ]; then
    # Windows: Tauri generates either *.nsis.zip or *.msi.zip with corresponding .sig files
    # First try NSIS bundle (in nsis directory)
    NSIS_DIR="src-tauri/target/release/bundle/nsis"
    UPDATER_BUNDLE=$(find "$NSIS_DIR" -name "*.nsis.zip" 2>/dev/null | head -n 1)
    UPDATER_SIG=$(find "$NSIS_DIR" -name "*.nsis.zip.sig" 2>/dev/null | head -n 1)

    # If no NSIS bundle found, try MSI bundle
    if [ -z "$UPDATER_BUNDLE" ]; then
        UPDATER_BUNDLE=$(find "$BUNDLE_DIR" -name "*.msi.zip" 2>/dev/null | head -n 1)
        UPDATER_SIG=$(find "$BUNDLE_DIR" -name "*.msi.zip.sig" 2>/dev/null | head -n 1)
    fi
fi

if [ -z "$UPDATER_BUNDLE" ]; then
    echo -e "${RED}❌ Error: Tauri updater bundle not found${NC}"
    echo "  Please ensure 'bun run tauri build' was run with TAURI_SIGNING_PRIVATE_KEY set"
    echo "  and createUpdaterArtifacts: true in tauri.conf.json"
    exit 1
fi

if [ -z "$UPDATER_SIG" ]; then
    echo -e "${RED}❌ Error: Tauri updater signature not found${NC}"
    echo "  Expected signature file alongside: $UPDATER_BUNDLE"
    exit 1
fi

echo -e "${GREEN}✓${NC} Found updater bundle: $(basename "$UPDATER_BUNDLE")"
echo -e "${GREEN}✓${NC} Found signature: $(basename "$UPDATER_SIG")"
echo ""

# Step 3: Generate/update manifest.json
echo "📝 Step 3/5: Generating/updating manifest.json..."

# Read signature content
SIGNATURE=$(cat "$UPDATER_SIG")

# Get current date (ISO 8601 format)
PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# CDN URL prefix
CDN_BASE="https://cdn.talkcody.com"

# Temporary file paths
MANIFEST_FILE="/tmp/manifest-${VERSION}-$$.json"
R2_MANIFEST_PATH="releases/v${VERSION}/manifest.json"

# Try to download existing manifest.json from R2 (if exists)
echo "  Checking if manifest.json exists on R2..."

# Configure wrangler authentication
if [ -n "$CLOUDFLARE_API_TOKEN" ]; then
    export CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN"
fi
if [ -n "$CLOUDFLARE_ACCOUNT_ID" ]; then
    export CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID"
fi

if wrangler r2 object get "talkcody/${R2_MANIFEST_PATH}" --file "$MANIFEST_FILE" --remote 2>/dev/null; then
    echo -e "${BLUE}  Found existing manifest.json, merging with current platform${NC}"

    # Check if existing version matches current version
    EXISTING_VERSION=$(cat "$MANIFEST_FILE" | jq -r '.version')

    if [ "$EXISTING_VERSION" = "$VERSION" ]; then
        # Same version: just add/update current platform, keep existing version and pub_date
        echo -e "${BLUE}  Same version ($VERSION), adding ${PLATFORM} platform to existing manifest${NC}"
        
        # Generate download URLs based on platform
        if [ "$PLATFORM" = "linux" ]; then
            DOWNLOAD_URL="${CDN_BASE}/releases/v${VERSION}/$ARTIFACT_FILENAME"
            UPDATER_URL="${CDN_BASE}/releases/v${VERSION}/$(basename "$UPDATER_BUNDLE")"
        elif [ "$PLATFORM" = "windows" ]; then
            DOWNLOAD_URL="${CDN_BASE}/releases/v${VERSION}/$ARTIFACT_FILENAME"
            UPDATER_URL="${CDN_BASE}/releases/v${VERSION}/$(basename "$UPDATER_BUNDLE")"
        fi
        
        TEMP_MANIFEST=$(cat "$MANIFEST_FILE" | jq \
            --arg arch "$PLATFORM_ID" \
            --arg url "$UPDATER_URL" \
            --arg sig "$SIGNATURE" \
            --arg download_url "$DOWNLOAD_URL" \
            '.platforms[$arch] = {url: $url, signature: $sig, download_url: $download_url}')
    else
        # Different version: update everything
        echo -e "${YELLOW}  Version mismatch (existing: $EXISTING_VERSION, current: $VERSION)${NC}"
        echo -e "${YELLOW}  Creating new manifest with updated version${NC}"
        
        # Generate download URLs
        if [ "$PLATFORM" = "linux" ]; then
            DOWNLOAD_URL="${CDN_BASE}/releases/v${VERSION}/$ARTIFACT_FILENAME"
            UPDATER_URL="${CDN_BASE}/releases/v${VERSION}/$(basename "$UPDATER_BUNDLE")"
        elif [ "$PLATFORM" = "windows" ]; then
            DOWNLOAD_URL="${CDN_BASE}/releases/v${VERSION}/$ARTIFACT_FILENAME"
            UPDATER_URL="${CDN_BASE}/releases/v${VERSION}/$(basename "$UPDATER_BUNDLE")"
        fi

        TEMP_MANIFEST=$(cat "$MANIFEST_FILE" | jq \
            --arg version "$VERSION" \
            --arg pubdate "$PUB_DATE" \
            --arg arch "$PLATFORM_ID" \
            --arg url "$UPDATER_URL" \
            --arg sig "$SIGNATURE" \
            --arg download_url "$DOWNLOAD_URL" \
            '.version = $version | .pub_date = $pubdate | .platforms = {($arch): {url: $url, signature: $sig, download_url: $download_url}}')
    fi

    echo "$TEMP_MANIFEST" > "$MANIFEST_FILE"
else
    echo -e "${YELLOW}  No existing manifest.json found, creating new one${NC}"

    # Generate download URLs
    if [ "$PLATFORM" = "linux" ]; then
        DOWNLOAD_URL="${CDN_BASE}/releases/v${VERSION}/$ARTIFACT_FILENAME"
        UPDATER_URL="${CDN_BASE}/releases/v${VERSION}/$(basename "$UPDATER_BUNDLE")"
    elif [ "$PLATFORM" = "windows" ]; then
        DOWNLOAD_URL="${CDN_BASE}/releases/v${VERSION}/$ARTIFACT_FILENAME"
        UPDATER_URL="${CDN_BASE}/releases/v${VERSION}/$(basename "$UPDATER_BUNDLE")"
    fi

    # Generate new manifest.json (only current platform)
    MANIFEST_JSON=$(cat <<EOF
{
  "version": "${VERSION}",
  "pub_date": "${PUB_DATE}",
  "notes": "Release v${VERSION}",
  "platforms": {
    "${PLATFORM_ID}": {
      "url": "${UPDATER_URL}",
      "signature": "${SIGNATURE}",
      "download_url": "${DOWNLOAD_URL}"
    }
  }
}
EOF
)
    echo "$MANIFEST_JSON" > "$MANIFEST_FILE"
fi

echo -e "${GREEN}✓${NC} Manifest updated (${PLATFORM} ${ARCH})"
echo ""

# Step 4: Generate/update latest.json
echo "📝 Step 4/5: Updating latest.json..."

LATEST_JSON=$(cat <<EOF
{
  "version": "${VERSION}",
  "pub_date": "${PUB_DATE}",
  "notes": "Release v${VERSION}",
  "manifest_url": "${CDN_BASE}/releases/v${VERSION}/manifest.json"
}
EOF
)

LATEST_FILE="/tmp/latest-$$.json"
echo "$LATEST_JSON" > "$LATEST_FILE"

echo -e "${GREEN}✓${NC} latest.json updated"
echo ""

# Step 5: Upload to R2
echo "📤 Step 5/5: Uploading files to R2..."

R2_BUCKET="talkcody"
VERSION_PATH="releases/v${VERSION}"

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

echo "  Uploading ${PLATFORM} ${ARCH} artifact..."
if ! upload_with_retry "$ARTIFACT_FILE" "${R2_BUCKET}/${VERSION_PATH}/$ARTIFACT_FILENAME" "application/octet-stream"; then
    exit 1
fi

echo "  Uploading ${PLATFORM} ${ARCH} updater bundle..."
if ! upload_with_retry "$UPDATER_BUNDLE" "${R2_BUCKET}/${VERSION_PATH}/$(basename "$UPDATER_BUNDLE")" "application/gzip"; then
    exit 1
fi

echo "  Uploading ${PLATFORM} ${ARCH} signature file..."
if ! upload_with_retry "$UPDATER_SIG" "${R2_BUCKET}/${VERSION_PATH}/$(basename "$UPDATER_SIG")" "text/plain"; then
    exit 1
fi

echo "  Uploading/updating manifest.json..."
if ! upload_with_retry "$MANIFEST_FILE" "${R2_BUCKET}/${VERSION_PATH}/manifest.json" "application/json"; then
    exit 1
fi

echo "  Updating latest.json..."
if ! upload_with_retry "$LATEST_FILE" "${R2_BUCKET}/latest.json" "application/json"; then
    exit 1
fi

echo -e "${GREEN}✓${NC} ${PLATFORM} ${ARCH} files uploaded"
echo ""

# Clean up temporary files
rm -f "$MANIFEST_FILE" "$LATEST_FILE"

# Done
echo "========================================="
echo -e "${GREEN}🎉 ${PLATFORM} Release Complete!${NC}"
echo "========================================="
echo ""
echo "📦 Release Info:"
echo "  Version: ${BLUE}v${VERSION}${NC}"
echo "  Platform: ${PLATFORM} ${ARCH}"
echo "  Artifact: ${ARTIFACT_FILENAME}"
echo ""
echo "🌐 Download Links:"
echo "  ${BLUE}${CDN_BASE}/releases/v${VERSION}/${ARTIFACT_FILENAME}${NC}"
echo ""
echo "🔄 Update API:"
echo "  ${BLUE}https://api.talkcody.com/api/updates/${PLATFORM}/${ARCH}/${VERSION}${NC}"
echo ""
