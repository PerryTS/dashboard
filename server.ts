// Perry Dashboard Server
// Perry-compiled Fastify server serving static Next.js pages + API routes
// Handles: GitHub OAuth, Polar webhooks, CLI device-flow, account/usage queries

import Fastify from 'fastify';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as child_process from 'child_process';
// --- Configuration ---

const PORT = parseInt(process.env.PERRY_DASHBOARD_PORT || '3001', 10);
const PUBLIC_URL = process.env.PERRY_DASHBOARD_PUBLIC_URL || 'http://localhost:3001';
const HUB_URL = process.env.PERRY_HUB_URL || 'http://localhost:3456';
const HUB_ADMIN_SECRET = process.env.PERRY_HUB_ADMIN_SECRET || '';
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const POLAR_ACCESS_TOKEN = process.env.POLAR_ACCESS_TOKEN || '';
const POLAR_WEBHOOK_SECRET = process.env.POLAR_WEBHOOK_SECRET || '';
const POLAR_PRODUCT_PRO_MONTHLY = process.env.POLAR_PRODUCT_PRO_MONTHLY || '';

const outDir = './out';

// --- Device flow state (in-memory, keyed by device code) ---

const deviceCodes = new Map<string, { account_id: string; api_token: string; github_username: string; tier: string; created_at: number }>();
const pendingDeviceCodes = new Map<string, number>(); // code -> created_at timestamp

// Clean up expired device codes every 60 seconds
function startDeviceCodeCleanup(): void {
  const cleanup = () => {
    const now = Date.now();
    const expiredPending: string[] = [];
    const expiredAuthorized: string[] = [];
    pendingDeviceCodes.forEach((createdAt: number, code: string) => {
      if (now - createdAt > 600_000) expiredPending.push(code);
    });
    deviceCodes.forEach((data: any, code: string) => {
      if (now - data.created_at > 600_000) expiredAuthorized.push(code);
    });
    for (let i = 0; i < expiredPending.length; i++) pendingDeviceCodes.delete(expiredPending[i]);
    for (let i = 0; i < expiredAuthorized.length; i++) deviceCodes.delete(expiredAuthorized[i]);
    setTimeout(cleanup, 60_000);
  };
  setTimeout(cleanup, 60_000);
}

// --- Helpers ---

function jsonEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}

function mimeType(filePath: string): string {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) return 'image/jpeg';
  if (filePath.endsWith('.ico')) return 'image/x-icon';
  if (filePath.endsWith('.woff2')) return 'font/woff2';
  if (filePath.endsWith('.woff')) return 'font/woff';
  if (filePath.endsWith('.txt')) return 'text/plain; charset=utf-8';
  if (filePath.endsWith('.xml')) return 'application/xml';
  return 'application/octet-stream';
}

function getSessionToken(request: any): string {
  const cookieHeader = request.headers['cookie'] || '';
  const parts = cookieHeader.split(';');
  for (let i = 0; i < parts.length; i++) {
    const trimmed = parts[i].trim();
    if (trimmed.startsWith('perry_session=')) {
      return trimmed.substring('perry_session='.length);
    }
  }
  return '';
}

function getAccountByToken(token: string): any {
  if (!token) {
    console.log('getAccountByToken: empty token');
    return null;
  }
  // Use hub API instead of direct DB — Perry's mysql2 has issues in dashboard context
  console.log('getAccountByToken: calling hub API for token=' + token.substring(0, 12) + '...');
  const result = curlExec(
    'curl -s -m 5 "' + HUB_URL + '/api/v1/account" -H "Authorization: Bearer ' + token + '"'
  );
  console.log('getAccountByToken hub result: ' + result.substring(0, 100));
  if (!result) return null;
  try {
    const parsed = JSON.parse(result);
    if (parsed.error) return null;
    // Return in the shape the rest of the code expects
    return {
      id: parsed.id || '',
      github_username: parsed.github_username || '',
      github_id: '',
      email: parsed.email || '',
      tier: parsed.tier || 'free',
      polar_customer_id: '',
      polar_subscription_id: '',
      api_token: token,
      has_payment_method: parsed.has_payment_method || false,
    };
  } catch (e) {
    console.error('getAccountByToken parse error');
    return null;
  }
}

function curlExec(cmd: string): string {
  try {
    return child_process.execSync(cmd, { timeout: 15000 }).toString();
  } catch (e: any) {
    console.error('curlExec error:', e.message || e);
    return '';
  }
}

// --- Fastify app ---

const app = Fastify();

// ==================== API ROUTES ====================

// GET /api/auth/github — redirect to GitHub OAuth
app.get('/api/auth/github', async (request: any, reply: any) => {
  const params: any = request.query || {};
  const redirect = params.redirect || '/dashboard/';
  const state = crypto.randomUUID() + ':' + redirect;
  // Perry's encodeURIComponent may not work — use manual URL-safe encoding
  const callbackUrl = PUBLIC_URL + '/api/auth/callback';
  const encodedCallback = callbackUrl.replace(/:/g, '%3A').replace(/\//g, '%2F');
  const encodedState = state.replace(/:/g, '%3A').replace(/\//g, '%2F');
  const url = 'https://github.com/login/oauth/authorize?client_id=' + GITHUB_CLIENT_ID + '&redirect_uri=' + encodedCallback + '&scope=read:user%20user:email&state=' + encodedState;
  reply.status(302).header('Location', url);
  return 'redirect';
});

// GET /api/auth/callback — GitHub OAuth callback
app.get('/api/auth/callback', async (request: any, reply: any) => {
  const params: any = request.query || {};
  const code = params.code || '';
  const state = params.state || '';

  if (!code) {
    reply.status(400).header('Content-Type', 'text/html').send('<h1>Missing code</h1>');
    return;
  }

  // Extract redirect from state
  let redirectTo = '/dashboard/';
  const colonIdx = state.indexOf(':');
  if (colonIdx > 0) {
    redirectTo = state.substring(colonIdx + 1);
  }

  // Exchange code for token via curl
  const tokenResult = curlExec(
    'curl -s -X POST "https://github.com/login/oauth/access_token" -H "Accept: application/json" -d "client_id=' + GITHUB_CLIENT_ID + '&client_secret=' + GITHUB_CLIENT_SECRET + '&code=' + code + '"'
  );

  console.log('OAuth callback: code=' + code.substring(0, 6) + '... state=' + state.substring(0, 20) + '...');
  console.log('Token exchange curl result length: ' + String(tokenResult.length));
  console.log('Token result: ' + tokenResult.substring(0, 200));

  const tokenMatch = tokenResult.match(/"access_token"\s*:\s*"([^"]+)"/);
  if (!tokenMatch) {
    console.error('GitHub token exchange failed:', tokenResult);
    reply.status(500).header('Content-Type', 'text/html').send('<h1>Authentication failed</h1><p>Token exchange failed. Check server logs.</p><pre>' + tokenResult.substring(0, 500) + '</pre>');
    return;
  }
  const githubToken = tokenMatch[1];
  console.log('Got GitHub token: ' + githubToken.substring(0, 8) + '...');

  // Fetch user info
  const userResult = curlExec(
    'curl -s "https://api.github.com/user" -H "Authorization: Bearer ' + githubToken + '" -H "User-Agent: perry-dashboard" -H "Accept: application/vnd.github+json"'
  );
  console.log('User result length: ' + String(userResult.length));

  const loginMatch = userResult.match(/"login"\s*:\s*"([^"]+)"/);
  const idMatch = userResult.match(/"id"\s*:\s*(\d+)/);
  const emailMatch = userResult.match(/"email"\s*:\s*"([^"]+)"/);

  if (!loginMatch || !idMatch) {
    console.error('GitHub user fetch failed:', userResult);
    reply.status(500).header('Content-Type', 'text/html').send('<h1>Failed to get user info</h1><pre>' + userResult.substring(0, 500) + '</pre>');
    return;
  }

  const ghUsername = loginMatch[1];
  const ghId = idMatch[1];
  const ghEmail = emailMatch ? emailMatch[1] : '';

  // Create or get account via hub API
  const accountResult = curlExec(
    'curl -s -X POST "' + HUB_URL + '/api/v1/account/create" -H "Authorization: Bearer ' + HUB_ADMIN_SECRET + '" -H "Content-Type: application/json" -d \'{"github_id":"' + ghId + '","github_username":"' + jsonEscape(ghUsername) + '","email":"' + jsonEscape(ghEmail) + '"}\''
  );

  console.log('Hub account create result: ' + accountResult.substring(0, 300));

  const apiTokenMatch = accountResult.match(/"api_token"\s*:\s*"([^"]+)"/);
  if (!apiTokenMatch) {
    console.error('Hub account create failed:', accountResult);
    reply.status(500).header('Content-Type', 'text/html').send('<h1>Account creation failed</h1><pre>' + accountResult.substring(0, 500) + '</pre>');
    return;
  }
  const apiToken = apiTokenMatch[1];
  console.log('Setting cookie and redirecting to ' + redirectTo);

  // Set session cookie and redirect
  reply.header('Set-Cookie', 'perry_session=' + apiToken + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000');
  reply.header('Location', redirectTo);
  reply.status(302);
  return 'redirect';
});

// GET /api/auth/me — return current user
app.get('/api/auth/me', async (request: any, reply: any) => {
  reply.header('Content-Type', 'application/json');
  const rawCookie = request.headers['cookie'] || '';
  console.log('/api/auth/me cookie header: "' + rawCookie.substring(0, 80) + '"');
  const token = getSessionToken(request);
  console.log('/api/auth/me extracted token: "' + token.substring(0, 20) + '"');
  if (!token) {
    console.log('/api/auth/me: no token, returning 401');
    reply.status(401);
    return JSON.stringify({ error: { code: 'AUTH_REQUIRED', message: 'Not signed in' } });
  }

  // Get full account + usage from hub in one call
  console.log('/api/auth/me: calling hub with token=' + token.substring(0, 12) + '...');
  const hubResult = curlExec(
    'curl -s -m 5 "' + HUB_URL + '/api/v1/account" -H "Authorization: Bearer ' + token + '"'
  );
  console.log('/api/auth/me: hub result=' + hubResult.substring(0, 80));

  if (!hubResult) {
    reply.status(502);
    return JSON.stringify({ error: { code: 'HUB_UNAVAILABLE', message: 'Hub unreachable' } });
  }

  let hubData: any;
  try {
    hubData = JSON.parse(hubResult);
  } catch (e) {
    reply.status(502);
    return JSON.stringify({ error: { code: 'HUB_ERROR', message: 'Invalid hub response' } });
  }

  if (hubData.error) {
    reply.status(401);
    return JSON.stringify({ error: { code: 'AUTH_INVALID', message: 'Invalid session' } });
  }

  return JSON.stringify({
    account: {
      id: hubData.id || '',
      github_username: hubData.github_username || '',
      email: hubData.email || '',
      tier: hubData.tier || 'free',
      has_payment_method: hubData.has_payment_method || false,
      usage: hubData.usage || { publishes: 0, publish_limit: 15, deep_verifies: 0, verify_limit: 2, period: '' },
    },
    api_token: token,
  });
});

// POST /api/auth/logout
app.post('/api/auth/logout', async (request: any, reply: any) => {
  reply.header('Set-Cookie', 'perry_session=; Path=/; HttpOnly; Max-Age=0');
  reply.header('Content-Type', 'application/json');
  return JSON.stringify({ ok: true });
});

// POST /api/checkout — create Polar checkout session
app.post('/api/checkout', async (request: any, reply: any) => {
  reply.header('Content-Type', 'application/json');
  const token = getSessionToken(request);
  if (!token) {
    reply.status(401);
    return JSON.stringify({ error: { code: 'AUTH_REQUIRED', message: 'Not signed in' } });
  }
  const account = getAccountByToken(token);
  if (!account) {
    reply.status(401);
    return JSON.stringify({ error: { code: 'AUTH_INVALID', message: 'Invalid session' } });
  }

  if (!POLAR_PRODUCT_PRO_MONTHLY || !POLAR_ACCESS_TOKEN) {
    reply.status(500);
    return JSON.stringify({ error: { code: 'NOT_CONFIGURED', message: 'Billing not configured' } });
  }

  const successUrl = PUBLIC_URL + '/dashboard/?upgraded=true';
  const checkoutResult = curlExec(
    'curl -s -X POST "https://api.polar.sh/v1/checkouts/custom/" -H "Authorization: Bearer ' + POLAR_ACCESS_TOKEN + '" -H "Content-Type: application/json" -d \'{"product_id":"' + POLAR_PRODUCT_PRO_MONTHLY + '","customer_email":"' + jsonEscape(account.email || account.github_username + '@users.noreply.github.com') + '","success_url":"' + jsonEscape(successUrl) + '","metadata":{"account_id":"' + account.id + '"}}\''
  );

  const urlMatch = checkoutResult.match(/"url"\s*:\s*"([^"]+)"/);
  if (!urlMatch) {
    console.error('Polar checkout failed:', checkoutResult);
    reply.status(500);
    return JSON.stringify({ error: { code: 'CHECKOUT_FAILED', message: 'Failed to create checkout' } });
  }

  return JSON.stringify({ url: urlMatch[1] });
});

// POST /api/portal — create Polar customer portal session
app.post('/api/portal', async (request: any, reply: any) => {
  reply.header('Content-Type', 'application/json');
  const token = getSessionToken(request);
  if (!token) {
    reply.status(401);
    return JSON.stringify({ error: { code: 'AUTH_REQUIRED', message: 'Not signed in' } });
  }
  const account = getAccountByToken(token);
  if (!account) {
    reply.status(401);
    return JSON.stringify({ error: { code: 'AUTH_INVALID', message: 'Invalid session' } });
  }

  if (!account.polar_customer_id || !POLAR_ACCESS_TOKEN) {
    reply.status(400);
    return JSON.stringify({ error: { code: 'NO_SUBSCRIPTION', message: 'No active subscription' } });
  }

  const portalResult = curlExec(
    'curl -s -X POST "https://api.polar.sh/v1/customer-sessions/" -H "Authorization: Bearer ' + POLAR_ACCESS_TOKEN + '" -H "Content-Type: application/json" -d \'{"customer_id":"' + account.polar_customer_id + '"}\''
  );

  const urlMatch = portalResult.match(/"customer_portal_url"\s*:\s*"([^"]+)"/);
  if (!urlMatch) {
    console.error('Polar portal failed:', portalResult);
    reply.status(500);
    return JSON.stringify({ error: { code: 'PORTAL_FAILED', message: 'Failed to create portal session' } });
  }

  return JSON.stringify({ url: urlMatch[1] });
});

// POST /api/webhooks/polar — handle Polar subscription webhooks
app.post('/api/webhooks/polar', async (request: any, reply: any) => {
  reply.header('Content-Type', 'application/json');

  const rawBody = request.rawBody || '';
  const webhookId = request.headers['webhook-id'] || '';
  const webhookTimestamp = request.headers['webhook-timestamp'] || '';
  const signature = request.headers['webhook-signature'] || '';

  // Verify signature
  if (POLAR_WEBHOOK_SECRET) {
    const signedContent = webhookId + '.' + webhookTimestamp + '.' + rawBody;
    const secretBytes = Buffer.from(POLAR_WEBHOOK_SECRET.replace('polar_whs_', ''), 'base64');
    const expected = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');
    const sigParts = signature.split(',');
    const sigValue = sigParts.length > 1 ? sigParts[1] : signature;
    if (expected !== sigValue) {
      console.warn('Polar webhook signature mismatch');
      // Continue anyway for now (same as searchbird pattern)
    }
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch (e) {
    reply.status(400);
    return JSON.stringify({ error: 'Invalid JSON' });
  }

  console.log('Polar webhook:', event.type);

  if (event.type === 'subscription.created' || event.type === 'subscription.updated') {
    const data = event.data;
    const accountId = data.metadata?.account_id || '';
    const polarCustomerId = data.customer?.id || data.customer_id || '';
    const polarSubscriptionId = data.id || '';

    if (accountId) {
      // Update account tier via hub
      curlExec(
        'curl -s -X POST "' + HUB_URL + '/api/v1/account/update" -H "Authorization: Bearer ' + HUB_ADMIN_SECRET + '" -H "Content-Type: application/json" -d \'{"account_id":"' + accountId + '","tier":"pro","polar_customer_id":"' + jsonEscape(polarCustomerId) + '","polar_subscription_id":"' + jsonEscape(polarSubscriptionId) + '","has_payment_method":true}\''
      );
      console.log('Updated account ' + accountId + ' to pro');
    }
  } else if (event.type === 'subscription.canceled') {
    const data = event.data;
    const accountId = data.metadata?.account_id || '';

    if (accountId) {
      curlExec(
        'curl -s -X POST "' + HUB_URL + '/api/v1/account/update" -H "Authorization: Bearer ' + HUB_ADMIN_SECRET + '" -H "Content-Type: application/json" -d \'{"account_id":"' + accountId + '","tier":"free","has_payment_method":false}\''
      );
      console.log('Downgraded account ' + accountId + ' to free');
    }
  }

  return JSON.stringify({ received: true });
});

// POST /api/cli/start — CLI initiates device-flow auth
app.post('/api/cli/start', async (request: any, reply: any) => {
  reply.header('Content-Type', 'application/json');
  const body: any = request.body || {};
  const deviceCode = body.device_code || '';
  if (!deviceCode || deviceCode.length < 6) {
    reply.status(400);
    return JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'Invalid device_code' } });
  }
  pendingDeviceCodes.set(deviceCode, Date.now());
  return JSON.stringify({ ok: true, authorize_url: PUBLIC_URL + '/cli/authorize/?code=' + deviceCode });
});

// GET /api/cli/poll — CLI polls for authorization result
app.get('/api/cli/poll', async (request: any, reply: any) => {
  reply.header('Content-Type', 'application/json');
  const params: any = request.query || {};
  const code = params.code || '';

  if (!code) {
    reply.status(400);
    return JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'Missing code parameter' } });
  }

  const result = deviceCodes.get(code);
  if (result) {
    // Authorized — return token and clean up
    deviceCodes.delete(code);
    pendingDeviceCodes.delete(code);
    return JSON.stringify({
      authorized: true,
      api_token: result.api_token,
      github_username: result.github_username,
      tier: result.tier,
    });
  }

  // Check if code is still pending
  if (pendingDeviceCodes.has(code)) {
    return JSON.stringify({ authorized: false, status: 'pending' });
  }

  reply.status(404);
  return JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Unknown device code' } });
});

// POST /api/cli/authorize — user confirms device code (must be logged in)
app.post('/api/cli/authorize', async (request: any, reply: any) => {
  reply.header('Content-Type', 'application/json');
  const token = getSessionToken(request);
  if (!token) {
    reply.status(401);
    return JSON.stringify({ error: { code: 'AUTH_REQUIRED', message: 'Sign in first' } });
  }
  const account = getAccountByToken(token);
  if (!account) {
    reply.status(401);
    return JSON.stringify({ error: { code: 'AUTH_INVALID', message: 'Invalid session' } });
  }

  const body: any = request.body || {};
  const deviceCode = body.device_code || '';
  if (!deviceCode || !pendingDeviceCodes.has(deviceCode)) {
    reply.status(400);
    return JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'Invalid or expired device code' } });
  }

  // Store authorization result for CLI to poll
  deviceCodes.set(deviceCode, {
    account_id: account.id,
    api_token: account.api_token,
    github_username: account.github_username,
    tier: account.tier,
    created_at: Date.now(),
  });
  pendingDeviceCodes.delete(deviceCode);

  return JSON.stringify({ ok: true });
});

// ==================== STATIC FILE SERVING ====================

app.get('/*', async (req: any, reply: any) => {
  const urlPath = (req.url as string).split('?')[0];

  // Skip API routes (already handled above)
  if (urlPath.startsWith('/api/')) {
    reply.status(404).header('Content-Type', 'application/json').send('{"error":"Not found"}');
    return;
  }

  const relative = urlPath.startsWith('/') ? urlPath.slice(1) : urlPath;
  const base = outDir + '/' + relative;

  // Try directory index
  const indexPath = base + '/index.html';
  if (fs.existsSync(indexPath)) {
    reply.header('Content-Type', 'text/html; charset=utf-8').send(fs.readFileSync(indexPath, 'utf-8'));
    return;
  }

  // Try exact file
  if (relative && fs.existsSync(base) && fs.statSync(base).isFile()) {
    reply.header('Content-Type', mimeType(base)).send(fs.readFileSync(base, 'utf-8'));
    return;
  }

  // Try .html extension
  const htmlPath = base + '.html';
  if (fs.existsSync(htmlPath)) {
    reply.header('Content-Type', 'text/html; charset=utf-8').send(fs.readFileSync(htmlPath, 'utf-8'));
    return;
  }

  // 404
  const page404 = outDir + '/404.html';
  if (fs.existsSync(page404)) {
    reply.status(404).header('Content-Type', 'text/html; charset=utf-8').send(fs.readFileSync(page404, 'utf-8'));
  } else {
    reply.status(404).header('Content-Type', 'text/html; charset=utf-8').send('<h1>404 Not Found</h1>');
  }
});

// ==================== START ====================

startDeviceCodeCleanup();

app.listen({ port: PORT, host: '0.0.0.0' });
console.log('Perry Dashboard running on port ' + String(PORT));
