# Proxmox VPS Hosting - Credentials & SSH Keys

**⚠️ CONFIDENTIAL - DO NOT COMMIT TO GIT ⚠️**

---

## OVH Dedicated Server (PRIMARY)

### Server Details
- **IP Address:** 51.161.172.76
- **Hostname:** ns5037025.ip-51.161.172.net
- **Provider:** OVH
- **Server Name:** ns5037025

### SSH Access
- **Username:** root
- **Password:** ZfSofdW1vq1BtuHP (expires in 7 days from install date)
- **SSH Key:** ~/.ssh/ovh_small
- **Quick Connect:** `ssh ovh-dedicated`

### SSH Public Key (Already Added to Server)
```
ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDui0edWWnS+bqCE37R1HXRj64KiNsxYvruIyqu92g8hJpOydwBnzx9E3fAdNq5TUIXielJCkpb13/Ta/hU0knwxIhpd4tK7oWUROs6PrYs0Z7ztee9FbTtBPIwqmMHIxTMgmqKY8RiSa9KjbgrisBs42Dal7FbFp++h5mxT7Z43Xsg+6zGp3HdQ6fVPxowGZPwf5/jB5imBkXKyqWXaLNxhTXX69X4DrwvQRoA2i2rMpPy9bs924OGYGCdu7kLRjs3v2FH3Y7Gsk4BK8HbOCzVJBNblF4tHdh7tpIAITMno1EB7Tbf+dOcDIgEcKM5TRVhcyQ/xD8uepPoqgb2Iz1X ovh-server
```

### Proxmox Web Interface
- **URL:** https://51.161.172.76:8006
- **Username:** root
- **Password:** ZfSofdW1vq1BtuHP
- **Realm:** Linux PAM standard authentication

---

## Hetzner Server (SECONDARY - Not Yet Configured)

### Server Details
- **IP Address:** 46.62.157.83
- **Provider:** Hetzner
- **Status:** Debian 12 installed, awaiting configuration

### SSH Access
- **Username:** root
- **Password:** sNCFhhLFFx9MJseMJMAq (may require change on first login)
- **SSH Key:** ~/.ssh/hetzner_rsa

### SSH Public Key (Added to Hetzner Panel)
```
ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQDq+rnsbBQMeaCMvlPnHXyD21UTxY6Sz+PGVSyN0RCE5IzbRVhsO2vik5YYqCNk5bemx13P3gIEHSuttY/sLz2YmLRBE534DjlQ4XCWcP1TE8kHsQltpoO33nuSJWFIdC7RZxwJxvQaUKyWUm+mI3/4DpLHDV5X7ZHnP4u0NlfmLMV0S9hGCBWLp6P/6n+uFboATc/I3QP0k13X4Pmmhqku9Sg3yBcRKIAwReBuW7uE5VTmHxA0L3GHB93cvTpK+lkAKhumQGtQgqqknfvwQU/Lfs94mTg8P2F46dwZkCPU2AVHEBV1fiixKQxGKx+HBItkkQf7lWh7Rk9UhKXRYgS0Czi1qkCr5sZNtENkC5dfJR9g9lBBiQSKazSz2PhBZ4wepRstLQX2vFTkTv5iCIYvcGuARWu58jWhk8OJrRmlSiYUtLBNeMxF67cUmKPtWf1HNFbCMzmsq0a49/br+0ptmoiSQOWD+MIRQwbl1AY7aMH7KjXDY16qlRNfAvHu2oVImFT51f/Nh28gQF1zyK3TGfQlGunTDmtsLsmSt+ial5XvBf+0BnRi19QEfQMt4zALLY/rq7pbX3PlR+btVLzzG1FoS48DC6XEyBex0+MbkA4QEBEqcvErxN+XFV31sN8tk4OO8lO76lgI5QhYS3ny090jNKZbobgaU2CHkuYEwQ== hetzner-proxmox-server
```

---

## SSH Private Keys (Backed Up Locally)

### OVH Server Key Location
```bash
~/.ssh/ovh_small          # Private key (2048-bit RSA)
~/.ssh/ovh_small.pub      # Public key
```

### Hetzner Server Key Location
```bash
~/.ssh/hetzner_rsa        # Private key (4096-bit RSA)
~/.ssh/hetzner_rsa.pub    # Public key
```

---

## SSH Config

Location: `~/.ssh/config`

```bash
# OVH Dedicated Server (Proxmox VPS Hosting)
Host ovh-dedicated
    HostName 51.161.172.76
    User root
    IdentityFile ~/.ssh/ovh_small
    IdentitiesOnly yes
    StrictHostKeyChecking accept-new

# Hetzner Server (Backup/Secondary)
Host hetzner-proxmox
    HostName 46.62.157.83
    User root
    IdentityFile ~/.ssh/hetzner_rsa
    IdentitiesOnly yes
    StrictHostKeyChecking accept-new
```

---

## How to Resume This Project

### Step 1: Copy SSH Keys to New Computer
```bash
# From old computer, copy the entire .ssh directory
scp -r ~/.ssh/ovh_small* user@new-computer:~/.ssh/
scp -r ~/.ssh/hetzner_rsa* user@new-computer:~/.ssh/

# Or manually recreate the keys from the private key backup
# (You should have these saved in your password manager)
```

### Step 2: Set Proper Permissions
```bash
chmod 700 ~/.ssh
chmod 600 ~/.ssh/ovh_small
chmod 600 ~/.ssh/hetzner_rsa
chmod 644 ~/.ssh/ovh_small.pub
chmod 644 ~/.ssh/hetzner_rsa.pub
```

### Step 3: Add SSH Config
```bash
# Copy the SSH config from above into ~/.ssh/config
cat >> ~/.ssh/config << 'EOFSSH'
# OVH Dedicated Server (Proxmox VPS Hosting)
Host ovh-dedicated
    HostName 51.161.172.76
    User root
    IdentityFile ~/.ssh/ovh_small
    IdentitiesOnly yes
    StrictHostKeyChecking accept-new
EOFSSH
```

### Step 4: Test Connection
```bash
ssh ovh-dedicated "hostname && pveversion"
# Should output: ns5037025 and Proxmox version info
```

### Step 5: Continue Building
Refer to PROXMOX_VPS_HOSTING_SETUP.md for the complete roadmap and next steps.

---

## Email Setup for Project Transfer

To transfer this project to another computer:

1. **Email these files to ben@advancedmarketing.co:**
   - PROXMOX_VPS_HOSTING_SETUP.md (full project documentation)
   - PROXMOX_CREDENTIALS.md (this file with all credentials)

2. **Backup SSH keys separately** (do NOT email private keys):
   - Store in password manager or encrypted USB drive
   - ~/.ssh/ovh_small (private key)
   - ~/.ssh/hetzner_rsa (private key)

3. **On new computer:**
   - Install SSH keys from secure backup
   - Copy SSH config
   - Test connection
   - Resume from Phase 2 in the setup document

---

## Important Security Notes

- **Password Expiry:** OVH password expires in 7 days from install - change it ASAP if needed
- **Root Access:** All servers currently allow root login - disable this after setting up sudo user
- **SSH Keys:** Keep private keys secure - NEVER commit to git or email unencrypted
- **Proxmox Password:** Change default root password through web UI: Datacenter > Permissions > Users
- **API Tokens:** When creating WHMCS integration, generate dedicated API tokens (more secure than password)

---

## Future Security Improvements

1. Create dedicated sudo user (disable root SSH login)
2. Install fail2ban for brute-force protection
3. Configure UFW firewall (allow only 22, 80, 443, 8006)
4. Replace self-signed SSL cert with Let's Encrypt
5. Enable 2FA for Proxmox web interface
6. Regular security updates: `apt update && apt upgrade -y`

---

**Last Updated:** February 20, 2026
**Saved By:** Claude Code AI Assistant
**Contact:** ben@advancedmarketing.co
