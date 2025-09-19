import express from 'express';
import cors from 'cors';
import { scrapeWebsite } from './scraper.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.post('/api/scrape', async (req, res) => {
  try {
    const { url, limit } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    console.log(`Starting scrape for: ${url} with limit: ${limit || 5}`);
    const result = await scrapeWebsite(url, { limit: limit || 5 });
    
    res.json(result);
  } catch (error) {
    console.error('Scraping error:', error);
    res.status(500).json({ 
      error: 'Failed to scrape website',
      details: error.message 
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🚀 Scraper server running on http://localhost:${PORT}`);
});
