import { Link } from 'react-router-dom';

export default function HomePage() {
  return (
    <div className="page-top">
      <div className="home-header">
        <h1>Health Record Assistant</h1>
        <p>Connect your patient portals, collect your records, and share securely with AI.</p>
      </div>

      <div className="container">
        <div className="card" style={{ textAlign: 'center', marginBottom: 16 }}>
          <Link to="/records" className="btn btn-primary btn-full" style={{ marginBottom: 8 }}>
            My Health Records
          </Link>
          <a href="/skill.zip" className="btn btn-secondary btn-full" download>
            Download AI Skill
          </a>
        </div>

        <div className="card home-section">
          <h2>How it works</h2>
          <ol className="home-steps">
            <li><strong>Collect</strong> — Sign into your patient portal(s) and save records to this browser</li>
            <li><strong>Manage</strong> — Refresh data, add more providers, or download a JSON export</li>
            <li><strong>Share</strong> — When AI sends a session link, pick which records to share (encrypted end-to-end)</li>
          </ol>
        </div>

        <div className="card home-section">
          <h2>Testing</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
            Use Epic’s sandbox: username <code>fhircamila</code> / password <code>epicepic1</code>
          </p>
        </div>
      </div>
    </div>
  );
}
