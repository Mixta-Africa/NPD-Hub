/* views/documents.js — Document Centre: folders, uploads to Drive. */

import { db, get, ref, set } from '../core/firebase.js';
import { currentRole, currentUser } from '../core/state.js';
import { callGAS } from '../core/gas.js';
import { formatDate } from '../data/status.js';
import { getProductsFresh } from '../data/products-cache.js';

/* ══ DOCUMENT CENTRE ═══════════════════════════════════════ */
let DOC_FOLDERS = [
  { id: 'f1',  name: '01 - Market Research & Survey',  pillarIds: ['p3'] },
  { id: 'f2',  name: '02 - Design & Development Docs', pillarIds: ['p4'] },
  { id: 'f3',  name: '03 - Financial Model',            pillarIds: ['p5','p10'] },
  { id: 'f4',  name: '04 - AMC Presentation Deck',      pillarIds: ['p6','p7','p8'] },
  { id: 'f5',  name: '05 - Legal Documentation',        pillarIds: ['p9'] },
  { id: 'f6',  name: '06 - Factsheet & Brief',          pillarIds: ['p9'] },
  { id: 'f7',  name: '07 - Marketing Materials',        pillarIds: ['p11'] },
  { id: 'f8',  name: '08 - Progress Reports',           pillarIds: [] },
];

export let docsProductsCache  = {};
let docsSelectedProduct = '';

export function renderDocuments(el) {
  el.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title">Document Centre</h1>
        <p class="view-subtitle">Upload documents per SOP pillar — synced to Google Drive</p>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        ${currentRole === 'admin' ? '<button class="btn-outline" onclick="showAddDocFolder()" style="font-size:12px;">+ Add folder</button>' : ''}
        <select id="docs-product-sel" class="select-field" onchange="docsSelectProduct()">
          <option value="">Select a product...</option>
        </select>
      </div>
    </div>
    <div id="add-folder-panel"></div>
    <div id="docs-body"><div class="loading-row" style="padding:24px;">Loading products...</div></div>`;
  loadDocFolders().then(() => loadDocsProducts());
}

async function loadDocFolders() {
  try {
    const snap = await get(ref(db, 'config/docFolders'));
    if (snap.exists()) {
      const saved = snap.val();
      const extra = Array.isArray(saved) ? saved : Object.values(saved);
      // Merge: keep defaults, add any saved extras not in defaults
      const defaultIds = DOC_FOLDERS.map(f => f.id);
      extra.forEach(f => { if (!defaultIds.includes(f.id)) DOC_FOLDERS.push(f); });
    }
  } catch(e) { /* use defaults */ }
}

window.showAddDocFolder = () => {
  const panel = document.getElementById('add-folder-panel');
  if (!panel) return;
  panel.innerHTML =
    '<div class="panel" style="margin-bottom:16px;">' +
      '<div class="panel-header"><span class="panel-title">Add new folder</span></div>' +
      '<div class="panel-body" style="display:flex;gap:10px;align-items:flex-end;">' +
        '<div style="flex:1;"><label class="form-label">Folder name</label>' +
          '<input id="new-folder-name" class="input-field" placeholder="e.g. 09 - New Department Docs" style="width:100%;"/></div>' +
        '<div style="flex:1;"><label class="form-label">Google Drive folder URL (optional)</label>' +
          '<input id="new-folder-url" class="input-field" placeholder="https://drive.google.com/..." style="width:100%;"/></div>' +
        '<div style="display:flex;gap:6px;">' +
          '<button class="btn-primary" onclick="confirmAddDocFolder()">Add</button>' +
          '<button class="btn-outline" onclick="document.getElementById(\'add-folder-panel\').innerHTML=\'\'">Cancel</button>' +
        '</div>' +
      '</div>' +
    '</div>';
};

window.confirmAddDocFolder = async () => {
  const name = (document.getElementById('new-folder-name')?.value || '').trim();
  const url  = (document.getElementById('new-folder-url')?.value  || '').trim();
  if (!name) { showToast('Folder name is required', 'error'); return; }
  const newFolder = { id: 'f_' + Date.now(), name, pillarIds: [], driveUrl: url || null };
  DOC_FOLDERS.push(newFolder);
  // Save extras (non-default folders) to Firebase
  const extras = DOC_FOLDERS.filter(f => !['f1','f2','f3','f4','f5','f6','f7','f8'].includes(f.id));
  await set(ref(db, 'config/docFolders'), extras);
  showToast('Folder added: ' + name, 'success');
  document.getElementById('add-folder-panel').innerHTML = '';
  // Re-render current product if selected
  if (docsSelectedProduct && docsProductsCache[docsSelectedProduct]) {
    renderDocsFolders(docsProductsCache[docsSelectedProduct]);
  }
};

async function loadDocsProducts() {
  docsProductsCache = await getProductsFresh();
  const active = Object.values(docsProductsCache).filter(p => p.status !== 'archived');
  const sel = document.getElementById('docs-product-sel');
  if (!sel) return;
  active.forEach(p => {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = p.name; sel.appendChild(o);
  });
  if (active.length > 0) {
    sel.value = active[0].id;
    docsSelectedProduct = active[0].id;
    renderDocsFolders(active[0]);
  } else {
    document.getElementById('docs-body').innerHTML =
      '<div class="panel"><div class="empty-state"><span class="empty-icon" style="color:var(--text-muted);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg></span><h3>No products yet</h3><p>Create a product first.</p></div></div>';
  }
}

window.docsSelectProduct = () => {
  const id = document.getElementById('docs-product-sel')?.value;
  if (!id) return;
  docsSelectedProduct = id;
  renderDocsFolders(docsProductsCache[id]);
};

function renderDocsFolders(prod) {
  const body = document.getElementById('docs-body');
  if (!body) return;

  const driveBtn = prod.driveUrl
    ? `<a href="${prod.driveUrl}" target="_blank" class="btn-outline" style="font-size:12px;text-decoration:none;display:inline-flex;align-items:center;gap:6px;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        Open in Google Drive
       </a>`
    : '<span class="muted" style="font-size:12px;">Drive folder not yet created (complete onboarding first)</span>';

  body.innerHTML = `
    <div class="docs-header-row">
      <div>
        <div style="font-size:15px;font-weight:600;">${prod.name}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">Launch: ${formatDate(prod.launchDate)}</div>
      </div>
      ${driveBtn}
    </div>
    <div class="docs-grid" id="docs-grid">
      ${DOC_FOLDERS.map(f => renderDocFolder(f, prod)).join('')}
    </div>`;
}

function renderDocFolder(folder, prod) {
  const docs   = prod.documents?.[folder.id] || {};
  const docList = Object.values(docs);
  const count  = docList.length;

  const fileRows = docList.map(d => `
    <div class="doc-file-row">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;color:var(--text-muted)"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <span class="doc-file-name">${d.name}</span>
      <span class="doc-file-date">${new Date(d.uploadedAt).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</span>
      ${d.driveUrl ? `<a href="${d.driveUrl}" target="_blank" class="doc-file-link">View</a>` : ''}
    </div>`).join('');

  const uploadZone = currentRole === 'admin' ? `
    <div class="doc-upload-zone" id="zone-${folder.id}"
      ondragover="docDragOver(event,'${folder.id}')"
      ondragleave="docDragLeave('${folder.id}')"
      ondrop="docDrop(event,'${prod.id}','${folder.id}')">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--text-muted)"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      <span class="doc-upload-label">Drag files here or <label class="doc-upload-click">browse<input type="file" multiple style="display:none;" onchange="docFileSelected(event,'${prod.id}','${folder.id}')"/></label></span>
    </div>` : '';

  return `
    <div class="doc-folder-card">
      <div class="doc-folder-header">
        <div class="doc-folder-name">${folder.name}</div>
        <span class="doc-folder-count">${count} file${count!==1?'s':''}</span>
      </div>
      <div class="doc-file-list">${fileRows || '<div class="doc-empty">No files uploaded yet</div>'}</div>
      ${uploadZone}
      <div class="doc-uploading" id="uploading-${folder.id}" style="display:none;">
        <span class="spinner-sm"></span> Uploading to Drive...
      </div>
    </div>`;
}

/* ── DRAG & DROP HANDLERS ── */
window.docDragOver = (e, folderId) => {
  e.preventDefault();
  document.getElementById(`zone-${folderId}`)?.classList.add('drag-over');
};
window.docDragLeave = (folderId) => {
  document.getElementById(`zone-${folderId}`)?.classList.remove('drag-over');
};
window.docDrop = (e, productId, folderId) => {
  e.preventDefault();
  document.getElementById(`zone-${folderId}`)?.classList.remove('drag-over');
  uploadDocFiles(Array.from(e.dataTransfer.files || []), productId, folderId);
};
window.docFileSelected = (e, productId, folderId) => {
  uploadDocFiles(Array.from(e.target.files || []), productId, folderId);
  e.target.value = ''; // so picking the same file(s) again still fires onchange
};

// Sequential, not parallel — several base64-encoded uploads hitting the
// Apps Script backend at once risks rate-limiting or a partial/confusing
// failure state. One at a time, with the count visible, is slower but
// predictable — and this is a rare bulk action, not a hot path.
async function uploadDocFiles(files, productId, folderId) {
  if (!files || files.length === 0) return;
  const uploadingEl = document.getElementById(`uploading-${folderId}`);
  for (let i = 0; i < files.length; i++) {
    if (uploadingEl && files.length > 1) {
      uploadingEl.querySelector('span:last-child') && (uploadingEl.querySelector('span:last-child').textContent = ' Uploading ' + (i + 1) + ' of ' + files.length + '...');
    }
    await uploadDocFile(files[i], productId, folderId);
  }
}

async function uploadDocFile(file, productId, folderId) {
  const uploadingEl = document.getElementById(`uploading-${folderId}`);
  const zoneEl      = document.getElementById(`zone-${folderId}`);
  if (uploadingEl) uploadingEl.style.display = 'flex';
  if (zoneEl)      zoneEl.style.display = 'none';

  try {
    // Convert file to base64
    const base64 = await fileToBase64(file);
    const folder  = DOC_FOLDERS.find(f => f.id === folderId);
    const prod    = docsProductsCache[productId];

    const result = await callGAS('uploadDocument', {
      productId,
      productName:  prod.name,
      folderId,
      folderName:   folder.name,
      fileName:     file.name,
      fileType:     file.type,
      fileBase64:   base64,
      uploadedBy:   currentUser.email,
      driveUrl:     prod.driveUrl || null,
    });

    if (!result.ok) throw new Error(result.error || 'Upload failed');

    // Save document metadata to Firebase
    const docId  = 'doc_' + Date.now();
    const docMeta = {
      id:         docId,
      name:       file.name,
      folderId,
      driveUrl:   result.fileUrl || null,
      uploadedBy: currentUser.email,
      uploadedAt: Date.now(),
      size:       file.size,
    };
    await set(ref(db, `products/${productId}/documents/${folderId}/${docId}`), docMeta);

    // Update local cache + re-render
    if (!docsProductsCache[productId].documents) docsProductsCache[productId].documents = {};
    if (!docsProductsCache[productId].documents[folderId]) docsProductsCache[productId].documents[folderId] = {};
    docsProductsCache[productId].documents[folderId][docId] = docMeta;

    showToast(`${file.name} uploaded successfully.`, 'success');
    renderDocsFolders(docsProductsCache[productId]);

  } catch(e) {
    showToast('Upload failed: ' + e.message, 'error');
    if (uploadingEl) uploadingEl.style.display = 'none';
    if (zoneEl)      zoneEl.style.display = 'flex';
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
