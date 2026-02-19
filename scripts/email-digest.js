#!/usr/bin/env node

/**
 * @fileoverview Generates and sends a daily email digest of federal contract opportunities.
 * @version 1.0.0
 * @module email-digest
 * @author Your Name
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const execAsync = promisify(exec);

// --- Configuration ---
const DEFAULT_RECIPIENTS = process.env.EMAIL_RECIPIENTS 
    ? process.env.EMAIL_RECIPIENTS.split(',').map(e => e.trim())
    : ["jim@sokat.com", "susan@sokat.com"];
const DEFAULT_ACCOUNT = process.env.EMAIL_ACCOUNT || "jimkliew@gmail.com";
const DATA_DIR = path.join(__dirname, '../data/scores'); // Path to the scores directory
const DRIVE_LINK = process.env.DRIVE_LINK || "https://drive.google.com/drive/folders/1v2vujLPX7PBkkc99pOzEpyHBaSY6empu";


// --- Helper Functions ---

/**
 * Formats a date object into a readable string (e.g., "Mar 15, 2026").
 * @param {Date} date - The date object to format.
 * @returns {string} The formatted date string.
 */
function formatDate(date) {
    if (!date) return 'N/A';
    const options = { year: 'numeric', month: 'short', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
}

/**
 * Parses a YYYY-MM-DD string into a Date object, representing the start of that day in local time.
 * If no dateString is provided, returns the start of the current local day.
 * @param {string} [dateString] - The date string in YYYY-MM-DD format.
 * @returns {Date} A Date object.
 */
function parseDateString(dateString) {
    if (!dateString) {
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Normalize to start of local day
        return today;
    }
    const [year, month, day] = dateString.split('-').map(Number);
    // Month is 0-indexed in JS Date constructor
    const date = new Date(year, month - 1, day);
    // Ensure the date is correctly set to the start of the day in local timezone
    date.setHours(0, 0, 0, 0);
    return date;
}

/**
 * Formats a number as currency (e.g., "$1,234,567" or "$5.23").
 * @param {number} value - The number to format.
 * @param {number} [fractionDigits=0] - Number of decimal places.
 * @returns {string} The formatted currency string.
 */
function formatCurrency(value, fractionDigits = 0) {
    if (value === null || value === undefined || isNaN(value)) return '$N/A';
    return `$${Number(value).toLocaleString('en-US', {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits
    })}`;
}

/**
 * Sends an email using the 'gog' command-line tool.
 * @param {string} subject - The subject of the email.
 * @param {string} body - The plain text body of the email.
 * @param {string|Array<string>} recipients - The email address(es) of the recipient(s).
 * @returns {Promise<string>} The stdout from the gog command.
 * @throws {Error} If the gog command fails.
 */
async function sendEmail(subject, body, recipients) {
    // Write body to temp file to avoid stdin piping issues
    const tempPath = `/tmp/email-digest-${Date.now()}.txt`;
    fs.writeFileSync(tempPath, body, 'utf8');
    
    // Handle both string and array of recipients
    const recipientList = Array.isArray(recipients) ? recipients : [recipients];
    const toList = recipientList.join(',');
    const toFlags = `--to "${toList}"`;
    
    const cmd = `gog gmail send ${toFlags} --subject "${subject}" --body-file "${tempPath}" --account "${DEFAULT_ACCOUNT}"`;
    try {
        const { stdout, stderr } = await execAsync(cmd, {
            shell: true,
            maxBuffer: 1024 * 500 // Increase buffer to 500KB for potentially long emails
        });
        if (stderr) {
            console.warn("sendEmail stderr:", stderr);
        }
        
        // Clean up temp file
        fs.unlinkSync(tempPath);
        
        return stdout;
    } catch (error) {
        console.error("Failed to send email:", error.message);
        // Clean up temp file on error too
        try { fs.unlinkSync(tempPath); } catch (e) {}
        throw error;
    }
}

/**
 * Saves email digest to Google Drive with dated filename
 * @param {string} subject - The subject of the email.
 * @param {string} body - The plain text body of the email.
 * @param {string} dateString - Date string (YYYY-MM-DD) for filename.
 * @returns {Promise<string>} The result of the upload.
 */
async function saveToGoogleDrive(subject, body, dateString) {
    const DRIVE_FOLDER_ID = '...'; // DailyFedBizOps folder
    
    // Format: SoKat-Sales-Intelligence-2026-02-15.txt
    const filename = `SoKat-Sales-Intelligence-${dateString}.txt`;
    const tempPath = `/tmp/${filename}`;
    
    // Create full email content
    const fullContent = `${subject}\n${'='.repeat(60)}\n\n${body}`;
    
    // Write to temp file
    fs.writeFileSync(tempPath, fullContent, 'utf8');
    console.log(`📝 Saved email to temp file: ${tempPath}`);
    
    // Upload to Google Drive
    const uploadCmd = `gog drive upload "${tempPath}" --parent "${DRIVE_FOLDER_ID}" --account "${DEFAULT_ACCOUNT}"`;
    try {
        const { stdout, stderr } = await execAsync(uploadCmd, {
            shell: true,
            maxBuffer: 1024 * 500
        });
        if (stderr) {
            console.warn("Google Drive upload stderr:", stderr);
        }
        console.log(`☁️ Uploaded to Google Drive: ${filename}`);
        
        // Clean up temp file
        fs.unlinkSync(tempPath);
        
        return stdout;
    } catch (error) {
        console.error("Failed to upload to Google Drive:", error.message);
        // Don't throw - email still sent successfully
        return null;
    }
}

/**
 * Parses command-line arguments.
 * @returns {object} An object containing parsed arguments (date, dryRun, to).
 */
function parseArgs() {
    const args = {};
    process.argv.slice(2).forEach(arg => {
        if (arg.startsWith('--date=')) {
            args.date = arg.split('=')[1];
        } else if (arg === '--dry-run') {
            args.dryRun = true;
        } else if (arg.startsWith('--to=')) {
            args.to = arg.split('=')[1];
        }
    });
    return args;
}

/**
 * Reads and parses the scored opportunities from a JSON file.
 * @param {string} dateString - The date string (YYYY-MM-DD) for which to load data.
 * @returns {Promise<Array<object>|null>} An array of opportunity objects, or null if the file doesn't exist or is invalid.
 */
async function loadOpportunities(dateString) {
    // Try both formats: MM-DD-YYYY first (scraper output), then YYYY-MM-DD
    const formats = [
        dateString.split('-').slice(1).concat(dateString.split('-')[0]).join('-'), // MM-DD-YYYY
        dateString // YYYY-MM-DD
    ];
    
    let filePath = null;
    let filePathAttempts = [];
    
    for (const format of formats) {
        const testPath = path.join(DATA_DIR, `${format}.json`);
        filePathAttempts.push(testPath);
        if (fs.existsSync(testPath)) {
            filePath = testPath;
            break;
        }
    }
    
    console.log(`Attempting to load opportunities from: ${filePath || filePathAttempts.join(' or ')}`);
    
    try {
        if (!filePath) {
            console.warn(`Opportunities file not found for ${dateString}. Tried: ${filePathAttempts.join(', ')}`);
            return null;
        }
        const data = await fs.promises.readFile(filePath, 'utf8');
        const opportunities = JSON.parse(data);

        // Basic validation for expected fields
        if (!Array.isArray(opportunities)) {
            console.error(`Error: Opportunities data in ${filePath} is not an array.`);
            return null;
        }
        return opportunities;
    } catch (error) {
        console.error(`Error loading or parsing opportunities from ${filePath}:`, error.message);
        return null;
    }
}

/**
 * Classifies opportunities into hot, warm, and watch categories based on score.
 * Also calculates summary statistics.
 * @param {Array<object>} opportunities - An array of opportunity objects.
 * @param {Date} reportDate - The date for which the report is being generated.
 * @returns {object} An object containing categorized opportunities and summary stats.
 */
function processOpportunities(opportunities, reportDate) {
    const hotLeads = [];
    const warmLeads = [];
    const watchLeads = [];
    let totalEstimatedValue = 0;
    let totalScore = 0;
    let scoredCount = 0;
    const today = new Date(reportDate);
    today.setHours(0, 0, 0, 0); // Normalize to start of day

    const sevenDaysFromToday = new Date(today);
    sevenDaysFromToday.setDate(today.getDate() + 7);
    sevenDaysFromToday.setHours(23, 59, 59, 999); // End of day for 7 days from now

    const upcomingDeadlines = opportunities.filter(opp => {
        if (!opp.responseDeadline) return false;
        const deadlineDate = new Date(opp.responseDeadline);
        deadlineDate.setHours(0, 0, 0, 0); // Normalize to start of day for comparison

        return deadlineDate >= today && deadlineDate <= sevenDaysFromToday;
    }).length;

    opportunities.forEach(opp => {
        const score = opp.score || 0;
        const value = opp.estimatedValue || 0;

        // Populate total estimated value
        if (typeof value === 'number') {
            totalEstimatedValue += value;
        } else if (typeof value === 'string') {
            const parsedValue = parseFloat(value.replace(/[^0-9.-]+/g,""));
            if (!isNaN(parsedValue)) {
                totalEstimatedValue += parsedValue;
            }
        }


        if (score >= 80) {
            hotLeads.push(opp);
        } else if (score >= 60) {
            warmLeads.push(opp);
        } else {
            watchLeads.push(opp);
        }

        if (typeof score === 'number') {
            totalScore += score;
            scoredCount++;
        }
    });

    const averageScore = scoredCount > 0 ? (totalScore / scoredCount) : 0;
    const newOpportunitiesToday = opportunities.filter(opp => {
        // Assuming 'publishedDate' or similar field exists and is a valid date string
        // For this example, we'll assume all loaded opportunities are 'new' for the report day
        // In a real scenario, this would compare to a 'publishedDate' field.
        // For now, it will just be the count of loaded opportunities.
        return true;
    }).length; // This needs to be refined if actual 'new' logic is different

    return {
        hotLeads,
        warmLeads,
        watchLeads,
        summary: {
            hotCount: hotLeads.length,
            warmCount: warmLeads.length,
            watchCount: watchLeads.length,
            totalEstimatedValue,
            averageScore,
            newOpportunitiesToday,
            upcomingDeadlines: upcomingDeadlines, // Corrected variable name
            // Assuming system costs would come from another source, mocking for now.
            systemCostsYesterday: 5.23,
            systemCostsThisWeek: 35.78
        }
    };
}


/**
 * Generates the plain text email body.
 * @param {object} processedData - The object containing categorized opportunities and summary stats.
 * @param {string} reportDateFormatted - The formatted date for the email subject.
 * @returns {string} The complete plain text email body.
 */
function generateEmailBody(processedData, reportDateFormatted) {
    const { hotLeads, warmLeads, watchLeads, summary } = processedData;

    let body = ''; // Subject is handled separately
    // Hot Leads Section
    body += `🔥 HOT LEADS TODAY (${summary.hotCount}):\n\n`;
    if (hotLeads.length === 0) {
        body += "   No hot leads identified today.\n\n";
    } else {
        hotLeads.forEach((opp, index) => {
            const title = opp.title || 'Untitled Opportunity';
            const value = formatCurrency(opp.estimatedValue);
            const deadline = opp.responseDeadline ? formatDate(new Date(opp.responseDeadline)) : 'N/A';
            const score = opp.score !== undefined && opp.score !== null ? opp.score : 'N/A';
            const url = opp.url || 'No URL provided';
            const agency = opp.agency || 'Unknown';
            const reasons = Array.isArray(opp.reasons) ? opp.reasons : [];

            body += `${index + 1}. ${title}\n`;
            body += `   💰 ${value} | Due: ${deadline} | Fit Score: ${score}/100\n`;
            body += `   🏛️  Agency: ${agency}\n`;
            reasons.forEach(reason => {
                body += `   ✅ ${reason}\n`;
            });
            body += `   📋 ${url}\n\n`;
        });
    }

    // Top Biddable Opportunities Section (Combined Hot + Warm, or fallback to Watch)
    let topOpportunities = [...hotLeads, ...warmLeads].sort((a, b) => (b.score || 0) - (a.score || 0));
    let sectionTitle = "BIDDABLE OPPORTUNITIES";
    
    // If no hot/warm, show top watch opportunities
    if (topOpportunities.length === 0 && watchLeads.length > 0) {
        topOpportunities = [...watchLeads].sort((a, b) => (b.score || 0) - (a.score || 0));
        sectionTitle = "WATCH LIST - LOWER FIT OPPORTUNITIES";
    }
    
    const topCount = Math.min(10, topOpportunities.length); // Show top 10
    
    if (topCount > 0) {
        const highestScore = topOpportunities[0].score || 0;
        body += `\n🎯 TOP ${topCount} ${sectionTitle} (Highest Score: ${highestScore}):\n\n`;
        
        topOpportunities.slice(0, topCount).forEach((opp, index) => {
            const title = opp.title || 'Untitled Opportunity';
            const naics = Array.isArray(opp.naicsCode) && opp.naicsCode.length > 0 ? opp.naicsCode[0] : 'N/A';
            const agency = opp.agency || 'Unknown';
            const deadline = opp.responseDeadline ? formatDate(new Date(opp.responseDeadline)) : 'N/A';
            const url = opp.url || 'No URL provided';
            const noticeType = opp.noticeType || '';
            const score = opp.score !== undefined && opp.score !== null ? opp.score : 'N/A';
            
            // Calculate days remaining
            let daysRemaining = 'N/A';
            if (opp.responseDeadline) {
                const deadlineDate = new Date(opp.responseDeadline);
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                deadlineDate.setHours(0, 0, 0, 0);
                const diffTime = deadlineDate - today;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (diffDays > 0) {
                    daysRemaining = `${diffDays} days`;
                } else if (diffDays === 0) {
                    daysRemaining = 'Today';
                } else {
                    daysRemaining = 'EXPIRED';
                }
            }
            
            // Only add notice type if it's not already in the title
            const titleLower = title.toLowerCase();
            const shouldAddType = noticeType && 
                                  noticeType !== 'Unknown' && 
                                  !titleLower.includes(noticeType.toLowerCase());
            
            body += `${index + 1}. ${title}${shouldAddType ? ' - ' + noticeType : ''}\n`;
            body += `   • Agency: ${agency}\n`;
            body += `   • NAICS: ${naics}\n`;
            body += `   • Due: ${deadline}${daysRemaining !== 'N/A' && daysRemaining !== 'EXPIRED' ? ` (${daysRemaining} remaining)` : (daysRemaining === 'EXPIRED' ? ' (EXPIRED)' : '')}\n`;
            body += `   • Fit Score: ${score}/100\n`;
            body += `   • ${url}\n\n`;
        });
    }

    // Pipeline Summary
    body += `📊 PIPELINE SUMMARY:\n`;
    body += `- Hot: ${summary.hotCount} | Warm: ${summary.warmCount} | Watch: ${summary.watchCount}\n`;
    body += `- Total estimated value: ${formatCurrency(summary.totalEstimatedValue)}\n`;
    body += `- New opportunities today: ${summary.newOpportunitiesToday}
- Upcoming deadlines (next 7 days): ${summary.upcomingDeadlines}\n\n`;

    // System Costs
    body += `💰 SYSTEM COSTS:\n`;
    body += `- Yesterday: ${formatCurrency(summary.systemCostsYesterday, 2)}\n`;
    body += `- This week: ${formatCurrency(summary.systemCostsThisWeek, 2)}\n\n`;

    body += `---\n`;
    body += `📁 View all in Drive: ${DRIVE_LINK}\n`;

    return body;
}


/**
 * Main function to run the email digest generation.
 */
async function main() {
    let exitCode = 0;
    try {
        const args = parseArgs();
        const targetDate = parseDateString(args.date);
        const dateString = targetDate.toISOString().split('T')[0]; // YYYY-MM-DD for file name
        const recipients = args.to ? [args.to] : DEFAULT_RECIPIENTS;
        const dryRun = args.dryRun || false;

        console.log(`Running email digest for date: ${dateString}`);
        if (dryRun) console.log("DRY RUN ENABLED: Email will be printed to console, not sent.");
        console.log(`Recipients: ${Array.isArray(recipients) ? recipients.join(', ') : recipients}`);

        const opportunities = await loadOpportunities(dateString);

        if (!opportunities) {
            console.log("No opportunities loaded, exiting gracefully.");
            return; // Exit successfully if no opportunities are found
        }

        const processedData = processOpportunities(opportunities, targetDate);
        const reportDateFormatted = formatDate(targetDate);
        const subject = `SoKat Sales Intelligence - ${reportDateFormatted}`;
        const emailBody = generateEmailBody(processedData, reportDateFormatted);

        if (dryRun) {
            console.log("\n--- GENERATED EMAIL (DRY RUN) ---\n");
            console.log(`Subject: ${subject}`);
            console.log(emailBody);
            console.log("\n--- END OF EMAIL ---\n");
        } else {
            console.log("Sending email...");
            const sendResult = await sendEmail(subject, emailBody, recipients);
            console.log("✅ Email sent successfully:", sendResult);
            
            // Save to Google Drive
            console.log("Uploading to Google Drive...");
            await saveToGoogleDrive(subject, emailBody, dateString);
        }

    } catch (error) {
        console.error("An unhandled error occurred:", error);
        exitCode = 1;
    } finally {
        process.exit(exitCode);
    }
}

// Run the main function
if (require.main === module) {
    main();
}
