## Data Structure

Each provider file contains:

```typescript
interface ProviderData {
  name: string;           // Provider display name
  fhirBaseUrl: string;    // FHIR server URL
  connectedAt: string;    // ISO timestamp
  fhir: {
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
  };
  attachments: Attachment[];
}

interface Attachment {
  resourceType: string;      // "DocumentReference" or "DiagnosticReport"
  resourceId: string;        // FHIR resource ID this attachment came from
  contentType: string;       // MIME type: "text/html", "text/rtf", "application/xml", etc.
  contentPlaintext: string | null;  // Extracted plain text (for text formats)
  contentBase64: string | null;     // Raw content, base64 encoded
}
```

Each provider is a separate slice - no merging, preserves data provenance.
