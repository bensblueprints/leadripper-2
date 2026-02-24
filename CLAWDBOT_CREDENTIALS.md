# ClawdBot.Army - Platform Credentials

**⚠️ CONFIDENTIAL - DO NOT COMMIT TO GIT ⚠️**

---

## Production Server (OVH Dedicated)

### Server Access
- **IP Address:** 51.161.172.76
- **Hostname:** ns5037025.ip-51.161.172.net
- **SSH:** `ssh ovh-dedicated` (uses ~/.ssh/ovh_small)
- **OS:** Debian 12 with Proxmox VE 8.4.0

### Proxmox Web Interface
- **URL:** https://51.161.172.76:8006
- **Username:** root
- **Password:** ZfSofdW1vq1BtuHP
- **Realm:** Linux PAM standard authentication

### Proxmox API
- **Endpoint:** https://51.161.172.76:8006/api2/json
- **Token ID:** root@pam!automation
- **Token Secret:** ce0e89ba-da6f-4677-921d-85645e44f0bf
- **Permissions:** Full admin (PVEAdmin)

### Nginx Proxy Manager
- **URL:** http://51.161.172.76:81
- **Email:** ben@advancedmarketing.co
- **Password:** JEsus777$$!
- **Container IP:** 10.10.10.20
- **VMID:** 201

---

## DNS & Domain

### Domain
- **Domain:** clawdbot.army
- **Registrar:** Namecheap
- **DNS Provider:** Cloudflare
- **Zone ID:** 2b21a7b44036f1b38937415ca27af940

### Cloudflare API
- **API Token:** gaLiB4O0fu3NBvPlNe02pwogQud5A0v0E0HrJh7Q
- **Dashboard:** https://dash.cloudflare.com

### DNS Records Configured
```
Type: A     | Name: @      | Content: 51.161.172.76 | Proxy: ON
Type: CNAME | Name: www    | Content: clawdbot.army | Proxy: ON
Type: A     | Name: admin  | Content: 51.161.172.76 | Proxy: OFF (DNS only)
Type: A     | Name: app    | Content: 51.161.172.76 | Proxy: ON
Type: A     | Name: *      | Content: 51.161.172.76 | Proxy: ON (wildcard)
```

---

## Subdomains

### Landing Page
- **URL:** https://clawdbot.army
- **Container VMID:** 400
- **Container IP:** 10.10.10.40
- **Service:** Nginx web server

### Admin Panel
- **URL:** https://admin.clawdbot.army
- **Target:** Proxmox VE (51.161.172.76:8006)
- **Purpose:** Server management interface

### App Dashboard (Future)
- **URL:** https://app.clawdbot.army
- **Container VMID:** TBD
- **Container IP:** 10.10.10.50 (planned)
- **Purpose:** User bot management console

---

## Bot Tier Templates

### Solo Bot (VMID 101)
- **Resources:** 1GB RAM, 1 core, 5GB storage
- **Hostname:** solo-bot-template
- **Password:** ClaudeBot123!
- **Network:** vmbr0 (public bridge)
- **Max Instances:** 117

### Team Bot (VMID 102)
- **Resources:** 3GB RAM, 2 cores, 10GB storage
- **Hostname:** team-bot-template
- **Password:** ClaudeBot123!
- **Network:** vmbr0 (public bridge)
- **Max Instances:** 39

### Army Bot (VMID 103)
- **Resources:** 5GB RAM, 3 cores, 15GB storage
- **Hostname:** army-bot-template
- **Password:** ClaudeBot123!
- **Network:** vmbr0 (public bridge)
- **Max Instances:** 23

---

## Server Capacity

**Total Resources:**
- RAM: 126GB (117GB usable after system overhead)
- CPU: 12 cores
- Storage: 878GB available

**Proven Capacity for 50+ Users:**
- 30 Solo Bots = 30GB RAM
- 15 Team Bots = 45GB RAM
- 8 Army Bots = 40GB RAM
- **Total:** 115GB RAM (2GB headroom)

---

## Network Configuration

### Public Bridge (vmbr0)
- **IP:** 51.161.172.76/32
- **Gateway:** 51.161.172.1
- **Purpose:** Direct internet access for bot containers
- **Interface:** enp8s0f0

### NAT Bridge (vmbr1)
- **Network:** 10.10.10.0/24
- **Gateway:** 10.10.10.1
- **Purpose:** Internal services (NPM, landing page, future services)
- **MASQUERADE:** Enabled

### Port Forwarding (iptables)
```bash
# Forward public ports to NPM container
80  → 10.10.10.20:80   (HTTP)
443 → 10.10.10.20:443  (HTTPS)
81  → 10.10.10.20:81   (NPM Admin)
```

---

## Security Notes

### Firewall
- **Proxmox Firewall:** Active
- **iptables:** Configured for port forwarding
- **Open Ports:** 22 (SSH), 80 (HTTP), 443 (HTTPS), 8006 (Proxmox), 81 (NPM Admin)

### SSL Certificates
- **Proxmox:** Self-signed (internal use)
- **Public Domains:** Let's Encrypt (via Nginx Proxy Manager)
  - clawdbot.army
  - www.clawdbot.army
  - admin.clawdbot.army
  - app.clawdbot.army

### Passwords to Rotate Regularly
- Proxmox root password (expires 7 days after install)
- Nginx Proxy Manager password (changed from default)
- Bot template passwords
- Proxmox API token (rotate every 90 days)

---

## Emergency Access

### If Locked Out of Proxmox Web Interface
```bash
# SSH into server
ssh ovh-dedicated

# Restart pveproxy service
systemctl restart pveproxy

# Check service status
systemctl status pveproxy

# Regenerate SSL certificates if needed
pvecm updatecerts --force
```

### If DNS is Not Resolving
```bash
# Check Cloudflare DNS
dig clawdbot.army @1.1.1.1

# Verify DNS records in Cloudflare dashboard
# https://dash.cloudflare.com → clawdbot.army → DNS

# Re-run DNS setup script if needed
/tmp/cloudflare_dns_setup.sh
```

### If NPM is Down
```bash
# SSH into server
ssh ovh-dedicated

# Check NPM container status
pct status 201

# Start NPM container if stopped
pct start 201

# Check Docker container inside NPM
pct exec 201 -- docker ps
pct exec 201 -- docker restart nginx-proxy-manager
```

---

## Backup Credentials

**Store these credentials in:**
- Password manager (1Password, Bitwarden, LastPass)
- Encrypted USB drive (air-gapped backup)
- Print hardcopy and store in safe

**DO NOT:**
- Commit to Git repositories
- Email unencrypted
- Store in plaintext on cloud storage
- Share via unsecured channels

---

**Last Updated:** February 20, 2026
**Owner:** Benjamin Tate - ben@advancedmarketing.co
**Platform:** ClawdBot.Army
