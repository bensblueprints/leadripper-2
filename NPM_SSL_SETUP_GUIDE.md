# Nginx Proxy Manager - SSL Certificate Setup Guide

**Critical:** All proxy hosts are created but SSL certificates need to be configured manually.

---

## Why SSL is Failing

The automated SSL certificate requests are failing because:
1. Cloudflare's proxy is blocking Let's Encrypt's HTTP-01 validation
2. NPM's API has strict requirements for the certificate request format
3. DNS-01 validation requires Cloudflare API integration

**Solution:** Configure SSL manually through the NPM web interface.

---

## Step-by-Step SSL Configuration

### 1. Login to Nginx Proxy Manager

**URL:** http://51.161.172.76:81
**Email:** ben@advancedmarketing.co
**Password:** JEsus777$$!

---

### 2. Configure SSL for clawdbot.army (Landing Page)

**A. Go to SSL Certificates Tab**
- Click **SSL Certificates** in the left sidebar
- Click **Add SSL Certificate**
- Select **Let's Encrypt**

**B. Certificate Details:**
- **Domain Names:** `clawdbot.army`, `www.clawdbot.army`
- **Email Address for Let's Encrypt:** `ben@advancedmarketing.co`
- **Use a DNS Challenge:** ✓ YES (required for Cloudflare proxy)
- **DNS Provider:** Select **Cloudflare**

**C. Cloudflare API Credentials:**
- **API Token:** `gaLiB4O0fu3NBvPlNe02pwogQud5A0v0E0HrJh7Q`
- (OR use Email + Global API Key if token doesn't work)

**D. Additional Options:**
- **Agree to Let's Encrypt TOS:** ✓
- **Propagation Seconds:** 120 (wait for DNS propagation)

Click **Save**

**E. Apply Certificate to Proxy Host:**
- Go to **Hosts > Proxy Hosts**
- Click the 3 dots next to **clawdbot.army**
- Click **Edit**
- Go to **SSL** tab
- Select the certificate you just created
- ✓ Force SSL
- ✓ HTTP/2 Support
- ✓ HSTS Enabled
- Click **Save**

---

### 3. Configure SSL for www.clawdbot.army

The certificate created in step 2 covers both `clawdbot.army` and `www.clawdbot.army`.

**Apply to www proxy host:**
- Go to **Hosts > Proxy Hosts**
- Click the 3 dots next to **www.clawdbot.army**
- Click **Edit**
- Go to **SSL** tab
- Select the same certificate as step 2
- ✓ Force SSL
- ✓ HTTP/2 Support
- ✓ HSTS Enabled
- Click **Save**

---

### 4. Configure SSL for admin.clawdbot.army (Proxmox)

**A. Create New Certificate:**
- Go to **SSL Certificates**
- Click **Add SSL Certificate**
- Select **Let's Encrypt**

**B. Certificate Details:**
- **Domain Names:** `admin.clawdbot.army`
- **Email Address:** `ben@advancedmarketing.co`
- **Use a DNS Challenge:** ☐ NO (admin subdomain is not proxied)
- **Agree to Let's Encrypt TOS:** ✓

Click **Save**

**C. Apply Certificate to Proxy Host:**
- Go to **Hosts > Proxy Hosts**
- Click the 3 dots next to **admin.clawdbot.army**
- Click **Edit**
- Go to **SSL** tab
- Select the certificate you just created
- ✓ Force SSL
- ✓ HTTP/2 Support
- ✓ HSTS Enabled
- Click **Save**

**D. Add Websocket Support (Critical for Proxmox Console):**
- While still in Edit mode for **admin.clawdbot.army**
- Go to **Details** tab
- ✓ Websockets Support
- Go to **Advanced** tab
- Add this custom Nginx config:

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_buffering off;
client_max_body_size 0;
proxy_read_timeout 36000s;
proxy_redirect off;
```

Click **Save**

---

### 5. Configure SSL for app.clawdbot.army (Future Dashboard)

**A. Create New Certificate:**
- Go to **SSL Certificates**
- Click **Add SSL Certificate**
- Select **Let's Encrypt**

**B. Certificate Details:**
- **Domain Names:** `app.clawdbot.army`
- **Email Address:** `ben@advancedmarketing.co`
- **Use a DNS Challenge:** ✓ YES (app subdomain is proxied)
- **DNS Provider:** Cloudflare
- **API Token:** `gaLiB4O0fu3NBvPlNe02pwogQud5A0v0E0HrJh7Q`

Click **Save**

**C. Apply Certificate to Proxy Host:**
- Go to **Hosts > Proxy Hosts**
- Click the 3 dots next to **app.clawdbot.army**
- Click **Edit**
- Go to **SSL** tab
- Select the certificate you just created
- ✓ Force SSL
- ✓ HTTP/2 Support
- ✓ HSTS Enabled
- Click **Save**

---

## Alternative: Disable Cloudflare Proxy Temporarily

If DNS challenge still fails:

**Option 1: Disable Cloudflare Proxy (Temporarily)**
1. Go to Cloudflare dashboard: https://dash.cloudflare.com
2. Select **clawdbot.army**
3. Go to **DNS** tab
4. Click the orange cloud next to `clawdbot.army` to make it gray (DNS only)
5. Wait 2 minutes for DNS propagation
6. Request Let's Encrypt certificate in NPM (HTTP challenge will work now)
7. Once certificate is issued, re-enable Cloudflare proxy (click gray cloud to make it orange)

**Option 2: Use HTTP Challenge with Proxy Disabled**
1. Temporarily disable Cloudflare proxy for all subdomains
2. In NPM SSL certificate creation, select **Use HTTP Challenge**
3. Request certificates
4. Re-enable Cloudflare proxy after certificates are issued

---

## Verification

After SSL is configured, test each domain:

**1. Test clawdbot.army:**
```bash
curl -I https://clawdbot.army
# Should return: HTTP/2 200
```

**2. Test admin.clawdbot.army:**
```bash
curl -I https://admin.clawdbot.army
# Should return: HTTP/2 200
```

**3. Open in browser:**
- https://clawdbot.army (landing page)
- https://admin.clawdbot.army (Proxmox login)

You should see a green padlock 🔒 in the browser address bar with valid SSL certificates.

---

## Troubleshooting

### "Unable to verify the first certificate"

**Cause:** Let's Encrypt certificate issuance failed

**Solutions:**
1. Ensure DNS has propagated (check with `dig clawdbot.army`)
2. Use DNS challenge for Cloudflare-proxied domains
3. Temporarily disable Cloudflare proxy for HTTP challenge
4. Check Cloudflare API token has correct permissions

### "502 Bad Gateway"

**Cause:** Backend service is down

**Solutions:**
```bash
# Check landing page container
ssh ovh-dedicated "pct status 400"
ssh ovh-dedicated "pct exec 400 -- systemctl status nginx"

# Check NPM container
ssh ovh-dedicated "pct status 201"
ssh ovh-dedicated "pct exec 201 -- docker ps"
```

### "504 Gateway Timeout"

**Cause:** Backend service is slow or not responding

**Solutions:**
1. Increase proxy timeout in NPM Advanced settings
2. Check backend service is actually running
3. Verify forward host IP and port are correct

---

## Current Proxy Host Configuration

| Domain | ID | Forward To | SSL | Status |
|--------|----|-----------| -----|--------|
| clawdbot.army | 1 | http://10.10.10.40:80 | ❌ Pending | 🟢 Online |
| www.clawdbot.army | 2 | http://10.10.10.40:80 | ❌ Pending | 🟢 Online |
| admin.clawdbot.army | 3 | https://51.161.172.76:8006 | ❌ Pending | 🟢 Online |
| app.clawdbot.army | 4 | http://10.10.10.50:80 | ❌ Pending | 🟢 Online |

**After SSL configuration, all should show ✅ SSL Enabled**

---

## Cloudflare API Token Permissions

Your API token needs these permissions for DNS challenge:

- **Zone:Zone:Read**
- **Zone:DNS:Edit**

If the token doesn't have these permissions, generate a new one:
1. Go to https://dash.cloudflare.com/profile/api-tokens
2. Click **Create Token**
3. Use template: **Edit Zone DNS**
4. Select zone: **clawdbot.army**
5. Generate token
6. Use the new token in NPM

---

**Last Updated:** February 20, 2026
**Support:** ben@advancedmarketing.co
