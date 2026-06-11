#!/usr/bin/env node
// Stamps per-organizer dashboards from the lanee template so the three pages
// can't drift apart. Edit pilot/lanee/index.html, then run:
//   node pilot/build-pages.mjs
// and commit all three.
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const template = readFileSync(join(here, 'lanee/index.html'), 'utf8');

const PAGES = {
  stephanie: {
    slug: 'stephanie',
    pill: 'Stephanie',
    fullName: 'Stephanie Rittgers',
    eyebrow: 'Onramp calls · Stephanie Rittgers',
    defaultList: 'fresh',
  },
  kathryn: {
    slug: 'kathryn',
    pill: 'Kathryn',
    fullName: 'Kathryn',
    // Kathryn's slice: follow-ups for house-meeting / amplifier-only folks —
    // her default list is the unconverted follow-up queue, not cold prospects.
    eyebrow: 'Follow-up calls · Kathryn',
    defaultList: 'unconverted',
  },
};

for (const page of Object.values(PAGES)) {
  let out = template;
  out = out.replaceAll(`const ORGANIZER = 'lanee'`, `const ORGANIZER = '${page.slug}'`);
  out = out.replaceAll('Groundwork — LaNee · MOI Pilot', `Groundwork — ${page.pill} · MOI Pilot`);
  out = out.replaceAll('<span class="user-pill">LaNee</span>', `<span class="user-pill">${page.pill}</span>`);
  out = out.replaceAll("LaNeé Bridewell's dashboard", `${page.fullName}'s dashboard`);
  out = out.replaceAll('Groundwork · LaNee · Missouri pilot', `Groundwork · ${page.pill} · Missouri pilot`);
  out = out.replaceAll(`'gw_lanee_counter_cache_v2'`, `'gw_${page.slug}_counter_cache_v2'`);
  out = out.replaceAll(`localStorage.getItem('gw-call-list') || 'fresh'`, `localStorage.getItem('gw-call-list') || '${page.defaultList}'`);
  mkdirSync(join(here, page.slug), { recursive: true });
  writeFileSync(join(here, page.slug, 'index.html'), out);
  console.log(`wrote pilot/${page.slug}/index.html (${out.length} bytes)`);
}
