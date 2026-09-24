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
  if (!endpoint || !siteRoot ||
      ![siteRoot, siteRoot + 'index.html'].includes(location.pathname) || window.goatcounter) return;

  window.goatcounter = {
    path: '/',
    title: 'Europe Drone Events · 2026',
    referrer: '',
    no_events: true,
  };

  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://gc.zgo.at/count.js';
  script.setAttribute('data-goatcounter', endpoint);
  document.head.appendChild(script);
})();
