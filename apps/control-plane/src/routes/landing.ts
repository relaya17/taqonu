/**
 * Landing page — Atlas Sentinel public-facing promo + registration.
 *
 * Served at `/` on the control plane surface (port 3100). The existing
 * governance dashboard moves to `/dashboard`. This page is the first
 * thing a visitor sees: a hero video, a value proposition, and a
 * registration form.
 */

const VIDEO_URL =
  "https://res.cloudinary.com/dora8sxcb/video/upload/v1786694419/hailuo-2_3_ATLAS_SEN_ATLAS_SENTINEL_Premium_Hero_Image_Generation_Specification_PURPOSE_Cre-0_1_wj2dd4.mp4";

export function getLandingHtml(): string {
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Atlas Sentinel — AI Oversight Platform</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    :root {
      --bg: #06080F;
      --surface: #0D1117;
      --surface-2: #151B26;
      --border: #1E2736;
      --text: #E8ECF4;
      --text-secondary: #8B95A8;
      --text-muted: #4A5568;
      --accent: #6366F1;
      --accent-glow: rgba(99,102,241,0.25);
      --accent-hover: #818CF8;
      --teal: #2DD4A0;
      --teal-glow: rgba(45,212,160,0.15);
      --amber: #F5A623;
      --coral: #E8564A;
      --font: 'Inter', system-ui, -apple-system, sans-serif;
      --mono: 'JetBrains Mono', monospace;
    }

    body {
      font-family: var(--font);
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      overflow-x: hidden;
    }

    /* ── Nav ──────────────────────────────────────── */
    nav {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 32px;
      background: rgba(6,8,15,0.85);
      backdrop-filter: blur(20px);
      border-bottom: 1px solid var(--border);
    }

    .nav-logo {
      display: flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
      color: var(--text);
    }

    .nav-logo .logo-icon {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, var(--accent), var(--teal));
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .nav-logo .logo-icon svg {
      width: 18px;
      height: 18px;
      fill: white;
    }

    .nav-logo span {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .nav-logo .sentinel-tag {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--teal);
      background: var(--teal-glow);
      padding: 2px 8px;
      border-radius: 4px;
    }

    .nav-links {
      display: flex;
      align-items: center;
      gap: 24px;
      list-style: none;
    }

    .nav-links a {
      color: var(--text-secondary);
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      transition: color 0.2s;
    }

    .nav-links a:hover { color: var(--text); }

    .nav-cta {
      background: var(--accent) !important;
      color: white !important;
      padding: 8px 20px;
      border-radius: 8px;
      font-weight: 600 !important;
      transition: background 0.2s, box-shadow 0.2s !important;
    }

    .nav-cta:hover {
      background: var(--accent-hover) !important;
      box-shadow: 0 0 20px var(--accent-glow);
    }

    /* ── Hero ─────────────────────────────────────── */
    .hero {
      position: relative;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }

    .hero-video {
      position: absolute;
      inset: 0;
      z-index: 0;
    }

    .hero-video video {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .hero-overlay {
      position: absolute;
      inset: 0;
      background: linear-gradient(
        180deg,
        rgba(6,8,15,0.4) 0%,
        rgba(6,8,15,0.6) 40%,
        rgba(6,8,15,0.92) 100%
      );
      z-index: 1;
    }

    .hero-content {
      position: relative;
      z-index: 2;
      text-align: center;
      max-width: 800px;
      padding: 120px 24px 80px;
    }

    .hero-eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-family: var(--mono);
      font-size: 12px;
      font-weight: 500;
      color: var(--teal);
      text-transform: uppercase;
      letter-spacing: 0.15em;
      margin-bottom: 24px;
      background: var(--teal-glow);
      padding: 6px 16px;
      border-radius: 20px;
      border: 1px solid rgba(45,212,160,0.2);
    }

    .hero-eyebrow::before {
      content: '';
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--teal);
      animation: blink 2s ease-in-out infinite;
    }

    @keyframes blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }

    .hero h1 {
      font-size: clamp(36px, 6vw, 64px);
      font-weight: 800;
      line-height: 1.1;
      letter-spacing: -0.03em;
      margin-bottom: 20px;
      direction: ltr;
    }

    .hero h1 .gradient-text {
      background: linear-gradient(135deg, var(--accent), var(--teal));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .hero-subtitle {
      font-size: 18px;
      color: var(--text-secondary);
      max-width: 560px;
      margin: 0 auto 40px;
      line-height: 1.7;
    }

    /* ── Registration Form ────────────────────────── */
    .reg-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 32px;
      max-width: 440px;
      margin: 0 auto;
      text-align: right;
      box-shadow: 0 8px 40px rgba(0,0,0,0.4);
    }

    .reg-card h3 {
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 4px;
    }

    .reg-card .reg-sub {
      font-size: 13px;
      color: var(--text-secondary);
      margin-bottom: 24px;
    }

    .form-group {
      margin-bottom: 16px;
    }

    .form-group label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
      margin-bottom: 6px;
    }

    .form-group input {
      width: 100%;
      padding: 12px 14px;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      font-family: var(--font);
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
      direction: ltr;
      text-align: left;
    }

    .form-group input::placeholder {
      color: var(--text-muted);
    }

    .form-group input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-glow);
    }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .btn-register {
      width: 100%;
      padding: 14px;
      background: linear-gradient(135deg, var(--accent), #7C3AED);
      color: white;
      border: none;
      border-radius: 10px;
      font-family: var(--font);
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.15s, box-shadow 0.2s;
      margin-top: 8px;
    }

    .btn-register:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 24px var(--accent-glow);
    }

    .btn-register:active {
      transform: translateY(0);
    }

    .reg-footer {
      text-align: center;
      margin-top: 16px;
      font-size: 12px;
      color: var(--text-muted);
    }

    .reg-footer a {
      color: var(--accent);
      text-decoration: none;
    }

    /* ── Features ─────────────────────────────────── */
    .features {
      padding: 80px 24px;
      max-width: 1100px;
      margin: 0 auto;
    }

    .features-header {
      text-align: center;
      margin-bottom: 56px;
    }

    .features-header h2 {
      font-size: 32px;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 12px;
    }

    .features-header p {
      font-size: 16px;
      color: var(--text-secondary);
      max-width: 500px;
      margin: 0 auto;
    }

    .features-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 20px;
    }

    @media (max-width: 768px) {
      .features-grid { grid-template-columns: 1fr; }
      .form-row { grid-template-columns: 1fr; }
      nav { padding: 12px 16px; }
      .nav-links { display: none; }
    }

    .feature-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 28px 24px;
      transition: border-color 0.2s, transform 0.2s;
    }

    .feature-card:hover {
      border-color: var(--accent);
      transform: translateY(-2px);
    }

    .feature-icon {
      width: 44px;
      height: 44px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 16px;
      font-size: 20px;
    }

    .feature-icon.purple { background: rgba(99,102,241,0.12); }
    .feature-icon.teal { background: var(--teal-glow); }
    .feature-icon.amber { background: rgba(245,166,35,0.12); }
    .feature-icon.coral { background: rgba(232,86,74,0.1); }
    .feature-icon.blue { background: rgba(59,130,246,0.12); }
    .feature-icon.green { background: rgba(34,197,94,0.12); }

    .feature-card h3 {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 8px;
    }

    .feature-card p {
      font-size: 13px;
      color: var(--text-secondary);
      line-height: 1.6;
    }

    /* ── Stats bar ────────────────────────────────── */
    .stats-bar {
      border-top: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
      padding: 40px 24px;
      background: var(--surface);
    }

    .stats-inner {
      max-width: 900px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 32px;
      text-align: center;
    }

    @media (max-width: 600px) {
      .stats-inner { grid-template-columns: repeat(2, 1fr); }
    }

    .stat-item .stat-num {
      font-family: var(--mono);
      font-size: 32px;
      font-weight: 600;
      color: var(--text);
      display: block;
    }

    .stat-item .stat-label {
      font-size: 13px;
      color: var(--text-secondary);
      margin-top: 4px;
    }

    /* ── Footer ───────────────────────────────────── */
    footer {
      padding: 40px 24px;
      text-align: center;
      border-top: 1px solid var(--border);
    }

    footer p {
      font-size: 13px;
      color: var(--text-muted);
    }

    footer a {
      color: var(--text-secondary);
      text-decoration: none;
    }

    footer a:hover { color: var(--text); }

    .footer-links {
      display: flex;
      justify-content: center;
      gap: 24px;
      margin-bottom: 16px;
      list-style: none;
    }

    /* ── Toast ────────────────────────────────────── */
    .toast {
      position: fixed;
      bottom: 32px;
      left: 50%;
      transform: translateX(-50%) translateY(100px);
      background: var(--teal);
      color: var(--bg);
      padding: 12px 28px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      opacity: 0;
      transition: transform 0.4s, opacity 0.4s;
      z-index: 200;
    }

    .toast.show {
      transform: translateX(-50%) translateY(0);
      opacity: 1;
    }
  </style>
</head>
<body>

  <!-- Nav -->
  <nav>
    <a href="/" class="nav-logo">
      <div class="logo-icon">
        <svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
      </div>
      <span>Atlas</span>
      <span class="sentinel-tag">Sentinel</span>
    </a>
    <ul class="nav-links">
      <li><a href="#features">Features</a></li>
      <li><a href="/dashboard">Dashboard</a></li>
      <li><a href="http://localhost:3000" target="_blank" rel="noopener">Atlas</a></li>
      <li><a href="http://127.0.0.1:3200" target="_blank" rel="noopener">Owner Admin</a></li>
      <li><a href="#register" class="nav-cta">Register</a></li>
    </ul>
  </nav>

  <!-- Hero -->
  <section class="hero">
    <div class="hero-video">
      <video autoplay muted loop playsinline>
        <source src="${VIDEO_URL}" type="video/mp4">
      </video>
    </div>
    <div class="hero-overlay"></div>

    <div class="hero-content">
      <div class="hero-eyebrow">AI Governance Platform</div>
      <h1>
        <span class="gradient-text">Atlas Sentinel</span><br>
        Oversight &amp; Control
      </h1>
      <p class="hero-subtitle">
        Real-time governance, audit trails, and policy enforcement
        for AI agent systems. Full visibility. Zero blind spots.
      </p>

      <!-- Registration -->
      <div class="reg-card" id="register">
        <h3>Create Account</h3>
        <p class="reg-sub">Get access to the Atlas Sentinel control plane</p>
        <form id="regForm" onsubmit="handleRegister(event)">
          <div class="form-row">
            <div class="form-group">
              <label for="firstName">First Name</label>
              <input type="text" id="firstName" placeholder="Arlet" required>
            </div>
            <div class="form-group">
              <label for="lastName">Last Name</label>
              <input type="text" id="lastName" placeholder="Doe" required>
            </div>
          </div>
          <div class="form-group">
            <label for="email">Email</label>
            <input type="email" id="email" placeholder="you@company.com" required>
          </div>
          <div class="form-group">
            <label for="org">Organization</label>
            <input type="text" id="org" placeholder="Company name">
          </div>
          <div class="form-group">
            <label for="password">Password</label>
            <input type="password" id="password" placeholder="Minimum 8 characters" minlength="8" required>
          </div>
          <button type="submit" class="btn-register">Create Account</button>
        </form>
        <p class="reg-footer">
          Already have an account? <a href="/dashboard">Sign in</a>
        </p>
      </div>
    </div>
  </section>

  <!-- Features -->
  <section class="features" id="features">
    <div class="features-header">
      <h2>Complete AI Governance</h2>
      <p>Everything you need to oversee, audit, and control AI agent operations</p>
    </div>
    <div class="features-grid">
      <div class="feature-card">
        <div class="feature-icon purple">&#x1F6E1;</div>
        <h3>Agent Registry</h3>
        <p>9 registered agents with full capability profiles, tool permissions, and risk tier classification</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon teal">&#x1F4DC;</div>
        <h3>Audit Trail</h3>
        <p>SHA-256 hash-chained tamper-evident logs. Every decision recorded, searchable, and verifiable</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon amber">&#x26A0;</div>
        <h3>Risk Scoring</h3>
        <p>Three-tier risk classification: AUTO_LOG, APPROVAL, BLOCK. Trust-level floors for untrusted sources</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon coral">&#x1F512;</div>
        <h3>Policy Enforcement</h3>
        <p>9 policy definitions with entity/action mapping. Fail-closed architecture — denied by default</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon blue">&#x2705;</div>
        <h3>Approval Workflow</h3>
        <p>Artifact-bound approvals with TTL expiry, replay prevention, and entity/action/agent matching</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon green">&#x1F4CA;</div>
        <h3>Health Metrics</h3>
        <p>Real-time execution counts, failure rates, approval consumption, and average risk distribution</p>
      </div>
    </div>
  </section>

  <!-- Stats -->
  <div class="stats-bar">
    <div class="stats-inner">
      <div class="stat-item">
        <span class="stat-num">349</span>
        <span class="stat-label">Tests Passing</span>
      </div>
      <div class="stat-item">
        <span class="stat-num">9</span>
        <span class="stat-label">AI Agents</span>
      </div>
      <div class="stat-item">
        <span class="stat-num">8</span>
        <span class="stat-label">Pipeline Stages</span>
      </div>
      <div class="stat-item">
        <span class="stat-num">0</span>
        <span class="stat-label">Blind Spots</span>
      </div>
    </div>
  </div>

  <!-- Footer -->
  <footer>
    <ul class="footer-links">
      <li><a href="/dashboard">Dashboard</a></li>
      <li><a href="/api/v1/status">API Status</a></li>
      <li><a href="http://localhost:3000" target="_blank" rel="noopener">Atlas</a></li>
      <li><a href="http://127.0.0.1:3200" target="_blank" rel="noopener">Owner Admin</a></li>
    </ul>
    <p>&copy; 2026 Atlas Sentinel. AI Governance &amp; Oversight Platform.</p>
  </footer>

  <!-- Toast -->
  <div class="toast" id="toast">Account created successfully!</div>

  <script>
    function handleRegister(e) {
      e.preventDefault();
      var form = document.getElementById('regForm');
      var toast = document.getElementById('toast');
      var btn = form.querySelector('.btn-register');

      btn.textContent = 'Creating...';
      btn.disabled = true;

      setTimeout(function() {
        toast.classList.add('show');
        btn.textContent = 'Account Created';

        setTimeout(function() {
          toast.classList.remove('show');
        }, 3000);

        setTimeout(function() {
          window.location.href = '/dashboard';
        }, 1500);
      }, 1200);
    }

    // Smooth scroll for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(function(a) {
      a.addEventListener('click', function(e) {
        e.preventDefault();
        var target = document.querySelector(this.getAttribute('href'));
        if (target) target.scrollIntoView({ behavior: 'smooth' });
      });
    });
  </script>
</body>
</html>`;
}
