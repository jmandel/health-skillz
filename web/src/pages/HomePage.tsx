export default function HomePage() {
  return (
    <>
      <div className="hero">
        <h1>🏥 Health Record Skill</h1>
        <p>
          A Skill for analyzing your personal health records using SMART on FHIR
        </p>
      </div>

      <div className="container">
        <div className="card">
          <h2>What is this?</h2>
          <p>
            Health Record Skill is a <strong>Skill</strong> that enables your AI agent to
            securely fetch and analyze your electronic health records directly from your
            healthcare provider's patient portal (like Epic MyChart).
          </p>

          <div className="feature-grid">
            <div className="feature">
              <h4>🔒 Secure & Private</h4>
              <p>Uses SMART on FHIR - the same standard your healthcare apps use.</p>
            </div>
            <div className="feature">
              <h4>📊 Rich Analysis</h4>
              <p>Understand medications, lab trends, conditions, and clinical notes.</p>
            </div>
            <div className="feature">
              <h4>⚡ Easy Setup</h4>
              <p>Install the skill, ask your AI to analyze your records. One-click connection.</p>
            </div>
            <div className="feature">
              <h4>📝 Open Source</h4>
              <p>Fully open source. Inspect, host yourself, or contribute.</p>
            </div>
          </div>
        </div>

        <div className="card">
          <h2>Install the Skill</h2>
          <p>Download and install the skill:</p>
          <div style={{ margin: '24px 0' }}>
            <a href="/skill.zip" className="btn">
              📥 Download Skill (.zip)
            </a>
            <a href="/health-record-assistant.md" className="btn btn-secondary">
              📄 View SKILL.md
            </a>
          </div>
          <p>
            <strong>To install:</strong> Settings → Capabilities → Skills → Upload .zip
          </p>
        </div>

        <div className="card">
          <h2>How It Works</h2>
          <h3>1. Ask Your AI</h3>
          <pre>
            <code>"Can you analyze my health records?"</code>
          </pre>

          <h3>2. Connect Your Records</h3>
          <p>Your AI provides a secure link. Click it, select your provider, sign in.</p>

          <h3>3. Get Insights</h3>
          <ul>
            <li>Current medications and what they're for</li>
            <li>Lab result trends over time</li>
            <li>Conditions explained in plain language</li>
            <li>Preventive care that might be due</li>
            <li>Clinical notes from your visits</li>
          </ul>
        </div>

        <div className="card">
          <h2>Architecture</h2>
          <div className="architecture">
{`User asks AI → AI creates session → User clicks link
    ↓
User signs into patient portal (Epic MyChart, etc.)
    ↓
SMART on FHIR fetches health data
    ↓
Data sent to this server, AI polls until ready
    ↓
AI analyzes: labs, meds, conditions, notes`}
          </div>
        </div>

        <div className="card">
          <h2>For Developers</h2>
          <pre>
            <code>
{`git clone https://github.com/jmandel/health-skillz
cd health-skillz
cp config.json.example config.json
# Edit config.json with your client IDs
bun install
bun run setup
bun run start`}
            </code>
          </pre>

          <h3>API</h3>
          <ul>
            <li>
              <code>POST /api/session</code> - Create session
            </li>
            <li>
              <code>GET /api/poll/{'{id}'}</code> - Poll for data
            </li>
            <li>
              <code>POST /api/data/{'{id}'}</code> - Receive data
            </li>
          </ul>
        </div>

        <div className="card">
          <h2>Testing (Epic Sandbox)</h2>
          <p>
            Username: <code>fhircamila</code> &nbsp; Password: <code>epicepic1</code>
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
