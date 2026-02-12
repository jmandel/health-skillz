/**
 * Epic FHIR App Activation Script
 *
 * Activates all pending organizations for both Non-Production and Production.
 * Paste this into the browser console on the "Manage Keys" page:
 *   https://fhir.epic.com/Developer/Management?id=<YOUR_APP_ID>
 *
 * Two modes:
 *   - "JWK Set URL" (default): tells Epic to fetch keys from your app-level JWK Set URL.
 *     This is Epic's "Recommended" option but fails at orgs whose servers block outbound
 *     requests to your JWKS endpoint.
 *   - "Direct JWKS": fetches your JWKS, filters to RSA keys only, and uploads the key
 *     material directly. Works everywhere, including orgs with restrictive outbound policies.
 *     In this mode, both nonprod and prod are activated in a single API call per org.
 *
 * What it does:
 *   1. Prompts for mode (JWK Set URL vs Direct JWKS)
 *   2. Fetches ALL orgs via POST /Developer/LoadDownloads?PageSize=2000
 *   3. For each org needing activation, POSTs to /Developer/ApproveDownload
 *   4. Logs progress to the console AND to sessionStorage (survives page reloads)
 *
 * After a reload, paste this script again to see the previous run's results.
 */
(async function activateAllOrgs() {
  const APP_ID = '50741'; // Health Skillz app ID
  const JWKS_URL = 'https://health-skillz.joshuamandel.com/.well-known/jwks.json';
  const DELAY_MS = 500;   // Delay between API calls to avoid rate limiting
  const LOG_KEY = 'epicActivatorLog';

  // --- Persistent logging ---
  const logLines = [];

  function log(msg, style) {
    logLines.push({ time: new Date().toISOString(), msg });
    sessionStorage.setItem(LOG_KEY, JSON.stringify(logLines));
    if (style) {
      console.log(`%c${msg}`, style);
    } else {
      console.log(msg);
    }
  }

  function logError(msg) {
    logLines.push({ time: new Date().toISOString(), msg, error: true });
    sessionStorage.setItem(LOG_KEY, JSON.stringify(logLines));
    console.error(msg);
  }

  // --- Check for previous run results ---
  const prev = sessionStorage.getItem(LOG_KEY);
  if (prev) {
    try {
      const prevLines = JSON.parse(prev);
      console.log('%c[Epic Activator] Previous run log found (' + prevLines.length + ' entries):', 'color: purple; font-weight: bold');
      for (const line of prevLines) {
        const prefix = line.time.split('T')[1].split('.')[0];
        if (line.error) {
          console.error(`  [${prefix}] ${line.msg}`);
        } else {
          console.log(`  [${prefix}] ${line.msg}`);
        }
      }
      console.log('%c[Epic Activator] End of previous run log. Starting new run...', 'color: purple; font-weight: bold');
    } catch (e) { /* ignore parse errors */ }
  }

  sessionStorage.removeItem(LOG_KEY);

  // --- Mode selection ---
  const mode = prompt(
    'Select activation mode:\n\n' +
    '1 = JWK Set URL (Epic\'s "Recommended" — but fails at orgs that block outbound requests)\n' +
    '2 = Direct JWKS upload (works everywhere — uploads RSA keys directly)\n\n' +
    'Enter 1 or 2:',
    '2'
  );

  if (mode !== '1' && mode !== '2') {
    log('[Epic Activator] Aborted — invalid mode selection.', 'color: red; font-weight: bold');
    return;
  }

  const useDirectJWKS = mode === '2';
  let rsaJwks = '';

  if (useDirectJWKS) {
    log(`[Epic Activator] Fetching JWKS from ${JWKS_URL}...`, 'color: blue; font-weight: bold');
    const jwksResp = await fetch(JWKS_URL);
    const jwks = await jwksResp.json();
    const rsaKeys = jwks.keys.filter(k => k.kty === 'RSA');
    if (rsaKeys.length === 0) {
      log('[Epic Activator] No RSA keys found in JWKS! Aborting.', 'color: red; font-weight: bold');
      return;
    }
    rsaJwks = JSON.stringify({ keys: rsaKeys });
    log(`[Epic Activator] Mode: Direct JWKS (${rsaKeys.length} RSA keys, filtered from ${jwks.keys.length} total)`);
    log(`[Epic Activator] Algorithms: ${rsaKeys.map(k => k.alg || 'unspecified').join(', ')}`);
  } else {
    log('[Epic Activator] Mode: JWK Set URL (app-level)');
  }

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
    const data = await postAPI('/Developer/ApproveDownload', new URLSearchParams({
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
      TestJWKS: useDirectJWKS ? rsaJwks : '',
      ProdJWKS: useDirectJWKS ? rsaJwks : ''
    }).toString());
    if (!data.Data.Success) throw new Error(data.Data.Message || 'Inner Success=false');
    return data;
  }

  // --- Fetch ALL orgs (paginated to handle any count) ---
  log('[Epic Activator] Fetching all orgs...', 'color: blue; font-weight: bold');
  const PAGE_SIZE = 2000;
  const allOrgs = [];
  let page = 0;
  while (true) {
    const data = await postAPI('/Developer/LoadDownloads', `appId=${APP_ID}&PageSize=${PAGE_SIZE}&page=${page}`);
    const downloads = data.Data.Downloads;
    for (const d of downloads) {
      allOrgs.push({ orgId: d.Id.split('_')[0], orgName: d.OrgName, approved: d.Approved });
    }
    log(`[Epic Activator] Fetched page ${page + 1}: ${downloads.length} orgs (${allOrgs.length} total)`);
    if (downloads.length < PAGE_SIZE) break; // Last page
    page++;
  }

  // --- Categorize ---
  const needsBoth = allOrgs.filter(o => o.approved === 0);   // Not responded
  const needsProd = allOrgs.filter(o => o.approved === 3);   // Non-Production only
  const alreadyDone = allOrgs.filter(o => o.approved === 1); // Keys enabled

  // In direct JWKS mode, we can do both envs in one call
  const callsForBoth = useDirectJWKS ? needsBoth.length : needsBoth.length * 2;
  const totalCalls = callsForBoth + needsProd.length;

  log('[Epic Activator] Summary:', 'color: blue; font-weight: bold');
  log(`  Total orgs: ${allOrgs.length}`);
  log(`  Already enabled: ${alreadyDone.length}`);
  log(`  Need Non-Prod + Prod: ${needsBoth.length}`);
  log(`  Need Prod only: ${needsProd.length}`);
  log(`  Total API calls needed: ${totalCalls}${useDirectJWKS ? ' (single call per org in direct JWKS mode)' : ''}`);

  if (needsBoth.length === 0 && needsProd.length === 0) {
    log('[Epic Activator] Nothing to do!', 'color: green; font-weight: bold');
    return;
  }

  // --- Confirmation ---
  const proceed = confirm(
    `Epic Activator will make ${totalCalls} API calls:\n` +
    `• ${needsBoth.length} orgs: activate Non-Prod + Prod${useDirectJWKS ? ' (1 call each, direct JWKS)' : ' (2 calls each)'}\n` +
    `• ${needsProd.length} orgs: activate Prod only\n` +
    `• ${alreadyDone.length} orgs: already done (skipped)\n\n` +
    `Mode: ${useDirectJWKS ? 'Direct JWKS upload' : 'JWK Set URL'}\n\n` +
    `Click OK to proceed, Cancel to abort.`
  );

  if (!proceed) {
    log('[Epic Activator] Aborted by user.', 'color: red; font-weight: bold');
    return;
  }

  // --- Execute ---
  let successCount = 0;
  let errorCount = 0;
  const errors = [];
  let callIndex = 0;

  for (const org of needsBoth) {
    if (useDirectJWKS) {
      // Single call activates both nonprod and prod with inline JWKS
      try {
        callIndex++;
        log(`[${callIndex}/${totalCalls}] ${org.orgName} (${org.orgId}) — Non-Prod + Prod...`);
        await approveDownload(org.orgId, { nonProdOnly: false, prodOnly: false });
        successCount++;
        await sleep(DELAY_MS);
      } catch (e) {
        logError(`  FAILED: ${org.orgName} (${org.orgId}): ${e.message}`);
        errors.push({ org: org.orgName, orgId: org.orgId, step: 'both', error: e.message });
        errorCount++;
      }
    } else {
      // Two separate calls: nonprod then prod
      try {
        callIndex++;
        log(`[${callIndex}/${totalCalls}] ${org.orgName} (${org.orgId}) — Non-Production...`);
        await approveDownload(org.orgId, { nonProdOnly: true, prodOnly: false });
        successCount++;
        await sleep(DELAY_MS);
      } catch (e) {
        logError(`  FAILED: ${org.orgName} (${org.orgId}) non-prod: ${e.message}`);
        errors.push({ org: org.orgName, orgId: org.orgId, step: 'non-prod', error: e.message });
        errorCount++;
        continue;
      }

      try {
        callIndex++;
        log(`[${callIndex}/${totalCalls}] ${org.orgName} (${org.orgId}) — Production...`);
        await approveDownload(org.orgId, { nonProdOnly: false, prodOnly: true });
        successCount++;
        await sleep(DELAY_MS);
      } catch (e) {
        logError(`  FAILED: ${org.orgName} (${org.orgId}) prod: ${e.message}`);
        errors.push({ org: org.orgName, orgId: org.orgId, step: 'prod', error: e.message });
        errorCount++;
      }
    }
  }

  for (const org of needsProd) {
    try {
      callIndex++;
      log(`[${callIndex}/${totalCalls}] ${org.orgName} (${org.orgId}) — Production...`);
      await approveDownload(org.orgId, { nonProdOnly: false, prodOnly: true });
      successCount++;
      await sleep(DELAY_MS);
    } catch (e) {
      logError(`  FAILED: ${org.orgName} (${org.orgId}) prod: ${e.message}`);
      errors.push({ org: org.orgName, orgId: org.orgId, step: 'prod', error: e.message });
      errorCount++;
    }
  }

  // --- Report ---
  log(`[Epic Activator] Done!`, 'color: green; font-weight: bold');
  log(`  Successful calls: ${successCount}`);
  log(`  Failed calls: ${errorCount}`);
  if (errors.length > 0) {
    log(`  Failed orgs: ${errors.map(e => `${e.org} (${e.step})`).join(', ')}`);
    console.table(errors);
  }

  log('[Epic Activator] Reloading page in 3s... (paste script again after reload to see this log)');
  await sleep(3000);
  location.reload();
})();
