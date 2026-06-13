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

async function sendCustomerEmail({ rmaNumber, order, items, requestType, exchangeSelections }) {
  const transporter = buildTransporter();
  if (!transporter) {
    console.log('[Email] SMTP not configured — skipping customer confirmation.');
    return;
  }

  const typeLabel = requestType === 'warranty' ? 'Warranty Claim' : requestType === 'exchange' ? 'Exchange Request' : 'Return Request';

  let instructions = '';
  let instructionsHtml = '';

  if (requestType === 'exchange') {
    const lines = items.map(i => {
      const sel = exchangeSelections && exchangeSelections[i.id];
      return `${i.title}${i.variantTitle ? ` (${i.variantTitle})` : ''} → ${sel ? sel.variantTitle : 'see details'}`;
    });
    instructions = `You've requested the following exchanges:\n${lines.map(l => `- ${l}`).join('\n')}\n\nWe'll send you a return label within 1 business day. Once we receive your items, we'll ship your replacement.`;
    instructionsHtml = `<p>You've requested the following exchanges:</p><ul>${lines.map(l => `<li>${l}</li>`).join('')}</ul><p>We'll send you a return label within 1 business day. Once we receive your items, we'll ship your replacement.</p>`;
  } else if (requestType === 'warranty') {
    instructions = `Our team will review your warranty claim and follow up within 1–2 business days. Please do not ship your item back until you hear from us.`;
    instructionsHtml = `<p>${instructions}</p>`;
  } else {
    instructions = `We'll send you a return label within 1 business day. Please ship your items back in their original packaging. Once received, we'll process your refund within 5–10 business days.`;
    instructionsHtml = `<p>${instructions}</p>`;
  }

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#222;">
      <img src="https://www.naturathletics.us/cdn/shop/files/2024_Natur_Athletics_Full_Horizontal_Logo_Black_59b3e33b-295e-4e43-8a2b-197b2bfbb8d9_600x.svg?v=1724418365" alt="Natur Athletics" style="height:36px;margin-bottom:24px;display:block;" />
      <h2 style="font-size:20px;font-weight:600;margin:0 0 4px;">${typeLabel} Received</h2>
      <p style="color:#888;margin:0 0 24px;font-size:14px;">RMA: <strong>${rmaNumber}</strong> &mdash; Order ${order.name}</p>
      ${instructionsHtml}
      <p style="color:#888;font-size:12px;margin-top:32px;border-top:1px solid #eee;padding-top:16px;">
        Questions? Contact us at <a href="mailto:support@naturathletics.us" style="color:#222;">support@naturathletics.us</a>
      </p>
    </div>
  `;

  await transporter.sendMail({
    from: EMAIL_FROM,
    to: order.email,
    subject: `${typeLabel} Received — ${rmaNumber}`,
    text: `${typeLabel} received.\n\nRMA: ${rmaNumber}\nOrder: ${order.name}\n\n${instructions}`,
    html
  });

  console.log(`[Email] Customer confirmation sent to ${order.email} for ${rmaNumber}`);
}

async function sendReturnEmail({ rmaNumber, order, items, requestType, eligibilityType, reason, notes, photoCount, exchangeSelections }) {
  const transporter = buildTransporter();
  if (!transporter) {
    console.log('[Email] SMTP not configured — skipping notification email.');
    return;
  }

  const type = requestType || eligibilityType;
  const typeLabel = type === 'warranty' ? 'Warranty Claim' : type === 'exchange' ? 'Exchange Request' : 'Return Request';
  const itemList  = items.map(i => `- ${i.title}${i.variantTitle ? ` (${i.variantTitle})` : ''}`).join('\n');

  // Exchange detail rows for email
  const exchangeRows = type === 'exchange' && exchangeSelections
    ? `<tr><td style="padding:8px;font-weight:bold;color:#555;">Replacements</td><td style="padding:8px;">${
        items.map(i => {
          const sel = exchangeSelections[i.id];
          return `${i.title}${i.variantTitle ? ` (${i.variantTitle})` : ''} → ${sel ? sel.variantTitle : 'TBD'}`;
        }).join('<br/>')
      }</td></tr>`
    : '';

  const html = `
    <h2>New ${typeLabel} — ${rmaNumber}</h2>
    <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;">
      <tr><td style="padding:8px;font-weight:bold;color:#555;">RMA</td><td style="padding:8px;">${rmaNumber}</td></tr>
      <tr><td style="padding:8px;font-weight:bold;color:#555;">Order</td><td style="padding:8px;">${order.name}</td></tr>
      <tr><td style="padding:8px;font-weight:bold;color:#555;">Customer Email</td><td style="padding:8px;">${order.email}</td></tr>
      <tr><td style="padding:8px;font-weight:bold;color:#555;">Type</td><td style="padding:8px;">${typeLabel}</td></tr>
      <tr><td style="padding:8px;font-weight:bold;color:#555;">Items</td><td style="padding:8px;">${items.map(i => `${i.title}${i.variantTitle ? ` (${i.variantTitle})` : ''}`).join('<br/>')}</td></tr>
      ${exchangeRows}
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
      // Update in-memory env so current process works immediately
      process.env.SHOPIFY_ACCESS_TOKEN = data.access_token;
      console.log(`[OAuth] New access token: ${data.access_token}`);

      // Try to write to local .env (works in dev, skipped on Railway/Render)
      try {
        const fs = require('fs');
        const envPath = require('path').join(__dirname, '.env');
        let envContent = fs.readFileSync(envPath, 'utf8');
        envContent = envContent.replace(/SHOPIFY_ACCESS_TOKEN=.*/, `SHOPIFY_ACCESS_TOKEN=${data.access_token}`);
        fs.writeFileSync(envPath, envContent);
        console.log('[OAuth] Token written to .env');
      } catch (writeErr) {
        console.log('[OAuth] Could not write .env (expected on Railway) — copy token from logs above.');
      }

      res.send(`
        <html><body style="font-family:sans-serif;padding:40px;max-width:600px;margin:auto;">
          <h2>Authorization successful!</h2>
          <p>Your new Shopify access token is:</p>
          <code style="display:block;background:#f4f4f4;padding:16px;border-radius:6px;word-break:break-all;font-size:14px;">${data.access_token}</code>
          <p style="margin-top:24px;color:#555;">
            <strong>If running on Railway/Render:</strong> Copy the token above and paste it into your
            <code>SHOPIFY_ACCESS_TOKEN</code> environment variable in your hosting dashboard, then redeploy.
          </p>
          <p><a href="/">Go to Returns Portal</a></p>
        </body></html>
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
// ROUTE: PRODUCT VARIANTS (for exchange size/color selection)
// ============================================

app.get('/api/variants/:productId', async (req, res) => {
  try {
    const data = await shopifyGet(`products/${req.params.productId}/variants.json?fields=id,title,option1,option2,option3`);
    res.json({ variants: data.variants || [] });
  } catch (err) {
    console.error('[Variants] Error:', err.message);
    res.status(500).json({ error: 'Could not load product options.' });
  }
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
    requestType = 'return',
    eligibilityType,
    items: itemsJson,
    exchangeSelections: exchangeSelectionsJson,
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

  let exchangeSelections = {};
  try {
    exchangeSelections = JSON.parse(exchangeSelectionsJson || '{}');
  } catch {
    exchangeSelections = {};
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
    const tagMap = { warranty: 'warranty-claim-requested', exchange: 'exchange-requested', return: 'return-requested' };
    const tag = tagMap[requestType] || 'return-requested';

    let noteDetails = `Items: ${items.map(i => i.title).join(', ')}. Reason: ${reason}.`;
    if (requestType === 'exchange' && Object.keys(exchangeSelections).length > 0) {
      const exchangeLines = items.map(i => {
        const sel = exchangeSelections[i.id];
        return sel ? `${i.title} → ${sel.variantTitle}` : i.title;
      });
      noteDetails += ` Replacements requested: ${exchangeLines.join(', ')}.`;
    }

    const typeWord = requestType === 'warranty' ? 'Warranty claim' : requestType === 'exchange' ? 'Exchange' : 'Return';
    const note = `[${rmaNumber}] ${typeWord} requested via portal on ${new Date().toISOString().split('T')[0]}. ${noteDetails}`;

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

  // Send store notification email
  try {
    await sendReturnEmail({
      rmaNumber,
      order: { id: orderId, name: orderName, email },
      items,
      requestType,
      eligibilityType,
      reason,
      notes: additionalNotes,
      photoCount,
      exchangeSelections
    });
  } catch (err) {
    console.error('[Email] Failed to send store notification:', err.message);
  }

  // Send customer confirmation email
  try {
    await sendCustomerEmail({
      rmaNumber,
      order: { id: orderId, name: orderName, email },
      items,
      requestType,
      exchangeSelections
    });
  } catch (err) {
    console.error('[Email] Failed to send customer confirmation:', err.message);
  }

  const typeWord = requestType === 'warranty' ? 'warranty claim' : requestType === 'exchange' ? 'exchange request' : 'return request';
  return res.json({
    success: true,
    rmaNumber,
    message: `Your ${typeWord} (${rmaNumber}) has been submitted. We'll be in touch within 1–2 business days.`
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
