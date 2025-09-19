interface ScrapedItem {
  title: string;
  content: string;
  content_type: 'blog' | 'podcast_transcript' | 'call_transcript' | 'linkedin_post' | 'reddit_comment' | 'book' | 'other';
  source_url: string;
}

interface ScrapedData {
  site: string;
  items: ScrapedItem[];
  total_found?: number;
  total_scraped?: number;
}

export type { ScrapedItem, ScrapedData };
