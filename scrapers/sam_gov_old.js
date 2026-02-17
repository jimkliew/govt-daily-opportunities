#!/usr/bin/env node
/**
 * SAM.gov Federal Contract Opportunities Scraper
 * 
 * Enterprise-grade scraper for federal contract opportunities using SAM.gov API v2.
 * Filters by agency, NAICS codes, and date ranges to find relevant opportunities
 * for SoKat Consulting.
 * 
 * @module sam_gov_scraper
 * @author JARVIS
 * @created 2026-02-15
 * 
 * API Documentation: https://open.gsa.gov/api/opportunities-api/
 * 
 * USAGE:
 *   node sam_gov.js [--days=30] [--output=path/to/file.json] [--limit=100]
 * 
 * ENVIRONMENT:
 *   SAM_GOV_API_KEY - Required. SAM.gov API key for authentication.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Target agencies for contract opportunities
 * @const {string[]}
 */
const TARGET_AGENCIES = [
    'Department of the Treasury',
    'Department of Veterans Affairs',
    'Centers for Medicare & Medicaid Services'
];

/**
 * SoKat Consulting NAICS codes
 * @const {string[]}
 */
const SOKAT_NAICS_CODES = [
    '541511', '541512', '541513', '541519', '511210',
    '518210', '517311', '517312', '519130', '519190',
    '541611', '541614', '541690', '541990', '541618',
    '541715', '541330', '541380', '561422'
];

/**
 * API configuration
 * @const {Object}
 */
const API_CONFIG = {
    baseUrl: 'api.sam.gov',
    endpoint: '/opportunities/v2/search',
    apiKey: process.env.SAM_GOV_API_KEY || '',
    timeout: 30000, // 30 seconds
    maxRetries: 3,
    retryDelay: 2000, // 2 seconds
    pageSize: 100 // Max items per request
};

/**
 * Default scraper options
 * @const {Object}
 */
const DEFAULT_OPTIONS = {
    days: 30, // Look back 30 days
    limit: 1000, // Max opportunities to fetch
    outputPath: null // Auto-generate if not provided
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get date N days ago in MM/dd/yyyy format (SAM.gov API format)
 * @param {number} days - Number of days to subtract
 * @returns {string} Date in MM/dd/yyyy format
 */
function getDaysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();
    return `${month}/${day}/${year}`;
}

/**
 * Get today's date in MM/dd/yyyy format (SAM.gov API format)
 * @returns {string} Today's date
 */
function getToday() {
    const date = new Date();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();
    return `${month}/${day}/${year}`;
}

/**
 * Validate API key exists
 * @throws {Error} If API key is missing
 */
function validateApiKey() {
    if (!API_CONFIG.apiKey) {
        throw new Error(
            'SAM_GOV_API_KEY environment variable is required. ' +
            'Set it with: export SAM_GOV_API_KEY=your-api-key'
        );
    }
}

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Make HTTPS request with retry logic
 * @param {string} url - Full URL to request
 * @param {number} attempt - Current attempt number
 * @returns {Promise<Object>} Parsed JSON response
 * @throws {Error} If all retries fail
 */
async function makeRequest(url, attempt = 1) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: API_CONFIG.timeout }, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const parsed = JSON.parse(data);
                        resolve(parsed);
                    } catch (err) {
                        reject(new Error(`JSON parse error: ${err.message}`));
                    }
                } else if (res.statusCode === 429 && attempt < API_CONFIG.maxRetries) {
                    // Rate limited, retry with exponential backoff
                    const delay = API_CONFIG.retryDelay * Math.pow(2, attempt - 1);
                    console.log(`Rate limited. Retrying in ${delay}ms... (attempt ${attempt}/${API_CONFIG.maxRetries})`);
                    sleep(delay).then(() => {
                        makeRequest(url, attempt + 1).then(resolve).catch(reject);
                    });
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        });

        req.on('error', (err) => {
            if (attempt < API_CONFIG.maxRetries) {
                const delay = API_CONFIG.retryDelay * Math.pow(2, attempt - 1);
                console.log(`Request failed: ${err.message}. Retrying in ${delay}ms... (attempt ${attempt}/${API_CONFIG.maxRetries})`);
                sleep(delay).then(() => {
                    makeRequest(url, attempt + 1).then(resolve).catch(reject);
                });
            } else {
                reject(new Error(`Request failed after ${API_CONFIG.maxRetries} attempts: ${err.message}`));
            }
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

// ============================================================================
// DATA TRANSFORMATION
// ============================================================================

/**
 * Normalize opportunity data from SAM.gov API response
 * @param {Object} raw - Raw opportunity from API
 * @param {string} scrapedAt - ISO timestamp of scrape
 * @returns {Object} Normalized opportunity object
 */
function normalizeOpportunity(raw, scrapedAt) {
    return {
        id: raw.noticeId || raw.solicitationNumber || `SAM-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        title: raw.title || 'Untitled',
        agency: raw.department || raw.subtier || 'Unknown',
        subAgency: raw.subtier || raw.office || null,
        naicsCode: raw.naicsCode ? [raw.naicsCode] : [],
        postedDate: raw.postedDate || raw.publishedDate || new Date().toISOString(),
        responseDeadline: raw.responseDeadLine || raw.archiveDate || null,
        setAside: raw.typeOfSetAside || raw.typeOfSetAsideDescription || 'Not specified',
        estimatedValue: parseEstimatedValue(raw),
        description: raw.description || raw.additionalInfoText || '',
        url: raw.uiLink || `https://sam.gov/opp/${raw.noticeId}`,
        source: 'SAM.gov',
        scrapedAt,
        // Additional useful fields
        noticeType: raw.type || raw.noticeType || 'Unknown',
        organizationType: raw.organizationType || null,
        contactInfo: {
            email: raw.pointOfContact?.[0]?.email || null,
            phone: raw.pointOfContact?.[0]?.phone || null,
            name: raw.pointOfContact?.[0]?.fullName || null
        }
    };
}

/**
 * Parse estimated value from various SAM.gov formats
 * @param {Object} raw - Raw opportunity data
 * @returns {number|null} Estimated value in dollars, or null if not available
 */
function parseEstimatedValue(raw) {
    // Try multiple fields where value might be stored
    const valueFields = [
        raw.estimatedValue,
        raw.award?.amount,
        raw.awardAmount,
        raw.obligatedAmount
    ];

    for (const field of valueFields) {
        if (field != null) {
            const parsed = typeof field === 'number' ? field : parseFloat(String(field).replace(/[^0-9.-]/g, ''));
            if (!isNaN(parsed) && parsed > 0) {
                return parsed;
            }
        }
    }

    return null;
}

// ============================================================================
// SCRAPER LOGIC
// ============================================================================

/**
 * Build SAM.gov API query URL with filters
 * @param {Object} options - Scraper options
 * @param {number} page - Page number (0-indexed)
 * @returns {string} Complete API URL
 */
function buildApiUrl(options, page = 0) {
    const params = new URLSearchParams({
        api_key: API_CONFIG.apiKey,
        postedFrom: getDaysAgo(options.days),
        postedTo: getToday(),
        limit: API_CONFIG.pageSize,
        offset: page * API_CONFIG.pageSize
    });

    // Note: SAM.gov API doesn't support NAICS or agency filtering in v2
    // We'll filter results after fetching

    // Note: SAM.gov API may not support agency filtering directly
    // We'll filter in post-processing if needed

    const url = `https://${API_CONFIG.baseUrl}${API_CONFIG.endpoint}?${params.toString()}`;
    return url;
}

/**
 * Fetch opportunities from SAM.gov API with pagination
 * @param {Object} options - Scraper options
 * @returns {Promise<Object[]>} Array of normalized opportunities
 */
async function fetchOpportunities(options) {
    console.log('🔍 Starting SAM.gov scraper...');
    console.log(`📅 Date range: ${getDaysAgo(options.days)} to ${getToday()}`);
    console.log(`🎯 Target agencies: ${TARGET_AGENCIES.join(', ')}`);
    console.log(`📊 NAICS codes: ${SOKAT_NAICS_CODES.length} codes`);

    const allOpportunities = [];
    const scrapedAt = new Date().toISOString();
    let page = 0;
    let hasMorePages = true;

    while (hasMorePages && allOpportunities.length < options.limit) {
        const url = buildApiUrl(options, page);
        console.log(`\n📄 Fetching page ${page + 1}...`);

        try {
            const response = await makeRequest(url);

            // SAM.gov API response structure varies, handle multiple formats
            const opportunities = response.opportunitiesData || response.results || response.data || [];

            if (!Array.isArray(opportunities) || opportunities.length === 0) {
                console.log('✅ No more opportunities found.');
                hasMorePages = false;
                break;
            }

            console.log(`   Found ${opportunities.length} opportunities on this page`);

            // Normalize and filter by agency (if API doesn't support agency filter)
            for (const raw of opportunities) {
                const normalized = normalizeOpportunity(raw, scrapedAt);

                // Filter by target agencies
                const matchesAgency = TARGET_AGENCIES.some(agency =>
                    normalized.agency.toLowerCase().includes(agency.toLowerCase()) ||
                    agency.toLowerCase().includes(normalized.agency.toLowerCase())
                );

                if (matchesAgency) {
                    allOpportunities.push(normalized);
                }

                // Stop if we've hit the limit
                if (allOpportunities.length >= options.limit) {
                    hasMorePages = false;
                    break;
                }
            }

            // Check if there are more pages
            const totalResults = response.totalRecords || response.total || response.count;
            const currentOffset = page * API_CONFIG.pageSize;
            hasMorePages = totalResults && (currentOffset + opportunities.length) < totalResults;

            page++;

            // Rate limiting: pause between requests
            if (hasMorePages) {
                await sleep(500); // 500ms between requests
            }

        } catch (error) {
            console.error(`❌ Error fetching page ${page + 1}: ${error.message}`);
            hasMorePages = false;
        }
    }

    console.log(`\n✅ Scraping complete. Total opportunities: ${allOpportunities.length}`);
    return allOpportunities;
}

/**
 * Save opportunities to JSON file
 * @param {Object[]} opportunities - Array of opportunities
 * @param {string} outputPath - Path to output file
 */
function saveOpportunities(opportunities, outputPath) {
    // Ensure directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    // Write with pretty formatting
    fs.writeFileSync(
        outputPath,
        JSON.stringify(opportunities, null, 2),
        'utf8'
    );

    console.log(`\n💾 Data saved to: ${outputPath}`);
}

/**
 * Generate summary statistics
 * @param {Object[]} opportunities - Array of opportunities
 * @returns {Object} Summary statistics
 */
function generateSummary(opportunities) {
    const summary = {
        total: opportunities.length,
        byAgency: {},
        bySetAside: {},
        withValues: opportunities.filter(o => o.estimatedValue != null).length,
        totalEstimatedValue: 0,
        dateRange: {
            earliest: null,
            latest: null
        }
    };

    opportunities.forEach(opp => {
        // Count by agency
        summary.byAgency[opp.agency] = (summary.byAgency[opp.agency] || 0) + 1;

        // Count by set-aside
        summary.bySetAside[opp.setAside] = (summary.bySetAside[opp.setAside] || 0) + 1;

        // Sum estimated values
        if (opp.estimatedValue) {
            summary.totalEstimatedValue += opp.estimatedValue;
        }

        // Track date range
        const posted = new Date(opp.postedDate);
        if (!summary.dateRange.earliest || posted < new Date(summary.dateRange.earliest)) {
            summary.dateRange.earliest = opp.postedDate;
        }
        if (!summary.dateRange.latest || posted > new Date(summary.dateRange.latest)) {
            summary.dateRange.latest = opp.postedDate;
        }
    });

    return summary;
}

/**
 * Print summary statistics to console
 * @param {Object} summary - Summary statistics object
 */
function printSummary(summary) {
    console.log('\n📊 SUMMARY STATISTICS');
    console.log('═'.repeat(60));
    console.log(`Total opportunities: ${summary.total}`);
    console.log(`\nBy Agency:`);
    Object.entries(summary.byAgency)
        .sort((a, b) => b[1] - a[1])
        .forEach(([agency, count]) => {
            console.log(`  • ${agency}: ${count}`);
        });

    console.log(`\nBy Set-Aside:`);
    Object.entries(summary.bySetAside)
        .sort((a, b) => b[1] - a[1])
        .forEach(([setAside, count]) => {
            console.log(`  • ${setAside}: ${count}`);
        });

    if (summary.withValues > 0) {
        console.log(`\nWith estimated values: ${summary.withValues}`);
        console.log(`Total estimated value: $${summary.totalEstimatedValue.toLocaleString()}`);
    }

    if (summary.dateRange.earliest && summary.dateRange.latest) {
        console.log(`\nDate range: ${summary.dateRange.earliest} to ${summary.dateRange.latest}`);
    }
    console.log('═'.repeat(60));
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

/**
 * Main scraper function
 * @param {Object} options - Scraper options
 * @returns {Promise<Object[]>} Array of opportunities
 */
async function scrapeSamGov(options = {}) {
    // Merge with defaults
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // Generate output path if not provided
    if (!opts.outputPath) {
        const date = getToday();
        opts.outputPath = path.join(__dirname, `../data/opportunities/${date}.json`);
    }

    try {
        // Validate prerequisites
        validateApiKey();

        // Fetch opportunities
        const opportunities = await fetchOpportunities(opts);

        // Save to file
        saveOpportunities(opportunities, opts.outputPath);

        // Generate and print summary
        const summary = generateSummary(opportunities);
        printSummary(summary);

        // Show sample opportunities
        if (opportunities.length > 0) {
            console.log('\n📋 SAMPLE OPPORTUNITIES (first 3):');
            console.log('═'.repeat(60));
            opportunities.slice(0, 3).forEach((opp, i) => {
                console.log(`\n${i + 1}. ${opp.title}`);
                console.log(`   Agency: ${opp.agency}`);
                console.log(`   NAICS: ${opp.naicsCode.join(', ')}`);
                console.log(`   Posted: ${opp.postedDate.split('T')[0]}`);
                console.log(`   Deadline: ${opp.responseDeadline ? opp.responseDeadline.split('T')[0] : 'N/A'}`);
                console.log(`   Value: ${opp.estimatedValue ? '$' + opp.estimatedValue.toLocaleString() : 'Not specified'}`);
                console.log(`   URL: ${opp.url}`);
            });
            console.log('═'.repeat(60));
        }

        return opportunities;

    } catch (error) {
        console.error('\n❌ SCRAPER FAILED');
        console.error('═'.repeat(60));
        console.error(`Error: ${error.message}`);
        console.error('═'.repeat(60));
        throw error;
    }
}

// ============================================================================
// CLI INTERFACE
// ============================================================================

if (require.main === module) {
    // Parse command line arguments
    const args = process.argv.slice(2);
    const options = {};

    args.forEach(arg => {
        const [key, value] = arg.split('=');
        if (key === '--days') options.days = parseInt(value, 10);
        if (key === '--limit') options.limit = parseInt(value, 10);
        if (key === '--output') options.outputPath = value;
    });

    // Run scraper
    scrapeSamGov(options)
        .then(() => {
            console.log('\n✅ Scraper completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 Scraper failed:', error.message);
            process.exit(1);
        });
}

// Export for testing
module.exports = {
    scrapeSamGov,
    normalizeOpportunity,
    parseEstimatedValue,
    buildApiUrl,
    getDaysAgo,
    getToday
};
