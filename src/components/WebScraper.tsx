import { useState } from 'react';
import axios from 'axios';
import type { ScrapedData, ScrapedItem } from '../types/scraper';
import { LoadingSpinner } from './LoadingSpinner';
import { ResultsTable } from './ResultsTable';
import { exportToCsv } from '../utils/csvExport';
import './WebScraper.css';

export function WebScraper() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ScrapedData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!url.trim()) {
      setError('Please enter a valid URL');
      return;
    }

    setLoading(true);
    setError(null);
    setData(null);

    try {
      const response = await axios.post('http://localhost:3001/api/scrape', {
        url: url.trim()
      });

      setData(response.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to scrape website. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleExportCsv = () => {
    if (data?.items) {
      exportToCsv(data.items, `scraped-data-${new Date().toISOString().split('T')[0]}.csv`);
    }
  };

  const isValidUrl = (input: string): boolean => {
    try {
      new URL(input.startsWith('http') ? input : `https://${input}`);
      return true;
    } catch {
      return false;
    }
  };

  return (
    <div className="web-scraper">
      <div className="header">
        <h1>Aline Web Scraper</h1>
        <p>Extract technical knowledge from any blog or website</p>
      </div>

      <form onSubmit={handleSubmit} className="scraper-form">
        <div className="input-group">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Enter website URL (e.g., interviewing.io/blog)"
            className={`url-input ${error ? 'error' : ''}`}
            disabled={loading}
          />
          <button 
            type="submit" 
            disabled={loading || !url.trim() || !isValidUrl(url)}
            className="scrape-button"
          >
            {loading ? 'Scraping...' : 'Scrape Website'}
          </button>
        </div>
        
        {error && (
          <div className="error-message">
            {error}
          </div>
        )}
      </form>

      {loading && (
        <div className="loading-section">
          <LoadingSpinner />
          <p>Discovering and extracting content...</p>
          <small>This may take a few minutes for large sites</small>
        </div>
      )}

      {data && (
        <div className="results-section">
          <div className="results-header">
            <div className="results-stats">
              <h2>Results for {data.site}</h2>
              <div className="stats">
                <span className="stat">
                  <strong>{data.items.length}</strong> articles scraped
                </span>
                <span className="stat">
                  <strong>{data.total_found || 'N/A'}</strong> URLs found
                </span>
              </div>
            </div>
            
            {data.items.length > 0 && (
              <button onClick={handleExportCsv} className="export-button">
                Export CSV
              </button>
            )}
          </div>

          <ResultsTable items={data.items} />
        </div>
      )}
    </div>
  );
}
