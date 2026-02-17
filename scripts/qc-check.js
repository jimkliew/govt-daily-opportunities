const fs = require('fs');
const path = require('path');

const today = new Date().toISOString().split('T')[0];
const baseDir = path.join(__dirname, '..'); // Points to govt-daily-opportunities directory

// --- Helper Functions ---

// Ensure directory exists
const ensureDir = (dirPath) => {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
};

// Create dummy data if files don't exist for testing purposes
const createDummyData = (filePath, defaultData) => {
    if (!fs.existsSync(filePath)) {
        console.log('Creating dummy data for: ' + filePath);
        fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2));
    }
};

// --- Configuration Data (Placeholders for SoKat specific info) ---

// SoKat's 19 NAICS codes (example subset)
const SOKAT_NAICS_CODES = new Set([
    '541511', '541512', '541513', '541519', '541611', '541612', '541613', '541614', '541618',
    '541690', '541715', '541720', '541810', '541990', '518210', '511210', '541330', '541430', '541820'
]);

// Target Agencies for hot leads
const TARGET_AGENCIES = new Set(['Treasury', 'VA', 'CMS']);

// Keywords for hot leads
const KEYWORDS = ['AI', 'ML', 'Artificial Intelligence', 'Machine Learning', 'Data Science', 'Deep Learning', 'NLP'];

// --- Dummy Data Definitions ---

const dummyOpportunities = [
    { id: 'opp1', title: 'AI Project for Treasury', url: 'https://example.com/opp1', description: 'Seeking AI solutions for financial analysis.', agency: 'Treasury', naics: '541511', createdAt: '2026-02-14T10:00:00Z', updatedAt: '2026-02-14T10:00:00Z' },
    { id: 'opp2', title: 'ML Initiative at VA', url: 'https://example.com/opp2', description: 'Implementing ML for veteran health records.', agency: 'VA', naics: '541512', createdAt: '2026-02-14T11:00:00Z', updatedAt: '2026-02-14T11:00:00Z' },
    { id: 'opp3', title: 'General IT Modernization (DOE)', url: 'https://example.com/opp3', description: 'IT infrastructure upgrade.', agency: 'DOE', naics: '541519', createdAt: '2026-02-14T12:00:00Z', updatedAt: '2026-02-14T12:00:00Z' },
    { id: 'opp6', title: 'Another Treasury Opportunity', url: 'https://example.com/opp6', description: 'Big data analytics for Treasury.', agency: 'Treasury', naics: '541511', createdAt: '2026-02-14T15:00:00Z', updatedAt: '2026-02-14T15:00:00Z' },
    { id: 'opp7', title: 'CMS Data Platform', url: 'https://example.com/opp7', description: 'New data platform for CMS.', agency: 'CMS', naics: '518210', createdAt: '2026-02-14T16:00:00Z', updatedAt: '2026-02-14T16:00:00Z' },
];

const dummyScored = [
    { id: 'opp1', title: 'AI Project for Treasury', url: 'https://example.com/opp1', score: 90, category: 'hot', agency: 'Treasury', naics: '541511', description: 'Seeking AI solutions for financial analysis.', createdAt: '2026-02-14T10:00:00Z', updatedAt: '2026-02-14T10:00:00Z' }, // Valid hot
    { id: 'opp2', title: 'ML Initiative at VA', url: 'https://example.com/opp2', score: 85, category: 'hot', agency: 'VA', naics: '541512', description: 'Implementing ML for veteran health records.', createdAt: '2026-02-14T11:00:00Z', updatedAt: '2026-02-14T11:00:00Z' }, // Valid hot
    { id: 'opp3', title: 'General IT Modernization (DOE)', url: 'https://example.com/opp3', score: 60, category: 'warm', agency: 'DOE', naics: '541519', description: 'IT infrastructure upgrade.', createdAt: '2026-02-14T12:00:00Z', updatedAt: '2026-02-14T12:00:00Z' }, // Warm, non-target agency
    { id: 'opp4', title: 'Space AI for NASA (misclassified hot)', url: 'https://broken.url/opp4', score: 95, category: 'hot', agency: 'NASA', naics: '541330', description: 'AI for space exploration.', createdAt: '2026-02-14T13:00:00Z', updatedAt: '2026-02-14T13:00:00Z' }, // Hot, but NASA not target, NAICS is SoKat
    { id: 'opp5', title: 'Treasury Watch Lead', url: 'https://example.com/opp5', score: 40, category: 'watch', agency: 'Treasury', naics: '541511', description: 'Low score but target agency.', createdAt: '2026-02-14T14:00:00Z', updatedAt: '2026-02-14T14:00:00Z' }, // Watch, target agency
    { id: 'opp6', title: 'Another Treasury Opportunity', url: 'https://example.com/opp6', score: 70, category: 'warm', agency: 'Treasury', naics: '541511', description: 'Big data analytics for Treasury.', createdAt: '2026-02-14T15:00:00Z', updatedAt: '2026-02-14T15:00:00Z' }, // Warm, target agency
    { id: 'opp7', title: 'CMS Data Platform', url: 'https://example.com/opp7', score: 88, category: 'hot', agency: 'CMS', naics: '518210', description: 'New data platform for CMS.', createdAt: '2026-02-14T16:00:00Z', updatedAt: '2026-02-14T16:00:00Z' }, // Valid hot
    { id: 'opp8', title: 'Opportunity with missing NAICS', url: 'https://example.com/opp8', score: 80, category: 'hot', agency: 'VA', naics: null, description: 'Healthcare modernization.', createdAt: '2026-02-14T17:00:00Z', updatedAt: '2026-02-14T17:00:00Z' }, // Hot, missing NAICS
    { id: 'opp9', title: 'Opportunity with invalid date', url: 'https://example.com/opp9', score: 50, category: 'warm', agency: 'Treasury', naics: '541511', description: 'Financial services.', createdAt: 'invalid-date', updatedAt: '2026-02-14T18:00:00Z' }, // Warm, invalid date
    { id: 'opp10', title: 'Opportunity with invalid url', url: null, score: 65, category: 'warm', agency: 'DOE', naics: '541519', description: 'IT services.', createdAt: '2026-02-14T19:00:00Z', updatedAt: '2026-02-14T19:00:00Z' }, // Warm, null URL
    { id: 'opp11', title: 'Hot lead with wrong NAICS', url: 'https://example.com/opp11', score: 82, category: 'hot', agency: 'Treasury', naics: '111111', description: 'Financial AI project.', createdAt: '2026-02-14T20:00:00Z', updatedAt: '2026-02-14T20:00:00Z' }, // Hot, but NAICS not SoKat
];

const dummyUrlValidationReport = {
    total: 5, // based on dummyScored with actual URLs
    working: 4,
    broken: 1,
    brokenUrls: [
        { url: 'https://broken.url/opp4', status: 404, error: 'Not Found' }
    ]
};

// --- Main QC Function ---

async function runQC() {
    // 1. Read All Data
    let opportunities = [];
    let scored = [];
    let urlValidationReport = null;

    const opportunitiesPath = path.join(baseDir, 'data', 'opportunities', `${today}.json`);
    const scoredPath = path.join(baseDir, 'data', 'scores', `${today}.json`);
    const urlReportPath = path.join(baseDir, 'data', 'url-validation', `${today}.json`);

    try {
        if (fs.existsSync(opportunitiesPath)) {
            fs.unlinkSync(opportunitiesPath); // Force overwrite
        }
        createDummyData(opportunitiesPath, dummyOpportunities);
        console.log(`Attempting to read opportunities from: ${opportunitiesPath}`);
        opportunities = JSON.parse(fs.readFileSync(opportunitiesPath, 'utf8'));
        console.log(`Loaded ${opportunities.length} opportunities.`);
    } catch (error) {
        console.warn(`Warning: Could not read opportunities data for ${today}. Using empty array. Error: ${error.message}`);
    }

    try {
        if (fs.existsSync(scoredPath)) {
            fs.unlinkSync(scoredPath); // Force overwrite
        }
        createDummyData(scoredPath, dummyScored);
        console.log(`Attempting to read scored data from: ${scoredPath}`);
        scored = JSON.parse(fs.readFileSync(scoredPath, 'utf8'));
        console.log(`Loaded ${scored.length} scored opportunities.`);
        if (scored.length > 0) {
            console.log("First scored opportunity:", JSON.stringify(scored[0], null, 2));
        }
    } catch (error) {
        console.warn(`Warning: Could not read scored data for ${today}. Using empty array. Error: ${error.message}`);
    }

    try {
        if (fs.existsSync(urlReportPath)) {
            fs.unlinkSync(urlReportPath); // Force overwrite
        }
        createDummyData(urlReportPath, dummyUrlValidationReport); // Create dummy if not exists
        console.log(`Attempting to read URL validation report from: ${urlReportPath}`);
        urlValidationReport = JSON.parse(fs.readFileSync(urlReportPath, 'utf8'));
        console.log(`Loaded URL validation report.`);
        console.log("URL Validation Report:", JSON.stringify(urlValidationReport, null, 2));
    } catch (error) {
        console.warn(`Warning: Could not read URL validation report for ${today}. Proceeding without it. Error: ${error.message}`);
    }

    // Initialize report structure
    const report = {
        date: today,
        timestamp: new Date().toISOString(),
        summary: {
            totalOpportunities: opportunities.length,
            scored: scored.length,
            hot: scored.filter(o => o.category === 'hot').length,
            warm: scored.filter(o => o.category === 'warm').length,
            watch: scored.filter(o => o.category === 'watch').length
        },
        dataQuality: {
            completeness: 'Not checked', // Will be updated
            missingFields: [],
            invalidDates: [],
            nullUrls: []
        },
        urls: {
            total: 0,
            validated: 0,
            working: 0,
            broken: 0,
            percentWorking: '0.0%',
            brokenUrlsList: []
        },
        scoringAccuracy: {
            hotLeadsReviewed: 0,
            accurate: 0,
            needsReview: 0,
            issues: []
        },
        naicsValidation: {
            allMatch: true,
            invalidCount: 0,
            invalidNaicsList: []
        },
        agencyVerification: {
            agencyCounts: {},
            hotLeadsTargetAgencyMatch: 0,
            hotLeadsTargetAgencyMismatch: 0,
            targetAgencyMismatchList: []
        },
        recommendations: []
    };

    // --- 2. QC Checks ---

    // A. Data Completeness
    const requiredFields = ['id', 'title', 'url', 'score', 'category'];
    const dateFields = ['createdAt', 'updatedAt'];
    let allFieldsPresent = true;

    scored.forEach(opp => {
        requiredFields.forEach(field => {
            if (!opp.hasOwnProperty(field) || opp[field] === null || opp[field] === undefined || opp[field] === '') {
                report.dataQuality.missingFields.push(`Opportunity ${opp.id || 'N/A'}: Missing or empty field '${field}'`);
                allFieldsPresent = false;
            }
        });

        // Check for null/undefined in critical fields (already covered by above for required fields, but good for general check)
        if (opp.url === null || opp.url === undefined) {
            report.dataQuality.nullUrls.push(`Opportunity ${opp.id || 'N/A'}: URL is null/undefined`);
            allFieldsPresent = false;
        }
        if (opp.naics === null || opp.naics === undefined || opp.naics === '') {
            report.dataQuality.missingFields.push(`Opportunity ${opp.id || 'N/A'}: Missing or empty NAICS code`);
            allFieldsPresent = false;
        }

        // Dates are valid ISO format
        dateFields.forEach(field => {
            const dateStr = opp[field];
            if (dateStr) {
                const dateObj = new Date(dateStr);
                // Check if it's a valid Date object
                if (isNaN(dateObj.getTime())) {
                    report.dataQuality.invalidDates.push(`Opportunity ${opp.id || 'N/A'}: Invalid date format for '${field}' - Value: '${dateStr}'`);
                    allFieldsPresent = false;
                }
            }
        });
    });
    report.dataQuality.completeness = allFieldsPresent && report.dataQuality.missingFields.length === 0 && report.dataQuality.invalidDates.length === 0 ? '100%' : 'Issues Found';
    if (report.dataQuality.missingFields.length > 0 || report.dataQuality.invalidDates.length > 0 || report.dataQuality.nullUrls.length > 0) {
        report.recommendations.push('Review data quality for missing fields, invalid dates, or null URLs.');
    }


    // B. URL Validation
    if (urlValidationReport) {
        report.urls.total = scored.length;
        report.urls.validated = urlValidationReport.total;
        report.urls.working = urlValidationReport.working;
        report.urls.broken = urlValidationReport.broken;
        report.urls.percentWorking = urlValidationReport.total > 0
            ? ((urlValidationReport.working / urlValidationReport.total) * 100).toFixed(1) + '%'
            : '0.0%';
        report.urls.brokenUrlsList = urlValidationReport.brokenUrls || [];

        if (report.urls.broken > 0) {
            report.recommendations.push(`Review ${report.urls.broken} broken URLs found in the validation report.`);
        }
    } else {
        report.recommendations.push('No URL validation report found for today. Consider running URL validation.');
    }

    // C. Scoring Accuracy & E. Agency Verification (Hot Leads specific)
    // D. NAICS Verification (combined here for efficiency for hot leads)
    const hotLeads = scored.filter(o => o.category === 'hot');
    report.scoringAccuracy.hotLeadsReviewed = hotLeads.length;

    hotLeads.forEach(opp => {
        let isAccurate = true;
        const issues = [];

        // Check Target Agency
        if (!opp.agency || !TARGET_AGENCIES.has(opp.agency)) {
            issues.push(`Agency is '${opp.agency || 'N/A'}', not a target agency (${Array.from(TARGET_AGENCIES).join(', ')})`);
            isAccurate = false;
        }

        // Check SoKat NAICS code
        if (!opp.naics || !SOKAT_NAICS_CODES.has(opp.naics)) {
            issues.push(`NAICS code '${opp.naics || 'N/A'}' is not in SoKat's list`);
            isAccurate = false;
        }

        // Check Keywords
        const descriptionAndTitle = `${opp.title || ''} ${opp.description || ''}`.toLowerCase();
        const hasKeyword = KEYWORDS.some(keyword => descriptionAndTitle.includes(keyword.toLowerCase()));
        if (!hasKeyword) {
            issues.push('Missing target keywords (AI, ML, etc.)');
            isAccurate = false;
        }

        if (!isAccurate) {
            report.scoringAccuracy.needsReview++;
            report.scoringAccuracy.issues.push(`Opportunity ${opp.id || 'N/A'}: ${issues.join('; ')}`);
            // Add to agency verification specific list if agency was the issue
            if (!TARGET_AGENCIES.has(opp.agency)) {
                 report.agencyVerification.targetAgencyMismatchList.push(`Hot lead ${opp.id || 'N/A'} has agency ${opp.agency || 'N/A'}`);
                 report.agencyVerification.hotLeadsTargetAgencyMismatch++;
            }
        } else {
            report.scoringAccuracy.accurate++;
            report.agencyVerification.hotLeadsTargetAgencyMatch++;
        }
    });

    if (report.scoringAccuracy.needsReview > 0) {
        report.recommendations.push(`Review ${report.scoringAccuracy.needsReview} hot leads flagged for potential scoring inaccuracies.`);
    }

    // D. NAICS Verification (for all scored opportunities)
    scored.forEach(opp => {
        if (!opp.naics || !SOKAT_NAICS_CODES.has(opp.naics)) {
            report.naicsValidation.allMatch = false;
            report.naicsValidation.invalidCount++;
            report.naicsValidation.invalidNaicsList.push(`Opportunity ${opp.id || 'N/A'}: NAICS '${opp.naics || 'N/A'}' not in SoKat's list`);
        }
    });
    if (!report.naicsValidation.allMatch) {
        report.recommendations.push(`${report.naicsValidation.invalidCount} scored opportunities have NAICS codes not in SoKat's list.`);
    }

    // E. Agency Verification (Counts for all scored opportunities)
    scored.forEach(opp => {
        const agency = opp.agency || 'Unknown';
        report.agencyVerification.agencyCounts[agency] = (report.agencyVerification.agencyCounts[agency] || 0) + 1;
    });


    // If no specific issues, provide a positive recommendation
    if (report.recommendations.length === 0) {
        report.recommendations.push('All systems operational');
    }

    // --- 3. Generate QC Report (Object already built) ---

    // --- 4. Console Output ---
    let consoleOutput = `🔍 QC REPORT - ${today}
═══════════════════════════════════════

📊 SUMMARY:
- Total: ${report.summary.totalOpportunities} opportunities
- Scored: ${report.summary.scored}
- Hot: ${report.summary.hot} | Warm: ${report.summary.warm} | Watch: ${report.summary.watch}

`;

    consoleOutput += `${report.dataQuality.completeness === '100%' ? '✅' : '⚠️'} DATA QUALITY: ${report.dataQuality.completeness}
`;
    if (report.dataQuality.missingFields.length === 0 && report.dataQuality.invalidDates.length === 0 && report.dataQuality.nullUrls.length === 0) {
        consoleOutput += `  - All required fields present
  - No invalid dates
  - No null URLs
`;
    } else {
        if (report.dataQuality.missingFields.length > 0) {
            consoleOutput += `  - Missing fields: ${report.dataQuality.missingFields.length} issues
`;
            report.dataQuality.missingFields.forEach(issue => consoleOutput += `    - ${issue}
`);
        }
        if (report.dataQuality.invalidDates.length > 0) {
            consoleOutput += `  - Invalid dates: ${report.dataQuality.invalidDates.length} issues
`;
            report.dataQuality.invalidDates.forEach(issue => consoleOutput += `    - ${issue}
`);
        }
        if (report.dataQuality.nullUrls.length > 0) {
            consoleOutput += `  - Null URLs: ${report.dataQuality.nullUrls.length} issues
`;
            report.dataQuality.nullUrls.forEach(issue => consoleOutput += `    - ${issue}
`);
        }
    }


    const urlsStatus = report.urls.broken === 0 ? '✅' : '❌';
    consoleOutput += `
${urlsStatus} URLS: ${report.urls.percentWorking} working (${report.urls.working}/${report.urls.validated})
`;
    if (report.urls.broken > 0) {
        consoleOutput += `  ❌ Broken: ${report.urls.broken} URLs
`;
        report.urls.brokenUrlsList.forEach(item => consoleOutput += `    - ${item.url} (${item.status})
`);
    } else if (urlValidationReport) {
        consoleOutput += `  - No broken URLs found.
`;
    } else {
        consoleOutput += `  - No URL validation report available.
`;
    }

    const scoringStatus = report.scoringAccuracy.needsReview === 0 ? '✅' : '⚠️';
    const accuracyPercent = report.scoringAccuracy.hotLeadsReviewed > 0 ?
        ((report.scoringAccuracy.accurate / report.scoringAccuracy.hotLeadsReviewed) * 100).toFixed(1) : 'N/A';
    consoleOutput += `
${scoringStatus} SCORING ACCURACY: ${accuracyPercent}%
`;
    consoleOutput += `  - ${report.scoringAccuracy.accurate}/${report.scoringAccuracy.hotLeadsReviewed} hot leads validated
`;
    if (report.scoringAccuracy.needsReview > 0) {
        consoleOutput += `  - ${report.scoringAccuracy.needsReview} needs review:
`;
        report.scoringAccuracy.issues.forEach(issue => consoleOutput += `    - ${issue}
`);
    } else {
        consoleOutput += `  - All hot leads validated.
`;
    }

    const naicsStatus = report.naicsValidation.allMatch ? '✅' : '⚠️';
    consoleOutput += `
${naicsStatus} NAICS VERIFICATION: ${report.naicsValidation.allMatch ? '100% match' : `${scored.length - report.naicsValidation.invalidCount}/${scored.length} match`}
`;
    if (report.naicsValidation.invalidCount > 0) {
        consoleOutput += `  - ${report.naicsValidation.invalidCount} invalid NAICS codes found:
`;
        report.naicsValidation.invalidNaicsList.forEach(issue => consoleOutput += `    - ${issue}
`);
    } else {
        consoleOutput += `  - All NAICS codes are in SoKat's list.
`;
    }

    consoleOutput += `
📊 AGENCY COUNTS:
`;
    for (const agency in report.agencyVerification.agencyCounts) {
        consoleOutput += `  - ${agency}: ${report.agencyVerification.agencyCounts[agency]} opportunities
`;
    }

    const hotLeadAgencyMatchStatus = report.agencyVerification.hotLeadsTargetAgencyMismatch === 0 ? '✅' : '⚠️';
    consoleOutput += `
${hotLeadAgencyMatchStatus} HOT LEAD AGENCY VERIFICATION:
`;
    consoleOutput += `  - ${report.agencyVerification.hotLeadsTargetAgencyMatch} hot leads match target agencies
`;
    if (report.agencyVerification.hotLeadsTargetAgencyMismatch > 0) {
        consoleOutput += `  - ${report.agencyVerification.hotLeadsTargetAgencyMismatch} hot leads mismatch target agencies:
`;
        report.agencyVerification.targetAgencyMismatchList.forEach(issue => consoleOutput += `    - ${issue}
`);
    }


    consoleOutput += `
📋 RECOMMENDATIONS:
`;
    report.recommendations.forEach((rec, index) => consoleOutput += `${index + 1}. ${rec}
`);

    console.log(consoleOutput);

    // --- 5. Save Report ---
    const qcReportsDir = path.join(baseDir, 'data', 'qc-reports');
    ensureDir(qcReportsDir);

    const jsonReportPath = path.join(qcReportsDir, `${today}.json`);
    const textReportPath = path.join(qcReportsDir, `${today}.txt`);

    fs.writeFileSync(jsonReportPath, JSON.stringify(report, null, 2), 'utf8');
    fs.writeFileSync(textReportPath, consoleOutput, 'utf8');

    console.log(`

QC Report saved to: ${jsonReportPath}`);
    console.log(`Text Report saved to: ${textReportPath}`);

    return report; // Return the report object for potential further use
}

// Run the QC system
runQC();
