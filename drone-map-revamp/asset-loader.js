'use strict';
(() => {
  const dataFiles = ['events.js', 'pages-data.js', 'media.js'];
  let assets;

  function url(name) {
    const version = assets?.[name];
    if (typeof version !== 'string' || !/^[a-f0-9]{16}$/.test(version)) {
      throw new Error(`Missing or invalid asset version: ${name}`);
    }
    return `${name}?v=${version}`;
  }

  async function loadData() {
    // One small uncached request per page load. A unique query also bypasses
    // shared caches that keep serving old files despite request cache headers.
    const response = await fetch(`asset-manifest.json?fresh=${Date.now()}`, {cache: 'no-store'});
    if (!response.ok) throw new Error(`Could not load asset manifest (${response.status})`);
    const manifest = await response.json();
    if (manifest.schemaVersion !== 1 || !manifest.assets) throw new Error('Invalid asset manifest');
    assets = manifest.assets;
    const urls = dataFiles.map(url);
    await Promise.all(urls.map(src => new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => { script.remove(); reject(new Error(`Could not load ${src}`)); };
      document.head.append(script);
    })));
    if (!Array.isArray(window.DRONE_DATA?.events) || !window.DRONE_PAGES || !window.DRONE_MEDIA) {
      throw new Error('Incomplete register data');
    }
  }

  window.DRONE_ASSETS = {url, loadData};
})();
