#!/usr/bin/env node
/**
 * SAM.gov Federal Contract Opportunities Scraper (Simplified & Reliable)
 * 
 * Production-grade scraper for federal contract opportunities using SAM.gov API v2.
 * Filters by agency and NAICS codes to find relevant opportunities for SoKat Consulting.
 * 
 * @module sam_gov_scraper
 * @author JARVIS
 * @created 2026-02-15
 * 
 * API Documentation: https://open.gsa.gov/api/opportunities-api/
 * 
 * USAGE:
 *   node sam_gov_v2.js [--days=30] [--limit=100]
 * 
 * ENVIRONMENT:
 *   SAM_GOV_API_KEY - Required. SAM.gov API key for authentication.
 */

require('dotenv').config();

const https = require('https');
const fs = require('fs');
const path = require('path');

// ============================================================================
// CONFIGURATION
// ============================================================================

// No longer filtering by agency - looking at ALL federal agencies
const TARGET_AGENCIES = null; // Set to null to include all agencies

const SOKAT_NAICS_CODES = [
    '541511', '541512', '541513', '541519', '511210',
    '518210', '517311', '517312', '519130', '519190',
    '541611', '541614', '541690', '541990', '541618',
    '541715', '541330', '541380', '561422'
];

// Biddable opportunity types (exclude Award Notices, Justifications, etc.)
const BIDDABLE_NOTICE_TYPES = [
    'Solicitation',
    'Combined Synopsis/Solicitation',
    'Presolicitation',
    'Sources Sought',
    'Special Notice'
];

const API_KEY = process.env.SAM_GOV_API_KEY;
const PAGE_SIZE = 100;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Format date as MM/dd/yyyy for SAM.gov API
 */
function formatDate(daysAgo = 0) {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();
    return `${month}/${day}/${year}`;
}

/**
 * Check if opportunity matches our agency criteria
 */
function matchesAgency(opp) {
    // If TARGET_AGENCIES is null, accept all agencies
    if (TARGET_AGENCIES === null) {
        return true;
    }
    const agency = (opp.department || opp.subtier || '').toLowerCase();
    if (!agency) {
        return false;
    }
    return TARGET_AGENCIES.some(target => 
        agency.includes(target.toLowerCase()) ||
        target.toLowerCase().includes(agency)
    );
}

/**
 * Check if opportunity matches our NAICS criteria
 */
function matchesNAICS(opp) {
    const naics = opp.naicsCode || '';
    return SOKAT_NAICS_CODES.includes(naics);
}

/**
 * Check if opportunity is a biddable type (not Award Notice, Justification, etc.)
 */
function isBiddable(opp) {
    const noticeType = opp.type || '';
    return BIDDABLE_NOTICE_TYPES.includes(noticeType);
}

/**
 * Check if opportunity has response deadline within next 6 months
 */
function hasDeadlineWithin6Months(opp) {
    if (!opp.responseDeadLine) {
        return true; // Include opportunities without deadlines (can check later)
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const sixMonthsFromNow = new Date(today);
    sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);
    
    const deadline = new Date(opp.responseDeadLine);
    deadline.setHours(0, 0, 0, 0);
    
    // Check if deadline is between today and 6 months from now
    return deadline >= today && deadline <= sixMonthsFromNow;
}

/**
 * Normalize opportunity data
 */
function normalizeOpportunity(raw, scrapedAt) {
    // Parse estimated value
    let estimatedValue = null;
    if (raw.award?.amount) {
        estimatedValue = typeof raw.award.amount === 'number' ? 
            raw.award.amount : 
            parseFloat(String(raw.award.amount).replace(/[^0-9.-]/g, ''));
    }

    return {
        id: raw.noticeId || `SAM-${Date.now()}`,
        title: raw.title || 'Untitled',
        agency: raw.department || raw.subtier || 'Unknown',
        subAgency: raw.subtier || raw.office || null,
        naicsCode: raw.naicsCode ? [raw.naicsCode] : [],
        postedDate: raw.postedDate || new Date().toISOString(),
        responseDeadline: raw.responseDeadLine || null,
        setAside: raw.typeOfSetAside || 'Not specified',
        estimatedValue,
        description: (raw.description || '').substring(0, 500), // Limit length
        url: raw.uiLink || `https://sam.gov/opp/${raw.noticeId}`,
        source: 'SAM.gov',
        scrapedAt,
        noticeType: raw.type || 'Unknown',
        contactEmail: raw.pointOfContact?.[0]?.email || null
    };
}

/**
 * Fetch one page of opportunities
 */
async function fetchPage(postedFrom, postedTo, offset = 0) {
    const params = new URLSearchParams({
        api_key: API_KEY,
        postedFrom,
        postedTo,
        limit: PAGE_SIZE,
        offset
    });

    const url = `https://api.sam.gov/opportunities/v2/search?${params}`;
    
    return new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: 20000 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error(`Parse error: ${e.message}`));
                    }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

/**
 * Main scraper function
 */
async function scrapeSamGov(options = {}, fetchPageFn = fetchPage) {
    const days = options.days || 30;
    const limit = options.limit || 1000;
    
    console.log('🔍 Starting SAM.gov API client...');
    console.log(`📅 Date range: last ${days} days`);
    console.log(`🎯 Target agencies: ALL federal agencies`);
    console.log(`📊 Target NAICS codes: ${SOKAT_NAICS_CODES.length} codes`);
    console.log(`⏰ Deadline window: Today to 6 months out\n`);

    if (!API_KEY) {
        throw new Error('SAM_GOV_API_KEY environment variable required');
    }

    const postedFrom = formatDate(days);
    const postedTo = formatDate(0);
    const scrapedAt = new Date().toISOString();
    
    const allOpportunities = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore && allOpportunities.length < limit) {
        const page = Math.floor(offset / PAGE_SIZE) + 1;
        process.stdout.write(`📄 Fetching page ${page}... `);

        try {
            const response = await fetchPageFn(postedFrom, postedTo, offset);
            const opportunities = response.opportunitiesData || [];
            const totalRecords = response.totalRecords || 0;

            console.log(`found ${opportunities.length} (total: ${totalRecords})`);

            if (opportunities.length === 0) {
                hasMore = false;
                break;
            }

            // Filter and normalize
            for (const raw of opportunities) {
                if (allOpportunities.length >= limit) {
                    hasMore = false;
                    break;
                }

                // Apply filters: agency, NAICS, biddable type, and deadline window
                if (matchesAgency(raw) && matchesNAICS(raw) && isBiddable(raw) && hasDeadlineWithin6Months(raw)) {
                    const normalized = normalizeOpportunity(raw, scrapedAt);
                    allOpportunities.push(normalized);
                }
            }

            // Check if we've fetched everything
            if (offset + opportunities.length >= totalRecords) {
                hasMore = false;
            }

            offset += PAGE_SIZE;

            // Rate limiting
            if (hasMore) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }

        } catch (error) {
            console.log(`❌ Error: ${error.message}`);
            hasMore = false;
        }
    }

    console.log(`\n✅ API fetch complete. Found ${allOpportunities.length} matching opportunities\n`);

    // Save to file
    const today = formatDate(0).replace(/\//g, '-');
    const outputPath = path.join(__dirname, `../data/opportunities/${today}.json`);
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(outputPath, JSON.stringify(allOpportunities, null, 2), 'utf8');
    console.log(`💾 Saved to: ${outputPath}\n`);

    // Summary statistics
    const summary = {
        total: allOpportunities.length,
        byAgency: {},
        bySetAside: {},
        withValues: 0,
        totalValue: 0
    };

    allOpportunities.forEach(opp => {
        summary.byAgency[opp.agency] = (summary.byAgency[opp.agency] || 0) + 1;
        summary.bySetAside[opp.setAside] = (summary.bySetAside[opp.setAside] || 0) + 1;
        if (opp.estimatedValue) {
            summary.withValues++;
            summary.totalValue += opp.estimatedValue;
        }
    });

    // Print summary
    console.log('📊 SUMMARY');
    console.log('═'.repeat(60));
    console.log(`Total: ${summary.total} opportunities\n`);
    
    console.log('By Agency:');
    Object.entries(summary.byAgency)
        .sort((a, b) => b[1] - a[1])
        .forEach(([agency, count]) => console.log(`  • ${agency}: ${count}`));
    
    console.log('\nBy Set-Aside:');
    Object.entries(summary.bySetAside)
        .sort((a, b) => b[1] - a[1])
        .forEach(([setAside, count]) => console.log(`  • ${setAside}: ${count}`));
    
    if (summary.withValues > 0) {
        console.log(`\nWith values: ${summary.withValues}`);
        console.log(`Total value: $${summary.totalValue.toLocaleString()}`);
    }
    
    // Show samples
    if (allOpportunities.length > 0) {
        console.log('\n📋 SAMPLE OPPORTUNITIES (first 3):');
        console.log('═'.repeat(60));
        allOpportunities.slice(0, 3).forEach((opp, i) => {
            console.log(`\n${i + 1}. ${opp.title}`);
            console.log(`   Agency: ${opp.agency}`);
            console.log(`   NAICS: ${opp.naicsCode.join(', ')}`);
            console.log(`   Posted: ${opp.postedDate.split('T')[0]}`);
            console.log(`   Deadline: ${opp.responseDeadline ? opp.responseDeadline.split('T')[0] : 'N/A'}`);
            console.log(`   URL: ${opp.url}`);
        });
    }
    console.log('═'.repeat(60));

    return allOpportunities;
}

// ============================================================================
// CLI
// ============================================================================

if (require.main === module) {
    // Parse args
    const args = process.argv.slice(2);
    const options = {};
    args.forEach(arg => {
        const [key, value] = arg.split('=');
        if (key === '--days') options.days = parseInt(value, 10);
        if (key === '--limit') options.limit = parseInt(value, 10);
    });

    scrapeSamGov(options)
        .then(() => process.exit(0))
        .catch(err => {
            console.error('\n💥 Fatal error:', err.message);
            process.exit(1);
        });
}

module.exports = { 
    scrapeSamGov,
    formatDate,
    matchesAgency,
    matchesNAICS,
    normalizeOpportunity,
    TARGET_AGENCIES, // Exporting for testing purposes
    SOKAT_NAICS_CODES // Exporting for testing purposes
};
