/**
 * Epic FHIR App Activation Script
 *
 * Activates all "Not responded" organizations for both Non-Production and Production.
 * Paste this into the browser console on the "Manage Keys" page:
 *   https://fhir.epic.com/Developer/Management?id=<YOUR_APP_ID>
 *
 * What it does:
 *   1. Fetches ALL orgs via POST /Developer/LoadDownloads?PageSize=500
 *   2. For each org with Approved === 0 ("Not responded"):
 *      - POST to activate Non-Production
 *      - POST to activate Production
 *   3. For each org with Approved === 3 ("Non-Production only"):
 *      - POST to activate Production only
 *   4. Logs progress to the console
 */
(async function activateAllOrgs() {
  const APP_ID = '50741'; // Health Skillz app ID
  const DELAY_MS = 500;   // Delay between API calls to avoid rate limiting

  // --- Helpers ---
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getCSRFToken() {
    const input = document.querySelector('input[name="__RequestVerificationToken"]');
    if (!input) throw new Error('CSRF token not found on page');
    return input.value;
  }

  async function postAPI(url, body) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'RequestVerificationToken': getCSRFToken()
      },
      body
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (!data.Success) throw new Error(data.Message || 'API returned Success=false');
    return data;
  }

  async function approveDownload(orgId, { nonProdOnly, prodOnly }) {
    return postAPI('/Developer/ApproveDownload', new URLSearchParams({
      OrgId: orgId,
      AppId: APP_ID,
      Testhash: '',
      Testhash256: '',
      Prodhash: '',
      Prodhash256: '',
      NonProdOnly: String(nonProdOnly),
      ProdOnly: String(prodOnly),
      FhirIdGenerationScheme: '',
      OverrideNonProdClientId: '',
      OverrideProdClientId: '',
      TestJWKS: '',
      ProdJWKS: ''
    }).toString());
  }

  // --- Fetch ALL orgs (paginated to handle any count) ---
  console.log('%c[Epic Activator] Fetching all orgs...', 'color: blue; font-weight: bold');
  const PAGE_SIZE = 2000;
  const allOrgs = [];
  let page = 0;
  while (true) {
    const data = await postAPI('/Developer/LoadDownloads', `appId=${APP_ID}&PageSize=${PAGE_SIZE}&page=${page}`);
    const downloads = data.Data.Downloads;
    for (const d of downloads) {
      allOrgs.push({ orgId: d.Id.split('_')[0], orgName: d.OrgName, approved: d.Approved });
    }
    console.log(`[Epic Activator] Fetched page ${page + 1}: ${downloads.length} orgs (${allOrgs.length} total)`);
    if (downloads.length < PAGE_SIZE) break; // Last page
    page++;
  }

  // --- Categorize ---
  const needsBoth = allOrgs.filter(o => o.approved === 0);   // Not responded
  const needsProd = allOrgs.filter(o => o.approved === 3);   // Non-Production only
  const alreadyDone = allOrgs.filter(o => o.approved === 1); // Keys enabled

  console.log(`%c[Epic Activator] Summary:`, 'color: blue; font-weight: bold');
  console.log(`  Total orgs: ${allOrgs.length}`);
  console.log(`  Already enabled: ${alreadyDone.length}`);
  console.log(`  Need Non-Prod + Prod: ${needsBoth.length}`);
  console.log(`  Need Prod only: ${needsProd.length}`);
  console.log(`  Total API calls needed: ${needsBoth.length * 2 + needsProd.length}`);

  if (needsBoth.length === 0 && needsProd.length === 0) {
    console.log('%c[Epic Activator] Nothing to do!', 'color: green; font-weight: bold');
    return;
  }

  // --- Confirmation ---
  const proceed = confirm(
    `Epic Activator will make ${needsBoth.length * 2 + needsProd.length} API calls:\n` +
    `• ${needsBoth.length} orgs: activate Non-Prod + Prod\n` +
    `• ${needsProd.length} orgs: activate Prod only\n` +
    `• ${alreadyDone.length} orgs: already done (skipped)\n\n` +
    `Click OK to proceed, Cancel to abort.`
  );

  if (!proceed) {
    console.log('%c[Epic Activator] Aborted by user.', 'color: red; font-weight: bold');
    return;
  }

  // --- Execute ---
  let successCount = 0;
  let errorCount = 0;
  const errors = [];
  const total = needsBoth.length * 2 + needsProd.length;
  let callIndex = 0;

  for (const org of needsBoth) {
    try {
      callIndex++;
      console.log(`[${callIndex}/${total}] ${org.orgName} (${org.orgId}) — Non-Production...`);
      await approveDownload(org.orgId, { nonProdOnly: true, prodOnly: false });
      successCount++;
      await sleep(DELAY_MS);
    } catch (e) {
      console.error(`  FAILED: ${e.message}`);
      errors.push({ org: org.orgName, orgId: org.orgId, step: 'non-prod', error: e.message });
      errorCount++;
      continue;
    }

    try {
      callIndex++;
      console.log(`[${callIndex}/${total}] ${org.orgName} (${org.orgId}) — Production...`);
      await approveDownload(org.orgId, { nonProdOnly: false, prodOnly: true });
      successCount++;
      await sleep(DELAY_MS);
    } catch (e) {
      console.error(`  FAILED: ${e.message}`);
      errors.push({ org: org.orgName, orgId: org.orgId, step: 'prod', error: e.message });
      errorCount++;
    }
  }

  for (const org of needsProd) {
    try {
      callIndex++;
      console.log(`[${callIndex}/${total}] ${org.orgName} (${org.orgId}) — Production...`);
      await approveDownload(org.orgId, { nonProdOnly: false, prodOnly: true });
      successCount++;
      await sleep(DELAY_MS);
    } catch (e) {
      console.error(`  FAILED: ${e.message}`);
      errors.push({ org: org.orgName, orgId: org.orgId, step: 'prod', error: e.message });
      errorCount++;
    }
  }

  // --- Report ---
  console.log(`%c[Epic Activator] Done!`, 'color: green; font-weight: bold');
  console.log(`  Successful calls: ${successCount}`);
  console.log(`  Failed calls: ${errorCount}`);
  if (errors.length > 0) {
    console.log(`  Errors:`);
    console.table(errors);
  }

  // Refresh the page
  console.log('[Epic Activator] Reloading page...');
  location.reload();
})();
