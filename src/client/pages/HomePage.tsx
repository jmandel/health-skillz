import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';

const SKILL_URL = window.location.origin + '/skill.zip';

const AI_MESSAGE = `Please download the Health Record Assistant skill from ${SKILL_URL} and then help me access my health records.`;

export default function HomePage() {
  const [copied, setCopied] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(AI_MESSAGE).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  return (
    <div className="page-top">
      <div className="home-header">
        <h1>Health Record Assistant</h1>
        <p>Connect your patient portals, collect your records, and share securely with AI.</p>
      </div>

      <div className="container">
        {/* Getting Started */}
        <div className="card home-section">
          <h2>Get started</h2>

          <div className="step-row">
            <span className="step-badge">1</span>
            <div className="step-text">
              <strong>Collect your records</strong> — Sign into your patient portal(s) and save
              health data to this browser.
              <div style={{ marginTop: 8 }}>
                <Link to="/records" className="btn btn-primary" style={{ padding: '6px 16px', fontSize: '0.85rem' }}>
                  My Health Records
                </Link>
              </div>
            </div>
          </div>

          <div className="step-row">
            <span className="step-badge">2</span>
            <div className="step-text">
              <strong>Ask your AI for help</strong> — Copy this message and paste it into Claude, ChatGPT, or any AI assistant:
              <div className="copy-box" onClick={handleCopy} style={{ marginTop: 8 }}>
                {AI_MESSAGE}
              </div>
              <div className="copy-box-hint">
                {copied ? '✓ Copied!' : 'Click to copy'}
              </div>
            </div>
          </div>

          <div className="step-row">
            <span className="step-badge">3</span>
            <div className="step-text">
              <strong>Share when asked</strong> — The AI will send you a link. Click it,
              pick which records to share, and they're encrypted end-to-end before sending.
            </div>
          </div>
        </div>

        {/* Setup help */}
        <div className="card home-section">
          <button className="help-toggle" onClick={() => setShowHelp(!showHelp)}>
            {showHelp ? '▾' : '▸'} Setup tips for specific AI tools
          </button>
          {showHelp && (
            <div className="help-detail">
              <h4>Claude.ai</h4>
              <p>
                Before pasting the message, enable network access for the sandbox:
                go to <strong>Settings → Feature previews → Analysis tool</strong> (or similar)
                and turn on <strong>"Allow connections to outside services"</strong>.
                This lets Claude download the skill and create sessions.
              </p>

              <h4>Claude Code / CLI</h4>
              <p>
                The skill works as a set of tool-use scripts. Network access is
                allowed by default. Just paste the message and Claude will handle the rest.
              </p>

              <h4>Other AI tools</h4>
              <p>
                If your AI can't run scripts or access the web, you can still use
                the <Link to="/records">records page</Link> to collect data,
                then <strong>download a JSON export</strong> and upload it to your AI conversation.
              </p>
            </div>
          )}
        </div>

        {/* Testing */}
        <div className="card home-section">
          <h2>Testing</h2>
          <p className="step-text">
            Use Epic's sandbox: username <code>fhircamila</code>, password <code>epicepic1</code>
          </p>
        </div>

        {/* Direct downloads */}
        <div className="card home-section">
          <h2>Direct downloads</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a href="/skill.zip" className="btn btn-secondary" style={{ fontSize: '0.85rem', padding: '6px 14px' }} download>
              Download skill (.zip)
            </a>
            <Link to="/records" className="btn btn-secondary" style={{ fontSize: '0.85rem', padding: '6px 14px' }}>
              Download records (.json)
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
