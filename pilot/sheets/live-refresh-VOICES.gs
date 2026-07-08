// ============================================================================
//  Voices for Small Schools Amplifier Training 7/19 — live RSVP tracker
//  Paste into Extensions → Apps Script, Save, then run setUp() once.
//  A "🔄 Groundwork" menu appears on reload; RSVPs refresh every 5 minutes.
//  Attendance you mark in the Attendance column writes back to the Groundwork database.
//
//  Columns:
//    Data (from the signup form, auto-refreshed): First, Last, Email, Phone,
//      District, School, Registered, How did you hear?  (8 cols, A..H)
//    Manual (yours, survive every refresh): Assigned to, Reminder status,
//      Recruited by, Attendance, Notes  (5 cols, I..M)
//  "How did you hear?" is self-reported on the form. "Recruited by" is for you
//  to credit the amplifier/organizer who brought them in.
// ============================================================================
const TOKEN = 'voices719-ca4a6651924de818';                                  // scoped to THIS event only — never the master key
const EVENT = 'Voices for Small Schools Amplifier Training 7/19';
const WORKER = 'https://groundwork-pilot.elizabethmck.workers.dev';
const TAB = 'RSVPs (live)';

const TITLE = 'Voices for Small Schools · 7/19 · 7 PM CT — RSVP Tracker';
const DATA_COLS = 8;              // First, Last, Email, Phone, District, School, Registered, How did you hear?
const EMAIL_COL = 3;             // column C
const HEARD_COL = 8;             // column H — "How did you hear?" (from the form)
const BANNER = 1, HDR = 2, FIRST = 3;   // row 1 banner, row 2 header, data from row 3

const MANUAL = ['Assigned to', 'Reminder status', 'Recruited by', 'Attendance', 'Notes'];
const M_START = DATA_COLS + 1;   // column I
const N = MANUAL.length;         // 5
const ATT_COL = M_START + 3;     // column L — Attendance (4th manual column)

const ASSIGNEES = ['Laci Horn', 'Molly Fleming'];                            // pick one, or type any other name
const REMINDERS = ['Not started', 'Texted', 'Called', 'Left message', 'Confirmed', 'No answer', 'Declined'];
const ATTEND    = ['Attended', 'No-show'];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🔄 Groundwork')
    .addItem('Refresh RSVPs now', 'refreshVoices')
    .addItem('Set up / repair tracker', 'setUp')
    .addToUi();
}

function setUp() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(TAB);
  if (!sh) sh = ss.insertSheet(TAB);
  const width = DATA_COLS + N;   // A..M

  // Banner row.
  sh.getRange(BANNER, 1, 1, width).merge()
    .setValue(TITLE).setFontColor('#FFFFFF').setBackground('#2F5E3D')
    .setFontWeight('bold').setFontSize(13).setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.setRowHeight(BANNER, 34);

  // Header row: data headers filled by refresh; manual headers here.
  sh.getRange(HDR, M_START, 1, N).setValues([MANUAL]);
  sh.getRange(HDR, 1, 1, width).setFontWeight('bold').setBackground('#DDE7DE').setVerticalAlignment('middle');
  sh.setFrozenRows(HDR);

  // Data columns (A..H) are form-fed and must stay plain text. Strip any stray
  // validation — older layouts left dropdowns on Registered + "Who told you
  // about this training?", which should both be open text.
  sh.getRange(FIRST, 1, 500, DATA_COLS).clearDataValidations();

  // Dropdowns (allow-invalid so you can type a name/status that isn't listed).
  // Recruited by (M_START+2) and Notes (M_START+4) are free text — no validation.
  const dv = v => SpreadsheetApp.newDataValidation().requireValueInList(v, true).setAllowInvalid(true).build();
  sh.getRange(FIRST, M_START,     500, 1).setDataValidation(dv(ASSIGNEES));   // Assigned to
  sh.getRange(FIRST, M_START + 1, 500, 1).setDataValidation(dv(REMINDERS));   // Reminder status
  sh.getRange(FIRST, ATT_COL,     500, 1).setDataValidation(dv(ATTEND));      // Attendance

  applyPills(sh);
  setColumnWidths(sh);

  // Refresh every 5 minutes. (Every-minute across several trackers blows the
  // Apps Script daily urlfetch quota — "Service invoked too many times".)
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'refreshVoices') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('refreshVoices').timeBased().everyMinutes(5).create();

  // Attendance write-back.
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'onAttendanceEdit') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('onAttendanceEdit').forSpreadsheet(ss).onEdit().create();

  // Initial pull. If the daily urlfetch quota is exhausted this throws; swallow it
  // so the structure/triggers still finish — rows fill in on the next cycle after reset.
  try { refreshVoices(); } catch (e) {}
  SpreadsheetApp.getUi().alert('Set up. RSVPs refresh every 5 minutes. "How did you hear?" comes from the form; Assigned-to / Reminder / Recruited by / Notes are yours and survive refreshes. Marking the Attendance column writes back to the database.');
}

// Colored "pills" via conditional formatting on the Reminder + Attendance columns.
function applyPills(sh) {
  const green = '#CDEBD6', rose = '#F3D3D1', amber = '#FBE2BE', grey = '#E7E7E1';
  const rng = c => sh.getRange(FIRST, c, 500, 1);
  const rule = (c, text, bg, fg) => SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(text).setBackground(bg).setFontColor(fg || '#1A2418').setRanges([rng(c)]).build();
  const rules = [
    rule(M_START + 1, 'Confirmed', green), rule(M_START + 1, 'Declined', rose),
    rule(M_START + 1, 'No answer', rose),  rule(M_START + 1, 'Texted', amber),
    rule(M_START + 1, 'Called', amber),    rule(M_START + 1, 'Left message', amber),
    rule(M_START + 1, 'Not started', grey),
    rule(ATT_COL, 'Attended', green),      rule(ATT_COL, 'No-show', rose),
  ];
  sh.setConditionalFormatRules(rules);
}

function setColumnWidths(sh) {
  //          First Last Email Phone Dist School Reg  Heard | Assign Remind Recruit Attend Notes
  const w = [  90,  90,  210,  120,  150, 150,   90,  170,    100,   130,    130,   100,   220];
  for (let i = 0; i < w.length; i++) sh.setColumnWidth(i + 1, w[i]);
}

function refreshVoices() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB); if (!sh) return;
  const last = sh.getLastRow();
  const byEmail = {}, byNP = {};
  const npKey = (f, l, p) => String(f || '').trim().toLowerCase() + '|' + String(l || '').trim().toLowerCase() + '|' + String(p || '').replace(/\D/g, '').slice(-10);

  // 1. Save the manual columns FIRST, keyed by email and by name+phone (fallback).
  if (last >= FIRST) {
    const d = sh.getRange(FIRST, 1, last - HDR, DATA_COLS).getValues();
    const m = sh.getRange(FIRST, M_START, last - HDR, N).getValues();
    for (let i = 0; i < d.length; i++) {
      if (!m[i].some(v => v !== '')) continue;
      const k = String(d[i][EMAIL_COL - 1] || '').trim().toLowerCase(); if (k) byEmail[k] = m[i];
      byNP[npKey(d[i][0], d[i][1], d[i][3])] = m[i];
    }
  }

  // 2. Fetch — BAIL OUT without touching the sheet if anything is wrong.
  const url = WORKER + '/export/training-roster.csv?t=' + encodeURIComponent(TOKEN) +
              '&event=' + encodeURIComponent(EVENT) + '&t2=' + Date.now();
  let resp;
  try { resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true }); }
  catch (e) { return; }                                                    // urlfetch quota exhausted / network error -> never wipe, retry next cycle
  if (resp.getResponseCode() !== 200) return;
  const rows = Utilities.parseCsv(resp.getContentText());
  if (rows.length < 2) return;                                               // header-only -> never wipe
  const hdr = rows[0].map(h => String(h).toLowerCase());
  if (hdr.indexOf('email') === -1 && hdr.indexOf('first') === -1) return;    // not our CSV -> never wipe
  const body = rows.slice(1); if (!body.length) return;

  // Pad each row out to exactly DATA_COLS. The CSV may still be the pre-"How did
  // you hear?" 7-column version until the worker export is updated — padding keeps
  // setValues() from throwing a width mismatch and just leaves column H blank.
  const pad = r => { const s = r.slice(0, DATA_COLS); while (s.length < DATA_COLS) s.push(''); return s; };

  // 3. Safe to rewrite the DATA columns (manual columns untouched below).
  if (last >= FIRST) sh.getRange(FIRST, 1, last - HDR, DATA_COLS).clearContent();
  const hdrRow = pad(rows[0]);
  if (!String(hdrRow[HEARD_COL - 1] || '').trim()) hdrRow[HEARD_COL - 1] = 'Who told you about this training?';
  sh.getRange(HDR, 1, 1, DATA_COLS).setValues([hdrRow]).setFontWeight('bold');
  sh.getRange(FIRST, 1, body.length, DATA_COLS).setValues(body.map(pad));

  // 4. Restore the manual columns onto the matching rows.
  sh.getRange(FIRST, M_START, body.length, N).setValues(body.map(r => {
    const em = String(r[2] || '').trim().toLowerCase();
    return byEmail[em] || byNP[npKey(r[0], r[1], r[3])] || new Array(N).fill('');
  }));
}

// Marking Attendance (column L) posts back to the database.
function onAttendanceEdit(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  if (sh.getName() !== TAB) return;
  if (e.range.getColumn() > ATT_COL || e.range.getLastColumn() < ATT_COL) return;
  const r0 = Math.max(e.range.getRow(), FIRST), r1 = e.range.getLastRow();
  const marks = [];
  for (let r = r0; r <= r1; r++) {
    const email = String(sh.getRange(r, EMAIL_COL).getValue() || '').trim();
    if (!email) continue;
    marks.push({ email: email, status: String(sh.getRange(r, ATT_COL).getValue() || '').trim() });
  }
  if (!marks.length) return;
  UrlFetchApp.fetch(WORKER + '/sheet-attendance?key=' + encodeURIComponent(TOKEN),
    { method: 'post', contentType: 'application/json', payload: JSON.stringify({ event: EVENT, marks: marks }), muteHttpExceptions: true });
}
