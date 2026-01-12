/**
 * Simple callback server for OAuth redirects on port 3001.
 * Epic sandbox has localhost:3001/ehr-callback registered.
 * This redirects back to the main server on port 8000.
 */

const MAIN_SERVER = process.env.MAIN_SERVER_URL || 'http://localhost:8000';
const PORT = 3001;

Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);
    
    if (url.pathname === '/ehr-callback') {
      // Redirect to the main server's ehretriever with OAuth params
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
        // Restore the delivery hash from sessionStorage
        let hash = '';
        try {
            const sessionInfo = sessionStorage.getItem('health_skillz_session');
            if (sessionInfo) {
                const { origin } = JSON.parse(sessionInfo);
                if (origin) {
                    hash = '#deliver-to-opener:' + encodeURIComponent(origin);
                }
            }
        } catch (e) {
            console.warn('Could not restore session info:', e);
        }
        // Redirect to main server
        const newUrl = '${MAIN_SERVER}/ehr-connect/ehretriever.html' + '${params}' + hash;
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
console.log(`Redirecting /ehr-callback to ${MAIN_SERVER}`);
