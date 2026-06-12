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
  eligibilityType: null, // 'return' or 'warranty'
  returnReason: null,
  additionalNotes: null,
  photos: [],
  rmaNumber: null
};

// ============================================
// STEP NAVIGATION
// ============================================

function goToStep(step) {
  // Hide all panels
  document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
  // Show target panel
  document.getElementById(`step${step}`).classList.add('active');

  // Update step indicators (only steps 1-4)
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

  // Hide step indicator on success screen
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

  // Order summary
  const orderDate = new Date(order.createdAt);
  document.getElementById('orderSummary').innerHTML = `
    <strong>Order ${order.name}</strong> &mdash; Placed ${formatDate(orderDate)} &mdash; ${order.daysSinceOrder} days ago
  `;

  // Render items
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

  // Determine eligibility type from selected items
  // If any selected item is warranty-only, the whole request is warranty
  const hasWarrantyOnly = state.selectedItems.some(i => i.eligibilityType === 'warranty');
  const hasReturn = state.selectedItems.some(i => i.eligibilityType === 'return');

  if (hasWarrantyOnly && hasReturn) {
    // Mixed — disallow for simplicity, show guidance
    state.eligibilityType = 'mixed';
  } else if (hasWarrantyOnly) {
    state.eligibilityType = 'warranty';
  } else {
    state.eligibilityType = 'return';
  }

  document.getElementById('toStep3').disabled = state.selectedItems.length === 0;
  const itemsError = document.getElementById('itemsError');
  if (state.selectedItems.length > 0) hideError(itemsError);
}

document.getElementById('backToStep1').addEventListener('click', () => goToStep(1));

document.getElementById('toStep3').addEventListener('click', () => {
  const itemsError = document.getElementById('itemsError');

  if (state.selectedItems.length === 0) {
    showError(itemsError, 'Please select at least one item to return.');
    return;
  }

  if (state.eligibilityType === 'mixed') {
    showError(itemsError, 'Please submit warranty claims and standard returns separately. Select only items from the same eligibility type at once.');
    return;
  }

  hideError(itemsError);
  renderStep3();
  goToStep(3);
});

// ============================================
// STEP 3: RETURN DETAILS
// ============================================

function renderStep3() {
  // Selected items summary
  const summaryEl = document.getElementById('selectedItemsSummary');
  summaryEl.innerHTML = `
    <h4>Selected for ${state.eligibilityType === 'warranty' ? 'Warranty Claim' : 'Return'}</h4>
    ${state.selectedItems.map(item => `
      <div class="summary-item">
        <span>${escapeHtml(item.title)}${item.variantTitle ? ` — ${escapeHtml(item.variantTitle)}` : ''}</span>
        <span>${formatPrice(item.price, state.order.currency)}</span>
      </div>
    `).join('')}
  `;

  // Update reason options based on eligibility type
  const reasonSelect = document.getElementById('returnReason');
  reasonSelect.innerHTML = '<option value="">Select a reason...</option>';

  if (state.eligibilityType === 'warranty') {
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

  // Update resolution info box
  const resolutionBox = document.getElementById('resolutionInfoBox');
  if (state.eligibilityType === 'warranty') {
    resolutionBox.innerHTML = `
      <div class="resolution-fixed warranty">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        <div>
          <strong>Warranty Replacement</strong>
          <span>If approved, we'll send the same item in the same size and color.</span>
        </div>
      </div>
    `;
  } else {
    resolutionBox.innerHTML = `
      <div class="resolution-fixed refund">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
        <div>
          <strong>Refund to Original Payment Method</strong>
          <span>Processed within 5–10 business days after we receive and inspect your return.</span>
        </div>
      </div>
    `;
  }

  // Update photo field hint
  const photoHint = document.querySelector('.field-hint');
  if (state.eligibilityType === 'warranty') {
    photoHint.textContent = 'Photos are required for warranty claims. Please show the defect clearly. Max 6 photos, 10MB each.';
    document.getElementById('photoUpload').required = true;
  } else {
    photoHint.textContent = 'Upload photos if your item is defective or damaged. Max 6 photos, 10MB each.';
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
    showError(detailsError, 'Please select a reason for your return.');
    return;
  }

  if (state.eligibilityType === 'warranty' && state.photos.length === 0) {
    showError(detailsError, 'Please upload at least one photo showing the defect for warranty claims.');
    return;
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

  const resolutionLabel = state.eligibilityType === 'warranty'
    ? 'Warranty Replacement (same size & color)'
    : 'Refund to original payment method';

  const reviewBlock = document.getElementById('reviewBlock');
  reviewBlock.innerHTML = `
    <div class="review-row">
      <span class="review-label">Order</span>
      <span class="review-value">${escapeHtml(state.order.name)}</span>
    </div>
    <div class="review-row">
      <span class="review-label">Request Type</span>
      <span class="review-value">${state.eligibilityType === 'warranty' ? 'Warranty Claim' : 'Return'}</span>
    </div>
    <div class="review-row">
      <span class="review-label">Items</span>
      <span class="review-value">${state.selectedItems.map(i =>
        `${escapeHtml(i.title)}${i.variantTitle ? ` (${escapeHtml(i.variantTitle)})` : ''}`
      ).join('<br/>')}</span>
    </div>
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

  // Update policy note based on type
  const policyNote = document.getElementById('policyNoteText');
  if (state.eligibilityType === 'warranty') {
    policyNote.innerHTML = 'Warranty covers manufacturing defects within <strong>6 months</strong> of delivery. Normal wear and tear, misuse, or damage from water/heat are not covered. You are responsible for return shipping costs.';
  } else {
    policyNote.innerHTML = 'Items must be unworn and in like-new condition to qualify for a refund. You are responsible for return shipping costs. Please allow 5–10 business days for processing after we receive your return.';
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
    formData.append('eligibilityType', state.eligibilityType);
    formData.append('items', JSON.stringify(state.selectedItems));
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
  document.getElementById('successMessage').textContent = data.message;

  const shippingInstructions = state.eligibilityType === 'warranty'
    ? `Our team will review your warranty claim and respond within 5–7 business days. Do not ship your item back until you receive approval from us.`
    : `Please ship your unworn, like-new item(s) back to us at your own cost. We recommend using a trackable shipping method. Once received and inspected, your refund will be processed within 5–10 business days.`;

  document.getElementById('successDetails').innerHTML = `
    <strong>Return Request #${escapeHtml(data.rmaNumber)}</strong><br/>
    ${shippingInstructions}<br/><br/>
    A confirmation email has been sent to <strong>${escapeHtml(state.order.email)}</strong>.
  `;
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
