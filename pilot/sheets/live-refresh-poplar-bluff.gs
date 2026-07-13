/**
 * Groundwork live turnout tracker — POPLAR BLUFF (Southeast Missouri).
 * TWO community info sessions + commitments + per-organizer goals:
 *   • Tab "Commitments"  ← live from the database: every commitment made at either
 *     session (fed by the capture page parents4mopublicschools.org/commit/poplar-bluff/)
 *   • Tab "Goals"        ← per-organizer leaderboard: Goal / RSVPs / Turnout / Flake rate
 *   • Tab "7/14 (Tue)"   ← Poplar Bluff Info Session 7/14 (5:00–6:30pm)
 *   • Tab "7/15 (Wed)"   ← Poplar Bluff Info Session 7/15 (1:00–2:30pm)
 * Push-driven (worker webhooks) + hourly safety-net poll.
 *
 * COLOR CODE (headers):
 *   RED    = live from the database — typing there gets overwritten. Hands off.
 *   BLUE   = yours — Claimed by, Attendance, Notes, Goal, Follow-up. Survives refresh.
 *
 * SETUP (once, ~3 min):
 *   1. Extensions → Apps Script → paste this whole file → Save.
 *   2. Run `setUp` (authorize when asked). Builds all four tabs.
 *   3. Deploy → New deployment → Type: Web app → Execute as: Me,
 *      Who has access: Anyone. Copy the /exec URL.
 *   4. Menu 🔄 Groundwork → Register webhook URL → paste it (both sessions at once).
 *   5. Menu 🔄 Groundwork → Backfill from worker.
 *
 * RSVP-tab columns:
 *   A First · B Last · C Email · D Phone · E Connection · F School · G District
 *   · H Recruited by  (all RED, form-fed — "Recruited by" is what the person
 *   self-reported on the form)
 *   I Claimed by (BLUE dropdown: Jamie Hobbs / Molly Fleming / Ellen Glover — or
 *   type any other name, it still counts on Goals) · J Attendance · K Notes
 */

const KEY    = 'p4mps-rKItacZ0arZKMy12UZuRBYwJVP_LJ4iU';
const WORKER = 'https://groundwork-pilot.elizabethmck.workers.dev';

// One entry per session. `event` MUST match the launch name the RSVP form posts
// and the check-in/commit pages stamp (see LAUNCH_EVENTS in the worker).
const SESSIONS = [
  { tab: '7/14 (Tue)', event: 'Poplar Bluff Info Session 7/14', date: '2026-07-14', when: 'Tuesday, July 14 · 5:00–6:30pm' },
  { tab: '7/15 (Wed)', event: 'Poplar Bluff Info Session 7/15', date: '2026-07-15', when: 'Wednesday, July 15 · 1:00–2:30pm' },
];
const COMMIT_TAB = 'Commitments';
const GOALS_TAB  = 'Goals';

// The three named organizers (dropdown defaults + Goals rows + claim colors).
// Anyone can TYPE another name in Claimed by — it shows up on Goals automatically.
const ORGANIZERS = ['Jamie Hobbs', 'Molly Fleming', 'Ellen Glover'];

// RSVP-tab layout
const DATA_COLS = 8;                 // A..H form-fed (RED)
const HDR = 1, FIRST = 2;
const EMAIL_COL = 3, PHONE_COL = 4, RECRUIT_COL = 8;
const CLAIM_COL = 9;                 // I Claimed by (BLUE)
const ATT_COL = 10;                  // J Attendance (BLUE)
const NOTES_COL = 11;                // K Notes (BLUE)
const TOTAL_COLS = 11;
const HEADERS = ['First Name','Last Name','Email','Phone','Connection','School','District','Recruited by','Claimed by','Attendance','Notes'];
const ATTEND = ['Scheduled','Attended','Walk-in','No-show','Canceled'];
const SHOW = ['Attended','Walk-in'];

// Commitments-tab layout: A–F RED (from the database), G–H BLUE (yours).
const C_HEADERS = ['Date','Session','First Name','Last Name','Commitment','Phone / Email','Follow-up status','Notes'];
const C_DATA_COLS = 6;
const C_FU_COL = 7, C_NOTES_COL = 8, C_TOTAL = 8;
const FOLLOWUP = ['Not started','Contacted','Scheduled','Done'];

// Brand
const FONT='Archivo';
const PLUM='#3e4f6e', YELLOW='#d5b069', ROSE='#b35049', PAPER='#E9E5CE', INK='#1A2418', BAND='#EDEFF4', ALERT='#FBE48A';
const C_GREEN='#CDE9D5', C_RED='#F2C9C4', C_GREY='#E0E0E0', C_NEUTRAL='#EDEFF4', C_BLUE='#D8E6F2', C_AMBER='#FBE8B0';
// Per-organizer claim colors (distinct, in ORGANIZERS order; extras stay white).
const CLAIM_COLORS = ['#CDE9D5', '#D8E6F2', '#FBE8B0'];   // Jamie green · Molly blue · Ellen amber

var _bulk = false;

// ---- session lookup ---------------------------------------------------------
function sessionForEvent(ev){
  ev = String(ev||'').trim();
  for (var i=0;i<SESSIONS.length;i++){ if (SESSIONS[i].event === ev) return SESSIONS[i]; }
  return null;
}
function isTestRow(first, email){
  return /^(test|testcanary|testbrowser|smoke|canary|sample|demo|audit)/i.test(String(first||'').trim())
      || /test|canary|smoke|example/i.test(String(email||'').toLowerCase());
}

// ============================================================================
// WEBHOOK RECEIVER — RSVPs route to their session tab; commitments to Commitments.
// ============================================================================
function doPost(e){
  try {
    var p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (p.type === 'commitment'){
      _upsertCommit(p);
      return _resp({ok:true});
    }
    var s = sessionForEvent(p.event);
    if (!s) return _resp({ok:false, reason:'unknown session', event:p.event});
    _upsertRow(SpreadsheetApp.getActive().getSheetByName(s.tab), p);
    return _resp({ok:true});
  } catch (err) {
    return _resp({ok:false, error:String(err)});
  }
}
function _resp(o){ return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// "Recruited by: X" travels in the webhook notes blob.
function recruitFromNotes(notes){
  var m = String(notes||'').match(/Recruited by:\s*([^|]+)/i);
  return m ? m[1].trim() : '';
}

function _upsertRow(sh, p){
  if (!sh) return;
  if (isTestRow(p.first, p.email)) return;   // smoke tests never clutter the live sheet
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
  if (p.walkin || p.attendance === 'Walk-in'){
    var n = sh.getRange(targetRow,NOTES_COL); var curN = String(n.getValue()||'').trim();
    if (!/walk-?in/i.test(curN)) n.setValue(curN ? curN + ' · Walk-in' : 'Walk-in');
  }
  if (!_bulk){ try { writeCounts(sh); refreshGoals(); } catch(_){} }
}

// Commitments tab upsert. Key = person (email, else name) + commitment.
function _upsertCommit(p){
  var sh = SpreadsheetApp.getActive().getSheetByName(COMMIT_TAB); if (!sh) return;
  if (isTestRow(p.first, p.email)) return;
  var s = sessionForEvent(p.event);
  var session = s ? s.tab : String(p.event||'');
  var email = String(p.email||'').trim().toLowerCase();
  var nameKey = (String(p.first||'').trim() + ' ' + String(p.last||'').trim()).toLowerCase();
  var cmt = String(p.commitment||'').trim();
  if (!cmt) return;
  var last = sh.getLastRow();
  if (last >= FIRST){
    var data = sh.getRange(FIRST,1,last-FIRST+1,C_DATA_COLS).getValues();
    for (var i=0;i<data.length;i++){
      var rowName = (String(data[i][2]||'').trim() + ' ' + String(data[i][3]||'').trim()).toLowerCase();
      var rowContact = String(data[i][5]||'').toLowerCase();
      var samePerson = (email && rowContact.indexOf(email)>=0) || (nameKey.trim() && rowName === nameKey);
      if (samePerson && String(data[i][4]||'').trim().toLowerCase() === cmt.toLowerCase()) return;   // already logged
    }
  }
  var target = last < FIRST ? FIRST : last+1;
  var contact = [p.phone||'', p.email||''].filter(function(x){return String(x).trim();}).join(' · ');
  sh.getRange(target,1,1,C_DATA_COLS).setValues([[ p.date||'', session, p.first||'', p.last||'', cmt, contact ]]);
  sh.getRange(target,C_FU_COL).setValue('Not started');
  brandRows(sh, target-FIRST+1, C_TOTAL);
  try { sh.getRange(HDR,1).setNote((target-FIRST+1) + ' commitments logged'); } catch(_){}
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
    .addItem('Refresh commitments now','pullCommitments')
    .addItem('Rebuild Goals','refreshGoals')
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
  try { pullCommitments(); } catch(_){}
}

// ============================================================================
// SAFETY-NET POLL (hourly)
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
  try { pullCommitments(); } catch(_){}
  try { refreshGoals(); } catch(_){}
}

// ============================================================================
// ATTENDANCE + WALK-INS
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
  try { refreshGoals(); } catch(_){}
}

// ============================================================================
// COMMITMENTS — per-person feed, scoped to each session's attendees + that day.
// ============================================================================
function pullCommitments(){
  for (var i=0;i<SESSIONS.length;i++){
    var s = SESSIONS[i];
    var url = WORKER + '/export/event-commitments.csv?details=1&key=' + encodeURIComponent(KEY)
      + '&event=' + encodeURIComponent(s.event) + '&since=' + s.date + '&t=' + Date.now();
    var resp;
    try { resp = UrlFetchApp.fetch(url, { muteHttpExceptions:true }); } catch(e){ continue; }
    if (resp.getResponseCode() !== 200) continue;
    var rows = Utilities.parseCsv(resp.getContentText());
    if (rows.length < 2) continue;
    var body = rows.slice(1);
    for (var r=0;r<body.length;r++){
      var row = body[r];   // First,Last,Email,Phone,Commitment,Date
      _upsertCommit({ event:s.event, first:row[0]||'', last:row[1]||'', email:row[2]||'', phone:row[3]||'', commitment:row[4]||'', date:row[5]||'' });
    }
  }
}

// ============================================================================
// GOALS — per-organizer leaderboard across BOTH sessions.
//   Organizer | Goal (yours) | RSVPs (claimed) | Turnout (showed) | Flake rate
// Rows: the three named organizers + anyone else typed in Claimed by +
// Unclaimed + TOTAL. The Goal column is hand-entered and preserved by name.
// ============================================================================
function refreshGoals(){
  var ss = SpreadsheetApp.getActive();
  var g = ss.getSheetByName(GOALS_TAB); if (!g) return;

  var stat = {};   // name(lower) -> {name, claimed, showed}
  var unc = { claimed:0, showed:0 };
  function bump(nameRaw){
    var k = String(nameRaw).trim().toLowerCase();
    return stat[k] || (stat[k] = { name: String(nameRaw).trim(), claimed:0, showed:0 });
  }
  ORGANIZERS.forEach(function(n){ bump(n); });   // always show the three, even at 0

  for (var i=0;i<SESSIONS.length;i++){
    var sh = ss.getSheetByName(SESSIONS[i].tab); if (!sh) continue;
    var last = sh.getLastRow();
    if (last < FIRST) continue;
    var claims = sh.getRange(FIRST,CLAIM_COL,last-FIRST+1,1).getValues();
    var att = sh.getRange(FIRST,ATT_COL,last-FIRST+1,1).getValues();
    var notes = sh.getRange(FIRST,NOTES_COL,last-FIRST+1,1).getValues();
    for (var r=0;r<claims.length;r++){
      var who = String(claims[r][0]||'').trim();
      var a = String(att[r][0]||'').trim();
      var showed = SHOW.indexOf(a) >= 0 || /walk-?in/i.test(String(notes[r][0]||''));
      var b = who ? bump(who) : unc;
      b.claimed++;
      if (showed) b.showed++;
    }
  }

  // Preserve hand-entered goals by organizer name before rewriting.
  var goals = {};
  var gLast = g.getLastRow();
  if (gLast >= 2){
    var prev = g.getRange(2,1,gLast-1,2).getValues();
    for (var p=0;p<prev.length;p++){
      var nm = String(prev[p][0]||'').trim().toLowerCase();
      if (nm && prev[p][1] !== '') goals[nm] = prev[p][1];
    }
  }

  // Rows: named organizers first (fixed order), then extras alphabetical.
  var keys = Object.keys(stat);
  var namedLower = ORGANIZERS.map(function(n){ return n.toLowerCase(); });
  var extras = keys.filter(function(k){ return namedLower.indexOf(k) < 0; }).sort();
  var order = namedLower.concat(extras);

  g.clearContents();
  g.getRange(1,1,1,5).setValues([['Organizer','Goal','RSVPs','Turnout','Flake rate']]);
  var out = [], tClaim=0, tShow=0;
  for (var o=0;o<order.length;o++){
    var b2 = stat[order[o]];
    tClaim += b2.claimed; tShow += b2.showed;
    out.push([ b2.name, goals[order[o]] !== undefined ? goals[order[o]] : '', b2.claimed, b2.showed,
               b2.claimed ? (b2.claimed - b2.showed) / b2.claimed : '' ]);
  }
  out.push(['Unclaimed', '', unc.claimed, unc.showed, unc.claimed ? (unc.claimed-unc.showed)/unc.claimed : '']);
  out.push(['TOTAL', goals['total'] !== undefined ? goals['total'] : '', tClaim + unc.claimed, tShow + unc.showed,
            (tClaim+unc.claimed) ? ((tClaim+unc.claimed)-(tShow+unc.showed))/(tClaim+unc.claimed) : '']);
  g.getRange(2,1,out.length,5).setValues(out);

  // Styling
  var n = out.length;
  g.getRange(1,1,1,5).setFontFamily(FONT).setFontWeight('bold').setBackground(PLUM).setFontColor(YELLOW);
  g.getRange(2,1,n,5).setFontFamily(FONT);
  g.getRange(2,5,n,1).setNumberFormat('0%');
  g.getRange(2,2,n,1).setFontColor('#1F5C3D').setFontWeight('bold');            // Goal col = yours
  g.getRange(1+n,1,1,5).setBackground(ALERT).setFontWeight('bold');             // Unclaimed
  g.getRange(2+n,1,1,5).setBackground('#EDEDEA').setFontWeight('bold');         // TOTAL
  // Claim colors on the organizer names, matching the RSVP-tab dropdown colors.
  for (var c=0;c<ORGANIZERS.length && c<CLAIM_COLORS.length;c++){
    g.getRange(2+c,1).setBackground(CLAIM_COLORS[c]);
  }
  var widths=[160,70,80,80,90];
  for (var w=0;w<widths.length;w++) g.setColumnWidth(w+1,widths[w]);
  g.getRange(1,7).setValue('Goal column is yours — set a number per organizer; it survives every refresh.')
    .setFontColor('#8A8F98').setFontStyle('italic').setFontSize(9);
}

// ============================================================================
// EDITS — Attendance writes back to the database; claims rebuild Goals.
// ============================================================================
function onEdit(e){
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  var s = null;
  for (var i=0;i<SESSIONS.length;i++){ if (SESSIONS[i].tab === sh.getName()){ s = SESSIONS[i]; break; } }
  if (!s) return;
  var c0 = e.range.getColumn(), c1 = e.range.getLastColumn();
  var touchesAtt = c0 <= ATT_COL && c1 >= ATT_COL;
  var touchesClaim = c0 <= CLAIM_COL && c1 >= CLAIM_COL;
  if (!touchesAtt && !touchesClaim) return;
  if (touchesAtt){
    var r0 = Math.max(e.range.getRow(), FIRST), r1 = e.range.getLastRow();
    var marks = [];
    for (var r=r0;r<=r1;r++){
      var email = String(sh.getRange(r,EMAIL_COL).getValue()||'').trim();
      var status = String(sh.getRange(r,ATT_COL).getValue()||'').trim();
      if (!email || status === 'Scheduled') continue;
      marks.push({ email: email, status: status });
    }
    if (marks.length){
      try {
        UrlFetchApp.fetch(WORKER + '/sheet-attendance?key=' + encodeURIComponent(KEY),
          { method:'post', contentType:'application/json', payload: JSON.stringify({ event: s.event, marks: marks }), muteHttpExceptions:true });
      } catch(_){}
    }
    try { writeCounts(sh); } catch(_){}
  }
  try { refreshGoals(); } catch(_){}
}

// ============================================================================
// SETUP + FORMATTING
// ============================================================================
function setUp(){
  var ss = SpreadsheetApp.getActive();
  // Tab order: Commitments · Goals · 7/14 · 7/15
  var wanted = [COMMIT_TAB, GOALS_TAB].concat(SESSIONS.map(function(s){ return s.tab; }));
  for (var i=0;i<wanted.length;i++){
    var sh = ss.getSheetByName(wanted[i]);
    if (!sh){
      var all = ss.getSheets();
      sh = (all.length===1 && all[0].getLastRow()<1 && all[0].getLastColumn()<2) ? all[0].setName(wanted[i]) : ss.insertSheet(wanted[i], i);
    }
    ss.setActiveSheet(sh); ss.moveActiveSheet(i+1);
  }
  buildCommitTab(ss.getSheetByName(COMMIT_TAB));
  for (var j=0;j<SESSIONS.length;j++) buildSessionTab(ss.getSheetByName(SESSIONS[j].tab), SESSIONS[j]);
  var junk = ss.getSheetByName('Sheet1');
  if (junk && junk.getLastRow() < 1) { try { ss.deleteSheet(junk); } catch(_){} }

  var trs = ScriptApp.getProjectTriggers();
  for (var t=0;t<trs.length;t++){ var f=trs[t].getHandlerFunction(); if (f==='safetyRefresh' || f==='onEdit') ScriptApp.deleteTrigger(trs[t]); }
  ScriptApp.newTrigger('safetyRefresh').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('onEdit').forSpreadsheet(ss).onEdit().create();

  try { safetyRefresh(); } catch(_){}
  try { refreshGoals(); } catch(_){}
  SpreadsheetApp.getUi().alert(
    'Set up. Four tabs: Commitments · Goals · 7/14 · 7/15.\n\n' +
    'RED headers = live from the database (hands off).\n' +
    'BLUE headers = yours (Claimed by, Attendance, Notes, Goal, Follow-up).\n\n' +
    'Next: Deploy → New deployment → Web app, then 🔄 Groundwork → Register webhook URL, then Backfill from worker.');
}

function buildSessionTab(sh, s){
  sh.setFrozenRows(HDR);
  sh.setFrozenColumns(2);
  sh.getRange(HDR,1,1,TOTAL_COLS).setValues([HEADERS]).setFontFamily(FONT).setFontWeight('bold').setVerticalAlignment('middle');
  // RED = database columns (hands off) · BLUE (plum) = organizer columns.
  sh.getRange(HDR,1,1,DATA_COLS).setBackground(ROSE).setFontColor(PAPER);
  sh.getRange(HDR,CLAIM_COL,1,TOTAL_COLS-DATA_COLS).setBackground(PLUM).setFontColor(YELLOW);
  sh.setRowHeight(HDR, 30);
  // Dropdowns: Claimed by (organizers, open list) + Attendance.
  var dvClaim = SpreadsheetApp.newDataValidation().requireValueInList(ORGANIZERS, true).setAllowInvalid(true).build();
  sh.getRange(FIRST, CLAIM_COL, 1000, 1).setDataValidation(dvClaim);
  var dvAtt = SpreadsheetApp.newDataValidation().requireValueInList(ATTEND, true).setAllowInvalid(true).build();
  sh.getRange(FIRST, ATT_COL, 1000, 1).setDataValidation(dvAtt);
  var w = [95,95,200,115,115,145,155,130,130,110,220];
  for (var c=0;c<w.length;c++) sh.setColumnWidth(c+1, w[c]);
  sh.getRange(1,1,sh.getMaxRows(),TOTAL_COLS).setFontFamily(FONT);
  styleSession(sh);
  var lastRow = Math.max(sh.getLastRow(),FIRST);
  brandRows(sh, lastRow-FIRST+1);
  try { var ex=sh.getFilter(); if (ex) ex.remove(); sh.getRange(HDR,1,Math.max(lastRow-HDR+1,2),TOTAL_COLS).createFilter(); } catch(_){}
  try { sh.getRange(HDR,CLAIM_COL).setNote('Pick a name — or type any other name; it still counts on the Goals tab.'); } catch(_){}
  writeCounts(sh);
}

function buildCommitTab(sh){
  sh.setFrozenRows(HDR);
  sh.getRange(HDR,1,1,C_TOTAL).setValues([C_HEADERS]).setFontFamily(FONT).setFontWeight('bold').setVerticalAlignment('middle');
  sh.getRange(HDR,1,1,C_DATA_COLS).setBackground(ROSE).setFontColor(PAPER);          // RED: from the database
  sh.getRange(HDR,C_FU_COL,1,C_TOTAL-C_DATA_COLS).setBackground(PLUM).setFontColor(YELLOW);  // BLUE: yours
  sh.setRowHeight(HDR, 30);
  var dv = SpreadsheetApp.newDataValidation().requireValueInList(FOLLOWUP, true).setAllowInvalid(true).build();
  sh.getRange(FIRST, C_FU_COL, 1000, 1).setDataValidation(dv);
  var w = [95,95,110,110,220,230,130,240];
  for (var c=0;c<w.length;c++) sh.setColumnWidth(c+1, w[c]);
  sh.getRange(1,1,sh.getMaxRows(),C_TOTAL).setFontFamily(FONT);
  // Follow-up pills
  var rng = sh.getRange(FIRST,C_FU_COL,sh.getMaxRows()-FIRST+1,1);
  var rules = sh.getConditionalFormatRules().filter(function(r){ return !r.getRanges().some(function(rg){ return rg.getColumn()===C_FU_COL; }); });
  function eq(txt,bg){ return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(txt).setBackground(bg).setRanges([rng]).build(); }
  rules.push(eq('Not started',C_RED)); rules.push(eq('Contacted',C_AMBER));
  rules.push(eq('Scheduled',C_BLUE)); rules.push(eq('Done',C_GREEN));
  sh.setConditionalFormatRules(rules);
  var lastRow = Math.max(sh.getLastRow(),FIRST);
  brandRows(sh, lastRow-FIRST+1, C_TOTAL);
  try { var ex=sh.getFilter(); if (ex) ex.remove(); sh.getRange(HDR,1,Math.max(lastRow-HDR+1,2),C_TOTAL).createFilter(); } catch(_){}
  try { sh.getRange(HDR,1).setNote('Fed by the capture page: parents4mopublicschools.org/commit/poplar-bluff/'); } catch(_){}
}

function brandRows(sh, n, cols){
  if (n <= 0) return;
  cols = cols || TOTAL_COLS;
  var rng = sh.getRange(FIRST,1,n,cols);
  rng.getBandings().forEach(function(b){ b.remove(); });
  var bd = rng.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);
  try { bd.setHeaderRowColor(null).setFirstRowColor('#FFFFFF').setSecondRowColor(BAND); } catch(_){}
}

function styleSession(sh){
  var maxR = sh.getMaxRows()-FIRST+1;
  var attR = sh.getRange(FIRST,ATT_COL,maxR,1);
  var claimR = sh.getRange(FIRST,CLAIM_COL,maxR,1);
  var rules = sh.getConditionalFormatRules().filter(function(r){
    return !r.getRanges().some(function(rg){ var c=rg.getColumn(); return c===ATT_COL || c===CLAIM_COL; });
  });
  function eq(rng,txt,bg){ return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(txt).setBackground(bg).setRanges([rng]).build(); }
  rules.push(eq(attR,'Attended',C_GREEN));
  rules.push(eq(attR,'Walk-in',C_GREEN));
  rules.push(eq(attR,'No-show',C_RED));
  rules.push(eq(attR,'Canceled',C_GREY));
  rules.push(eq(attR,'Scheduled',C_NEUTRAL));
  // Per-organizer claim colors (same palette as their Goals rows).
  for (var i=0;i<ORGANIZERS.length && i<CLAIM_COLORS.length;i++){
    rules.push(eq(claimR, ORGANIZERS[i], CLAIM_COLORS[i]));
  }
  sh.setConditionalFormatRules(rules);
}

// Live count note on the header's Attendance cell.
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
