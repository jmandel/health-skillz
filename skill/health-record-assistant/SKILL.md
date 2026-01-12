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

- User asks about their health records, medical history, test results
- User wants to understand medications, conditions, treatments
- User asks about lab trends or health metrics over time
- User wants to identify care gaps or preventive care needs
- User wants summaries of visits or clinical notes

## API

Base URL: `https://health-skillz.exe.xyz`

### Create Session
```http
POST /api/session

Response: {"sessionId": "...", "userUrl": "...", "pollUrl": "..."}
```

### Poll for Data  
```http
GET /api/poll/{sessionId}

Response (waiting): {"ready": false}
Response (complete): {"ready": true, "data": {...}}
```

## Flow

### 1. Create Session
```javascript
const {sessionId, userUrl, pollUrl} = await fetch(
  'https://health-skillz.exe.xyz/api/session', 
  {method: 'POST'}
).then(r => r.json());
```

### 2. Show Link to User

> **To access your health records, click this link:**
> [Connect Your Health Records](userUrl)
>
> After signing into your patient portal, your records will be securely transferred.

### 3. Poll Until Ready
```javascript
const result = await fetch(pollUrl).then(r => r.json());
if (result.ready) {
  // result.data contains health records
}
```

### 4. Analyze Data

Once ready, `result.data` contains:
- **`data.fhir`** - FHIR resources by type
- **`data.attachments`** - Extracted text from clinical documents

## Working with FHIR Data

### Resource Types
```javascript
data.fhir.Patient           // Demographics
data.fhir.Condition         // Diagnoses  
data.fhir.MedicationRequest // Medications
data.fhir.Observation       // Labs, vitals
data.fhir.Procedure         // Surgeries
data.fhir.Immunization      // Vaccines
data.fhir.AllergyIntolerance// Allergies
data.fhir.Encounter         // Visits
data.fhir.DocumentReference // Documents
```

### Example: Get Lab Values by LOINC Code
```javascript
function getLabsByLoinc(data, loincCode) {
  return data.fhir.Observation?.filter(obs =>
    obs.code?.coding?.some(c => c.code === loincCode)
  ).map(obs => ({
    value: obs.valueQuantity?.value,
    unit: obs.valueQuantity?.unit,
    date: obs.effectiveDateTime,
    interpretation: obs.interpretation?.[0]?.coding?.[0]?.code
  })).sort((a,b) => new Date(b.date) - new Date(a.date));
}

// Common LOINC codes:
// 4548-4  = Hemoglobin A1c
// 2345-7  = Glucose  
// 2093-3  = Total Cholesterol
// 2085-9  = HDL
// 13457-7 = LDL
// 2160-0  = Creatinine
// 8480-6  = Systolic BP
// 8462-4  = Diastolic BP
```

### Example: Active Medications
```javascript
const activeMeds = data.fhir.MedicationRequest
  ?.filter(m => m.status === 'active')
  .map(m => ({
    name: m.medicationCodeableConcept?.coding?.[0]?.display,
    dosage: m.dosageInstruction?.[0]?.text
  }));
```

### Example: Search Clinical Notes
```javascript
function searchNotes(data, term) {
  return data.attachments?.filter(att =>
    att.contentPlaintext?.toLowerCase().includes(term.toLowerCase())
  ).map(att => {
    const text = att.contentPlaintext || '';
    const idx = text.toLowerCase().indexOf(term.toLowerCase());
    return {
      context: text.substring(Math.max(0, idx-150), idx+150),
      docType: att.resourceType
    };
  });
}
```

### Example: Care Gap Check
```javascript
function checkCareGaps(data, patientAge) {
  const gaps = [];
  const now = new Date();
  
  // Colonoscopy (age 45+, every 10 years)
  if (patientAge >= 45) {
    const colonoscopy = data.fhir.Procedure?.find(p =>
      p.code?.coding?.[0]?.display?.toLowerCase().includes('colonoscopy')
    );
    const years = colonoscopy 
      ? (now - new Date(colonoscopy.performedDateTime)) / (365*24*60*60*1000) 
      : Infinity;
    if (years > 10) gaps.push('Colonoscopy may be due');
  }
  
  // Annual flu shot
  const fluShot = data.fhir.Immunization?.find(i =>
    i.vaccineCode?.coding?.[0]?.display?.toLowerCase().includes('influenza') &&
    new Date(i.occurrenceDateTime).getFullYear() === now.getFullYear()
  );
  if (!fluShot) gaps.push('Annual flu shot may be due');
  
  return gaps;
}
```

## Combining Structured + Unstructured Data

The power is combining FHIR resources with clinical note text:

```javascript
// Find if patient has diabetes
const hasDiabetes = data.fhir.Condition?.some(c =>
  c.code?.coding?.[0]?.display?.toLowerCase().includes('diabetes')
);

// Get A1c trend
const a1cTrend = getLabsByLoinc(data, '4548-4');

// Search notes for diabetes management context
const diabetesNotes = searchNotes(data, 'diabetes');

// Now you can provide comprehensive analysis
```

## Guidelines

1. **Empathy**: Health data is personal. Be supportive.
2. **Not Medical Advice**: Remind users to discuss with their provider.
3. **Plain Language**: Translate medical jargon.
4. **Privacy**: Data is temporary, not stored long-term.

## Testing

Epic Sandbox credentials:
- Username: `fhircamila`
- Password: `epicepic1`

See `references/FHIR-GUIDE.md` for complete FHIR reference.
