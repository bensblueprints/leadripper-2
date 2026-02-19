const fs = require('fs');
const path = require('path');

/**
 * Convert Markdown Blog Posts to JSON for Database Import
 *
 * This script reads markdown files from /blog-posts/ and converts them
 * to JSON format ready for insertion into the Supabase blog_posts table.
 */

function convertMarkdownToHTML(markdown) {
  // Simple markdown to HTML conversion
  // For production, consider using a library like 'marked'
  let html = markdown;

  // Convert headers
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // Convert bold
  html = html.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>');

  // Convert italic
  html = html.replace(/\*(.*?)\*/gim, '<em>$1</em>');

  // Convert links
  html = html.replace(/\[(.*?)\]\((.*?)\)/gim, '<a href="$2">$1</a>');

  // Convert lists
  html = html.replace(/^\- (.*$)/gim, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/gims, '<ul>$1</ul>');

  // Convert paragraphs
  html = html.replace(/\n\n/g, '</p><p>');
  html = '<p>' + html + '</p>';

  // Clean up multiple p tags
  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/<p>(<h[1-6]>)/g, '$1');
  html = html.replace(/(<\/h[1-6]>)<\/p>/g, '$1');

  return html;
}

function extractMetadata(markdown) {
  const lines = markdown.split('\n');
  const metadata = {};

  // Extract title (first H1)
  const titleMatch = markdown.match(/^# (.+)$/m);
  metadata.title = titleMatch ? titleMatch[1] : 'Untitled Post';

  // Extract meta title
  const metaTitleMatch = markdown.match(/\*\*Meta Title:\*\* (.+)$/m);
  metadata.meta_title = metaTitleMatch ? metaTitleMatch[1] : metadata.title;

  // Extract meta description
  const metaDescMatch = markdown.match(/\*\*Meta Description:\*\* (.+)$/m);
  metadata.meta_description = metaDescMatch ? metaDescMatch[1] : '';

  // Extract focus keyword
  const focusKeywordMatch = markdown.match(/\*\*Focus Keyword:\*\* (.+)$/m);
  metadata.focus_keyword = focusKeywordMatch ? focusKeywordMatch[1] : '';

  // Extract keywords
  const keywordsMatch = markdown.match(/\*\*Keywords:\*\* (.+)$/m);
  if (keywordsMatch) {
    metadata.keywords = keywordsMatch[1].split(',').map(k => k.trim());
  } else {
    metadata.keywords = [];
  }

  // Extract category
  const categoryMatch = markdown.match(/\*\*Category:\*\* (.+)$/m);
  metadata.category = categoryMatch ? categoryMatch[1] : 'Lead Generation';

  // Extract reading time
  const readingTimeMatch = markdown.match(/\*\*Reading Time:\*\* (\d+) minutes?$/m);
  metadata.reading_time_minutes = readingTimeMatch ? parseInt(readingTimeMatch[1]) : null;

  // Extract tags from bottom of post
  const tagsMatch = markdown.match(/\*\*Tags:\*\* (.+)$/m);
  if (tagsMatch) {
    metadata.tags = tagsMatch[1].split('#').map(t => t.trim()).filter(t => t.length > 0);
  } else {
    metadata.tags = [];
  }

  // Extract excerpt (first paragraph after metadata section)
  const excerptMatch = markdown.match(/---\n\n## Introduction.*?\n\n(.+?)\n\n/s);
  if (excerptMatch) {
    metadata.excerpt = excerptMatch[1].substring(0, 200) + '...';
  } else {
    // Fallback: first 200 chars of content
    const contentStart = markdown.indexOf('\n\n') + 2;
    metadata.excerpt = markdown.substring(contentStart, contentStart + 200) + '...';
  }

  return metadata;
}

function convertPostToJSON(filename) {
  const filepath = path.join(__dirname, 'blog-posts', filename);

  console.log(`\nProcessing: ${filename}`);

  if (!fs.existsSync(filepath)) {
    console.error(`File not found: ${filepath}`);
    return null;
  }

  const markdown = fs.readFileSync(filepath, 'utf8');
  const metadata = extractMetadata(markdown);

  // Generate slug from filename
  const slug = filename
    .replace(/^\d+-/, '')  // Remove leading numbers
    .replace(/\.md$/, ''); // Remove .md extension

  // Convert markdown to HTML
  const content = convertMarkdownToHTML(markdown);

  // Calculate word count
  const wordCount = markdown.split(/\s+/).length;

  // Create database-ready object
  const post = {
    title: metadata.title,
    slug: slug,
    excerpt: metadata.excerpt,
    content: content,
    author_name: 'LeadRipper Team',

    // SEO
    meta_title: metadata.meta_title,
    meta_description: metadata.meta_description,
    focus_keyword: metadata.focus_keyword,
    keywords: metadata.keywords,

    // Organization
    category: metadata.category,
    tags: metadata.tags,
    reading_time_minutes: metadata.reading_time_minutes || Math.ceil(wordCount / 200),
    word_count: wordCount,

    // Publishing
    status: 'draft', // Change to 'published' when ready
    published_at: null, // Set to current datetime when publishing

    // Schema.org
    schema_json: {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      "headline": metadata.title,
      "description": metadata.excerpt,
      "author": {
        "@type": "Organization",
        "name": "LeadRipper"
      },
      "publisher": {
        "@type": "Organization",
        "name": "LeadRipper",
        "logo": {
          "@type": "ImageObject",
          "url": "https://leadripper.com/logo.png"
        }
      },
      "datePublished": new Date().toISOString(),
      "dateModified": new Date().toISOString()
    }
  };

  console.log(`✓ Converted: ${post.title}`);
  console.log(`  - Slug: ${post.slug}`);
  console.log(`  - Word Count: ${post.word_count}`);
  console.log(`  - Reading Time: ${post.reading_time_minutes} minutes`);
  console.log(`  - Category: ${post.category}`);
  console.log(`  - Keywords: ${post.keywords.length} found`);

  return post;
}

function main() {
  console.log('🔄 Converting Blog Posts to JSON...\n');

  const blogPostsDir = path.join(__dirname, 'blog-posts');

  if (!fs.existsSync(blogPostsDir)) {
    console.error('❌ /blog-posts/ directory not found!');
    return;
  }

  const files = fs.readdirSync(blogPostsDir).filter(f => f.endsWith('.md'));

  if (files.length === 0) {
    console.log('⚠️  No markdown files found in /blog-posts/');
    return;
  }

  const posts = [];

  files.forEach(filename => {
    const post = convertPostToJSON(filename);
    if (post) {
      posts.push(post);
    }
  });

  // Save to JSON file
  const outputPath = path.join(__dirname, 'blog-posts-ready-for-import.json');
  fs.writeFileSync(outputPath, JSON.stringify(posts, null, 2));

  console.log('\n✅ Conversion Complete!');
  console.log(`📄 ${posts.length} post(s) converted`);
  console.log(`💾 Saved to: ${outputPath}`);
  console.log('\n📋 Next steps:');
  console.log('1. Review the JSON file');
  console.log('2. Import to Supabase via dashboard or API');
  console.log('3. Update status to "published" when ready to go live');
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { convertPostToJSON, convertMarkdownToHTML, extractMetadata };
