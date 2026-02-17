#!/usr/bin/env node
/**
 * Filter opportunities to only include biddable types
 * Removes Award Notices, Justifications, etc.
 */

const fs = require('fs');
const path = require('path');

const BIDDABLE_NOTICE_TYPES = [
    'Solicitation',
    'Combined Synopsis/Solicitation',
    'Presolicitation',
    'Sources Sought',
    'Special Notice'
];

// Get input file from command line or use default
const inputFile = process.argv[2] || path.join(__dirname, '../data/opportunities/02-15-2026.json');
const outputFile = inputFile; // Overwrite the same file

console.log(`📂 Reading: ${inputFile}`);

// Read opportunities
const opportunities = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

console.log(`📊 Total opportunities: ${opportunities.length}`);

// Count by notice type before filtering
const beforeCounts = {};
opportunities.forEach(opp => {
    const type = opp.noticeType || 'Unknown';
    beforeCounts[type] = (beforeCounts[type] || 0) + 1;
});

console.log('\n📋 Before filtering:');
Object.entries(beforeCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
        const isBiddable = BIDDABLE_NOTICE_TYPES.includes(type);
        const marker = isBiddable ? '✅' : '❌';
        console.log(`  ${marker} ${type}: ${count}`);
    });

// Filter to only biddable types
const filtered = opportunities.filter(opp => 
    BIDDABLE_NOTICE_TYPES.includes(opp.noticeType)
);

console.log(`\n✅ Biddable opportunities: ${filtered.length}`);
console.log(`❌ Removed: ${opportunities.length - filtered.length}`);

// Count by notice type after filtering
const afterCounts = {};
filtered.forEach(opp => {
    const type = opp.noticeType || 'Unknown';
    afterCounts[type] = (afterCounts[type] || 0) + 1;
});

console.log('\n📋 After filtering:');
Object.entries(afterCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => console.log(`  ✅ ${type}: ${count}`));

// Save filtered data
fs.writeFileSync(outputFile, JSON.stringify(filtered, null, 2), 'utf8');
console.log(`\n💾 Saved ${filtered.length} biddable opportunities to: ${outputFile}`);
