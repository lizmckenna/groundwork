/**
 * Groundwork — COMMITMENT-STATUS SYNC add-on (standalone).
 * Paste as an extra file into a region tracker's bound Apps Script project
 * (KC first), Save, run ctsSetUp once, then run ctsBackfill once.
 *
 * Makes the WORK TABS (school tabs in KC, district tabs elsewhere) the source
 * of truth for commitment status (Liz 7/13). The five status dropdowns —
 * Amplifier / House Mtg / School Board / Canvass / Regional Team — now write
 * to matching database fields (amplifier_status … regional_team_status) the
 * moment an organizer edits them, via the same worker endpoint that already
 * syncs contact-info edits. The region + commitments feeds read those fields
 * back, so the Dashboard, the Commitments tab, and the database all agree.
 *
 * · ctsOnEdit    — installable trigger; pushes each dropdown edit (handles
 *                  single cells and pasted single-column blocks up to 100 rows)
 * · ctsBackfill  — one-time: pushes every status currently in the work tabs
 * · Work tab detection: header ROW 1 contains both 'contact_id' and
 *   'Amplifier'. (Overview/master and Commitments tabs have a banner in row 1,
 *   so they can never match — edits there are ignored by design.)
 *
 * Fully self-contained (cts-prefixed): no dependency on any other file.
 */

const CTS_KEY    = 'p4mps-rKItacZ0arZKMy12UZuRBYwJVP_LJ4iU';
const CTS_WORKER = 'https://groundwork-pilot.elizabethmck.workers.dev';
const CTS_MAP = { 'Amplifier': 'amplifier_status', 'House Mtg': 'house_mtg_status',
  'School Board': 'school_board_status', 'Canvass': 'canvass_status', 'Regional Team': 'regional_team_status' };
const CTS_ID_RE = /^rec[A-Za-z0-9]{14,}$/;

function ctsSetUp(){
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'ctsOnEdit') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('ctsOnEdit').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  SpreadsheetApp.getActive().toast('Status sync armed. Now run ctsBackfill once to push existing statuses.');
}

function ctsHeaders(sh){
  const lastC = sh.getLastColumn(); if (!lastC) return null;
  const hdr = sh.getRange(1, 1, 1, lastC).getValues()[0].map(v => String(v || '').trim());
  if (hdr.indexOf('contact_id') < 0 || hdr.indexOf('Amplifier') < 0) return null;   // not a work tab
  return hdr;
}

function ctsPush(updates){
  if (!updates.length) return;
  UrlFetchApp.fetch(CTS_WORKER + '/sheet-region-update', {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ key: CTS_KEY, updates: updates }),
    muteHttpExceptions: true,
  });
}

function ctsOnEdit(e){
  try {
    const rg = e.range, sh = rg.getSheet();
    if (rg.getNumColumns() > 1 || rg.getNumRows() > 100) return;   // single column only
    const hdr = ctsHeaders(sh); if (!hdr) return;
    const field = CTS_MAP[hdr[rg.getColumn() - 1]]; if (!field) return;
    const idCol = hdr.indexOf('contact_id') + 1;
    const top = Math.max(rg.getRow(), 2);                          // never the header row
    const nRows = rg.getRow() + rg.getNumRows() - top; if (nRows < 1) return;
    const ids = sh.getRange(top, idCol, nRows, 1).getValues();
    const vals = sh.getRange(top, rg.getColumn(), nRows, 1).getValues();
    const updates = [];
    for (let i = 0; i < nRows; i++){
      const cid = String(ids[i][0] || '').trim();
      if (!CTS_ID_RE.test(cid)) continue;
      updates.push({ contact_id: cid, field: field, value: String(vals[i][0] || '').trim() });
    }
    ctsPush(updates);
  } catch (err) {}
}

// One-time: push every non-empty status currently sitting in the work tabs,
// so nothing organizers already marked is lost. Re-running is harmless
// (idempotent PATCHes). Batches of 50 to stay well under URL-fetch limits.
function ctsBackfill(){
  const updates = [];
  SpreadsheetApp.getActive().getSheets().forEach(sh => {
    const hdr = ctsHeaders(sh); if (!hdr) return;
    const lastR = sh.getLastRow(); if (lastR < 2) return;
    const idCol = hdr.indexOf('contact_id');
    const cols = []; hdr.forEach((h, i) => { if (CTS_MAP[h]) cols.push({ i: i, f: CTS_MAP[h] }); });
    if (!cols.length) return;
    const data = sh.getRange(2, 1, lastR - 1, hdr.length).getValues();
    data.forEach(r => {
      const cid = String(r[idCol] || '').trim();
      if (!CTS_ID_RE.test(cid)) return;
      cols.forEach(c => {
        const v = String(r[c.i] || '').trim();
        if (v) updates.push({ contact_id: cid, field: c.f, value: v });
      });
    });
  });
  let sent = 0;
  for (let i = 0; i < updates.length; i += 50){
    ctsPush(updates.slice(i, i + 50));
    sent += Math.min(50, updates.length - i);
    Utilities.sleep(400);
  }
  SpreadsheetApp.getActive().toast('Backfilled ' + sent + ' statuses to the database.');
  return sent;
}
