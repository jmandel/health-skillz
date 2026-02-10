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
    DocumentReference?: DocumentReference[];  // Note: attachment.data stripped, see attachments[]
    CareTeam?: CareTeam[];
    Goal?: Goal[];
    CarePlan?: CarePlan[];
    Coverage?: Coverage[];
    // Other types may also be present (Device, MedicationDispense, etc.)
    [resourceType: string]: any[];
  };
  attachments: Attachment[];  // Canonical location for all attachment content
}

interface Attachment {
  resourceType: string;      // Usually "DocumentReference" (rarely "DiagnosticReport")
  resourceId: string;        // FHIR resource ID this came from
  contentIndex: number;      // Index in resource's content array (0-based) — a DocRef may have multiple
  contentType: string;       // "text/html", "text/rtf", "application/xml", etc.
  contentPlaintext: string | null;  // Extracted plain text (for text formats)
  contentBase64: string | null;     // Raw content, base64 encoded
}
```

**Important:** Attachment content is stored ONLY in the `attachments[]` array. Inline `attachment.data` 
is stripped from FHIR resources (DocumentReference, DiagnosticReport) to avoid duplication. The FHIR 
resources retain `attachment.url` and metadata but not the raw content. To find attachment content:
1. Look up the attachment in `attachments[]` by `resourceId`
2. Use `contentPlaintext` for text, `contentBase64` for binary

Each provider is a separate slice — no merging, preserves data provenance.
