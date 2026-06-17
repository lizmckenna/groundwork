/**
 * Groundwork live RSVP refresh — v2.
 * Adds manual columns that SURVIVE the auto-refresh (matched by email):
 *   I = Claimed by   J = Reminder: assigned to   K = Reminder: status
 * Paste into the workbook (Extensions → Apps Script), set EVENT + LEADS below,
 * Save, then run setUp() once (authorize when asked).
 */
const KEY    = 'p4mps-rKItacZ0arZKMy12UZuRBYwJVP_LJ4iU';
const EVENT  = 'Northland Emergency Meeting 6/18';  // KC: 'Kansas City Emergency Meeting 7/9'  |  EJC: 'Eastern Jackson County Emergency Meeting 7/1'
const LEADS  = 'Holly,Sierra,Latrice,Nina,Brianna,Ellen,Facebook,Other';  // dropdown for Claimed by + Reminder assignee
const STATUS = 'Not started,Texted,Called,Left message,Confirmed coming,No answer,Declined';
const TAB = 'RSVPs (live)';
const DATA_COLS = 8;                                              // A–H come from the feed
const MANUAL = ['Claimed by','Reminder: assigned to','Reminder: status'];  // cols I, J, K — preserved on refresh
const M_START = DATA_COLS + 1;                                   // first manual column (I = 9)
const EMAIL_COL = 3;                                             // C = email, the join key

function onOpen(){
  SpreadsheetApp.getUi().createMenu('🔄 Groundwork').addItem('Refresh RSVPs now','refreshRSVPs').addToUi();
}

function setUp(){
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB);
  sh.getRange(1, M_START, 1, MANUAL.length).setValues([MANUAL]).setFontWeight('bold').setBackground('#FFF4CC');
  const dv = v => SpreadsheetApp.newDataValidation().requireValueInList(v.split(','), true).setAllowInvalid(true).build();
  sh.getRange(2, M_START,     400, 1).setDataValidation(dv(LEADS));   // Claimed by
  sh.getRange(2, M_START + 1, 400, 1).setDataValidation(dv(LEADS));   // Reminder assigned to
  sh.getRange(2, M_START + 2, 400, 1).setDataValidation(dv(STATUS));  // Reminder status
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction()==='refreshRSVPs') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('refreshRSVPs').timeBased().everyMinutes(1).create();
  refreshRSVPs();
  SpreadsheetApp.getUi().alert('All set: refreshes every minute, a Refresh now button, and Claimed by / Reminder columns that stay attached to each person.');
}

function refreshRSVPs(){
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB); if (!sh) return;
  const last = sh.getLastRow(), N = MANUAL.length, byEmail = {};
  if (last >= 2) {
    const emails = sh.getRange(2, EMAIL_COL, last-1, 1).getValues();
    const manual = sh.getRange(2, M_START, last-1, N).getValues();
    for (let i=0; i<emails.length; i++){
      const em = String(emails[i][0]||'').trim().toLowerCase();
      if (em && manual[i].some(v => v !== '')) byEmail[em] = manual[i];
    }
  }
  const url = 'https://groundwork-pilot.elizabethmck.workers.dev/export/rsvps.csv?key='+encodeURIComponent(KEY)+'&event='+encodeURIComponent(EVENT)+'&t='+Date.now();
  const rows = Utilities.parseCsv(UrlFetchApp.fetch(url, {muteHttpExceptions:true}).getContentText());
  if (rows.length < 1) return;
  if (last >= 2) sh.getRange(2, 1, last-1, DATA_COLS + N).clearContent();
  sh.getRange(1, 1, 1, DATA_COLS).setValues([rows[0].slice(0, DATA_COLS)]);
  const body = rows.slice(1); if (!body.length) return;
  sh.getRange(2, 1, body.length, DATA_COLS).setValues(body.map(r => r.slice(0, DATA_COLS)));
  const reM = body.map(r => byEmail[String(r[2]||'').trim().toLowerCase()] || new Array(N).fill(''));
  sh.getRange(2, M_START, reM.length, N).setValues(reM);
}
