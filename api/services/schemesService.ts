import { Scheme, SchemeMatchInput, SchemeMatchResult } from '../../src/types/health';

export const STATIC_SCHEMES: Array<Scheme & {
  eligibilityRules: {
    maxIncome: number;
    requiresBPL: boolean;
    minAge: number;
    maxAge: number;
    genderRequirement: string;
    requiresPregnancy: boolean;
    disabilityRequired: boolean;
  };
}> = [
  {
    id: "scheme_pmjay",
    name: "Ayushman Bharat Pradhan Mantri Jan Arogya Yojana (PM-JAY)",
    shortName: "PM-JAY",
    category: "Health Insurance & Hospitalization Cover",
    description: "World's largest government-funded health assurance scheme providing cashless hospital secondary & tertiary care coverage up to ₹5,00,000 per family per year.",
    benefits: "₹5,00,000 / family / year cashless cover at empaneled hospitals",
    eligibilitySummary: "BPL / Antyodaya Ration Card holders or income < ₹1.2 Lakh/year.",
    officialUrl: "https://pmjay.gov.in",
    eligibilityRules: {
      maxIncome: 120000,
      requiresBPL: true,
      minAge: 0,
      maxAge: 120,
      genderRequirement: "ANY",
      requiresPregnancy: false,
      disabilityRequired: false
    }
  },
  {
    id: "scheme_jsy",
    name: "Janani Suraksha Yojana (JSY)",
    shortName: "JSY",
    category: "Maternal Health & Direct Benefit Transfer",
    description: "Safe motherhood intervention promoting institutional delivery among poor pregnant women through direct financial assistance.",
    benefits: "₹1,400 (Rural) / ₹1,000 (Urban) Cash Incentive into bank account",
    eligibilitySummary: "Pregnant women aged 19+ delivering at public PHC/CHC health centre.",
    officialUrl: "https://nhm.gov.in",
    eligibilityRules: {
      maxIncome: 150000,
      requiresBPL: false,
      minAge: 19,
      maxAge: 45,
      genderRequirement: "FEMALE",
      requiresPregnancy: true,
      disabilityRequired: false
    }
  },
  {
    id: "scheme_pmmvy",
    name: "Pradhan Mantri Matru Vandana Yojana (PMMVY)",
    shortName: "PMMVY",
    category: "Maternity Cash Benefit",
    description: "Conditional cash transfer scheme for pregnant women and lactating mothers for first child and second girl child.",
    benefits: "₹5,000 cash benefit transferred directly to Aadhaar-linked bank account",
    eligibilitySummary: "Pregnant women registered at Anganwadi / PHC within 12 weeks.",
    officialUrl: "https://pmmvy.wcd.gov.in",
    eligibilityRules: {
      maxIncome: 800000,
      requiresBPL: false,
      minAge: 19,
      maxAge: 45,
      genderRequirement: "FEMALE",
      requiresPregnancy: true,
      disabilityRequired: false
    }
  },
  {
    id: "scheme_rbsk",
    name: "Rashtriya Bal Swasthya Karyakram (RBSK)",
    shortName: "RBSK",
    category: "Child Health Screening & Early Intervention",
    description: "Systematic health screening and early intervention service for children from birth to 18 years covering Defects, Diseases, Deficiencies, and Delays.",
    benefits: "100% Free Screening, Surgery & Medical Treatment at Government Hospitals",
    eligibilitySummary: "All children aged 0 to 18 years in rural and urban areas.",
    officialUrl: "https://rbsk.gov.in",
    eligibilityRules: {
      maxIncome: 1000000,
      requiresBPL: false,
      minAge: 0,
      maxAge: 18,
      genderRequirement: "ANY",
      requiresPregnancy: false,
      disabilityRequired: false
    }
  },
  {
    id: "scheme_udid",
    name: "Niramaya Health Insurance for Persons with Disabilities",
    shortName: "NIRAMAYA",
    category: "Disability Care & Rehabilitation",
    description: "Affordable health insurance scheme for persons with Autism, Cerebral Palsy, Mental Retardation, and Multiple Disabilities.",
    benefits: "₹1,00,000 OPD & IPD Medical Reimbursable Cover per year",
    eligibilitySummary: "Persons with >40% disability certificate or UDID card.",
    officialUrl: "https://thenationaltrust.gov.in",
    eligibilityRules: {
      maxIncome: 1000000,
      requiresBPL: false,
      minAge: 0,
      maxAge: 120,
      genderRequirement: "ANY",
      requiresPregnancy: false,
      disabilityRequired: true
    }
  }
];

export function matchSchemes(input: SchemeMatchInput): SchemeMatchResult[] {
  const userAge = typeof input.age === 'number' ? input.age : parseInt(String(input.age || 25), 10);
  const userIncome = typeof input.income === 'number' ? input.income : parseInt(String(input.income || 60000), 10);
  const isBPL = Boolean(input.is_bpl);
  const isPregnant = Boolean(input.is_pregnant);
  const gender = (input.gender || 'FEMALE').toUpperCase();

  return STATIC_SCHEMES.map(item => {
    const { eligibilityRules, ...scheme } = item;
    const rules = eligibilityRules;
    const matchedCriteria: string[] = [];
    const missingCriteria: string[] = [];
    let score = 0;

    if (userIncome <= rules.maxIncome) {
      score += 25;
      matchedCriteria.push(`Annual income ₹${userIncome.toLocaleString('en-IN')} is within limit (≤ ₹${rules.maxIncome.toLocaleString('en-IN')})`);
    } else {
      missingCriteria.push(`Income ₹${userIncome.toLocaleString('en-IN')} exceeds limit of ₹${rules.maxIncome.toLocaleString('en-IN')}`);
    }

    if (!rules.requiresBPL || isBPL) {
      score += 25;
      matchedCriteria.push(isBPL ? "BPL / Antyodaya Ration Card Verified" : "No BPL card restriction required");
    } else {
      missingCriteria.push("Requires BPL or Antyodaya Ration Card");
    }

    if (userAge >= rules.minAge && userAge <= rules.maxAge) {
      score += 20;
      matchedCriteria.push(`Age ${userAge} falls within eligible range (${rules.minAge}-${rules.maxAge} years)`);
    } else {
      missingCriteria.push(`Age ${userAge} is outside range (${rules.minAge}-${rules.maxAge} years)`);
    }

    if (rules.genderRequirement === 'ANY' || rules.genderRequirement === gender) {
      score += 15;
      matchedCriteria.push(`Gender criteria (${rules.genderRequirement}) satisfied`);
    } else {
      missingCriteria.push(`Scheme applicable for ${rules.genderRequirement} beneficiaries only`);
    }

    if (!rules.requiresPregnancy || isPregnant) {
      score += 15;
      if (rules.requiresPregnancy) {
        matchedCriteria.push("Maternity / Pregnancy status verified");
      }
    } else {
      missingCriteria.push("Requires active pregnancy or recent maternal registration");
    }

    const finalScore = Math.min(100, Math.max(0, score));
    const isMatched = finalScore >= 50;
    const qualificationReason = matchedCriteria.length > 0 
      ? matchedCriteria.join(". ") 
      : "Does not satisfy core scheme criteria.";

    return {
      scheme: scheme as Scheme,
      matched: isMatched,
      score: finalScore,
      qualificationReason,
      matchedCriteria
    };
  }).sort((a, b) => b.score - a.score);
}
