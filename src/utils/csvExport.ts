import type { ScrapedItem } from '../types/scraper';

export function exportToCsv(items: ScrapedItem[], filename: string) {
  // Define CSV headers
  const headers = ['Title', 'Content Type', 'Content', 'Source URL'];
  
  // Convert items to CSV rows
  const csvRows = [
    headers.join(','), // Header row
    ...items.map(item => [
      `"${(item.title || '').replace(/"/g, '""')}"`,
      `"${item.content_type.replace(/"/g, '""')}"`,
      `"${item.content.replace(/"/g, '""')}"`,
      `"${item.source_url.replace(/"/g, '""')}"`
    ].join(','))
  ];
  
  // Create CSV content
  const csvContent = csvRows.join('\n');
  
  // Create and trigger download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
