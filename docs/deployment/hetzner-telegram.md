# Deploy TalkCody on Hetzner with Telegram Bot

This guide walks you through deploying TalkCody as a server on Hetzner Cloud with Telegram Bot integration for mobile interaction.

## Prerequisites

- Hetzner Cloud account
- A domain name (for HTTPS)
- Telegram account (to create a bot)

## Step 1: Create a Hetzner Server

1. Log into [Hetzner Cloud Console](https://console.hetzner.cloud/)
2. Create a new project (or use existing)
3. Add a server:
   - **Location**: Choose closest to your users
   - **Image**: Ubuntu 22.04 LTS
   - **Type**: CPX21 (2 vCPU, 4 GB RAM) or higher
   - **Volume**: Add a 20 GB volume for data persistence
   - **Firewall**: Allow ports 22 (SSH), 80 (HTTP), 443 (HTTPS)

4. SSH into your server:
   ```bash
   ssh root@YOUR_SERVER_IP
   ```

## Step 2: Install Docker & Docker Compose

```bash
# Update system
apt-get update && apt-get upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh

# Enable Docker service
systemctl enable --now docker

# Install Docker Compose plugin
apt-get install -y docker-compose-plugin

# Verify
docker --version
docker compose version
```

## Step 3: Configure DNS

Point your domain to the Hetzner server:

```
A record: your-domain.com → YOUR_SERVER_IP
```

Wait for DNS propagation (can take a few minutes to hours).

## Step 4: Get Telegram Bot Token

1. Open Telegram and search for [@BotFather](https://t.me/botfather)
2. Start a chat and send `/newbot`
3. Follow the prompts to create your bot
4. Save the **HTTP API token** (looks like `123456789:ABCdefGHIjklMNOpqrSTUvwxyz`)
5. (Optional) Set bot commands by sending `/setcommands` to BotFather:
   ```
   new - Start a new conversation
   status - Check current task status
   stop - Stop the running task
   help - Show help message
   ```

## Step 5: Deploy TalkCody

### 5.1 Clone Repository

```bash
cd /opt
git clone https://github.com/yourusername/talkcody.git
cd talkcody
```

### 5.2 Configure Environment

```bash
cd deploy/hetzner
cp .env.example .env
nano .env
```

Edit `.env`:

```env
# Required
TELEGRAM_BOT_TOKEN=your_actual_bot_token_here

# Optional: restrict to specific Telegram users
# Get your chat ID by messaging @userinfobot on Telegram
TELEGRAM_ALLOWED_CHAT_IDS=123456789,987654321

# Set at least one LLM provider
PROVIDER_API_KEY_openai=sk-your-openai-key

# Optional API key for HTTP endpoints
API_KEY=your_secret_api_key
```

### 5.3 Configure Caddy

Edit `Caddyfile`:

```bash
nano Caddyfile
```

Replace `YOUR_DOMAIN` with your actual domain:

```
your-domain.com {
    encode gzip zstd
    reverse_proxy talkcody:8080
    # ... rest of config
}
```

### 5.4 Start Services

```bash
docker compose up -d
```

Check logs:

```bash
docker compose logs -f
```

You should see:
```
[Telegram] Bot spawned successfully
🚀 TalkCody Server ready!
```

## Step 6: Verify Deployment

### Health Check

```bash
curl https://your-domain.com/health
```

Should return:
```json
{"status":"ok"}
```

### Test Telegram Bot

1. Open Telegram on your phone
2. Find your bot (by username you created)
3. Send `/start`
4. You should receive welcome message
5. Send a coding question like "Write a Python function to calculate factorial"

## Step 7: Maintenance

### View Logs

```bash
cd /opt/talkcody/deploy/hetzner
docker compose logs -f talkcody
docker compose logs -f caddy
```

### Update to New Version

```bash
cd /opt/talkcody
git pull
cd deploy/hetzner
docker compose down
docker compose up -d --build
```

### Backup Data

Data is stored in Docker volumes. To backup:

```bash
# Create backup directory
mkdir -p /backups

# Backup volumes
docker run --rm -v talkcody-data:/data -v $(pwd):/backup alpine tar czf /backup/talkcody-data-$(date +%Y%m%d).tar.gz -C /data .
docker run --rm -v talkcody-workspace:/data -v $(pwd):/backup alpine tar czf /backup/talkcody-workspace-$(date +%Y%m%d).tar.gz -C /data .
```

### Restore from Backup

```bash
# Stop services
docker compose down

# Restore volumes
docker run --rm -v talkcody-data:/data -v $(pwd):/backup alpine sh -c "cd /data && tar xzf /backup/talkcody-data-YYYYMMDD.tar.gz"
docker run --rm -v talkcody-workspace:/data -v $(pwd):/backup alpine sh -c "cd /data && tar xzf /backup/talkcody-workspace-YYYYMMDD.tar.gz"

# Start services
docker compose up -d
```

## Troubleshooting

### Bot Not Responding

Check Telegram token:
```bash
docker compose logs talkcody | grep -i telegram
```

### Cannot Connect to Server

Check firewall:
```bash
ufw status
```

Check Caddy:
```bash
docker compose logs caddy
```

### Out of Disk Space

Clean up Docker:
```bash
docker system prune -a
docker volume prune
```

## Security Recommendations

1. **Always set TELEGRAM_ALLOWED_CHAT_IDS** in production
2. **Set a strong API_KEY** for HTTP endpoints
3. **Enable UFW firewall**:
   ```bash
   ufw default deny incoming
   ufw default allow outgoing
   ufw allow 22/tcp
   ufw allow 80/tcp
   ufw allow 443/tcp
   ufw enable
   ```
4. **Keep system updated**:
   ```bash
   apt-get update && apt-get upgrade -y
   ```

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      HETZNER CLOUD                          │
│                                                             │
│  ┌──────────────┐         ┌─────────────────────────────┐  │
│  │   Telegram   │◄───────►│        TalkCody Server      │  │
│  │    Bot API   │         │  ┌───────────────────────┐   │  │
│  └──────────────┘         │  │  Telegram Bot (poll)  │   │  │
│          ▲                │  └───────────────────────┘   │  │
│          │                │            │                  │  │
│    Mobile Users          │            ▼                  │  │
│                          │  ┌───────────────────────┐   │  │
│                          │  │    AI Agent Runtime   │   │  │
│                          │  └───────────────────────┘   │  │
│                          │            │                  │  │
│                          │            ▼                  │  │
│                          │  ┌───────────────────────┐   │  │
│                          │  │   SQLite (persist)    │   │  │
│                          │  └───────────────────────┘   │  │
│                          └─────────────────────────────┘  │
│                                    │                        │
│                                    ▼                        │
│                          ┌───────────────────────┐        │
│                          │   Docker Volume       │        │
│                          │   (/data)             │        │
│                          └───────────────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

## Next Steps

- [ ] Set up monitoring (Prometheus + Grafana)
- [ ] Configure automated backups
- [ ] Set up log aggregation
- [ ] Add more LLM providers for redundancy
