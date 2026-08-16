const cameras = window.__CAMERAS__ || [];
const grid = document.querySelector('#grid');
const search = document.querySelector('#search');
const sentinel = document.querySelector('#sentinel');
const modal = document.querySelector('#modal');
const modalBody = document.querySelector('#modal-body');
const close = document.querySelector('#close');
let filtered = cameras;
let visible = 6;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

function imageUrl(camera) {
  return `/api/image?path=${encodeURIComponent(camera.imagePath)}`;
}

function renderAppend() {
  const already = grid.children.length;
  const target = Math.min(visible, filtered.length);
  if (already > target) grid.textContent = '';
  for (let i = grid.children.length; i < target; i++) {
    const camera = filtered[i];
    const article = document.createElement('article');
    article.className = 'camera-card';
    article.innerHTML = `<button class="camera-open" data-index="${i}" aria-label="View ${escapeHtml(camera.label)}"><div class="image-shell"><img src="${imageUrl(camera)}" alt="${escapeHtml(camera.label)}" width="480" height="270" loading="lazy" decoding="async"></div><div class="card-copy"><h2>${escapeHtml(camera.label)}</h2><span>${camera.stream ? 'Live capable' : 'Snapshot'}</span></div></button>`;
    grid.append(article);
  }
}

search.addEventListener('input', () => {
  const q = search.value.trim().toLowerCase();
  filtered = q ? cameras.filter((camera) => camera.label.toLowerCase().includes(q)) : cameras;
  visible = 6;
  grid.textContent = '';
  renderAppend();
});

grid.addEventListener('click', (event) => {
  const button = event.target.closest('.camera-open');
  if (!button) return;
  const camera = filtered[Number(button.dataset.index)];
  if (!camera) return;
  modalBody.innerHTML = `<h2>${escapeHtml(camera.label)}</h2><img src="${imageUrl(camera)}" alt="${escapeHtml(camera.label)}" width="960" height="540">${camera.stream ? '<p>Live stream metadata available; HLS intentionally omitted from the benchmark critical path.</p>' : ''}`;
  modal.showModal();
});

close.addEventListener('click', () => modal.close());
modal.addEventListener('click', (event) => { if (event.target === modal) modal.close(); });

new IntersectionObserver(([entry]) => {
  if (!entry.isIntersecting || visible >= filtered.length) return;
  visible += 6;
  renderAppend();
}, { rootMargin: '250px 0px' }).observe(sentinel);
