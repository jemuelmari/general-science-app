const fs = require('fs');
const path = require('path');

// --- CONFIGURATION ---
const ROOT_DIR = __dirname;
const TERMS = ['term1', 'term2', 'term3'];
const ASSESSMENTS = ['st1', 'st2', 'te'];
const COMP_FILE = path.join(ROOT_DIR, 'data', 'competencies.json');

// 1. Load Competencies Data
const compData = JSON.parse(fs.readFileSync(COMP_FILE, 'utf8'));

// 2. TOS Engine Logic (Simplified version to get the expected sequence)
const LOTS_RATIO = 0.30;
const HOTS_RATIO = 0.70;

function getCompetenciesForAssessment(termData, assessment) {
  if (assessment === 'st1') {
    return termData.competencies.filter(c => c.weeks.some(w => w >= 1 && w <= 4));
  }
  if (assessment === 'st2') {
    return termData.competencies.filter(c => c.weeks.some(w => w >= 5 && w <= 8));
  }
  if (assessment === 'te') {
    // For TE, we combine Weeks 9-10 and assume top 5 least learned from ST1+ST2
    // To keep it simple for alignment, we just pool weeks 9-10 first.
    // NOTE: In a real scenario, TE alignment might be trickier due to "Least Learned"
    return termData.competencies.filter(c => c.weeks.some(w => w >= 9 && w <= 10));
  }
}

function computeWeights(competencies, totalItems) {
  const totalHours = competencies.reduce((sum, c) => sum + (c.hours || 0), 0);
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
  let totalFixed = 0;

  for (const term of TERMS) {
    const termData = compData[term];
    if (!termData) continue;

    for (const assessment of ASSESSMENTS) {
      const filePath = path.join(ROOT_DIR, 'student', term, 'assessments', `${assessment}.json`);
      
      if (!fs.existsSync(filePath)) {
        console.log(`⏩ Skipping: ${term} / ${assessment}.json (File not found)`);
        continue;
      }

      console.log(`\n🔍 Checking: ${term} / ${assessment}.json`);
      
      const qBank = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!qBank.questions || !Array.isArray(qBank.questions)) {
        console.log(`   ⚠️ No 'questions' array found. Skipping.`);
        continue;
      }

      const totalItems = qBank.questions.length;
      let competencies = getCompetenciesForAssessment(termData, assessment);
      
      // For TE, if we have totalItems, we need to pad it by taking the highest priority ones
      // For alignment purposes, we just map the available questions to the rows.
      
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
        if (q.competency !== expectedCode) {
          console.log(`   🔧 Item #${idx + 1}: Changed [${q.competency}] -> [${expectedCode}]`);
          q.competency = expectedCode; // Auto-fix
          fixedCount++;
        }
      });

      if (fixedCount > 0) {
        fs.writeFileSync(filePath, JSON.stringify(qBank, null, 2), 'utf8');
        console.log(`   ✅ Fixed ${fixedCount} mismatches and saved.`);
        totalFixed += fixedCount;
      } else {
        console.log(`   ✨ Perfectly aligned! No changes needed.`);
      }
    }
  }

  console.log(`\n================================`);
  console.log(`🎉 Done! Total items fixed: ${totalFixed}`);
  console.log(`================================`);
}

fixAll().catch(console.error);
