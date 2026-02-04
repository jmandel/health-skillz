## Data Structure

Each provider file contains:

```typescript
interface ProviderData {
  name: string;           // Provider display name
  fhirBaseUrl: string;    // FHIR server URL
  connectedAt: string;    // ISO timestamp
  fhir: {
    // Common resource types (always check what's available — more may appear)
    Patient?: Patient[];
    Condition?: Condition[];
    Observation?: Observation[];  // Labs, vitals
    MedicationRequest?: MedicationRequest[];
    Procedure?: Procedure[];
    Immunization?: Immunization[];
    AllergyIntolerance?: AllergyIntolerance[];
    Encounter?: Encounter[];
    DiagnosticReport?: DiagnosticReport[];
    DocumentReference?: DocumentReference[];
    CareTeam?: CareTeam[];
    Goal?: Goal[];
    CarePlan?: CarePlan[];
    Coverage?: Coverage[];
    // Other types may also be present (Device, MedicationDispense, etc.)
    [resourceType: string]: any[];
  };
  attachments: Attachment[];
}

interface Attachment {
  resourceType: string;      // Usually "DocumentReference" (rarely "DiagnosticReport")
  resourceId: string;        // FHIR resource ID this came from — multiple attachments may share a resourceId
  contentType: string;       // "text/html", "text/rtf", "application/xml", etc.
  contentPlaintext: string | null;  // Extracted plain text (for text formats)
  contentBase64: string | null;     // Raw content, base64 encoded
}
```

Each provider is a separate slice — no merging, preserves data provenance.
