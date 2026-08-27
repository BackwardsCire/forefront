#!/usr/bin/env node
/**
 * Dev-only: regenerate sample-data/template.jsonc.
 *
 * That file is the one to hand to an assistant along with "turn these sticky
 * notes into a Forefront file". It is the format explaining itself: every
 * comment in it comes from model.FORMAT_GUIDE, and the three cards below show
 * the smallest thing a card can be — a title and a lane, with everything else
 * filled in by the importer.
 *
 * It is generated rather than written by hand for the same reason
 * sample-data/empty.json is checked against createEmptyData(): a template that
 * describes a format the app no longer reads is worse than no template. The
 * timestamps are fixed so the output is byte-stable, which is what lets
 * check-samples.js catch it going stale.
 *
 * Run: node tools/make-template.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { FF, root } = require('./_load.js');

/** Fixed, so regenerating produces an identical file until the format changes. */
const STAMP = '2026-01-05T09:00:00.000Z';

function build() {
  return FF.model.annotate({
    schemaVersion: FF.C.SCHEMA_VERSION,
    app: FF.C.APP_NAME,
    meta: { createdAt: STAMP, updatedAt: STAMP },

    // Deliberately minimal cards: no id, no timestamps, no order. Showing the
    // full nine-field form here would teach an assistant to generate nine
    // fields, most of which it would have to invent.
    cards: [
      { title: 'Replace these three with your own', lane: 'inbox' },
      { title: 'Something you could finish in five minutes', lane: 'justdoit' },
      { title: 'The one thing you have actually committed to', lane: 'inprogress',
        notes: 'Position is priority. The top three cards in this lane are the home screen.' }
    ],

    weeklyReviews: []
  });
}

module.exports = { build, STAMP };

if (require.main === module) {
  const text = build();

  // Never ship a template the importer would refuse.
  const check = FF.model.readAny(text);
  if (!check.ok) {
    console.error('Refusing to write a template that does not import:\n  ' + check.errors.join('\n  '));
    process.exit(1);
  }

  const out = path.join(root, 'sample-data', 'template.jsonc');
  fs.writeFileSync(out, text);
  console.log('Wrote ' + path.relative(root, out) + ' (' + check.data.cards.length + ' example cards)');
}
