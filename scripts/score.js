
const fs = require('fs').promises;
const path = require('path');

const SOKAT_NAICS_CODES = [
    "541511", "541512", "541513", "541519", "511210", "518210", "517311",
    "517312", "519130", "519190", "541611", "541614", "541690", "541990",
    "541618", "541715", "541330", "541380", "561422"
];

const KEYWORDS = ["AI", "ML", "training", "curriculum", "cloud", "data science"];
const PRIORITY_AGENCIES = ["Treasury", "VA", "CMS"];

function scoreOpportunity(opportunity) {
    let score = 0;
    const reasons = [];

    // 1. Value
    const value = opportunity.estimatedValue || 0; // Treat null estimatedValue as 0
    if (value >= 2000000) {
        score += 40;
        reasons.push("High value ($2M+)");
    } else if (value >= 1000000) {
        score += 30;
        reasons.push("Medium value ($1M+)");
    } else if (value >= 500000) {
        score += 20;
        reasons.push("Moderate value ($500K+)");
    }

    // 2. NAICS match
    if (opportunity.naicsCode && opportunity.naicsCode.some(code => SOKAT_NAICS_CODES.includes(code))) {
        score += 20;
        reasons.push(`NAICS match (${opportunity.naicsCode.join(', ')})`);
    }

    // 3. Agency
    if (opportunity.agency && PRIORITY_AGENCIES.includes(opportunity.agency)) {
        score += 20;
        reasons.push(`Priority agency (${opportunity.agency})`);
    } else if (opportunity.agency) {
        score += 10;
        reasons.push(`Other agency (${opportunity.agency})`);
    }

    // 4. Keywords in title/description
    let keywordPoints = 0;
    const textToSearch = `${opportunity.title || ''} ${opportunity.description || ''}`.toLowerCase();
    const foundKeywords = new Set();

    for (const keyword of KEYWORDS) {
        if (textToSearch.includes(keyword.toLowerCase())) {
            if (!foundKeywords.has(keyword)) { // Ensure keywords are only counted once
                keywordPoints += 5;
                foundKeywords.add(keyword);
            }
        }
    }
    // Cap keyword points at 30
    if (keywordPoints > 30) {
        keywordPoints = 30;
    }
    score += keywordPoints;
    if (foundKeywords.size > 0) {
        reasons.push(`Keywords: ${Array.from(foundKeywords).join(', ')}`);
    }

    // 5. Timeline
    const responseDeadline = opportunity.responseDeadline;
    if (responseDeadline) {
        const dueDate = new Date(responseDeadline);
        const today = new Date();
        const diffTime = Math.abs(dueDate - today);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays > 14) {
            score += 20;
            reasons.push(`Timeline: >14 days (${diffDays} days remaining)`);
        } else if (diffDays >= 7) {
            score += 10;
            reasons.push(`Timeline: 7-14 days (${diffDays} days remaining)`);
        } else {
            reasons.push(`Timeline: <7 days (${diffDays} days remaining)`);
        }
    } else {
        reasons.push(`Timeline: No response deadline specified`);
    }


    // Clamp score between 0 and 100
    score = Math.max(0, Math.min(100, score));

    let category;
    if (score >= 80) {
        category = "hot";
    } else if (score >= 60) {
        category = "warm";
    } else if (score >= 40) {
        category = "watch";
    } else {
        category = "skip";
    }

    return {
        ...opportunity,
        score,
        category,
        reasons
    };
}

async function main() {
    const today = new Date();
    const dateString = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}-${today.getFullYear()}`;
    
    const inputFileName = `${dateString}.json`;
    const inputFilePath = path.join(__dirname, `../data/opportunities/${inputFileName}`);
    const outputFilePath = path.join(__dirname, `../data/scores/${inputFileName}`);

    try {
        const data = await fs.readFile(inputFilePath, 'utf8');
        const opportunities = JSON.parse(data);

        const scoredOpportunities = opportunities.map(scoreOpportunity);

        await fs.writeFile(outputFilePath, JSON.stringify(scoredOpportunities, null, 2), 'utf8');
        console.log(`Scoring complete. Scored opportunities saved to: ${outputFilePath}`);

        // Display breakdown for a few examples
        console.log("\n--- Scoring Breakdown Examples ---");
        scoredOpportunities.slice(0, 5).forEach((opp, index) => {
            console.log(`\nExample ${index + 1}: ID - ${opp.id}`);
            console.log(`  Title: ${opp.title}`);
            console.log(`  Value: ${opp.estimatedValue ? '$' + opp.estimatedValue.toLocaleString() : 'N/A'}`);
            console.log(`  NAICS: ${opp.naicsCode}`);
            console.log(`  Agency: ${opp.agency}`);
            console.log(`  Due Date: ${opp.responseDeadline || 'N/A'}`);
            console.log(`  Score: ${opp.score}`);
            console.log(`  Category: ${opp.category}`);
            console.log(`  Reasons:`);
            opp.reasons.forEach(reason => console.log(`    - ${reason}`));
        });

    } catch (error) {
        console.error("Error during scoring process:", error);
    }
}

main();
