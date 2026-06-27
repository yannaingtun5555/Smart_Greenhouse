// Page registry — see PAGE_MAP.md for full file mapping per screen.
const PAGE_FILES = [
  ['overview', 'pages/overview.html'],
  ['sensors', 'pages/sensors.html'],
  ['control', 'pages/control.html'],
  ['schedules', 'pages/schedules.html'],
  ['analytics', 'pages/analytics.html'],
  ['profile', 'pages/profile.html'],
];

async function loadFragmentIntoSection(sectionId, filePath) {
  const section = document.getElementById(`page-${sectionId}`);
  if (!section) return;

  try {
    const response = await fetch(filePath, { cache: 'no-cache' });
    if (!response.ok) return;
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const sourceSection = doc.querySelector(`section#page-${sectionId}`);
    if (sourceSection?.matches('[data-page-fragment="ready"]')) {
      section.innerHTML = sourceSection.innerHTML;
      for (const attr of Array.from(sourceSection.attributes)) {
        if (attr.name === 'id') continue;
        section.setAttribute(attr.name, attr.value);
      }
    }
  } catch (_) {
    // Keep the inline fallback markup if the fragment cannot be loaded.
  }
}

export async function loadPageFragments() {
  await Promise.all(PAGE_FILES.map(([id, htmlPath]) => loadFragmentIntoSection(id, htmlPath)));
}
