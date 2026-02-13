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

The `attachments` array is the **canonical location** for all attachment content. It contains source-grouped documents extracted from `DocumentReference` and `DiagnosticReport`.

Each entry has:
- `source.resourceId` and `source.resourceType` identifying the parent resource
- `originals[]`, where `originals[index]` maps directly to the source `content[index]` / `presentedForm[index]`
- `bestEffortFrom` (index into `originals[]`)
- `bestEffortPlaintext` (preferred plaintext rendition for LLM use)

**Note:** Inline `attachment.data` is stripped from FHIR resources to avoid duplication. The FHIR resources retain metadata (`attachment.url`, `contentType`, etc.) but the actual content is only in `attachments[]`.

**Critical: attachments can easily overwhelm your context window.** A typical patient has 50-200 attachments totaling 300K+ characters. Loading them all at once will consume most of your context. Always use the index-first approach below.

#### Attachment content types and quality

Most document sources have multiple renditions (often HTML + RTF). Use `bestEffortPlaintext` by default.

### Working with Attachments: Index-First Approach

**Step 1: Build an index (always do this first)**

```javascript
const sources = data.attachments || [];
const index = sources.map(src => {
  const best = (
    typeof src.bestEffortFrom === 'number' &&
    src.bestEffortFrom >= 0 &&
    src.bestEffortFrom < (src.originals?.length || 0)
  ) ? src.originals[src.bestEffortFrom] : null;

  // Find the parent DocumentReference for metadata
  const docRef = data.fhir.DocumentReference?.find(d => d.id === src.source?.resourceId);
  return {
    resourceId: src.source?.resourceId,
    resourceType: src.source?.resourceType,
    bestIndex: src.bestEffortFrom,
    contentType: best?.contentType || 'unknown',
    chars: src.bestEffortPlaintext?.length || 0,
    date: docRef?.date || docRef?.context?.period?.start,
    type: docRef?.type?.coding?.[0]?.display || 'Unknown',
    category: docRef?.category?.[0]?.coding?.[0]?.display,
    preview: (src.bestEffortPlaintext || '').substring(0, 100).replace(/\s+/g, ' ')
  };
});

// Sort by date descending, print summary
index.sort((a, b) => new Date(b.date) - new Date(a.date));
console.log(`${index.length} document sources, ${index.reduce((s, a) => s + a.chars, 0)} total chars`);
index.forEach(a => console.log(`  ${a.date?.substring(0,10)} | ${a.type} | ${a.chars} chars | ${a.preview.substring(0,60)}...`));
```

This index is ~1K tokens — trivial. Use it to decide what to read.

**Step 2: Search across attachments without loading full text**

```javascript
function searchNotes(searchTerm) {
  const sources = data.attachments || [];
  const term = searchTerm.toLowerCase();
  return sources.filter(src =>
    src.bestEffortPlaintext?.toLowerCase().includes(term)
  ).map(src => {
    const text = src.bestEffortPlaintext || '';
    const idx = text.toLowerCase().indexOf(term);
    const start = Math.max(0, idx - 200);
    const end = Math.min(text.length, idx + searchTerm.length + 200);
    const docRef = data.fhir.DocumentReference?.find(d => d.id === src.source?.resourceId);
    return {
      resourceId: src.source?.resourceId,
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
  const source = (data.attachments || []).find(s => s.source?.resourceId === resourceId);
  return source?.bestEffortPlaintext || null;
}
```

#### Data scale awareness

Patient records vary enormously in size — from a single encounter with a few resources to decades of history with hundreds of encounters and thousands of observations. Always check the scale before choosing a strategy:

```javascript
// Quick size check — run this first
const resourceCounts = Object.entries(data.fhir).map(([type, arr]) => [type, arr?.length || 0]).filter(([,n]) => n > 0);
const sources = data.attachments || [];
const totalAttChars = sources.reduce((s, src) => s + (src.bestEffortPlaintext?.length || 0), 0);
console.log('Resources:', Object.fromEntries(resourceCounts));
console.log(`Attachments: ${sources.length} sources, ${totalAttChars} total chars`);
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
