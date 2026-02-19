-- LeadRipper Blog Posts Table with Full SEO Support
-- Created: 2026-02-07
-- Purpose: Store SEO-optimized blog content for lead generation

CREATE TABLE IF NOT EXISTS blog_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Core Content
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  excerpt TEXT NOT NULL,
  content TEXT NOT NULL,
  featured_image_url TEXT,
  featured_image_alt TEXT,
  author_name TEXT DEFAULT 'LeadRipper Team',
  author_avatar_url TEXT,

  -- SEO Fields
  meta_title TEXT NOT NULL,
  meta_description TEXT NOT NULL,
  focus_keyword TEXT NOT NULL,
  keywords TEXT[], -- Array of related keywords
  canonical_url TEXT,

  -- Open Graph / Social
  og_title TEXT,
  og_description TEXT,
  og_image_url TEXT,
  twitter_title TEXT,
  twitter_description TEXT,
  twitter_image_url TEXT,

  -- Organization
  category TEXT NOT NULL,
  tags TEXT[],
  reading_time_minutes INTEGER,
  word_count INTEGER,

  -- Publishing
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'published', 'archived')),
  published_at TIMESTAMPTZ,
  scheduled_for TIMESTAMPTZ,

  -- Analytics & Performance
  view_count INTEGER DEFAULT 0,
  share_count INTEGER DEFAULT 0,
  ctr_percentage DECIMAL(5,2) DEFAULT 0.00,
  avg_time_on_page_seconds INTEGER DEFAULT 0,

  -- Internal Linking
  related_post_ids UUID[],
  internal_links_count INTEGER DEFAULT 0,
  external_links_count INTEGER DEFAULT 0,

  -- Schema.org / Structured Data
  schema_type TEXT DEFAULT 'BlogPosting',
  schema_json JSONB,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_indexed_at TIMESTAMPTZ
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_blog_posts_slug ON blog_posts(slug);
CREATE INDEX IF NOT EXISTS idx_blog_posts_status ON blog_posts(status);
CREATE INDEX IF NOT EXISTS idx_blog_posts_category ON blog_posts(category);
CREATE INDEX IF NOT EXISTS idx_blog_posts_published_at ON blog_posts(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_blog_posts_scheduled_for ON blog_posts(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_blog_posts_focus_keyword ON blog_posts(focus_keyword);
CREATE INDEX IF NOT EXISTS idx_blog_posts_tags ON blog_posts USING GIN(tags);

-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_blog_posts_search ON blog_posts
  USING GIN(to_tsvector('english', title || ' ' || excerpt || ' ' || content));

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_blog_posts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_blog_posts_updated_at
  BEFORE UPDATE ON blog_posts
  FOR EACH ROW
  EXECUTE FUNCTION update_blog_posts_updated_at();

-- Blog Categories Table
CREATE TABLE IF NOT EXISTS blog_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  meta_title TEXT,
  meta_description TEXT,
  post_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default categories for LeadRipper
INSERT INTO blog_categories (name, slug, description, meta_title, meta_description) VALUES
  ('Lead Generation', 'lead-generation', 'Expert guides on generating quality B2B leads', 'Lead Generation Strategies & Best Practices | LeadRipper', 'Discover proven lead generation strategies and techniques to grow your business with LeadRipper.'),
  ('Google Maps Scraping', 'google-maps-scraping', 'Tutorials on extracting business data from Google Maps', 'Google Maps Scraping Tutorials | LeadRipper', 'Learn how to ethically scrape business leads from Google Maps using LeadRipper.'),
  ('Sales Automation', 'sales-automation', 'Automate your sales process and workflows', 'Sales Automation Tools & Tips | LeadRipper', 'Streamline your sales process with automation strategies and tools from LeadRipper.'),
  ('B2B Marketing', 'b2b-marketing', 'Marketing strategies for B2B businesses', 'B2B Marketing Strategies | LeadRipper', 'Effective B2B marketing strategies to generate leads and grow your business.'),
  ('CRM Integration', 'crm-integration', 'Integrating lead data with your CRM', 'CRM Integration Guides | LeadRipper', 'Learn how to seamlessly integrate LeadRipper with your CRM system.'),
  ('Case Studies', 'case-studies', 'Real success stories from LeadRipper users', 'Customer Success Stories | LeadRipper', 'Read how businesses are succeeding with LeadRipper lead generation platform.'),
  ('Industry Insights', 'industry-insights', 'Latest trends in lead generation and marketing', 'Lead Generation Industry Insights | LeadRipper', 'Stay updated with the latest trends and insights in lead generation and B2B marketing.')
ON CONFLICT (slug) DO NOTHING;

-- Blog Analytics Table (for tracking)
CREATE TABLE IF NOT EXISTS blog_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES blog_posts(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  views INTEGER DEFAULT 0,
  unique_visitors INTEGER DEFAULT 0,
  avg_time_seconds INTEGER DEFAULT 0,
  bounce_rate DECIMAL(5,2) DEFAULT 0.00,
  shares INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(post_id, date)
);

CREATE INDEX IF NOT EXISTS idx_blog_analytics_post_date ON blog_analytics(post_id, date DESC);

COMMENT ON TABLE blog_posts IS 'SEO-optimized blog posts for LeadRipper marketing';
COMMENT ON TABLE blog_categories IS 'Blog post categories with SEO metadata';
COMMENT ON TABLE blog_analytics IS 'Daily analytics tracking for blog posts';
