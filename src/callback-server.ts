/**
 * OAuth callback server for local testing on port 3001.
 * Epic sandbox has localhost:3001/ehr-callback registered.
 * Redirects back to the test server on port 8001.
 */

const TEST_SERVER = process.env.TEST_SERVER_URL || 'http://localhost:8001';
const PORT = 3001;

Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);
    
    if (url.pathname === '/ehr-callback') {
      const params = url.search;
      const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Completing authorization...</title>
</head>
<body>
    <p>Completing authorization...</p>
    <script>
        // Restore delivery target from sessionStorage
        let hash = '';
        try {
            const sessionInfo = sessionStorage.getItem('health_skillz_session');
            if (sessionInfo) {
                hash = '#deliver-to:health-skillz';
            }
        } catch (e) {
            console.warn('Could not restore session info:', e);
        }
        const newUrl = '${TEST_SERVER}/ehr-connect/ehretriever.html' + '${params}' + hash;
        window.location.replace(newUrl);
    </script>
</body>
</html>`;
      return new Response(html, { headers: { 'Content-Type': 'text/html' } });
    }
    
    return new Response('Not found', { status: 404 });
  },
});

console.log(`OAuth callback server running on http://localhost:${PORT}`);
console.log(`Redirecting /ehr-callback to ${TEST_SERVER}`);
