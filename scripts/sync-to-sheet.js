#!/usr/bin/env node

/**
 * @fileoverview Syncs government opportunity data to Google Sheets dashboard
 * @version 1.0.0
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs').promises;
const execAsync = promisify(exec);

const SHEET_ID = "1J9fam5XwLF7Kkyha3uWqzdQTq9nu5BBVYvCMPRlLjDM";
const ACCOUNT = "jimkliew@gmail.com";
const DATA_DIR = path.join(__dirname, '../data/scores');

/**
 * Calculate days remaining until deadline
 */
function calculateDaysRemaining(dueDate) {
    if (!dueDate) return 'N/A';
    const due = new Date(dueDate);
    const now = new Date();
    const diff = Math.ceil((due - now) / (1000 * 60 * 60 * 24));
    return diff;
}

/**
 * Format opportunity data for sheet row
 */
function formatOpportunity(opp, dateStr) {
    return [
        dateStr,
        opp.title || 'N/A',
        opp.agency || 'Unknown',
        opp.naics || 'N/A',
        opp.value || 'N/A',
        opp.dueDate || 'N/A',
        opp.score || 0,
        opp.category || 'skip',
        calculateDaysRemaining(opp.dueDate),
        opp.url || 'N/A'
    ];
}

/**
 * Load and parse all score files
 */
async function loadAllOpportunities() {
    const files = await fs.readdir(DATA_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    
    const allRows = [];
    
    for (const file of jsonFiles) {
        const filePath = path.join(DATA_DIR, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const data = JSON.parse(content);
        
        // Extract date from filename (handles both MM-DD-YYYY and YYYY-MM-DD formats)
        const dateMatch = file.match(/(\d{2,4})-(\d{2})-(\d{2,4})/);
        let dateStr = file.replace('.json', '');
        
        if (dateMatch) {
            const [_, p1, p2, p3] = dateMatch;
            // If first part is 4 digits, it's YYYY-MM-DD, otherwise MM-DD-YYYY
            dateStr = p1.length === 4 ? `${p1}-${p2}-${p3}` : `${p3}-${p1}-${p2}`;
        }
        
        // Process each opportunity
        if (Array.isArray(data)) {
            for (const opp of data) {
                allRows.push(formatOpportunity(opp, dateStr));
            }
        }
    }
    
    return allRows;
}

/**
 * Append rows to Google Sheet
 */
async function appendToSheet(rows) {
    if (rows.length === 0) {
        console.log('No rows to append.');
        return;
    }
    
    const valuesJson = JSON.stringify(rows);
    const tempFile = '/tmp/sheet-data.json';
    await fs.writeFile(tempFile, valuesJson);
    
    const cmd = `gog sheets append "${SHEET_ID}" "Sheet1!A:J" --values-json '${valuesJson}' --insert INSERT_ROWS --account ${ACCOUNT}`;
    
    try {
        const { stdout, stderr } = await execAsync(cmd);
        console.log(`✅ Appended ${rows.length} rows to sheet`);
        if (stdout) console.log(stdout);
        if (stderr) console.error(stderr);
    } catch (error) {
        console.error('❌ Error appending to sheet:', error.message);
        throw error;
    }
}

/**
 * Main execution
 */
async function main() {
    try {
        console.log('📊 Loading all historical opportunities...');
        const rows = await loadAllOpportunities();
        console.log(`Found ${rows.length} total opportunities across all files`);
        
        console.log('📤 Uploading to Google Sheets...');
        await appendToSheet(rows);
        
        console.log(`\n✅ Dashboard ready: https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`);
    } catch (error) {
        console.error('❌ Fatal error:', error);
        process.exit(1);
    }
}

main();
