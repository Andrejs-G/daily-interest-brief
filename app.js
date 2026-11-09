/* Daily Interest Brief — vanilla JS. Serve over HTTPS or localhost. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const { categories, validateBrief } = globalThis.BriefFeed;
  const baseURL = new URL('./', document.baseURI);
  const storageKey = 'daily-interest-brief:validated:v1:' + baseURL.href;
  let currentBrief = null;
  let activeCategory = 'Все';
  let loading = false;
  let sourceMode = 'loading';
  let lastAttemptAt = 0;
  let renderedFullText = null;
  const MIN_AUTO_REFRESH_MS = 60000;
  const VISIBLE_REFRESH_MS = 5 * 60000;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function readSaved() {
    try { return validateBrief(JSON.parse(localStorage.getItem(storageKey))); }
    catch (_) { return null; }
  }
  function saveBrief(data) {
    try { localStorage.setItem(storageKey, JSON.stringify(data)); }
    catch (_) { /* Private mode / quota: worker cache can still provide offline data. */ }
  }
  function setConnection(mode) {
    sourceMode = mode;
    $('connection').dataset.state = mode;
    $('connection-text').textContent = ({ loading: 'Загрузка', network: 'С сервера', cached: 'Сохранено', error: 'Нет данных' })[mode];
  }
  function buildFilters() {
    for (const category of ['Все', ...categories]) {
      const button = element('button', 'filter', category);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(category === activeCategory));
      button.addEventListener('click', () => {
        activeCategory = category;
        updateFilters();
        renderCards();
      });
      $('filters').append(button);
    }
  }
  function updateFilters() {
    for (const button of $('filters').children) button.setAttribute('aria-pressed', String(button.textContent === activeCategory));
  }
  function renderCards() {
    $('news').replaceChildren();
    if (!currentBrief) return;
    const items = currentBrief.items.filter(item => activeCategory === 'Все' || item.categories.includes(activeCategory));
    $('visible-count').textContent = String(items.length).padStart(2, '0');
    $('empty-state').hidden = items.length > 0;
    for (const item of items) {
      const article = element('article', 'news-card');
      const top = element('div', 'card-top');
      const tags = element('div', 'category-tags');
      item.categories.forEach(category => tags.append(element('span', 'category-tag', category)));
      top.append(tags, element('span', 'story-number', String(currentBrief.items.indexOf(item) + 1).padStart(2, '0') + ' / 05'));
      const title = element('h3', '', item.title);
      const impact = element('div', 'impact');
      impact.append(element('span', 'impact-label', 'ПОЧЕМУ ЭТО ВАЖНО'), element('p', '', item.impact));
      const source = element('div', 'source-line');
      if (item.source?.url) {
        const link = element('a', 'source-link', item.source.name);
        link.href = item.source.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.setAttribute('aria-label', item.source.name + ' — источник, в новой вкладке');
        link.append(element('span', 'source-arrow', '↗'));
        source.append(link);
      } else {
        source.append(element('span', '', item.source?.name || (currentBrief.demo ? 'Демо · без источника' : 'Источник не указан')));
      }
      source.append(element('span', '', currentBrief.demo ? 'ДЕМО-СЮЖЕТ' : 'DAILY BRIEF'));
      article.append(top, title, element('p', 'summary', item.summary), impact, source);
      $('news').append(article);
    }
  }
  function updateStaleNote() {
    if (!currentBrief) { $('stale-note').hidden = true; return; }
    const parts = new Intl.DateTimeFormat('en', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Riga' }).formatToParts(new Date());
    const value = type => parts.find(part => part.type === type).value;
    const today = value('year') + '-' + value('month') + '-' + value('day');
    const stale = currentBrief.date < today;
    $('stale-note').hidden = !stale;
    if (stale) {
      const editionDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(currentBrief.date + 'T12:00:00Z'));
      $('stale-note').textContent = 'Показан выпуск от ' + editionDate + ' Более свежий выпуск пока не получен.';
    }
  }
  function renderFullEdition(data) {
    const text = typeof data.fullText === 'string' ? data.fullText : '';
    $('full-edition').hidden = !text;
    if (text !== renderedFullText) {
      const content = $('full-edition-content');
      content.replaceChildren();
      if (text) content.append(globalThis.BriefMarkdown.render(text));
      renderedFullText = text;
    }
    const readingText = text || data.items.map(item => item.title + ' ' + item.summary + ' ' + item.impact).join(' ');
    const words = readingText.trim().split(/\s+/).filter(Boolean).length;
    $('reading-time').textContent = '~ ' + Math.max(1, Math.ceil(words / 180)) + ' мин чтения';
  }
  function showBrief(data) {
    currentBrief = data;
    $('demo-note').hidden = !data.demo;
    const date = new Date(data.date + 'T12:00:00Z');
    $('edition-date').textContent = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
    $('edition-date').dateTime = data.date;
    $('edition-time').textContent = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Riga' }).format(new Date(data.updatedAt)) + ' · Рига';
    $('edition-time').title = 'Время обновления выпуска: ' + data.updatedAt;
    $('headline').textContent = data.headline || 'Рынки, технологии и мир — в одном коротком выпуске.';
    $('total-count').textContent = String(data.items.length);
    $('error-state').hidden = true;
    renderCards();
    renderFullEdition(data);
    updateStaleNote();
  }
  async function refresh() {
    if (loading) return;
    lastAttemptAt = Date.now();
    loading = true;
    $('refresh').disabled = true;
    $('retry').disabled = true;
    $('news').setAttribute('aria-busy', 'true');
    $('feed-status').textContent = 'Проверяем обновления…';
    setConnection('loading');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(new URL('news.json', baseURL), { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('Сервер вернул ошибку ' + response.status + '.');
      const data = validateBrief(await response.json());
      showBrief(data);
      saveBrief(data);
      const cached = response.headers.get('X-Brief-Cache') === 'offline';
      setConnection(cached ? 'cached' : 'network');
      $('feed-status').textContent = cached ? 'Сохранённый выпуск · обновление пока недоступно.' : 'Выпуск Daily Interest Brief загружен.';
    } catch (error) {
      const saved = currentBrief || readSaved();
      if (saved) {
        showBrief(saved);
        setConnection('cached');
        $('feed-status').textContent = 'Сохранённый выпуск · не удалось получить обновление.';
      } else {
        setConnection('error');
        $('error-state').hidden = false;
        $('empty-state').hidden = true;
        $('feed-status').textContent = 'Нет доступной сводки.';
        $('error-description').textContent = location.protocol === 'file:'
          ? 'Откройте приложение через локальный веб-сервер или HTTPS-сайт. Инструкция — в README.'
          : 'Проверьте подключение и корректность news.json, затем нажмите Refresh.';
      }
    } finally {
      clearTimeout(timeout);
      loading = false;
      $('refresh').disabled = false;
      $('retry').disabled = false;
      $('news').setAttribute('aria-busy', 'false');
    }
  }
  function autoRefresh() {
    updateStaleNote();
    if (document.visibilityState !== 'visible' || loading || Date.now() - lastAttemptAt < MIN_AUTO_REFRESH_MS) return;
    refresh();
  }
  async function setupOffline() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) {
      $('offline-status').textContent = 'Для офлайн-режима нужен HTTPS или localhost в поддерживаемом браузере.';
      return;
    }
    try {
      const registration = await navigator.serviceWorker.register(new URL('service-worker.js', baseURL), { scope: baseURL.pathname, updateViaCache: 'none' });
      // Registration alone does not prove the shell and JSON were cached.
      function requestStatus() {
        const worker = navigator.serviceWorker.controller || registration.active;
        if (worker) worker.postMessage({ type: 'BRIEF_CACHE_STATUS' });
      }
      navigator.serviceWorker.addEventListener('message', event => {
        if (event.data?.type === 'BRIEF_CACHE_STATUS') {
          $('offline-status').textContent = event.data.ready
            ? 'Офлайн-копия готова. Сохранённый выпуск доступен без сети.'
            : 'Офлайн-копия ещё не готова. Откройте сводку при доступной сети.';
        }
      });
      let hadController = Boolean(navigator.serviceWorker.controller);
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // A new shell is ready: load its HTML and assets together.
        if (hadController) { location.reload(); return; }
        hadController = true;
        requestStatus();
      });
      function watchInstall() {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'redundant' && !registration.active) {
            $('offline-status').textContent = 'Офлайн-копия не создана. Проверьте сеть и повторно откройте страницу.';
          }
        });
      }
      registration.addEventListener('updatefound', watchInstall);
      watchInstall();
      navigator.serviceWorker.ready.then(requestStatus);
      requestStatus();
    } catch (_) {
      $('offline-status').textContent = 'Офлайн-копия не создана. При подключении к сети сводка работает обычным образом.';
    }
  }
  buildFilters();
  const saved = readSaved();
  if (saved) showBrief(saved);
  $('refresh').addEventListener('click', refresh);
  $('retry').addEventListener('click', refresh);
  $('show-all').addEventListener('click', () => { activeCategory = 'Все'; updateFilters(); renderCards(); $('filters').firstElementChild.focus(); });
  $('install-help').addEventListener('click', () => $('install-dialog').showModal());
  $('close-dialog').addEventListener('click', () => $('install-dialog').close());
  $('close-dialog-done').addEventListener('click', () => $('install-dialog').close());
  $('install-dialog').addEventListener('click', event => { if (event.target === $('install-dialog')) { const r = event.target.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) event.target.close(); } });
  window.addEventListener('online', autoRefresh);
  window.addEventListener('pageshow', autoRefresh);
  document.addEventListener('visibilitychange', autoRefresh);
  setInterval(autoRefresh, VISIBLE_REFRESH_MS);
  window.addEventListener('offline', () => { if (currentBrief && sourceMode !== 'loading') { setConnection('cached'); $('feed-status').textContent = 'Нет сети · открыт последний загруженный выпуск.'; } });
  // First fetch and worker install can proceed independently.
  refresh();
  setupOffline();
})();
