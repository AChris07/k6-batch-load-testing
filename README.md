# K6 URL Performance Testing Script

This script tests multiple URLs in parallel, measuring load times and taking screenshots at different intervals.

## Features

- **Parallel Testing**: Tests multiple URLs simultaneously using K6's virtual users
- **Performance Metrics**: Measures page load times, initial render times, and DOM content loaded times
- **Screenshots**: Takes screenshots right after initial rendering and 2 seconds later
- **Error Handling**: Captures errors and takes error screenshots when tests fail
- **Custom Metrics**: Tracks various performance indicators with thresholds
- **Detailed Reporting**: Provides comprehensive test summaries

## Prerequisites

1. Install K6 with browser support:

   ```bash
   # On macOS
   brew install k6

   # Or download from https://k6.io/docs/getting-started/installation/
   ```

2. Create screenshots directory:
   ```bash
   mkdir -p screenshots
   ```

## Configuration

Edit the `URLS` array in the script to include your target URLs:

```javascript
const URLS = [
  "https://your-website.com",
  "https://your-website.com/page1",
  "https://your-website.com/page2",
  // Add more URLs as needed
];
```

## Usage

### Basic Run

```bash
k6 run test.js
```

### Run with Custom VUs and Duration

```bash
k6 run --vus 5 --duration 2m test.js
```

### Run with Environment Variables

```bash
K6_BROWSER_ENABLED=true k6 run test.js
```

## Output

The script generates:

- Real-time console output with progress and metrics
- Screenshots in the `screenshots/` directory
- `summary.json` file with detailed test results
- Performance metrics including:
  - Page load times (avg, median, 95th percentile)
  - Initial render times
  - Screenshot counts
  - Error counts

## Customization

### Adjust Screenshot Timing

Change the `SCREENSHOT_DELAY` constant:

```javascript
const SCREENSHOT_DELAY = 3000; // 3 seconds instead of 2
```

### Modify Thresholds

Update the thresholds in the options:

```javascript
thresholds: {
  page_load_time: ['p(95)<3000'], // Stricter 3s threshold
  initial_render_time: ['p(95)<2000'], // Stricter 2s threshold
},
```

### Add More Metrics

You can add custom metrics for specific measurements:

```javascript
const customMetric = new Trend("custom_metric_name");
```

## Troubleshooting

1. **Browser not launching**: Ensure K6 browser support is installed
2. **Screenshots not saving**: Check directory permissions for `screenshots/`
3. **Timeouts**: Increase timeout values for slow-loading sites
4. **Memory issues**: Reduce the number of VUs or URLs being tested

## Example Output

```
=== K6 Performance Test Summary ===

Total VUs: 3
Total Iterations: 5
Test Duration: 45000ms

Page Load Times:
  Average: 1250ms
  Median: 1100ms
  95th percentile: 2100ms

Initial Render Times:
  Average: 800ms
  Median: 750ms
  95th percentile: 1200ms

Screenshots taken: 10
Errors encountered: 0
```
