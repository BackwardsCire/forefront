'use strict';

/**
 * Forefront — what changed, in the user's words.
 *
 * Kept here rather than in a CHANGELOG.md because the application has to be
 * able to show it: there is no network, so it cannot fetch a file, and the
 * version badge in the header opens this list directly.
 *
 * Write entries for the person using Forefront, not for whoever wrote the
 * commit. "In Progress now holds three and refuses a fourth" — not "enforce
 * FOCUS_COMMITMENTS in the action layer". If an entry cannot be phrased as
 * something you would notice, it belongs in the git history and not here.
 *
 * Newest first. The top entry's version must equal C.VERSION; selftest.js
 * checks that, along with the rule that the major version IS the schema
 * version. See the versioning note in CLAUDE.md.
 */

(function (FF) {
  FF.CHANGELOG = [
    {
      version: '1.3',
      date: '2026-08-28',
      changes: [
        'The whole application is now available as a single file, for machines where nothing can be installed.',
        'There is a hosted copy you can just open, which works in Safari and Firefox as well as Chrome.',
        'Opening index.html without the folder it came from now explains itself instead of showing a blank page.',
        'Install instructions rewritten — Forefront never needed a server, and used to imply it did.'
      ]
    },
    {
      version: '1.2',
      date: '2026-08-27',
      changes: [
        'A cooler, calmer palette. The five weekly accents now all sit in a narrow blue-grey range.',
        'In Progress holds three and refuses a fourth, naming what is in the way. It will not swap one out for you.',
        'Just Do It sits beside your commitments in Focus, capped at five, so chores are to hand without becoming the page.',
        'The wordmark and mark are larger, so it is obvious which application you are looking at.'
      ]
    },
    {
      version: '1.1',
      date: '2026-08-26',
      changes: [
        'Light, dark, or match your system — from the header, or with T.',
        'A mark of its own, beside the wordmark and on the browser tab.',
        'Import understands what an assistant actually writes: comments, loose lane names, or a bare list of titles.',
        'Export can annotate itself, so you can hand the format to an assistant along with your board.',
        'Importing can add to your board instead of replacing it.'
      ]
    },
    {
      version: '1.0',
      date: '2026-08-26',
      changes: [
        'Focus View, the board, Quick Capture, the Monday review and the Data panel.',
        'Everything you have is in one JSON file you own, with an optional data file Forefront writes straight through to.'
      ]
    }
  ];
})(window.FF);
