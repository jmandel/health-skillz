## Working with FHIR Data

### Available Resource Types

```javascript
// Always present
data.fhir.Patient           // Demographics (name, DOB, contact)
data.fhir.Condition         // Diagnoses and health problems
data.fhir.Observation       // Labs, vitals (often the largest array)
data.fhir.MedicationRequest // Prescribed medications
data.fhir.Encounter         // Healthcare visits
data.fhir.DocumentReference // Clinical documents (links to attachments via resource ID)
data.fhir.DiagnosticReport  // Lab panels, imaging reports

// Common
data.fhir.Procedure         // Surgeries and procedures
data.fhir.Immunization      // Vaccination records
data.fhir.AllergyIntolerance// Allergies and reactions
data.fhir.CareTeam          // Care team members
data.fhir.CarePlan          // Care plans
data.fhir.Goal              // Patient goals
data.fhir.Coverage          // Insurance info

// Referenced (fetched automatically when referenced by primary resources)
data.fhir.Practitioner      // Providers
data.fhir.Organization      // Healthcare organizations
data.fhir.Location          // Facility locations
data.fhir.Medication        // Medication details

// Check Object.keys(data.fhir) — additional types may be present
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

### Understanding Attachments

The `attachments` array contains clinical documents extracted from `DocumentReference` resources. Each attachment has `contentPlaintext` (extracted text) and `contentBase64` (raw encoded content).

**Critical: attachments can easily overwhelm your context window.** A typical patient has 50-200 attachments totaling 300K+ characters. Loading them all at once will consume most of your context. Always use the index-first approach below.

#### Attachment content types and quality

Epic typically produces multiple formats per document:
- **`text/html`** — Best quality plaintext. Clean, well-structured. Always prefer this.
- **`text/rtf`** — Same content as HTML but plaintext extraction is worse (formatting artifacts like `SEGOE UI;`, control characters). **Skip RTF when HTML exists for the same `resourceId`.**
- **`application/xml`** — CDA encounter summaries. Large and noisy (tags stripped but words run together). These often duplicate data already in structured `Observation`/`Condition` resources.

#### Deduplication

Most DocumentReferences produce 2 attachments (HTML + RTF pair) sharing the same `resourceId`. Always deduplicate by `resourceId`, preferring `text/html`:

```javascript
// Deduplicate: keep only the best attachment per resourceId
function deduplicateAttachments(attachments) {
  const byResourceId = new Map();
  for (const att of attachments) {
    const existing = byResourceId.get(att.resourceId);
    if (!existing || contentTypePriority(att.contentType) > contentTypePriority(existing.contentType)) {
      byResourceId.set(att.resourceId, att);
    }
  }
  return [...byResourceId.values()];
}

function contentTypePriority(ct) {
  if (ct === 'text/html') return 3;
  if (ct === 'application/xml') return 2;
  if (ct === 'text/rtf') return 1;
  return 0;
}
```

### Working with Attachments: Index-First Approach

**Step 1: Build an index (always do this first)**

```javascript
// Build a compact index of all unique attachments
const uniqueAtts = deduplicateAttachments(data.attachments || []);
const index = uniqueAtts.map(att => {
  // Find the parent DocumentReference for metadata
  const docRef = data.fhir.DocumentReference?.find(d => d.id === att.resourceId);
  return {
    resourceId: att.resourceId,
    contentType: att.contentType,
    chars: att.contentPlaintext?.length || 0,
    date: docRef?.date || docRef?.context?.period?.start,
    type: docRef?.type?.coding?.[0]?.display || 'Unknown',
    category: docRef?.category?.[0]?.coding?.[0]?.display,
    preview: (att.contentPlaintext || '').substring(0, 100).replace(/\s+/g, ' ')
  };
});

// Sort by date descending, print summary
index.sort((a, b) => new Date(b.date) - new Date(a.date));
console.log(`${index.length} unique documents, ${index.reduce((s, a) => s + a.chars, 0)} total chars`);
index.forEach(a => console.log(`  ${a.date?.substring(0,10)} | ${a.type} | ${a.chars} chars | ${a.preview.substring(0,60)}...`));
```

This index is ~1K tokens — trivial. Use it to decide what to read.

**Step 2: Search across attachments without loading full text**

```javascript
function searchNotes(searchTerm) {
  const uniqueAtts = deduplicateAttachments(data.attachments || []);
  const term = searchTerm.toLowerCase();
  return uniqueAtts.filter(att =>
    att.contentPlaintext?.toLowerCase().includes(term)
  ).map(att => {
    const text = att.contentPlaintext || '';
    const idx = text.toLowerCase().indexOf(term);
    const start = Math.max(0, idx - 200);
    const end = Math.min(text.length, idx + searchTerm.length + 200);
    const docRef = data.fhir.DocumentReference?.find(d => d.id === att.resourceId);
    return {
      resourceId: att.resourceId,
      date: docRef?.date,
      type: docRef?.type?.coding?.[0]?.display,
      chars: text.length,
      context: text.substring(start, end)
    };
  });
}
```

This returns ~400-char context windows per match — enough to evaluate relevance without loading full documents.

**Step 3: Read specific documents in full (selectively)**

```javascript
// Only after identifying which documents matter from search/index
function readFullNote(resourceId) {
  // Find best-quality attachment for this resource
  const candidates = (data.attachments || []).filter(a => a.resourceId === resourceId);
  candidates.sort((a, b) => contentTypePriority(b.contentType) - contentTypePriority(a.contentType));
  return candidates[0]?.contentPlaintext || null;
}
```

#### Data scale awareness

Patient records vary enormously in size — from a single encounter with a few resources to decades of history with hundreds of encounters and thousands of observations. Always check the scale before choosing a strategy:

```javascript
// Quick size check — run this first
const resourceCounts = Object.entries(data.fhir).map(([type, arr]) => [type, arr?.length || 0]).filter(([,n]) => n > 0);
const uniqueAtts = deduplicateAttachments(data.attachments || []);
const totalAttChars = uniqueAtts.reduce((s, a) => s + (a.contentPlaintext?.length || 0), 0);
console.log('Resources:', Object.fromEntries(resourceCounts));
console.log(`Attachments: ${uniqueAtts.length} unique, ${totalAttChars} total chars`);
```

- **Small records** (< 50K chars of attachments): You can likely read all notes in a single pass
- **Medium records** (50K-200K chars): Use the index-first approach; read selectively
- **Large records** (200K+ chars): Always search first, read only specific documents relevant to the question

#### When to use structured data vs. attachments

- **Lab values, vitals** → Use `Observation` resources (structured, searchable by LOINC code)
- **Diagnoses** → Use `Condition` resources
- **Medications** → Use `MedicationRequest` resources
- **Clinical narratives, assessments, plans** → Search attachments (this is the unique content not in structured data)
- **Encounter summaries (XML/CDA)** → Usually duplicates structured data; only read if you need the narrative framing

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
