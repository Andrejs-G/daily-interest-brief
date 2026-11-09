/* Shared schema validation for the page and service worker. No dependencies. */
(function (root) {
  'use strict';
  const categories = Object.freeze(['Macro', 'Pure Alpha', 'Geopolitics', 'Shipping', 'EV/Porsche', 'AI', 'NHL']);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  function string(value, max = 3000) {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
  }
  function validateBrief(data) {
    if (!object(data) || data.schemaVersion !== 1 || typeof data.demo !== 'boolean') throw new Error('Неверная версия или формат сводки.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date || '') || !Number.isFinite(Date.parse(data.date + 'T00:00:00Z')) || new Date(data.date + 'T00:00:00Z').toISOString().slice(0, 10) !== data.date) throw new Error('Неверная дата выпуска.');
    if (typeof data.updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(data.updatedAt) || !Number.isFinite(Date.parse(data.updatedAt))) throw new Error('Неверное время обновления.');
    const updatedDay = data.updatedAt.slice(0, 10);
    if (new Date(updatedDay + 'T00:00:00Z').toISOString().slice(0, 10) !== updatedDay) throw new Error('Неверная календарная дата обновления.');
    if (data.headline !== undefined && !string(data.headline, 500)) throw new Error('Неверный анонс выпуска.');
    if (!Array.isArray(data.items) || data.items.length !== 5) throw new Error('В выпуске должно быть ровно пять новостей.');
    const ids = new Set();
    for (const item of data.items) {
      if (!object(item) || !string(item.id, 100) || ids.has(item.id)) throw new Error('Идентификаторы новостей должны быть уникальными.');
      ids.add(item.id);
      if (!Array.isArray(item.categories) || !item.categories.length || item.categories.some(c => !categories.includes(c)) || new Set(item.categories).size !== item.categories.length) throw new Error('Неизвестная или повторяющаяся категория.');
      if (!string(item.title, 250) || !string(item.summary) || !string(item.impact)) throw new Error('В новости отсутствует заголовок, описание или значение.');
      if (item.source != null) {
        if (!object(item.source) || !string(item.source.name, 200)) throw new Error('Неверный источник новости.');
        if (item.source.url != null) {
          if (!string(item.source.url, 2048)) throw new Error('Неверная ссылка на источник.');
          let url;
          try { url = new URL(item.source.url); } catch (_) { throw new Error('Нужна полная ссылка на источник.'); }
          if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Источник должен использовать HTTP или HTTPS без данных входа.');
        }
      }
    }
    return data;
  }
  root.BriefFeed = Object.freeze({ categories, validateBrief });
})(globalThis);
