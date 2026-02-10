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
        <h1>Health Skillz</h1>
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
            {showHelp ? '▾' : '▸'} Setup notes for specific AI tools
          </button>
          {showHelp && (
            <div className="help-detail">
              <h4>Claude.ai (web app)</h4>
              <p>
                The sandbox blocks network access by default. Before pasting the message,
                go to <strong>Settings → Profile → Analysis tool</strong> and
                enable <strong>"Allow connections to outside services"</strong>.
                Without this, the skill's scripts will fail with network errors.
              </p>
              <p style={{ marginTop: 6 }}>
                Alternatively, collect records here first, download the <strong>skill zip with
                data bundled in</strong>, and upload it via Settings → Profile → Claude Skills → Add Skill.
                No network access needed for that path.
              </p>

              <h4>Claude Code (CLI)</h4>
              <p>
                Network access is allowed by default. Just paste the message.
                Claude will download the skill, run the scripts, and walk you through it.
                Requires <a href="https://bun.sh" target="_blank" rel="noopener">Bun</a> installed locally.
              </p>

              <h4>Codex CLI</h4>
              <p>
                Same as Claude Code — full shell and network access.
                Paste the message or tell it to read <code>SKILL.md</code> from
                the unzipped skill folder. Requires Bun.
              </p>

              <h4>Any other AI tool</h4>
              <p>
                Three requirements: <strong>1)</strong> your agent can access the web,
                <strong>2)</strong> it can run code or access a local shell
                (to execute the skill's scripts), and <strong>3)</strong> you
                paste in the intro message above. If your AI can't run scripts,
                collect records here and
                {' '}<strong>download a JSON export</strong> to upload directly.
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
