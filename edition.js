/* Split a complete edition without changing a single source character. */
(function (root) {
  'use strict';

  function split(fullText, expectedCount) {
    if (typeof fullText !== 'string' || !fullText.length) return null;
    if (expectedCount !== undefined && (!Number.isSafeInteger(expectedCount) || expectedCount < 1)) return null;
    const headings = [];
    let fence = null;

    // Keep source offsets rather than rebuilding lines, including CRLF and CR.
    const lines = /[^\r\n]*(?:\r\n|\n|\r|$)/g;
    for (const match of fullText.matchAll(lines)) {
      if (!match[0].length) continue;
      const line = match[0].replace(/(?:\r\n|\n|\r)$/, '');
      const fenceLine = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (fence) {
        if (fenceLine && fenceLine[1][0] === fence.char && fenceLine[1].length >= fence.length && /^[ \t]*$/.test(fenceLine[2])) fence = null;
        continue;
      }
      if (fenceLine) {
        // CommonMark does not permit backticks in a backtick fence's info string.
        if (fenceLine[1][0] === '`' && fenceLine[2].includes('`')) return null;
        fence = { char: fenceLine[1][0], length: fenceLine[1].length };
        continue;
      }
      const heading = /^ {0,3}(#{1,2})(?:[ \t]+(.*)|[ \t]*)$/.exec(line);
      if (!heading) continue;
      const title = (heading[2] || '').replace(/[ \t]+#+[ \t]*$/, '').trim();
      const numbered = /^(\d+)[.)](?:[ \t]+(.*)|$)/.exec(title);
      headings.push({
        offset: match.index,
        level: heading[1].length,
        number: numbered ? numbered[1] : null,
        title: numbered ? (numbered[2] || '').trim() : title
      });
    }
    // An unfinished code fence or an ambiguous outline uses the whole-text fallback.
    if (fence) return null;
    const stories = headings.filter(heading => heading.number !== null);
    if (!stories.length || (expectedCount !== undefined && stories.length !== expectedCount)) return null;
    const level = stories[0].level;
    if (stories.some((heading, index) => heading.number !== String(index + 1) || heading.level !== level || !heading.title)) return null;

    const first = stories[0].offset;
    const last = stories[stories.length - 1].offset;
    // A sibling/parent non-story section between news items makes the outline ambiguous.
    if (headings.some(heading => heading.offset > first && heading.offset < last && heading.number === null && heading.level <= level)) return null;
    const ending = headings.find(heading => heading.offset > last && heading.level <= level);
    const conclusionOffset = ending ? ending.offset : fullText.length;

    return {
      intro: fullText.slice(0, first),
      stories: stories.map((heading, index) => fullText.slice(heading.offset, index + 1 < stories.length ? stories[index + 1].offset : conclusionOffset)),
      conclusion: fullText.slice(conclusionOffset)
    };
  }

  root.BriefEdition = Object.freeze({ split });
})(globalThis);
