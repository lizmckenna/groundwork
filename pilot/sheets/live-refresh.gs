/**
 * Groundwork — live RSVP refresh for the turnout Google Sheet.
 * Paste into the workbook: Extensions → Apps Script, replace everything, Save.
 * Then run setUp() once (authorize when asked). Adds a "Refresh now" button +
 * auto-refresh every minute. Preserves each lead's "Claimed by" pick by email.
 *
 * To use for a different launch, change EVENT below.
 */
const KEY   = 'p4mps-rKItacZ0arZKMy12UZuRBYwJVP_LJ4iU';
const EVENT = 'Kansas City Emergency Meeting 7/9';   // <- Northland: 'Northland Emergency Meeting 6/18'
const TAB   = 'RSVPs (live)';
const CLAIM_COL = 9;   // column I = "Claimed by"
const DATA_COLS = 8;   // A–H come from the live feed

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🔄 Groundwork')
    .addItem('Refresh RSVPs now', 'refreshRSVPs')
    .addToUi();
}

function setUp() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'refreshRSVPs') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('refreshRSVPs').timeBased().everyMinutes(1).create();
  refreshRSVPs();
  SpreadsheetApp.getUi().alert('Live updates are on. The RSVP list now refreshes every minute, and there is a "🔄 Groundwork → Refresh RSVPs now" button for instant updates.');
}

function refreshRSVPs() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB);
  if (!sh) return;

  // 1) remember existing "Claimed by" values, keyed by email (col C)
  const last = sh.getLastRow();
  const claimByEmail = {};
  if (last >= 2) {
    const emails = sh.getRange(2, 3, last - 1, 1).getValues();
    const claims = sh.getRange(2, CLAIM_COL, last - 1, 1).getValues();
    for (let i = 0; i < emails.length; i++) {
      const em = String(emails[i][0] || '').trim().toLowerCase();
      if (em && claims[i][0]) claimByEmail[em] = claims[i][0];
    }
  }

  // 2) fetch the canonical list (live from Airtable, deduped)
  const url = 'https://groundwork-pilot.elizabethmck.workers.dev/export/rsvps.csv?key='
    + encodeURIComponent(KEY) + '&event=' + encodeURIComponent(EVENT) + '&t=' + Date.now();
  const rows = Utilities.parseCsv(UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText());
  if (rows.length < 1) return;

  // 3) clear old data + claims, write header + body
  if (last >= 2) sh.getRange(2, 1, last - 1, CLAIM_COL).clearContent();
  sh.getRange(1, 1, 1, DATA_COLS).setValues([rows[0].slice(0, DATA_COLS)]);
  const body = rows.slice(1);
  if (!body.length) return;
  sh.getRange(2, 1, body.length, DATA_COLS).setValues(body.map(r => r.slice(0, DATA_COLS)));

  // 4) re-attach each person's claim by email so nothing gets wiped
  const reclaim = body.map(r => [claimByEmail[String(r[2] || '').trim().toLowerCase()] || '']);
  sh.getRange(2, CLAIM_COL, reclaim.length, 1).setValues(reclaim);
}
