# SPICA TIDE — CouchDB Sync Deployment Guide

## Overview

SPICA TIDE uses CouchDB for multi-device sync between 2-4 computers on the vessel.
The app works 100% offline — sync happens automatically when internet is available.

## Option 1: Railway (Recommended)

### Step 1: Create Railway account
1. Go to https://railway.app
2. Sign up with GitHub
3. Create a new project

### Step 2: Deploy CouchDB
1. Click "New" → "Database" → search for "CouchDB"
2. Or use Docker template:
   - Click "New" → "Docker Image"
   - Image: `couchdb:3`
   - Add environment variables:
     ```
     COUCHDB_USER=admin
     COUCHDB_PASSWORD=your-secure-password
     ```
3. Railway will assign a public URL like `https://couchdb-production-xxxx.up.railway.app`

### Step 3: Enable CORS
After deployment, access CouchDB Fauxton UI:
```
https://YOUR-URL/_utils/
```
Login with admin credentials, then run these in the config:
```
curl -X PUT https://admin:password@YOUR-URL/_node/_local/_config/httpd/enable_cors -d '"true"'
curl -X PUT https://admin:password@YOUR-URL/_node/_local/_config/cors/origins -d '"*"'
curl -X PUT https://admin:password@YOUR-URL/_node/_local/_config/cors/credentials -d '"true"'
curl -X PUT https://admin:password@YOUR-URL/_node/_local/_config/cors/methods -d '"GET, PUT, POST, HEAD, DELETE"'
curl -X PUT https://admin:password@YOUR-URL/_node/_local/_config/cors/headers -d '"accept, authorization, content-type, origin, referer"'
```

### Step 4: Create database
```bash
curl -X PUT https://admin:password@YOUR-URL/spica_tide
```

### Step 5: Configure app
In SPICA TIDE:
1. Open Smart Tools → Sync section
2. Enter your Railway CouchDB URL
3. Database name: `spica_tide`
4. Username: `admin`
5. Password: your password
6. Click "Test Connection" → should show green checkmark
7. Click "Save & Enable"

## Option 2: Render.com

### Step 1: Create Render account
Go to https://render.com and sign up.

### Step 2: Deploy CouchDB
1. New → Web Service → Docker
2. Image URL: `docker.io/library/couchdb:3`
3. Environment: `COUCHDB_USER=admin`, `COUCHDB_PASSWORD=your-password`
4. Port: 5984
5. Plan: Starter ($7/mo) or free tier

### Step 3: Enable CORS and create DB
Same as Railway Step 3 and 4 above.

## Option 3: Self-hosted (VPS)

```bash
# On any Ubuntu/Debian VPS
sudo apt update && sudo apt install -y couchdb
# Choose "standalone" during setup
# Set admin password when prompted
# Edit /etc/couchdb/local.ini:
#   [chttpd] bind_address = 0.0.0.0
#   [httpd] enable_cors = true
#   [cors] origins = *
sudo systemctl restart couchdb

# Create database
curl -X PUT http://admin:password@localhost:5984/spica_tide

# Set up HTTPS via nginx reverse proxy with Let's Encrypt
```

## Security Notes

- Always use HTTPS (Railway/Render provide this automatically)
- Use strong admin password
- The database stores deck cargo plans — not sensitive personal data
- CORS is set to `*` for simplicity — restrict to your app origin in production
- Credentials are stored locally in the app's localStorage (future: tauri-plugin-store)

## Troubleshooting

| Issue | Solution |
|---|---|
| "Connection failed" | Check URL has `https://`, no trailing slash |
| CORS error in console | Verify CORS config on CouchDB (Step 3) |
| 401 Unauthorized | Check username/password |
| Sync stuck on "Syncing..." | Check CouchDB is running, database exists |
| Conflict toast | Normal — another device saved first. Your data was merged. |

## Cost

- **Railway**: Free tier (500 hours/month) or $5/mo for always-on
- **Render**: Free tier (spins down after inactivity) or $7/mo
- **Self-hosted**: Cost of VPS (~$5/mo on DigitalOcean/Hetzner)

CouchDB uses very little resources for this use case (~50MB RAM, <1GB storage).
