/* ui/shell.js — App chrome helpers: greeting, countdown, toasts, sidebar toggle. */

export function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

const _countdownTimers = {};
export function startCountdown(elId, launchDateStr) {
  if (_countdownTimers[elId]) clearInterval(_countdownTimers[elId]);
  const update = () => {
    const el = document.getElementById(elId);
    if (!el) { clearInterval(_countdownTimers[elId]); return; }
    const now    = new Date();
    const launch = new Date(launchDateStr);
    launch.setHours(23, 59, 59, 0);
    const diff   = launch - now;
    if (diff <= 0) {
      el.textContent = 'Launch day!';
      clearInterval(_countdownTimers[elId]);
      return;
    }
    
    // Upgraded Math: Days, Hours, Minutes, Seconds
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    
    // Display format: Only show days if there is 1 or more
    el.textContent = (d > 0 ? d + 'd ' : '') + h + 'h ' + m + 'm ' + s + 's';
  };
  update();
  _countdownTimers[elId] = setInterval(update, 1000);
}

window.showToast = (msg, type = 'info') => {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = `toast toast-${type} show`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3500);
};

window.toggleSidebar = () => {
  // Below the tablet breakpoint this opens/closes an off-canvas drawer
  // (see the @media rules); above it, it's reserved for a future desktop
  // collapse and is currently a no-op there — the class itself did
  // nothing before this, on any screen size.
  document.getElementById('sidebar').classList.toggle('mobile-open');
  document.getElementById('sidebar-backdrop')?.classList.toggle('show');
};

// Selecting a page closes the drawer automatically on mobile — nobody
// wants to navigate and then have to separately dismiss the menu.
export function closeMobileSidebar() {
  document.getElementById('sidebar')?.classList.remove('mobile-open');
  document.getElementById('sidebar-backdrop')?.classList.remove('show');
}
