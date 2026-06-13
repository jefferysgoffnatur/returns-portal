/* ============================================
   NATUR ATHLETICS — RETURNS PORTAL FRONTEND
   ============================================ */

const API_BASE = '/api';
const RETURN_WINDOW_DAYS = 30;
const WARRANTY_WINDOW_DAYS = 180;

// App state
const state = {
  currentStep: 1,
  order: null,
  selectedItems: [],
  eligibilityType: null,   // 'return' | 'warranty' | 'mixed'
  requestType: 'return',   // 'return' | 'exchange' | 'warranty'
  exchangeSelections: {},  // { itemId: { variantId, variantTitle } }
  returnReason: null,
  additionalNotes: null,
  photos: [],
  rmaNumber: null
};

// ============================================
// STEP NAVIGATION
// ============================================

function goToStep(step) {
  document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`step${step}`).classList.add('active');

  if (step <= 4) {
    document.querySelectorAll('.step').forEach(el => {
      const s = parseInt(el.dataset.step);
      el.classList.remove('active', 'completed');
      if (s < step) el.classList.add('completed');
      if (s === step) el.classList.add('active');
    });
    document.querySelectorAll('.step-divider').forEach((d, i) => {
      d.classList.toggle('completed', i < step - 1);
    });
  }

  document.getElementById('stepsIndicator').style.display = step === 5 ? 'none' : 'flex';
  state.currentStep = step;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ============================================
// STEP 1: ORDER LOOKUP
// ============================================

document.getElementById('lookupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const orderNumber = document.getElementById('orderNumber').value.trim();
  const email = document.getElementById('email').value.trim();
  const error = document.getElementById('lookupError');
  const btn = document.getElementById('lookupBtn');

  hideError(error);

  if (!orderNumber || !email) {
    showError(error, 'Please enter your order number and email address.');
    return;
  }

  setLoading(btn, true);

  try {
    const res = await fetch(`${API_BASE}/lookup-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderNumber, email })
    });

    const data = await res.json();

    if (!res.ok) {
      showError(error, data.error || 'Unable to find your order. Please check your details and try again.');
      return;
    }

    state.order = data.order;
    renderStep2();
    goToStep(2);

  } catch (err) {
    showError(error, 'A connection error occurred. Please try again.');
  } finally {
    setLoading(btn, false);
  }
});

// ============================================
// STEP 2: ITEM SELECTION
// ============================================

function renderStep2() {
  const order = state.order;

  const orderDate = new Date(order.createdAt);
  document.getElementById('orderSummary').innerHTML = `
    <strong>Order ${order.name}</strong> &mdash; Placed ${formatDate(orderDate)} &mdash; ${order.daysSinceOrder} days ago
  `;

  // Reset resolution choice
  document.getElementById('resolutionChoice').classList.add('hidden');
  document.getElementById('optionReturn').classList.add('selected');
  document.getElementById('optionExchange').classList.remove('selected');
  document.querySelector('input[name="resolutionType"][value="return"]').checked = true;
  state.requestType = 'return';
  state.selectedItems = [];
  state.exchangeSelections = {};

  const list = document.getElementById('itemsList');
  list.innerHTML = '';

  if (order.lineItems.length === 0) {
    list.innerHTML = '<p class="no-items">No eligible items found for this order.</p>';
    return;
  }

  order.lineItems.forEach(item => {
    const card = document.createElement('div');
    card.className = `item-card${item.eligible ? '' : ' ineligible'}`;
    card.dataset.itemId = item.id;

    card.innerHTML = `
      <div class="item-checkbox"></div>
      <img class="item-image" src="${item.image || 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'64\' height=\'64\' viewBox=\'0 0 64 64\'%3E%3Crect width=\'64\' height=\'64\' fill=\'%23f5f5f5\'/%3E%3C/svg%3E'}" alt="${escapeHtml(item.title)}" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'64\' height=\'64\' viewBox=\'0 0 64 64\'%3E%3Crect width=\'64\' height=\'64\' fill=\'%23f5f5f5\'/%3E%3C/svg%3E'" />
      <div class="item-info">
        <div class="item-name">${escapeHtml(item.title)}</div>
        ${item.variantTitle ? `<div class="item-variant">${escapeHtml(item.variantTitle)}</div>` : ''}
        <div class="item-price">${formatPrice(item.price, order.currency)}</div>
        ${item.eligibilityType === 'warranty' ? '<div class="item-badge warranty-badge">Warranty Only</div>' : ''}
        ${!item.eligible ? `<div class="item-ineligible-reason">${escapeHtml(item.ineligibleReason)}</div>` : ''}
      </div>
    `;

    if (item.eligible) {
      card.addEventListener('click', () => toggleItem(card, item));
    }

    list.appendChild(card);
  });
}

function toggleItem(card, item) {
  const isSelected = card.classList.contains('selected');

  if (isSelected) {
    card.classList.remove('selected');
    state.selectedItems = state.selectedItems.filter(i => i.id !== item.id);
  } else {
    card.classList.add('selected');
    state.selectedItems.push(item);
  }

  // Determine eligibility type
  const hasWarrantyOnly = state.selectedItems.some(i => i.eligibilityType === 'warranty');
  const hasReturn = state.selectedItems.some(i => i.eligibilityType === 'return');

  if (hasWarrantyOnly && hasReturn) {
    state.eligibilityType = 'mixed';
  } else if (hasWarrantyOnly) {
    state.eligibilityType = 'warranty';
  } else {
    state.eligibilityType = 'return';
  }

  // Show resolution choice only for return-eligible items (not warranty)
  const resolutionChoice = document.getElementById('resolutionChoice');
  if (state.selectedItems.length > 0 && state.eligibilityType === 'return') {
    resolutionChoice.classList.remove('hidden');
  } else {
    resolutionChoice.classList.add('hidden');
    // Reset to return if warranty or mixed
    document.querySelector('input[name="resolutionType"][value="return"]').checked = true;
    document.getElementById('optionReturn').classList.add('selected');
    document.getElementById('optionExchange').classList.remove('selected');
    state.requestType = state.eligibilityType === 'warranty' ? 'warranty' : 'return';
  }

  document.getElementById('toStep3').disabled = state.selectedItems.length === 0;
  const itemsError = document.getElementById('itemsError');
  if (state.selectedItems.length > 0) hideError(itemsError);
}

// Resolution choice radio buttons
document.querySelectorAll('input[name="resolutionType"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    state.requestType = e.target.value;
    document.getElementById('optionReturn').classList.toggle('selected', e.target.value === 'return');
    document.getElementById('optionExchange').classList.toggle('selected', e.target.value === 'exchange');
  });
});

document.getElementById('backToStep1').addEventListener('click', () => goToStep(1));

document.getElementById('toStep3').addEventListener('click', () => {
  const itemsError = document.getElementById('itemsError');

  if (state.selectedItems.length === 0) {
    showError(itemsError, 'Please select at least one item.');
    return;
  }

  if (state.eligibilityType === 'mixed') {
    showError(itemsError, 'Please submit warranty claims and standard returns separately.');
    return;
  }

  hideError(itemsError);

  // If warranty, set requestType to warranty
  if (state.eligibilityType === 'warranty') {
    state.requestType = 'warranty';
  }

  renderStep3();
  goToStep(3);
});

// ============================================
// STEP 3: DETAILS
// ============================================

async function renderStep3() {
  const isExchange = state.requestType === 'exchange';
  const isWarranty = state.requestType === 'warranty';

  // Update heading
  const titles = { return: 'Return Details', exchange: 'Exchange Details', warranty: 'Warranty Claim Details' };
  document.getElementById('step3Title').textContent = titles[state.requestType] || 'Details';
  document.getElementById('reasonLabel').textContent = isExchange ? 'Reason for Exchange' : isWarranty ? 'Reason for Claim' : 'Reason for Return';

  // Selected items summary
  const summaryEl = document.getElementById('selectedItemsSummary');
  const typeLabel = isWarranty ? 'Warranty Claim' : isExchange ? 'Exchange' : 'Return';
  summaryEl.innerHTML = `
    <h4>Selected for ${typeLabel}</h4>
    ${state.selectedItems.map(item => `
      <div class="summary-item">
        <span>${escapeHtml(item.title)}${item.variantTitle ? ` — ${escapeHtml(item.variantTitle)}` : ''}</span>
        <span>${formatPrice(item.price, state.order.currency)}</span>
      </div>
    `).join('')}
  `;

  // Exchange: show variant selectors
  const exchangeGroup = document.getElementById('exchangeSelectionsGroup');
  const exchangeList = document.getElementById('exchangeSelectionsList');
  exchangeList.innerHTML = '';

  if (isExchange) {
    exchangeGroup.classList.remove('hidden');
    exchangeList.innerHTML = '<p class="field-hint">Loading available options...</p>';

    // Fetch variants for each selected item's product
    const variantsByProduct = {};
    for (const item of state.selectedItems) {
      if (item.productId && !variantsByProduct[item.productId]) {
        try {
          const res = await fetch(`${API_BASE}/variants/${item.productId}`);
          const data = await res.json();
          variantsByProduct[item.productId] = data.variants || [];
        } catch {
          variantsByProduct[item.productId] = [];
        }
      }
    }

    exchangeList.innerHTML = '';
    state.selectedItems.forEach(item => {
      const variants = variantsByProduct[item.productId] || [];
      const otherVariants = variants.filter(v => v.title !== (item.variantTitle || 'Default Title'));

      const wrapper = document.createElement('div');
      wrapper.className = 'exchange-item-selector';

      if (otherVariants.length === 0) {
        wrapper.innerHTML = `
          <div class="exchange-item-name">${escapeHtml(item.title)}${item.variantTitle ? ` — ${escapeHtml(item.variantTitle)}` : ''}</div>
          <p class="field-hint" style="color:#c0392b;">No other sizes or colors are currently available for this item. Please return for a refund instead.</p>
        `;
      } else {
        wrapper.innerHTML = `
          <div class="exchange-item-name">${escapeHtml(item.title)}${item.variantTitle ? ` — ${escapeHtml(item.variantTitle)}` : ''}</div>
          <select class="exchange-variant-select" data-item-id="${escapeHtml(item.id)}">
            <option value="">Select a size / color...</option>
            ${otherVariants.map(v => `<option value="${escapeHtml(v.id)}" data-title="${escapeHtml(v.title)}">${escapeHtml(v.title)}</option>`).join('')}
          </select>
        `;
      }

      exchangeList.appendChild(wrapper);
    });

    // Wire up variant selects
    exchangeList.querySelectorAll('.exchange-variant-select').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const itemId = e.target.dataset.itemId;
        const opt = e.target.options[e.target.selectedIndex];
        state.exchangeSelections[itemId] = {
          variantId: e.target.value,
          variantTitle: opt.dataset.title || ''
        };
      });
    });
  } else {
    exchangeGroup.classList.add('hidden');
  }

  // Update reason options
  const reasonSelect = document.getElementById('returnReason');
  reasonSelect.innerHTML = '<option value="">Select a reason...</option>';

  if (isWarranty) {
    reasonSelect.innerHTML += `
      <option value="stitching_defect">Stitching came undone</option>
      <option value="material_separation">Materials came apart</option>
      <option value="sole_defect">Sole defect</option>
      <option value="structural_defect">Structural defect</option>
      <option value="other_defect">Other manufacturing defect</option>
    `;
  } else {
    reasonSelect.innerHTML += `
      <option value="wrong_size">Wrong size</option>
      <option value="wrong_item">Wrong item received</option>
      <option value="not_as_described">Not as described</option>
      <option value="changed_mind">Changed my mind</option>
      <option value="other">Other</option>
    `;
  }

  // Resolution info box
  const resolutionBox = document.getElementById('resolutionInfoBox');
  if (isWarranty) {
    resolutionBox.innerHTML = `
      <div class="resolution-fixed warranty">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        <div>
          <strong>Warranty Replacement</strong>
          <span>If approved, we'll send the same item in the same size and color.</span>
        </div>
      </div>
    `;
  } else if (isExchange) {
    resolutionBox.innerHTML = `
      <div class="resolution-fixed exchange">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
        <div>
          <strong>Exchange</strong>
          <span>We'll send a return label. Once we receive your item, we'll ship your replacement.</span>
        </div>
      </div>
    `;
  } else {
    resolutionBox.innerHTML = `
      <div class="resolution-fixed refund">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
        <div>
          <strong>Refund to Original Payment Method</strong>
          <span>Processed within 5–10 business days after we receive your return.</span>
        </div>
      </div>
    `;
  }

  // Photo field
  const photoHint = document.querySelector('.field-hint');
  if (isWarranty) {
    photoHint.textContent = 'Photos are required for warranty claims. Please show the defect clearly. Max 6 photos, 10MB each.';
    document.getElementById('photoUpload').required = true;
  } else {
    photoHint.textContent = 'Upload photos if helpful. Max 6 photos, 10MB each.';
    document.getElementById('photoUpload').required = false;
  }
}

// Return reason "other" toggle
document.getElementById('returnReason').addEventListener('change', (e) => {
  const otherGroup = document.getElementById('otherReasonGroup');
  otherGroup.style.display = e.target.value === 'other' ? 'block' : 'none';
});

// Photo upload
document.getElementById('photoUpload').addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  state.photos = files.slice(0, 6);
  renderPhotoPreviews();
});

function renderPhotoPreviews() {
  const container = document.getElementById('photoPreviews');
  container.innerHTML = '';
  state.photos.forEach(file => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = document.createElement('img');
      img.className = 'photo-thumb';
      img.src = e.target.result;
      img.alt = file.name;
      container.appendChild(img);
    };
    reader.readAsDataURL(file);
  });
}

document.getElementById('backToStep2').addEventListener('click', () => goToStep(2));

document.getElementById('detailsForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const detailsError = document.getElementById('detailsError');
  hideError(detailsError);

  const reason = document.getElementById('returnReason').value;
  if (!reason) {
    showError(detailsError, 'Please select a reason.');
    return;
  }

  if (state.requestType === 'warranty' && state.photos.length === 0) {
    showError(detailsError, 'Please upload at least one photo showing the defect for warranty claims.');
    return;
  }

  // Validate exchange selections
  if (state.requestType === 'exchange') {
    for (const item of state.selectedItems) {
      const sel = state.exchangeSelections[item.id];
      if (!sel || !sel.variantId) {
        const exchangeList = document.getElementById('exchangeSelectionsList');
        const hasNoOptions = exchangeList.querySelector(`[data-item-id="${item.id}"]`) === null;
        if (!hasNoOptions) {
          showError(detailsError, `Please select a replacement size/color for ${escapeHtml(item.title)}.`);
          return;
        }
      }
    }
  }

  state.returnReason = reason;
  state.additionalNotes = document.getElementById('additionalNotes').value.trim();

  renderStep4();
  goToStep(4);
});

// ============================================
// STEP 4: REVIEW & CONFIRM
// ============================================

function renderStep4() {
  const reasonLabels = {
    wrong_size: 'Wrong size',
    wrong_item: 'Wrong item received',
    not_as_described: 'Not as described',
    changed_mind: 'Changed my mind',
    other: document.getElementById('otherReason')?.value || 'Other',
    stitching_defect: 'Stitching came undone',
    material_separation: 'Materials came apart',
    sole_defect: 'Sole defect',
    structural_defect: 'Structural defect',
    other_defect: 'Other manufacturing defect'
  };

  const resolutionLabel = state.requestType === 'warranty'
    ? 'Warranty replacement (same size & color)'
    : state.requestType === 'exchange'
      ? 'Exchange for a different size/color'
      : 'Refund to original payment method';

  // Exchange detail lines
  let exchangeDetails = '';
  if (state.requestType === 'exchange') {
    exchangeDetails = `
      <div class="review-row">
        <span class="review-label">Replacement</span>
        <span class="review-value">${state.selectedItems.map(item => {
          const sel = state.exchangeSelections[item.id];
          return sel && sel.variantTitle
            ? `${escapeHtml(item.title)} → <strong>${escapeHtml(sel.variantTitle)}</strong>`
            : escapeHtml(item.title);
        }).join('<br/>')}</span>
      </div>
    `;
  }

  const reviewBlock = document.getElementById('reviewBlock');
  reviewBlock.innerHTML = `
    <div class="review-row">
      <span class="review-label">Order</span>
      <span class="review-value">${escapeHtml(state.order.name)}</span>
    </div>
    <div class="review-row">
      <span class="review-label">Request Type</span>
      <span class="review-value">${state.requestType === 'warranty' ? 'Warranty Claim' : state.requestType === 'exchange' ? 'Exchange' : 'Return'}</span>
    </div>
    <div class="review-row">
      <span class="review-label">Items</span>
      <span class="review-value">${state.selectedItems.map(i =>
        `${escapeHtml(i.title)}${i.variantTitle ? ` (${escapeHtml(i.variantTitle)})` : ''}`
      ).join('<br/>')}</span>
    </div>
    ${exchangeDetails}
    <div class="review-row">
      <span class="review-label">Reason</span>
      <span class="review-value">${escapeHtml(reasonLabels[state.returnReason] || state.returnReason)}</span>
    </div>
    <div class="review-row">
      <span class="review-label">Resolution</span>
      <span class="review-value">${resolutionLabel}</span>
    </div>
    ${state.photos.length > 0 ? `
    <div class="review-row">
      <span class="review-label">Photos</span>
      <span class="review-value">${state.photos.length} photo${state.photos.length !== 1 ? 's' : ''} attached</span>
    </div>` : ''}
    ${state.additionalNotes ? `
    <div class="review-row">
      <span class="review-label">Notes</span>
      <span class="review-value">${escapeHtml(state.additionalNotes)}</span>
    </div>` : ''}
  `;

  const policyNote = document.getElementById('policyNoteText');
  if (state.requestType === 'warranty') {
    policyNote.innerHTML = 'Warranty covers manufacturing defects within <strong>6 months</strong> of delivery. Normal wear and tear is not covered. You are responsible for return shipping costs.';
  } else if (state.requestType === 'exchange') {
    policyNote.innerHTML = 'Items must be unworn and in like-new condition. You are responsible for return shipping costs. Your replacement will ship once we receive your return.';
  } else {
    policyNote.innerHTML = 'Items must be unworn and in like-new condition to qualify for a refund. You are responsible for return shipping costs. Allow 5–10 business days after we receive your return.';
  }
}

document.getElementById('backToStep3').addEventListener('click', () => goToStep(3));

document.getElementById('submitReturn').addEventListener('click', async () => {
  const submitError = document.getElementById('submitError');
  const btn = document.getElementById('submitReturn');
  hideError(submitError);
  setLoading(btn, true);

  try {
    const formData = new FormData();
    formData.append('orderId', state.order.id);
    formData.append('orderName', state.order.name);
    formData.append('email', state.order.email);
    formData.append('requestType', state.requestType);
    formData.append('eligibilityType', state.eligibilityType);
    formData.append('items', JSON.stringify(state.selectedItems));
    formData.append('exchangeSelections', JSON.stringify(state.exchangeSelections));
    formData.append('reason', state.returnReason);
    formData.append('additionalNotes', state.additionalNotes || '');
    state.photos.forEach((photo, i) => formData.append(`photo_${i}`, photo));

    const res = await fetch(`${API_BASE}/submit-return`, {
      method: 'POST',
      body: formData
    });

    const data = await res.json();

    if (!res.ok) {
      showError(submitError, data.error || 'Submission failed. Please try again or contact us.');
      return;
    }

    state.rmaNumber = data.rmaNumber;
    renderSuccess(data);
    goToStep(5);

  } catch (err) {
    showError(submitError, 'A connection error occurred. Please try again.');
  } finally {
    setLoading(btn, false);
  }
});

// ============================================
// STEP 5: SUCCESS
// ============================================

function renderSuccess(data) {
  const headingEl = document.getElementById('successHeading');
  const messageEl = document.getElementById('successMessage');
  const detailsEl = document.getElementById('successDetails');

  if (state.requestType === 'exchange') {
    headingEl.textContent = 'Exchange Submitted!';
    messageEl.textContent = data.message || "We've received your exchange request.";
    detailsEl.innerHTML = `
      <strong>Exchange Request #${escapeHtml(data.rmaNumber)}</strong><br/>
      We'll send you a return label within 1 business day. Please ship your items back in their original packaging. Once we receive them, we'll ship your replacement.<br/><br/>
      A confirmation email has been sent to <strong>${escapeHtml(state.order.email)}</strong>.
    `;
  } else if (state.requestType === 'warranty') {
    headingEl.textContent = 'Warranty Claim Submitted!';
    messageEl.textContent = data.message || "We've received your warranty claim.";
    detailsEl.innerHTML = `
      <strong>Warranty Claim #${escapeHtml(data.rmaNumber)}</strong><br/>
      Our team will review your claim and respond within 1–2 business days. Do not ship your item back until you hear from us.<br/><br/>
      A confirmation email has been sent to <strong>${escapeHtml(state.order.email)}</strong>.
    `;
  } else {
    headingEl.textContent = 'Return Submitted!';
    messageEl.textContent = data.message || "We've received your return request.";
    detailsEl.innerHTML = `
      <strong>Return Request #${escapeHtml(data.rmaNumber)}</strong><br/>
      We'll send you a return label within 1 business day. Please ship your unworn items back in their original packaging. Your refund will be processed within 5–10 business days of receiving your return.<br/><br/>
      A confirmation email has been sent to <strong>${escapeHtml(state.order.email)}</strong>.
    `;
  }
}

// ============================================
// UTILITIES
// ============================================

function showError(el, message) {
  el.textContent = message;
  el.classList.remove('hidden');
}

function hideError(el) {
  el.textContent = '';
  el.classList.add('hidden');
}

function setLoading(btn, loading) {
  const text = btn.querySelector('.btn-text');
  const loader = btn.querySelector('.btn-loader');
  btn.disabled = loading;
  if (text) text.style.display = loading ? 'none' : '';
  if (loader) loader.classList.toggle('hidden', !loading);
}

function formatDate(date) {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatPrice(price, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(price);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
