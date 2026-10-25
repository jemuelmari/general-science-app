const fs = require('fs');
const path = require('path');

// --- CONFIGURATION ---
const ROOT_DIR = __dirname;
const TERMS = ['term1', 'term2', 'term3'];
const ALL_ASSESSMENTS = ['st1', 'st2', 'te', 'quiz1', 'quiz2', 'quiz3', 'pt1', 'pt2', 'pt3'];
const COMP_FILE = path.join(ROOT_DIR, 'data', 'competencies.json');

console.log("🚀 Starting Universal Competency Alignment...\n");

if (!fs.existsSync(COMP_FILE)) {
  console.error("❌ Error: Cannot find data/competencies.json. Make sure you run this in the project root.");
  process.exit(1);
}

const compData = JSON.parse(fs.readFileSync(COMP_FILE, 'utf8'));

// 1. Get the valid competencies per assessment type
function getCompetenciesForAssessment(termData, assessment) {
  if (assessment === 'st1' || assessment === 'quiz1') {
    return termData.competencies.filter(c => c.weeks.some(w => w >= 1 && w <= 2));
  }
  if (assessment === 'st2' || assessment === 'quiz2') {
    return termData.competencies.filter(c => c.weeks.some(w => w >= 3 && w <= 4));
  }
  if (assessment === 'quiz3') {
    return termData.competencies.filter(c => c.weeks.some(w => w >= 5 && w <= 6));
  }
  if (assessment === 'pt1' || assessment === 'pt2' || assessment === 'pt3') {
    // PTs usually encompass the whole term or specific weeks. 
    // We'll just use all competencies in the term for PTs to be safe.
    return termData.competencies;
  }
  if (assessment === 'te') {
    return termData.competencies; // Cover all for TE
  }
  return termData.competencies;
}

// 2. Compute the item weight distribution
function computeWeights(competencies, totalItems) {
  const totalHours = competencies.reduce((sum, c) => sum + (c.hours || 1), 0);
  let rows = competencies.map(c => {
    const weight = (c.hours / totalHours) * 100;
    const rawItems = (weight / 100) * totalItems;
    return { code: c.code, rawItems, items: Math.round(rawItems), remainder: rawItems - Math.floor(rawItems) };
  });

  let sum = rows.reduce((s, r) => s + r.items, 0);
  let diff = totalItems - sum;

  if (diff !== 0) {
    if (diff > 0) {
      rows.sort((a, b) => b.remainder - a.remainder).slice(0, diff).forEach(r => r.items++);
    } else {
      rows.sort((a, b) => a.remainder - b.remainder).filter(r => r.items > 1).slice(0, Math.abs(diff)).forEach(r => r.items--);
    }
  }
  return rows;
}

// 3. Main Fix Function
async function fixAll() {
  let totalFixedFiles = 0;
  let totalFixedItems = 0;

  for (const term of TERMS) {
    const termData = compData[term];
    if (!termData) continue;

    for (const assessment of ALL_ASSESSMENTS) {
      const filePath = path.join(ROOT_DIR, 'student', term, 'assessments', `${assessment}.json`);
      
      if (!fs.existsSync(filePath)) {
        continue; // Skip silently if file doesn't exist (e.g., no quiz3 in term1)
      }

      let qBank;
      try {
        qBank = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (e) {
        console.log(`❌ [${term}/${assessment}.json] Invalid JSON format. Skipping.`);
        continue;
      }

      if (!qBank.questions || !Array.isArray(qBank.questions) || qBank.questions.length === 0) {
        continue; // Skip if no questions
      }

      const totalItems = qBank.questions.length;
      let competencies = getCompetenciesForAssessment(termData, assessment);
      
      // If there are no matching competencies based on weeks (edge cases), fallback to all
      if (competencies.length === 0) competencies = termData.competencies;

      let rows = computeWeights(competencies, totalItems);
      
      // Build the EXPECTED sequence of competency codes
      let expectedSequence = [];
      rows.forEach(row => {
        for (let i = 0; i < row.items; i++) {
          expectedSequence.push(row.code);
        }
      });

      // Now, check and fix the question bank
      let fixedCount = 0;
      qBank.questions.forEach((q, idx) => {
        const expectedCode = expectedSequence[idx];
        
        // Only fix if the expected code exists and is different
        if (expectedCode && q.competency !== expectedCode) {
          console.log(`   🔧 [${term}/${assessment}.json] Item #${idx + 1}: Changed [${q.competency}] -> [${expectedCode}]`);
          q.competency = expectedCode;
          fixedCount++;
        }
      });

      if (fixedCount > 0) {
        fs.writeFileSync(filePath, JSON.stringify(qBank, null, 2), 'utf8');
        console.log(`✅ [${term}/${assessment}.json] Fixed ${fixedCount} mismatches and saved.\n`);
        totalFixedFiles++;
        totalFixedItems += fixedCount;
      } else {
        console.log(`✨ [${term}/${assessment}.json] Perfectly aligned! No changes needed.\n`);
      }
    }
  }

  console.log(`\n================================`);
  console.log(`🎉 Done!`);
  console.log(`Files Modified: ${totalFixedFiles}`);
  console.log(`Total Items Fixed: ${totalFixedItems}`);
  console.log(`================================`);
}

fixAll().catch(console.error);
