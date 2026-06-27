import { $, escapeHtml } from '../core/dom.js';
import { state } from '../core/store.js';
import { getResolvedApiBase } from '../core/api.js';

export function renderProfilePage() {
  const { user, greenhouses, schedules, sensorRows } = state;
  if (!user) return;

  // Avatar & name
  const avatarLarge = $('profile-avatar-large');
  const nameDisp    = $('profile-name-display');
  const emailDisp   = $('profile-email-display');
  const roleBadge   = $('profile-role-badge');
  if (avatarLarge) avatarLarge.textContent = (user.username || '?').slice(0, 1).toUpperCase();
  if (nameDisp)   nameDisp.textContent = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || '—';
  if (emailDisp)  emailDisp.textContent = user.email || '—';
  if (roleBadge)  roleBadge.innerHTML = user.is_staff ? '⭐ Staff' : '🌿 Farmer';

  // Form pre-fill
  const fi = $('profile-first'); if (fi) fi.value = user.first_name || '';
  const la = $('profile-last');  if (la) la.value = user.last_name  || '';
  const em = $('profile-email'); if (em) em.value = user.email      || '';
  const ph = $('profile-phone'); if (ph) ph.value = user.phone      || '';

  // Stats
  const ghCount   = $('profile-gh-count');      if (ghCount)   ghCount.textContent   = greenhouses.length;
  const rdCount   = $('profile-reading-count'); if (rdCount)   rdCount.textContent   = sensorRows.length > 0 ? `${sensorRows.length}+` : '—';
  const scCount   = $('profile-sched-count');   if (scCount)   scCount.textContent   = schedules.length;

  // API base
  const resolvedApiBase = getResolvedApiBase();
  const curBase = $('current-api-base'); if (curBase) curBase.textContent = resolvedApiBase;
  const apiInp  = $('api-base-input');   if (apiInp)  apiInp.value = resolvedApiBase;
}
