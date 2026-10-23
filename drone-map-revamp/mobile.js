'use strict';

// Reuse the live register and controls in phone sheets; return them to their
// original positions when the viewport grows. No duplicate map or replay state.
window.createMobileLayout = ({pause, showAll, refit, t, total, countries, year}) => {
  const $ = id => document.getElementById(id);
  const query = matchMedia('(max-width:760px)');
  const workspace = document.querySelector('.workspace');
  const timeline = document.querySelector('.timeline');
  const sidebar = document.querySelector('.sidebar');
  const legend = $('map-legend');
  const trend = document.querySelector('.trend');
  const steps = document.querySelector('.step-controls');
  const showAllButton = $('show-all');
  const about = $('about-button').querySelector('[data-i18n]');
  const homes = new Map([sidebar, legend, trend, steps, showAllButton].map(element => {
    const anchor = document.createComment('desktop position');
    element.before(anchor);
    return [element, anchor];
  }));
  const restore = element => homes.get(element).after(element);
  const make = (tag, className, html) => {
    const element = document.createElement(tag);
    element.className = className;
    element.innerHTML = html;
    return element;
  };
  const edition = make('span', 'mobile-edition', '');
  document.querySelector('.brand>span').append(edition);
  const overview = make('div', 'mobile-overview', '<span class="mobile-totals"></span><button class="mobile-key" aria-haspopup="dialog" aria-controls="mobile-key-dialog"><span class="mobile-key-colors" aria-hidden="true"><i></i><i></i><i></i></span><span data-i18n="mobile.key"></span></button>');
  workspace.prepend(overview);
  const sheet = (kind, titleKey, closeKey, icon) => {
    const dialog = make('dialog', `mobile-${kind}-dialog`, `<div class="mobile-sheet-head"><h2 id="mobile-${kind}-title" data-i18n="${titleKey}"></h2><button data-i18n-aria="${closeKey}">${icon}</button></div>`);
    dialog.id = `mobile-${kind}-dialog`;
    dialog.setAttribute('aria-labelledby', `mobile-${kind}-title`);
    dialog.querySelector('button').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
    });
    document.body.append(dialog);
    return dialog;
  };
  const records = sheet('records', 'register.aria', 'mobile.back', '↓');
  const key = sheet('key', 'mobile.key', 'mobile.closeKey', '×');
  const keyNote = make('p', '', '<span data-i18n="map.note"></span>');
  key.append(keyNote);
  const trendWrap = make('details', 'mobile-trend', '<summary data-i18n="mobile.trends"></summary>');
  trendWrap.open = true;
  homes.get(trend).after(trendWrap);
  const count = make('span', 'mobile-timeline-count', '');
  document.querySelector('.timeline-heading').append(count);
  const more = make('button', 'mobile-more', '···');
  more.dataset.i18nAria = 'mobile.more';
  more.setAttribute('aria-expanded', 'false');
  more.setAttribute('aria-controls', 'mobile-extra-controls cumulative');
  document.querySelector('.playback').append(more);
  const extra = make('div', 'mobile-extra-controls', '');
  extra.id = 'mobile-extra-controls';
  timeline.append(extra);
  more.addEventListener('click', () => {
    const open = timeline.classList.toggle('expanded');
    more.setAttribute('aria-expanded', String(open));
  });
  const trigger = make('button', 'mobile-records-trigger', '<span class="handle" aria-hidden="true"></span><span class="trigger-row"><strong data-i18n="mobile.explore"></strong><small></small><span class="up" aria-hidden="true">↑</span></span>');
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', records.id);
  workspace.append(trigger);
  trigger.addEventListener('click', () => { pause(); records.showModal(); });
  overview.querySelector('button').addEventListener('click', () => { pause(); key.showModal(); });
  // Close before the app selects a record so its detail panel can receive focus.
  $('event-list').addEventListener('click', event => {
    if (records.open && event.target.closest('[data-id]')) records.close();
  }, true);
  document.querySelector('.brand').addEventListener('click', event => {
    if (!query.matches || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    showAll();
  });
  function layout() {
    document.documentElement.classList.toggle('mobile-layout', query.matches);
    about.dataset.i18n = query.matches ? 'mobile.about' : 'about.button';
    about.textContent = t(about.dataset.i18n);
    if (query.matches) {
      records.append(sidebar);
      keyNote.before(legend);
      trendWrap.append(trend);
      extra.append(steps, showAllButton);
    } else {
      records.close();
      key.close();
      [sidebar, legend, trend, steps, showAllButton].forEach(restore);
    }
    // Let Leaflet's ResizeObserver see the new map height before fitting it.
    requestAnimationFrame(() => requestAnimationFrame(refit));
  }
  query.addEventListener('change', layout);
  layout();
  return {
    update(visibleCount) {
      edition.textContent = `${t('brand.secondary').replace(/^\/\s*/, '')} / ${year}`;
      const totals = overview.querySelector('.mobile-totals');
      totals.replaceChildren();
      for (const [value, label, separator] of [[total, 'stats.records', ' · '], [countries, 'stats.countries', '']]) {
        const strong = document.createElement('strong');
        strong.textContent = value.toLocaleString(document.documentElement.lang);
        totals.append(strong, ` ${t(label)}${separator}`);
      }
      count.textContent = visibleCount;
      trigger.querySelector('small').textContent = visibleCount;
    }
  };
};
