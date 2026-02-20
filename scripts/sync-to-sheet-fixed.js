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
const BATCH_SIZE = 50; // Smaller batches

/**
 * Calculate days remaining until deadline
 */
function calculateDaysRemaining(dueDate) {
    if (!dueDate) return 'N/A';
    try {
        const due = new Date(dueDate);
        const now = new Date();
        const diff = Math.ceil((due - now) / (1000 * 60 * 60 * 24));
        return diff;
    } catch {
        return 'N/A';
    }
}

/**
 * Format opportunity data for sheet row
 */
function formatOpportunity(opp, dateStr) {
    return [
        dateStr,
        (opp.title || 'N/A').replace(/"/g, '""'), // Escape quotes
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
    const jsonFiles = files.filter(f => f.endsWith('.json')).sort();
    
    const allRows = [];
    
    for (const file of jsonFiles) {
        const filePath = path.join(DATA_DIR, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const data = JSON.parse(content);
        
        // Extract date from filename
        const dateMatch = file.match(/(\d{2,4})-(\d{2})-(\d{2,4})/);
        let dateStr = file.replace('.json', '');
        
        if (dateMatch) {
            const [_, p1, p2, p3] = dateMatch;
            dateStr = p1.length === 4 ? `${p1}-${p2}-${p3}` : `${p3}-${p1}-${p2}`;
        }
        
        if (Array.isArray(data)) {
            for (const opp of data) {
                allRows.push(formatOpportunity(opp, dateStr));
            }
        }
    }
    
    return allRows;
}

/**
 * Append batch to Google Sheet
 */
async function appendBatch(rows, batchNum, totalBatches) {
    const tempFile = `/tmp/sheet-batch-${batchNum}.json`;
    await fs.writeFile(tempFile, JSON.stringify(rows));
    
    const cmd = `gog sheets append "${SHEET_ID}" "Sheet1!A:J" --values-json "$(cat ${tempFile})" --insert INSERT_ROWS --account ${ACCOUNT}`;
    
    try {
        await execAsync(cmd);
        await fs.unlink(tempFile); // Clean up
        console.log(`✅ Batch ${batchNum}/${totalBatches} (${rows.length} rows)`);
    } catch (error) {
        console.error(`❌ Batch ${batchNum} failed:`, error.message);
        throw error;
    }
}

/**
 * Main execution
 */
async function main() {
    try {
        console.log('📊 Loading all historical opportunities...');
        const allRows = await loadAllOpportunities();
        console.log(`Found ${allRows.length} opportunities across all dates`);
        
        // Split into batches
        const batches = [];
        for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
            batches.push(allRows.slice(i, i + BATCH_SIZE));
        }
        
        console.log(`📤 Uploading ${batches.length} batches...`);
        
        for (let i = 0; i < batches.length; i++) {
            await appendBatch(batches[i], i + 1, batches.length);
            // Delay between batches
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        console.log(`\n✅ Complete! Dashboard: https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`);
    } catch (error) {
        console.error('❌ Fatal error:', error);
        process.exit(1);
    }
}

main();
