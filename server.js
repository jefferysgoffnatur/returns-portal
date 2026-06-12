/* ============================================
   NATUR ATHLETICS — RETURNS PORTAL BACKEND
   ============================================ */

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const multer     = require('multer');
const path       = require('path');
const nodemailer = require('nodemailer');

const app  = express();
const PORT = process.env.PORT || 3000;

// Shopify config (from .env)
const SHOPIFY_DOMAIN      = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-10';
const SHOPIFY_CLIENT_ID   = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const SHOPIFY_SCOPES      = 'read_orders,read_all_orders';

// Access token — loaded dynamically so it picks up updates after OAuth
function getToken() { return process.env.SHOPIFY_ACCESS_TOKEN; }

// Email config (optional — set in .env to enable notifications)
const EMAIL_HOST     = process.env.EMAIL_HOST;
const EMAIL_PORT     = parseInt(process.env.EMAIL_PORT || '587', 10);
const EMAIL_USER     = process.env.EMAIL_USER;
const EMAIL_PASS     = process.env.EMAIL_PASS;
const EMAIL_FROM     = process.env.EMAIL_FROM     || 'returns@naturathletics.us';
const EMAIL_TO_STORE = process.env.EMAIL_TO_STORE || 'support@naturathletics.us';

const RETURN_WINDOW_DAYS  = 30;
const WARRANTY_WINDOW_DAYS = 180;

// ============================================
// MIDDLEWARE
// ============================================

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Multer — store photos in memory (max 10MB each, max 6 files)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed.'));
    }
  }
});

// ============================================
// SHOPIFY API HELPER
// ============================================

async function shopifyGet(endpoint) {
  const url = `https://${SHOPIFY_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/${endpoint}`;
  console.log(`[Shopify] GET ${url}`);
  const res  = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': getToken(),
      'Content-Type': 'application/json'
    }
  });

  const body = await res.text();
  console.log(`[Shopify] Response ${res.status}: ${body.slice(0, 300)}`);

  if (!res.ok) {
    throw new Error(`Shopify API ${res.status}: ${body}`);
  }

  return JSON.parse(body);
}

async function shopifyPut(endpoint, body) {
  const url = `https://${SHOPIFY_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/${endpoint}`;
  const res  = await fetch(url, {
    method: 'PUT',
    headers: {
      'X-Shopify-Access-Token': getToken(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify API ${res.status}: ${text}`);
  }

  return res.json();
}

// ============================================
// EMAIL HELPER
// ============================================

function buildTransporter() {
  if (!EMAIL_HOST || !EMAIL_USER || !EMAIL_PASS) return null;
  return nodemailer.createTransporter({
    host: EMAIL_HOST,
    port: EMAIL_PORT,
    secure: EMAIL_PORT === 465,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS }
  });
}

async function sendReturnEmail({ rmaNumber, order, items, eligibilityType, reason, notes, photoCount }) {
  const transporter = buildTransporter();
  if (!transporter) {
    console.log('[Email] SMTP not configured — skipping notification email.');
    return;
  }

  const typeLabel = eligibilityType === 'warranty' ? 'Warranty Claim' : 'Return Request';
  const itemList  = items.map(i => `- ${i.title}${i.variantTitle ? ` (${i.variantTitle})` : ''}`).join('\n');

  const html = `
    <h2>New ${typeLabel} — ${rmaNumber}</h2>
    <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;">
      <tr><td style="padding:8px;font-weight:bold;color:#555;">RMA</td><td style="padding:8px;">${rmaNumber}</td></tr>
      <tr><td style="padding:8px;font-weight:bold;color:#555;">Order</td><td style="padding:8px;">${order.name}</td></tr>
      <tr><td style="padding:8px;font-weight:bold;color:#555;">Customer Email</td><td style="padding:8px;">${order.email}</td></tr>
      <tr><td style="padding:8px;font-weight:bold;color:#555;">Type</td><td style="padding:8px;">${typeLabel}</td></tr>
      <tr><td style="padding:8px;font-weight:bold;color:#555;">Items</td><td style="padding:8px;">${items.map(i => `${i.title}${i.variantTitle ? ` (${i.variantTitle})` : ''}`).join('<br/>')}</td></tr>
      <tr><td style="padding:8px;font-weight:bold;color:#555;">Reason</td><td style="padding:8px;">${reason}</td></tr>
      ${notes ? `<tr><td style="padding:8px;font-weight:bold;color:#555;">Notes</td><td style="padding:8px;">${notes}</td></tr>` : ''}
      ${photoCount > 0 ? `<tr><td style="padding:8px;font-weight:bold;color:#555;">Photos</td><td style="padding:8px;">${photoCount} attached</td></tr>` : ''}
    </table>
    <p style="margin-top:16px;font-size:12px;color:#888;">
      View order in Shopify:
      <a href="https://${SHOPIFY_DOMAIN}/admin/orders/${order.id}">Order ${order.name}</a>
    </p>
  `;

  await transporter.sendMail({
    from: EMAIL_FROM,
    to: EMAIL_TO_STORE,
    subject: `[${typeLabel}] ${rmaNumber} — Order ${order.name}`,
    text: `New ${typeLabel}\n\nRMA: ${rmaNumber}\nOrder: ${order.name}\nEmail: ${order.email}\nItems:\n${itemList}\nReason: ${reason}\nNotes: ${notes || 'None'}`,
    html
  });

  console.log(`[Email] Notification sent for ${rmaNumber}`);
}

// ============================================
// OAUTH ROUTES (one-time setup to get access token)
// ============================================

// Step 1: Start OAuth — visit /auth to begin
app.get('/auth', (req, res) => {
  const redirectUri = process.env.APP_URL
    ? `${process.env.APP_URL}/auth/callback`
    : `http://localhost:${PORT}/auth/callback`;
  const authUrl = `https://${SHOPIFY_DOMAIN}/admin/oauth/authorize?client_id=${SHOPIFY_CLIENT_ID}&scope=${SHOPIFY_SCOPES}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  console.log('[OAuth] Redirecting to:', authUrl);
  res.redirect(authUrl);
});

// Step 2: Shopify redirects here with a code — exchange it for a token
app.get('/auth/callback', async (req, res) => {
  const { code, shop } = req.query;

  if (!code) {
    return res.status(400).send('Missing authorization code.');
  }

  try {
    const tokenRes = await fetch(`https://${SHOPIFY_DOMAIN}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:     SHOPIFY_CLIENT_ID,
        client_secret: SHOPIFY_CLIENT_SECRET,
        code
      })
    });

    const data = await tokenRes.json();
    console.log('[OAuth] Token response:', JSON.stringify(data));

    if (data.access_token) {
      // Write the token to .env
      const fs   = require('fs');
      const envPath = require('path').join(__dirname, '.env');
      let envContent = fs.readFileSync(envPath, 'utf8');
      envContent = envContent.replace(/SHOPIFY_ACCESS_TOKEN=.*/, `SHOPIFY_ACCESS_TOKEN=${data.access_token}`);
      fs.writeFileSync(envPath, envContent);

      // Update in-memory env
      process.env.SHOPIFY_ACCESS_TOKEN = data.access_token;

      console.log(`[OAuth] Access token saved: ${data.access_token.slice(0, 12)}...`);
      res.send(`
        <h2 style="font-family:sans-serif;padding:40px;">
          ✅ Authorization successful!<br><br>
          <span style="font-size:16px;color:#555;">
            Your access token has been saved. You can close this tab and use the returns portal.<br><br>
            <a href="/">Go to Returns Portal</a>
          </span>
        </h2>
      `);
    } else {
      console.error('[OAuth] Failed:', data);
      res.status(500).send(`OAuth failed: ${JSON.stringify(data)}`);
    }
  } catch (err) {
    console.error('[OAuth] Error:', err.message);
    res.status(500).send('OAuth error: ' + err.message);
  }
});

// ============================================
// DIAGNOSTIC: See recent order names (remove before going live)
// ============================================

app.get('/api/debug-orders', async (req, res) => {
  const results = {};
  const token = getToken();
  results.tokenPrefix = token ? token.slice(0, 12) + '...' : 'NOT SET';

  // Test 1: shop.json — no special scopes needed
  try {
    const shop = await shopifyGet('shop.json');
    results.shopAccess = 'OK — ' + shop.shop.name;
  } catch (err) {
    results.shopAccess = 'FAILED — ' + err.message;
  }

  // Test 2: orders count
  try {
    const url = `https://${SHOPIFY_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/orders/count.json?status=any`;
    const r = await fetch(url, { headers: { 'X-Shopify-Access-Token': token } });
    const body = await r.text();
    results.ordersCount = `HTTP ${r.status} — ${body.slice(0, 200)}`;
  } catch (err) {
    results.ordersCount = 'FAILED — ' + err.message;
  }

  // Test 3: last 60 days
  try {
    const url = `https://${SHOPIFY_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/orders.json?limit=5&status=any&fields=id,name,created_at`;
    const r = await fetch(url, { headers: { 'X-Shopify-Access-Token': token } });
    const data = await r.json();
    results.orders_last60days = data.orders ? data.orders.map(o => ({ name: o.name, date: o.created_at })) : data;
  } catch (err) {
    results.orders_last60days = 'FAILED — ' + err.message;
  }

  // Test 4: all time (needs read_all_orders)
  try {
    const url = `https://${SHOPIFY_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/orders.json?limit=5&status=any&created_at_min=2020-01-01&fields=id,name,created_at`;
    const r = await fetch(url, { headers: { 'X-Shopify-Access-Token': token } });
    const data = await r.json();
    results.orders_alltime = data.orders ? data.orders.map(o => ({ name: o.name, date: o.created_at })) : data;
  } catch (err) {
    results.orders_alltime = 'FAILED — ' + err.message;
  }

  res.json(results);
});

// ============================================
// ROUTE: ORDER LOOKUP
// ============================================

app.post('/api/lookup-order', async (req, res) => {
  const { orderNumber, email } = req.body;

  if (!orderNumber || !email) {
    return res.status(400).json({ error: 'Order number and email are required.' });
  }

  // Accept formats: 3175, NA3175, #NA3175
  const stripped = orderNumber.trim().replace(/^#/, '');
  // Normalise to always have NA prefix
  const cleanNumber = /^NA\d+$/i.test(stripped) ? stripped.toUpperCase() : `NA${stripped}`;

  try {
    const fields = 'id,name,email,created_at,fulfillment_status,financial_status,line_items,shipping_address,currency';

    // Primary search: name=#NA{number}
    const query = `name=%23${encodeURIComponent(cleanNumber)}&email=${encodeURIComponent(email)}&status=any&fields=${fields}`;
    const data  = await shopifyGet(`orders.json?${query}`);
    let order   = data.orders && data.orders.length > 0 ? data.orders[0] : null;

    // Fallback: try without email in case email casing differs
    if (!order) {
      const fallback = await shopifyGet(`orders.json?name=%23${encodeURIComponent(cleanNumber)}&status=any&fields=${fields}`);
      order = fallback.orders && fallback.orders.length > 0 ? fallback.orders[0] : null;
    }

    if (!order) {
      return res.status(404).json({
        error: 'No order found with that order number and email. Please double-check your confirmation email and try again.'
      });
    }

    // Verify email matches (Shopify may return partial matches)
    if (order.email.toLowerCase() !== email.toLowerCase().trim()) {
      return res.status(404).json({ error: 'No order found with that order number and email combination.' });
    }

    // Check if shipping address is international
    const countryCode    = order.shipping_address?.country_code || '';
    const isInternational = countryCode !== '' && countryCode !== 'US';

    // Days since order was placed
    const orderDate        = new Date(order.created_at);
    const now              = new Date();
    const daysSinceOrder   = Math.floor((now - orderDate) / (1000 * 60 * 60 * 24));

    // Map line items with eligibility
    const lineItems = order.line_items.map(item => {
      let eligible        = true;
      let eligibilityType = 'return';
      let ineligibleReason = null;

      if (isInternational) {
        eligible         = false;
        ineligibleReason = 'International orders are final sale';
      } else if (daysSinceOrder <= RETURN_WINDOW_DAYS) {
        eligibilityType = 'return';
      } else if (daysSinceOrder <= WARRANTY_WINDOW_DAYS) {
        eligibilityType = 'warranty';
      } else {
        eligible         = false;
        ineligibleReason = `Outside the ${RETURN_WINDOW_DAYS}-day return and ${WARRANTY_WINDOW_DAYS / 30}-month warranty window`;
      }

      return {
        id:             item.id,
        productId:      item.product_id,
        variantId:      item.variant_id,
        title:          item.title,
        variantTitle:   item.variant_title,
        quantity:       item.quantity,
        price:          item.price,
        image:          item.image?.src || null,
        eligible,
        eligibilityType,
        ineligibleReason
      };
    });

    return res.json({
      order: {
        id:             order.id,
        name:           order.name,
        email:          order.email,
        createdAt:      order.created_at,
        daysSinceOrder,
        isInternational,
        lineItems,
        currency:       order.currency
      }
    });

  } catch (err) {
    console.error('[Lookup] Error:', err.message);
    return res.status(500).json({ error: 'Unable to look up your order right now. Please try again or contact us.' });
  }
});

// ============================================
// ROUTE: SUBMIT RETURN
// ============================================

const photoFields = Array.from({ length: 6 }, (_, i) => ({ name: `photo_${i}` }));

app.post('/api/submit-return', upload.fields(photoFields), async (req, res) => {
  const {
    orderId,
    orderName,
    email,
    eligibilityType,
    items: itemsJson,
    reason,
    additionalNotes
  } = req.body;

  if (!orderId || !itemsJson || !reason) {
    return res.status(400).json({ error: 'Invalid return request. Please start over.' });
  }

  let items;
  try {
    items = JSON.parse(itemsJson);
  } catch {
    return res.status(400).json({ error: 'Invalid item data.' });
  }

  // Generate RMA number
  const rmaNumber = `NA-${Date.now().toString(36).toUpperCase()}`;

  const photoCount = Object.keys(req.files || {}).length;

  // Log the request
  console.log('\n=== NEW RETURN REQUEST ===');
  console.log(`RMA:     ${rmaNumber}`);
  console.log(`Order:   ${orderName} (ID: ${orderId})`);
  console.log(`Email:   ${email}`);
  console.log(`Type:    ${eligibilityType}`);
  console.log(`Reason:  ${reason}`);
  console.log(`Items:   ${items.map(i => i.title).join(', ')}`);
  console.log(`Photos:  ${photoCount}`);
  console.log(`Notes:   ${additionalNotes || 'none'}`);
  console.log('==========================\n');

  try {
    // Tag and note the Shopify order
    const tag   = eligibilityType === 'warranty' ? 'warranty-claim-requested' : 'return-requested';
    const note  = `[${rmaNumber}] ${eligibilityType === 'warranty' ? 'Warranty claim' : 'Return'} requested via portal on ${new Date().toISOString().split('T')[0]}. Reason: ${reason}. Items: ${items.map(i => i.title).join(', ')}.`;

    // Fetch current order tags first to avoid overwriting
    const currentOrder = await shopifyGet(`orders/${orderId}.json?fields=id,tags,note`);
    const existingTags = currentOrder.order.tags || '';
    const existingNote = currentOrder.order.note || '';
    const newTags      = existingTags ? `${existingTags}, ${tag}` : tag;
    const newNote      = existingNote ? `${existingNote}\n\n${note}` : note;

    await shopifyPut(`orders/${orderId}.json`, {
      order: { id: orderId, tags: newTags, note: newNote }
    });

    console.log(`[Shopify] Order ${orderName} tagged "${tag}" with note.`);
  } catch (err) {
    // Non-fatal: log but don't fail the request
    console.error('[Shopify] Failed to update order:', err.message);
  }

  // Send email notification
  try {
    await sendReturnEmail({
      rmaNumber,
      order: { id: orderId, name: orderName, email },
      items,
      eligibilityType,
      reason,
      notes: additionalNotes,
      photoCount
    });
  } catch (err) {
    console.error('[Email] Failed to send notification:', err.message);
  }

  return res.json({
    success: true,
    rmaNumber,
    message: `Your ${eligibilityType === 'warranty' ? 'warranty claim' : 'return request'} (${rmaNumber}) has been submitted. We'll be in touch within 1–2 business days.`
  });
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
  console.log(`\nNatur Athletics Returns Portal`);
  console.log(`Running at: http://localhost:${PORT}`);
  console.log(`Shopify store: ${SHOPIFY_DOMAIN}\n`);
});
