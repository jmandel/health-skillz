export default function HomePage() {
  return (
    <>
      <div className="hero">
        <h1>🏥 Health Record Skill</h1>
        <p>
          Connect your AI to your health records via SMART on FHIR
        </p>
      </div>

      <div className="container">
        <div className="card">
          <h2>What is this?</h2>
          <p>
            Health Record Skill lets your AI agent securely access your electronic health 
            records from your patient portal (like Epic MyChart). You control what you 
            share and what questions you ask.
          </p>

          <div className="feature-grid">
            <div className="feature">
              <h4>🔒 Secure & Private</h4>
              <p>Uses SMART on FHIR — the same standard your healthcare apps use. End-to-end encrypted.</p>
            </div>
            <div className="feature">
              <h4>🏥 Your Data</h4>
              <p>Labs, medications, conditions, clinical notes — whatever your portal has.</p>
            </div>
            <div className="feature">
              <h4>⚡ Easy Setup</h4>
              <p>Install the skill, ask to connect your records, sign in to your portal.</p>
            </div>
            <div className="feature">
              <h4>📝 Open Source</h4>
              <p>Fully open source. <a href="https://github.com/jmandel/health-skillz">View on GitHub</a>.</p>
            </div>
          </div>
        </div>

        <div className="card">
          <h2>Get Started</h2>
          
          <h3>Option 1: Use with AI Agent</h3>
          <p>Download and install the skill, then ask your AI to analyze your records:</p>
          <div style={{ margin: '16px 0' }}>
            <a href="/skill.zip" className="btn">
              📥 Download Skill (.zip)
            </a>
          </div>
          <p style={{ fontSize: '14px', color: '#666' }}>
            <strong>To install:</strong> Settings → Capabilities → Skills → Upload .zip
          </p>
          <p style={{ fontSize: '14px', color: '#666', marginTop: '8px' }}>
            <strong>⚠️ Requires network access:</strong> Your AI agent's sandbox must be able to reach the web.
            For Claude.ai, go to <a href="https://claude.ai/settings/capabilities" target="_blank" rel="noopener">Settings → Capabilities</a> and 
            enable <em>Allow network egress</em> with <em>All domains</em>.
            Other agent platforms have different setups.
          </p>
          
          <hr style={{ margin: '24px 0', border: 'none', borderTop: '1px solid #e0e0e0' }} />
          
          <h3>Option 2: Collect Records First</h3>
          <p>
            Prefer to review your data first? Collect your records locally, then download
            them as a self-contained AI skill package.
          </p>
          <div style={{ margin: '16px 0' }}>
            <a href="/collect" className="btn btn-success">
              📦 Collect My Records
            </a>
          </div>
          <p style={{ fontSize: '14px', color: '#666' }}>
            Your data stays in your browser. Download as JSON or as an AI-ready skill package.
          </p>
        </div>

        <div className="card">
          <h2>How It Works</h2>
          <h3>1. Connect Your Records</h3>
          <p>
            Your AI gives you a secure link to sign into your patient portal. 
            Or <a href="/collect">collect ahead of time</a> and bring the data to any conversation.
          </p>

          <h3>2. Ask Your Questions</h3>
          <pre>
            <code>"Can you find the note from when I went to the ER in March?"</code>
          </pre>
          <p>
            Your AI can search clinical notes, look up labs, list medications — 
            whatever you need from your records.
          </p>
        </div>

      </div>

      <footer>
        <p>
          Built with <a href="https://hl7.org/fhir/smart-app-launch/">SMART on FHIR</a> |{' '}
          <a href="https://agentskills.io">Agent Skills</a> |{' '}
          <a href="https://github.com/jmandel/health-skillz">Source</a>
        </p>
      </footer>
    </>
  );
}
