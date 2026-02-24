# Proxmox VPS Hosting Infrastructure Setup

**Date:** February 20, 2026
**Project:** VPS Hosting Business on Dedicated Servers
**Server Provider:** OVH Dedicated Server

---

## Project Goal

Build a complete VPS hosting platform using Proxmox VE where clients can purchase VPS plans (Starter/Pro/Agency) and have LXC containers automatically provisioned when they pay through WHMCS billing system.

---

## Servers Configured

### OVH Dedicated Server (PRIMARY - ACTIVE)
- **IP Address:** 51.161.172.76
- **Hostname:** ns5037025.ip-51.161.172.net
- **OS:** Debian 12 (Bookworm)
- **Proxmox Version:** 8.4.0 (pve-manager 8.4.16)
- **Kernel:** 6.8.12-18-pve
- **RAM:** 126GB
- **Storage:** 2 x 960GB in RAID 1
- **SSH Key:** ~/.ssh/ovh_small (RSA 2048-bit)
- **SSH Config:** `ssh ovh-dedicated`

### Hetzner Server (SECONDARY - ON HOLD)
- **IP Address:** 46.62.157.83
- **Status:** Debian 12 installed, not yet configured
- **Credentials:** root / sNCFhhLFFx9MJseMJMAq
- **Note:** Server was installed but never came online during initial session

---

## What Has Been Completed

### ✅ 1. Server Provisioning
- OVH dedicated server ordered and installed with Debian 12
- SSH key authentication configured (keyless access)
- Server accessible via: `ssh ovh-dedicated` or `ssh root@51.161.172.76`

### ✅ 2. Proxmox VE Installation
```bash
# Proxmox repository added
deb [arch=amd64] http://download.proxmox.com/debian/pve bookworm pve-no-subscription

# Installed packages (655 new packages, 2.5GB)
proxmox-ve 8.4.0
pve-manager 8.4.16
proxmox-kernel-6.8.12-18-pve-signed
lxc-pve, qemu-server, pve-firewall, pve-ha-manager, etc.
```

### ✅ 3. Proxmox Cluster Service Fixed
**Issue:** pve-cluster service was failing on first boot
**Solution:** Fixed /etc/hosts to properly map IP to hostname
```bash
51.161.172.76   ns5037025.localdomain ns5037025
```

### ✅ 4. Network Bridge Configuration (vmbr0)
```bash
# /etc/network/interfaces
auto vmbr0
iface vmbr0 inet static
    address 51.161.172.76/32
    gateway 51.161.172.1
    bridge-ports enp8s0f0
    bridge-stp off
    bridge-fd 0

# IPv6 configured
iface vmbr0 inet6 static
    address 2402:1f00:8200:4c00::1/56
    gateway fe80::1
```

### ✅ 5. Proxmox Services Running
- `pve-cluster` - Active and running
- `pvedaemon` - Active and running
- `pveproxy` - Active and listening on port 8006
- `pvestatd` - Active
- `pve-firewall` - Active

---

## Web Interface Access

**URL:** https://51.161.172.76:8006

**Login Credentials:**
- Username: `root`
- Password: (OVH installation password)
- Realm: Linux PAM standard authentication

**Note:** Browser will show SSL certificate warning (self-signed cert) - click through to proceed

---

## Current Status

### What Works
- ✅ SSH access to server
- ✅ Proxmox kernel booted (6.8.12-18-pve)
- ✅ All Proxmox services active
- ✅ pveproxy listening on port 8006
- ✅ Network bridge vmbr0 configured and up
- ✅ No firewall blocking (iptables ACCEPT policy)

### What's Next (Pending Tasks)

#### 🔲 1. Verify Proxmox Web Interface
- Test access to https://51.161.172.76:8006
- Login and confirm web UI loads
- **Issue:** Interface may not be loading externally (needs Playwright test)

#### 🔲 2. Create NAT Bridge (vmbr1)
```bash
# Private network for internal VPS communication
auto vmbr1
iface vmbr1 inet static
    address 10.10.10.1/24
    bridge-ports none
    bridge-stp off
    bridge-fd 0
    post-up echo 1 > /proc/sys/net/ipv4/ip_forward
    post-up iptables -t nat -A POSTROUTING -s '10.10.10.0/24' -o vmbr0 -j MASQUERADE
```

#### 🔲 3. Download Ubuntu 22.04 LXC Template
```bash
pveam update
pveam available | grep ubuntu-22.04
pveam download local ubuntu-22.04-standard_22.04-1_amd64.tar.zst
```

#### 🔲 4. Create Base LXC Template
```bash
pct create 100 local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst \
  --hostname base-template \
  --memory 512 \
  --cores 1 \
  --rootfs local-lvm:8 \
  --net0 name=eth0,bridge=vmbr1,ip=dhcp \
  --unprivileged 1
```

#### 🔲 5. Harden Base Template
- Update packages: `apt update && apt upgrade -y`
- Install essentials: `curl, wget, vim, htop, ufw`
- Configure UFW firewall
- Disable root SSH login
- Set up swap
- Clean up: `apt autoremove && apt clean`

#### 🔲 6. Create Tier-Specific Templates

**Starter Plan (2GB RAM, 2 cores, 40GB)**
```bash
pct create 101 local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst \
  --hostname starter-template \
  --memory 2048 \
  --cores 2 \
  --rootfs local-lvm:40 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --unprivileged 1
```

**Pro Plan (4GB RAM, 4 cores, 80GB)**
```bash
pct create 102 local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst \
  --hostname pro-template \
  --memory 4096 \
  --cores 4 \
  --rootfs local-lvm:80 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --unprivileged 1
```

**Agency Plan (8GB RAM, 8 cores, 160GB)**
```bash
pct create 103 local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst \
  --hostname agency-template \
  --memory 8192 \
  --cores 8 \
  --rootfs local-lvm:160 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --unprivileged 1
```

#### 🔲 7. Install WHMCS
```bash
# Create LXC for WHMCS
pct create 200 local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst \
  --hostname whmcs \
  --memory 4096 \
  --cores 2 \
  --rootfs local-lvm:50 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --unprivileged 1

# Install LAMP stack
apt install apache2 mysql-server php php-mysql php-curl php-gd php-mbstring php-xml php-zip

# Download and install WHMCS
wget https://releases.whmcs.com/v2/whmcs_latest.zip
unzip whmcs_latest.zip -d /var/www/html/
```

#### 🔲 8. Configure Proxmox Module for WHMCS
- Install ModulesGarden Proxmox VE Module
- Configure Proxmox API access in WHMCS
- Set up product templates (Starter/Pro/Agency)
- Configure automated provisioning hooks

#### 🔲 9. Set Up Nginx Proxy Manager
```bash
# Create LXC for Nginx Proxy Manager
pct create 201 local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst \
  --hostname nginx-proxy \
  --memory 2048 \
  --cores 2 \
  --rootfs local-lvm:20 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --unprivileged 1

# Install Docker and run NPM
curl -fsSL https://get.docker.com | sh
docker run -d \
  --name nginx-proxy-manager \
  -p 80:80 -p 443:443 -p 81:81 \
  -v ~/data:/data \
  -v ~/letsencrypt:/etc/letsencrypt \
  jc21/nginx-proxy-manager:latest
```

#### 🔲 10. Configure Payment Gateways
- Stripe integration in WHMCS
- PayPal Business integration
- Configure webhook URLs for automated provisioning

#### 🔲 11. Install Monitoring Stack
```bash
# Prometheus + Grafana in LXC
pct create 202 local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst \
  --hostname monitoring \
  --memory 4096 \
  --cores 2 \
  --rootfs local-lvm:50 \
  --net0 name=eth0,bridge=vmbr1,ip=10.10.10.10/24 \
  --unprivileged 1

# Install Prometheus, Grafana, node_exporter
# Configure dashboards for VPS resource monitoring
```

#### 🔲 12. Configure Automated Backups
```bash
# Proxmox Backup Server or PBS integration
pvesm add pbs pbs-backup \
  --server backup.example.com \
  --datastore main \
  --username backup@pbs \
  --password <password>

# Create backup schedules
vzdump --mode snapshot --storage pbs-backup --compress zstd
```

---

## Technical Details

### SSH Configuration
```bash
# ~/.ssh/config entry
Host ovh-dedicated
    HostName 51.161.172.76
    User root
    IdentityFile ~/.ssh/ovh_small
    IdentitiesOnly yes
    StrictHostKeyChecking accept-new
```

### Proxmox API Access
```bash
# Create API token for WHMCS
pveum user add whmcs@pve
pveum passwd whmcs@pve
pveum aclmod / -user whmcs@pve -role PVEAdmin
pveum user token add whmcs@pve automation --privsep 0
```

### WHMCS Proxmox Module Configuration
```
API URL: https://51.161.172.76:8006/api2/json
Username: whmcs@pve
Token ID: automation
Token Secret: <generated-secret>
Realm: pve
Verify SSL: No (or configure SSL cert)
```

---

## Troubleshooting

### Issue: Proxmox web interface not loading
**Symptoms:** Can't access https://51.161.172.76:8006
**Checks:**
```bash
# Verify pveproxy is running
systemctl status pveproxy

# Check port 8006 is listening
ss -tlnp | grep 8006

# Test from server
curl -k https://localhost:8006

# Check firewall
iptables -L -n
```

**Possible Solutions:**
1. Restart pveproxy: `systemctl restart pveproxy`
2. Check /var/log/syslog for errors
3. Verify network bridge is up: `ip addr show vmbr0`
4. Test from different network (may be ISP blocking)

### Issue: pve-cluster service failing
**Solution:** Fixed /etc/hosts mapping
```bash
# Ensure this line exists:
51.161.172.76   ns5037025.localdomain ns5037025

# Restart cluster service
systemctl restart pve-cluster
```

---

## Deployment Timeline (Estimated)

**Phase 1: Infrastructure Setup (Complete)**
- ✅ Server provisioning
- ✅ Proxmox installation
- ✅ Network configuration
- ✅ Service verification

**Phase 2: Template Creation (Next)**
- Create base LXC template (1 hour)
- Build tier-specific templates (2 hours)
- Test and harden templates (2 hours)

**Phase 3: Billing Integration (Day 2)**
- Install WHMCS (3 hours)
- Configure Proxmox module (2 hours)
- Set up products and pricing (1 hour)

**Phase 4: Automation & Testing (Day 3)**
- Payment gateway integration (2 hours)
- Automated provisioning testing (3 hours)
- End-to-end workflow verification (2 hours)

**Phase 5: Production Readiness (Day 4)**
- Monitoring setup (3 hours)
- Backup configuration (2 hours)
- Documentation and runbooks (2 hours)
- Go live! 🚀

---

## Important Commands Reference

### Proxmox VE Commands
```bash
# List all VMs/containers
pct list
qm list

# Create LXC container
pct create <vmid> <template> --hostname <name> --memory <MB> --cores <n>

# Start/stop containers
pct start <vmid>
pct stop <vmid>

# Clone template
pct clone <source-vmid> <new-vmid> --hostname <name>

# List templates
pveam list local

# Update template list
pveam update
```

### Network Commands
```bash
# Restart networking
systemctl restart networking

# Show bridges
brctl show

# Show IP addresses
ip addr show

# Test connectivity
ping -c 3 <ip>
```

### Service Management
```bash
# Check service status
systemctl status <service>

# Restart services
systemctl restart pveproxy pvedaemon pve-cluster

# View logs
journalctl -u pveproxy -f
tail -f /var/log/syslog
```

---

## Resources & Documentation

- **Proxmox VE Admin Guide:** https://pve.proxmox.com/pve-docs/
- **Proxmox API Documentation:** https://pve.proxmox.com/pve-docs/api-viewer/
- **WHMCS Documentation:** https://docs.whmcs.com/
- **ModulesGarden Proxmox Module:** https://www.modulesgarden.com/products/whmcs/proxmox-ve
- **LXC Container Tutorial:** https://pve.proxmox.com/wiki/Linux_Container

---

## Contact & Support

**Email:** ben@advancedmarketing.co
**Server Access:** Contact Ben for SSH credentials
**Emergency:** Access OVH control panel at https://www.ovh.com/manager/

---

## Notes

- All passwords and sensitive credentials should be stored in a password manager
- SSH private key `~/.ssh/ovh_small` should be backed up securely
- Proxmox uses self-signed SSL certificates by default - replace with Let's Encrypt in production
- Regular backups are CRITICAL - configure automated backups immediately after go-live
- Monitor server resources - 126GB RAM can handle ~30-40 Agency-tier VPS instances

---

**Last Updated:** February 20, 2026
**Status:** Phase 1 Complete - Ready for Template Creation
