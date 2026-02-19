# LeadRipper.com Domain Setup Instructions

## ✅ Completed
- Marketing site built and deployed to Netlify
- Live at: https://leadripper.netlify.app
- Netlify Site ID: `1dadeb61-8e1f-48db-9ccf-dff912531b20`

## 🔧 Next Steps (Manual Setup Required)

### Step 1: Add LeadRipper.com to Cloudflare

1. Go to: https://dash.cloudflare.com
2. Click "Add a Site"
3. Enter: `leadripper.com`
4. Select the Free plan
5. Click "Add Site"

Cloudflare will scan your existing DNS records from Namecheap.

### Step 2: Update Namecheap Nameservers

1. Log in to Namecheap: https://ap.www.namecheap.com/
2. Go to Domain List → leadripper.com → Manage
3. Find "Nameservers" section
4. Select "Custom DNS"
5. Enter these nameservers:
   ```
   elijah.ns.cloudflare.com
   monika.ns.cloudflare.com
   ```
6. Click "Save"

**Note:** DNS propagation can take 24-48 hours, but usually completes within 1-2 hours.

### Step 3: Configure DNS in Cloudflare

Once the nameservers are updated and Cloudflare shows the domain as "Active":

1. Go to: DNS → Records
2. Delete any existing A/CNAME records for the root domain and www
3. Add these records:

**Root Domain:**
- Type: `CNAME`
- Name: `@`
- Target: `leadripper.netlify.app`
- Proxy status: ✅ Proxied (orange cloud)

**WWW Subdomain:**
- Type: `CNAME`
- Name: `www`
- Target: `leadripper.netlify.app`
- Proxy status: ✅ Proxied (orange cloud)

### Step 4: Configure Custom Domain in Netlify

1. Go to: https://app.netlify.com/sites/leadripper/settings/domain
2. Click "Add domain alias"
3. Enter: `leadripper.com`
4. Click "Verify"
5. Add another alias: `www.leadripper.com`

### Step 5: Enable HTTPS

Netlify will automatically provision an SSL certificate through Let's Encrypt once DNS is configured correctly. This usually takes 1-2 minutes.

## 🔍 Verification Checklist

Once setup is complete, verify:

- [ ] `http://leadripper.com` redirects to `https://leadripper.com`
- [ ] `https://www.leadripper.com` works
- [ ] SSL certificate is valid (no browser warnings)
- [ ] All CTA buttons link to `https://leadforge.advancedmarketing.co`
- [ ] Site loads with Data Brutalism design (dark theme, red accents)

## 📋 Current Site Features

✅ Hero section with "RIP LEADS FROM ANY MARKET"
✅ Live stats: 2.5M+ leads, 98% accuracy, 15K+ users
✅ 6 feature blocks with hover effects
✅ Pricing grid: $29/$79/$149/$297 tiers
✅ CTA section linking to app
✅ Responsive mobile design
✅ Custom cursor effects
✅ Scroll animations

## 🚨 Important Notes

- Site content is production-ready
- All "Launch App" buttons link to: `https://leadforge.advancedmarketing.co`
- Redirects configured:
  - `/app` → leadforge.advancedmarketing.co
  - `/login` → leadforge.advancedmarketing.co
  - `/signup` → leadforge.advancedmarketing.co

## 🛠️ Future Updates

To update the site:
1. Edit files in: `/Users/blackhat01/leadripper-marketing/`
2. Commit changes: `git add . && git commit -m "Update message"`
3. Ask for code 777 authorization
4. Deploy: `netlify deploy --prod`

## 📞 Support

- Netlify Admin: https://app.netlify.com/sites/leadripper
- Cloudflare Dashboard: https://dash.cloudflare.com
- Live Site: https://leadripper.netlify.app (temp URL)
- Production: https://leadripper.com (after DNS setup)
