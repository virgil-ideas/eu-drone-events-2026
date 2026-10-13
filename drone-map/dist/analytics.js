(() => {
  'use strict';

  // Set this to the account's public /count endpoint. No password or API key.
  // Set to an empty string to disable tracking.
  const endpoint = 'https://ideanathor.goatcounter.com/count';
  const siteRoots = {
    'https://droneincidents.eu': '/',
    'https://www.droneincidents.eu': '/',
    'https://virgil-ideas.github.io': '/eu-drone-events-2026/',
  };
  const siteRoot = siteRoots[location.origin];

  // Local development and other copies must not pollute the live site's totals.
  if (!endpoint || !siteRoot || window.goatcounter) return;
  const isMap = [siteRoot, siteRoot + 'index.html'].includes(location.pathname);
  // Record pages (events/…) are counted by their own path.
  const isRecordPage = location.pathname.startsWith(siteRoot + 'events/');
  if (!isMap && !isRecordPage) return;

  window.goatcounter = {
    path: isMap ? '/' : '/' + location.pathname.slice(siteRoot.length).replace(/index\.html$/, ''),
    title: isMap ? 'Europe Drone Events · 2026' : document.title,
    referrer: '',
    no_events: true,
  };

  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://gc.zgo.at/count.js';
  script.setAttribute('data-goatcounter', endpoint);
  document.head.appendChild(script);
})();
