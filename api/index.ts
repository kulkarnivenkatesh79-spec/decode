import express from "express";
import { runTriageSymptom, TriageInput } from "./services/triageService";
import { matchSchemes } from "./services/schemesService";
import { getNearestFacilities } from "./services/facilitiesService";
import { createAshaAlert, getAshaAlertsAsync, updateAshaAlertStatusAsync, generateUserIdHash } from "./services/alertsService";
import { generateVillageAdvisory } from "./services/advisoryService";

const app = express();

// Enable CORS for all incoming client requests
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// Normalize request URL path to handle Vercel serverless rewrites seamlessly
app.use((req, _res, next) => {
  if (req.url.startsWith('/api/')) {
    req.url = req.url.substring(4);
  } else if (req.url === '/api') {
    req.url = '/';
  }
  next();
});

app.use(express.json({ limit: "10mb" }));

// Health check endpoint
app.get(["/health", "/api/health", "/"], (req, res) => {
  res.json({ status: "ok", app: "Arogya Sahayak", environment: "vercel-serverless", timestamp: new Date().toISOString() });
});

// Triage Symptom endpoint
app.post(["/api/triageSymptom", "/triageSymptom"], async (req, res) => {
  console.log(`\n==================================================`);
  console.log(`[TRIAGE ROUTE] Step 1: Request received at /api/triageSymptom`);
  console.log(`[TRIAGE ROUTE] Method: ${req.method}, URL: ${req.url}`);

  try {
    // 1. Request Body & Type Validation
    const body = req.body;
    if (!body || typeof body !== "object") {
      console.warn("[TRIAGE ROUTE] Validation Failed: Request body missing or not a JSON object.");
      return res.status(400).json({
        success: false,
        error: "Invalid request body. Expected a JSON object.",
        stage: "validation"
      });
    }

    const { message, imageBase64, language, age, userProfile, preferPrivate, userId, sessionId } = body;

    const hasMessage = typeof message === "string" && message.trim().length > 0;
    const hasImage = typeof imageBase64 === "string" && imageBase64.trim().length > 0;

    if (!hasMessage && !hasImage) {
      console.warn("[TRIAGE ROUTE] Validation Failed: Neither 'message' nor 'imageBase64' was provided.");
      return res.status(400).json({
        success: false,
        error: "Missing required 'message' (symptom description) or 'imageBase64' (symptom photograph) in request body.",
        stage: "validation"
      });
    }

    if (imageBase64 !== undefined && typeof imageBase64 !== "string") {
      console.warn("[TRIAGE ROUTE] Validation Failed: 'imageBase64' field must be a string.");
      return res.status(400).json({
        success: false,
        error: "Field 'imageBase64' must be a valid base64 string.",
        stage: "validation"
      });
    }

    if (language !== undefined && typeof language !== "string") {
      console.warn("[TRIAGE ROUTE] Validation Warning: 'language' field is not a string, defaulting to 'en'.");
    }

    if (age !== undefined && typeof age !== "number" && typeof age !== "string") {
      console.warn("[TRIAGE ROUTE] Validation Warning: 'age' field is invalid type.");
    }

    console.log(`[TRIAGE ROUTE] Step 2: Input Validation Passed. Payload summary:`, {
      hasMessage,
      messagePreview: hasMessage ? message.substring(0, 80) : "N/A",
      hasImage,
      imageLengthChars: hasImage ? imageBase64.length : 0,
      language: language || "en",
      age: age || "N/A",
      hasUserProfile: Boolean(userProfile),
      preferPrivate: Boolean(preferPrivate)
    });

    // 2. Execute Triage Pipeline Engine
    console.log(`[TRIAGE ROUTE] Step 3: Invoking runTriageSymptom service engine...`);
    const triageInput: TriageInput = {
      message: hasMessage ? message : "Photograph of visible symptom submitted for clinical visual assessment.",
      language: typeof language === "string" ? language : "en",
      userProfile: (userProfile && typeof userProfile === "object") ? userProfile : undefined,
      preferPrivate: Boolean(preferPrivate),
      imageBase64: hasImage ? imageBase64 : undefined,
      userId: typeof userId === "string" ? userId : undefined,
      sessionId: typeof sessionId === "string" ? sessionId : undefined
    };

    const result = await runTriageSymptom(triageInput);
    console.log(`[TRIAGE ROUTE] Step 4: Triage engine completed successfully. Severity: ${result.severity}, Escalate: ${result.escalate_immediately}`);

    // 3. User ID & Session Hashing
    const safeUserId = typeof userId === "string" && userId.trim() ? userId : "anon_user_" + Math.random().toString(36).substring(2, 8);
    const userIdHash = generateUserIdHash(safeUserId);
    const safeSessionId = typeof sessionId === "string" && sessionId.trim() ? sessionId : "session_" + Date.now();

    // 4. ASHA Alert Escalation Persistence
    let createdAlert = null;
    if (result.escalate_immediately && !result.is_private_routing) {
      console.log(`[TRIAGE ROUTE] Step 5: Escalation required. Writing ASHA alert to database...`);
      try {
        createdAlert = createAshaAlert({
          sessionId: safeSessionId,
          severity: result.severity === "CRITICAL" ? "CRITICAL" : "HIGH",
          symptomTags: (Array.isArray(result.symptoms) && result.symptoms.length > 0) ? result.symptoms : ["Critical Symptom"],
          userMessage: triageInput.message,
          escalationReason: result.escalation_reason || "Immediate triage escalation required.",
          district: userProfile?.state ? `${userProfile.state} Region` : "Rural District",
          userIdHash
        });
        console.log(`[TRIAGE ROUTE] Step 6: ASHA alert created successfully. Alert ID: ${createdAlert?.id}`);
      } catch (alertErr: any) {
        console.warn("[TRIAGE ROUTE] Warning: Non-fatal error persisting ASHA alert:", alertErr?.message || alertErr);
      }
    } else {
      console.log(`[TRIAGE ROUTE] Step 5: No public ASHA alert dispatched (Escalate: ${result.escalate_immediately}, PrivateRouting: ${result.is_private_routing}).`);
    }

    // 5. Final HTTP Response
    console.log(`[TRIAGE ROUTE] Step 7: Returning successful 200 JSON triage response.`);
    console.log(`==================================================\n`);

    return res.json({
      success: true,
      sessionId: safeSessionId,
      userIdHash,
      result,
      alert: createdAlert
    });

  } catch (err: any) {
    console.error("[TRIAGE ROUTE] Unhandled Error in /api/triageSymptom endpoint:", {
      message: err?.message || String(err),
      name: err?.name,
      stack: err?.stack
    });

    return res.status(500).json({
      success: false,
      error: err?.message || "Internal server error during symptom triage processing.",
      stage: "unhandled_route_exception",
      details: String(err)
    });
  }
});

// Schemes Matcher endpoint
app.post(["/api/matchSchemes", "/matchSchemes"], (req, res) => {
  try {
    const matches = matchSchemes(req.body || {});
    res.json({ success: true, count: matches.length, matches });
  } catch (err: any) {
    console.error("Error in /api/matchSchemes:", err);
    res.status(500).json({ error: "Failed to match schemes." });
  }
});

// Geocode location search endpoint via Nominatim API
app.get(["/api/geocode", "/geocode"], async (req, res) => {
  try {
    const q = req.query.q as string;
    if (!q || !q.trim()) {
      return res.status(400).json({ error: "Missing query parameter 'q'." });
    }

    const queryStr = q.trim();
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(queryStr)}&limit=1`;
    
    const response = await fetch(nominatimUrl, {
      headers: {
        'User-Agent': 'ArogyaSahayakApp/1.0 (health-access-initiative)'
      }
    });

    if (response.ok) {
      const results = await response.json();
      if (Array.isArray(results) && results.length > 0) {
        const match = results[0];
        return res.json({
          success: true,
          lat: parseFloat(match.lat),
          lng: parseFloat(match.lon),
          displayName: match.display_name
        });
      }
    }

    return res.json({ success: false, message: `Location "${queryStr}" not found in OpenStreetMap database.` });
  } catch (err: any) {
    console.error("Error in /api/geocode:", err);
    res.status(500).json({ error: "Geocoding service error." });
  }
});

// PHC Facilities endpoint with OSM Overpass integration
app.get(["/api/phcFacilities", "/phcFacilities"], async (req, res) => {
  try {
    const lat = req.query.lat ? parseFloat(req.query.lat as string) : undefined;
    const lng = req.query.lng ? parseFloat(req.query.lng as string) : undefined;
    const district = req.query.district ? (req.query.district as string) : undefined;

    const result = await getNearestFacilities(lat, lng, district);
    res.json({
      success: true,
      count: result.facilities.length,
      isFallback: result.isFallback,
      source: result.source,
      facilities: result.facilities
    });
  } catch (err: any) {
    console.error("Error in /api/phcFacilities:", err);
    res.status(500).json({ error: "Failed to retrieve PHC facilities." });
  }
});

// ASHA Alerts queue endpoint
app.get(["/api/ashaAlerts", "/ashaAlerts"], async (req, res) => {
  try {
    const alerts = await getAshaAlertsAsync();
    res.json({ success: true, count: alerts.length, alerts });
  } catch (err: any) {
    console.error("Error in /api/ashaAlerts:", err);
    res.status(500).json({ error: "Failed to fetch ASHA alerts." });
  }
});

app.patch(["/api/ashaAlerts/:id", "/ashaAlerts/:id"], async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['pending', 'acknowledged', 'visited'].includes(status)) {
      return res.status(400).json({ error: "Invalid status value." });
    }
    const updated = await updateAshaAlertStatusAsync(id, status);
    if (!updated) {
      return res.status(404).json({ error: "Alert not found." });
    }
    res.json({ success: true, alert: updated });
  } catch (err: any) {
    console.error("Error updating alert status:", err);
    res.status(500).json({ error: "Failed to update alert status." });
  }
});

// Village Health Advisory Generator endpoint
app.post(["/api/generateAdvisory", "/generateAdvisory"], async (req, res) => {
  try {
    const { district, language } = req.body || {};
    const advisory = await generateVillageAdvisory(district || "Pune Rural (Khed Sector)", language || "en");
    res.json({ success: true, advisory });
  } catch (err: any) {
    console.error("Error generating advisory:", err);
    res.status(500).json({ error: "Failed to generate village health advisory." });
  }
});

export default app;
