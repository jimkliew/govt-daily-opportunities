const assert = require('assert');
const { 
    formatDate, 
    matchesAgency, 
    matchesNAICS, 
    normalizeOpportunity, 
    scrapeSamGov,
    TARGET_AGENCIES,
    SOKAT_NAICS_CODES
} = require('./sam_gov');
const fs = require('fs');
const https = require('https');
const path = require('path');

// Instructions:
// To run these tests, navigate to the scraper directory in your terminal and execute:
// node sam_gov.test.js

// --- Sample Test Data ---
const mockOpportunity = {
  noticeId: 'TEST-001',
  title: 'Test Opportunity',
  department: 'Department of the Treasury',
  naicsCode: '541512',
  postedDate: '2026-02-15',
  responseDeadLine: '2026-03-15T17:00:00-05:00',
  typeOfSetAside: 'NONE',
  uiLink: 'https://sam.gov/opp/TEST-001',
  award: {
      amount: 123456.78
  },
  description: 'This is a test description for a mock opportunity that should be limited in length.',
  pointOfContact: [{ email: 'test@example.com' }]
};

const mockOpportunityNoValue = {
    ...mockOpportunity,
    noticeId: 'TEST-002',
    award: {}
};

const mockOpportunityInvalidNAICS = {
    ...mockOpportunity,
    noticeId: 'TEST-003',
    naicsCode: '111111' // Not in SOKAT_NAICS_CODES
};

const mockOpportunityWrongAgency = {
    ...mockOpportunity,
    noticeId: 'TEST-004',
    department: 'Department of Agriculture' // Not in TARGET_AGENCIES
};

// --- Test Runner ---
async function runTests() {
    console.log('🧪 Running SAM.gov Scraper Tests...\n');
    let passed = 0, failed = 0;
    const testCases = [];

    // Helper to run individual tests
    async function runTest(name, fn) {
        testCases.push({ name, fn });
    }

    // --- Define Tests ---

    // Test formatDate()
    await runTest('formatDate() - should format today\'s date correctly', () => {
        const today = new Date();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const year = today.getFullYear();
        assert.strictEqual(formatDate(0), `${month}/${day}/${year}`, 'Today\'s date should match');
    });

    await runTest('formatDate() - should format date 30 days ago correctly', () => {
        const date30DaysAgo = new Date();
        date30DaysAgo.setDate(date30DaysAgo.getDate() - 30);
        const month = String(date30DaysAgo.getMonth() + 1).padStart(2, '0');
        const day = String(date30DaysAgo.getDate()).padStart(2, '0');
        const year = date30DaysAgo.getFullYear();
        assert.strictEqual(formatDate(30), `${month}/${day}/${year}`, '30 days ago date should match');
    });

    await runTest('formatDate() - should handle zero days correctly', () => {
        assert.strictEqual(formatDate(0), formatDate(), 'Zero days should be default');
    });

    await runTest('formatDate() - should handle negative days (future date)', () => {
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 5);
        const month = String(futureDate.getMonth() + 1).padStart(2, '0');
        const day = String(futureDate.getDate()).padStart(2, '0');
        const year = futureDate.getFullYear();
        assert.strictEqual(formatDate(-5), `${month}/${day}/${year}`, 'Negative days should format future date');
    });

    // Test matchesAgency()
    await runTest('matchesAgency() - should return true for exact agency match (case insensitive)', () => {
        const opp = { department: 'Department of the Treasury' };
        assert.ok(matchesAgency(opp), 'Should match "Department of the Treasury"');
    });

    await runTest('matchesAgency() - should return true for partial agency match (subtier)', () => {
        const opp = { subtier: 'Veterans Affairs' };
        assert.ok(matchesAgency(opp), 'Should match "Veterans Affairs" in subtier');
    });

    await runTest('matchesAgency() - should return true for acronym match', () => {
        const opp = { department: 'CMS' };
        assert.ok(matchesAgency(opp), 'Should match "CMS"');
    });
    
    await runTest('matchesAgency() - should return true when target contains agency (e.g. VA)', () => {
        const opp = { department: 'Department of Veterans Affairs' }; // TARGET_AGENCIES contains 'VA'
        assert.ok(matchesAgency(opp), 'Should match "Department of Veterans Affairs" via "VA" target');
    });

    await runTest('matchesAgency() - should return false for non-matching agency', () => {
        const opp = { department: 'Department of Defense' };
        assert.strictEqual(matchesAgency(opp), false, 'Should not match "Department of Defense"');
    });

    await runTest('matchesAgency() - should handle null/undefined department/subtier', () => {
        assert.strictEqual(matchesAgency({}), false, 'Should not match with empty object');
        assert.strictEqual(matchesAgency({ department: null }), false, 'Should not match with null department');
    });

    // Test matchesNAICS()
    await runTest('matchesNAICS() - should return true for a matching NAICS code', () => {
        const opp = { naicsCode: '541512' };
        assert.ok(matchesNAICS(opp), 'Should match NAICS 541512');
    });

    await runTest('matchesNAICS() - should return false for a non-matching NAICS code', () => {
        const opp = { naicsCode: '999999' };
        assert.strictEqual(matchesNAICS(opp), false, 'Should not match NAICS 999999');
    });

    await runTest('matchesNAICS() - should handle null/undefined naicsCode', () => {
        assert.strictEqual(matchesNAICS({}), false, 'Should not match with empty object');
        assert.strictEqual(matchesNAICS({ naicsCode: null }), false, 'Should not match with null naicsCode');
    });

    await runTest('matchesNAICS() - should handle empty string naicsCode', () => {
        assert.strictEqual(matchesNAICS({ naicsCode: '' }), false, 'Should not match with empty string naicsCode');
    });

    // Test normalizeOpportunity()
    await runTest('normalizeOpportunity() - should correctly normalize a full mock opportunity', () => {
        const scrapedAt = new Date().toISOString();
        const normalized = normalizeOpportunity(mockOpportunity, scrapedAt);

        assert.strictEqual(normalized.id, mockOpportunity.noticeId, 'ID should match');
        assert.strictEqual(normalized.title, mockOpportunity.title, 'Title should match');
        assert.strictEqual(normalized.agency, mockOpportunity.department, 'Agency should match');
        assert.deepStrictEqual(normalized.naicsCode, [mockOpportunity.naicsCode], 'NAICS code should be an array');
        assert.strictEqual(normalized.postedDate, mockOpportunity.postedDate, 'Posted date should match');
        assert.strictEqual(normalized.responseDeadline, mockOpportunity.responseDeadLine, 'Response deadline should match');
        assert.strictEqual(normalized.setAside, mockOpportunity.typeOfSetAside, 'Set aside should match');
        assert.strictEqual(normalized.estimatedValue, mockOpportunity.award.amount, 'Estimated value should match');
        assert.ok(normalized.description.startsWith('This is a test description'), 'Description should be present');
        assert.ok(normalized.description.length <= 500, 'Description should be truncated to 500 chars');
        assert.strictEqual(normalized.url, mockOpportunity.uiLink, 'URL should match');
        assert.strictEqual(normalized.source, 'SAM.gov', 'Source should be SAM.gov');
        assert.strictEqual(normalized.scrapedAt, scrapedAt, 'ScrapedAt should match');
        assert.strictEqual(normalized.contactEmail, mockOpportunity.pointOfContact[0].email, 'Contact email should match');
    });

    await runTest('normalizeOpportunity() - should handle missing optional fields', () => {
        const minimalOpp = {
            noticeId: 'MIN-001',
            title: 'Minimal Opportunity',
            department: 'Department of the Treasury',
            postedDate: '2026-02-10'
        };
        const scrapedAt = new Date().toISOString();
        const normalized = normalizeOpportunity(minimalOpp, scrapedAt);

        assert.strictEqual(normalized.id, minimalOpp.noticeId, 'ID should be present');
        assert.strictEqual(normalized.naicsCode.length, 0, 'NAICS code should be an empty array');
        assert.strictEqual(normalized.responseDeadline, null, 'Missing response deadline should be null');
        assert.strictEqual(normalized.estimatedValue, null, 'Missing award amount should be null');
        assert.strictEqual(normalized.description, '', 'Missing description should be empty string');
        assert.strictEqual(normalized.url, `https://sam.gov/opp/${minimalOpp.noticeId}`, 'URL should be derived from noticeId');
        assert.strictEqual(normalized.setAside, 'Not specified', 'Set aside should default');
        assert.strictEqual(normalized.contactEmail, null, 'Contact email should be null');
    });

    await runTest('normalizeOpportunity() - should handle string estimated value with currency symbols', () => {
        const oppWithValueString = {
            ...mockOpportunity,
            noticeId: 'TEST-VAL-STR',
            award: { amount: '$1,234,567.89' }
        };
        const scrapedAt = new Date().toISOString();
        const normalized = normalizeOpportunity(oppWithValueString, scrapedAt);
        assert.strictEqual(normalized.estimatedValue, 1234567.89, 'Should parse string estimated value');
    });

    await runTest('normalizeOpportunity() - should handle missing award object for estimated value', () => {
        const oppNoAward = {
            ...mockOpportunity,
            noticeId: 'TEST-NO-AWARD',
            award: undefined
        };
        const scrapedAt = new Date().toISOString();
        const normalized = normalizeOpportunity(oppNoAward, scrapedAt);
        assert.strictEqual(normalized.estimatedValue, null, 'Estimated value should be null when award is missing');
    });

    await runTest('normalizeOpportunity() - should handle missing pointOfContact for email', () => {
        const oppNoPOC = {
            ...mockOpportunity,
            noticeId: 'TEST-NO-POC',
            pointOfContact: undefined
        };
        const scrapedAt = new Date().toISOString();
        const normalized = normalizeOpportunity(oppNoPOC, scrapedAt);
        assert.strictEqual(normalized.contactEmail, null, 'Contact email should be null when pointOfContact is missing');
    });

    // Test scrapeSamGov() error handling for missing API key
    await runTest('scrapeSamGov() - should throw error if SAM_GOV_API_KEY is missing', async () => {
        const originalApiKey = process.env.SAM_GOV_API_KEY;
        delete process.env.SAM_GOV_API_KEY; // Temporarily unset API key

        let errorThrown = false;
        try {
            await scrapeSamGov();
        } catch (e) {
            assert.strictEqual(e.message, 'SAM_GOV_API_KEY environment variable required', 'Error message should match');
            errorThrown = true;
        } finally {
            if (originalApiKey) {
                process.env.SAM_GOV_API_KEY = originalApiKey; // Restore API key
            }
        }
        assert.ok(errorThrown, 'Should throw an error when API key is missing');
    });

    // Test scrapeSamGov() with mocking for file output and API calls
    await runTest('scrapeSamGov() - should filter, normalize, and save opportunities to a file', async () => {
        const originalApiKey = process.env.SAM_GOV_API_KEY;
        process.env.SAM_GOV_API_KEY = 'TEST_API_KEY'; // Set a dummy API key

        // Mock fetchPage function
        const mockFetchPage = async (postedFrom, postedTo, offset) => {
            return {
                totalRecords: 1,
                opportunitiesData: [mockOpportunity]
            };
        };

        // Mock fs functions
        const originalFsWriteFileSync = fs.writeFileSync;
        const originalFsExistsSync = fs.existsSync;
        const originalFsMkdirSync = fs.mkdirSync;

        let writeFileSyncCalled = false;
        let writtenContent = '';
        let writtenPath = '';

        fs.writeFileSync = (filePath, content, encoding) => {
            writeFileSyncCalled = true;
            writtenPath = filePath;
            writtenContent = content;
        };
        fs.existsSync = (dirPath) => true; // Assume directory always exists for simplicity
        fs.mkdirSync = (dirPath, options) => {}; // No-op

        try {
            const opportunities = await scrapeSamGov({ limit: 1 }, mockFetchPage);

            // Assertions for the scraper's output
            assert.strictEqual(opportunities.length, 1, 'Scraper should return 1 opportunity');
            assert.strictEqual(opportunities[0].id, mockOpportunity.noticeId, 'Scraped opportunity ID should match mock');
            assert.ok(writeFileSyncCalled, 'fs.writeFileSync should have been called');
            
            const today = formatDate(0).replace(/\//g, '-');
            const expectedPath = path.join(__dirname, `../data/opportunities/${today}.json`);
            assert.strictEqual(writtenPath, expectedPath, 'Output file path should be correct');

            const parsedContent = JSON.parse(writtenContent);
            assert.ok(Array.isArray(parsedContent), 'Written content should be a JSON array');
            assert.strictEqual(parsedContent.length, 1, 'Written content array should have 1 item');
            assert.strictEqual(parsedContent[0].id, mockOpportunity.noticeId, 'Written opportunity ID should match mock');

        } finally {
            // Restore original functions
            fs.writeFileSync = originalFsWriteFileSync;
            fs.existsSync = originalFsExistsSync;
            fs.mkdirSync = originalFsMkdirSync;
            if (originalApiKey) {
                process.env.SAM_GOV_API_KEY = originalApiKey;
            } else {
                delete process.env.SAM_GOV_API_KEY;
            }
        }
    });

    await runTest('scrapeSamGov() - should correctly filter opportunities by NAICS and Agency', async () => {
        const originalApiKey = process.env.SAM_GOV_API_KEY;
        process.env.SAM_GOV_API_KEY = 'TEST_API_KEY';

        // Mock fetchPage to return a mix of matching and non-matching opportunities
        const mockFetchPage = async (postedFrom, postedTo, offset) => {
            return {
                totalRecords: 4,
                opportunitiesData: [
                    mockOpportunity,             // Matches both
                    mockOpportunityNoValue,      // Matches both, just different value field
                    mockOpportunityInvalidNAICS, // Fails NAICS filter
                    mockOpportunityWrongAgency   // Fails Agency filter
                ]
            };
        };

        const originalFsWriteFileSync = fs.writeFileSync;
        const originalFsExistsSync = fs.existsSync;
        const originalFsMkdirSync = fs.mkdirSync;

        let writeFileSyncCalled = false;
        let writtenContent = '';

        fs.writeFileSync = (filePath, content, encoding) => {
            writeFileSyncCalled = true;
            writtenContent = content;
        };
        fs.existsSync = (dirPath) => true;
        fs.mkdirSync = (dirPath, options) => {};

        try {
            const opportunities = await scrapeSamGov({ limit: 4 }, mockFetchPage);

            assert.strictEqual(opportunities.length, 2, 'Scraper should return 2 matching opportunities after filtering');
            assert.ok(opportunities.some(o => o.id === mockOpportunity.noticeId), 'Original mock opportunity should be present');
            assert.ok(opportunities.some(o => o.id === mockOpportunityNoValue.noticeId), 'Opportunity with no value should be present');
            assert.ok(!opportunities.some(o => o.id === mockOpportunityInvalidNAICS.noticeId), 'Opportunity with invalid NAICS should be filtered out');
            assert.ok(!opportunities.some(o => o.id === mockOpportunityWrongAgency.noticeId), 'Opportunity with wrong agency should be filtered out');

            const parsedContent = JSON.parse(writtenContent);
            assert.strictEqual(parsedContent.length, 2, 'Written content should have 2 filtered opportunities');

        } finally {
            fs.writeFileSync = originalFsWriteFileSync;
            fs.existsSync = originalFsExistsSync;
            fs.mkdirSync = originalFsMkdirSync;
            if (originalApiKey) {
                process.env.SAM_GOV_API_KEY = originalApiKey;
            } else {
                delete process.env.SAM_GOV_API_KEY;
            }
        }
    });

    await runTest('scrapeSamGov() - should handle API errors gracefully', async () => {
        const originalApiKey = process.env.SAM_GOV_API_KEY;
        process.env.SAM_GOV_API_KEY = 'TEST_API_KEY';

        // Mock fetchPage to simulate an API error
        const mockFetchPage = async (postedFrom, postedTo, offset) => {
            throw new Error('HTTP 400: {"error": "Bad Request"}'); // Simulate API error
        };

        const originalFsWriteFileSync = fs.writeFileSync;
        const originalFsExistsSync = fs.existsSync;
        const originalFsMkdirSync = fs.mkdirSync;
        
        fs.writeFileSync = (filePath, content, encoding) => {}; // No-op
        fs.existsSync = (dirPath) => true;
        fs.mkdirSync = (dirPath, options) => {};

        try {
            const opportunities = await scrapeSamGov({ limit: 1 }, mockFetchPage);
            assert.strictEqual(opportunities.length, 0, 'Scraper should return 0 opportunities on API error');
        } finally {
            fs.writeFileSync = originalFsWriteFileSync;
            fs.existsSync = originalFsExistsSync;
            fs.mkdirSync = originalFsMkdirSync;
            if (originalApiKey) {
                process.env.SAM_GOV_API_KEY = originalApiKey;
            } else {
                delete process.env.SAM_GOV_API_KEY;
            }
        }
    });

    // --- Run all tests and summarize ---
    for (const testCase of testCases) {
        try {
            await testCase.fn();
            console.log(`✅ ${testCase.name}`);
            passed++;
        } catch (error) {
            console.error(`❌ ${testCase.name}`);
            console.error(error.stack);
            failed++;
        }
    }

    console.log('\n--- Test Summary ---');
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log('--------------------\n');

    if (failed > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

// Run the tests
runTests();

// Assumptions & Limitations:
// - Mocking for https.get and fs functions is done manually within tests,
//   which requires careful restoration of original functions.
// - The test for file output assumes the `../data/opportunities/` directory structure.
// - `scrapeSamGov`'s internal console.log messages will appear during its test execution.
// - The `fetchPage` function's timeout is not explicitly tested, but the mock for https.get
//   includes a `mockReq.destroy` to prevent errors.
// - This test suite does not cover network connectivity issues beyond simulating an API error status.
// - The `path.join(__dirname, ...)` logic for determining the output path relies on
//   the test file being in the same directory as sam_gov.js.
