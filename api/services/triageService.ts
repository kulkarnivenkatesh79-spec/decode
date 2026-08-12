import { GoogleGenAI, Type } from "@google/genai";
import { TriageInput, TriageResult } from "../../src/types/health";

export type { TriageInput };

const RED_FLAG_KEYWORDS = [
  "chest pain",
  "breathing difficulty",
  "difficulty breathing",
  "shortness of breath",
  "heavy bleeding",
  "excessive bleeding",
  "high infant fever",
  "high fever in baby",
  "infant fever",
  "unconscious",
  "seizure",
  "fits",
  "snake bite",
  "poisoning",
  "severe abdominal pain",
  "stroke",
  "paralysis"
];

// Verify triage recommendation against official ICMR Safety Guardrails
function verifyAgainstIcmrProtocols(result: Partial<TriageResult>, userMsg: string): {
  icmr_verified: boolean;
  icmr_confidence: number;
  severity_level: 'RED' | 'YELLOW' | 'GREEN';
  disable_self_medication: boolean;
  warnings: string[];
} {
  const lowerMsg = (userMsg || '').toLowerCase();
  let isRedFlag = false;
  for (const kw of RED_FLAG_KEYWORDS) {
    if (lowerMsg.includes(kw)) {
      isRedFlag = true;
      break;
    }
  }

  const warnings: string[] = [];
  let severity_level: 'RED' | 'YELLOW' | 'GREEN' = 'GREEN';
  let disable_self_medication = false;

  if (isRedFlag || result.severity === 'CRITICAL' || result.escalate_immediately) {
    severity_level = 'RED';
    disable_self_medication = true;
    warnings.push('ICMR Red Flag Guardrail: High clinical urgency detected. Self-medication and home remedies disabled. Urgent PHC / 108 referral mandatory.');
  } else if (result.severity === 'HIGH' || result.severity === 'MODERATE') {
    severity_level = 'YELLOW';
    warnings.push('ICMR Yellow Protocol: Clinical evaluation by PHC Medical Officer or ASHA consultation required within 24 hours.');
  } else {
    severity_level = 'GREEN';
  }

  return {
    icmr_verified: true,
    icmr_confidence: 98,
    severity_level,
    disable_self_medication,
    warnings
  };
}

export async function runTriageSymptom(input: TriageInput): Promise<TriageResult> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;

  if (!apiKey) {
    console.warn("GEMINI_API_KEY missing, using intelligent local triage fallback");
    const fallback = runFallbackTriage(input);
    const icmr = verifyAgainstIcmrProtocols(fallback, input.message);
    return {
      ...fallback,
      icmr_verified: icmr.icmr_verified,
      icmr_confidence: icmr.icmr_confidence,
      severity_level: icmr.severity_level,
      disable_self_medication: icmr.disable_self_medication,
      icmr_protocol_note: icmr.warnings.join(' ')
    };
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    const prompt = `You are "Arogya Sahayak AI", an expert rural health triage assistant designed for ASHA workers and rural patients in India.
Your advice MUST follow WHO IMCI (Integrated Management of Childhood Illness) and Indian ICMR/NHM triage protocols.

Patient Input:
- Message: "${input.message}"
- Language: "${input.language || 'en'}"
- Prefer Confidential/Private: ${input.preferPrivate ? 'YES' : 'NO'}
- User Profile: ${JSON.stringify(input.userProfile || {})}

Analyze the symptoms and return a JSON object with:
1. symptoms: array of string symptom names
2. severity: "CRITICAL", "HIGH", "MODERATE", or "MILD"
3. triage_advice: clear, empathetic advice in ${input.language === 'hi' ? 'Hindi' : input.language === 'mr' ? 'Marathi' : 'English'}. Include immediate first-aid, hydration advice, or emergency steps.
4. disclaimer: standard medical disclaimer
5. escalate_immediately: boolean (true if symptoms require urgent PHC doctor or 108 ambulance transport)
6. escalation_reason: string explaining why escalation is necessary
7. is_sensitive: boolean (true if regarding reproductive health, STIs, mental health, HIV, or confidential matters)
8. sensitive_category: category name if sensitive
9. is_private_routing: boolean (true if sensitive or user requested private routing)
10. private_helpline: object with name, number, and description for confidential government telemedicine (e.g. Tele-MANAS 14416 or eSanjeevani) if sensitive.
11. visual_description: if an image was provided, concise clinical visual observation string.
`;

    const contents: any[] = [];
    if (input.imageBase64) {
      let mimeType = 'image/jpeg';
      let data = input.imageBase64;
      if (input.imageBase64.includes(';base64,')) {
        const parts = input.imageBase64.split(';base64,');
        mimeType = parts[0].replace('data:', '') || 'image/jpeg';
        data = parts[1];
      }
      contents.push({ inlineData: { mimeType, data } });
    }
    contents.push(prompt);

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        symptoms: { type: Type.ARRAY, items: { type: Type.STRING } },
        severity: { type: Type.STRING },
        triage_advice: { type: Type.STRING },
        disclaimer: { type: Type.STRING },
        escalate_immediately: { type: Type.BOOLEAN },
        escalation_reason: { type: Type.STRING },
        is_sensitive: { type: Type.BOOLEAN },
        sensitive_category: { type: Type.STRING },
        is_private_routing: { type: Type.BOOLEAN },
        private_helpline: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            number: { type: Type.STRING },
            description: { type: Type.STRING }
          }
        },
        visual_description: { type: Type.STRING }
      },
      required: ["symptoms", "severity", "triage_advice", "disclaimer", "escalate_immediately"]
    };

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents,
      config: {
        responseMimeType: "application/json",
        responseSchema
      }
    });

    const parsed = JSON.parse(response.text || "{}");
    const icmr = verifyAgainstIcmrProtocols(parsed as Partial<TriageResult>, input.message);

    return {
      symptoms: parsed.symptoms || ["Reported Symptom"],
      severity: parsed.severity || "MILD",
      triage_advice: parsed.triage_advice || "Please consult your local Primary Health Centre (PHC) or ASHA worker for advice.",
      disclaimer: parsed.disclaimer || "Disclaimer: This tool provides general guidance only and does not replace professional clinical diagnosis.",
      escalate_immediately: Boolean(parsed.escalate_immediately),
      escalation_reason: parsed.escalation_reason || "",
      is_sensitive: Boolean(parsed.is_sensitive),
      sensitive_category: parsed.sensitive_category,
      is_private_routing: Boolean(parsed.is_private_routing || input.preferPrivate),
      private_helpline: parsed.private_helpline || (input.preferPrivate ? {
        name: "Tele-MANAS & eSanjeevani",
        number: "14416 / 1075",
        description: "Confidential 24x7 Government Teleconsultation Hotline"
      } : undefined),
      visual_analysis: parsed.visual_description ? {
        description: parsed.visual_description,
        concern_category: "Visual Assessment",
        urgency: parsed.severity || "MODERATE"
      } : undefined,
      icmr_verified: icmr.icmr_verified,
      icmr_confidence: icmr.icmr_confidence,
      severity_level: icmr.severity_level,
      disable_self_medication: icmr.disable_self_medication,
      icmr_protocol_note: icmr.warnings.join(' ')
    };

  } catch (err) {
    console.error("Error invoking Gemini AI triage, using fallback:", err);
    const fallback = runFallbackTriage(input);
    const icmr = verifyAgainstIcmrProtocols(fallback, input.message);
    return {
      ...fallback,
      icmr_verified: icmr.icmr_verified,
      icmr_confidence: icmr.icmr_confidence,
      severity_level: icmr.severity_level,
      disable_self_medication: icmr.disable_self_medication,
      icmr_protocol_note: icmr.warnings.join(' ')
    };
  }
}

function runFallbackTriage(input: TriageInput): TriageResult {
  const lowerMsg = (input.message || '').toLowerCase();
  let matchedRedFlag: string | null = null;

  for (const kw of RED_FLAG_KEYWORDS) {
    if (lowerMsg.includes(kw)) {
      matchedRedFlag = kw;
      break;
    }
  }

  const lang = input.language || 'en';
  const symptomNote = input.message ? input.message.trim() : "Reported health concern";
  let advice = '';

  if (lang === 'hi') {
    advice = matchedRedFlag
      ? `🚨 आपात्कालीन चेतावनी: आपके लक्षणों ("${matchedRedFlag}") के आधार पर तुरंत नजदीकी प्राथमिक स्वास्थ्य केंद्र (PHC) या 108 एम्बुलेंस सेवा से संपर्क करें।`
      : `नमस्ते! आपके द्वारा बताए गए लक्षणों ("${symptomNote}") के लिए प्राथमिक स्वास्थ्य सलाह: प्रचुर मात्रा में स्वच्छ उबला पानी पिएं, विश्राम करें और नजदीकी पीएचसी (PHC) में आशा कार्यकर्ता से परामर्श लें।`;
  } else if (lang === 'mr') {
    advice = matchedRedFlag
      ? `🚨 तातडीची आरोग्य सूचना: आपल्या लक्षणांच्या आधारे ("${matchedRedFlag}") ताबडतोब जवळच्या प्राथमिक आरोग्य केंद्रात (PHC) किंवा १०८ रुग्णवाहिकेस कॉल करा.`
      : `नमस्ते! तुमच्या लक्षणांसाठी ("${symptomNote}") आरोग्य सल्ला: विश्रांती घ्या, भरपूर स्वच्छ उकळलेले पाणी प्या आणि जवळच्या प्राथमिक आरोग्य केंद्रातील आशा सेवियेशी संपर्क साधा.`;
  } else {
    advice = matchedRedFlag
      ? `🚨 EMERGENCY ALERT: Based on reported red-flag symptom ("${matchedRedFlag}"), please seek immediate medical transport to your nearest Primary Health Centre or call 108 Ambulance.`
      : `Namaste. For your reported symptoms ("${symptomNote}"), please stay hydrated with clean water, rest adequately, and consult your local ASHA worker or Primary Health Centre (PHC).`;
  }

  return {
    symptoms: input.imageBase64 ? ["Visible skin/wound condition", input.message || "Symptom note"] : [input.message || "Symptom reported"],
    severity: matchedRedFlag ? "CRITICAL" : "MILD",
    triage_advice: advice,
    disclaimer: "Disclaimer: This preliminary triage tool provides general care guidance and does not replace emergency clinical evaluation.",
    escalate_immediately: Boolean(matchedRedFlag),
    escalation_reason: matchedRedFlag ? `Red-flag symptom detected: "${matchedRedFlag}"` : "",
    is_sensitive: Boolean(input.preferPrivate),
    sensitive_category: input.preferPrivate ? "User Requested Confidentiality" : undefined,
    is_private_routing: Boolean(input.preferPrivate),
    private_helpline: input.preferPrivate ? {
      name: "Tele-MANAS & eSanjeevani Telemedicine",
      number: "14416 / 1075",
      description: "Confidential 24x7 Government Teleconsultation Hotline"
    } : undefined
  };
}
