/**
 * Groundwork live turnout tracker — POPLAR BLUFF (Southeast Missouri).
 * TWO community info sessions, one sheet, one tab each:
 *   • Tab "7/14 (Tue)" ← Poplar Bluff Info Session 7/14 (5:00–6:30pm)
 *   • Tab "7/15 (Wed)" ← Poplar Bluff Info Session 7/15 (1:00–2:30pm)
 * Push-driven: the worker POSTs here on every new RSVP and routes to the right
 * tab by session. A safety-net poll runs hourly to backfill anything missed.
 * The door check-in link (one link for both nights) stamps Attendance; you can
 * also mark Attendance by hand and it writes back to the database.
 *
 * SETUP (once, ~3 min):
 *   1. Extensions → Apps Script → paste this whole file → Save.
 *   2. Run `setUp` (authorize when asked). Builds both tabs + formatting.
 *   3. Deploy → New deployment → Type: Web app → Execute as: Me,
 *      Who has access: Anyone. Copy the /exec URL.
 *   4. Menu 🔄 Groundwork → Register webhook URL → paste that URL
 *      (registers BOTH sessions at once).
 *   5. Menu 🔄 Groundwork → Backfill from worker (pulls existing RSVPs).
 *   Done. New RSVPs land in the right tab within seconds.
 *
 * COLUMN LAYOUT (per tab):
 *   A First · B Last · C Email · D Phone · E Connection · F School · G District · H Recruited by
 *   I Attendance (feed + manual) · J Notes (free text — only ever appends "Walk-in")
 *   A–H are form-fed and rewritten on every push. I is filled from the door
 *   check-in but never clobbers a mark you typed. J is yours.
 */

const KEY    = 'p4mps-rKItacZ0arZKMy12UZuRBYwJVP_LJ4iU';
const WORKER = 'https://groundwork-pilot.elizabethmck.workers.dev';

// One entry per session. `event` MUST match the launch name the RSVP form posts
// and the check-in link stamps (see LAUNCH_EVENTS / launchConfig in the worker).
const SESSIONS = [
  { tab: '7/14 (Tue)', event: 'Poplar Bluff Info Session 7/14', when: 'Tuesday, July 14 · 5:00–6:30pm' },
  { tab: '7/15 (Wed)', event: 'Poplar Bluff Info Session 7/15', when: 'Wednesday, July 15 · 1:00–2:30pm' },
];

const DATA_COLS = 8;                 // A..H form-fed
const HDR = 1, FIRST = 2;
const EMAIL_COL = 3, PHONE_COL = 4, RECRUIT_COL = 8;
const ATT_COL = 9;                   // I Attendance
const NOTES_COL = 10;                // J Notes (free text)
const TOTAL_COLS = 10;
const HEADERS = ['First Name','Last Name','Email','Phone','Connection','School','District','Recruited by','Attendance','Notes'];
const ATTEND = ['Scheduled','Attended','Walk-in','No-show','Canceled'];
const SHOW = ['Attended','Walk-in'];

// Brand
const FONT='Archivo', PLUM='#3e4f6e', YELLOW='#d5b069', PAPER='#E9E5CE', INK='#1A2418', BAND='#EDEFF4';
const C_GREEN='#CDE9D5', C_RED='#F2C9C4', C_GREY='#E0E0E0', C_NEUTRAL='#EDEFF4', FILL_TINT='#F0E2C2';

var _bulk = false;

// ---- session lookup ---------------------------------------------------------
function sessionForEvent(ev){
  ev = String(ev||'').trim();
  for (var i=0;i<SESSIONS.length;i++){ if (SESSIONS[i].event === ev) return SESSIONS[i]; }
  return null;
}
function tabFor(ev){ var s=sessionForEvent(ev); return s ? SpreadsheetApp.getActive().getSheetByName(s.tab) : null; }

// ============================================================================
// WEBHOOK RECEIVER — worker POSTs here on every RSVP; route by session.
// ============================================================================
function doPost(e){
  try {
    var p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var sh = tabFor(p.event);
    if (!sh) return _resp({ok:false, reason:'unknown session', event:p.event});
    _upsertRow(sh, p);
    return _resp({ok:true});
  } catch (err) {
    return _resp({ok:false, error:String(err)});
  }
}
function _resp(o){ return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// Recruited-by is carried in the webhook `notes` blob as "Recruited by: X".
function recruitFromNotes(notes){
  var m = String(notes||'').match(/Recruited by:\s*([^|]+)/i);
  return m ? m[1].trim() : '';
}

function _upsertRow(sh, p){
  if (!sh) return;
  // Never land test/canary submissions in the live sheet (matches the worker's
  // export test-name filter, so a smoke test can't clutter organizers' view).
  var fn = String(p.first||'').trim(), em = String(p.email||'').toLowerCase();
  if (/^(test|testcanary|smoke|canary|sample|demo|audit)/i.test(fn) || /test|canary|smoke|example/i.test(em)) return;
  var email = String(p.email||'').trim().toLowerCase();
  var phoneKey = String(p.phone||'').replace(/\D/g,'').slice(-10);
  var last = sh.getLastRow();
  var existingRow = -1;
  if (last >= FIRST){
    var data = sh.getRange(FIRST,1,last-FIRST+1,DATA_COLS).getValues();
    for (var i=0;i<data.length;i++){
      var rE = String(data[i][EMAIL_COL-1]||'').trim().toLowerCase();
      var rP = String(data[i][PHONE_COL-1]||'').replace(/\D/g,'').slice(-10);
      if ((email && rE===email) || (phoneKey && rP===phoneKey)){ existingRow = FIRST+i; break; }
    }
  }
  var recruited = p.recruited || recruitFromNotes(p.notes);
  // A–G always rewritten; H (Recruited by) only when we actually have one.
  var core = [ p.first||'', p.last||'', p.email||'', p.phone||'', p.role||'', p.school||'', p.district||'' ];
  var targetRow;
  if (existingRow > 0){
    targetRow = existingRow;
    sh.getRange(existingRow,1,1,7).setValues([core]);
    if (recruited) sh.getRange(existingRow,RECRUIT_COL).setValue(recruited);
    if (p.attendance){
      var cell = sh.getRange(existingRow,ATT_COL);
      var cur = String(cell.getValue()||'').trim();
      if (!cur || cur==='Scheduled' || ATTEND.indexOf(cur) < 0) cell.setValue(p.attendance);
    }
  } else {
    targetRow = last < FIRST ? FIRST : last+1;
    sh.getRange(targetRow,1,1,7).setValues([core]);
    if (recruited) sh.getRange(targetRow,RECRUIT_COL).setValue(recruited);
    sh.getRange(targetRow,ATT_COL).setValue(p.attendance || 'Scheduled');
    brandRows(sh, last-FIRST+2);
  }
  // Durable walk-in marker in Notes (append, never overwrite typed text).
  if (p.walkin || p.attendance === 'Walk-in'){
    var n = sh.getRange(targetRow,NOTES_COL); var curN = String(n.getValue()||'').trim();
    if (!/walk-?in/i.test(curN)) n.setValue(curN ? curN + ' · Walk-in' : 'Walk-in');
  }
  if (!_bulk){ try { writeCounts(sh); } catch(_){} }
}

// ============================================================================
// MENU
// ============================================================================
function onOpen(){
  SpreadsheetApp.getUi().createMenu('🔄 Groundwork')
    .addItem('Register webhook URL','menuRegisterWebhook')
    .addItem('Backfill from worker','menuBackfill')
    .addSeparator()
    .addItem('Safety-net refresh now','safetyRefresh')
    .addItem('Pull attendance + walk-ins now','pullAttendance')
    .addItem('Set up / repair tracker','setUp')
    .addToUi();
}

function menuRegisterWebhook(){
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Register this sheet as a webhook receiver',
    'Paste the Web App /exec URL (Deploy → New deployment → Web app).\nRegisters BOTH sessions at once.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var url = r.getResponseText().trim();
  if (url.indexOf('https://script.google.com/') !== 0){ ui.alert('That should start with https://script.google.com/macros/s/…/exec'); return; }
  var okAll = true, msg = [];
  for (var i=0;i<SESSIONS.length;i++){
    var resp = UrlFetchApp.fetch(WORKER + '/pilot/webhook/register', {
      method:'post', contentType:'application/json',
      payload: JSON.stringify({ event: SESSIONS[i].event, url: url }), muteHttpExceptions:true });
    msg.push(SESSIONS[i].tab + ': ' + (resp.getResponseCode()===200 ? 'ok' : resp.getContentText()));
    if (resp.getResponseCode() !== 200) okAll = false;
  }
  if (okAll){
    PropertiesService.getScriptProperties().setProperty('webhookUrl', url);
    ui.alert('✅ Registered both sessions.\n' + msg.join('\n') + '\n\nNext: 🔄 Groundwork → Backfill from worker.');
  } else {
    ui.alert('Some registrations failed:\n' + msg.join('\n'));
  }
}

function menuBackfill(){
  var url = PropertiesService.getScriptProperties().getProperty('webhookUrl');
  if (!url){ SpreadsheetApp.getUi().alert('Register the webhook URL first.'); return; }
  var msg = [];
  for (var i=0;i<SESSIONS.length;i++){
    var resp = UrlFetchApp.fetch(WORKER + '/pilot/webhook/replay', {
      method:'post', contentType:'application/json',
      payload: JSON.stringify({ event: SESSIONS[i].event, url: url }), muteHttpExceptions:true });
    msg.push(SESSIONS[i].tab + ': ' + resp.getContentText());
  }
  SpreadsheetApp.getActive().toast('Backfill — ' + msg.join(' | '), 'Groundwork', 8);
  try { pullAttendance(); } catch(_){}
}

// ============================================================================
// SAFETY-NET POLL (hourly) — pull each session's RSVP CSV + attendance, upsert.
// ============================================================================
function safetyRefresh(){
  for (var i=0;i<SESSIONS.length;i++){
    var s = SESSIONS[i];
    var sh = SpreadsheetApp.getActive().getSheetByName(s.tab); if (!sh) continue;
    var url = WORKER + '/export/rsvps.csv?key=' + encodeURIComponent(KEY) + '&event=' + encodeURIComponent(s.event) + '&t=' + Date.now();
    var resp;
    try { resp = UrlFetchApp.fetch(url, { muteHttpExceptions:true }); } catch(e){ continue; }
    if (resp.getResponseCode() !== 200) continue;
    var rows = Utilities.parseCsv(resp.getContentText());
    if (rows.length < 2) continue;
    if (rows[0].map(function(h){return String(h).toLowerCase();}).indexOf('email') === -1) continue;
    var body = rows.slice(1);
    _bulk = true;
    try {
      for (var r=0;r<body.length;r++){
        var row = body[r];
        _upsertRow(sh, { event:s.event, first:row[0]||'', last:row[1]||'', email:row[2]||'', phone:row[3]||'', role:row[4]||'', school:row[5]||'', district:row[6]||'' });
      }
    } finally { _bulk = false; }
    try { writeCounts(sh); } catch(_){}
  }
  try { pullAttendance(); } catch(_){}
}

// ============================================================================
// ATTENDANCE + WALK-INS — details feed: First,Last,Email,Phone,Role,School,
// District,Recruited By,Status,Walk-in. Walk-ins exist only in Airtable (no RSVP
// row) so this is the only path that adds them. Never clobbers a manual mark.
// ============================================================================
function pullAttendance(){
  for (var i=0;i<SESSIONS.length;i++){
    var s = SESSIONS[i];
    var sh = SpreadsheetApp.getActive().getSheetByName(s.tab); if (!sh) continue;
    var url = WORKER + '/export/attendance.csv?details=1&key=' + encodeURIComponent(KEY) + '&event=' + encodeURIComponent(s.event) + '&t=' + Date.now();
    var resp;
    try { resp = UrlFetchApp.fetch(url, { muteHttpExceptions:true }); } catch(e){ continue; }
    if (resp.getResponseCode() !== 200) continue;
    var rows = Utilities.parseCsv(resp.getContentText());
    if (rows.length < 2) continue;
    var body = rows.slice(1);
    _bulk = true;
    try {
      for (var r=0;r<body.length;r++){
        var row = body[r];
        var status = String(row[8]||'').trim();
        var isWalk = String(row[9]||'').trim().toLowerCase() === 'yes' || status === 'Walk-in';
        _upsertRow(sh, {
          event:s.event, first:row[0]||'', last:row[1]||'', email:row[2]||'', phone:row[3]||'',
          role:row[4]||'', school:row[5]||'', district:row[6]||'', recruited:row[7]||'',
          attendance: isWalk ? 'Walk-in' : (status || 'Attended'), walkin: isWalk,
        });
      }
    } finally { _bulk = false; }
    try { writeCounts(sh); } catch(_){}
  }
}

// Attendance edits write back to the database.
function onEdit(e){
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  var s = null;
  for (var i=0;i<SESSIONS.length;i++){ if (SESSIONS[i].tab === sh.getName()){ s = SESSIONS[i]; break; } }
  if (!s) return;
  if (e.range.getColumn() > ATT_COL || e.range.getLastColumn() < ATT_COL) return;
  var r0 = Math.max(e.range.getRow(), FIRST), r1 = e.range.getLastRow();
  var marks = [];
  for (var r=r0;r<=r1;r++){
    var email = String(sh.getRange(r,EMAIL_COL).getValue()||'').trim();
    var status = String(sh.getRange(r,ATT_COL).getValue()||'').trim();
    if (!email || status === 'Scheduled') continue;
    marks.push({ email: email, status: status });
  }
  if (!marks.length) return;
  try {
    UrlFetchApp.fetch(WORKER + '/sheet-attendance?key=' + encodeURIComponent(KEY),
      { method:'post', contentType:'application/json', payload: JSON.stringify({ event: s.event, marks: marks }), muteHttpExceptions:true });
  } catch(_){}
  try { writeCounts(sh); } catch(_){}
}

// ============================================================================
// SETUP + FORMATTING
// ============================================================================
function setUp(){
  var ss = SpreadsheetApp.getActive();
  for (var i=0;i<SESSIONS.length;i++){
    var s = SESSIONS[i];
    var sh = ss.getSheetByName(s.tab);
    if (!sh){
      var all = ss.getSheets();
      sh = (all.length===1 && all[0].getLastRow()<1 && all[0].getLastColumn()<2) ? all[0].setName(s.tab) : ss.insertSheet(s.tab);
    }
    buildTab(sh, s);
  }
  // Drop a default empty "Sheet1" if it's still lying around.
  var junk = ss.getSheetByName('Sheet1');
  if (junk && junk.getLastRow() < 1) { try { ss.deleteSheet(junk); } catch(_){} }

  // Hourly safety-net poll + onEdit write-back (clear dupes first).
  var trs = ScriptApp.getProjectTriggers();
  for (var t=0;t<trs.length;t++){ var f=trs[t].getHandlerFunction(); if (f==='safetyRefresh' || f==='onEdit') ScriptApp.deleteTrigger(trs[t]); }
  ScriptApp.newTrigger('safetyRefresh').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('onEdit').forSpreadsheet(ss).onEdit().create();

  try { safetyRefresh(); } catch(_){}
  SpreadsheetApp.getUi().alert('Set up. Two tabs are live.\n\nNext: Deploy → New deployment → Web app, then 🔄 Groundwork → Register webhook URL, then Backfill from worker.');
}

function buildTab(sh, s){
  sh.setFrozenRows(HDR);
  sh.setFrozenColumns(2);
  // Header
  sh.getRange(HDR,1,1,TOTAL_COLS).setValues([HEADERS])
    .setFontFamily(FONT).setFontWeight('bold').setBackground(PLUM).setFontColor(YELLOW).setVerticalAlignment('middle');
  sh.setRowHeight(HDR, 30);
  // Attendance dropdown
  var dv = SpreadsheetApp.newDataValidation().requireValueInList(ATTEND, true).setAllowInvalid(true).build();
  sh.getRange(FIRST, ATT_COL, 1000, 1).setDataValidation(dv);
  // Widths
  var w = [95,95,210,120,120,150,160,140,120,240];
  for (var c=0;c<w.length;c++) sh.setColumnWidth(c+1, w[c]);
  sh.getRange(1,1,sh.getMaxRows(),TOTAL_COLS).setFontFamily(FONT);
  styleAttendance(sh);
  var lastRow = Math.max(sh.getLastRow(),FIRST);
  brandRows(sh, lastRow-FIRST+1);
  try { var ex=sh.getFilter(); if (ex) ex.remove(); sh.getRange(HDR,1,Math.max(lastRow-HDR+1,2),TOTAL_COLS).createFilter(); } catch(_){}
  writeCounts(sh);
}

function brandRows(sh, n){
  if (n <= 0) return;
  var rng = sh.getRange(FIRST,1,n,TOTAL_COLS);
  rng.getBandings().forEach(function(b){ b.remove(); });
  var bd = rng.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);
  try { bd.setHeaderRowColor(null).setFirstRowColor('#FFFFFF').setSecondRowColor(BAND); } catch(_){}
}

function styleAttendance(sh){
  var maxR = sh.getMaxRows()-FIRST+1;
  var rng = sh.getRange(FIRST,ATT_COL,maxR,1);
  var rules = sh.getConditionalFormatRules().filter(function(r){ return !r.getRanges().some(function(rg){ return rg.getColumn()===ATT_COL; }); });
  function eq(txt,bg){ return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(txt).setBackground(bg).setRanges([rng]).build(); }
  rules.push(eq('Attended',C_GREEN));
  rules.push(eq('Walk-in',C_GREEN));
  rules.push(eq('No-show',C_RED));
  rules.push(eq('Canceled',C_GREY));
  rules.push(eq('Scheduled',C_NEUTRAL));
  sh.setConditionalFormatRules(rules);
}

// Live count in a note on the header's Attendance cell: "RSVPs / showed".
function writeCounts(sh){
  var last = sh.getLastRow();
  var rsvps = 0, showed = 0, walkins = 0;
  if (last >= FIRST){
    var att = sh.getRange(FIRST,ATT_COL,last-FIRST+1,1).getValues();
    var notes = sh.getRange(FIRST,NOTES_COL,last-FIRST+1,1).getValues();
    for (var i=0;i<att.length;i++){
      var a = String(att[i][0]||'').trim();
      var isWalk = a==='Walk-in' || /walk-?in/i.test(String(notes[i][0]||''));
      rsvps++;
      if (isWalk) walkins++;
      if (SHOW.indexOf(a) >= 0 || isWalk) showed++;
    }
  }
  sh.getRange(HDR,ATT_COL).setNote(rsvps + ' in tracker · ' + showed + ' showed · ' + walkins + ' walk-in');
}
