import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import Firecrawl from '@mendable/firecrawl-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const turndownService = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced'
});

// Initialize Firecrawl - you'll need to set your API key in environment variables
const FIRECRAWL_API_KEY = "fc-6358fd45eed74a08942d277344debaa9";
const GEMINI_API_KEY = "AIzaSyCm8wB0X4gPEgnAvsc5v4rg5BXDScVd4hc";
const firecrawl = new Firecrawl({ 
  apiKey: FIRECRAWL_API_KEY
});

// Initialize Gemini - using free tier
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

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
  
  // Clean content with Gemini
  const finalContent = await cleanContentWithGemini(cleanMarkdown, content.title, url);
  
  return {
    title: content.title,
    content: finalContent,
    content_type: detectContentType(url, content.title, finalContent),
    source_url: url,
    method: 'puppeteer'
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

async function cleanContentWithGemini(content, title, url) {
  try {
    console.log(`🤖 Cleaning content with Gemini for: ${url}`);
    
    const prompt = `You are a content extraction expert. I will provide you with scraped content from a webpage that may contain navigation, headers, footers, ads, and other irrelevant elements mixed with the main useful content.

Your task is to:
1. Extract ONLY the main useful content (articles, documentation, tutorials, product descriptions, technical content, etc.)
2. Remove navigation menus, headers, footers, ads, subscription prompts, related links, comments sections, social media buttons
3. Keep the content in markdown format
4. Do NOT change, rewrite, or summarize the content - preserve it exactly as written, word for word
5. Do NOT add any introductions, conclusions, or explanations of your own
6. Return ONLY the cleaned main content that would be valuable to someone trying to learn from this page
7. please remove any and all image urls, image tags, and image content etc. anything that is not text that is useful for us

Title: ${title}
URL: ${url}

Content to clean:
${content}

Return only the cleaned markdown content verbatim:`;

    const result = await geminiModel.generateContent(prompt);
    const cleanedContent = result.response.text().trim();
    
    console.log(`🤖 ✅ Gemini cleaned content: ${content.length} → ${cleanedContent.length} chars`);
    
    // Only use Gemini result if it's substantial and shorter than original (cleaned up)
    if (cleanedContent.length > 100 && cleanedContent.length < content.length * 1.2) {
      return cleanedContent;
    } else {
      console.log(`🤖 ⚠️  Gemini result doesn't look like cleaned content, keeping original`);
      return content;
    }
    
  } catch (error) {
    console.log(`🤖 ❌ Gemini cleaning failed: ${error.message}`);
    return content; // Return original if Gemini fails
  }
}

async function scrapeWithFirecrawl(url) {
  try {
    // Check if API key is configured
    if (!FIRECRAWL_API_KEY || FIRECRAWL_API_KEY === "fc-YOUR-API-KEY") {
      console.log(`⚠️  Firecrawl API key not configured, skipping ${url}`);
      return null;
    }
    
    console.log(`🔥 Attempting Firecrawl scrape for: ${url}`);
    console.log(`🔥 Using API key: ${FIRECRAWL_API_KEY?.substring(0, 8)}...`);
    
    const startTime = Date.now();
    const doc = await firecrawl.scrape(url, { 
      formats: ['markdown', 'html'] 
    });
    const duration = Date.now() - startTime;
    
    console.log(`🔥 Firecrawl response received in ${duration}ms`);
    console.log(`🔥 Full response:`, JSON.stringify(doc, null, 2));
    
    // Normalize Firecrawl response shape (scrape vs crawl)
    const hasDataObject = !!doc?.data;
    const payload = hasDataObject ? doc.data : doc;            // <-- key line
    const { markdown, html, metadata } = payload || {};

    // Check if we have usable content (either shape)
    if (markdown || html) {
      console.log(`🔥 Data received (success=${doc?.success}):`);
      console.log(`  - Markdown length: ${markdown?.length || 0}`);
      console.log(`  - HTML length: ${html?.length || 0}`);
      console.log(`  - Metadata:`, metadata);
      
      // Use markdown if available, fallback to HTML
      let content = markdown || html || '';
      
      // If we got HTML instead of markdown, we might need basic conversion
      if (!markdown && html) {
        console.log(`🔥 Using HTML content as markdown not available`);
        // Basic HTML to text conversion for content extraction
        content = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      }
      
      if (content.length > 50) {
        // Extract title from metadata or content
        const title = metadata?.title || 
                     metadata?.ogTitle || 
                     content.split('\n')[0]?.replace(/^#\s*/, '').substring(0, 100) || 
                     'Untitled';
        
        console.log(`🔥 Extracted title: "${title}"`);
        console.log(`🔥 Content length: ${content.length}`);
        
        // Clean content with Gemini
        const finalContent = await cleanContentWithGemini(content.trim(), title, url);
        
        const result = {
          title: title.trim(),
          content: finalContent,
          content_type: detectContentType(url, title, finalContent),
          source_url: url,
          method: 'firecrawl'
        };
        
        console.log(`🔥 ✅ Successfully processed ${url} with Firecrawl`);
        return result;
      } else {
        console.log(`🔥 ❌ Firecrawl content too short (${content.length} chars)`);
        return null;
      }
    } else {
      console.log(`🔥 ❌ Firecrawl returned no usable data for ${url}`);
      console.log(`🔥 Success flag: ${String(doc?.success)}`);
      console.log(`🔥 Error details:`, doc?.error || 'No error details provided');
      return null;
    }
    
  } catch (error) {
    console.log(`🔥 ❌ Firecrawl exception for ${url}:`);
    console.log(`  - Error name: ${error.name}`);
    console.log(`  - Error message: ${error.message}`);
    console.log(`  - Error stack: ${error.stack}`);
    console.log(`  - Full error object:`, JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    return null;
  }
}

export async function scrapeWebsite(inputUrl, options = {}) {
  const { limit = 20 } = options; // Default limit to 5 as requested
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
    
    // Try to scrape main page with Puppeteer first
    let mainContent = null;
    try {
      console.log(`🤖 Trying Puppeteer for main page: ${baseUrl}...`);
    await page.goto(baseUrl, { 
      waitUntil: 'networkidle0',
      timeout: 30000 
    });
      mainContent = await extractContent(page, baseUrl);
      console.log(`🤖 ✅ Puppeteer succeeded for main page`);
      
      // Check if content is too short, try Firecrawl if so
      if (mainContent && mainContent.content.length < 200) {
        console.log(`🤖 ⚠️  Main page Puppeteer content too short (${mainContent.content.length} chars), trying Firecrawl...`);
        const firecrawlContent = await scrapeWithFirecrawl(baseUrl);
        if (firecrawlContent && firecrawlContent.content.length > mainContent.content.length) {
          console.log(`🔄 ✅ Firecrawl provided better content for main page (${firecrawlContent.content.length} vs ${mainContent.content.length} chars)`);
          mainContent = firecrawlContent;
        } else {
          console.log(`🔄 ⚠️  Firecrawl didn't improve main page content, keeping Puppeteer result`);
        }
      }
      
    } catch (error) {
      console.log(`🤖 ❌ Puppeteer failed for main page: ${error.message}`);
      console.log(`🔄 Switching to Firecrawl fallback for main page...`);
      mainContent = await scrapeWithFirecrawl(baseUrl);
    }
    
    if (mainContent && mainContent.content.length > 200) {
    results.push(mainContent);
      console.log(`✅ Main page successfully scraped using ${mainContent.method.toUpperCase()} (${mainContent.content.length} chars)`);
    } else if (mainContent) {
      console.log(`⚠️  Main page content too short using ${mainContent.method} (${mainContent.content.length} chars)`);
    } else {
      console.log(`❌ Failed to scrape main page with both Puppeteer and Firecrawl`);
    }
    processed.add(baseUrl);
    
    // Find all potential content URLs (only if Puppeteer worked for main page)
    let contentUrls = [];
    if (mainContent && mainContent.method === 'puppeteer') {
    console.log('Finding content URLs...');
      try {
        contentUrls = await findAllUrls(page, baseUrl);
    console.log(`Found ${contentUrls.length} potential content URLs`);
      } catch (error) {
        console.log(`Failed to find URLs: ${error.message}`);
      }
    }
    
    // Limit URLs to process
    const maxUrls = Math.min(contentUrls.length, limit);
    console.log(`Processing ${maxUrls} URLs (limit: ${limit})`);
    
    // Process each URL sequentially as requested
    for (let i = 0; i < maxUrls; i++) {
      const url = contentUrls[i];
      
      if (processed.has(url)) continue;
      processed.add(url);
      
      console.log(`Scraping ${i + 1}/${maxUrls}: ${url}`);
      
      let content = null;
      
      // Try Puppeteer first
      try {
        console.log(`🤖 Trying Puppeteer for ${url}...`);
        await page.goto(url, { 
          waitUntil: 'networkidle0',
          timeout: 20000 
        });
        content = await extractContent(page, url);
        console.log(`🤖 ✅ Puppeteer succeeded for ${url}`);
        
        // Check if content is too short, try Firecrawl if so
        if (content && content.content.length < 200) {
          console.log(`🤖 ⚠️  Puppeteer content too short (${content.content.length} chars), trying Firecrawl...`);
          const firecrawlContent = await scrapeWithFirecrawl(url);
          if (firecrawlContent && firecrawlContent.content.length > content.content.length) {
            console.log(`🔄 ✅ Firecrawl provided better content (${firecrawlContent.content.length} vs ${content.content.length} chars)`);
            content = firecrawlContent;
          } else {
            console.log(`🔄 ⚠️  Firecrawl didn't improve content, keeping Puppeteer result`);
          }
        }
        
      } catch (error) {
        console.log(`🤖 ❌ Puppeteer failed for ${url}: ${error.message}`);
        console.log(`🔄 Switching to Firecrawl fallback...`);
        // Fallback to Firecrawl
        content = await scrapeWithFirecrawl(url);
      }
      
      // Only include if we got content (reduced minimum length)
      if (content && content.content.length > 50) {
        results.push(content);
        console.log(`✅ Successfully scraped ${url} using ${content.method.toUpperCase()} (${content.content.length} chars)`);
      } else if (content) {
        console.log(`⚠️  Content too short for ${url} using ${content.method} (${content.content.length} chars)`);
      } else {
        console.log(`❌ Failed to scrape ${url} with both Puppeteer and Firecrawl`);
      }
      
      // Small delay to be respectful (sequential processing)
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    return {
      site: baseUrl,
      items: results
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
