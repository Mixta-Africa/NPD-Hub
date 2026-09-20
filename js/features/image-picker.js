/* features/image-picker.js — Project picture picker (photo search or upload). */

import { db, ref, update } from '../core/firebase.js';
import { productListCache } from '../data/products-cache.js';

/* ══ PROJECT PICTURE PICKER ═══════════════════════════════════
   Two ways in: search real photos (Wikimedia Commons — public,
   no API key required) matching the project name/description, or
   upload a photo from your device. Reusable from onboarding, the
   edit form, and directly off the dashboard thumbnail.
   ══════════════════════════════════════════════════════════════ */
window.showImagePicker = (initialQuery, onSelect) => {
  let modal = document.getElementById('img-picker-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'img-picker-modal';
    modal.className = 'modal-overlay';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:2100;padding:20px;';
    document.body.appendChild(modal);
  }
  window.__imgPickerCallback = onSelect;
  modal.innerHTML = `
    <div style="background:#fff;border-radius:14px;width:100%;max-width:560px;max-height:86vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:var(--shadow-lg);">
      <div class="modal-header">
        <span class="modal-title">Project picture</span>
        <button class="modal-close" onclick="closeImagePicker()">✕</button>
      </div>
      <div style="display:flex;border-bottom:1px solid var(--border);flex-shrink:0;">
        <button id="imgp-tab-search" class="imgp-tab imgp-tab-active" onclick="imgPickerSwitchTab('search')">Search photos</button>
        <button id="imgp-tab-upload" class="imgp-tab" onclick="imgPickerSwitchTab('upload')">Upload from device</button>
      </div>
      <div style="padding:18px 20px;overflow-y:auto;flex:1;">
        <div id="imgp-pane-search">
          <div style="display:flex;gap:8px;margin-bottom:14px;">
            <input type="text" id="imgp-query" class="input-field" value="${(initialQuery||'').replace(/"/g,'&quot;')}" placeholder="e.g. padel tennis court" onkeydown="if(event.key==='Enter'){event.preventDefault();imgPickerSearch();}"/>
            <button class="btn-primary-sm" onclick="imgPickerSearch()">Search</button>
          </div>
          <div id="imgp-results" class="imgp-grid"><div class="muted" style="font-size:12px;padding:12px 0;">Search to see photo options.</div></div>
        </div>
        <div id="imgp-pane-upload" style="display:none;">
          <input type="file" id="imgp-file" accept="image/*" style="display:none;" onchange="imgPickerFileSelected(event)"/>
          <div onclick="document.getElementById('imgp-file').click()" style="border:2px dashed var(--border-mid);border-radius:10px;padding:32px;text-align:center;cursor:pointer;color:var(--text-muted);font-size:12px;">
            Click to choose an image from your device<br/><span style="font-size:10px;">Max 1.5MB</span>
          </div>
          <div id="imgp-upload-preview" style="margin-top:14px;"></div>
        </div>
      </div>
    </div>`;
  modal.style.display = 'flex';
  if ((initialQuery||'').trim()) window.imgPickerSearch();
};

window.closeImagePicker = () => {
  const modal = document.getElementById('img-picker-modal');
  if (modal) modal.style.display = 'none';
};

window.imgPickerSwitchTab = (tab) => {
  document.getElementById('imgp-tab-search')?.classList.toggle('imgp-tab-active', tab === 'search');
  document.getElementById('imgp-tab-upload')?.classList.toggle('imgp-tab-active', tab === 'upload');
  document.getElementById('imgp-pane-search').style.display = tab === 'search' ? 'block' : 'none';
  document.getElementById('imgp-pane-upload').style.display = tab === 'upload' ? 'block' : 'none';
};

window.imgPickerSearch = async () => {
  const q = document.getElementById('imgp-query')?.value.trim();
  const resultsEl = document.getElementById('imgp-results');
  if (!q || !resultsEl) return;
  resultsEl.innerHTML = '<div class="muted" style="font-size:12px;padding:12px 0;">Searching…</div>';
  try {
    const url = 'https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=' +
      encodeURIComponent(q) + '&gsrlimit=15&prop=imageinfo&iiprop=url&iiurlwidth=400&format=json&origin=*';
    const res  = await fetch(url);
    const data = await res.json();
    const pages  = data?.query?.pages ? Object.values(data.query.pages) : [];
    const images = pages
      .map(p => p.imageinfo?.[0])
      .filter(i => i && i.thumburl && /\.(jpe?g|png)(\?|$)/i.test(i.thumburl));
    if (images.length === 0) {
      resultsEl.innerHTML = '<div class="muted" style="font-size:12px;padding:12px 0;">No photos found — try a different search term.</div>';
      return;
    }
    resultsEl.innerHTML = images.slice(0, 9).map(img =>
      `<div class="imgp-thumb"><img src="${img.thumburl}" loading="lazy"/></div>`
    ).join('');
    // Wire clicks via DOM refs rather than inline attrs — thumburls can contain characters unsafe for onclick strings
    Array.from(resultsEl.querySelectorAll('.imgp-thumb')).forEach((el, i) => {
      el.onclick = () => window.imgPickerSelect(images[i].thumburl);
    });
  } catch(e) {
    resultsEl.innerHTML = '<div class="muted" style="font-size:12px;padding:12px 0;">Search failed. Check your connection and try again.</div>';
  }
};

window.imgPickerSelect = (url) => {
  if (typeof window.__imgPickerCallback === 'function') window.__imgPickerCallback(url);
  closeImagePicker();
};

window.imgPickerFileSelected = (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 1.5 * 1024 * 1024) { showToast('Please choose an image under 1.5MB.', 'error'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    const preview = document.getElementById('imgp-upload-preview');
    preview.innerHTML =
      `<img src="${dataUrl}" style="width:100%;max-height:220px;object-fit:cover;border-radius:8px;margin-bottom:10px;"/>
       <button class="btn-primary" id="imgp-use-upload" style="width:100%;">Use this photo</button>`;
    document.getElementById('imgp-use-upload').onclick = () => window.imgPickerSelect(dataUrl);
  };
  reader.readAsDataURL(file);
};

// Convenience wrapper used by the create/edit forms — reads the project name
// field itself so the picker call site never has to juggle it.
window.pickProjectImage = (hiddenInputId, previewWrapId, nameFieldId) => {
  const q = document.getElementById(nameFieldId || 'f-name')?.value.trim() || '';
  window.showImagePicker(q, (url) => {
    const input = document.getElementById(hiddenInputId);
    if (input) input.value = url;
    const wrap = document.getElementById(previewWrapId);
    if (wrap) wrap.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;"/>`;
  });
};

// Change a picture directly from a live dashboard/list thumbnail — commits straight to Firebase.
window.changeProjectPicture = (id, name) => {
  window.showImagePicker(name || '', async (url) => {
    try {
      await update(ref(db, 'products/' + id), { imageUrl: url, updatedAt: Date.now() });
      if (productListCache[id]) productListCache[id].imageUrl = url;
      document.querySelectorAll(`img[data-product-thumb="${id}"]`).forEach(img => img.src = url);
      showToast('Project picture updated.', 'success');
    } catch(e) {
      showToast('Could not update the picture.', 'error');
    }
  });
};
