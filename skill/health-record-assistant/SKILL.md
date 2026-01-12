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

### Step 1: Create a Session

```javascript
const response = await fetch('{{BASE_URL}}/api/session', {
  method: 'POST'
});
const { sessionId, userUrl, pollUrl } = await response.json();
```

### Step 2: Show the User a Link

Present `userUrl` to the user as a clickable link:

> **To access your health records, please click this link:**
>
> [Connect Your Health Records]({userUrl})
>
> You'll sign into your patient portal (like Epic MyChart), and your records will be securely transferred for analysis.

### Step 3: Poll Until Data is Ready

Poll every 5 seconds until `ready` is `true`:

```javascript
const checkForData = async () => {
  const result = await fetch(pollUrl).then(r => r.json());
  return result; // { ready: boolean, data?: {...} }
};
```

While polling, you can ask the user what they'd like to know about their records.

### Step 4: Analyze the Data

Once `ready` is `true`, the `data` object contains:

- **`data.fhir`** - FHIR resources organized by type
- **`data.attachments`** - Extracted text from clinical documents (PDFs, notes)

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

## LOINC Code Quick Reference

| Test | LOINC | Normal Range (typical) |
|------|-------|------------------------|
| Glucose (fasting) | 1558-6 | 70-100 mg/dL |
| Glucose (random) | 2345-7 | 70-140 mg/dL |
| Hemoglobin A1c | 4548-4 | <5.7% |
| Total Cholesterol | 2093-3 | <200 mg/dL |
| HDL | 2085-9 | >40 mg/dL |
| LDL | 13457-7 | <100 mg/dL |
| Triglycerides | 2571-8 | <150 mg/dL |
| Creatinine | 2160-0 | 0.7-1.3 mg/dL |
| BUN | 3094-0 | 7-20 mg/dL |
| eGFR | 33914-3 | >60 mL/min |
| Hemoglobin | 718-7 | 12-17 g/dL |
| WBC | 6690-2 | 4.5-11 K/uL |
| Platelets | 777-3 | 150-400 K/uL |
| TSH | 3016-3 | 0.4-4.0 mIU/L |
| Systolic BP | 8480-6 | <120 mmHg |
| Diastolic BP | 8462-4 | <80 mmHg |
| BMI | 39156-5 | 18.5-24.9 |
