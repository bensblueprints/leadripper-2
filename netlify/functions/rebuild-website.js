const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2026';
const DEFAULT_NETLIFY_TOKEN = process.env.NETLIFY_DEPLOY_TOKEN || 'nfp_2r8NMnaW5BxpaWHWXXu6ZbePvQAQjqkp682b';

function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try { return jwt.verify(authHeader.split(' ')[1], JWT_SECRET); } catch { return null; }
}

// ── Scrape the lead's website and extract structured content ──
async function scrapeWebsite(url) {
  if (!url.startsWith('http')) url = 'https://' + url;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  let html;
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      redirect: 'follow'
    });
    html = await res.text();
  } catch (err) {
    console.error('Scrape fetch error:', err.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }

  // Strip scripts, styles, and comments for cleaner text extraction
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const content = {};

  // Title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  content.title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';

  // Meta description
  const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["']/i)
    || html.match(/<meta[^>]*content=["']([\s\S]*?)["'][^>]*name=["']description["']/i);
  content.metaDescription = metaDescMatch ? metaDescMatch[1].trim() : '';

  // Headings
  content.h1s = [];
  const h1Regex = /<h1[^>]*>([\s\S]*?)<\/h1>/gi;
  let m;
  while ((m = h1Regex.exec(cleaned)) !== null) {
    const text = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text) content.h1s.push(text);
  }

  content.h2s = [];
  const h2Regex = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
  while ((m = h2Regex.exec(cleaned)) !== null) {
    const text = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text) content.h2s.push(text);
  }

  // Paragraphs (first 10 meaningful ones)
  content.paragraphs = [];
  const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  while ((m = pRegex.exec(cleaned)) !== null && content.paragraphs.length < 10) {
    const text = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text.length > 20) content.paragraphs.push(text);
  }

  // Phone numbers
  const phoneRegex = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/g;
  const phones = cleaned.replace(/<[^>]+>/g, '').match(phoneRegex);
  content.phone = phones ? phones[0] : '';

  // Email addresses
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emails = cleaned.replace(/<[^>]+>/g, '').match(emailRegex);
  content.email = emails ? emails[0] : '';

  // Address patterns
  const addressRegex = /\d{1,5}\s+[\w\s.]+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway)[.,]?\s*(?:(?:Suite|Ste|Apt|Unit|#)\s*\w+[.,]?\s*)?[\w\s]+,\s*[A-Z]{2}\s*\d{5}/gi;
  const addresses = cleaned.replace(/<[^>]+>/g, '').match(addressRegex);
  content.address = addresses ? addresses[0].trim() : '';

  // List items (often services)
  content.listItems = [];
  const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  while ((m = liRegex.exec(cleaned)) !== null && content.listItems.length < 12) {
    const text = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text.length > 3 && text.length < 100) content.listItems.push(text);
  }

  return content;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── Generate a modern single-page website from extracted content ──
function generateWebsite(content, businessName, leadData) {
  const name = businessName || content.title || 'Business Name';
  const tagline = content.metaDescription || content.h1s[0] || `Welcome to ${name}`;
  const phone = leadData.contact_phone || content.phone || '';
  const email = leadData.contact_email || content.email || '';
  const address = content.address || '';

  // Build about text from paragraphs
  const aboutText = content.paragraphs.slice(0, 3).join(' ') ||
    `${name} is dedicated to providing exceptional service to our customers. With years of experience and a commitment to quality, we deliver results that exceed expectations.`;

  // Build services from h2s and list items
  let services = [];
  if (content.h2s.length > 0) {
    services = content.h2s.filter(h => h.length < 60).slice(0, 6);
  }
  if (services.length < 3 && content.listItems.length > 0) {
    const extras = content.listItems.filter(li => !services.includes(li)).slice(0, 6 - services.length);
    services = services.concat(extras);
  }
  if (services.length === 0) {
    services = ['Professional Service', 'Quality Solutions', 'Customer Support'];
  }

  const icons = [
    `<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>`,
    `<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>`,
    `<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"/></svg>`,
    `<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`,
    `<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>`,
    `<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>`
  ];

  const servicesHtml = services.map((s, i) => `
          <div class="bg-white rounded-2xl shadow-lg p-8 hover:shadow-xl transition-all duration-300 hover:-translate-y-1 border border-gray-100">
            <div class="w-14 h-14 bg-gradient-to-br from-amber-400 to-amber-500 rounded-xl flex items-center justify-center text-white mb-5">
              ${icons[i % icons.length]}
            </div>
            <h3 class="text-xl font-bold text-gray-900 mb-3">${escapeHtml(s)}</h3>
            <p class="text-gray-600 leading-relaxed">Professional ${escapeHtml(s.toLowerCase())} services tailored to meet your specific needs and exceed your expectations.</p>
          </div>`).join('\n');

  const phoneHtml = phone ? `
              <div class="flex items-center space-x-4">
                <div class="w-12 h-12 bg-amber-500/20 rounded-xl flex items-center justify-center">
                  <svg class="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
                </div>
                <div>
                  <p class="text-sm text-gray-400 uppercase tracking-wider">Phone</p>
                  <a href="tel:${escapeHtml(phone)}" class="text-white hover:text-amber-400 transition-colors text-lg">${escapeHtml(phone)}</a>
                </div>
              </div>` : '';

  const emailHtml = email ? `
              <div class="flex items-center space-x-4">
                <div class="w-12 h-12 bg-amber-500/20 rounded-xl flex items-center justify-center">
                  <svg class="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
                </div>
                <div>
                  <p class="text-sm text-gray-400 uppercase tracking-wider">Email</p>
                  <a href="mailto:${escapeHtml(email)}" class="text-white hover:text-amber-400 transition-colors text-lg">${escapeHtml(email)}</a>
                </div>
              </div>` : '';

  const addressHtml = address ? `
              <div class="flex items-center space-x-4">
                <div class="w-12 h-12 bg-amber-500/20 rounded-xl flex items-center justify-center">
                  <svg class="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                </div>
                <div>
                  <p class="text-sm text-gray-400 uppercase tracking-wider">Address</p>
                  <p class="text-white text-lg">${escapeHtml(address)}</p>
                </div>
              </div>` : '';

  const ctaPhone = phone ? `tel:${phone}` : `mailto:${email || '#'}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(name)} — Modern Website Redesign</title>
  <meta name="description" content="${escapeHtml(tagline)}">
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    * { font-family: 'Inter', sans-serif; }
    .gradient-hero { background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%); }
    .gradient-gold { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); }
    .glass { backdrop-filter: blur(10px); background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); }
    .animate-fade-up { animation: fadeUp 0.8s ease-out forwards; opacity: 0; transform: translateY(30px); }
    @keyframes fadeUp { to { opacity: 1; transform: translateY(0); } }
    .animate-delay-1 { animation-delay: 0.2s; }
    .animate-delay-2 { animation-delay: 0.4s; }
    .animate-delay-3 { animation-delay: 0.6s; }
    html { scroll-behavior: smooth; }
  </style>
</head>
<body class="bg-gray-50 text-gray-900 antialiased">

  <!-- Navigation -->
  <nav class="fixed top-0 w-full z-50 transition-all duration-300" id="navbar">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex items-center justify-between h-20">
        <a href="#" class="text-2xl font-bold text-white tracking-tight">${escapeHtml(name)}</a>
        <div class="hidden md:flex items-center space-x-8">
          <a href="#about" class="text-gray-300 hover:text-amber-400 transition-colors font-medium">About</a>
          <a href="#services" class="text-gray-300 hover:text-amber-400 transition-colors font-medium">Services</a>
          <a href="#contact" class="text-gray-300 hover:text-amber-400 transition-colors font-medium">Contact</a>
          <a href="${ctaPhone}" class="gradient-gold text-white px-6 py-2.5 rounded-full font-semibold hover:opacity-90 transition-opacity shadow-lg shadow-amber-500/25">Get in Touch</a>
        </div>
        <button class="md:hidden text-white" onclick="document.getElementById('mobile-menu').classList.toggle('hidden')">
          <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
        </button>
      </div>
      <div id="mobile-menu" class="hidden md:hidden pb-4">
        <a href="#about" class="block py-2 text-gray-300 hover:text-amber-400 font-medium">About</a>
        <a href="#services" class="block py-2 text-gray-300 hover:text-amber-400 font-medium">Services</a>
        <a href="#contact" class="block py-2 text-gray-300 hover:text-amber-400 font-medium">Contact</a>
        <a href="${ctaPhone}" class="block mt-2 gradient-gold text-white text-center px-6 py-2.5 rounded-full font-semibold">Get in Touch</a>
      </div>
    </div>
  </nav>

  <!-- Hero Section -->
  <section class="gradient-hero min-h-screen flex items-center relative overflow-hidden">
    <div class="absolute inset-0 opacity-10">
      <div class="absolute top-20 left-10 w-72 h-72 bg-amber-500 rounded-full filter blur-3xl"></div>
      <div class="absolute bottom-20 right-10 w-96 h-96 bg-blue-500 rounded-full filter blur-3xl"></div>
    </div>
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-32 relative z-10">
      <div class="max-w-3xl">
        <div class="animate-fade-up">
          <span class="inline-block gradient-gold text-white text-sm font-semibold px-4 py-1.5 rounded-full mb-6 shadow-lg shadow-amber-500/25">Welcome to ${escapeHtml(name)}</span>
        </div>
        <h1 class="text-5xl md:text-6xl lg:text-7xl font-black text-white leading-tight mb-6 animate-fade-up animate-delay-1">
          ${escapeHtml(tagline.length > 80 ? tagline.substring(0, 80) + '...' : tagline)}
        </h1>
        <p class="text-xl text-gray-400 mb-10 leading-relaxed animate-fade-up animate-delay-2 max-w-2xl">
          ${escapeHtml(aboutText.substring(0, 200))}${aboutText.length > 200 ? '...' : ''}
        </p>
        <div class="flex flex-col sm:flex-row gap-4 animate-fade-up animate-delay-3">
          <a href="${ctaPhone}" class="gradient-gold text-white px-8 py-4 rounded-full font-bold text-lg hover:opacity-90 transition-opacity shadow-lg shadow-amber-500/25 text-center">
            Contact Us Today
          </a>
          <a href="#services" class="glass text-white px-8 py-4 rounded-full font-bold text-lg hover:bg-white/10 transition-all text-center">
            Our Services
          </a>
        </div>
      </div>
    </div>
    <div class="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
      <svg class="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"/></svg>
    </div>
  </section>

  <!-- About Section -->
  <section id="about" class="py-24 bg-white">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="grid lg:grid-cols-2 gap-16 items-center">
        <div>
          <span class="text-amber-500 font-semibold text-sm uppercase tracking-wider">About Us</span>
          <h2 class="text-4xl md:text-5xl font-black text-gray-900 mt-3 mb-6 leading-tight">Why Choose<br><span class="text-amber-500">${escapeHtml(name)}</span>?</h2>
          <p class="text-lg text-gray-600 leading-relaxed mb-6">${escapeHtml(aboutText)}</p>
          <div class="grid grid-cols-2 gap-6 mt-8">
            <div class="text-center p-4 rounded-2xl bg-gray-50">
              <div class="text-3xl font-black text-amber-500">10+</div>
              <div class="text-sm text-gray-500 mt-1">Years Experience</div>
            </div>
            <div class="text-center p-4 rounded-2xl bg-gray-50">
              <div class="text-3xl font-black text-amber-500">500+</div>
              <div class="text-sm text-gray-500 mt-1">Happy Clients</div>
            </div>
            <div class="text-center p-4 rounded-2xl bg-gray-50">
              <div class="text-3xl font-black text-amber-500">100%</div>
              <div class="text-sm text-gray-500 mt-1">Satisfaction</div>
            </div>
            <div class="text-center p-4 rounded-2xl bg-gray-50">
              <div class="text-3xl font-black text-amber-500">24/7</div>
              <div class="text-sm text-gray-500 mt-1">Support</div>
            </div>
          </div>
        </div>
        <div class="relative">
          <div class="bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl p-10 shadow-2xl">
            <div class="space-y-6">
              <div class="flex items-center space-x-3">
                <div class="w-10 h-10 gradient-gold rounded-full flex items-center justify-center">
                  <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                </div>
                <span class="text-white font-medium">Professional &amp; Reliable</span>
              </div>
              <div class="flex items-center space-x-3">
                <div class="w-10 h-10 gradient-gold rounded-full flex items-center justify-center">
                  <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                </div>
                <span class="text-white font-medium">Trusted by Local Businesses</span>
              </div>
              <div class="flex items-center space-x-3">
                <div class="w-10 h-10 gradient-gold rounded-full flex items-center justify-center">
                  <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                </div>
                <span class="text-white font-medium">Exceptional Quality Guaranteed</span>
              </div>
              <div class="flex items-center space-x-3">
                <div class="w-10 h-10 gradient-gold rounded-full flex items-center justify-center">
                  <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                </div>
                <span class="text-white font-medium">Competitive Pricing</span>
              </div>
            </div>
          </div>
          <div class="absolute -top-4 -right-4 w-24 h-24 gradient-gold rounded-2xl -z-10 opacity-50"></div>
          <div class="absolute -bottom-4 -left-4 w-32 h-32 bg-slate-200 rounded-2xl -z-10"></div>
        </div>
      </div>
    </div>
  </section>

  <!-- Services Section -->
  <section id="services" class="py-24 bg-gray-50">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="text-center max-w-3xl mx-auto mb-16">
        <span class="text-amber-500 font-semibold text-sm uppercase tracking-wider">What We Offer</span>
        <h2 class="text-4xl md:text-5xl font-black text-gray-900 mt-3 mb-4">Our Services</h2>
        <p class="text-lg text-gray-600">Explore our comprehensive range of professional services designed to help your business succeed.</p>
      </div>
      <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
${servicesHtml}
      </div>
    </div>
  </section>

  <!-- CTA Section -->
  <section class="py-20 gradient-hero relative overflow-hidden">
    <div class="absolute inset-0 opacity-10">
      <div class="absolute top-10 right-20 w-64 h-64 bg-amber-500 rounded-full filter blur-3xl"></div>
    </div>
    <div class="max-w-4xl mx-auto px-4 text-center relative z-10">
      <h2 class="text-4xl md:text-5xl font-black text-white mb-6">Ready to Get Started?</h2>
      <p class="text-xl text-gray-400 mb-10 max-w-2xl mx-auto">Take the first step towards transforming your business. Contact us today for a free consultation.</p>
      <div class="flex flex-col sm:flex-row gap-4 justify-center">
        <a href="${ctaPhone}" class="gradient-gold text-white px-10 py-4 rounded-full font-bold text-lg hover:opacity-90 transition-opacity shadow-lg shadow-amber-500/25">
          ${phone ? 'Call Us Now' : 'Contact Us'}
        </a>
        <a href="#contact" class="border-2 border-white/30 text-white px-10 py-4 rounded-full font-bold text-lg hover:bg-white/10 transition-all">
          Learn More
        </a>
      </div>
    </div>
  </section>

  <!-- Contact Section -->
  <section id="contact" class="py-24 bg-slate-900">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="grid lg:grid-cols-2 gap-16">
        <div>
          <span class="text-amber-500 font-semibold text-sm uppercase tracking-wider">Get in Touch</span>
          <h2 class="text-4xl md:text-5xl font-black text-white mt-3 mb-6">Contact Us</h2>
          <p class="text-gray-400 text-lg mb-10 leading-relaxed">We would love to hear from you. Reach out to us and let us know how we can help your business grow.</p>
          <div class="space-y-6">
${phoneHtml}
${emailHtml}
${addressHtml}
          </div>
        </div>
        <div class="glass rounded-3xl p-8">
          <form class="space-y-5" onsubmit="event.preventDefault(); alert('Thank you! We will be in touch soon.');">
            <div>
              <label class="block text-sm font-medium text-gray-300 mb-2">Full Name</label>
              <input type="text" required class="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors" placeholder="John Smith">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-300 mb-2">Email Address</label>
              <input type="email" required class="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors" placeholder="john@example.com">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-300 mb-2">Phone Number</label>
              <input type="tel" class="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors" placeholder="(555) 123-4567">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-300 mb-2">Message</label>
              <textarea rows="4" required class="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors resize-none" placeholder="Tell us about your project..."></textarea>
            </div>
            <button type="submit" class="w-full gradient-gold text-white py-4 rounded-xl font-bold text-lg hover:opacity-90 transition-opacity shadow-lg shadow-amber-500/25">
              Send Message
            </button>
          </form>
        </div>
      </div>
    </div>
  </section>

  <!-- Footer -->
  <footer class="bg-slate-950 py-12">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex flex-col md:flex-row items-center justify-between gap-4">
        <div class="text-gray-500 text-sm">&copy; ${new Date().getFullYear()} ${escapeHtml(name)}. All rights reserved.</div>
        <div class="text-gray-600 text-xs">Website redesign powered by <a href="https://advancedmarketing.co" target="_blank" class="text-amber-500 hover:text-amber-400 transition-colors">Advanced Marketing</a></div>
      </div>
    </div>
  </footer>

  <!-- Sticky navbar background on scroll -->
  <script>
    window.addEventListener('scroll', function() {
      var nav = document.getElementById('navbar');
      if (window.scrollY > 50) {
        nav.style.background = 'rgba(15, 23, 42, 0.95)';
        nav.style.backdropFilter = 'blur(10px)';
        nav.style.boxShadow = '0 4px 30px rgba(0,0,0,0.3)';
      } else {
        nav.style.background = 'transparent';
        nav.style.backdropFilter = 'none';
        nav.style.boxShadow = 'none';
      }
    });
  </script>
</body>
</html>`;
}

// ── Deploy generated HTML to Netlify ──
async function deployToNetlify(html, siteName, NETLIFY_TOKEN) {
  // 1. Create the site
  const createRes = await fetch('https://api.netlify.com/api/v1/sites', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + NETLIFY_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name: siteName })
  });

  let site;
  if (!createRes.ok) {
    // If name is taken, retry with random suffix
    if (createRes.status === 422) {
      const fallbackName = siteName + '-' + Math.random().toString(36).substring(2, 6);
      const retryRes = await fetch('https://api.netlify.com/api/v1/sites', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + NETLIFY_TOKEN,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: fallbackName })
      });
      if (!retryRes.ok) {
        throw new Error('Netlify create site failed: ' + retryRes.status + ' - ' + await retryRes.text());
      }
      site = await retryRes.json();
      siteName = fallbackName;
    } else {
      throw new Error('Netlify create site failed: ' + createRes.status + ' - ' + await createRes.text());
    }
  } else {
    site = await createRes.json();
  }

  const siteId = site.site_id || site.id;

  // 2. Create a deploy with file digest
  const sha1 = crypto.createHash('sha1').update(html).digest('hex');
  const deployRes = await fetch('https://api.netlify.com/api/v1/sites/' + siteId + '/deploys', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + NETLIFY_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ files: { '/index.html': sha1 } })
  });

  if (!deployRes.ok) {
    throw new Error('Netlify deploy failed: ' + deployRes.status + ' - ' + await deployRes.text());
  }

  const deploy = await deployRes.json();

  // 3. Upload the actual file content
  const uploadRes = await fetch('https://api.netlify.com/api/v1/deploys/' + deploy.id + '/files/index.html', {
    method: 'PUT',
    headers: {
      'Authorization': 'Bearer ' + NETLIFY_TOKEN,
      'Content-Type': 'application/octet-stream'
    },
    body: html
  });

  if (!uploadRes.ok) {
    throw new Error('Netlify file upload failed: ' + uploadRes.status + ' - ' + await uploadRes.text());
  }

  return {
    url: site.ssl_url || 'https://' + siteName + '.netlify.app',
    siteId: siteId
  };
}

// ── Main handler ──
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Verify auth
  const user = verifyToken(event.headers.authorization || event.headers.Authorization);
  if (!user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const {
      leadId,
      url,
      business_name,
      contact_email,
      contact_phone,
      contact_name
    } = body;

    if (!leadId || !url) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields: leadId, url' })
      };
    }

    // Read user's Netlify token from settings, fallback to default
    let userNetlifyToken = DEFAULT_NETLIFY_TOKEN;
    try {
      const settingsResult = await pool.query(
        'SELECT netlify_token FROM lr_user_settings WHERE user_id = $1',
        [user.userId]
      );
      if (settingsResult.rows.length > 0 && settingsResult.rows[0].netlify_token) {
        userNetlifyToken = settingsResult.rows[0].netlify_token;
      }
    } catch (e) {
      console.log('Could not read user netlify_token, using default:', e.message);
    }

    // Ensure DB columns exist
    await pool.query(`
      ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS website_rebuilt_at TIMESTAMP;
      ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS rebuild_phase VARCHAR(50);
      ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS rebuild_status VARCHAR(20);
      ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS rebuild_progress INTEGER;
      ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS rebuild_message TEXT;
      ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS rebuild_preview_url TEXT;
      ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS rebuilt_website_url TEXT;
      ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS rebuild_updated_at TIMESTAMP;
    `);

    // Mark as in-progress
    await pool.query(
      `UPDATE lr_leads SET
        rebuild_phase = 'scrape',
        rebuild_status = 'in_progress',
        rebuild_progress = 10,
        rebuild_message = 'Scraping original website...',
        rebuild_updated_at = NOW()
      WHERE id = $1 AND user_id = $2`,
      [leadId, user.userId]
    );

    // ── Phase 1: Scrape the website ──
    const scrapedContent = await scrapeWebsite(url);

    if (!scrapedContent) {
      await pool.query(
        `UPDATE lr_leads SET
          rebuild_progress = 15,
          rebuild_message = 'Could not scrape site, using submitted info...',
          rebuild_updated_at = NOW()
        WHERE id = $1 AND user_id = $2`,
        [leadId, user.userId]
      );
    }

    const content = scrapedContent || {
      title: business_name || '',
      metaDescription: '',
      h1s: [],
      h2s: [],
      paragraphs: [],
      phone: contact_phone || '',
      email: contact_email || '',
      address: '',
      listItems: []
    };

    // ── Phase 2: Generate the website from template ──
    await pool.query(
      `UPDATE lr_leads SET
        rebuild_phase = 'rebuild',
        rebuild_progress = 30,
        rebuild_message = 'Building your new website...',
        rebuild_updated_at = NOW()
      WHERE id = $1 AND user_id = $2`,
      [leadId, user.userId]
    );

    const generatedHtml = generateWebsite(content, business_name, {
      contact_phone: contact_phone,
      contact_email: contact_email
    });

    // ── Phase 3: Deploy to Netlify ──
    await pool.query(
      `UPDATE lr_leads SET
        rebuild_phase = 'deploy',
        rebuild_progress = 60,
        rebuild_message = 'Deploying preview site...',
        rebuild_updated_at = NOW()
      WHERE id = $1 AND user_id = $2`,
      [leadId, user.userId]
    );

    const slug = (business_name || 'lead-site')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 40);
    const siteName = 'lr-' + slug + '-' + leadId;

    const deployResult = await deployToNetlify(generatedHtml, siteName, userNetlifyToken);

    // ── Phase 4: Save results to DB ──
    await pool.query(
      `UPDATE lr_leads SET
        rebuild_phase = 'complete',
        rebuild_status = 'complete',
        rebuild_progress = 100,
        rebuild_message = 'Website rebuild complete!',
        rebuild_preview_url = $1,
        rebuilt_website_url = $1,
        website_rebuilt_at = NOW(),
        rebuild_updated_at = NOW()
      WHERE id = $2 AND user_id = $3`,
      [deployResult.url, leadId, user.userId]
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Website rebuilt for ' + (business_name || 'lead'),
        lead_id: leadId,
        preview_url: deployResult.url
      })
    };

  } catch (error) {
    console.error('Rebuild error:', error);

    // Try to mark as failed in DB
    try {
      const body = JSON.parse(event.body);
      const user2 = verifyToken(event.headers.authorization || event.headers.Authorization);
      if (body.leadId && user2) {
        await pool.query(
          `UPDATE lr_leads SET
            rebuild_status = 'failed',
            rebuild_message = $1,
            rebuild_updated_at = NOW()
          WHERE id = $2 AND user_id = $3`,
          [error.message.substring(0, 500), body.leadId, user2.userId]
        );
      }
    } catch (e2) {
      console.error('Failed to update error status:', e2.message);
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Rebuild failed: ' + error.message })
    };
  }
};
