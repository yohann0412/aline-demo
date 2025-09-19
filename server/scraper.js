import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';

const turndownService = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced'
});

// Enhanced URL detection patterns
const URL_PATTERNS = [
  // Blog patterns
  /\/blog\//i,
  /\/article\//i,
  /\/post\//i,
  /\/news\//i,
  /\/insights\//i,
  /\/guide\//i,
  /\/tutorial\//i,
  /\/learn\//i,
  /\/resources\//i,
  /\/content\//i,
  /\/stories\//i,
  /\/case-stud/i,
  // Date patterns (2023/01, 2024-01, etc.)
  /\/\d{4}[\/\-]\d{1,2}/,
  // Slug patterns
  /\/[a-z0-9\-]{10,}/i
];

// Content selectors to try (ordered by priority)
const CONTENT_SELECTORS = [
  'article',
  '.post-content',
  '.entry-content',
  '.content',
  '.blog-post',
  '.article-content',
  '.post-body',
  '.entry-body',
  '.content-body',
  'main',
  '.main-content',
  '#content',
  '#main'
];

// Title selectors
const TITLE_SELECTORS = [
  'h1',
  '.post-title',
  '.entry-title',
  '.article-title',
  '.title',
  'title'
];

// Patterns to exclude
const EXCLUDE_PATTERNS = [
  /\.(css|js|jpg|jpeg|png|gif|pdf|zip|doc|docx)$/i,
  /#/,
  /javascript:/,
  /mailto:/,
  /tel:/,
  /^\/\//, // Protocol-relative URLs that might be external
];

async function getBrowser() {
  return await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor'
    ]
  });
}

function normalizeUrl(url, baseUrl) {
  try {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    if (url.startsWith('//')) {
      return `https:${url}`;
    }
    if (url.startsWith('/')) {
      const base = new URL(baseUrl);
      return `${base.protocol}//${base.host}${url}`;
    }
    return new URL(url, baseUrl).href;
  } catch {
    return null;
  }
}

function isValidContentUrl(url, baseUrl) {
  if (!url) return false;
  
  // Exclude unwanted file types and protocols
  if (EXCLUDE_PATTERNS.some(pattern => pattern.test(url))) {
    return false;
  }
  
  // Must be from same domain
  try {
    const urlObj = new URL(url);
    const baseObj = new URL(baseUrl);
    if (urlObj.hostname !== baseObj.hostname) {
      return false;
    }
  } catch {
    return false;
  }
  
  // Check if URL matches content patterns
  return URL_PATTERNS.some(pattern => pattern.test(url));
}

function detectContentType(url, title, content) {
  const urlLower = url.toLowerCase();
  const titleLower = title.toLowerCase();
  const contentSample = content.substring(0, 500).toLowerCase();
  
  // Podcast transcript detection
  if (contentSample.includes('transcript') || titleLower.includes('podcast') || 
      contentSample.includes('audio') || urlLower.includes('podcast')) {
    return 'podcast_transcript';
  }
  
  // Call transcript detection
  if (contentSample.includes('call transcript') || contentSample.includes('meeting notes') ||
      titleLower.includes('call') || titleLower.includes('meeting')) {
    return 'call_transcript';
  }
  
  // LinkedIn post detection
  if (urlLower.includes('linkedin.com') || contentSample.includes('linkedin')) {
    return 'linkedin_post';
  }
  
  // Reddit comment detection
  if (urlLower.includes('reddit.com') || contentSample.includes('reddit')) {
    return 'reddit_comment';
  }
  
  // Book detection
  if (titleLower.includes('book') || titleLower.includes('chapter') ||
      contentSample.includes('table of contents') || urlLower.includes('book')) {
    return 'book';
  }
  
  // Default to blog for most content
  if (urlLower.includes('blog') || urlLower.includes('article') || 
      urlLower.includes('post') || urlLower.includes('guide')) {
    return 'blog';
  }
  
  return 'other';
}

async function extractContent(page, url) {
  const content = await page.evaluate((selectors, titleSelectors) => {
    // Find title
    let title = '';
    for (const selector of titleSelectors) {
      const titleEl = document.querySelector(selector);
      if (titleEl && titleEl.textContent.trim()) {
        title = titleEl.textContent.trim();
        break;
      }
    }
    
    // Find main content
    let contentEl = null;
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent.trim().length > 100) {
        contentEl = el;
        break;
      }
    }
    
    if (!contentEl) {
      // Fallback: find the element with most text content
      const allElements = Array.from(document.querySelectorAll('div, section, article'));
      contentEl = allElements.reduce((prev, current) => {
        const prevLength = prev ? prev.textContent.length : 0;
        const currentLength = current.textContent.length;
        return currentLength > prevLength ? current : prev;
      }, null);
    }
    
    return {
      title: title || document.title || '',
      html: contentEl ? contentEl.innerHTML : document.body.innerHTML
    };
  }, CONTENT_SELECTORS, TITLE_SELECTORS);
  
  // Convert HTML to Markdown
  const markdown = turndownService.turndown(content.html);
  
  // Clean up markdown
  const cleanMarkdown = markdown
    .replace(/\n{3,}/g, '\n\n') // Remove excessive line breaks
    .replace(/^\s+|\s+$/g, '') // Trim whitespace
    .replace(/\[([^\]]+)\]\(\)/g, '$1'); // Remove empty links
  
  return {
    title: content.title,
    content: cleanMarkdown,
    content_type: detectContentType(url, content.title, cleanMarkdown),
    source_url: url
  };
}

async function findAllUrls(page, baseUrl) {
  const urls = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href]'));
    return links.map(link => link.href).filter(href => href && href.length > 0);
  });
  
  const validUrls = new Set();
  
  for (const url of urls) {
    const normalizedUrl = normalizeUrl(url, baseUrl);
    if (normalizedUrl && isValidContentUrl(normalizedUrl, baseUrl)) {
      validUrls.add(normalizedUrl);
    }
  }
  
  return Array.from(validUrls);
}

export async function scrapeWebsite(inputUrl) {
  let browser;
  const results = [];
  const processed = new Set();
  
  try {
    // Normalize input URL
    let baseUrl = inputUrl;
    if (!baseUrl.startsWith('http')) {
      baseUrl = `https://${baseUrl}`;
    }
    
    browser = await getBrowser();
    const page = await browser.newPage();
    
    // Set user agent and viewport
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });
    
    console.log(`Navigating to: ${baseUrl}`);
    await page.goto(baseUrl, { 
      waitUntil: 'networkidle0',
      timeout: 30000 
    });
    
    // Extract content from main page
    const mainContent = await extractContent(page, baseUrl);
    results.push(mainContent);
    processed.add(baseUrl);
    
    // Find all potential content URLs
    console.log('Finding content URLs...');
    const contentUrls = await findAllUrls(page, baseUrl);
    console.log(`Found ${contentUrls.length} potential content URLs`);
    
    // Limit to prevent overwhelming servers
    const maxUrls = Math.min(contentUrls.length, 50);
    
    for (let i = 0; i < maxUrls; i++) {
      const url = contentUrls[i];
      
      if (processed.has(url)) continue;
      processed.add(url);
      
      try {
        console.log(`Scraping ${i + 1}/${maxUrls}: ${url}`);
        await page.goto(url, { 
          waitUntil: 'networkidle0',
          timeout: 20000 
        });
        
        const content = await extractContent(page, url);
        
        // Only include if we got substantial content
        if (content.content.length > 200) {
          results.push(content);
        }
        
        // Small delay to be respectful
        await page.waitForTimeout(500);
        
      } catch (error) {
        console.log(`Failed to scrape ${url}: ${error.message}`);
        continue;
      }
    }
    
    return {
      site: baseUrl,
      items: results,
      total_found: contentUrls.length,
      total_scraped: results.length
    };
    
  } catch (error) {
    console.error('Error in scrapeWebsite:', error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
