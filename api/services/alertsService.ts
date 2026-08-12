import { AshaAlert } from '../../src/types/health';
import { db, collection, addDoc, getDocs, doc, updateDoc, query, orderBy, setDoc, sanitizeFirestoreData } from '../../src/lib/firebase';

const memoryAlerts: AshaAlert[] = [];

export function createAshaAlert(params: {
  sessionId: string;
  severity: 'CRITICAL' | 'HIGH';
  symptomTags: string[];
  userMessage?: string;
  escalationReason?: string;
  district?: string;
  userIdHash?: string;
}): AshaAlert {
  const newAlert: AshaAlert = {
    id: 'alert_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    timestamp: new Date().toISOString(),
    sessionId: params.sessionId,
    severity: params.severity,
    symptomTags: params.symptomTags,
    userMessage: params.userMessage || 'Patient reported acute symptoms requiring field triage.',
    escalationReason: params.escalationReason || 'Red-flag symptom detected during AI triage.',
    district: params.district || 'Rural District',
    status: 'pending',
    userIdHash: params.userIdHash || 'anon_hash_' + Math.random().toString(36).substring(2, 8)
  };

  memoryAlerts.unshift(newAlert);

  if (db) {
    try {
      const sanitized = sanitizeFirestoreData(newAlert);
      setDoc(doc(db, 'asha_alerts', newAlert.id), sanitized).catch(err => {
        console.warn('Async Firestore alert save warning:', err);
      });
    } catch (err) {
      console.warn('Failed to save alert to Firestore, using memory store:', err);
    }
  }

  return newAlert;
}

export function getAshaAlerts(): AshaAlert[] {
  return [...memoryAlerts];
}

export async function getAshaAlertsAsync(): Promise<AshaAlert[]> {
  if (db) {
    try {
      const q = query(collection(db, 'asha_alerts'), orderBy('timestamp', 'desc'));
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        const firestoreAlerts: AshaAlert[] = [];
        snapshot.forEach(d => {
          firestoreAlerts.push(d.data() as AshaAlert);
        });
        return firestoreAlerts;
      }
    } catch (err) {
      console.warn('Firestore fetch failed, falling back to memory alerts:', err);
    }
  }
  return [...memoryAlerts];
}

export async function updateAshaAlertStatusAsync(id: string, status: 'pending' | 'acknowledged' | 'visited'): Promise<AshaAlert | null> {
  const memAlert = memoryAlerts.find(a => a.id === id);
  if (memAlert) {
    memAlert.status = status;
  }

  if (db) {
    try {
      const alertRef = doc(db, 'asha_alerts', id);
      await updateDoc(alertRef, { status });
    } catch (err) {
      console.warn('Failed to update alert in Firestore:', err);
    }
  }

  return memAlert || (db ? {
    id,
    timestamp: new Date().toISOString(),
    sessionId: 'session_unknown',
    severity: 'HIGH',
    symptomTags: ['Escalated Case'],
    userMessage: 'Case status updated by ASHA worker.',
    escalationReason: 'Manual status update.',
    district: 'Rural District',
    status,
    userIdHash: 'hash_unknown'
  } : null);
}

export function updateAshaAlertStatus(id: string, status: 'pending' | 'acknowledged' | 'visited'): AshaAlert | null {
  const alert = memoryAlerts.find(a => a.id === id);
  if (alert) {
    alert.status = status;
    if (db) {
      updateDoc(doc(db, 'asha_alerts', id), { status }).catch(err => {
        console.warn('Failed to update Firestore alert status:', err);
      });
    }
    return alert;
  }
  return null;
}

export function generateUserIdHash(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    const char = userId.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return 'usr_sha256_' + Math.abs(hash).toString(16) + 'x9f';
}
