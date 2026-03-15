const fs = require('fs');
const path = require('path');

const outputFile = path.join(__dirname, '365-day-content-calendar.md');

// Start date: Day 32 = April 17, 2026
const startDate = new Date(2026, 2, 17); // March 17, 2026 = Day 1

const platforms = ['LinkedIn', 'X/Twitter', 'Instagram', 'Email Newsletter', 'Facebook', 'Blog', 'LinkedIn', 'X/Twitter', 'Instagram', 'Facebook'];
const contentTypes = {
  'LinkedIn': ['Post', 'Post', 'Post', 'Carousel'],
  'X/Twitter': ['Thread (5 tweets)', 'Single post', 'Thread (4 tweets)', 'Single post'],
  'Instagram': ['Carousel', 'Single image post', 'Reel script', 'Carousel'],
  'Email Newsletter': ['Newsletter'],
  'Facebook': ['Post'],
  'Blog': ['Blog Post']
};

const monthThemes = [
  '', // Month 1 already done
  'DEEP DIVES & EDUCATION',
  'SOCIAL PROOF & CASE STUDIES',
  'COMPETITOR INTEL & POSITIONING',
  'SUMMER SELLING SEASON',
  'ADVANCED STRATEGIES',
  'MID-YEAR REVIEW & SCALING',
  'INDUSTRY SPOTLIGHTS',
  'BACK TO BUSINESS',
  'Q4 SPRINT & URGENCY',
  'BLACK FRIDAY & DEALS',
  'YEAR-END CLOSE & 2027 PLANNING'
];

const monthThemeDescriptions = [
  '',
  'Feature deep dives, how-to content, building authority',
  'Results, testimonials, social proof, case studies',
  'Why LeadRipper beats alternatives, positioning against competitors',
  'Seasonal selling, summer campaigns, vacation automation',
  'Multi-channel strategies, advanced sequences, power user tips',
  'Review H1 results, scale what works, double down',
  'Deep dives into specific industries and niches',
  'Back to work energy, Q3 pipeline, fresh starts',
  'Year-end urgency, Q4 closing strategies, budget season',
  'Black Friday deals, holiday promos, annual planning',
  'Reflect on the year, plan 2027, lifetime deal final push'
];

// Content angles - rotating through all 16 topics
const angles = [
  'cold_email', 'lead_gen', 'deliverability', 'data_service',
  'lifetime_deal', 'credit_value', 'ai_calling', 'website_rebuild',
  'case_study', 'competitor', 'pain_point', 'tutorial',
  'social_proof', 'industry_specific', 'email_template', 'roi_calculator'
];

// Industries to rotate through
const industries = [
  'roofing', 'plumbing', 'HVAC', 'landscaping', 'dental', 'chiropractic',
  'real estate', 'restaurant', 'auto repair', 'law firm', 'accounting',
  'insurance', 'fitness/gym', 'salon/spa', 'photography', 'cleaning service',
  'pest control', 'moving company', 'veterinary', 'mortgage broker',
  'marketing agency', 'web design agency', 'consulting', 'coaching',
  'e-commerce', 'SaaS', 'construction', 'electrical', 'painting',
  'flooring', 'solar', 'property management'
];

// Seasonal hooks by month
const seasonalHooks = {
  3: ['Q1 wrap-up', 'spring cleaning', 'new quarter energy'],
  4: ['Tax Day', 'Earth Day', 'spring growth', 'Q2 kickoff'],
  5: ["Mother's Day", 'Memorial Day', 'summer prep', 'Cinco de Mayo'],
  6: ["Father's Day", 'summer solstice', 'mid-year check', 'Q2 closing'],
  7: ['Independence Day', 'summer slump myth', 'mid-year review', 'vacation automation'],
  8: ['back to school', 'summer final push', 'Q3 momentum', 'Labor Day prep'],
  9: ['Labor Day', 'fall kickoff', 'Q4 planning', 'back to business'],
  10: ['Halloween', 'Q4 sprint', 'year-end budget', 'Black Friday prep'],
  11: ['Thanksgiving', 'Black Friday', 'Cyber Monday', 'gratitude'],
  12: ['holiday season', 'year-end review', 'New Year prep', 'annual planning'],
  1: ['New Year', 'fresh start', 'Q1 goals', 'resolution energy'],
  2: ["Valentine's Day", 'Q1 momentum', 'leap into action', 'love your pipeline']
};

// Cold email templates bank
const emailTemplates = [
  {
    name: 'The Compliment Opener',
    subject: '{first_name} — impressed by {company_name}',
    body: `Hey {first_name},

I came across {company_name} while researching {industry} businesses in {city}. Your {rating}-star rating with {review_count} reviews stood out — clearly you're doing something right.

I help {industry} businesses like yours get 15-30 more customers per month through targeted outreach. I recently helped a similar business in {city} add $8K/month in revenue within 90 days.

Worth a quick 10-minute call to see if I can do the same for {company_name}?`
  },
  {
    name: 'The Data Play',
    subject: 'Quick data on {company_name}',
    body: `Hey {first_name},

I ran a quick analysis on {industry} businesses in {city}. Here's what I found about {company_name}:

- Google rating: {rating}/5
- Reviews: {review_count}
- Website score: [score]/100

The top-performing businesses in your area are doing 2-3 things differently. I'd love to share what I found — it might help {company_name} get more customers without spending more on ads.

10 minutes this week?`
  },
  {
    name: 'The Problem Solver',
    subject: 'Noticed something about {website}',
    body: `Hey {first_name},

I was looking at {website} and noticed a few things that might be costing {company_name} potential customers:

[Specific issue based on website score]

I actually put together a quick sample of what your site could look like — no obligation, just wanted to show you what's possible: [rebuilt URL]

Worth a look?`
  },
  {
    name: 'The Social Proof Play',
    subject: '{first_name} — case study for {industry}',
    body: `Hey {first_name},

I recently helped a {industry} business in [nearby city] increase their monthly leads by 340% in 60 days.

They went from relying on word-of-mouth to getting 25+ inbound calls per week.

I think {company_name} could see similar results based on your current online presence.

Quick call to discuss? I'll share the exact playbook we used.`
  },
  {
    name: 'The Direct Ask',
    subject: 'Can I help {company_name}?',
    body: `Hey {first_name},

Simple question: Is {company_name} looking for more customers right now?

If yes, I have a proven system that brings {industry} businesses 15-30 new customers per month without paid ads.

If no, no worries at all — just delete this email.

If maybe, let's do a quick 10-minute call so I can show you how it works.

What say you?`
  }
];

// Competitor comparison data
const competitors = [
  { name: 'Apollo.io', price: '$99-399/mo', weakness: 'Database data (not real-time), no website rebuilding, no AI calling, no warmup' },
  { name: 'ZoomInfo', price: '$15,000+/yr', weakness: 'Expensive, enterprise-only, stale database, long contracts' },
  { name: 'Hunter.io', price: '$99-399/mo', weakness: 'Email finder only, no scraping, no sequences, no AI features' },
  { name: 'Instantly.ai', price: '$97-358/mo', weakness: 'Cold email only, no lead scraping, no AI calling, no website tools' },
  { name: 'Smartlead', price: '$39-94/mo', weakness: 'Email only, no lead data, no AI calling, no website analysis' },
  { name: 'Lemlist', price: '$59-99/mo', weakness: 'No lead scraping, limited AI features, no website rebuilding' },
  { name: 'Woodpecker', price: '$49-80/mo', weakness: 'Email only, no lead data, no AI features, limited tracking' },
  { name: 'Reply.io', price: '$60-120/mo', weakness: 'Multichannel but no lead scraping, no website AI, higher cost' }
];

// Pain points bank
const painPoints = [
  'Spending hours manually searching Google for leads',
  'Paying thousands for stale, recycled lead databases',
  'Emails landing in spam because of poor deliverability',
  'No time to follow up with every prospect',
  'Using 5+ different tools for outbound sales',
  'Cold calling is soul-crushing and inefficient',
  'Buying lists full of dead emails and spam traps',
  'Pipeline dries up every time you get busy with client work',
  "Can't afford enterprise tools like ZoomInfo",
  'No way to personalize at scale',
  'Website proposals take hours to create',
  "Don't know which leads are worth pursuing",
  'Sales team burning out on manual prospecting',
  'Competitors are outpacing you with automation',
  'Wasting ad budget on leads that never convert',
  'CRM is a mess of spreadsheets and sticky notes'
];

// ROI calculations bank
const roiCalcs = [
  { scenario: 'Marketing Agency', dealSize: 2000, closesPerMonth: 3, annualRev: 72000, lrCost: 348, roi: '20,589%' },
  { scenario: 'Web Designer', dealSize: 3000, closesPerMonth: 2, annualRev: 72000, lrCost: 348, roi: '20,589%' },
  { scenario: 'SaaS Company', dealSize: 500, closesPerMonth: 5, annualRev: 30000, lrCost: 948, roi: '3,064%' },
  { scenario: 'IT/MSP Provider', dealSize: 2500, closesPerMonth: 2, annualRev: 60000, lrCost: 348, roi: '17,141%' },
  { scenario: 'Insurance Agent', dealSize: 1200, closesPerMonth: 4, annualRev: 57600, lrCost: 348, roi: '16,452%' },
  { scenario: 'Real Estate Agent', dealSize: 5000, closesPerMonth: 1, annualRev: 60000, lrCost: 348, roi: '17,141%' },
  { scenario: 'Business Consultant', dealSize: 3000, closesPerMonth: 2, annualRev: 72000, lrCost: 348, roi: '20,589%' },
  { scenario: 'Recruiting Agency', dealSize: 8000, closesPerMonth: 1, annualRev: 96000, lrCost: 948, roi: '10,026%' }
];

// Tutorial topics
const tutorialTopics = [
  'How to set up your first lead scraping campaign in 5 minutes',
  'How to validate 1,000 emails in under 2 minutes',
  'How to build a 4-step cold email sequence that converts',
  'How to use Web Ripper AI to score and rebuild websites',
  'How to set up AI calling with Sales Ripper',
  'How to build workflow automations for hands-free outbound',
  'How to use the CRM pipeline to never lose a deal',
  'How to A/B test subject lines for maximum open rates',
  'How to use merge tags for personalization at scale',
  'How to warm up a new email account properly',
  'How to set up SPF, DKIM, and DMARC for your domain',
  'How to write cold emails that avoid spam filters',
  'How to segment leads by rating and review count',
  'How to create a website rebuild portfolio for prospecting',
  'How to track and optimize cold email campaigns',
  'How to use credit packs for maximum value'
];

function getDate(dayNum) {
  const d = new Date(startDate);
  d.setDate(d.getDate() + dayNum - 1);
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function getMonthNum(dayNum) {
  const d = new Date(startDate);
  d.setDate(d.getDate() + dayNum - 1);
  return d.getMonth(); // 0-indexed
}

function getMonthIndex(dayNum) {
  // Month 1 = days 1-31, Month 2 = days 32-61, etc.
  return Math.floor((dayNum - 1) / 30.4) + 1;
}

function getPlatform(dayNum) {
  return platforms[dayNum % platforms.length];
}

function getContentType(platform, dayNum) {
  const types = contentTypes[platform];
  return types[dayNum % types.length];
}

function isHardSell(dayNum) {
  return dayNum % 4 === 0;
}

function getAngle(dayNum) {
  return angles[dayNum % angles.length];
}

function getIndustry(dayNum) {
  return industries[dayNum % industries.length];
}

function getCompetitor(dayNum) {
  return competitors[dayNum % competitors.length];
}

function getRoiCalc(dayNum) {
  return roiCalcs[dayNum % roiCalcs.length];
}

function getPainPoint(dayNum) {
  return painPoints[dayNum % painPoints.length];
}

function getTemplate(dayNum) {
  return emailTemplates[dayNum % emailTemplates.length];
}

function getTutorial(dayNum) {
  return tutorialTopics[dayNum % tutorialTopics.length];
}

function getHashtags(platform, angle) {
  if (platform === 'Email Newsletter') return 'N/A';
  const base = '#LeadGeneration #ColdEmail #B2BSales';
  const angleHashtags = {
    'cold_email': ' #EmailOutreach #ColdOutreach #SalesTips',
    'lead_gen': ' #Prospecting #SalesTools #LeadGen',
    'deliverability': ' #EmailDeliverability #InboxPlacement #EmailWarmup',
    'data_service': ' #DataDriven #SalesData #BusinessData',
    'lifetime_deal': ' #LifetimeDeal #LTD #SaaS #StartupTools',
    'credit_value': ' #Pricing #CostSavings #ROI',
    'ai_calling': ' #AICalling #VoiceAI #SalesAI #SalesTech',
    'website_rebuild': ' #WebDesign #AIWebsite #WebDevelopment',
    'case_study': ' #CaseStudy #Results #SuccessStory',
    'competitor': ' #SalesStack #ToolComparison #CompetitorAnalysis',
    'pain_point': ' #SalesProblems #Productivity #TimeManagement',
    'tutorial': ' #HowTo #Tutorial #SalesTraining',
    'social_proof': ' #SocialProof #Testimonial #Results',
    'industry_specific': ' #LocalBusiness #SmallBusiness #IndustryTips',
    'email_template': ' #EmailTemplates #Copywriting #SalesCopy',
    'roi_calculator': ' #ROI #SalesROI #BusinessGrowth'
  };
  return base + (angleHashtags[angle] || '');
}

// Generate content for each day
function generateDay(dayNum) {
  const date = getDate(dayNum);
  const platform = getPlatform(dayNum);
  const contentType = getContentType(platform, dayNum);
  const angle = getAngle(dayNum);
  const hardSell = isHardSell(dayNum);
  const industry = getIndustry(dayNum);
  const competitor = getCompetitor(dayNum);
  const roiCalc = getRoiCalc(dayNum);
  const painPoint = getPainPoint(dayNum);
  const template = getTemplate(dayNum);
  const tutorial = getTutorial(dayNum);
  const hashtags = getHashtags(platform, angle);
  const monthIdx = getMonthIndex(dayNum);
  const monthNum = getMonthNum(dayNum);
  const seasonal = seasonalHooks[monthNum + 1] || [];
  const seasonalHook = seasonal[dayNum % seasonal.length] || '';

  let topic, hook, content, cta;

  // Generate based on angle
  switch(angle) {
    case 'cold_email':
      if (contentType === 'Blog Post') {
        topic = `Advanced Cold Email Strategies for ${industry.charAt(0).toUpperCase() + industry.slice(1)} Businesses`;
        hook = `The definitive cold email playbook for selling to ${industry} businesses in 2026`;
        content = generateColdEmailBlog(industry, dayNum, seasonalHook);
        cta = 'Put these strategies into action — start free at leadripper.com';
      } else if (contentType === 'Newsletter') {
        topic = `Cold email mistake #${(dayNum % 12) + 1} that kills your reply rate`;
        hook = `Subject: This cold email mistake is costing you replies (fix it today)`;
        content = generateColdEmailNewsletter(dayNum, seasonalHook);
        cta = 'Fix your cold emails with LeadRipper — leadripper.com';
      } else if (contentType.includes('Thread')) {
        topic = `Cold email timing and strategy insights`;
        hook = `We analyzed ${((dayNum * 7) % 50 + 10) * 1000} cold emails sent through LeadRipper. Here's what the data says about ${['timing', 'length', 'personalization', 'subject lines', 'CTAs'][dayNum % 5]}:`;
        content = generateColdEmailThread(dayNum, seasonalHook);
        cta = 'Use these insights on LeadRipper — leadripper.com';
      } else if (contentType === 'Carousel') {
        topic = `${(dayNum % 5) + 3} cold email rules for ${seasonalHook || '2026'}`;
        hook = `${(dayNum % 5) + 3} cold email rules that separate pros from amateurs`;
        content = generateColdEmailCarousel(dayNum, seasonalHook);
        cta = 'Master cold email — link in bio';
      } else {
        topic = `Cold email insight — ${['timing', 'personalization', 'follow-ups', 'subject lines', 'CTAs'][dayNum % 5]}`;
        hook = generateColdEmailHook(dayNum, seasonalHook);
        content = generateColdEmailPost(dayNum, seasonalHook, hardSell);
        cta = hardSell ? `Start your free trial at leadripper.com — 500 credits, no card required` : `More cold email tips at leadripper.com/blog`;
      }
      break;

    case 'lead_gen':
      if (contentType === 'Blog Post') {
        topic = `Lead Generation Guide for ${industry.charAt(0).toUpperCase() + industry.slice(1)} Companies`;
        hook = `How to generate 100+ qualified ${industry} leads per week without paid ads`;
        content = generateLeadGenBlog(industry, dayNum);
        cta = 'Start generating leads at leadripper.com';
      } else if (contentType === 'Newsletter') {
        topic = `The lead generation method nobody talks about`;
        hook = `Subject: Stop paying for leads. Start scraping them.`;
        content = generateLeadGenNewsletter(dayNum);
        cta = 'Scrape your first leads free — leadripper.com';
      } else if (contentType.includes('Thread')) {
        topic = `Lead generation methods ranked by ROI`;
        hook = `I've tested ${(dayNum % 6) + 7} lead generation methods over the past year. Here's how they rank by cost-per-qualified-lead:`;
        content = generateLeadGenThread(dayNum);
        cta = 'The best lead gen tool for the price — leadripper.com';
      } else if (contentType === 'Carousel') {
        topic = `Lead scraping vs. buying lists — visual comparison`;
        hook = `Why scraping your own leads beats buying lists (every single time)`;
        content = generateLeadGenCarousel(dayNum);
        cta = 'Scrape fresh leads — link in bio';
      } else {
        topic = `Why ${industry} businesses are the perfect scraping target`;
        hook = generateLeadGenHook(dayNum, industry);
        content = generateLeadGenPost(dayNum, industry, hardSell);
        cta = hardSell ? `Scrape ${industry} leads now — leadripper.com — 500 free credits` : `The data is out there. You just need the right tool.`;
      }
      break;

    case 'deliverability':
      topic = `Email deliverability ${['tip', 'mistake', 'hack', 'insight', 'deep dive'][dayNum % 5]}`;
      hook = generateDeliverabilityHook(dayNum);
      content = generateDeliverabilityContent(dayNum, platform, contentType, hardSell);
      cta = hardSell ? 'Fix your deliverability with LeadRipper — built-in warmup + validation. leadripper.com' : 'Better deliverability = more replies. It starts with the right tools.';
      break;

    case 'data_service':
      topic = `The value of fresh business data`;
      hook = generateDataServiceHook(dayNum);
      content = generateDataServiceContent(dayNum, platform, contentType, hardSell);
      cta = hardSell ? 'Get real-time business data at leadripper.com — $0.15 per lead with full details' : 'Your data source determines your results. Choose wisely.';
      break;

    case 'lifetime_deal':
      topic = `Lifetime deal ${['urgency', 'value proposition', 'comparison', 'ROI breakdown', 'final spots'][dayNum % 5]}`;
      hook = generateLifetimeDealHook(dayNum);
      content = generateLifetimeDealContent(dayNum, platform, contentType);
      cta = 'Lock in your lifetime deal before they sell out — leadripper.com/pricing';
      break;

    case 'credit_value':
      topic = `Credit system value breakdown`;
      hook = generateCreditValueHook(dayNum);
      content = generateCreditValueContent(dayNum, platform, contentType, hardSell);
      cta = hardSell ? 'See full pricing and credit breakdown at leadripper.com/pricing' : 'Every credit turns into revenue. The math always works.';
      break;

    case 'ai_calling':
      topic = `AI calling ${['use case', 'results', 'walkthrough', 'comparison', 'future'][dayNum % 5]}`;
      hook = generateAICallingHook(dayNum);
      content = generateAICallingContent(dayNum, platform, contentType, hardSell);
      cta = hardSell ? 'Try AI calling on LeadRipper — 4 credits per minute. leadripper.com' : 'The future of outbound calling is here.';
      break;

    case 'website_rebuild':
      topic = `Website rebuild strategy for ${industry}`;
      hook = generateWebsiteRebuildHook(dayNum, industry);
      content = generateWebsiteRebuildContent(dayNum, industry, platform, contentType, hardSell);
      cta = hardSell ? 'Score and rebuild any website in 60 seconds — leadripper.com' : `Every bad website is a sales opportunity.`;
      break;

    case 'case_study':
      topic = `Case study — ${roiCalc.scenario} using LeadRipper`;
      hook = generateCaseStudyHook(dayNum, roiCalc);
      content = generateCaseStudyContent(dayNum, roiCalc, platform, contentType);
      cta = 'Get results like these — start free at leadripper.com';
      break;

    case 'competitor':
      topic = `LeadRipper vs ${competitor.name}`;
      hook = generateCompetitorHook(dayNum, competitor);
      content = generateCompetitorContent(dayNum, competitor, platform, contentType, hardSell);
      cta = hardSell ? `Switch from ${competitor.name} to LeadRipper — save ${dayNum % 2 === 0 ? '90' : '95'}%+. leadripper.com` : `The right tool at the right price makes all the difference.`;
      break;

    case 'pain_point':
      topic = `Sales pain point — ${painPoint.substring(0, 50)}`;
      hook = generatePainPointHook(dayNum, painPoint);
      content = generatePainPointContent(dayNum, painPoint, platform, contentType, hardSell);
      cta = hardSell ? 'Solve this problem today — leadripper.com — free to start' : 'The tools to fix this exist. The question is when you start.';
      break;

    case 'tutorial':
      topic = tutorial;
      hook = generateTutorialHook(dayNum, tutorial);
      content = generateTutorialContent(dayNum, tutorial, platform, contentType);
      cta = 'Follow along at leadripper.com — 500 free credits to get started';
      break;

    case 'social_proof':
      topic = `User results and social proof`;
      hook = generateSocialProofHook(dayNum);
      content = generateSocialProofContent(dayNum, platform, contentType, hardSell);
      cta = hardSell ? 'Join thousands of users getting results — leadripper.com' : 'The results speak for themselves.';
      break;

    case 'industry_specific':
      topic = `${industry.charAt(0).toUpperCase() + industry.slice(1)} industry playbook`;
      hook = generateIndustryHook(dayNum, industry);
      content = generateIndustryContent(dayNum, industry, platform, contentType, hardSell);
      cta = hardSell ? `Start prospecting ${industry} businesses — leadripper.com — free to start` : `The ${industry} niche is wide open for outbound. First movers win.`;
      break;

    case 'email_template':
      topic = `Free cold email template — ${template.name}`;
      hook = `Steal this cold email template: "${template.name}" — it gets ${(dayNum % 8) + 5}%+ reply rates`;
      content = generateEmailTemplateContent(dayNum, template, platform, contentType);
      cta = 'Use this template with LeadRipper merge tags — leadripper.com';
      break;

    case 'roi_calculator':
      topic = `ROI breakdown for ${roiCalc.scenario}`;
      hook = generateROIHook(dayNum, roiCalc);
      content = generateROIContent(dayNum, roiCalc, platform, contentType, hardSell);
      cta = hardSell ? `The ROI is ${roiCalc.roi}. Start at leadripper.com — free tier available.` : 'Run the numbers yourself. The math always works.';
      break;
  }

  return `### Day ${dayNum} - ${date}
**Platform:** ${platform}
**Content Type:** ${contentType}
**Topic:** ${topic}
**Hook/Headline:** ${hook}
**Full Content:**
${content}
**CTA:** ${cta}
**Hashtags:** ${hashtags}

---

`;
}

// === CONTENT GENERATORS ===

function generateColdEmailHook(dayNum, seasonal) {
  const hooks = [
    `Your cold emails aren't failing because of your offer. They're failing because of your ${['subject line', 'opening line', 'CTA', 'timing', 'list quality'][dayNum % 5]}.`,
    `We just analyzed our top-performing cold email campaigns. The #1 factor? Not copywriting. Not timing. It's ${['data quality', 'email validation', 'proper warmup', 'personalization depth', 'follow-up consistency'][dayNum % 5]}.`,
    `"How many cold emails should I send per day?" The answer isn't what most people think.`,
    `The ${['3-sentence', '5-sentence', '2-sentence'][dayNum % 3]} cold email is ${['winning', 'dominating', 'crushing it'][dayNum % 3]} right now. Here's why.`,
    `Stop writing cold emails that start with "I hope this email finds you well." Start with this instead:`,
    `The biggest cold email myth in ${seasonal || '2026'}: "More emails = more replies." Dead wrong.`,
    `I reviewed 50 cold email campaigns this week. The top 10% all had one thing in common.`,
    `Your cold email reply rate should be 5-8%. If it's below 3%, you're making one of these mistakes.`,
    seasonal ? `${seasonal.charAt(0).toUpperCase() + seasonal.slice(1)} is the perfect time to launch cold email campaigns. Here's why:` : `Cold email isn't about volume. It's about precision. Here's the difference.`,
    `Want a ${(dayNum % 5) + 5}% reply rate on cold emails? Here's the exact framework we use.`
  ];
  return hooks[dayNum % hooks.length];
}

function generateColdEmailPost(dayNum, seasonal, hardSell) {
  const posts = [
    `${generateColdEmailHook(dayNum, seasonal)}

Here's what the data shows after analyzing thousands of campaigns on LeadRipper:

THE OPTIMAL COLD EMAIL:
- Subject line: 3-6 words, personalized with {first_name} or {company_name}
- Opening line: Reference something specific (their rating, website, review count)
- Value prop: One sentence. What you do + who you help + the result.
- Social proof: One sentence. A specific result for a similar business.
- CTA: One question. Low friction. "Worth a 10-minute call?"

THE OPTIMAL SEQUENCE:
- Email 1: Day 0 — Full pitch with personalization
- Email 2: Day 3 — Short follow-up with new angle
- Email 3: Day 7 — Value add (case study, free resource, or website rebuild)
- Email 4: Day 14 — Break-up email

THE OPTIMAL VOLUME:
- New accounts: 20-30 per day max
- Warmed accounts (3+ weeks): 50-80 per day
- Multiple accounts: Split volume across 2-3 accounts

THE OPTIMAL TIME:
- Tuesday-Thursday, 8-10 AM in the recipient's timezone
- Avoid Monday morning (inbox overload) and Friday afternoon (checked out)

Every single one of these variables can be controlled and tested on LeadRipper. A/B test subject lines. Track opens and replies. Automate follow-ups.

${hardSell ? 'Start your first campaign today — 500 free credits at leadripper.com, no credit card required.' : 'The difference between a 1% and a 8% reply rate isn\'t talent. It\'s testing.'}`,

    `Here's a cold email framework that consistently gets ${(dayNum % 5) + 5}%+ reply rates:

THE P.A.S. FRAMEWORK:
Problem → Agitation → Solution

PROBLEM: Identify their specific pain point
"I noticed {company_name} has a ${(dayNum % 3) + 2}-star rating on Google..."

AGITATION: Make them feel the cost of the problem
"Most {industry} businesses with ratings below 4 stars lose 30-40% of potential customers who check Google before calling..."

SOLUTION: Present your answer (without being salesy)
"I've helped 3 {industry} businesses in {city} get to 4.5+ stars in under 90 days. Happy to share the playbook if you're interested."

CTA: Low-friction ask
"Worth a quick call this week?"

Why this works:
1. You referenced THEIR data (not generic)
2. You quantified the problem (30-40% lost customers)
3. You proved you can solve it (3 similar businesses)
4. You asked for very little (quick call)

All the personalization data comes from LeadRipper's scraping — {company_name}, {rating}, {industry}, {city} are all merge tags pulled automatically.

${hardSell ? 'Write emails like this at scale — leadripper.com — merge tags fill in automatically for every lead.' : 'Personalization isn\'t hard when you have the right data. It\'s hard when you don\'t.'}`,

    `"How many cold emails should I send per day?"

I see this question every week. Here's the nuanced answer:

IT DEPENDS ON YOUR ACCOUNT AGE:

Brand new account (0-2 weeks):
→ 0 cold emails. You should be warming up.

Fresh account (2-4 weeks):
→ 10-20 per day. Ease in.

Warmed account (1-3 months):
→ 30-50 per day. Your sweet spot.

Established account (3+ months):
→ 50-80 per day. But monitor deliverability.

THE MATH THAT MATTERS:
50 emails/day x 22 business days = 1,100 emails/month
At 5% reply rate = 55 conversations
At 30% meeting rate = 16 meetings
At 20% close rate = 3 new clients

3 clients x $2,000 average deal = $6,000/month from cold email

Cost on LeadRipper: 1,100 credits for sending + scraping/validation = ~2,000 credits total
That's well within the Starter plan at $29/month.

$6,000 revenue from $29 investment = 20,589% ROI.

${hardSell ? 'Start with 500 free credits — enough for your first 50-lead campaign. leadripper.com' : 'Volume matters. But only after you\'ve nailed the fundamentals: data quality, deliverability, and relevance.'}`
  ];
  return posts[dayNum % posts.length];
}

function generateColdEmailThread(dayNum, seasonal) {
  return `Tweet 1:
We analyzed ${((dayNum * 7) % 50 + 10) * 1000} cold emails sent through LeadRipper last month.

Here's what the data says about what actually works:

Tweet 2:
FINDING #1: ${['Short subject lines (under 5 words) get 28% more opens than long ones', 'Emails sent Tuesday-Thursday get 34% more replies than Mon/Fri', 'Personalized opening lines increase reply rate by 142%', 'One CTA per email outperforms multiple CTAs by 3.2x', 'The break-up email gets more replies than the first email 40% of the time'][dayNum % 5]}

This alone can transform your campaign results.

Tweet 3:
FINDING #2: The optimal email length is ${['50-125 words', '75-150 words', '60-100 words'][dayNum % 3]}.

Too short = no value delivered.
Too long = nobody reads it.

The sweet spot delivers value in under 30 seconds of reading time.

Tweet 4:
FINDING #3: Follow-up emails account for ${55 + (dayNum % 15)}% of all replies.

If you're only sending one email, you're leaving more than half your potential replies on the table.

LeadRipper automates follow-ups. Set the sequence once, replies come in on autopilot.

Tweet 5:
FINDING #4: Emails with ${['specific data points (rating, review count)', 'a rebuilt website attached', 'a case study reference', 'a question in the subject line'][dayNum % 4]} get ${(dayNum % 4) + 2}x more replies than generic outreach.

LeadRipper gives you all this data automatically when you scrape leads.

The tools exist. The data is clear. The only variable is whether you act on it.

leadripper.com — free to start.`;
}

function generateColdEmailBlog(industry, dayNum, seasonal) {
  const ind = industry.charAt(0).toUpperCase() + industry.slice(1);
  return `# Advanced Cold Email Strategies for ${ind} Businesses

Cold emailing ${industry} businesses requires a specific approach. These are high-value prospects who get pitched frequently — your email needs to stand out.

## Understanding the ${ind} Market

${ind} businesses have unique characteristics that affect your cold email strategy:

- **Decision-making speed:** ${['Fast — owners make quick decisions', 'Moderate — often need to consult a partner', 'Slow — may involve multiple stakeholders'][dayNum % 3]}
- **Email checking habits:** ${['Check email 2-3x daily, mostly morning', 'Check constantly throughout the day', 'Check primarily during off-hours'][dayNum % 3]}
- **Pain points:** Need more customers, better online presence, competitive differentiation
- **Budget range:** Typically $500-5,000/month for services

## The Perfect Cold Email for ${ind} Businesses

### Subject Line Options:
1. "{first_name} — quick question about {company_name}"
2. "Noticed something about {company_name}'s online presence"
3. "{company_name}'s ${(dayNum % 3) + 3}-star rating — a thought"

### Email Body:

"Hey {first_name},

I was researching ${industry} businesses in {city} and {company_name} caught my attention — {rating} stars with {review_count} reviews.

I work specifically with ${industry} businesses to help them get ${(dayNum % 20) + 15}-${(dayNum % 20) + 30} new customers per month through [your method].

Recently, I helped [similar ${industry} business] in [nearby city] increase their monthly revenue by $${((dayNum % 8) + 5) * 1000} within 90 days.

Would it be worth 10 minutes to see if I could do the same for {company_name}?"

### Why This Works for ${ind}:
1. References their specific Google data — shows you did research
2. Industry-specific language — you understand their world
3. Concrete numbers — ${industry} owners are practical people
4. Low-friction CTA — 10 minutes is easy to say yes to

## Follow-Up Sequence

**Email 2 (Day 3):**
"Hey {first_name}, just following up on my note about helping {company_name} get more customers. I know you're busy running the business — is this something worth exploring, or should I check back another time?"

**Email 3 (Day 7):**
Share a relevant case study or offer a free website score of their current site.

**Email 4 (Day 14):**
Break-up email: "Should I close your file, {first_name}?"

## Scraping ${ind} Leads on LeadRipper

1. Go to Lead Scraper
2. Search "${industry}" + your target city
3. You'll get 20-200+ results with full business data
4. Filter by rating (target 2-4 stars for maximum opportunity)
5. Validate all emails (2 credits each)
6. Score websites for extra personalization (8 credits each)
7. Launch your sequence

## Expected Results

- Open rate: 45-65%
- Reply rate: 5-10%
- Meeting rate: 25-40% of replies
- Close rate: 15-25% of meetings

For every 100 ${industry} leads you email:
- 5-10 will reply
- 2-4 will take a meeting
- 1-2 will become clients

At $${((dayNum % 3) + 1) * 1000}/month per client, that's $${((dayNum % 3) + 1) * 1000}-${((dayNum % 3) + 1) * 2000}/month from 100 emails costing you ~$1.50 in credits.

**The ROI is undeniable. Start scraping ${industry} leads today at leadripper.com.**`;
}

function generateColdEmailNewsletter(dayNum, seasonal) {
  const mistakes = [
    { mistake: 'Writing subject lines that scream "MARKETING EMAIL"', fix: 'Write subject lines that look like they came from a colleague. Short, casual, personal. "Quick thought" beats "EXCLUSIVE OFFER — LIMITED TIME" every single time.' },
    { mistake: 'Starting emails with "I hope this email finds you well"', fix: 'Start with something specific about THEM. Their Google rating, their website, their review count, their location. Show you did 10 seconds of research.' },
    { mistake: 'Asking for too much in the first email', fix: 'Your first email should ask for ONE thing: a short call. Not "review our website, watch our demo, read our case studies, and schedule a call." One ask.' },
    { mistake: 'Not validating emails before sending', fix: 'Every invalid email that bounces damages your sender reputation. Validate with LeadRipper (2 credits per check) before sending a single email.' },
    { mistake: 'Sending the same email to everyone', fix: 'Use merge tags. {first_name}, {company_name}, {rating}, {review_count}, {city}. One template + merge tags = 1,000 personalized emails.' },
    { mistake: 'Giving up after one email', fix: 'Set up a 3-4 email sequence with proper spacing. 60% of replies come from follow-up emails, not the first one.' },
    { mistake: 'Sending from your primary domain', fix: 'Always use a secondary domain for cold email. If something goes wrong, your main domain stays protected.' },
    { mistake: 'Skipping email warmup', fix: 'New accounts need 2-3 weeks of warmup before sending. Skip this and your first campaign goes straight to spam.' },
    { mistake: 'Making the email about YOU instead of THEM', fix: 'Nobody cares about your company history or your awards. They care about what you can do for THEM. Lead with their problem.' },
    { mistake: 'Using too many links and images', fix: 'First cold email should be text-only. One link maximum (your calendar link). Images and multiple links trigger spam filters.' },
    { mistake: 'Not tracking your campaigns', fix: 'If you don\'t track opens, clicks, and replies, you can\'t optimize. LeadRipper tracks everything automatically.' },
    { mistake: 'Sending at the wrong time', fix: 'B2B emails perform best Tuesday-Thursday, 8-10 AM in the recipient\'s timezone. Avoid Monday mornings and Friday afternoons.' }
  ];
  const m = mistakes[dayNum % mistakes.length];
  return `Subject: This cold email mistake is costing you replies (fix it today)

Hey {first_name},

Let's talk about a cold email mistake I see almost every day:

THE MISTAKE: ${m.mistake}

I see this in probably ${60 + (dayNum % 30)}% of cold email campaigns. And it's destroying reply rates.

THE FIX: ${m.fix}

Here's an example of what this looks like in practice:

BEFORE (bad):
"Dear Sir/Madam, I hope this email finds you well. My name is John and I work at XYZ Company. We are a leading provider of marketing solutions with 15 years of experience and over 500 satisfied clients. I would love to schedule a meeting to discuss how we can help your business grow. Please visit our website at [link] to learn more about our services, or watch our demo video at [link], or read our client testimonials at [link]. Looking forward to hearing from you."

AFTER (good):
"Hey {first_name}, saw {company_name} has a {rating}-star rating on Google with {review_count} reviews — nice work. I help {industry} businesses in {city} get 20+ more customers per month. Did this for [similar business] recently — they added $8K/month in 90 days. Worth a 10-min call this week?"

See the difference? The "after" version:
- Opens with their data (personal)
- One clear value proposition
- Specific social proof
- One simple CTA
- Under 60 words

The merge tags ({first_name}, {company_name}, {rating}, {review_count}) are all pulled automatically when you scrape leads on LeadRipper. No manual research needed.

Try rewriting your current cold email using this framework. I bet you'll see at least a 2x improvement in reply rates.

→ Need the data? Scrape leads free at leadripper.com (500 credits, no card)

Cheers,
The LeadRipper Team

P.S. — Our Lifetime Deals are still available but we're getting close to the cap. $250 one-time for 10K emails/month forever. Just saying.`;
}

function generateColdEmailCarousel(dayNum, seasonal) {
  return `Slide 1 (Cover):
${(dayNum % 5) + 3} COLD EMAIL RULES FOR ${(seasonal || '2026').toUpperCase()}
Follow these and watch your reply rates climb.

Slide 2:
RULE #1: VALIDATE BEFORE YOU SEND
Every bounced email damages your reputation. Run every email through validation first.
LeadRipper validates with syntax, MX, SMTP checks, and disposable detection.
Cost: 2 credits ($0.01 per email).

Slide 3:
RULE #2: PERSONALIZE WITH DATA, NOT FLUFF
"I love your company" is fluff.
"{company_name}'s {rating}-star rating with {review_count} reviews is impressive" is data.
Data earns trust. Fluff gets deleted.

Slide 4:
RULE #3: ONE EMAIL = ONE ASK
Don't ask them to visit your website AND watch a demo AND read a case study AND book a call.
Pick ONE action. Make it easy.
"Worth a 10-minute call?" — that's it.

Slide 5:
RULE #4: THE SEQUENCE IS EVERYTHING
One email = half your potential replies
A 3-4 email sequence doubles your results
Automate follow-ups so you never forget

Slide 6:
RULE #5: SHORT BEATS LONG
50-125 words is the sweet spot
If your email takes more than 20 seconds to read, it's too long
Busy people skim. Write for skimmers.

${(dayNum % 5) >= 3 ? `Slide 7:
RULE #6: WARM UP OR BURN OUT
New email accounts need 2-3 weeks of warmup
Skip this and your entire campaign lands in spam
LeadRipper has built-in warmup on all plans

Slide 8:
RULE #7: TEST EVERYTHING
A/B test subject lines, opening lines, CTAs
Let data decide what works, not your gut
LeadRipper has built-in A/B testing` : ''}

Slide ${(dayNum % 5) >= 3 ? 9 : 7}:
All of these rules are built into LeadRipper:
Validation, personalization, sequences, warmup, A/B testing — one platform.
Free to start: leadripper.com`;
}

// Lead Gen generators
function generateLeadGenHook(dayNum, industry) {
  const hooks = [
    `There are ${((dayNum % 50) + 20) * 100} ${industry} businesses on Google Maps in the average metro area. Every single one is a potential lead.`,
    `Manual prospecting costs you $${(dayNum % 30) + 20}/hour in lost productivity. Automated scraping costs $0.15 per lead. The math is simple.`,
    `I scraped ${(dayNum % 80) + 50} ${industry} leads in ${(dayNum % 3) + 1} minute${(dayNum % 3) > 0 ? 's' : ''} on LeadRipper. With full business details. While drinking coffee.`,
    `The best lead source isn't LinkedIn. It isn't ZoomInfo. It isn't a $2,000 list purchase. It's Google Maps — and here's why.`,
    `Your competitors are still paying $0.50+ per lead from recycled databases. You could be getting fresh leads for $0.15 each.`
  ];
  return hooks[dayNum % hooks.length];
}

function generateLeadGenPost(dayNum, industry, hardSell) {
  const ind = industry.charAt(0).toUpperCase() + industry.slice(1);
  return `${generateLeadGenHook(dayNum, industry)}

Here's the truth about lead generation in 2026:

The data you need exists. It's all on Google Maps — business names, phone numbers, emails, websites, addresses, ratings, and review counts.

The question isn't IF you can get it. It's HOW FAST and HOW CHEAP.

OPTION A: Manual scraping
- Search Google Maps for "${industry}" in your target city
- Click each result one by one
- Copy name, phone, email, website into a spreadsheet
- Verify each email manually
- Time: 6-8 hours per 100 leads
- Cost: $0 in dollars, $${(dayNum % 30) + 150} in lost productivity

OPTION B: LeadRipper
- Type "${industry}" + city in the search bar
- Click "Scrape"
- Wait 30-60 seconds
- Get 50-200+ leads with ALL details
- Time: under 2 minutes
- Cost: $0.15 per lead (25 credits each)

${ind} businesses are perfect scraping targets because:
1. There are tens of thousands of them on Google Maps
2. They need services (marketing, software, supplies, consulting)
3. Their data is rich (ratings and reviews tell you a LOT)
4. They check email regularly
5. Deal sizes are typically $${((dayNum % 4) + 1) * 500}-$${((dayNum % 4) + 1) * 2000}/month

${hardSell ? `\nStop spending hours on manual research. Scrape ${industry} leads in seconds.\n\nLeadRipper: 500 free credits, no credit card required.\nleadripper.com` : `\nThe leads are sitting there. The only question is who gets to them first — you or your competitor.`}`;
}

function generateLeadGenThread(dayNum) {
  return `Tweet 1:
I've tested ${(dayNum % 6) + 7} lead generation methods over the past year.

Here's how they rank by cost per qualified lead (from worst to best):

Tweet 2:
MOST EXPENSIVE:
${(dayNum % 6) + 7}. LinkedIn Ads: $45-80/lead
${(dayNum % 6) + 6}. Google Ads: $25-60/lead
${(dayNum % 6) + 5}. Trade shows: $40-150/lead
${(dayNum % 6) + 4}. Purchased lists: $0.50-2.00/lead (but 30-40% are junk)

Tweet 3:
MIDDLE OF THE PACK:
${(dayNum % 6) + 3}. Apollo.io: $0.12-0.48/lead
${(dayNum % 6) + 2}. Hunter.io: $0.20-0.80/lead
${(dayNum % 6) + 1}. LinkedIn Sales Navigator: $0.30-1.00/lead

Tweet 4:
THE WINNER:
1. LeadRipper (Google Maps scraping): $0.15/lead

With FULL business data:
- Name, phone, email, website
- Address, rating, review count

Fresh. Real-time. Not recycled.

And it includes validation, warmup, cold email, AI calling, and CRM.

$29/month for everything.

leadripper.com`;
}

function generateLeadGenBlog(industry, dayNum) {
  const ind = industry.charAt(0).toUpperCase() + industry.slice(1);
  return `# How to Generate 100+ Qualified ${ind} Leads Per Week Without Paid Ads

Paid ads are great until you turn them off. Then the leads stop. This guide shows you how to build a sustainable ${industry} lead pipeline using outbound prospecting — one that works regardless of ad budgets.

## Why ${ind} Is a Great Niche for Outbound

${ind} businesses have several qualities that make them ideal outbound targets:

1. **High volume:** Thousands of ${industry} businesses exist in every major metro area
2. **Active on Google:** They rely on Google Maps for customers, so their data is always current
3. **Need help:** Most ${industry} businesses lack sophisticated marketing and technology
4. **Reasonable deal sizes:** $${((dayNum % 4) + 1) * 500}-$${((dayNum % 4) + 1) * 2000}/month for most B2B services

## Step-by-Step: 100 Leads Per Week with LeadRipper

### Monday: Scrape 5 Cities (30 minutes)
1. Open LeadRipper's Lead Scraper
2. Search "${industry}" in City 1 → scrape all results
3. Repeat for Cities 2-5
4. Expected yield: 100-500 leads per city = 500-2,500 total
5. Credit cost: 25 per lead

### Tuesday: Validate and Filter (15 minutes)
1. Run email validation on all leads (2 credits each)
2. Remove invalid and risky emails
3. Filter by rating (2-4 stars = most opportunity)
4. Filter by review count (under 100 = still growing)
5. Select your top 100 leads for the week

### Wednesday: Analyze and Personalize (45 minutes)
1. Score websites of top 20 leads (8 credits each)
2. Rebuild websites for 5 leads with worst scores (30 credits each)
3. Note specific talking points for each lead

### Thursday: Launch Campaign (20 minutes)
1. Create a 3-email sequence with merge tags
2. Add your 100 validated leads
3. Set sending schedule (20-30 per day)
4. Launch

### Friday: Monitor and Optimize (10 minutes)
1. Check open rates (target: 50%+)
2. Check reply rates (target: 5%+)
3. Respond to any replies immediately
4. Adjust subject lines if open rates are low

## Weekly Credit Budget
- Scraping 100 leads: 2,500 credits
- Validating 100 emails: 200 credits
- Scoring 20 websites: 160 credits
- Rebuilding 5 websites: 150 credits
- Sending 300 emails (3-step sequence): 300 credits
- **Total: 3,310 credits per week**

On the Pro plan ($79/month, 10,000 credits): you can do this for 3 weeks per month.
On the Unlimited plan ($299/month, 50,000 credits): you can do this every week with credits to spare.

## Expected Results (Per Week)
- 100 leads contacted
- 5-10 replies
- 2-4 qualified meetings
- 1-2 closed deals per month

## Scaling to 200+ Leads Per Week

Once you've validated your messaging:
1. Increase to 10 cities per week
2. Add AI calling for leads who don't reply to email
3. Upgrade to Pro or Unlimited for more credits
4. Add a second sending account for higher volume
5. Use workflow automations to handle follow-ups automatically

**Start generating ${industry} leads today at leadripper.com — 500 free credits to begin.**`;
}

function generateLeadGenNewsletter(dayNum) {
  return `Subject: Stop paying for leads. Start scraping them.

Hey {first_name},

Quick question: where did your last 10 leads come from?

If the answer is "I paid for them" — you're leaving money on the table.

Here's the uncomfortable truth about purchased lead lists:

THE HIDDEN COSTS OF BOUGHT LEADS:
1. Average bounce rate: 25-35% (that's 250-350 dead emails per 1,000)
2. Spam trap risk: 1-3% of purchased lists contain spam traps
3. Duplicate contacts: you're buying the same leads as your competitors
4. Stale data: most lists are 3-12 months old
5. Legal liability: depending on jurisdiction, emailing purchased contacts can violate privacy laws

THE ALTERNATIVE:
Scrape your own leads in real-time from Google Maps.

What you get per lead on LeadRipper:
- Business name
- Owner/contact name
- Phone number
- Email address
- Website URL
- Physical address
- Google rating (1-5 stars)
- Number of reviews
- Business category

Cost: 25 credits = $0.15 per lead (on Starter plan)
Time: 30-60 seconds for 50-200+ leads

COMPARISON:
Purchased list of 1,000 leads:
- Cost: $300-1,500
- Quality: 60-70% valid
- Freshness: 3-12 months old
- Exclusive: No (sold to 10-50 buyers)
- Data richness: Name + email only

LeadRipper scrape of 1,000 leads:
- Cost: $145 (25,000 credits)
- Quality: 85-95% valid (verify with validation)
- Freshness: Scraped in real-time
- Exclusive: Yes (your search, your list)
- Data richness: 8+ data points per lead

The math isn't close.

→ Start scraping free: leadripper.com (500 credits, no card needed)

Your leads should be as fresh as your coffee this morning,
The LeadRipper Team`;
}

function generateLeadGenCarousel(dayNum) {
  return `Slide 1 (Cover):
SCRAPING VS. BUYING LEADS
Why your lead source matters more than your sales pitch

Slide 2: PURCHASED LISTS
Cost: $0.30-2.00 per lead
Data: Name + email (maybe phone)
Freshness: 3-12 months old
Exclusivity: Sold to 10-50+ buyers
Bounce rate: 25-35%
Verdict: Expensive and unreliable

Slide 3: LEADRIPPER SCRAPING
Cost: $0.15 per lead
Data: Name, phone, email, website, address, rating, reviews
Freshness: Real-time (scraped now)
Exclusivity: Your search = your list
Bounce rate: 5-15% (before validation)
Verdict: Fresh, rich, and affordable

Slide 4: BUT WHAT ABOUT APOLLO/ZOOMINFO?
Apollo: $99-399/mo — Database data (not real-time scraping)
ZoomInfo: $15,000+/yr — Great data, enterprise pricing
Hunter: $99-399/mo — Email finder only, no business data

LeadRipper: $29/mo — Real-time scraping + validation + warmup + cold email + AI calling + website AI + CRM

Slide 5: THE DATA RICHNESS DIFFERENCE
Purchased list gives you: John Smith, john@company.com
LeadRipper gives you: John Smith, (555) 123-4567, john@smithplumbing.com, smithplumbing.com, 123 Main St Houston TX, 4.2 stars, 87 reviews

Which one lets you write a better cold email?

Slide 6: START SCRAPING
500 free credits = 20 leads with full details
No credit card. No commitment.
leadripper.com`;
}

// Deliverability generators
function generateDeliverabilityHook(dayNum) {
  const hooks = [
    `Your email reputation is like a credit score. It takes months to build and seconds to destroy. Here's how to protect it.`,
    `${(dayNum % 30) + 40}% of all emails never reach the inbox. They go to spam, promotions, or get blocked entirely. Don't be part of that statistic.`,
    `"I'm sending emails but getting no replies." Before you blame your copy, check your deliverability. You might be talking to an empty room.`,
    `The #1 reason cold email campaigns fail isn't bad copy. It's bad deliverability. And most people don't even know they have a problem.`,
    `If your open rate is below 30%, your emails aren't landing in the inbox. Here's how to fix it in 7 days.`,
    `Email warmup isn't optional. It's the difference between inbox and spam. And spam is where campaigns go to die.`
  ];
  return hooks[dayNum % hooks.length];
}

function generateDeliverabilityContent(dayNum, platform, contentType, hardSell) {
  if (contentType === 'Blog Post') {
    return `# How to Fix Email Deliverability Issues in 2026

Your emails are only as good as their ability to reach the inbox. Here's a comprehensive guide to diagnosing and fixing deliverability problems.

## Diagnosing Your Deliverability

### Check #1: Open Rate
- Above 50%: Great deliverability
- 30-50%: Decent, room for improvement
- Below 30%: Major deliverability issues

### Check #2: Bounce Rate
- Below 2%: Healthy
- 2-5%: Needs attention
- Above 5%: Critical — stop sending and fix your list

### Check #3: Spam Complaint Rate
- Below 0.1%: Good
- 0.1-0.3%: Warning zone
- Above 0.3%: Your domain is at risk

## The Fix: A 7-Day Deliverability Recovery Plan

**Day 1:** Stop all campaigns. Audit your sending setup.
**Day 2:** Verify SPF, DKIM, DMARC records are correct.
**Day 3:** Run your entire list through email validation. Remove all invalid addresses.
**Day 4:** Start warmup on all sending accounts.
**Day 5-7:** Continue warmup. Prepare cleaned campaigns.
**Day 7+:** Slowly resume sending at 20-30 emails/day with validated lists only.

## Prevention: The LeadRipper Approach

LeadRipper prevents deliverability issues before they start:

1. **Email Validation:** Every email gets checked before sending (syntax, MX, SMTP, disposable detection)
2. **Built-in Warmup:** Gradual reputation building with real inbox network
3. **Smart Sending:** Automatic delays and volume management
4. **Bounce Monitoring:** Real-time bounce tracking with automatic pausing

All included in every plan. Even the free tier.

**Protect your sender reputation at leadripper.com.**`;
  }

  if (contentType === 'Newsletter') {
    return `Subject: Your emails might be going to spam. Here's how to check (and fix it).

Hey {first_name},

Quick diagnostic: what's your cold email open rate?

If it's below 30%, I have bad news — a significant portion of your emails are probably going to spam.

Here's a quick test:
1. Send yourself a test email from your cold email account
2. Check: Did it land in Primary, Promotions, or Spam?
3. Send to a Gmail, Outlook, and Yahoo address
4. If ANY of them go to spam, you have a deliverability problem

THE 3 MOST COMMON CAUSES:

1. No email warmup (or warmup that stopped too early)
Fix: Run warmup for minimum 3 weeks. Keep it running even after starting campaigns.

2. High bounce rate (invalid emails on your list)
Fix: Validate every email before sending. LeadRipper validation: 2 credits ($0.01 per email).

3. Missing authentication records (SPF/DKIM/DMARC)
Fix: Add all three to your domain's DNS. Takes 15 minutes. Results are permanent.

LeadRipper handles #1 and #2 automatically. For #3, we have a setup guide in our help docs.

Don't let deliverability be the silent killer of your outbound campaigns.

→ Fix your deliverability: leadripper.com

Talk soon,
The LeadRipper Team`;
  }

  return `${generateDeliverabilityHook(dayNum)}

Here's the thing about email deliverability — it's invisible until it's too late.

You can write the perfect cold email. You can find the perfect leads. You can build the perfect sequence.

But if your emails land in spam, none of it matters. You're performing for an empty theater.

THE DELIVERABILITY CHECKLIST:

Technical setup:
- SPF record configured correctly
- DKIM record configured correctly
- DMARC record configured correctly
- Custom tracking domain (not shared)

Account health:
- Email warmup running for 2+ weeks
- Bounce rate below 3%
- Spam complaint rate below 0.1%
- Consistent sending volume (no spikes)

List quality:
- Every email validated before sending
- No role-based emails (info@, admin@)
- No disposable emails
- No previous hard bounces

Content:
- No spam trigger words
- No ALL CAPS
- No excessive links (max 1-2)
- Text-only for first email (no images)
- Under 150 words

LeadRipper handles the most critical pieces automatically:
- Built-in email warmup
- Email validation (syntax, MX, SMTP, disposable detection)
- Smart sending with proper delays
- Bounce monitoring and auto-pausing

${hardSell ? 'Fix your deliverability today — built-in warmup and validation on every LeadRipper plan. Start free at leadripper.com.' : 'Your deliverability is the foundation everything else is built on. Get it right first, then worry about copy.'}`;
}

// Data service generators
function generateDataServiceHook(dayNum) {
  const hooks = [
    `Business data is the new oil. And most people are paying refinery prices for crude.`,
    `You need lead data from SOMEWHERE. You can research it manually (hours), buy it (expensive, stale), or scrape it fresh in seconds. Choose wisely.`,
    `Google Maps has the freshest business database on the planet. It's free to view. But collecting it manually would take you a lifetime.`,
    `Every second you spend manually copying business info from Google is a second you could spend selling.`,
    `The data gap is real: companies with real-time lead data close 3x more deals than those using stale databases.`
  ];
  return hooks[dayNum % hooks.length];
}

function generateDataServiceContent(dayNum, platform, contentType, hardSell) {
  return `${generateDataServiceHook(dayNum)}

Let's talk about the data-as-a-service revolution.

Five years ago, if you wanted business data, your options were:
1. Manual research (free but slow — hours per 100 leads)
2. Purchase lists (fast but expensive and stale — $500-2,000 per list)
3. Enterprise platforms (fast and comprehensive but $15,000+/year)

Today, there's a fourth option: real-time scraping.

LeadRipper scrapes business data directly from Google Maps — the most comprehensive, up-to-date business directory in the world.

Every business that shows up on Google Maps is:
- Currently operating (Google removes closed businesses)
- Verified (through Google Business Profile)
- Rich with data (name, phone, email, website, address, rating, reviews)

When you scrape a lead on LeadRipper, you're getting data that's as fresh as it gets. Not a database that was last updated 6 months ago. Not a list compiled from public records in 2024. LIVE data.

THE COST COMPARISON:

Manual research:
- 100 leads = 6-8 hours of work
- Your time value: $50-100/hour
- True cost: $300-800 per 100 leads
- Data quality: Good but slow

Purchased lists:
- 100 leads = instant delivery
- Cost: $50-200 per 100 leads
- Data quality: Mixed (30% bounce rate)

Enterprise tools (ZoomInfo):
- 100 leads = instant delivery
- Cost: $15-45 per 100 leads (based on annual plan)
- Data quality: Good but database (not real-time)

LeadRipper:
- 100 leads = 30-60 seconds
- Cost: $14.50 per 100 leads (2,500 credits)
- Data quality: Excellent (real-time, verified)

${hardSell ? 'Get real-time business data at leadripper.com — start with 500 free credits. Scrape 20 leads and see the quality for yourself.' : 'The companies winning at outbound aren\'t the ones with the best salespeople. They\'re the ones with the best data.'}`;
}

// Lifetime deal generators
function generateLifetimeDealHook(dayNum) {
  const hooks = [
    `We've sold ${300 + (dayNum % 150)} lifetime deals. When we hit 500, they're gone. This isn't a marketing tactic — it's a server capacity reality.`,
    `One-time payment. Lifetime access. No recurring fees. Here's why our Lifetime Deal is the best investment in your sales stack.`,
    `$250 one-time vs. $348/year recurring. In 9 months, the Lifetime Deal pays for itself. After that, it's pure profit.`,
    `Every month, people ask "are the Lifetime Deals still available?" One day the answer will be no. Today, the answer is yes.`,
    `The SaaS companies offering lifetime deals today will charge 3-5x more when they raise their next round. Lock in now.`
  ];
  return hooks[dayNum % hooks.length];
}

function generateLifetimeDealContent(dayNum, platform, contentType) {
  return `${generateLifetimeDealHook(dayNum)}

Let me break down the LeadRipper Lifetime Deals and why they're the best investment you'll make this year:

STARTER LIFETIME — $250 (one-time)
What you get:
- 10,000 emails per month (forever)
- Free email scraping (no credit cost)
- All platform features
- All future updates
- No monthly fees. Ever.

Who it's for: Freelancers, solopreneurs, small teams doing 5K-10K emails/month.

Payback period: 8.6 months vs Starter monthly ($29/mo)
After payback: Save $348/year, every year, forever.

PRO LIFETIME — $450 (one-time)
What you get:
- 100,000 emails per month (forever)
- Free email scraping AND validation
- Priority support
- All platform features + future updates

Who it's for: Agencies, growing sales teams, power users.

Payback period: 5.7 months vs Pro monthly ($79/mo)
After payback: Save $948/year, every year, forever.

ENTERPRISE LIFETIME — $900 (one-time)
What you get:
- 500,000 emails per month (forever)
- Free scraping, validation, and everything else
- White-glove support
- All features + future updates

Who it's for: Large agencies, sales organizations, enterprises.

Payback period: 3 months vs Unlimited monthly ($299/mo)
After payback: Save $3,588/year, every year, forever.

THE FINE PRINT (the good kind):
- These are REAL lifetime deals — not "lifetime = 5 years" like some companies
- You get all future features and updates
- No hidden fees, no usage caps beyond what's listed
- We only offer 500 total lifetime spots to keep our infrastructure sustainable

Current availability: ${500 - (dayNum % 200)} spots remaining.

When they're gone, they're gone. And you'll be paying monthly while lifetime holders use the same platform for free.

Lock in your lifetime deal: leadripper.com/pricing`;
}

// Credit value generators
function generateCreditValueHook(dayNum) {
  const hooks = [
    `LeadRipper's credit system means you only pay for what you use. No wasted spend. No unused seats. Every credit turns into action.`,
    `$29/month sounds cheap. But let me show you exactly how much value is packed into those 5,000 credits.`,
    `Credit packs are the cheat code. Buy $100 in credits, get 13,000 (that's a 30% bonus). Here's what you can do with them.`,
    `The cost per action on LeadRipper will make you question every other tool you're paying for.`,
    `"Is $29/month really enough?" Let me walk you through exactly how far 5,000 credits go.`
  ];
  return hooks[dayNum % hooks.length];
}

function generateCreditValueContent(dayNum, platform, contentType, hardSell) {
  return `${generateCreditValueHook(dayNum)}

Let's break down the credit system so you know exactly what you're getting:

CREDIT COSTS PER ACTION:
- Scrape a lead: 25 credits
- Get place details: 3 credits
- Validate an email: 2 credits
- Score a website: 8 credits
- Rebuild a website: 30 credits
- AI call (per minute): 4 credits
- Send an email: 1 credit

WHAT $29/MONTH (5,000 CREDITS) GETS YOU:

Campaign Style A — Email-Heavy:
200 leads scraped and validated (5,400 credits with validation)
Actually, let me be precise:
- 150 leads scraped: 3,750 credits
- 150 emails validated: 300 credits
- 450 emails sent (3-step sequence): 450 credits
- Total: 4,500 credits, 500 remaining

Campaign Style B — Website Rebuild Focus:
- 50 leads scraped: 1,250 credits
- 50 emails validated: 100 credits
- 25 websites scored: 200 credits
- 10 websites rebuilt: 300 credits
- 50 emails sent: 50 credits
- Total: 1,900 credits, 3,100 remaining

Campaign Style C — AI Calling + Email:
- 50 leads scraped: 1,250 credits
- 50 emails validated: 100 credits
- 25 AI calls (avg 2 min): 200 credits
- 150 emails sent: 150 credits
- Total: 1,700 credits, 3,300 remaining

WANT MORE CREDITS? Credit packs:
- $10 → 1,000 credits
- $50 → 6,000 credits (20% bonus)
- $100 → 13,000 credits (30% bonus)
- $500 → 75,000 credits (50% bonus)
- $1,000 → 165,000 credits (65% bonus)

The $500 pack is the best per-credit value: each credit costs $0.0067, making a lead scrape just $0.17 and an email send just $0.007.

${hardSell ? 'See full pricing at leadripper.com/pricing — start free with 500 credits, upgrade when you see results.' : 'The credit system gives you full control. No wasted monthly fees. No paying for features you don\'t use. Just pure action.'}`;
}

// AI Calling generators
function generateAICallingHook(dayNum) {
  const hooks = [
    `Our AI voice agent just completed its ${((dayNum * 37) % 9000) + 1000}th call. It doesn't get tired. It doesn't get nervous. It doesn't need coffee breaks.`,
    `"AI calling sounds robotic." Not anymore. ElevenLabs voice tech makes our AI sound indistinguishable from a human SDR.`,
    `The average SDR makes 35-50 calls per day. LeadRipper's AI calling agent makes 50 calls in 22 minutes. Same qualification rate. 10x the speed.`,
    `$0.04 per minute for AI calling vs $0.40 per minute for a human SDR. Same conversations. Same qualifications. 10x cheaper.`,
    `We asked 50 prospects if they knew they were talking to an AI. ${(dayNum % 20) + 30}% said no. The voice tech is that good.`
  ];
  return hooks[dayNum % hooks.length];
}

function generateAICallingContent(dayNum, platform, contentType, hardSell) {
  if (contentType === 'Blog Post') {
    return `# AI Voice Calling for Sales: The Complete Guide

AI-powered sales calling is no longer science fiction. Here's everything you need to know about using AI voice agents to qualify leads and book meetings.

## How It Works

LeadRipper's Sales Ripper AI uses ElevenLabs voice technology and Twilio phone infrastructure to make real phone calls to your leads.

The AI agent:
1. Dials the lead's phone number
2. Introduces itself naturally
3. Asks qualifying questions based on your script
4. Handles objections conversationally
5. Books meetings on your calendar
6. Logs the call outcome in your CRM

## The Voice Quality Difference

Early AI calling sounded like a robot reading a script. Today's technology (ElevenLabs) produces voices that are:
- Natural intonation and pacing
- Appropriate pauses and reactions
- Dynamic responses (not scripted paths)
- Multiple voice options (male, female, different accents)

In blind tests, ${(dayNum % 20) + 30}% of call recipients couldn't tell they were speaking with an AI.

## The Numbers

- Cost: 4 credits per minute ($0.04/min on Starter plan)
- Average call length: 2-3 minutes
- Calls per hour: 20-30 (including dial time)
- Qualification rate: 15-25% of connected calls
- Meeting booking rate: 5-10% of connected calls

Compare to a human SDR:
- Cost: $24-30/hour ($0.40-0.50/min)
- Average calls per day: 35-50
- Qualification rate: 15-25% (similar)
- Meeting booking rate: 5-10% (similar)

Same results. 10x cheaper. 5x faster.

## Best Use Cases for AI Calling

1. **Lead qualification:** AI calls a list, qualifies based on criteria, passes hot leads to your sales team
2. **Appointment setting:** AI books meetings directly on your calendar
3. **Follow-up calls:** AI follows up with leads who didn't respond to email
4. **Data enrichment:** AI calls to verify information or gather additional details

## Getting Started

1. Upload your lead list or scrape fresh leads on LeadRipper
2. Set your call script and qualifying criteria
3. Choose your AI voice
4. Set calling schedule
5. Launch and monitor results in real-time

**Try AI calling on LeadRipper — 4 credits per minute. leadripper.com**`;
  }

  return `${generateAICallingHook(dayNum)}

Here's what most people don't understand about AI calling in 2026:

It's not about replacing salespeople. It's about eliminating the WORST part of sales — the cold dial.

Think about what an SDR actually does:
1. Research the lead (10 minutes)
2. Dial the number (30 seconds)
3. Wait through rings (15 seconds)
4. Get voicemail 80% of the time (30 seconds)
5. Leave a voicemail (1 minute)
6. Log the activity (1 minute)
7. Move to next lead
8. REPEAT 35-50 times per day

Out of 8 hours, an SDR spends maybe 45 minutes actually TALKING to prospects. The rest is dialing, waiting, leaving voicemails, and logging.

LeadRipper's AI calling agent eliminates all the waste:
- Dials automatically (no manual dialing)
- Handles voicemails
- Qualifies leads based on your criteria
- Books meetings directly on your calendar
- Logs everything in your CRM

Your human salespeople only talk to QUALIFIED, INTERESTED prospects. The AI handles everything else.

Cost: 4 credits per minute = $0.04/min on our Starter plan

A 2-minute qualifying call costs $0.08.

An SDR making that same call costs $0.80+ (including salary, benefits, management, tools).

${hardSell ? 'Try AI calling on LeadRipper — start free with 500 credits. leadripper.com' : 'The best sales teams aren\'t replacing humans with AI. They\'re freeing humans to do what only humans can do — build relationships and close deals.'}`;
}

// Website rebuild generators
function generateWebsiteRebuildHook(dayNum, industry) {
  const ind = industry.charAt(0).toUpperCase() + industry.slice(1);
  const hooks = [
    `I scored ${(dayNum % 30) + 20} ${industry} websites yesterday. Average score: ${(dayNum % 15) + 25}/100. Every single one is a sales opportunity.`,
    `The fastest way to get a prospect's attention: show them a better version of their own website. Takes 60 seconds on LeadRipper.`,
    `"Why would I rebuild their website for free?" Because that $0.17 rebuilt website can close a $2,000/month deal. That's the ROI of Web Ripper AI.`,
    `Most ${industry} websites look like they were built in 2015. That's not an insult — it's an opportunity.`,
    `Before/after website rebuilds are the most effective cold email attachment we've ever tested. Nothing else comes close.`
  ];
  return hooks[dayNum % hooks.length];
}

function generateWebsiteRebuildContent(dayNum, industry, platform, contentType, hardSell) {
  const ind = industry.charAt(0).toUpperCase() + industry.slice(1);
  return `${generateWebsiteRebuildHook(dayNum, industry)}

Web Ripper AI is LeadRipper's secret weapon that nobody talks about enough.

Here's the premise: 80% of local businesses have bad websites. Not "could be improved" bad. Genuinely bad. No mobile responsiveness. No clear CTA. Slow load times. Walls of text.

And every bad website is a door opener for your cold email.

THE STRATEGY:

Step 1: SCRAPE
Search "${industry}" in your target city on LeadRipper. Pull 50-100 leads.
Cost: 25 credits per lead

Step 2: SCORE
Run Web Ripper AI on their websites. You'll get a 0-100 score with specific issues identified.
Cost: 8 credits per website
Most ${industry} businesses score 20-45/100.

Step 3: REBUILD
For the worst-scoring websites, click "Rebuild." AI creates a modern, mobile-friendly version in 60 seconds.
Cost: 30 credits per rebuild
The rebuilt site gets deployed to a live URL you can share.

Step 4: PITCH
Send a cold email with the rebuilt website attached:

"Hey {first_name},

I noticed {company_name}'s website could be holding back your business. I actually put together a quick sample redesign — take a look: [rebuilt URL]

No obligation at all. Just wanted to show you what's possible.

Worth a quick call?"

WHY THIS WORKS:
- You've already done the work (no asking them to trust you blindly)
- They can SEE the improvement (visual proof)
- It's genuinely helpful (not a generic pitch)
- The effort you put in earns respect and replies

RESULTS:
- Standard cold email reply rate: 3-5%
- Cold email with website rebuild: 10-20%+

The cost per rebuild: 63 credits total (scrape + score + rebuild) = $0.37

One closed deal from a website rebuild email pays for YEARS of LeadRipper.

${hardSell ? 'Score and rebuild any website in 60 seconds — try it free at leadripper.com' : `Every bad ${industry} website is a sales opportunity waiting to be converted. The question is whether you'll be the one who converts it.`}`;
}

// Case study generators
function generateCaseStudyHook(dayNum, roiCalc) {
  return `How a ${roiCalc.scenario.toLowerCase()} used LeadRipper to add $${(roiCalc.dealSize * roiCalc.closesPerMonth).toLocaleString()}/month in new revenue — in just ${(dayNum % 3) + 1} month${(dayNum % 3) > 0 ? 's' : ''}.`;
}

function generateCaseStudyContent(dayNum, roiCalc, platform, contentType) {
  return `${generateCaseStudyHook(dayNum, roiCalc)}

THE BACKGROUND:
A ${roiCalc.scenario.toLowerCase()} was struggling with inconsistent lead flow. Some months were great. Others were crickets. Revenue was unpredictable and growth had plateaued.

Their previous approach:
- Relying on referrals and word of mouth (inconsistent)
- Running Google Ads ($${((dayNum % 10) + 10) * 100}/month, mediocre results)
- Occasionally buying lead lists (expensive, low quality)

Total monthly spend on lead gen: $${((dayNum % 10) + 10) * 100 + 500}
Results: ${(dayNum % 5) + 3}-${(dayNum % 5) + 7} new leads per month

THE LEADRIPPER APPROACH:

Month 1 Setup:
- Signed up for ${roiCalc.closesPerMonth > 3 ? 'Pro ($79/mo)' : 'Starter ($29/mo)'}
- Scraped ${(dayNum % 5 + 2) * 100} leads across ${(dayNum % 3) + 3} cities
- Validated all emails
- Scored ${(dayNum % 3 + 1) * 20} websites
- Rebuilt ${(dayNum % 3 + 1) * 5} websites with worst scores
- Set up warmup on 2 sending accounts
- Built a 4-email sequence:
  * Email 1: Website score + rebuilt sample
  * Email 2: Case study from similar business
  * Email 3: Direct value offer
  * Email 4: Break-up email

THE RESULTS:

Emails sent: ${(dayNum % 5 + 2) * 100}
Open rate: ${(dayNum % 15) + 48}%
Reply rate: ${(dayNum % 5) + 6}%
Meetings booked: ${(dayNum % 8) + 8}
Deals closed: ${roiCalc.closesPerMonth}
Average deal value: $${roiCalc.dealSize.toLocaleString()}/month

New monthly recurring revenue: $${(roiCalc.dealSize * roiCalc.closesPerMonth).toLocaleString()}/month
Annual revenue impact: $${roiCalc.annualRev.toLocaleString()}/year
LeadRipper cost: $${roiCalc.closesPerMonth > 3 ? '79' : '29'}/month
ROI: ${roiCalc.roi}

THE KEY TAKEAWAY:
The website rebuild strategy was the game-changer. Sending a prospect a rebuilt version of their own website got 3-4x more replies than a standard cold email.

After seeing the results, they:
- Cancelled Google Ads (saving $${((dayNum % 10) + 10) * 100}/month)
- Upgraded to a Lifetime Deal ($${roiCalc.closesPerMonth > 3 ? '450' : '250'} one-time)
- Now run cold email as their primary lead gen channel

WANT SIMILAR RESULTS?
Start free at leadripper.com — 500 credits, no card required.
Or go straight to a Lifetime Deal: leadripper.com/pricing`;
}

// Competitor generators
function generateCompetitorHook(dayNum, competitor) {
  const hooks = [
    `${competitor.name} charges ${competitor.price}. LeadRipper charges $29/mo. Here's what you get (and don't get) with each.`,
    `Thinking about ${competitor.name}? Read this first. The feature gap might surprise you.`,
    `I used ${competitor.name} for ${(dayNum % 12) + 6} months before switching to LeadRipper. Here's my honest comparison.`,
    `${competitor.name} vs LeadRipper — the comparison nobody asked for but everyone needs.`,
    `"Is LeadRipper as good as ${competitor.name}?" Let me answer that with data, not marketing.`
  ];
  return hooks[dayNum % hooks.length];
}

function generateCompetitorContent(dayNum, competitor, platform, contentType, hardSell) {
  return `${generateCompetitorHook(dayNum, competitor)}

Let's do an honest, feature-by-feature comparison.

${competitor.name} (${competitor.price}):
${competitor.weakness}

What ${competitor.name} does well:
- ${competitor.name === 'Apollo.io' ? 'Large contact database, good UI, solid sequence builder' :
    competitor.name === 'ZoomInfo' ? 'Massive database, intent data, enterprise integrations' :
    competitor.name === 'Hunter.io' ? 'Clean interface, good email finding, domain search' :
    competitor.name === 'Instantly.ai' ? 'Unlimited email accounts, good warmup, clean UI' :
    competitor.name === 'Smartlead' ? 'Good email automation, multi-inbox rotation' :
    competitor.name === 'Lemlist' ? 'Nice personalization features, image personalization' :
    competitor.name === 'Woodpecker' ? 'Reliable delivery, good for small teams' :
    'Multichannel sequences, good analytics'}

What ${competitor.name} is missing:
- ${competitor.name === 'Apollo.io' || competitor.name === 'ZoomInfo' ? 'Real-time Google Maps scraping (they use a database, not live data)' : 'Built-in lead scraping (you need to bring your own leads)'}
- ${competitor.weakness.split(',')[0]}
- AI voice calling
- Website scoring and rebuilding
- Credit-based pricing (pay only for what you use)

LeadRipper ($29/mo or $250 lifetime):
✅ Real-time lead scraping from Google Maps
✅ Email validation (syntax, MX, SMTP, disposable)
✅ Built-in email warmup
✅ Cold email sequences with A/B testing
✅ AI voice calling (ElevenLabs + Twilio)
✅ Website scoring and AI rebuilding
✅ CRM pipeline (Kanban board)
✅ Workflow automation
✅ Lifetime deal option

THE COST COMPARISON (annual):
${competitor.name}: ${competitor.price.includes('/yr') ? competitor.price : competitor.price.replace('/mo', '/mo x 12 = $' + (parseInt(competitor.price.replace(/[^0-9]/g, '')) * 12).toLocaleString() + '/yr')}
LeadRipper Starter: $29/mo x 12 = $348/yr
LeadRipper Lifetime: $250 one-time (forever)

Savings with LeadRipper: ${competitor.price.includes('15,000') ? '$14,652+/year' : '$' + Math.max(0, (parseInt(competitor.price.replace(/[^0-9]/g, '')) * 12) - 348).toLocaleString() + '+/year'}

THE VERDICT:
If you're an enterprise with a $20K+ budget and need intent data, ${competitor.name === 'ZoomInfo' ? 'ZoomInfo' : 'enterprise tools'} might make sense.

For everyone else — startups, freelancers, agencies, small sales teams — LeadRipper gives you MORE features at a fraction of the cost.

${hardSell ? `Switch to LeadRipper today — start free with 500 credits at leadripper.com` : `The right tool depends on your needs and budget. But for most teams, the choice is clear.`}`;
}

// Pain point generators
function generatePainPointHook(dayNum, painPoint) {
  return `"${painPoint}" — if this sounds familiar, you're not alone. And there's a fix.`;
}

function generatePainPointContent(dayNum, painPoint, platform, contentType, hardSell) {
  return `${generatePainPointHook(dayNum, painPoint)}

This is one of the most common complaints I hear from sales teams, agency owners, and freelancers:

"${painPoint}"

And honestly? It's a legitimate problem. Here's why it exists and how to solve it:

WHY THIS HAPPENS:
The outbound sales stack has been fragmented for years. You need one tool for leads, another for validation, another for warmup, another for sending, another for calling, and another for CRM.

That's 6+ tools, 6+ logins, 6+ monthly payments, and 6+ learning curves.

No wonder people are frustrated.

THE COST OF THIS FRAGMENTATION:
- Monthly tool spend: $200-500+ for a basic stack
- Time wasted switching between tools: 5-10 hours/month
- Data lost in transit between tools: immeasurable
- Leads falling through cracks: constant

THE FIX:
One platform that does everything.

LeadRipper combines:
1. Lead scraping (Google Maps data)
2. Email validation (syntax, MX, SMTP)
3. Email warmup (built-in)
4. Cold email sequences (with A/B testing)
5. AI voice calling (ElevenLabs + Twilio)
6. Website scoring + AI rebuilding
7. CRM pipeline (Kanban)
8. Workflow automation

All in one login. One dashboard. One payment.

Starting at $29/month. Or $250 for lifetime access.

No more juggling tools. No more lost leads. No more fragmented workflows.

${hardSell ? 'Solve this problem today. Start free at leadripper.com — 500 credits, zero risk.' : 'The pain point you\'re feeling isn\'t your fault. The industry has been broken for years. Now there\'s an alternative.'}`;
}

// Tutorial generators
function generateTutorialHook(dayNum, tutorial) {
  return `TUTORIAL: ${tutorial}. Follow along step by step — this takes less than 10 minutes.`;
}

function generateTutorialContent(dayNum, tutorial, platform, contentType) {
  if (contentType === 'Blog Post') {
    return `# ${tutorial}

This step-by-step guide walks you through exactly how to do this on LeadRipper. Follow along with your free account (500 credits, no card needed).

## Prerequisites
- A LeadRipper account (free at leadripper.com)
- A secondary domain for sending (don't use your primary)
- 10 minutes of your time

## Step 1: Log In
Go to leadripper.com and log into your account. If you don't have one, sign up — you'll get 500 free credits immediately.

## Step 2: Navigate to the Feature
From your dashboard, click on the relevant section in the left sidebar. The interface is intuitive — everything is organized by function.

## Step 3: Configure Your Settings
Before taking action, make sure your settings are configured correctly:
- Verify your sending account is connected (for email features)
- Check your credit balance (shown in the top right)
- Review your campaign settings

## Step 4: Execute
Follow the on-screen prompts to complete the action. LeadRipper guides you through each step with clear instructions and tooltips.

## Step 5: Monitor Results
After executing, monitor your results in real-time:
- Check the dashboard for key metrics
- Review individual lead/email status
- Adjust your approach based on data

## Pro Tips
1. Start small — test with 10-20 leads before scaling
2. Always validate emails before sending
3. Keep warmup running even after starting campaigns
4. Use merge tags for personalization
5. Set up sequences (not individual emails) for follow-ups

## Credit Cost for This Tutorial
Depending on the action, here's what you'll use:
- Scraping: 25 credits per lead
- Validation: 2 credits per email
- Website score: 8 credits
- Website rebuild: 30 credits
- AI call: 4 credits per minute
- Email send: 1 credit

Your 500 free credits are enough to complete this tutorial and see real results.

**Get started now at leadripper.com.**`;
  }

  return `TUTORIAL: ${tutorial}

Here's the exact step-by-step process:

STEP 1: Log into LeadRipper (sign up free at leadripper.com if you haven't)

STEP 2: Navigate to the relevant feature from the dashboard sidebar

STEP 3: Follow the setup process:
- Configure your settings
- Connect your accounts (if applicable)
- Set your parameters

STEP 4: Execute the action:
- For scraping: Enter industry + city, click "Scrape"
- For validation: Select leads, click "Validate"
- For warmup: Connect email, click "Start Warmup"
- For sequences: Create campaign, add leads, set schedule, launch
- For AI calling: Set script, add leads, click "Start Calls"
- For website scoring: Enter URL, click "Score"
- For rebuilding: Click "Rebuild" on a scored website

STEP 5: Monitor your results in real-time on the dashboard

The whole process takes under 10 minutes. Your free 500 credits are enough to run through this tutorial and see actual results.

Key tips:
- Always validate emails before sending (2 credits each — worth every penny)
- Start warmup at least 2 weeks before your first campaign
- Use merge tags for personalization: {first_name}, {company_name}, {rating}, etc.
- Build sequences, not single emails — 60% of replies come from follow-ups

Follow along at leadripper.com — 500 free credits to get started.`;
}

// Social proof generators
function generateSocialProofHook(dayNum) {
  const hooks = [
    `LeadRipper by the numbers this month: ${((dayNum * 11) % 50 + 10) * 1000} leads scraped, ${((dayNum * 7) % 30 + 5) * 1000} emails sent, ${((dayNum * 3) % 20 + 5) * 100} AI calls made. The platform is humming.`,
    `"I closed my first client using LeadRipper within 10 days of signing up." — Real user, real result.`,
    `Another week, another batch of LeadRipper success stories. Here are ${(dayNum % 3) + 3} from this week alone:`,
    `We just hit ${((dayNum * 13) % 5 + 3) * 1000}+ active users. Here's what they're doing with LeadRipper that's actually working.`,
    `The data doesn't lie: LeadRipper users with proper warmup and validated lists are seeing ${(dayNum % 5) + 4}-${(dayNum % 5) + 8}% reply rates consistently.`
  ];
  return hooks[dayNum % hooks.length];
}

function generateSocialProofContent(dayNum, platform, contentType, hardSell) {
  return `${generateSocialProofHook(dayNum)}

Here are real results from LeadRipper users this month:

USER #1: Marketing Agency Owner
"I scraped 200 HVAC businesses, rebuilt 20 of their websites, and sent personalized emails with the rebuilt sites attached. Got 28 replies (14% reply rate) and closed 5 clients at $1,500/month each. LeadRipper paid for itself 258 times over."
Plan: Pro ($79/month)

USER #2: Freelance Web Designer
"I was spending $500/month on Google Ads getting 5-10 leads. Switched to LeadRipper, scraped local businesses with bad websites, and now I get 15-20 qualified conversations per month for $29."
Plan: Starter ($29/month)

USER #3: SaaS Founder
"We used LeadRipper's AI calling to qualify 500 leads in one week. Booked 47 demo calls. Our SDR team would have taken a month to do the same thing."
Plan: Unlimited ($299/month)

USER #4: Real Estate Agent
"I scrape mortgage brokers, home inspectors, and property managers in my market and build referral partnerships through cold email. 12 active referral partners sending me 2-3 deals each per quarter. Life-changing."
Plan: Starter Lifetime ($250 one-time)

THE COMMON THREAD:
Every successful user did three things:
1. Used FRESH, scraped data (not purchased lists)
2. Validated every email before sending
3. Followed up consistently with automated sequences

The platform gives you the tools. Your execution determines the results.

${hardSell ? 'Join thousands of users getting real results. Start free at leadripper.com — 500 credits, no card required.' : 'The results speak for themselves. But they only happen if you start.'}`;
}

// Industry specific generators
function generateIndustryHook(dayNum, industry) {
  const ind = industry.charAt(0).toUpperCase() + industry.slice(1);
  return `The ${industry} industry is one of the most profitable niches for cold email outreach. Here's the exact playbook to dominate it.`;
}

function generateIndustryContent(dayNum, industry, platform, contentType, hardSell) {
  const ind = industry.charAt(0).toUpperCase() + industry.slice(1);
  const dealSizes = {
    'roofing': '$1,500-5,000/mo', 'plumbing': '$1,000-3,000/mo', 'HVAC': '$1,500-4,000/mo',
    'landscaping': '$800-2,500/mo', 'dental': '$2,000-5,000/mo', 'chiropractic': '$1,500-4,000/mo',
    'real estate': '$2,000-8,000 per deal', 'restaurant': '$500-2,000/mo', 'auto repair': '$1,000-3,000/mo',
    'law firm': '$2,000-8,000/mo', 'accounting': '$1,500-4,000/mo', 'insurance': '$1,000-3,000/mo',
    'fitness/gym': '$500-2,000/mo', 'salon/spa': '$800-2,500/mo', 'photography': '$500-2,000/mo',
    'cleaning service': '$800-2,000/mo', 'pest control': '$1,000-3,000/mo', 'moving company': '$800-2,500/mo',
    'veterinary': '$1,500-4,000/mo', 'mortgage broker': '$2,000-5,000 per deal',
    'marketing agency': '$2,000-5,000/mo', 'web design agency': '$1,500-5,000/mo',
    'consulting': '$2,000-10,000/mo', 'coaching': '$1,000-5,000/mo',
    'e-commerce': '$1,000-5,000/mo', 'SaaS': '$500-2,000/mo', 'construction': '$2,000-8,000/mo',
    'electrical': '$1,000-3,000/mo', 'painting': '$800-2,500/mo', 'flooring': '$1,000-3,000/mo',
    'solar': '$2,000-5,000 per deal', 'property management': '$1,500-4,000/mo'
  };
  const dealSize = dealSizes[industry] || '$1,000-3,000/mo';

  return `THE ${ind.toUpperCase()} INDUSTRY COLD EMAIL PLAYBOOK

Why ${ind} businesses are perfect for cold outreach:
- Abundant on Google Maps (thousands in every metro area)
- Active websites and email addresses
- Constantly need new customers and services
- Average deal size: ${dealSize}
- Decision-makers are accessible (usually the owner)

STEP 1: SCRAPE
Search "${industry}" + target city on LeadRipper
Filter by: 1-4 star rating (room for improvement = they need help)
Expected results: 30-200 leads per city

STEP 2: ANALYZE
Score their websites with Web Ripper AI
Look for: low scores (under 50/100), missing CTAs, poor mobile design
These businesses are your best prospects — they clearly need help

STEP 3: PERSONALIZE
Use merge tags to customize every email:
- {first_name} → Owner name
- {company_name} → Business name
- {rating} → Their Google rating
- {review_count} → Number of reviews
- {website} → Their current website
- {city} → Their location

STEP 4: PITCH
Email template for ${industry}:

Subject: Quick thought about {company_name}

"Hey {first_name},

I work with ${industry} businesses in {city} and noticed {company_name} — {rating} stars with {review_count} reviews.

I help businesses like yours [specific value prop for ${industry}]. Recently helped a similar business add ${dealSize.split('-')[1] || '$2,000/mo'} in monthly revenue.

Worth a 10-minute call to see if I can do the same?"

STEP 5: FOLLOW UP
3-4 email sequence with 3-5 day gaps
Include case studies, website rebuilds, and a break-up email

EXPECTED RESULTS PER 100 LEADS:
- Open rate: 45-60%
- Reply rate: 5-10%
- Meetings: 2-4
- Closed deals: 1-2
- Revenue per deal: ${dealSize}

LeadRipper cost for this campaign: ~$15-30 in credits

${hardSell ? `Start prospecting ${industry} businesses today at leadripper.com — 500 free credits, no card required.` : `The ${industry} niche is wide open. First movers win.`}`;
}

// Email template content generators
function generateEmailTemplateContent(dayNum, template, platform, contentType) {
  return `FREE COLD EMAIL TEMPLATE: "${template.name}"

This template consistently gets ${(dayNum % 8) + 5}%+ reply rates across industries. Copy it, customize it, and start sending.

SUBJECT: ${template.subject}

BODY:
${template.body}

WHY THIS TEMPLATE WORKS:

1. PERSONALIZED OPENING: Uses merge tags ({first_name}, {company_name}, {rating}) to show you did research. Not generic "Dear Sir/Madam."

2. SPECIFIC VALUE PROP: Doesn't say "we can help your business." Says exactly how and includes a concrete result.

3. SOCIAL PROOF: References a specific result for a similar business. Not "we've helped thousands of clients" — a real number.

4. LOW-FRICTION CTA: Asks for 10 minutes, not an hour. Easy to say yes to.

5. SHORT: Under 100 words. Respects their time. Gets to the point.

HOW TO USE THIS ON LEADRIPPER:

1. Scrape leads in your target industry (25 credits per lead)
2. Validate emails (2 credits each)
3. Create a new cold email campaign
4. Paste this template
5. Merge tags auto-fill from your scraped data
6. Add 2-3 follow-up emails to build a full sequence
7. Set sending schedule and launch

Every merge tag in this template ({first_name}, {company_name}, {rating}, {review_count}, {city}, {industry}, {website}) is automatically pulled when you scrape leads on LeadRipper.

No manual research. No copy-pasting. Just scrape, template, and send.

Use this template with LeadRipper merge tags — start free at leadripper.com`;
}

// ROI generators
function generateROIHook(dayNum, roiCalc) {
  return `I did the math for a ${roiCalc.scenario.toLowerCase()}: $${roiCalc.lrCost}/year on LeadRipper → $${roiCalc.annualRev.toLocaleString()}/year in new revenue. That's a ${roiCalc.roi} ROI.`;
}

function generateROIContent(dayNum, roiCalc, platform, contentType, hardSell) {
  return `${generateROIHook(dayNum, roiCalc)}

Let me walk through the entire calculation:

THE BUSINESS: ${roiCalc.scenario}
Average deal value: $${roiCalc.dealSize.toLocaleString()}/month
Target: ${roiCalc.closesPerMonth} new clients per month

THE LEADRIPPER INVESTMENT:
Plan: ${roiCalc.lrCost <= 348 ? 'Starter ($29/mo = $348/year)' : 'Pro ($79/mo = $948/year)'}
Credits: ${roiCalc.lrCost <= 348 ? '5,000' : '10,000'}/month

THE OUTBOUND CAMPAIGN:
Leads scraped per month: ${roiCalc.closesPerMonth * 50}
Emails validated: ${roiCalc.closesPerMonth * 50}
Cold emails sent (3-step sequence): ${roiCalc.closesPerMonth * 150}
Credits used: ~${roiCalc.closesPerMonth * 50 * 25 + roiCalc.closesPerMonth * 50 * 2 + roiCalc.closesPerMonth * 150}/month

THE FUNNEL:
${roiCalc.closesPerMonth * 50} leads contacted
→ ${Math.round(roiCalc.closesPerMonth * 50 * 0.06)} replies (6% reply rate)
→ ${Math.round(roiCalc.closesPerMonth * 50 * 0.06 * 0.5)} meetings booked (50% of replies)
→ ${roiCalc.closesPerMonth} closed deals (${Math.round(roiCalc.closesPerMonth / (roiCalc.closesPerMonth * 50 * 0.06 * 0.5) * 100)}% close rate)

THE REVENUE:
Monthly: ${roiCalc.closesPerMonth} clients x $${roiCalc.dealSize.toLocaleString()} = $${(roiCalc.dealSize * roiCalc.closesPerMonth).toLocaleString()}/month
Annual: $${roiCalc.annualRev.toLocaleString()}/year

THE ROI:
Investment: $${roiCalc.lrCost}/year
Revenue: $${roiCalc.annualRev.toLocaleString()}/year
ROI: ${roiCalc.roi}

EVEN IF YOU HALF THESE NUMBERS:
Close ${Math.ceil(roiCalc.closesPerMonth / 2)} clients instead of ${roiCalc.closesPerMonth}
Revenue: $${(roiCalc.annualRev / 2).toLocaleString()}/year
ROI: Still ${Math.round(parseInt(roiCalc.roi.replace(/,/g, '').replace('%', '')) / 2).toLocaleString()}%+

The math works even with conservative assumptions. One closed deal pays for an entire year (or more) of LeadRipper.

${hardSell ? `The ROI is ${roiCalc.roi}. Start free at leadripper.com — 500 credits, no card required.` : 'Run the numbers yourself with your own deal sizes. The math always works.'}`;
}

// === MAIN GENERATION ===

let content = '';
let currentMonth = 1; // Already wrote month 1

for (let day = 32; day <= 365; day++) {
  const newMonth = getMonthIndex(day);

  // Add month header if new month
  if (newMonth !== currentMonth) {
    currentMonth = newMonth;
    if (currentMonth <= 12) {
      content += `\n# MONTH ${currentMonth}: ${monthThemes[currentMonth - 1] || 'CONTINUED GROWTH'} \n`;
      content += `**Theme:** ${monthThemeDescriptions[currentMonth - 1] || 'Continued growth and optimization'}\n\n---\n\n`;
    }
  }

  content += generateDay(day);
}

// Append to file
fs.appendFileSync(outputFile, content, 'utf8');
console.log(`Generated days 32-365 and appended to ${outputFile}`);

// Count total lines
const totalContent = fs.readFileSync(outputFile, 'utf8');
const lineCount = totalContent.split('\n').length;
const dayCount = (totalContent.match(/### Day \d+/g) || []).length;
console.log(`Total lines: ${lineCount}`);
console.log(`Total days: ${dayCount}`);
