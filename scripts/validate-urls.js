#!/usr/bin/env node
/**
 * URL Validator for Sales Intelligence System
 * 
 * Validates all SAM.gov URLs in scored opportunities
 * Simple HTTP check - no browser automation needed
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Get today's date in MM-DD-YYYY format (to match scraper output)
const date = new Date();
const today = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}-${date.getFullYear()}`;
const todayISO = date.toISOString().split('T')[0];

// File paths - try both formats
const scoredFile = fs.existsSync(path.join(__dirname, `../data/scores/${today}.json`)) 
  ? path.join(__dirname, `../data/scores/${today}.json`)
  : path.join(__dirname, `../data/scores/${todayISO}.json`);
const outputDir = path.join(__dirname, '../data/url-validation');
const outputFile = path.join(outputDir, `${todayISO}.json`);

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

/**
 * Validate a single URL
 */
function validateUrl(url) {
  return new Promise((resolve) => {
    const timeoutMs = 10000; // 10 second timeout
    
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      resolve({
        url,
        status: res.statusCode,
        working: res.statusCode === 200 || res.statusCode === 302,
        redirected: res.statusCode === 302
      });
    });
    
    req.on('error', (err) => {
      resolve({
        url,
        status: 'error',
        working: false,
        error: err.message
      });
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve({
        url,
        status: 'timeout',
        working: false,
        error: 'Request timeout'
      });
    });
  });
}

/**
 * Main function
 */
async function main() {
  console.log(`🔍 URL Validation Report - ${todayISO}`);
  console.log('═'.repeat(60));
  
  // Read scored opportunities
  if (!fs.existsSync(scoredFile)) {
    console.error(`❌ Error: Scored opportunities file not found: ${scoredFile}`);
    process.exit(1);
  }
  
  const opportunities = JSON.parse(fs.readFileSync(scoredFile, 'utf8'));
  console.log(`📊 Found ${opportunities.length} opportunities to validate\n`);
  
  // Validate all URLs
  const results = [];
  const hotLeads = opportunities.filter(o => o.score >= 80);
  
  console.log(`🔥 Validating ${hotLeads.length} hot leads first...\n`);
  
  for (let i = 0; i < hotLeads.length; i++) {
    const opp = hotLeads[i];
    process.stdout.write(`Checking [${i + 1}/${hotLeads.length}] ${opp.title.substring(0, 50)}... `);
    
    const result = await validateUrl(opp.url);
    results.push({
      id: opp.id,
      title: opp.title,
      score: opp.score,
      category: opp.category,
      ...result
    });
    
    if (result.working) {
      console.log('✅');
    } else {
      console.log(`❌ (${result.status})`);
    }
    
    // Rate limiting: wait 100ms between requests
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Quick sample of other opportunities (first 20)
  console.log(`\n📋 Sampling 20 other opportunities...\n`);
  const others = opportunities.filter(o => o.score < 80).slice(0, 20);
  
  for (let i = 0; i < others.length; i++) {
    const opp = others[i];
    process.stdout.write(`Checking [${i + 1}/${others.length}] ${opp.title.substring(0, 50)}... `);
    
    const result = await validateUrl(opp.url);
    results.push({
      id: opp.id,
      title: opp.title,
      score: opp.score,
      category: opp.category,
      ...result
    });
    
    if (result.working) {
      console.log('✅');
    } else {
      console.log(`❌ (${result.status})`);
    }
    
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Generate summary
  const summary = {
    date: todayISO,
    timestamp: new Date().toISOString(),
    totalOpportunities: opportunities.length,
    validated: results.length,
    hotLeadsValidated: results.filter(r => r.score >= 80).length,
    working: results.filter(r => r.working).length,
    broken: results.filter(r => !r.working).length,
    byStatus: {}
  };
  
  // Count by status
  results.forEach(r => {
    const status = r.status.toString();
    summary.byStatus[status] = (summary.byStatus[status] || 0) + 1;
  });
  
  // Calculate percentage
  summary.percentWorking = ((summary.working / summary.validated) * 100).toFixed(1) + '%';
  
  // Identify broken URLs
  const brokenUrls = results.filter(r => !r.working);
  
  // Save results
  const output = {
    summary,
    results,
    brokenUrls: brokenUrls.map(r => ({
      id: r.id,
      title: r.title,
      url: r.url,
      status: r.status,
      error: r.error
    }))
  };
  
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
  
  // Print summary
  console.log('\n' + '═'.repeat(60));
  console.log('📊 VALIDATION SUMMARY');
  console.log('═'.repeat(60));
  console.log(`Total opportunities: ${summary.totalOpportunities}`);
  console.log(`Validated: ${summary.validated}`);
  console.log(`Hot leads checked: ${summary.hotLeadsValidated}`);
  console.log(`✅ Working: ${summary.working} (${summary.percentWorking})`);
  console.log(`❌ Broken: ${summary.broken}`);
  
  if (brokenUrls.length > 0) {
    console.log(`\n⚠️  BROKEN URLs:`);
    brokenUrls.forEach(r => {
      console.log(`  - ${r.title.substring(0, 60)}`);
      console.log(`    ${r.url}`);
      console.log(`    Status: ${r.status}${r.error ? ' - ' + r.error : ''}\n`);
    });
  }
  
  console.log(`\n📁 Full report saved to: ${outputFile}`);
}

// Run
main().catch(console.error);
