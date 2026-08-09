import { authUsesJwt, authUsesToken, htmlAuthKit, type StarterLayers } from "./types.ts";

function renderSiteCss(): string {
  return `:root {
  color-scheme: light;
  --bg: #f4f1ea;
  --ink: #1c1917;
  --muted: #57534e;
  --card: #fffdf8;
  --line: #e7e0d4;
  --accent: #1d4e4f;
  --accent-ink: #f8faf8;
  --danger: #9f1239;
  --ok: #166534;
  font-family: "Iowan Old Style", "Palatino Linotype", Palatino, serif;
  line-height: 1.5;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  min-height: 100vh;
  background: var(--bg);
  color: var(--ink);
}

.site-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--line);
  background: var(--card);
}

.brand {
  font-weight: 700;
  text-decoration: none;
  color: inherit;
  letter-spacing: 0.02em;
}

.site-header nav {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  font-size: 0.95rem;
}

.site-header a { color: inherit; }

.site-header form { display: inline; }

main {
  padding: 2rem 1.5rem 3rem;
}

.section, .auth-card {
  max-width: 36rem;
  margin: 0 auto;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 1rem;
  padding: 1.5rem 1.5rem 1.75rem;
}

.hero {
  max-width: 40rem;
}

.section h1, .auth-card h1, .hero h1 {
  margin: 0 0 0.5rem;
  font-size: 1.8rem;
}

.lede, .muted { color: var(--muted); }

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 1.25rem;
}

label {
  display: block;
  margin: 0.85rem 0;
  font-size: 0.95rem;
}

input[type="email"],
input[type="password"],
input[type="text"] {
  display: block;
  width: 100%;
  margin-top: 0.35rem;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--line);
  border-radius: 0.5rem;
  background: #fff;
  font: inherit;
}

button, .button {
  display: inline-block;
  border: 0;
  border-radius: 999px;
  padding: 0.55rem 1rem;
  background: var(--accent);
  color: var(--accent-ink);
  font: inherit;
  text-decoration: none;
  cursor: pointer;
}

.button-secondary {
  background: transparent;
  color: var(--ink);
  border: 1px solid var(--line);
}

.error { color: var(--danger); }
.ok, .flash-success { color: var(--ok); }
.flash-error { color: var(--danger); }
.flash {
  margin: 0 0 1rem;
  padding: 0.6rem 0.8rem;
  border-radius: 0.5rem;
  border: 1px solid var(--line);
}

.auth-links {
  margin-top: 1rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1rem;
}

code { font-size: 0.9em; }
`;
}

function renderLayout(layers: StarterLayers, projectName: string): string {
  const kit = htmlAuthKit(layers.auth);
  const guestNav = kit
    ? `<a href="/login">Sign in</a>
        <a href="/register">Create account</a>`
    : "";
  const userNav = kit
    ? `<% if (it.currentUser) { %>
        <span class="muted"><%= it.currentUser.email %></span>
        ${layers.extras.mfa ? '<a href="/account/mfa">MFA</a>' : ""}
        <form method="post" action="/logout">
          <input type="hidden" name="_token" value="<%= it.csrfToken %>" />
          <button class="button-secondary" type="submit">Sign out</button>
        </form>
      <% } else { %>
        ${guestNav}
      <% } %>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title><%= it.layout.title %> · ${projectName}</title>
    <% if (it.layout.description) { %>
    <meta name="description" content="<%= it.layout.description %>" />
    <% } %>
    <link rel="stylesheet" href="/assets/site.css" />
  </head>
  <body>
    <header class="site-header">
      <a class="brand" href="/">${projectName}</a>
      <nav>
        ${userNav}
      </nav>
    </header>
    <main>
      <% if (it.flash && it.flash.message) { %>
      <p class="flash flash-<%= it.flash.level %>"><%= it.flash.message %></p>
      <% } %>
      <%~ it.body %>
    </main>
  </body>
</html>
`;
}

function renderHomeView(projectName: string, layers: StarterLayers): string {
  const kit = htmlAuthKit(layers.auth);
  const tokenHint = authUsesToken(layers.auth)
    ? '<p class="muted">API token: <code>POST /api/v1/auth/login</code> with email and password.</p>'
    : "";
  const jwtHint = authUsesJwt(layers.auth)
    ? '<p class="muted">JWT: <code>POST /api/auth/token</code> with email and password.</p>'
    : "";
  const guest = kit
    ? `<% if (!it.currentUser) { %>
  <p class="lede">Sign in or create an account. Edit <code>views/home.eta</code> and <code>public/assets/site.css</code> to restyle this page.</p>
  <div class="actions">
    <a class="button" href="/register">Create account</a>
    <a class="button button-secondary" href="/login">Sign in</a>
  </div>
  <p class="muted">Seeded demo: <code>demo@example.com</code> / <code>password</code>.</p>
<% } else { %>
  <p class="lede">You are signed in as <strong><%= it.currentUser.email %></strong>.</p>
  <p>Add routes in <code>src/modules</code>. This homepage is yours to restyle.</p>
<% } %>`
    : `<p class="lede">Edit <code>views/home.eta</code> and <code>public/assets/site.css</code> to restyle this page.</p>
  <p class="muted">Auth stack: <code>${layers.auth}</code>.</p>`;

  const extras = [tokenHint, jwtHint].filter(Boolean).join("\n  ");

  return `<section class="section hero">
  <h1>Welcome to ${projectName}</h1>
  ${guest}
  <p>Health check: <a href="/health"><code>/health</code></a>.</p>${extras ? `\n  ${extras}` : ""}
</section>
`;
}

function renderFormView(title: string, fields: string, submit: string, links: string): string {
  return `<section class="auth-card">
  <h1>${title}</h1>
  <% if (it.status) { %>
  <p class="ok"><%= it.status %></p>
  <% } %>
  <% if (it.errors && it.errors.form) { %>
  <p class="error"><%= it.errors.form %></p>
  <% } %>
  <form method="post" action="<%= it.action || "" %>">
    <input type="hidden" name="_token" value="<%= it.csrfToken %>" />
    ${fields}
    <div class="actions">
      <button type="submit">${submit}</button>
    </div>
  </form>
  <div class="auth-links">
    ${links}
  </div>
</section>
`;
}

function textField(name: string, label: string, type: string, extra = ""): string {
  return `<label>
      ${label}
      <% if (it.errors && it.errors.${name}) { %><span class="error"><%= it.errors.${name} %></span><% } %>
      <input type="${type}" name="${name}" value="<%= it.${name} || "" %>" ${extra} />
    </label>`;
}

function renderLoginView(): string {
  return renderFormView(
    "Sign in",
    `${textField("email", "Email", "email", 'required autocomplete="username"')}
    ${textField("password", "Password", "password", 'required autocomplete="current-password"')}`,
    "Sign in",
    `<a href="/register">Create account</a>
    <a href="/forgot-password">Forgot password</a>`,
  ).replace('action="<%= it.action || "" %>"', 'action="/login"');
}

function renderRegisterView(): string {
  return renderFormView(
    "Create account",
    `${textField("name", "Name", "text", "required")}
    ${textField("email", "Email", "email", 'required autocomplete="email"')}
    ${textField("password", "Password", "password", 'required minlength="8" autocomplete="new-password"')}`,
    "Create account",
    `<a href="/login">Already have an account</a>`,
  ).replace('action="<%= it.action || "" %>"', 'action="/register"');
}

function renderForgotPasswordView(): string {
  return renderFormView(
    "Forgot password",
    textField("email", "Email", "email", "required"),
    "Send reset link",
    `<a href="/login">Back to sign in</a>`,
  ).replace('action="<%= it.action || "" %>"', 'action="/forgot-password"');
}

function renderResetPasswordView(): string {
  return renderFormView(
    "Set a new password",
    `${textField("password", "New password", "password", 'required minlength="8" autocomplete="new-password"')}
    <input type="hidden" name="email" value="<%= it.email || "" %>" />`,
    "Update password",
    `<a href="/login">Back to sign in</a>`,
  ).replace('action="<%= it.action || "" %>"', 'action="<%= it.action %>"');
}

function renderVerifyEmailView(): string {
  return `<section class="auth-card">
  <h1>Verify your email</h1>
  <p>We sent a signed link to your inbox (or the mail log when <code>MAIL_DRIVER=log</code>).</p>
  <form method="post" action="/email/verification-notification">
    <input type="hidden" name="_token" value="<%= it.csrfToken %>" />
    <button type="submit">Resend link</button>
  </form>
</section>
`;
}

function renderMfaChallengeView(): string {
  return renderFormView(
    "Two-factor code",
    `${textField("code", "Authenticator or recovery code", "text", 'required autocomplete="one-time-code"')}`,
    "Continue",
    `<a href="/login">Cancel</a>`,
  ).replace('action="<%= it.action || "" %>"', 'action="/login/mfa"');
}

function renderMfaSetupView(): string {
  return `<section class="auth-card">
  <h1>Authenticator app</h1>
  <p class="muted">Scan this otpauth URL in your authenticator, then confirm a code. Restyle this page in <code>views/auth/mfa-setup.eta</code>.</p>
  <p><code><%= it.otpauth %></code></p>
  <form method="post" action="/account/mfa">
    <input type="hidden" name="_token" value="<%= it.csrfToken %>" />
    <input type="hidden" name="secret" value="<%= it.secret %>" />
    ${textField("code", "Confirmation code", "text", "required")}
    <div class="actions"><button type="submit">Enable MFA</button></div>
  </form>
  <% if (it.recoveryCodes) { %>
  <h2>Recovery codes</h2>
  <p>Store these once. They will not be shown again.</p>
  <ul>
    <% for (const code of it.recoveryCodes) { %>
    <li><code><%= code %></code></li>
    <% } %>
  </ul>
  <% } %>
</section>
`;
}

export {
  renderForgotPasswordView,
  renderHomeView,
  renderLayout,
  renderLoginView,
  renderMfaChallengeView,
  renderMfaSetupView,
  renderRegisterView,
  renderResetPasswordView,
  renderSiteCss,
  renderVerifyEmailView,
};
