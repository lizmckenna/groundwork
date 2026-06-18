/**
 * Groundwork live RSVP refresh — EASTERN JACKSON COUNTY (7/1).
 * Row 1 = red "do not edit" banner. Row 2 = headers. Row 3+ = live data.
 * Manual columns survive every refresh (matched by email):
 *   I = Claimed by   J = Reminder: assigned to   K = Reminder: status
 * Paste here (Extensions → Apps Script), Save, then run setUp() once.
 */
const KEY    = 'p4mps-rKItacZ0arZKMy12UZuRBYwJVP_LJ4iU';
const EVENT  = 'Eastern Jackson County Emergency Meeting 7/1';
const LEADS  = 'LaNee,David,Facebook,Other';   // <-- swap in the real EJC lead names
const STATUS = 'Not started,Texted,Called,Left message,Confirmed coming,No answer,Declined';

const TAB = 'RSVPs (live)';
const DATA_COLS = 8;                                  // A–H come from the feed
const MANUAL = ['Claimed by','Reminder: assigned to','Reminder: status'];  // I, J, K
const M_START = DATA_COLS + 1;                        // first manual column (I = 9)
const TOTAL_COLS = DATA_COLS + MANUAL.length;         // 11
const EMAIL_COL = 3;                                  // C = email, the join key
const HDR = 2;                                        // header row
const FIRST = 3;                                      // first data row
const BANNER = '⚠️ LIVE LIST. DO NOT ADD, EDIT, OR DELETE ROWS. These are the real registrations pulled from the Airtable database. '
             + 'Anything typed in columns A–H is erased on the next refresh and never reaches the database. '
             + 'Only the yellow columns are yours: pick your name under "Claimed by" and assign reminder calls or texts.';

function onOpen(){
  SpreadsheetApp.getUi().createMenu('🔄 Groundwork').addItem('Refresh RSVPs now','refreshRSVPs').addToUi();
}

function setUp(){
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB);
  // Banner across row 1
  sh.getRange(1,1,1,TOTAL_COLS).breakApart();
  const b = sh.getRange(1,1,1,TOTAL_COLS).merge();
  b.setValue(BANNER).setFontWeight('bold').setFontColor('#7A1F1A').setBackground('#FCE2DE')
   .setWrap(true).setVerticalAlignment('middle').setHorizontalAlignment('left');
  sh.setRowHeight(1, 46);
  // Manual headers on row 2
  sh.getRange(HDR, M_START, 1, MANUAL.length).setValues([MANUAL]).setFontWeight('bold').setBackground('#FFF4CC');
  // Dropdowns from first data row down
  const dv = v => SpreadsheetApp.newDataValidation().requireValueInList(v.split(','), true).setAllowInvalid(true).build();
  sh.getRange(FIRST, M_START,     400, 1).setDataValidation(dv(LEADS));   // Claimed by
  sh.getRange(FIRST, M_START + 1, 400, 1).setDataValidation(dv(LEADS));   // Reminder assigned to
  sh.getRange(FIRST, M_START + 2, 400, 1).setDataValidation(dv(STATUS));  // Reminder status
  sh.setFrozenRows(2);
  // Warn anyone who tries to edit the live data columns A–H
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(p => { if (p.getDescription()==='GW live') p.remove(); });
  sh.getRange(1, 1, sh.getMaxRows(), DATA_COLS).protect().setDescription('GW live').setWarningOnly(true);
  // Auto-refresh every minute
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction()==='refreshRSVPs') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('refreshRSVPs').timeBased().everyMinutes(1).create();
  refreshRSVPs();
  SpreadsheetApp.getUi().alert('All set: red banner on row 1, refreshes every minute, a Refresh now button, and Claimed by / Reminder columns that stay attached to each person.');
}

function refreshRSVPs(){
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB); if (!sh) return;
  const last = sh.getLastRow(), N = MANUAL.length, byEmail = {};
  if (last >= FIRST) {
    const emails = sh.getRange(FIRST, EMAIL_COL, last-FIRST+1, 1).getValues();
    const manual = sh.getRange(FIRST, M_START, last-FIRST+1, N).getValues();
    for (let i=0; i<emails.length; i++){
      const em = String(emails[i][0]||'').trim().toLowerCase();
      if (em && manual[i].some(v => v !== '')) byEmail[em] = manual[i];
    }
  }
  const url = 'https://groundwork-pilot.elizabethmck.workers.dev/export/rsvps.csv?key='+encodeURIComponent(KEY)+'&event='+encodeURIComponent(EVENT)+'&t='+Date.now();
  const rows = Utilities.parseCsv(UrlFetchApp.fetch(url, {muteHttpExceptions:true}).getContentText());
  if (rows.length < 1) return;
  if (last >= FIRST) sh.getRange(FIRST, 1, last-FIRST+1, DATA_COLS + N).clearContent();
  sh.getRange(HDR, 1, 1, DATA_COLS).setValues([rows[0].slice(0, DATA_COLS)]);   // data headers on row 2
  const body = rows.slice(1); if (!body.length) return;
  sh.getRange(FIRST, 1, body.length, DATA_COLS).setValues(body.map(r => r.slice(0, DATA_COLS)));
  const reM = body.map(r => byEmail[String(r[2]||'').trim().toLowerCase()] || new Array(N).fill(''));
  sh.getRange(FIRST, M_START, reM.length, N).setValues(reM);
  writeStats();
}

// Pizza + childcare totals onto the Goals tab (same counts the events dashboard
// shows; childcare kids parsed server-side). Found by label, so it survives you
// inserting lead rows.
function writeStats(){
  const g = SpreadsheetApp.getActive().getSheetByName('Goals'); if (!g) return;
  const url = 'https://groundwork-pilot.elizabethmck.workers.dev/export/rsvps.csv?stats=1&key='+encodeURIComponent(KEY)+'&event='+encodeURIComponent(EVENT)+'&t='+Date.now();
  let m = {};
  try { Utilities.parseCsv(UrlFetchApp.fetch(url,{muteHttpExceptions:true}).getContentText()).slice(1).forEach(r => m[r[0]] = Number(r[1])||0); } catch(e){ return; }
  const items = [['Want pizza:', m.pizza||0], ['Childcare (families):', m.childcare_families||0], ['Childcare (kids total):', m.childcare_kids||0]];
  const colA = g.getRange(1, 1, Math.max(g.getLastRow(),1), 1).getValues().map(r => String(r[0]));
  items.forEach(function(it){
    let row = colA.indexOf(it[0]) + 1;
    if (row === 0){ row = g.getLastRow() + 1; g.getRange(row, 1).setValue(it[0]).setFontWeight('bold'); }
    g.getRange(row, 3).setValue(it[1]);
  });
}
