---
name: health-record-assistant
description: |
  Connect to and analyze a user's health records from their patient portal via SMART on FHIR.
  Use when the user wants to review medical records, understand lab results, see medications,
  analyze health trends, identify care gaps, or answer questions about personal health data.
---

# Health Record Assistant

Fetch and analyze electronic health records from patient portals using SMART on FHIR.

## When to Use

- User asks about their health records, medical history, or test results
- User wants to understand medications, conditions, or treatments
- User asks about lab trends or health metrics over time
- User wants to identify care gaps or preventive care needs
- User wants summaries of visits or clinical notes

## How to Connect

### Step 1: Create a Session with End-to-End Encryption

Generate an ECDH keypair and create an encrypted session:

```javascript
// Generate keypair for E2E encryption
const keyPair = await crypto.subtle.generateKey(
  { name: 'ECDH', namedCurve: 'P-256' },
  true,  // extractable (need to export public key)
  ['deriveBits', 'deriveKey']
);

// Export public key to send to server
const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

// Create session with public key
const response = await fetch('{{BASE_URL}}/api/session', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ publicKey: publicKeyJwk })
});
const { sessionId, userUrl, pollUrl } = await response.json();

// Store private key for later decryption
const privateKey = keyPair.privateKey;
```

### Step 2: Show the User a Link

Present `userUrl` to the user as a clickable link:

> **To access your health records, please click this link:**
>
> [Connect Your Health Records]({userUrl})
>
> You'll sign into your patient portal (like Epic MyChart), and your records will be securely transferred for analysis.
> 
> 🔒 Your data is end-to-end encrypted - only this conversation can decrypt it.

### Step 3: Poll Until Data is Ready

Use long-polling (server waits up to 30s before returning):

```javascript
const checkForData = async () => {
  const result = await fetch(pollUrl + '?timeout=30').then(r => r.json());
  return result; // { ready: boolean, encryptedProviders?: [...], ... }
};

// Poll until ready
let result;
do {
  result = await checkForData();
  if (!result.ready) {
    // Optionally tell user how many providers connected
    console.log(`Waiting... ${result.providerCount} provider(s) connected`);
  }
} while (!result.ready);
```

While polling, you can ask the user what they'd like to know about their records.

### Step 4: Decrypt and Analyze the Data

Decrypt each provider's data:

```javascript
async function decryptProviderData(encryptedProvider, privateKey) {
  // Import the ephemeral public key from the encrypted package
  const ephemeralPublicKey = await crypto.subtle.importKey(
    'jwk',
    encryptedProvider.ephemeralPublicKey,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  
  // Derive shared secret bits
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: ephemeralPublicKey },
    privateKey,
    256
  );
  
  // Import as AES-GCM key
  const aesKey = await crypto.subtle.importKey(
    'raw',
    sharedSecret,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  
  // Decrypt the data
  const iv = new Uint8Array(encryptedProvider.iv);
  const ciphertext = new Uint8Array(encryptedProvider.ciphertext);
  
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    ciphertext
  );
  
  // Parse the decrypted JSON
  return JSON.parse(new TextDecoder().decode(decrypted));
}

// Decrypt all providers and merge
const decryptedProviders = await Promise.all(
  result.encryptedProviders.map(ep => decryptProviderData(ep, privateKey))
);

// Merge all providers' data
const data = {
  fhir: {},
  attachments: []
};
for (const provider of decryptedProviders) {
  for (const [resourceType, resources] of Object.entries(provider.fhir || {})) {
    if (!data.fhir[resourceType]) data.fhir[resourceType] = [];
    data.fhir[resourceType].push(...resources);
  }
  data.attachments.push(...(provider.attachments || []));
}
```

Once decrypted, the `data` object contains:

```typescript
interface DecryptedData {
  fhir: {
    // Each resource type is an array of FHIR resources
    Patient?: Patient[];
    Condition?: Condition[];
    Observation?: Observation[];
    MedicationRequest?: MedicationRequest[];
    Procedure?: Procedure[];
    Immunization?: Immunization[];
    AllergyIntolerance?: AllergyIntolerance[];
    Encounter?: Encounter[];
    DiagnosticReport?: DiagnosticReport[];
    DocumentReference?: DocumentReference[];
    CareTeam?: CareTeam[];
    Goal?: Goal[];
    // ... other FHIR resource types
  };
  attachments: Attachment[];
}

interface Attachment {
  resourceType: string;       // e.g., "DocumentReference"
  resourceId: string;         // FHIR resource ID
  contentType: string;        // MIME type: "text/html", "text/rtf", "application/pdf"
  contentPlaintext: string;   // Extracted plain text content
  contentBase64?: string;     // Original content base64 encoded (for PDFs, etc.)
}
```

Note: Each resource type is an array, e.g., `data.fhir.Patient[0]` for the first patient resource.

## Working with FHIR Data

### Available Resource Types

```javascript
data.fhir.Patient           // Demographics (name, DOB, contact)
data.fhir.Condition         // Diagnoses and health problems
data.fhir.MedicationRequest // Prescribed medications
data.fhir.Observation       // Lab results, vital signs
data.fhir.Procedure         // Surgeries and procedures
data.fhir.Immunization      // Vaccination records
data.fhir.AllergyIntolerance// Allergies and reactions
data.fhir.Encounter         // Healthcare visits
data.fhir.DocumentReference // Clinical documents
data.fhir.DiagnosticReport  // Lab panels, imaging reports
```

### Example: Get Lab Results by LOINC Code

```javascript
function getLabsByLoinc(loincCode) {
  return data.fhir.Observation?.filter(obs =>
    obs.code?.coding?.some(c => c.code === loincCode)
  ).map(obs => ({
    value: obs.valueQuantity?.value,
    unit: obs.valueQuantity?.unit,
    date: obs.effectiveDateTime,
    flag: obs.interpretation?.[0]?.coding?.[0]?.code // H, L, N
  })).sort((a, b) => new Date(b.date) - new Date(a.date));
}

// Common LOINC codes:
// 4548-4  = Hemoglobin A1c
// 2345-7  = Glucose
// 2093-3  = Total Cholesterol
// 2085-9  = HDL Cholesterol
// 13457-7 = LDL Cholesterol
// 2160-0  = Creatinine
// 8480-6  = Systolic Blood Pressure
// 8462-4  = Diastolic Blood Pressure
// 718-7   = Hemoglobin
// 39156-5 = BMI
```

### Example: List Active Medications

```javascript
const activeMeds = data.fhir.MedicationRequest
  ?.filter(m => m.status === 'active')
  .map(m => ({
    name: m.medicationCodeableConcept?.coding?.[0]?.display,
    dosage: m.dosageInstruction?.[0]?.text,
    prescribedDate: m.authoredOn
  }));
```

### Example: Get Active Conditions

```javascript
const conditions = data.fhir.Condition
  ?.filter(c => c.clinicalStatus?.coding?.[0]?.code === 'active')
  .map(c => ({
    name: c.code?.coding?.[0]?.display,
    onsetDate: c.onsetDateTime
  }));
```

### Example: Search Clinical Notes

The `attachments` array contains extracted text from clinical documents:

```javascript
function searchNotes(searchTerm) {
  return data.attachments?.filter(att =>
    att.contentPlaintext?.toLowerCase().includes(searchTerm.toLowerCase())
  ).map(att => {
    const text = att.contentPlaintext || '';
    const idx = text.toLowerCase().indexOf(searchTerm.toLowerCase());
    const start = Math.max(0, idx - 150);
    const end = Math.min(text.length, idx + searchTerm.length + 150);
    return {
      context: text.substring(start, end),
      docType: att.resourceType
    };
  });
}

// Example: Find mentions of diabetes
const diabetesNotes = searchNotes('diabetes');
```

### Example: Check for Care Gaps

```javascript
function checkCareGaps(patientAge) {
  const gaps = [];
  const now = new Date();
  
  // Colonoscopy (age 45+, every 10 years)
  if (patientAge >= 45) {
    const colonoscopy = data.fhir.Procedure?.find(p =>
      p.code?.coding?.[0]?.display?.toLowerCase().includes('colonoscopy')
    );
    const lastDate = colonoscopy ? new Date(colonoscopy.performedDateTime) : null;
    const yearsSince = lastDate ? (now - lastDate) / (365 * 24 * 60 * 60 * 1000) : Infinity;
    if (yearsSince > 10) {
      gaps.push('Colonoscopy may be due (last: ' + (lastDate?.toLocaleDateString() || 'never') + ')');
    }
  }
  
  // Annual flu shot
  const fluShot = data.fhir.Immunization?.find(i =>
    i.vaccineCode?.coding?.[0]?.display?.toLowerCase().includes('influenza') &&
    new Date(i.occurrenceDateTime).getFullYear() === now.getFullYear()
  );
  if (!fluShot) {
    gaps.push('Annual flu shot may be due');
  }
  
  return gaps;
}
```

### Example: Analyze Lab Trends

```javascript
function analyzeTrend(loincCode, testName) {
  const values = getLabsByLoinc(loincCode);
  if (values.length < 2) return `${testName}: Insufficient data for trend`;
  
  const recent = values[0];
  const previous = values[1];
  const change = ((recent.value - previous.value) / previous.value * 100).toFixed(1);
  
  let trend = 'stable';
  if (change > 5) trend = `increased ${change}%`;
  if (change < -5) trend = `decreased ${Math.abs(change)}%`;
  
  return `${testName}: ${recent.value} ${recent.unit} (${trend} from ${previous.value})`;
}

// Example
analyzeTrend('4548-4', 'A1c');
```

## Combining Structured + Unstructured Data

The power is combining FHIR resources with clinical note text:

```javascript
// 1. Check if patient has diabetes diagnosis
const hasDiabetes = data.fhir.Condition?.some(c =>
  c.code?.coding?.[0]?.display?.toLowerCase().includes('diabetes')
);

// 2. Get A1c trend
const a1cValues = getLabsByLoinc('4548-4');

// 3. Find related medications
const diabetesMeds = data.fhir.MedicationRequest?.filter(m =>
  ['metformin', 'insulin', 'glipizide', 'januvia'].some(drug =>
    m.medicationCodeableConcept?.coding?.[0]?.display?.toLowerCase().includes(drug)
  )
);

// 4. Search notes for management discussions
const managementNotes = searchNotes('diabetes');

// Now provide comprehensive diabetes analysis
```

## Important Guidelines

1. **Be empathetic** - Health data is personal. Be supportive and clear.
2. **Not medical advice** - Always remind users to discuss findings with their healthcare provider.
3. **Use plain language** - Translate medical jargon into understandable terms.
4. **Respect privacy** - Data is temporary and session-based.

## Testing

For testing with Epic's sandbox:
- Username: `fhircamila`
- Password: `epicepic1`


