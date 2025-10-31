# Hướng dẫn Deploy Shopify App lên AWS EC2

## Tổng quan

Tài liệu này hướng dẫn deploy Shopify Remix App lên AWS EC2 instance cho môi trường production.

### Kiến trúc Production

```
┌─────────────┐     HTTPS      ┌──────────────┐     Reverse     ┌─────────────┐
│   Shopify   │  ──────────────>│   Nginx      │   Proxy        │  Remix App  │
│   Admin     │                 │  (Port 443)  │  ─────────────>│ (Port 3000) │
└─────────────┘                 └──────────────┘                 └─────────────┘
                                       │                                │
                                       │                                │
┌─────────────┐                       │                                │
│  Warehouse  │  ─── Webhook ─────────┘                                │
│    System   │                                                         │
└─────────────┘                                                         │
                                                                        v
                                                                 ┌─────────────┐
                                                                 │   SQLite    │
                                                                 │  Database   │
                                                                 └─────────────┘
```

### Yêu cầu

- **AWS Account** với quyền tạo EC2 instances
- **Domain name** đã đăng ký (ví dụ: shopify-app.yourdomain.com)
- **Shopify App credentials** (API Key, API Secret)
- **Warehouse API credentials** (nếu dùng production API)

---

## Bước 1: Tạo EC2 Instance

### 1.1. Launch EC2 Instance

1. Đăng nhập vào AWS Console
2. Chọn **EC2** > **Launch Instance**
3. Cấu hình instance:

**AMI (Amazon Machine Image)**:
- Chọn **Ubuntu Server 22.04 LTS** (64-bit x86)

**Instance Type**:
- **Development/Testing**: `t3.micro` (1 vCPU, 1 GB RAM) - Free tier
- **Production**: `t3.small` (2 vCPU, 2 GB RAM) - Khuyến nghị
- **High Traffic**: `t3.medium` (2 vCPU, 4 GB RAM)

**Key Pair**:
- Tạo key pair mới hoặc dùng key pair có sẵn
- Download file `.pem` và lưu an toàn
- Ví dụ: `shopify-app-key.pem`

**Network Settings**:
- **VPC**: Default VPC
- **Auto-assign Public IP**: Enable
- **Security Group**: Tạo mới với rules sau:

| Type | Protocol | Port | Source | Description |
|------|----------|------|--------|-------------|
| SSH | TCP | 22 | My IP | SSH access |
| HTTP | TCP | 80 | 0.0.0.0/0 | HTTP traffic |
| HTTPS | TCP | 443 | 0.0.0.0/0 | HTTPS traffic |

**Storage**:
- **Root volume**: 20 GB gp3 (khuyến nghị)
- Minimum 10 GB

4. Click **Launch Instance**

### 1.2. Connect to Instance

**Windows (Git Bash hoặc WSL)**:

```bash
# Set permissions cho key file
chmod 400 shopify-app-key.pem

# Connect to EC2
ssh -i shopify-app-key.pem ubuntu@<EC2_PUBLIC_IP>
```

**macOS/Linux**:

```bash
chmod 400 shopify-app-key.pem
ssh -i shopify-app-key.pem ubuntu@<EC2_PUBLIC_IP>
```

---

## Bước 2: Cấu hình Server

### 2.1. Update System

```bash
sudo apt update
sudo apt upgrade -y
```

### 2.2. Install Node.js

Cài đặt Node.js 20.x (LTS):

```bash
# Install Node.js via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version  # v20.x.x
npm --version   # 10.x.x
```

### 2.3. Install PM2 (Process Manager)

```bash
# Install PM2 globally
sudo npm install -g pm2

# Verify installation
pm2 --version
```

### 2.4. Install Nginx

```bash
# Install Nginx
sudo apt install -y nginx

# Start Nginx
sudo systemctl start nginx
sudo systemctl enable nginx

# Verify installation
sudo systemctl status nginx
nginx -v
```

### 2.5. Install Git

```bash
sudo apt install -y git
git --version
```

---

## Bước 3: Deploy Application

### 3.1. Clone Repository

Tùy chọn deployment:

**Option A: Git Clone (Recommended)**

```bash
# Create app directory
sudo mkdir -p /var/www/shopify-app
sudo chown -R ubuntu:ubuntu /var/www/shopify-app

# Clone repository
cd /var/www/shopify-app
git clone https://github.com/your-username/your-repo.git .

# Or if using private repo
git clone https://your-token@github.com/your-username/your-repo.git .
```

**Option B: Upload Files via SCP**

```bash
# From your local machine
scp -i shopify-app-key.pem -r ./skincare-app/* ubuntu@<EC2_PUBLIC_IP>:/var/www/shopify-app/
```

### 3.2. Install Dependencies

```bash
cd /var/www/shopify-app

# Install production dependencies
npm install --production

# Install Prisma CLI (needed for migrations)
npm install -D prisma
```

### 3.3. Setup Environment Variables

```bash
# Create .env file
nano .env
```

Paste and configure:

```env
# Shopify App Configuration
SHOPIFY_API_KEY=your_production_api_key
SHOPIFY_API_SECRET=your_production_api_secret

# Host Configuration
HOST=https://shopify-app.yourdomain.com
PORT=3000

# Warehouse API Configuration
USE_MOCK_WAREHOUSE_API=false
WAREHOUSE_API_URL=https://your-warehouse-api.com
WAREHOUSE_API_TOKEN=your_production_bearer_token

# Warehouse Order Configuration
WAREHOUSE_SHOP_ID=SUSE00000601
WAREHOUSE_ID=7

# Inventory Sync Configuration
ENABLE_INVENTORY_SYNC=true

# Webhook Security
WAREHOUSE_WEBHOOK_TOKEN=1v1BBJrHcetwQtAZi45bgJGbz7ZIw7V9EXq43gFi95c91578

# Database
DATABASE_URL=file:./prisma/dev.db

# Session Secret
SESSION_SECRET=$(openssl rand -base64 32)
```

**Generate Session Secret**:

```bash
# Generate random secret
openssl rand -base64 32

# Add to .env
echo "SESSION_SECRET=$(openssl rand -base64 32)" >> .env
```

### 3.4. Setup Database

```bash
# Generate Prisma Client
npx prisma generate

# Push database schema
npx prisma db push

# Verify database
ls -la prisma/
# Should see: dev.db, dev.db-journal
```

### 3.5. Build Application

```bash
# Build Remix app
npm run build

# Verify build output
ls -la build/
# Should see: index.js, client/, server/
```

---

## Bước 4: Setup PM2 Process Manager

### 4.1. Create PM2 Ecosystem File

```bash
nano ecosystem.config.js
```

Paste:

```javascript
module.exports = {
  apps: [{
    name: 'shopify-app',
    script: 'npm',
    args: 'start',
    cwd: '/var/www/shopify-app',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: '/var/log/pm2/shopify-app-error.log',
    out_file: '/var/log/pm2/shopify-app-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true
  }]
};
```

### 4.2. Start Application with PM2

```bash
# Create log directory
sudo mkdir -p /var/log/pm2
sudo chown -R ubuntu:ubuntu /var/log/pm2

# Start app
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
# Copy and run the command output
```

### 4.3. PM2 Management Commands

```bash
# View app status
pm2 status

# View logs
pm2 logs shopify-app

# View logs (last 100 lines)
pm2 logs shopify-app --lines 100

# Restart app
pm2 restart shopify-app

# Stop app
pm2 stop shopify-app

# Monitor app
pm2 monit

# Delete app from PM2
pm2 delete shopify-app
```

---

## Bước 5: Setup Nginx Reverse Proxy

### 5.1. Create Nginx Configuration

```bash
sudo nano /etc/nginx/sites-available/shopify-app
```

Paste:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name shopify-app.yourdomain.com;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name shopify-app.yourdomain.com;

    # SSL Certificate (will be configured by Certbot)
    ssl_certificate /etc/letsencrypt/live/shopify-app.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/shopify-app.yourdomain.com/privkey.pem;

    # SSL Configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Client upload size
    client_max_body_size 10M;

    # Proxy to Node.js app
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Logs
    access_log /var/log/nginx/shopify-app-access.log;
    error_log /var/log/nginx/shopify-app-error.log;
}
```

### 5.2. Enable Nginx Site

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/shopify-app /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
```

---

## Bước 6: Setup SSL Certificate (Let's Encrypt)

### 6.1. Install Certbot

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx
```

### 6.2. Configure DNS

**Trước khi chạy Certbot**, cấu hình DNS:

1. Đăng nhập vào DNS provider (GoDaddy, Cloudflare, etc.)
2. Tạo A record:
   - **Type**: A
   - **Name**: shopify-app (hoặc subdomain bạn muốn)
   - **Value**: EC2 Public IP
   - **TTL**: 600 (hoặc mặc định)

3. Verify DNS:

```bash
# Check DNS propagation
nslookup shopify-app.yourdomain.com

# Should return your EC2 IP
```

### 6.3. Obtain SSL Certificate

```bash
# Obtain certificate
sudo certbot --nginx -d shopify-app.yourdomain.com

# Follow prompts:
# 1. Enter email address
# 2. Agree to Terms of Service
# 3. Choose redirect option (recommended: 2 - Redirect)
```

### 6.4. Test SSL Certificate

```bash
# Test certificate renewal
sudo certbot renew --dry-run
```

Certificate sẽ tự động renew trước 30 ngày hết hạn.

### 6.5. Verify HTTPS

Mở browser và truy cập:
```
https://shopify-app.yourdomain.com
```

Kiểm tra:
- ✅ HTTPS enabled (padlock icon)
- ✅ HTTP redirects to HTTPS
- ✅ App loads successfully

---

## Bước 7: Configure Shopify App

### 7.1. Update App URLs

1. Đăng nhập vào **Shopify Partners Dashboard**
2. Vào app của bạn > **Configuration**
3. Update URLs:

**App URL**:
```
https://shopify-app.yourdomain.com
```

**Allowed redirection URL(s)**:
```
https://shopify-app.yourdomain.com/auth/callback
https://shopify-app.yourdomain.com/auth/shopify/callback
```

4. Click **Save**

### 7.2. Test App Installation

1. Vào **Test on development store**
2. Chọn store và click **Install**
3. Verify app loads trong Shopify Admin

---

## Bước 8: Setup Webhook Endpoints

### 8.1. Configure Warehouse Webhook

Cung cấp cho warehouse team webhook URL:

**Endpoint**: `https://shopify-app.yourdomain.com/webhooks/warehouse-status`

**Method**: `POST`

**Headers**:
```
Content-Type: application/json
Accept: application/json
Authorization: Bearer Token 1v1BBJrHcetwQtAZi45bgJGbz7ZIw7V9EXq43gFi95c91578
```

**Payload Example**:
```json
{
  "event": "updated",
  "event_at": "2025-10-24 10:38:08",
  "subject": {
    "id": "OR00100005255",
    "status_id": "packaging"
  },
  "changes": {
    "attributes": {
      "status_id": "packaging"
    },
    "old": {
      "status_id": "order-confirmed"
    }
  }
}
```

### 8.2. Test Webhook

```bash
# From your local machine or another server
curl -X POST https://shopify-app.yourdomain.com/webhooks/warehouse-status \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer Token 1v1BBJrHcetwQtAZi45bgJGbz7ZIw7V9EXq43gFi95c91578" \
  -d '{
    "event": "updated",
    "subject": {
      "id": "TEST123",
      "status_id": "packaging"
    },
    "changes": {
      "attributes": {
        "status_id": "packaging"
      }
    }
  }'

# Expected response:
# {"success":false,"error":"Order not found",...}
# (404 is expected for test order ID)
```

---

## Bước 9: Verify Cron Jobs

### 9.1. Check Inventory Sync

Cron job tự động chạy mỗi giờ (minute 0).

**Verify trong logs**:

```bash
# Watch PM2 logs
pm2 logs shopify-app --lines 50

# Look for:
# [Cron] ✅ Inventory sync cron job scheduled (every hour at minute 0)
# [Inventory Sync] Starting inventory sync...
# [Inventory Sync] ✅ Inventory sync completed successfully
```

### 9.2. Manual Sync Test

```bash
# Test manual sync via API endpoint
curl -X POST https://shopify-app.yourdomain.com/api/sync-inventory \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer YOUR_SHOPIFY_SESSION_TOKEN"
```

---

## Bước 10: Monitoring và Logging

### 10.1. PM2 Monitoring

```bash
# Real-time monitoring
pm2 monit

# View app info
pm2 info shopify-app

# View logs
pm2 logs shopify-app

# View error logs only
pm2 logs shopify-app --err

# Clear logs
pm2 flush
```

### 10.2. Nginx Logs

```bash
# Access logs
sudo tail -f /var/log/nginx/shopify-app-access.log

# Error logs
sudo tail -f /var/log/nginx/shopify-app-error.log

# Search for errors
sudo grep "error" /var/log/nginx/shopify-app-error.log
```

### 10.3. System Monitoring

```bash
# Disk usage
df -h

# Memory usage
free -h

# CPU usage
top

# Node.js processes
ps aux | grep node
```

### 10.4. Setup Log Rotation

```bash
# Create logrotate config
sudo nano /etc/logrotate.d/shopify-app
```

Paste:

```
/var/log/pm2/shopify-app-*.log {
    daily
    rotate 14
    compress
    delaycompress
    notifempty
    missingok
    copytruncate
}
```

---

## Bước 11: Backup và Recovery

### 11.1. Database Backup

```bash
# Create backup script
nano ~/backup-db.sh
```

Paste:

```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/home/ubuntu/backups"
APP_DIR="/var/www/shopify-app"

# Create backup directory
mkdir -p $BACKUP_DIR

# Backup database
cp $APP_DIR/prisma/dev.db $BACKUP_DIR/dev.db.$DATE

# Keep only last 7 days
find $BACKUP_DIR -name "dev.db.*" -mtime +7 -delete

echo "Backup completed: dev.db.$DATE"
```

```bash
# Make executable
chmod +x ~/backup-db.sh

# Test backup
~/backup-db.sh

# Setup daily cron
crontab -e

# Add line:
0 2 * * * /home/ubuntu/backup-db.sh >> /home/ubuntu/backup.log 2>&1
```

### 11.2. Application Backup

```bash
# Backup app files
tar -czf ~/backups/app-$(date +%Y%m%d).tar.gz /var/www/shopify-app \
  --exclude=node_modules \
  --exclude=build \
  --exclude=prisma/dev.db

# Keep only last 3 backups
cd ~/backups
ls -t app-*.tar.gz | tail -n +4 | xargs rm -f
```

### 11.3. Restore from Backup

```bash
# Stop app
pm2 stop shopify-app

# Restore database
cp ~/backups/dev.db.20251030_020000 /var/www/shopify-app/prisma/dev.db

# Restart app
pm2 restart shopify-app
```

---

## Bước 12: Deployment Updates

### 12.1. Deploy Code Changes

```bash
# Connect to EC2
ssh -i shopify-app-key.pem ubuntu@<EC2_PUBLIC_IP>

# Navigate to app directory
cd /var/www/shopify-app

# Pull latest changes
git pull origin main

# Install new dependencies (if any)
npm install --production

# Run database migrations (if any)
npx prisma generate
npx prisma db push

# Rebuild app
npm run build

# Restart app with PM2
pm2 restart shopify-app

# Verify app is running
pm2 status
pm2 logs shopify-app --lines 50
```

### 12.2. Deployment Script

Tạo deployment script tự động:

```bash
nano ~/deploy.sh
```

Paste:

```bash
#!/bin/bash
set -e

APP_DIR="/var/www/shopify-app"
BACKUP_DIR="/home/ubuntu/backups"

echo "🚀 Starting deployment..."

# Backup current database
echo "📦 Backing up database..."
cp $APP_DIR/prisma/dev.db $BACKUP_DIR/dev.db.$(date +%Y%m%d_%H%M%S)

# Navigate to app directory
cd $APP_DIR

# Pull latest changes
echo "📥 Pulling latest changes..."
git pull origin main

# Install dependencies
echo "📦 Installing dependencies..."
npm install --production

# Generate Prisma client
echo "🔧 Generating Prisma client..."
npx prisma generate

# Push database schema
echo "🗄️ Updating database schema..."
npx prisma db push

# Build application
echo "🏗️ Building application..."
npm run build

# Restart with PM2
echo "🔄 Restarting application..."
pm2 restart shopify-app

# Check status
echo "✅ Deployment completed!"
pm2 status shopify-app
pm2 logs shopify-app --lines 20
```

```bash
# Make executable
chmod +x ~/deploy.sh

# Run deployment
~/deploy.sh
```

---

## Troubleshooting

### App không start

**Nguyên nhân**: Port conflict, missing dependencies, env vars

**Giải pháp**:

```bash
# Check if port 3000 is in use
sudo lsof -i :3000

# Check PM2 logs
pm2 logs shopify-app --err

# Verify .env file
cat /var/www/shopify-app/.env

# Verify Node.js version
node --version  # Should be v20.x

# Reinstall dependencies
cd /var/www/shopify-app
rm -rf node_modules package-lock.json
npm install --production
pm2 restart shopify-app
```

### SSL Certificate Error

**Nguyên nhân**: DNS not propagated, port 80/443 blocked

**Giải pháp**:

```bash
# Check DNS
nslookup shopify-app.yourdomain.com

# Check if Nginx is listening on 80/443
sudo netstat -tulpn | grep nginx

# Check Security Group rules (AWS Console)
# Ensure port 80 and 443 are open to 0.0.0.0/0

# Retry Certbot
sudo certbot --nginx -d shopify-app.yourdomain.com
```

### Webhook không nhận được

**Nguyên nhân**: Security Group rules, Nginx config, app not listening

**Giải pháp**:

```bash
# Test from external IP
curl https://shopify-app.yourdomain.com/webhooks/warehouse-status

# Check Nginx logs
sudo tail -f /var/log/nginx/shopify-app-error.log

# Check app logs
pm2 logs shopify-app

# Verify Security Group allows port 443 from warehouse IP
```

### Cron job không chạy

**Nguyên nhân**: App not running, env var disabled, error in sync logic

**Giải pháp**:

```bash
# Check ENABLE_INVENTORY_SYNC
grep ENABLE_INVENTORY_SYNC /var/www/shopify-app/.env

# Check PM2 logs for cron messages
pm2 logs shopify-app | grep Cron

# Manual test sync
curl -X POST https://shopify-app.yourdomain.com/api/sync-inventory

# Restart app
pm2 restart shopify-app
```

### Database errors

**Nguyên nhân**: Missing migrations, permissions, corrupted database

**Giải pháp**:

```bash
# Check database file
ls -la /var/www/shopify-app/prisma/dev.db

# Regenerate Prisma client
cd /var/www/shopify-app
npx prisma generate

# Reset database (⚠️ loses data)
rm prisma/dev.db
npx prisma db push

# Restore from backup
cp ~/backups/dev.db.YYYYMMDD_HHMMSS prisma/dev.db
pm2 restart shopify-app
```

### High memory usage

**Nguyên nhân**: Memory leak, too many requests, insufficient resources

**Giải pháp**:

```bash
# Monitor memory
free -h
pm2 info shopify-app

# Restart app to clear memory
pm2 restart shopify-app

# Increase max memory restart threshold in ecosystem.config.js
# max_memory_restart: '1G' -> '2G'

# Consider upgrading EC2 instance type
# t3.micro (1GB) -> t3.small (2GB)
```

---

## Security Checklist

- ✅ SSH key-based authentication (disable password auth)
- ✅ Security Group rules (only ports 22, 80, 443)
- ✅ SSL/TLS certificate (Let's Encrypt)
- ✅ Webhook authentication (Bearer token)
- ✅ Environment variables (không commit vào Git)
- ✅ Firewall enabled (ufw)
- ✅ Regular updates (apt update/upgrade)
- ✅ Database backup strategy
- ✅ PM2 logs rotation

### Additional Security Steps

```bash
# Disable password authentication
sudo nano /etc/ssh/sshd_config
# Set: PasswordAuthentication no
sudo systemctl restart sshd

# Enable firewall
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status

# Auto security updates
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

---

## Performance Optimization

### Enable Gzip Compression

```bash
sudo nano /etc/nginx/nginx.conf
```

Add inside `http` block:

```nginx
# Gzip compression
gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 6;
gzip_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss application/rss+xml font/truetype font/opentype application/vnd.ms-fontobject image/svg+xml;
```

```bash
sudo systemctl restart nginx
```

### Node.js Cluster Mode (Optional)

For high traffic, use PM2 cluster mode:

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'shopify-app',
    script: 'npm',
    args: 'start',
    instances: 'max',  // Use all CPU cores
    exec_mode: 'cluster',
    // ... rest of config
  }]
};
```

---

## Cost Optimization

### EC2 Instance Costs

| Instance Type | vCPU | RAM | Price (us-east-1) | Recommended For |
|---------------|------|-----|-------------------|-----------------|
| t3.micro | 2 | 1 GB | ~$7.50/month | Dev/Testing |
| t3.small | 2 | 2 GB | ~$15/month | Production (low traffic) |
| t3.medium | 2 | 4 GB | ~$30/month | Production (high traffic) |

### Cost Saving Tips

1. **Use Reserved Instances** - Save up to 72% với 1-year commitment
2. **Stop unused instances** - Dev instances sau giờ làm việc
3. **Enable detailed monitoring** chỉ khi cần troubleshoot
4. **Use CloudWatch alarms** để tắt instance khi không dùng

---

## Related Documentation

- [INVENTORY_SYNC_README.md](./INVENTORY_SYNC_README.md) - Inventory sync functionality
- [WAREHOUSE_STATUS_WEBHOOK_README.md](./WAREHOUSE_STATUS_WEBHOOK_README.md) - Webhook configuration
- [WAREHOUSE_ORDER_README.md](./WAREHOUSE_ORDER_README.md) - Order creation workflow
- [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) - Implementation progress

---

## Support

### AWS Support
- [EC2 Documentation](https://docs.aws.amazon.com/ec2/)
- [EC2 Troubleshooting](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-troubleshoot.html)

### Shopify Support
- [Shopify App Development](https://shopify.dev/docs/apps)
- [Shopify Remix Documentation](https://shopify.dev/docs/api/shopify-app-remix)

---

_Last updated: 2025-10-30_
