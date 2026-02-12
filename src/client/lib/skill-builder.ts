// Build a local skill zip in the browser with selected health records bundled in.

import JSZip from 'jszip';
import { getSkillTemplate } from './api';
import { getFhirData, type SavedConnection } from './connections';

/**
 * Build a skill zip containing the local SKILL.md, references, and
 * the user's selected health records in a data/ directory.
 */
export async function buildLocalSkillZip(
  connections: SavedConnection[],
): Promise<Blob> {
  const template = await getSkillTemplate();
  const zip = new JSZip();
  const root = zip.folder('health-record-assistant')!;

  // SKILL.md (local variant — references data/ directory)
  root.file('SKILL.md', template.skillMd);

  // Reference docs
  const refs = root.folder('references')!;
  for (const [name, content] of Object.entries(template.references)) {
    refs.file(name, content);
  }

  // Bundle selected health records into data/
  const dataDir = root.folder('data')!;
  for (const conn of connections) {
    const cached = await getFhirData(conn.id);
    if (!cached) continue;

    const payload = {
      provider: conn.providerName,
      patientDisplayName: conn.patientDisplayName || conn.patientId,
      patientBirthDate: conn.patientBirthDate || null,
      fhir: cached.fhir,
      attachments: cached.attachments,
      fetchedAt: cached.fetchedAt,
    };

    // Sanitise provider name into a safe filename
    const safeName = conn.providerName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    dataDir.file(`${safeName}.json`, JSON.stringify(payload, null, 2));
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
