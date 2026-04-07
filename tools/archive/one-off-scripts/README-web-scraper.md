# Web Scraper Tool

A powerful web scraping tool for Claude Tools Kit that uses Puppeteer to extract data from websites, handle authentication, and capture screenshots.

## Features

- 🌐 Scrape any website with dynamic content
- 🔐 Handle authentication (login forms)
- 📸 Take full-page screenshots
- ⏳ Wait for specific elements to load
- 📊 Extract structured data (links, images, metadata)
- 💾 Save results to JSON file
- 🎭 Run in headless or visible mode

## Installation

Make sure you have Puppeteer installed:

```bash
npm install puppeteer
```

## Usage

Basic usage:
```bash
node tools/web-scraper.js https://example.com
```

With authentication:
```bash
node tools/web-scraper.js https://app.example.com --auth --username user@example.com --password mypassword
```

Take screenshot:
```bash
node tools/web-scraper.js https://example.com --screenshot
```

Wait for specific element:
```bash
node tools/web-scraper.js https://example.com --wait ".content-loaded"
```

Save to file:
```bash
node tools/web-scraper.js https://example.com --output data.json
```

Full example:
```bash
node tools/web-scraper.js https://app.example.com \
  --auth \
  --username user@example.com \
  --password mypassword \
  --wait ".dashboard" \
  --screenshot \
  --output scraped-data.json
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--auth` | Enable authentication mode | false |
| `--username <user>` | Username for authentication | - |
| `--password <pass>` | Password for authentication | - |
| `--screenshot` | Take screenshot of the page | false |
| `--wait <selector>` | Wait for specific CSS selector | - |
| `--timeout <ms>` | Navigation timeout in milliseconds | 30000 |
| `--headless` | Run in headless mode | false |
| `--output <file>` | Output file for scraped data | - |

## Output Format

The tool extracts and returns data in the following format:

```json
{
  "title": "Page Title",
  "url": "https://example.com",
  "metadata": {
    "description": "Page description",
    "keywords": "keywords, here"
  },
  "content": {
    "text": "Full text content",
    "html": "<html>...</html>"
  },
  "links": [
    {
      "text": "Link text",
      "href": "https://example.com/link",
      "title": "Link title"
    }
  ],
  "images": [
    {
      "src": "https://example.com/image.jpg",
      "alt": "Image description",
      "title": "Image title"
    }
  ],
  "structuredData": []
}
```

## Examples

### Scraping a protected dashboard
```bash
node tools/web-scraper.js https://thr.todak.io \
  --auth \
  --username neo@todak.com \
  --password T0d@k1q2w3e \
  --wait ".dashboard-content" \
  --screenshot \
  --output thr-dashboard-data.json
```

### Extracting data from a public website
```bash
node tools/web-scraper.js https://news.ycombinator.com \
  --wait ".itemlist" \
  --output hn-frontpage.json
```

### Taking screenshots for documentation
```bash
node tools/web-scraper.js https://myapp.com/features \
  --screenshot \
  --headless
```

## Error Handling

The tool includes robust error handling for common scenarios:
- Network timeouts
- Missing elements
- Authentication failures
- Invalid selectors

## Security Notes

- Credentials are not stored or logged
- Use environment variables for sensitive data in scripts
- Be respectful of websites' robots.txt and terms of service
- Add delays between requests to avoid rate limiting

## Integration with Claude

This tool can be used by Claude to:
- Analyze competitor websites
- Extract documentation
- Monitor website changes
- Gather data for analysis
- Test web applications