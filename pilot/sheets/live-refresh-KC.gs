/**
 * Groundwork live turnout tracker — KANSAS CITY (7/9).
 * Paste into Extensions → Apps Script, Save, run setUp() once (authorize when asked).
 *
 * setUp builds everything: frozen A/B name columns, red "do not edit" banner on
 * row 1 (over C onward), headers on row 2, live data from row 3, the yellow
 * Claimed by / Reminder columns (survive every refresh, matched by email), a
 * "📖 How to use" tab, and pizza/childcare + per-lead counts on the Goals tab.
 */
const KEY    = 'p4mps-rKItacZ0arZKMy12UZuRBYwJVP_LJ4iU';
const EVENT  = 'Kansas City Emergency Meeting 7/9';
const LEADS  = 'LaNee,David,Facebook,Other';                 // <-- the lead names (+ Facebook/Other)
const STATUS = 'Not started,Texted,Called,Left message,Confirmed coming,No answer,Declined';
const ATTEND = 'Self check-in,Attended,No-show,Walk-in,Canceled';       // Attendance dropdown
const RSVP_URL = 'https://parents4mopublicschools.org/launches/kc/';

const TAB = 'RSVPs (live)';
const DATA_COLS = 8;                                          // A–H come from the feed
const MANUAL = ['Claimed by','Reminder: assigned to','Reminder: status','Attendance'];  // I, J, K, L
const M_START = DATA_COLS + 1;                                // I = 9
const TOTAL_COLS = DATA_COLS + MANUAL.length;                 // 11 (A..K)
const EMAIL_COL = 3;                                          // C = email, the join key
const HDR = 2;                                                // header row
const FIRST = 3;                                              // first data row
const BANNER = '⚠️ LIVE LIST. DO NOT ADD, EDIT, OR DELETE ROWS. These are the real registrations pulled from the Airtable database. '
             + 'Anything typed in columns A–H is erased on the next refresh and never reaches the database. '
             + 'Only the yellow columns are yours: pick your name under "Claimed by" and assign reminder calls or texts.';

function onOpen(){
  SpreadsheetApp.getUi().createMenu('🔄 Groundwork')
    .addItem('Refresh RSVPs now','refreshRSVPs')
    .addItem('Rebuild How-to + Goals','installHelp')
    .addToUi();
}

function setUp(){
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB);
  // Banner over the live data (C..K); A/B stay clear + frozen so names show when you scroll right.
  sh.getRange(1, 1, 1, TOTAL_COLS).breakApart();
  sh.getRange(1, 3, 1, TOTAL_COLS - 2).merge()
    .setValue(BANNER).setFontWeight('bold').setFontColor('#7A1F1A').setBackground('#FCE2DE')
    .setWrap(true).setVerticalAlignment('middle').setHorizontalAlignment('left');
  sh.setRowHeight(1, 50);
  // Manual headers on row 2
  sh.getRange(HDR, M_START, 1, MANUAL.length).setValues([MANUAL]).setFontWeight('bold').setBackground('#FFF4CC');
  // Dropdowns from first data row down
  const dv = v => SpreadsheetApp.newDataValidation().requireValueInList(v.split(','), true).setAllowInvalid(true).build();
  sh.getRange(FIRST, M_START,     400, 1).setDataValidation(dv(LEADS));   // Claimed by
  sh.getRange(FIRST, M_START + 1, 400, 1).setDataValidation(dv(LEADS));   // Reminder assigned to
  sh.getRange(FIRST, M_START + 2, 400, 1).setDataValidation(dv(STATUS));  // Reminder status
  sh.getRange(FIRST, M_START + 3, 400, 1).setDataValidation(dv(ATTEND));  // Attendance
  sh.setFrozenRows(2);
  sh.setFrozenColumns(2);
  // Warn anyone who tries to edit the live data columns A–H
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(p => { if (p.getDescription()==='GW live') p.remove(); });
  sh.getRange(1, 1, sh.getMaxRows(), DATA_COLS).protect().setDescription('GW live').setWarningOnly(true);
  // Color the Attendance column so a self check-in pops green as people arrive.
  const attCol = M_START + 3;
  const attRange = sh.getRange(FIRST, attCol, sh.getMaxRows() - FIRST + 1, 1);
  let cfRules = sh.getConditionalFormatRules().filter(r => !r.getRanges().some(rg => rg.getColumn() === attCol));
  const cf = (txt, bg, fc) => { let b = SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(txt).setBackground(bg); if (fc) b = b.setFontColor(fc); return b.setRanges([attRange]).build(); };
  cfRules.push(cf('Self check-in', '#188038', '#ffffff'));  // strong green = checked themselves in
  cfRules.push(cf('Attended', '#CEEAD6'));                  // soft green
  cfRules.push(cf('Walk-in', '#CEEAD6'));
  cfRules.push(cf('No-show', '#F4C7C3'));                   // soft red
  cfRules.push(cf('Canceled', '#E0E0E0'));                  // grey
  sh.setConditionalFormatRules(cfRules);
  // Auto-refresh every minute
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction()==='refreshRSVPs') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('refreshRSVPs').timeBased().everyMinutes(1).create();
  // When a lead picks Attended / No-show in the Attendance column, push it to Airtable + the dashboard.
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction()==='onAttendanceEdit') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('onAttendanceEdit').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  refreshRSVPs();
  installHelp();
  SpreadsheetApp.getUi().alert('All set: banner + frozen name columns, refreshes every minute, Claimed by / Reminder columns, a How-to tab, and pizza/childcare counts on the Goals tab.');
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
  const body = rows.slice(1); if (!body.length) { writeStats(); return; }
  sh.getRange(FIRST, 1, body.length, DATA_COLS).setValues(body.map(r => r.slice(0, DATA_COLS)));
  // Attendance from the database, with its type: "Self check-in" (door QR) vs "Attended".
  let attMap = {};
  try {
    const au = 'https://groundwork-pilot.elizabethmck.workers.dev/export/attendance.csv?key='+encodeURIComponent(KEY)+'&event='+encodeURIComponent(EVENT)+'&t='+Date.now();
    Utilities.parseCsv(UrlFetchApp.fetch(au, {muteHttpExceptions:true}).getContentText()).forEach(row => { const e=String(row[0]||'').trim().toLowerCase(); if (e) attMap[e] = String(row[1]||'Attended').trim(); });
  } catch(e){}
  const reM = body.map(r => {
    const em = String(r[2]||'').trim().toLowerCase();
    const pm = byEmail[em]; const m = pm ? pm.slice() : new Array(N).fill('');
    // Attendance = last manual column: live status from the database (Self check-in /
    // Attended); keep a manual No-show / Canceled if a lead set one.
    let att = attMap[em] || '';
    if (!att && /^(no.?show|canceled|cancelled)$/i.test(String(m[N-1]||''))) att = m[N-1];
    m[N-1] = att;
    return m;
  });
  sh.getRange(FIRST, M_START, reM.length, N).setValues(reM);
  writeStats();
}

// Fires when a lead edits the Attendance column. Pushes Attended/No-show to
// Airtable so the events dashboard turnout updates. (Installable trigger, so it
// only runs on human edits, never on the script's own refresh writes.)
function onAttendanceEdit(e){
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  if (sh.getName() !== TAB) return;
  const ATT_COL = M_START + 3;   // Attendance column (L)
  if (e.range.getColumn() > ATT_COL || e.range.getLastColumn() < ATT_COL) return;
  const r0 = Math.max(e.range.getRow(), FIRST), r1 = e.range.getLastRow();
  const marks = [];
  for (let r = r0; r <= r1; r++){
    const email = String(sh.getRange(r, EMAIL_COL).getValue()||'').trim();
    if (!email) continue;
    marks.push({ email: email, status: String(sh.getRange(r, ATT_COL).getValue()||'').trim() });
  }
  if (!marks.length) return;
  UrlFetchApp.fetch('https://groundwork-pilot.elizabethmck.workers.dev/sheet-attendance?key='+encodeURIComponent(KEY),
    { method:'post', contentType:'application/json', payload: JSON.stringify({ event: EVENT, marks: marks }), muteHttpExceptions:true });
}

// Pizza + childcare totals onto the Goals tab (same counts the events dashboard
// shows; childcare kids parsed server-side). Found by label, so it survives you
// inserting lead rows.
function writeStats(){
  const g = SpreadsheetApp.getActive().getSheetByName('Goals'); if (!g) return;
  const url = 'https://groundwork-pilot.elizabethmck.workers.dev/export/rsvps.csv?stats=1&key='+encodeURIComponent(KEY)+'&event='+encodeURIComponent(EVENT)+'&t='+Date.now();
  let m = {};
  try { Utilities.parseCsv(UrlFetchApp.fetch(url,{muteHttpExceptions:true}).getContentText()).slice(1).forEach(r => m[r[0]] = Number(r[1])||0); } catch(e){ return; }
  const items = [
    ['Live RSVP total (everyone):', m.registered||0, 'live rsvp total'],
    ['Want pizza:', m.pizza||0, 'want pizza'],
    ['Childcare (families):', m.childcare_families||0, 'childcare (families'],
    ['Childcare (kids total):', m.childcare_kids||0, 'childcare (kids'],
  ];
  const colA = g.getRange(1, 1, Math.max(g.getLastRow(),1), 1).getValues().map(r => String(r[0]).toLowerCase());
  items.forEach(function(it){
    let row = -1;
    for (let i=0; i<colA.length; i++){ if (colA[i].indexOf(it[2]) >= 0){ row = i+1; break; } }
    if (row < 0){ row = g.getLastRow() + 1; g.getRange(row, 1).setValue(it[0]).setFontWeight('bold'); colA.push(it[0].toLowerCase()); }
    g.getRange(row, 3).setValue(it[1]);
  });
}

// Builds the "📖 How to use" tab and makes adding a lead need no formula editing
// (Goals claimed-count + %-to-goal read the lead-name cell).
function installHelp(){
  const ss = SpreadsheetApp.getActive();
  const g = ss.getSheetByName('Goals');
  if (g){
    const colA = g.getRange(1,1,Math.max(g.getLastRow(),1),1).getValues().map(r => String(r[0]).trim());
    const hdr = colA.indexOf('Lead');
    if (hdr >= 0){
      for (let r = hdr+2; r <= g.getLastRow(); r++){
        const name = String(g.getRange(r,1).getValue()).trim();
        if (name.toUpperCase() === 'TOTAL') break;   // stop at TOTAL; don't touch the stat rows below
        if (!name) continue;
        g.getRange(r,3).setFormula("=IF($A"+r+"=\"\",\"\",COUNTIF('RSVPs (live)'!$I:$I,$A"+r+"))");
        g.getRange(r,4).setFormula("=IF(OR($A"+r+"=\"\",$B"+r+"=0),\"\",$C"+r+"/$B"+r+")");
      }
    }
  }
  let h = ss.getSheetByName('📖 How to use');
  if (!h) h = ss.insertSheet('📖 How to use', 0);
  h.clear();
  try { h.setHiddenGridlines(true); } catch(e){}
  h.setColumnWidth(1, 820);
  const rows = [
    ['📖 How to use this tracker','title'],
    ['','gap'],
    ['Claim someone who registered','h'],
    ['On the RSVPs (live) tab, find the person and pick your name in the yellow "Claimed by" column. It adds to your number on the Goals tab right away.','p'],
    ['Never type a person into the RSVPs (live) tab. It is the live list from the database, and anything you type there is erased on the next refresh.','note'],
    ['','gap'],
    ['Track the people you are working','h'],
    ['Go to your own tab (the one with your name) and type the people you are recruiting in the Name column, with their school and the ask. Column E tells you the moment they actually register. This tab is yours, edit it freely.','p'],
    ['','gap'],
    ['Reminder calls and texts','h'],
    ['On the RSVPs (live) tab, use the yellow "Reminder: assigned to" and "Reminder: status" columns. They stay attached to each person through every refresh.','p'],
    ['','gap'],
    ['Mark who showed up','h'],
    ['At or after the event, set each person to Attended or No-show in the "Attendance" column. That flows straight to the database and the turnout shows up on the events dashboard automatically.','p'],
    ['','gap'],
    ['Change a goal','h'],
    ['On the Goals tab, type a new number in the "Goal" column. Everything recalculates on its own.','p'],
    ['','gap'],
    ['Add a new lead','h'],
    ['1. Goals tab: type the new name in an empty row above TOTAL and set their Goal. Copy the row right above and paste into the new row. The claimed count fills in by itself, no formula editing.','p'],
    ['2. Right-click the "Template (copy me)" tab, choose Duplicate, and rename it to their name. That becomes their personal list.','p'],
    ['3. They can just pick or type their name in the "Claimed by" dropdown on the RSVPs (live) tab.','p'],
    ['','gap'],
    ['The one rule that matters','h'],
    ['A name only counts as turnout once the person RSVPs through the form. To get someone counted, text them the RSVP link below.','p'],
    ['','gap'],
    ['RSVP link to share','h'],
    [RSVP_URL,'link'],
  ];
  h.getRange(1, 1, rows.length, 1).setValues(rows.map(function(r){ return [r[0]]; }));   // batch write
  rows.forEach(function(it, i){
    const c = h.getRange(i+1, 1).setWrap(true).setVerticalAlignment('middle');
    if (it[1]==='title'){ c.setFontSize(18).setFontWeight('bold').setFontColor('#ffffff').setBackground('#1F5C3D'); h.setRowHeight(i+1,48); }
    else if (it[1]==='h'){ c.setFontSize(13).setFontWeight('bold').setFontColor('#1F5C3D'); h.setRowHeight(i+1,28); }
    else if (it[1]==='note'){ c.setFontSize(11).setFontColor('#9A3412').setFontStyle('italic'); h.setRowHeight(i+1,42); }
    else if (it[1]==='link'){ c.setFontSize(11).setFontColor('#2563EB'); h.setRowHeight(i+1,24); }
    else if (it[1]==='gap'){ h.setRowHeight(i+1,8); }
    else { c.setFontSize(11).setFontColor('#1A2418'); h.setRowHeight(i+1,38); }
  });
  h.activate();
  SpreadsheetApp.flush();
}
