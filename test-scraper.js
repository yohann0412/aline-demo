// Simple test script to verify our scraper works
import { scrapeWebsite } from './server/scraper.js';

const testUrls = [
  'https://interviewing.io/blog',
  'https://quill.co/blog',
  'https://shreycation.substack.com'
];

async function runTests() {
  console.log('🧪 Testing Aline Web Scraper...\n');
  
  for (const url of testUrls) {
    try {
      console.log(`Testing: ${url}`);
      const startTime = Date.now();
      
      const result = await scrapeWebsite(url);
      const duration = Date.now() - startTime;
      
      console.log(`✅ Success! Found ${result.items.length} items in ${duration}ms`);
      console.log(`   Content types: ${[...new Set(result.items.map(item => item.content_type))].join(', ')}`);
      console.log(`   Total URLs found: ${result.total_found || 'N/A'}\n`);
      
    } catch (error) {
      console.log(`❌ Failed: ${error.message}\n`);
    }
  }
}

runTests().catch(console.error);
