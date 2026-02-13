export default function SiteFooter() {
  return (
    <footer className="site-footer" role="contentinfo">
      <div className="container">
        <div className="footer-links">
          <a href="https://github.com/jmandel/health-skillz" target="_blank" rel="noopener">
            GitHub
          </a>
          <span className="footer-sep">·</span>
          <a href="https://github.com/jmandel/health-skillz/issues" target="_blank" rel="noopener">
            Report an issue
          </a>
          <span className="footer-sep">·</span>
          <a href="https://github.com/jmandel/health-skillz#readme" target="_blank" rel="noopener">
            Documentation
          </a>
        </div>
        <p className="footer-note">
          Your health data never leaves your browser unencrypted.{' '}
          <a href="https://github.com/jmandel/health-skillz/blob/main/docs/design/DESIGN.md" target="_blank" rel="noopener">
            Learn how it works
          </a>.
        </p>
      </div>
    </footer>
  );
}
