/**
 * Groundwork live turnout tracker — KANSAS CITY launch (Thu 7/9).
 * PUSH-DRIVEN version: worker POSTs to this sheet on every new RSVP.
 * Safety-net poll runs once/hour (well under the UrlFetch daily quota).
 *
 * SETUP (once per sheet, ~3 min):
 *   1. Paste this script into Extensions → Apps Script → Save.
 *   2. Run `setUp` — authorize when prompted. Builds tabs + formatting.
 *   3. Deploy → New deployment → Type: Web app.
 *      - Execute as: Me
 *      - Who has access: Anyone
 *      Copy the deployment URL (starts with https://script.google.com/macros/s/…/exec).
 *   4. Menu: 🔄 Groundwork → Register webhook URL → paste the URL above.
 *   5. Menu: 🔄 Groundwork → Backfill from worker (pulls all existing RSVPs).
 *   Done. New RSVPs appear within 5 seconds.
 *
 * COLUMN LAYOUT (this sheet is the source of truth — do not add phantom columns):
 *   A First Name · B Last Name · C Email · D Phone · E Role · F School · G District · H Who Recruited
 *   I Claimed by · J Reminder: assigned to · K Reminder: status · L Attendance · M Notes (free text)
 *   A–H (DATA_COLS) are form-fed and rewritten on every push. I–L are the manual
 *   organizer columns. M (Notes) is free text the script never touches.
 */

const KEY     = 'p4mps-rKItacZ0arZKMy12UZuRBYwJVP_LJ4iU';
const EVENT   = 'Kansas City Emergency Meeting 7/9';
const LEADS   = 'LaNee,David,Facebook,Other';
const STATUS  = 'Not started,Texted,Called,Left message,Confirmed coming,No answer,Declined';
const ATTEND  = 'Scheduled,Self check-in,Attended,No-show,Walk-in,Canceled';
const RSVP_URL    = 'https://parents4mopublicschools.org/launches/kc/';
const CHECKIN_URL = 'https://parents4mopublicschools.org/checkin/kansas-city/';
const WORKER  = 'https://groundwork-pilot.elizabethmck.workers.dev';

const FONT='Archivo';
const PLUM='#3e4f6e', YELLOW='#d5b069', ROSE='#b35049', TANGERINE='#af5a2b';
const PAPER='#E9E5CE', INK='#1A2418', BAND='#EDEFF4', ALERT='#FBE48A';
const FILL_TINT='#F0E2C2';
const C_RED='#F2C9C4', C_GREEN='#CDE9D5', C_GREEN_STRONG='#1F7A43', C_GREY='#E0E0E0', C_BLUE='#D8E6F2', C_AMBER='#FBE8B0', C_NEUTRAL='#EDEFF4';

const TAB='RSVPs (live)';
// Data columns A–H (form-fed). A–G are always rewritten on a push; H (Who Recruited)
// is only written when we actually have a recruiter (walk-in door check-in), so a
// normal refresh never blanks it.
const DATA_COLS=8;                    // A..H
const MANUAL=['Claimed by','Reminder: assigned to','Reminder: status','Attendance'];  // I..L
const M_START=DATA_COLS+1;            // I = 9  (Claimed by)
const TOTAL_COLS=DATA_COLS+MANUAL.length;   // A..L = 12
const RECRUIT_COL=8;                  // H = Who Recruited
const CLAIM_COL=M_START;              // I = Claimed by
const ATT_COL=M_START+3;              // L = Attendance
const NOTES_COL=TOTAL_COLS+1;         // M = 13 (free-text Notes; never rewritten)
const EMAIL_COL=3, HDR=1, FIRST=2;

// Attendance values that count as "showed up".
const SHOW=['Attended','Self check-in','Walk-in'];

// Suppresses the per-row Goals rebuild during bulk pulls (set true around loops,
// then rebuild once). Without this a 200-row pull rebuilds Goals 200 times.
var _bulk=false;

// ============================================================================
// WEBHOOK RECEIVER — worker POSTs here on every new RSVP for our event.
// ============================================================================
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || '{}');
    if (payload.event !== EVENT) return _resp({ok:false, reason:'event mismatch'});
    _upsertRow(payload);
    return _resp({ok:true});
  } catch (err) {
    return _resp({ok:false, error: String(err)});
  }
}
function _resp(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function _upsertRow(p) {
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB);
  if (!sh) return;
  const email = String(p.email||'').trim().toLowerCase();
  const phoneKey = String(p.phone||'').replace(/\D/g,'').slice(-10);
  const last = sh.getLastRow();
  let existingRow = -1;
  if (last >= FIRST) {
    const data = sh.getRange(FIRST, 1, last-FIRST+1, DATA_COLS).getValues();
    for (let i=0;i<data.length;i++) {
      const rowEmail = String(data[i][EMAIL_COL-1]||'').trim().toLowerCase();
      const rowPhone = String(data[i][3]||'').replace(/\D/g,'').slice(-10);
      if ((email && rowEmail === email) || (phoneKey && rowPhone === phoneKey)) {
        existingRow = FIRST + i; break;
      }
    }
  }
  // A–G: form-fed roster, always rewritten. H (Who Recruited) only when supplied.
  const core = [ p.first||'', p.last||'', p.email||'', p.phone||'', p.role||'', p.school||'', p.district||'' ];
  const ATTEND_SET = ATTEND.split(',');
  let targetRow;
  if (existingRow > 0) {
    targetRow = existingRow;
    sh.getRange(existingRow, 1, 1, 7).setValues([core]);
    if (p.recruited) sh.getRange(existingRow, RECRUIT_COL).setValue(p.recruited);
    // Attendance from Airtable (attendance/walk-in pull). Fill blank / 'Scheduled' /
    // any leaked non-attendance value, but never clobber a real manual mark
    // (Attended / No-show / Canceled that an organizer typed).
    if (p.attendance) {
      const attCell = sh.getRange(existingRow, ATT_COL);
      const cur = String(attCell.getValue()||'').trim();
      if (!cur || cur === 'Scheduled' || ATTEND_SET.indexOf(cur) < 0) attCell.setValue(p.attendance);
    }
  } else {
    targetRow = last < FIRST ? FIRST : last + 1;
    sh.getRange(targetRow, 1, 1, 7).setValues([core]);
    if (p.recruited) sh.getRange(targetRow, RECRUIT_COL).setValue(p.recruited);
    // Seed manual values. Walk-ins already showed, so skip the reminder seed and
    // stamp Attendance directly.
    sh.getRange(targetRow, M_START+2).setValue(p.attendance === 'Walk-in' ? '' : 'Not started');   // K reminder status
    sh.getRange(targetRow, ATT_COL).setValue(p.attendance || 'Scheduled');                          // L attendance
    brandRows(sh, last-FIRST+2);
  }
  // Repair leftover from the earlier off-by-one bug: a stray 'Walk-in' written into
  // the Notes column (M).
  if (p.attendance === 'Walk-in') {
    const nCell = sh.getRange(targetRow, NOTES_COL);
    if (String(nCell.getValue()||'').trim() === 'Walk-in') nCell.clearContent();
  }
  if (!_bulk) { try { writeStats(); } catch(e) {} }
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
    .addItem('Rebuild How-to + Goals','installHelp')
    .addItem('Re-apply branding','brandSheet')
    .addToUi();
}

function menuRegisterWebhook() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt(
    'Register this sheet as a webhook receiver',
    'Paste the deployment URL you got from Deploy → New deployment → Web app:\n(Starts with https://script.google.com/macros/s/…/exec)',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const url = r.getResponseText().trim();
  if (!url.startsWith('https://script.google.com/')) {
    ui.alert('That doesn\'t look like a Web App URL. Should start with https://script.google.com/macros/s/…/exec');
    return;
  }
  const resp = UrlFetchApp.fetch(WORKER + '/pilot/webhook/register', {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ event: EVENT, url: url }),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() === 200) {
    PropertiesService.getScriptProperties().setProperty('webhookUrl', url);
    ui.alert('✅ Registered. New RSVPs will push to this sheet within seconds.\n\nNext step: click 🔄 Groundwork → Backfill from worker to pull existing RSVPs.');
  } else {
    ui.alert('Register failed: ' + resp.getContentText());
  }
}

function menuBackfill() {
  const url = PropertiesService.getScriptProperties().getProperty('webhookUrl');
  if (!url) {
    SpreadsheetApp.getUi().alert('Register the webhook URL first (Groundwork → Register webhook URL).');
    return;
  }
  const resp = UrlFetchApp.fetch(WORKER + '/pilot/webhook/replay', {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ event: EVENT, url: url }),
    muteHttpExceptions: true,
  });
  SpreadsheetApp.getActive().toast('Backfill: ' + resp.getContentText(), 'Groundwork', 8);
}

// ============================================================================
// SAFETY-NET POLL (once/hour) — pulls the RSVP CSV + attendance and upserts any
// rows the webhook missed. A handful of UrlFetch calls per hour, way under quota.
// ============================================================================
function safetyRefresh() {
  const url = WORKER + '/export/rsvps.csv?key=' + encodeURIComponent(KEY)
    + '&event=' + encodeURIComponent(EVENT) + '&t=' + Date.now();
  const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) { try { pullAttendance(); } catch(e){} return; }
  const rows = Utilities.parseCsv(resp.getContentText());
  if (rows.length < 2) return;
  const hd = rows[0].map(h => String(h).toLowerCase());
  if (hd.indexOf('email') === -1) return;
  const body = rows.slice(1);
  _bulk = true;
  try {
    for (const r of body) {
      _upsertRow({
        event: EVENT,
        first: r[0]||'', last: r[1]||'', email: r[2]||'', phone: r[3]||'',
        role: r[4]||'', school: r[5]||'', district: r[6]||'',
      });
    }
  } finally { _bulk = false; }
  try { pullAttendance(); } catch(e) {}   // fold in check-ins + door walk-ins, then rebuild Goals
}

// ============================================================================
// ATTENDANCE + WALK-INS — the details feed returns everyone with an 'Event
// attendance' row (check-ins, dashboard marks, and door walk-ins) with a Status
// (Attended / Self check-in / Walk-in) and a Walk-in flag. Walk-ins exist only in
// Airtable (no RSVP row), so this is the only path that adds them. RSVP'd attendees
// already have a row; this stamps their Attendance from the real check-in data.
// Never clobbers a manual mark (see _upsertRow). Piggybacks on the hourly poll;
// also runnable from the menu.
// ============================================================================
function pullAttendance() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB); if (!sh) return;
  const url = WORKER + '/export/attendance.csv?details=1&key=' + encodeURIComponent(KEY)
    + '&event=' + encodeURIComponent(EVENT) + '&t=' + Date.now();
  let resp;
  try { resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true }); }
  catch (e) { return; }                                   // urlfetch quota / network -> retry next cycle
  if (resp.getResponseCode() !== 200) return;
  const rows = Utilities.parseCsv(resp.getContentText());
  if (rows.length < 2) return;
  const hd = rows[0].map(h => String(h).toLowerCase().trim());
  const wi = hd.indexOf('walk-in'), st = hd.indexOf('status'), rc = hd.indexOf('recruited by');
  if (hd.indexOf('email') === -1 || wi === -1 || st === -1) return;   // not our CSV -> bail, never wipe

  // One-time repair of the earlier off-by-one bug: reminder-status values that
  // leaked into the Attendance column, and attendance values that leaked into Notes.
  const last = sh.getLastRow();
  if (last >= FIRST) {
    const STATUS_SET = STATUS.split(',');
    const attRng = sh.getRange(FIRST, ATT_COL, last-FIRST+1, 1);
    const noteRng = sh.getRange(FIRST, NOTES_COL, last-FIRST+1, 1);
    const av = attRng.getValues(), nv = noteRng.getValues();
    let dA=false, dN=false;
    for (let i=0;i<av.length;i++) {
      const a = String(av[i][0]||'').trim();
      if (a && STATUS_SET.indexOf(a) >= 0) { av[i][0]='Scheduled'; dA=true; }   // reminder status in Attendance
      const n = String(nv[i][0]||'').trim();
      if (n === 'Scheduled' || n === 'Walk-in') { nv[i][0]=''; dN=true; }        // attendance leaked into Notes
    }
    if (dA) attRng.setValues(av);
    if (dN) noteRng.setValues(nv);
  }

  _bulk = true;
  try {
    for (const r of rows.slice(1)) {
      const isWalk = String(r[wi]||'').trim().toLowerCase() === 'yes';
      const status = String(r[st]||'').trim() || (isWalk ? 'Walk-in' : 'Attended');
      _upsertRow({
        event: EVENT,
        first: r[0]||'', last: r[1]||'', email: r[2]||'', phone: r[3]||'',
        role: r[4]||'', school: r[5]||'', district: r[6]||'',
        recruited: rc >= 0 ? (r[rc]||'') : '',
        attendance: status,
      });
    }
  } finally { _bulk = false; }
  try { writeStats(); } catch(e) {}
}

// ============================================================================
// SETUP
// ============================================================================
function ensureGoals(ss){
  if(ss.getSheetByName('Goals')) return;
  const g=ss.insertSheet('Goals');
  g.getRange(1,1).setValue('Goals & leaderboard').setFontWeight('bold');
  g.getRange(3,1,1,4).setValues([['Lead','Goal','Registered (claimed)','% to goal']]);
  const leads=LEADS.split(',').map(function(s){return s.trim();}).filter(function(s){return s && ['facebook','other'].indexOf(s.toLowerCase())<0;});
  const rows=leads.map(function(n){return [n,10,'',''];});
  rows.push(['TOTAL','','','']);
  g.getRange(4,1,rows.length,4).setValues(rows);
}
function setUp(){
  const ss=SpreadsheetApp.getActive();
  let sh=ss.getSheetByName(TAB);
  if(!sh){
    const all=ss.getSheets();
    sh=(all.length===1 && all[0].getLastRow()<1 && all[0].getLastColumn()<2) ? all[0].setName(TAB) : ss.insertSheet(TAB);
  }
  ensureGoals(ss);
  // Migrate from the old banner layout: if row 1 is the warning banner, delete it
  // so headers land on row 1 and existing data shifts to row 2.
  try {
    const r1 = sh.getRange(1,1,1,Math.min(sh.getMaxColumns(),TOTAL_COLS)).getValues()[0].join(' ');
    if (r1.indexOf('⚠') >= 0 || r1.indexOf('LIVE LIST') >= 0) sh.deleteRow(1);
  } catch(e) {}
  // Headers on row 1 — no banner. Clear any old validations/merges leftover so
  // header cells never flag "Invalid".
  sh.getRange(1,1,2,TOTAL_COLS).breakApart().clearDataValidations();
  sh.getRange(HDR,M_START,1,MANUAL.length).setValues([MANUAL]);
  sh.getRange(HDR,1,1,DATA_COLS).setValues([['First Name','Last Name','Email','Phone','Role','School','District','Who Recruited']]);
  sh.getRange(HDR,1,1,TOTAL_COLS).setWrap(true).setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.setRowHeight(HDR,44);
  const dv=v=>SpreadsheetApp.newDataValidation().requireValueInList(v.split(','),true).setAllowInvalid(true).build();
  sh.getRange(FIRST,M_START,400,1).setDataValidation(dv(LEADS));      // I  Claimed by
  sh.getRange(FIRST,M_START+1,400,1).setDataValidation(dv(LEADS));    // J  Reminder: assigned to
  sh.getRange(FIRST,M_START+2,400,1).setDataValidation(dv(STATUS));   // K  Reminder: status
  sh.getRange(FIRST,ATT_COL,400,1).setDataValidation(dv(ATTEND));     // L  Attendance
  sh.setFrozenRows(1); sh.setFrozenColumns(2);
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(p=>{if(p.getDescription()==='GW live')p.remove();});
  sh.getRange(1,1,sh.getMaxRows(),DATA_COLS).protect().setDescription('GW live').setWarningOnly(true);
  styleStatuses(sh);
  // Trigger: safety-net poll once per hour (was every 1 min = quota killer).
  ScriptApp.getProjectTriggers().forEach(t=>{const f=t.getHandlerFunction(); if(['refreshRSVPs','safetyRefresh','onAttendanceEdit'].indexOf(f)>=0)ScriptApp.deleteTrigger(t);});
  ScriptApp.newTrigger('safetyRefresh').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('onAttendanceEdit').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  brandSheet();
  try { ensureTemplate(); } catch(e) {}
  try { installHelp(); } catch(e) {}
  try { writeStats(); } catch(e) {}
  brandSheet();
  SpreadsheetApp.getUi().alert(
    'Sheet is built. Two more steps:\n\n' +
    '1. Deploy → New deployment → Type: Web app.\n' +
    '   Execute as: Me. Who has access: Anyone. Copy the URL.\n\n' +
    '2. Menu: 🔄 Groundwork → Register webhook URL (paste it).\n\n' +
    '3. Menu: 🔄 Groundwork → Backfill from worker.'
  );
}

// ============================================================================
// EDIT HOOK — pushes attendance changes back to worker
// ============================================================================
function onAttendanceEdit(e){
  if(!e||!e.range) return;
  const sh=e.range.getSheet(); if(sh.getName()!==TAB) return;
  if(e.range.getColumn()>ATT_COL || e.range.getLastColumn()<ATT_COL) return;
  const r0=Math.max(e.range.getRow(),FIRST), r1=e.range.getLastRow();
  const marks=[];
  for(let r=r0;r<=r1;r++){
    const email=String(sh.getRange(r,EMAIL_COL).getValue()||'').trim();
    const status=String(sh.getRange(r,ATT_COL).getValue()||'').trim();
    if(!email || status==='Scheduled') continue;
    marks.push({email:email, status:status});
  }
  if(marks.length){
    UrlFetchApp.fetch(WORKER + '/sheet-attendance?key='+encodeURIComponent(KEY),
      {method:'post',contentType:'application/json',payload:JSON.stringify({event:EVENT,marks:marks}),muteHttpExceptions:true});
  }
  try { refreshGoals(); } catch(e) {}   // reflect the new mark in the leaderboard + turnout right away
}

// ============================================================================
// BRANDING
// ============================================================================
function brandSheet(){
  const sh=SpreadsheetApp.getActive().getSheetByName(TAB); if(!sh) return;
  const last=Math.max(sh.getLastRow(),FIRST);
  try{ sh.getRange(1,1,sh.getMaxRows(),TOTAL_COLS).setFontFamily(FONT); }catch(e){}
  try{ sh.getRange(HDR,1,1,DATA_COLS).setFontWeight('bold').setBackground(ROSE).setFontColor(PAPER); }catch(e){}
  try{ sh.getRange(HDR,M_START,1,MANUAL.length).setFontWeight('bold').setBackground(PLUM).setFontColor(YELLOW); }catch(e){}
  try{ const ex=sh.getFilter(); if(ex) ex.remove(); sh.getRange(HDR,1,Math.max(last-HDR+1,2),TOTAL_COLS).createFilter(); }catch(e){}
  try{ brandRows(sh, Math.max(last-FIRST+1,0)); }catch(e){}
  try{ styleStatuses(sh); }catch(e){}
}
function brandRows(sh, n){
  if(n<=0) return;
  const bandRange=sh.getRange(FIRST,1,n,DATA_COLS);
  bandRange.getBandings().forEach(b=>b.remove());
  const bd=bandRange.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY,false,false);
  try{ bd.setHeaderRowColor(null).setFirstRowColor('#FFFFFF').setSecondRowColor(BAND); }catch(e){}
}
function styleStatuses(sh){
  const claimCol=M_START, remCol=M_START+2, attCol=ATT_COL;
  const maxR=sh.getMaxRows()-FIRST+1;
  const remR=sh.getRange(FIRST,remCol,maxR,1), attR=sh.getRange(FIRST,attCol,maxR,1), fillR=sh.getRange(FIRST,claimCol,maxR,2);
  let rules=sh.getConditionalFormatRules().filter(r=>!r.getRanges().some(rg=>{const c=rg.getColumn(); return c>=claimCol && c<=attCol;}));
  const eq=(rng,txt,bg,fc)=>{let b=SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(txt).setBackground(bg); if(fc)b=b.setFontColor(fc); return b.setRanges([rng]).build();};
  rules.push(eq(remR,'Not started',C_RED));
  rules.push(eq(remR,'Texted',C_BLUE));
  rules.push(eq(remR,'Called',C_BLUE));
  rules.push(eq(remR,'Left message',C_AMBER));
  rules.push(eq(remR,'No answer',C_AMBER));
  rules.push(eq(remR,'Confirmed coming',C_GREEN));
  rules.push(eq(remR,'Declined',C_GREY));
  rules.push(eq(attR,'Scheduled',C_NEUTRAL));
  rules.push(eq(attR,'Self check-in',C_GREEN_STRONG,'#ffffff'));
  rules.push(eq(attR,'Attended',C_GREEN));
  rules.push(eq(attR,'Walk-in',C_GREEN));
  rules.push(eq(attR,'No-show',C_RED));
  rules.push(eq(attR,'Canceled',C_GREY));
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenCellEmpty().setBackground(FILL_TINT).setRanges([fillR]).build());
  sh.setConditionalFormatRules(rules);
}

function writeStats(){
  const g=SpreadsheetApp.getActive().getSheetByName('Goals'); if(!g) return;
  const sh=SpreadsheetApp.getActive().getSheetByName(TAB); if(!sh) return;
  const last=sh.getLastRow();
  const count = last >= FIRST ? last - FIRST + 1 : 0;
  const colA=g.getRange(1,1,Math.max(g.getLastRow(),1),1).getValues().map(r=>String(r[0]).toLowerCase());
  let row=-1;
  for(let i=0;i<colA.length;i++){ if(colA[i].indexOf('live rsvp total')>=0){ row=i+1; break; } }
  if(row<0){ row=g.getLastRow()+1; g.getRange(row,1).setValue('Live RSVP total (everyone):').setFontWeight('bold'); }
  g.getRange(row,3).setValue(count).setFontColor(TANGERINE).setFontWeight('bold');
  refreshGoals();
}

// ============================================================================
// GOALS DASHBOARD — two pieces, rebuilt together so their order is safe:
//   1. writeLeaderboardExtra — extends the existing Lead/Goal/Registered/% table
//      with Attended + Flake-rate columns and a highlighted Unclaimed row.
//   2. writeTurnout — the STL-format summary block: Turnout (RSVPs / Show rate /
//      Walk-ins / Total attendance, all auto) + Commitments made that night
//      (Amplifier / Canvass / Regional team, hand-entered and preserved).
// ============================================================================
function refreshGoals(){
  const g=SpreadsheetApp.getActive().getSheetByName('Goals'); if(!g) return;
  const saved=readCommitments(g);       // preserve hand-entered commitment counts before the clear
  try{ writeLeaderboardExtra(); }catch(e){}
  try{ writeTurnout(saved); }catch(e){}
}

// Read the hand-entered commitment counts (col I, rows 10–12) so a refresh keeps
// them. Only trust them once the block exists (H10 == 'Amplifier'), otherwise
// col I here may still hold leftovers from the retired standalone table.
function readCommitments(g){
  try{
    if(String(g.getRange(10,8).getValue()||'').trim().toLowerCase()!=='amplifier') return {};
    const v=g.getRange(10,9,3,1).getValues();
    return { amplifier:v[0][0], canvass:v[1][0], regional_team:v[2][0] };
  }catch(e){ return {}; }
}

function writeLeaderboardExtra(){
  const ss=SpreadsheetApp.getActive();
  const g=ss.getSheetByName('Goals'); if(!g) return;
  const sh=ss.getSheetByName(TAB); if(!sh) return;

  // --- Tally attendance per "Claimed by" from the RSVPs tab. ---
  const last=sh.getLastRow();
  const key=s=>String(s||'').trim().toLowerCase();
  const stat={}; const unc={claimed:0,showed:0,noshow:0};
  const bump=n=>(stat[n]||(stat[n]={claimed:0,showed:0,noshow:0}));
  if(last>=FIRST){
    const claimed=sh.getRange(FIRST,CLAIM_COL,last-FIRST+1,1).getValues();
    const att=sh.getRange(FIRST,ATT_COL,last-FIRST+1,1).getValues();
    for(let i=0;i<claimed.length;i++){
      const whoRaw=String(claimed[i][0]||'').trim();
      const a=String(att[i][0]||'').trim();
      const b=whoRaw?bump(key(whoRaw)):unc;
      b.claimed++;
      if(SHOW.indexOf(a)>=0) b.showed++;
      else if(a==='No-show') b.noshow++;
    }
  }

  // --- Nuke the retired standalone show-rate table (was columns F–J) so it can
  //     never collide with the extended leaderboard or the turnout block. ---
  try{ g.getRange(3,6,Math.max(1,Math.min(50,g.getMaxRows()-2)),5).breakApart().clearContent().clearFormat(); }catch(e){}

  // --- Locate the leaderboard header + TOTAL rows (don't hardcode; the sheet is
  //     hand-maintained). ---
  const gLast=g.getLastRow();
  const colA=g.getRange(1,1,Math.max(gLast,1),1).getValues().map(r=>String(r[0]||'').trim());
  let hdr=-1, tot=-1;
  for(let i=0;i<colA.length;i++){ if(colA[i].toLowerCase()==='lead'){ hdr=i+1; break; } }
  if(hdr<0) return;
  for(let i=hdr;i<colA.length;i++){ if(colA[i].toLowerCase()==='total'){ tot=i+1; break; } }

  // --- Two new columns: E Attended, F Flake rate. Flake = didn't show / claimed
  //     (the event is over, so a claimed person with no check-in = a flake). ---
  g.getRange(hdr,5,1,2).setValues([['Attended','Flake rate']]).setFontWeight('bold').setBackground(BAND);
  const lastLead=(tot>0?tot:gLast+1)-1;
  let tShow=0, tClaim=0;
  for(let r=hdr+1;r<=lastLead;r++){
    const name=String(colA[r-1]||'').trim();
    if(!name || name.toLowerCase().indexOf('unclaimed')===0) continue;
    const b=stat[key(name)]||{claimed:0,showed:0,noshow:0};
    tShow+=b.showed; tClaim+=b.claimed;
    g.getRange(r,5).setValue(b.showed);
    g.getRange(r,6).setValue(b.claimed?(b.claimed-b.showed)/b.claimed:'');
  }
  if(lastLead>hdr) g.getRange(hdr+1,6,lastLead-hdr,1).setNumberFormat('0%');

  // TOTAL row: attended + overall flake across the leads (matches Registered-claimed).
  if(tot>0){
    g.getRange(tot,5).setValue(tShow);
    g.getRange(tot,6).setValue(tClaim?(tClaim-tShow)/tClaim:'').setNumberFormat('0%');
  }

  // --- Unclaimed line (walk-ins + anyone nobody claimed). Reuse an existing row,
  //     else the blank row right after TOTAL, else insert one — never destructive. ---
  let uRow=-1;
  for(let i=hdr;i<colA.length;i++){ if(colA[i].toLowerCase().indexOf('unclaimed')===0){ uRow=i+1; break; } }
  if(uRow<0 && tot>0){
    const after=tot+1;
    const aVal=String(g.getRange(after,1).getValue()||'').trim();
    if(aVal===''){ uRow=after; }
    else { g.insertRowBefore(tot); uRow=tot; }
  }
  if(uRow>0){
    g.getRange(uRow,1).setValue('Unclaimed (walk-ins)');
    g.getRange(uRow,3).setValue(unc.claimed);
    g.getRange(uRow,5).setValue(unc.showed);
    g.getRange(uRow,6).setValue(unc.claimed?(unc.claimed-unc.showed)/unc.claimed:'').setNumberFormat('0%');
    g.getRange(uRow,1,1,6).setBackground(ALERT).setFontWeight('bold');
  }
}

function writeTurnout(saved){
  const ss=SpreadsheetApp.getActive();
  const g=ss.getSheetByName('Goals'); if(!g) return;
  const sh=ss.getSheetByName(TAB); if(!sh) return;
  saved=saved||{};

  // Compute turnout from the Attendance column.
  const last=sh.getLastRow();
  let rsvps=0, walkins=0, totalAtt=0, rsvpShowed=0;
  if(last>=FIRST){
    const att=sh.getRange(FIRST,ATT_COL,last-FIRST+1,1).getValues();
    for(let i=0;i<att.length;i++){
      const a=String(att[i][0]||'').trim();
      const isWalk=(a==='Walk-in');
      if(isWalk) walkins++; else rsvps++;
      if(SHOW.indexOf(a)>=0) totalAtt++;
      if(!isWalk && (a==='Attended'||a==='Self check-in')) rsvpShowed++;
    }
  }

  const C=8, V=9;   // labels col H, values col I
  // Turnout header.
  g.getRange(3,C,1,2).breakApart();
  g.getRange(3,C).setValue('Turnout — KC 7/9');
  g.getRange(3,C,1,2).merge().setFontWeight('bold').setFontColor(YELLOW).setBackground(PLUM).setHorizontalAlignment('center');
  g.getRange(4,C,4,1).setValues([['RSVPs'],['Show rate'],['Walk-ins'],['Total attendance']]).setFontWeight('bold');
  g.getRange(4,V).setValue(rsvps);
  g.getRange(5,V).setValue(rsvps?rsvpShowed/rsvps:'').setNumberFormat('0%');
  g.getRange(6,V).setValue(walkins);
  g.getRange(7,V).setValue(totalAtt);

  // Commitments header + hand-entered counts (preserved across refresh).
  g.getRange(9,C,1,2).breakApart();
  g.getRange(9,C).setValue('Commitments made that night');
  g.getRange(9,C,1,2).merge().setFontWeight('bold').setFontColor(YELLOW).setBackground(PLUM).setHorizontalAlignment('center');
  g.getRange(10,C,3,1).setValues([['Amplifier'],['Canvass'],['Regional team']]).setFontWeight('bold');
  const cv=[[saved.amplifier==null?'':saved.amplifier],[saved.canvass==null?'':saved.canvass],[saved.regional_team==null?'':saved.regional_team]];
  g.getRange(10,V,3,1).setValues(cv).setBackground(ALERT).setHorizontalAlignment('center').setFontWeight('bold');
  g.getRange(13,C,1,2).breakApart();
  g.getRange(13,C).setValue('↑ enter counts hand-tallied at the event').setFontColor('#8A8F98').setFontStyle('italic').setFontSize(9);

  g.setColumnWidth(C,150); g.setColumnWidth(V,90);
}

function ensureTemplate(){
  const ss=SpreadsheetApp.getActive();
  if(ss.getSheetByName('Template (copy me)')) return;
  const s=ss.insertSheet('Template (copy me)');
  s.getRange(1,1,1,5).setValues([['Name','Phone','Email','Status','Notes']]);
  s.getRange(2,1).setValue('⬅ Duplicate this tab (right-click → Duplicate), rename it to your name, then paste in the people you claimed. Private to you.')
    .setFontColor('#8A8F98').setFontStyle('italic');
  const dv=SpreadsheetApp.newDataValidation().requireValueInList(STATUS.split(','),true).setAllowInvalid(true).build();
  s.getRange(3,4,300,1).setDataValidation(dv);
  [260,130,240,150,320].forEach(function(w,i){ s.setColumnWidth(i+1,w); });
  s.setFrozenRows(1);
}

function installHelp(){
  const ss=SpreadsheetApp.getActive();
  let h=ss.getSheetByName('📖 How to use');
  if(!h) h=ss.insertSheet('📖 How to use',0);
  h.clear();
  try{ h.setHiddenGridlines(true); }catch(e){}
  h.setColumnWidth(1,860);
  const rows=[
    ['📖 How to use this tracker','title'],
    ['','gap'],
    ['This tracker is push-driven — new RSVPs appear within seconds. No refresh button needed.','p'],
    ['','gap'],
    ['⭐ The two links you need','h'],
    ['Walk-in / door sign-in — share with registrants AND walk-ins:','plabel'],
    [CHECKIN_URL,'linkhl'],
    ['RSVP recruiting link — text this to turn people out before the event:','plabel'],
    [RSVP_URL,'linkhl'],
    ['','gap'],
    ['Claim someone who registered','h'],
    ['Find the person and pick your name in the plum "Claimed by" column (I). It adds to your number on the Goals tab right away.','p'],
    ['Do NOT type into the RED columns (A–H). They are the live database list and anything typed there is erased on the next refresh. Your columns are the plum ones (I–L) plus Notes (M) — those survive every refresh.','note'],
  ];
  h.getRange(1,1,rows.length,1).setValues(rows.map(function(r){ return [r[0]]; }));
  rows.forEach(function(it,i){
    const c=h.getRange(i+1,1).setWrap(true).setVerticalAlignment('middle').setFontFamily(FONT);
    if(it[1]==='title'){ c.setFontSize(15).setFontWeight('bold').setFontColor(YELLOW).setBackground(PLUM); h.setRowHeight(i+1,40); }
    else if(it[1]==='h'){ c.setFontSize(11).setFontWeight('bold').setFontColor(PLUM).setBackground('#EDEDEA'); h.setRowHeight(i+1,24); }
    else if(it[1]==='plabel'){ c.setFontSize(10).setFontWeight('bold').setFontColor(INK).setBackground('#EDEDEA'); h.setRowHeight(i+1,20); }
    else if(it[1]==='note'){ c.setFontSize(10).setFontColor('#9A3412').setFontStyle('italic').setBackground('#EDEDEA'); h.setRowHeight(i+1,44); }
    else if(it[1]==='linkhl'){
      const rt=SpreadsheetApp.newRichTextValue().setText(it[0]).setLinkUrl(it[0])
        .setTextStyle(SpreadsheetApp.newTextStyle().setBold(true).setFontSize(11).build()).build();
      c.setRichTextValue(rt).setBackground('#FFF4CC'); h.setRowHeight(i+1,30);
    }
    else if(it[1]==='gap'){ c.setBackground(YELLOW); h.setRowHeight(i+1,8); }
    else { c.setFontSize(10).setFontColor(INK).setBackground('#EDEDEA'); h.setRowHeight(i+1,34); }
  });
  try { refreshGoals(); } catch(e) {}   // "+ Goals" — recompute the leaderboard + turnout blocks
  h.activate();
  SpreadsheetApp.flush();
}
