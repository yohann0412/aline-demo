import { useState } from 'react';
import type { ScrapedItem } from '../types/scraper';
import './ResultsTable.css';

interface ResultsTableProps {
  items: ScrapedItem[];
}

export function ResultsTable({ items }: ResultsTableProps) {
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const totalPages = Math.ceil(items.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentItems = items.slice(startIndex, endIndex);

  const toggleRow = (index: number) => {
    setExpandedRow(expandedRow === index ? null : index);
  };

  const getContentTypeColor = (type: string) => {
    const colors = {
      blog: '#007AFF',
      podcast_transcript: '#FF9500',
      call_transcript: '#FF3B30',
      linkedin_post: '#0077B5',
      reddit_comment: '#FF4500',
      book: '#34C759',
      other: '#8E8E93'
    };
    return colors[type as keyof typeof colors] || colors.other;
  };

  const truncateContent = (content: string, maxLength: number = 200) => {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + '...';
  };

  if (items.length === 0) {
    return (
      <div className="no-results">
        <p>No content was extracted from this website.</p>
        <small>The site might use JavaScript-heavy content or have restricted access.</small>
      </div>
    );
  }

  return (
    <div className="results-table">
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Type</th>
              <th>Content Preview</th>
              <th>Source</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {currentItems.map((item, index) => {
              const globalIndex = startIndex + index;
              const isExpanded = expandedRow === globalIndex;
              
              return (
                <tr key={globalIndex} className={isExpanded ? 'expanded' : ''}>
                  <td className="title-cell">
                    <div className="title-content">
                      <h3>{item.title || 'Untitled'}</h3>
                    </div>
                  </td>
                  
                  <td className="type-cell">
                    <span 
                      className="type-badge"
                      style={{ backgroundColor: getContentTypeColor(item.content_type) }}
                    >
                      {item.content_type.replace('_', ' ')}
                    </span>
                  </td>
                  
                  <td className="content-cell">
                    <div className="content-preview">
                      {isExpanded ? (
                        <pre className="full-content">{item.content}</pre>
                      ) : (
                        <p>{truncateContent(item.content)}</p>
                      )}
                    </div>
                  </td>
                  
                  <td className="source-cell">
                    <a 
                      href={item.source_url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="source-link"
                    >
                      View Original
                    </a>
                  </td>
                  
                  <td className="action-cell">
                    <button 
                      onClick={() => toggleRow(globalIndex)}
                      className="expand-button"
                    >
                      {isExpanded ? '−' : '+'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button 
            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
            disabled={currentPage === 1}
            className="pagination-button"
          >
            Previous
          </button>
          
          <span className="pagination-info">
            Page {currentPage} of {totalPages}
          </span>
          
          <button 
            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
            disabled={currentPage === totalPages}
            className="pagination-button"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
