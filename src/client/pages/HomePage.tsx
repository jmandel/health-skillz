import { Link } from 'react-router-dom';

export default function HomePage() {
  return (
    <>
      <div className="hero">
        <h1>🏥 Health Record Skill</h1>
        <p>Connect your AI to your health records via SMART on FHIR</p>
      </div>

      <div className="container">
        <div className="card" style={{ textAlign: 'center' }}>
          <h2 style={{ marginBottom: '0.5rem' }}>Manage Your Records</h2>
          <p style={{ color: '#6b7280', marginBottom: '1rem' }}>
            Connect to patient portals, collect your health data, and share it
            with AI assistants — all from your browser.
          </p>
          <Link to="/records" className="btn" style={{ display: 'inline-block', marginBottom: '0.5rem' }}>
            📦 My Health Records
          </Link>
          <br />
          <a href="/skill.zip" className="btn btn-secondary" style={{ display: 'inline-block' }} download>
            🤖 Download AI Skill
          </a>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: '0.5rem' }}>How It Works</h3>
          <ol style={{ paddingLeft: '1.2rem', color: '#374151', lineHeight: 1.8 }}>
            <li><strong>Collect</strong> — Sign into your patient portal(s) and save your records to this browser</li>
            <li><strong>Manage</strong> — Refresh data anytime, add more providers, download a JSON export</li>
            <li><strong>Share</strong> — When your AI sends a session link, pick which records to share (encrypted end-to-end)</li>
          </ol>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: '0.5rem' }}>For Testing</h3>
          <p style={{ color: '#6b7280', fontSize: '0.9rem' }}>
            Use Epic's sandbox with username <code>fhircamila</code> / password <code>epicepic1</code>
          </p>
        </div>
      </div>
    </>
  );
}
