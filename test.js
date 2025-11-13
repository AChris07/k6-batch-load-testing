import { browser } from "k6/browser";
import { check } from "k6";
import { Trend, Counter } from "k6/metrics";

// Load configuration
const CONFIG_FILE = open("./config.json");
const config = JSON.parse(CONFIG_FILE);

// Custom metrics
const pageLoadTime = new Trend("page_load_time");
const initialRenderTime = new Trend("initial_render_time");
const screenshotsTaken = new Counter("screenshots_taken");
const testErrors = new Counter("test_errors");
const urlsProcessed = new Counter("urls_processed");

// Extract URLs from config
const URLS = config.urls || [
  { url: "https://khov.com", name: "Home Page", timeout: 30000 },
];

const SCREENSHOT_DELAY = config.settings?.screenshotDelay || 2000;

export const options = {
  scenarios: {
    parallel_browser_tests: {
      executor: "per-vu-iterations",
      vus: config.settings?.parallelVUs || 3,
      iterations: URLS.length,
      maxDuration: config.settings?.maxDuration || "5m",
      options: {
        browser: {
          type: "chromium",
        },
      },
    },
  },
  thresholds: {
    page_load_time: [`p(95)<${config.thresholds?.pageLoadTime95p || 5000}`],
    initial_render_time: [
      `p(95)<${config.thresholds?.initialRenderTime95p || 3000}`,
    ],
    test_errors: [`count<${config.thresholds?.maxErrors || 5}`],
  },
};

export default async function () {
  const viewport = config.settings?.viewport || { width: 1280, height: 720 };

  const context = await browser.newContext({
    viewport: viewport,
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  // Listen for console messages (optional debugging)
  // page.on("console", (msg) => {
  //   if (msg.type() === "error") {
  //     console.log(`Console error from page: ${msg.text()}`);
  //   }
  // });

  // Get URL configuration for this VU iteration
  const urlIndex = (__VU - 1) % URLS.length;
  const urlConfig = URLS[urlIndex];
  const testUrl = urlConfig.url;
  const testName = urlConfig.name || testUrl;
  const timeout = urlConfig.timeout || 30000;

  try {
    console.log(`VU ${__VU}: Starting test for ${testName} (${testUrl})`);

    // Set up performance timing
    const testStartTime = Date.now();

    // Navigate to the page with custom timeout
    const response = await page.goto(testUrl, {
      waitUntil: "domcontentloaded",
      timeout,
    });

    const domContentLoadedTime = Date.now();
    const loadTime = domContentLoadedTime - testStartTime;
    pageLoadTime.add(loadTime);

    // Comprehensive page checks
    check(response, {
      "page loaded successfully": (r) => r && r.status() === 200,
      "page load time acceptable": () => loadTime < timeout,
      "response not null": (r) => r !== null,
    });

    console.log(`VU ${__VU}: ${testName} loaded in ${loadTime}ms`);

    // Wait for full page load and initial rendering
    await page.waitForLoadState("load", {
      timeout,
    });

    const initialRenderCompleteTime = Date.now();
    const renderTime = initialRenderCompleteTime - domContentLoadedTime;
    initialRenderTime.add(renderTime);

    console.log(
      `VU ${__VU}: ${testName} initial render completed in ${renderTime}ms`
    );

    // Take screenshot right after initial rendering
    const timestamp = Date.now();
    const urlSlug = sanitizeFileName(testName);
    const screenshotPath1 = `screenshots/${urlSlug}_initial_vu${__VU}_${timestamp}.png`;

    await takeScreenshot(
      page,
      screenshotPath1,
      `${testName} - Initial render`,
      config.settings
    );

    // Wait for the specified delay
    console.log(
      `VU ${__VU}: Waiting ${SCREENSHOT_DELAY}ms before second screenshot...`
    );
    await page.waitForTimeout(SCREENSHOT_DELAY);

    // Take second screenshot after delay
    const screenshotPath2 = `screenshots/${urlSlug}_delayed_vu${__VU}_${
      timestamp + SCREENSHOT_DELAY
    }.png`;
    await takeScreenshot(
      page,
      screenshotPath2,
      `${testName} - After ${SCREENSHOT_DELAY}ms`,
      config.settings
    );

    // Collect detailed performance metrics
    const performanceMetrics = await page.evaluate(() => {
      try {
        const navigation = performance.getEntriesByType("navigation")[0];
        const paintEntries = performance.getEntriesByType("paint");

        let firstPaint = 0;
        let firstContentfulPaint = 0;

        paintEntries.forEach((entry) => {
          if (entry.name === "first-paint") firstPaint = entry.startTime;
          if (entry.name === "first-contentful-paint")
            firstContentfulPaint = entry.startTime;
        });

        if (navigation) {
          return {
            domContentLoaded:
              navigation.domContentLoadedEventEnd - navigation.navigationStart,
            loadComplete: navigation.loadEventEnd - navigation.navigationStart,
            firstPaint: firstPaint,
            firstContentfulPaint: firstContentfulPaint,
            domInteractive:
              navigation.domInteractive - navigation.navigationStart,
            redirectTime: navigation.redirectEnd - navigation.redirectStart,
            dnsTime: navigation.domainLookupEnd - navigation.domainLookupStart,
            connectTime: navigation.connectEnd - navigation.connectStart,
          };
        }
        return null;
      } catch (error) {
        console.log("Error collecting performance metrics:", error.message);
        return null;
      }
    });

    if (performanceMetrics) {
      console.log(
        `VU ${__VU}: Performance metrics for ${testName}:`,
        JSON.stringify(performanceMetrics, null, 2)
      );
    }

    // Additional page quality checks
    const qualityChecks = await performQualityChecks(page, testName);

    check(qualityChecks, {
      "page has title": (q) => q.hasTitle,
      "page has content": (q) => q.hasContent,
      "no critical errors detected": (q) => q.noCriticalErrors,
    });

    urlsProcessed.add(1);
    console.log(`VU ${__VU}: Test completed successfully for ${testName}`);
  } catch (error) {
    testErrors.add(1);
    console.error(`VU ${__VU}: Error testing ${testName}:`, error.message);

    // Take error screenshot
    try {
      const errorTimestamp = Date.now();
      const urlSlug = sanitizeFileName(testName);
      const errorScreenshotPath = `screenshots/${urlSlug}_ERROR_vu${__VU}_${errorTimestamp}.png`;
      await takeScreenshot(
        page,
        errorScreenshotPath,
        `${testName} - ERROR STATE`,
        config.settings
      );
    } catch (screenshotError) {
      console.error(
        `VU ${__VU}: Could not take error screenshot:`,
        screenshotError.message
      );
    }

    // Don't throw the error to allow other tests to continue
  }

  page.close();
  context.close();
}

async function takeScreenshot(page, path, description, settings = {}) {
  try {
    const screenshotOptions = {
      path: path,
      fullPage: settings?.fullPageScreenshots !== false,
      quality: settings?.screenshotQuality || 80,
    };

    await page.screenshot(screenshotOptions);
    screenshotsTaken.add(1);
    console.log(`📸 Screenshot taken: ${description} -> ${path}`);
  } catch (error) {
    console.error(
      `❌ Failed to take screenshot (${description}):`,
      error.message
    );
  }
}

async function performQualityChecks(page, testName) {
  try {
    const title = await page.title();
    const bodyText = await page.textContent("body");

    // Check for common error indicators
    const errorIndicators = await page.evaluate(() => {
      const bodyText = document.body.textContent.toLowerCase();
      const errorStrings = [
        "404",
        "500",
        "error",
        "not found",
        "server error",
        "connection refused",
      ];
      return errorStrings.some((errorString) => bodyText.includes(errorString));
    });

    return {
      hasTitle: title && title.length > 0,
      hasContent: bodyText && bodyText.trim().length > 100, // At least some content
      noCriticalErrors: !errorIndicators,
      testName: testName,
    };
  } catch (error) {
    console.error(`Quality check failed for ${testName}:`, error.message);
    return {
      hasTitle: false,
      hasContent: false,
      noCriticalErrors: false,
      testName: testName,
    };
  }
}

function sanitizeFileName(name) {
  return name
    .replace(/https?:\/\//, "")
    .replace(/[^a-zA-Z0-9-_]/g, "_")
    .replace(/_+/g, "_")
    .substring(0, 50)
    .replace(/^_|_$/g, ""); // Remove leading/trailing underscores
}

export function handleSummary(data) {
  const summaryData = {
    ...data,
    timestamp: new Date().toISOString(),
    config: config,
  };

  return {
    "summary.json": JSON.stringify(summaryData, null, 2),
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}

function textSummary(data, options = {}) {
  const indent = options.indent || "";

  let summary =
    "\n" +
    indent +
    "🚀 === K6 Parallel URL Performance Test Summary === 🚀\n\n";

  // Test execution summary
  summary += indent + `📊 Test Configuration:\n`;
  summary += indent + `   Total URLs tested: ${URLS.length}\n`;
  summary +=
    indent + `   Virtual Users: ${data.metrics.vus_max?.values.max || "N/A"}\n`;
  summary +=
    indent +
    `   Total Iterations: ${data.metrics.iterations?.values.count || "N/A"}\n`;
  summary +=
    indent +
    `   Test Duration: ${Math.round(
      (data.state.testRunDurationMs || 0) / 1000
    )}s\n\n`;

  // URLs tested
  summary += indent + `🔗 URLs Tested:\n`;
  URLS.forEach((urlConfig, index) => {
    summary += indent + `   ${index + 1}. ${urlConfig.name || urlConfig.url}\n`;
  });
  summary += "\n";

  // Performance metrics
  if (data.metrics.page_load_time) {
    summary += indent + "⏱️  Page Load Times:\n";
    summary +=
      indent +
      `   Average: ${Math.round(data.metrics.page_load_time.values.avg)}ms\n`;
    summary +=
      indent +
      `   Median: ${Math.round(data.metrics.page_load_time.values.med)}ms\n`;
    summary +=
      indent +
      `   95th percentile: ${Math.round(
        data.metrics.page_load_time.values["p(95)"]
      )}ms\n`;
    summary +=
      indent +
      `   Min: ${Math.round(data.metrics.page_load_time.values.min)}ms\n`;
    summary +=
      indent +
      `   Max: ${Math.round(data.metrics.page_load_time.values.max)}ms\n\n`;
  }

  if (data.metrics.initial_render_time) {
    summary += indent + "🎨 Initial Render Times:\n";
    summary +=
      indent +
      `   Average: ${Math.round(
        data.metrics.initial_render_time.values.avg
      )}ms\n`;
    summary +=
      indent +
      `   Median: ${Math.round(
        data.metrics.initial_render_time.values.med
      )}ms\n`;
    summary +=
      indent +
      `   95th percentile: ${Math.round(
        data.metrics.initial_render_time.values["p(95)"]
      )}ms\n`;
    summary +=
      indent +
      `   Min: ${Math.round(data.metrics.initial_render_time.values.min)}ms\n`;
    summary +=
      indent +
      `   Max: ${Math.round(
        data.metrics.initial_render_time.values.max
      )}ms\n\n`;
  }

  // Success/Error summary
  summary += indent + "📈 Test Results:\n";
  if (data.metrics.urls_processed) {
    summary +=
      indent +
      `   URLs successfully processed: ${data.metrics.urls_processed.values.count}\n`;
  }
  if (data.metrics.screenshots_taken) {
    summary +=
      indent +
      `   Screenshots taken: ${data.metrics.screenshots_taken.values.count}\n`;
  }
  if (data.metrics.test_errors) {
    summary +=
      indent +
      `   Errors encountered: ${data.metrics.test_errors.values.count}\n`;
  }

  // Check results
  if (data.metrics.checks) {
    const passRate =
      (data.metrics.checks.values.passes /
        (data.metrics.checks.values.passes +
          data.metrics.checks.values.fails)) *
      100;
    summary +=
      indent + `   Overall check pass rate: ${Math.round(passRate)}%\n`;
  }

  summary += "\n" + indent + "✅ Test completed!\n";
  summary += indent + `📁 Screenshots saved in: screenshots/\n`;
  summary += indent + `📄 Detailed results saved in: summary.json\n\n`;

  return summary;
}
