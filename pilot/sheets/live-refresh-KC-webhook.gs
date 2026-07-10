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
// Form-fed columns A–I. A–H (CORE_COLS) are the roster the webhook rewrites on
// every push; column I (NEEDS_COL) is "Interpretation / needs" — the accessibility
// / interpretation answer folded in from the RSVP form ("Interpretation: Spanish").
const DATA_COLS=9, CORE_COLS=8, NEEDS_COL=9;
const MANUAL=['Claimed by','Reminder: assigned to','Reminder: status','Attendance'];
const M_START=DATA_COLS+1, TOTAL_COLS=DATA_COLS+MANUAL.length, EMAIL_COL=3, HDR=1, FIRST=2;

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
  // Columns A–H: form-fed roster, always rewritten. Column I (Interpretation /
  // needs) is written separately below so the hourly safety poll — which carries
  // no accessibility field — never blanks an answer the webhook already filled.
  const core = [
    p.first||'', p.last||'', p.email||'', p.phone||'',
    p.role||'', p.school||'', p.district||'',
    ''  // Who Recruited (kept blank; column exists for parity with CSV export)
  ];
  let targetRow;
  if (existingRow > 0) {
    targetRow = existingRow;
    sh.getRange(existingRow, 1, 1, CORE_COLS).setValues([core]);
    // Attendance from Airtable (walk-in pull). Only fill blank / 'Scheduled' so a
    // manual mark an organizer typed is never clobbered.
    if (p.attendance) {
      const attCell = sh.getRange(existingRow, M_START+3);
      const cur = String(attCell.getValue()||'').trim();
      if (!cur || cur === 'Scheduled') attCell.setValue(p.attendance);
    }
  } else {
    targetRow = last < FIRST ? FIRST : last + 1;
    sh.getRange(targetRow, 1, 1, CORE_COLS).setValues([core]);
    // Seed default manual values so conditional formatting shows the "not started" red.
    // Walk-ins already showed up, so skip the reminder seed and stamp Attendance directly.
    sh.getRange(targetRow, M_START+2, 1, 1).setValue(p.attendance === 'Walk-in' ? '' : 'Not started');
    sh.getRange(targetRow, M_START+3, 1, 1).setValue(p.attendance || 'Scheduled');
    brandRows(sh, last-FIRST+2);
  }
  // Interpretation / needs (col I) — only overwrite when the payload actually
  // carries it. The webhook + backfill send `accessibility`; the safety poll does not.
  if (typeof p.accessibility === 'string' && p.accessibility.trim()) {
    sh.getRange(targetRow, NEEDS_COL, 1, 1).setValue(p.accessibility.trim());
  }
  try { writeStats(); } catch(e) {}
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
    .addItem('Pull walk-ins now','pullWalkIns')
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
// SAFETY-NET POLL (once/hour) — pulls the CSV and upserts any rows the webhook
// missed. Uses 1 UrlFetch per hour = 24/day, way under quota.
// ============================================================================
function safetyRefresh() {
  const url = WORKER + '/export/rsvps.csv?key=' + encodeURIComponent(KEY)
    + '&event=' + encodeURIComponent(EVENT) + '&t=' + Date.now();
  const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) return;
  const rows = Utilities.parseCsv(resp.getContentText());
  if (rows.length < 2) return;
  const hd = rows[0].map(h => String(h).toLowerCase());
  if (hd.indexOf('email') === -1) return;
  const body = rows.slice(1);
  for (const r of body) {
    _upsertRow({
      event: EVENT,
      first: r[0]||'', last: r[1]||'', email: r[2]||'', phone: r[3]||'',
      role: r[4]||'', school: r[5]||'', district: r[6]||'',
    });
  }
  try { pullWalkIns(); } catch(e) {}   // fold in door walk-ins (only live in Airtable, never in the RSVP export)
}

// ============================================================================
// WALK-INS — people who showed up WITHOUT an RSVP. They exist only in Airtable
// (method='Event attendance', no 'Event RSVP' row), so the RSVP export/webhook
// never sees them. This pulls them in as rows marked Attendance='Walk-in'.
// Piggybacks on the hourly safety poll (no extra trigger); also runnable from the
// menu. Never clobbers a manual Attendance mark (see _upsertRow).
// ============================================================================
function pullWalkIns() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB); if (!sh) return;
  const url = WORKER + '/export/attendance.csv?details=1&key=' + encodeURIComponent(KEY)
    + '&event=' + encodeURIComponent(EVENT) + '&t=' + Date.now();
  let resp;
  try { resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true }); }
  catch (e) { return; }                                   // urlfetch quota / network -> retry next cycle
  if (resp.getResponseCode() !== 200) return;
  const rows = Utilities.parseCsv(resp.getContentText());
  if (rows.length < 2) return;
  const hd = rows[0].map(h => String(h).toLowerCase());
  const wi = hd.indexOf('walk-in');
  if (hd.indexOf('email') === -1 || wi === -1) return;    // not our CSV -> bail, never wipe
  for (const r of rows.slice(1)) {
    if (String(r[wi]||'').trim().toLowerCase() !== 'yes') continue;   // walk-ins only; RSVP'd attendees already have rows
    _upsertRow({
      event: EVENT,
      first: r[0]||'', last: r[1]||'', email: r[2]||'', phone: r[3]||'',
      role: r[4]||'', school: r[5]||'', district: r[6]||'',
      attendance: 'Walk-in',
    });
  }
}

// ============================================================================
// SETUP
// ============================================================================
function ensureGoals(ss){
  if(ss.getSheetByName('Goals')) return;
  const g=ss.insertSheet('Goals');
  g.getRange(1,1).setValue('Goals & leaderboard').setFontWeight('bold');
  g.getRange(3,1,1,4).setValues([['Lead','Goal','Recruited','% to goal']]);
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
  // Migrate from the old banner layout: if row 1 is the warning banner,
  // delete it so headers land on row 1 and existing data shifts to row 2.
  try {
    const r1 = sh.getRange(1,1,1,Math.min(sh.getMaxColumns(),TOTAL_COLS)).getValues()[0].join(' ');
    if (r1.indexOf('⚠') >= 0 || r1.indexOf('LIVE LIST') >= 0) sh.deleteRow(1);
  } catch(e) {}
  // One-time migration to the 9-column roster. Older sheets have the manual
  // columns (Claimed by / Reminder / Attendance) starting at col 9. Insert a
  // blank column there so that existing manual DATA shifts right and stays
  // aligned under its headers; the freed col 9 becomes "Interpretation / needs".
  // Idempotent: skips once col 9 already holds the needs header (or is empty/new).
  try {
    const h9 = String(sh.getRange(HDR, NEEDS_COL).getValue() || '').trim().toLowerCase();
    if (h9 && h9.indexOf('interpretation') === -1 && h9.indexOf('needs') === -1) {
      sh.insertColumnBefore(NEEDS_COL);
    }
  } catch(e) {}
  // Headers on row 1 — no banner. Clear any old validations/merges leftover
  // from the previous (banner) layout so header cells never flag "Invalid".
  sh.getRange(1,1,2,TOTAL_COLS).breakApart().clearDataValidations();
  sh.getRange(HDR,M_START,1,MANUAL.length).setValues([MANUAL]);
  sh.getRange(HDR,1,1,DATA_COLS).setValues([['First Name','Last Name','Email','Phone','Role','School','District','Who Recruited','Interpretation / needs']]);
  sh.getRange(HDR,1,1,TOTAL_COLS).setWrap(true).setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.setColumnWidth(NEEDS_COL,220);   // interpretation/accessibility answers can be a sentence
  sh.setRowHeight(HDR,44);
  const dv=v=>SpreadsheetApp.newDataValidation().requireValueInList(v.split(','),true).setAllowInvalid(true).build();
  sh.getRange(FIRST,M_START,400,1).setDataValidation(dv(LEADS));
  sh.getRange(FIRST,M_START+1,400,1).setDataValidation(dv(LEADS));
  sh.getRange(FIRST,M_START+2,400,1).setDataValidation(dv(STATUS));
  sh.getRange(FIRST,M_START+3,400,1).setDataValidation(dv(ATTEND));
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
  const ATT_COL=M_START+3;
  if(e.range.getColumn()>ATT_COL || e.range.getLastColumn()<ATT_COL) return;
  const r0=Math.max(e.range.getRow(),FIRST), r1=e.range.getLastRow();
  const marks=[];
  for(let r=r0;r<=r1;r++){
    const email=String(sh.getRange(r,EMAIL_COL).getValue()||'').trim();
    const status=String(sh.getRange(r,ATT_COL).getValue()||'').trim();
    if(!email || status==='Scheduled') continue;
    marks.push({email:email, status:status});
  }
  if(!marks.length) return;
  UrlFetchApp.fetch(WORKER + '/sheet-attendance?key='+encodeURIComponent(KEY),
    {method:'post',contentType:'application/json',payload:JSON.stringify({event:EVENT,marks:marks}),muteHttpExceptions:true});
}

// ============================================================================
// BRANDING (unchanged from prior version)
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
  const claimCol=M_START, assignCol=M_START+1, remCol=M_START+2, attCol=M_START+3;
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
    ['Find the person and pick your name in the plum "Claimed by" column. It adds to your number on the Goals tab right away.','p'],
    ['Do NOT type into the RED columns (A–I). They are the live database list and anything typed there is erased on the next refresh. "Interpretation / needs" (col I) fills in automatically from the RSVP form — e.g. "Interpretation: Spanish".','note'],
  ];
  h.getRange(1,1,rows.length,1).setValues(rows.map(function(r){ return [r[0]]; }));
  rows.forEach(function(it,i){
    const c=h.getRange(i+1,1).setWrap(true).setVerticalAlignment('middle').setFontFamily(FONT);
    if(it[1]==='title'){ c.setFontSize(15).setFontWeight('bold').setFontColor(YELLOW).setBackground(PLUM); h.setRowHeight(i+1,40); }
    else if(it[1]==='h'){ c.setFontSize(11).setFontWeight('bold').setFontColor(PLUM).setBackground('#EDEDEA'); h.setRowHeight(i+1,24); }
    else if(it[1]==='plabel'){ c.setFontSize(10).setFontWeight('bold').setFontColor(INK).setBackground('#EDEDEA'); h.setRowHeight(i+1,20); }
    else if(it[1]==='note'){ c.setFontSize(10).setFontColor('#9A3412').setFontStyle('italic').setBackground('#EDEDEA'); h.setRowHeight(i+1,36); }
    else if(it[1]==='linkhl'){
      const rt=SpreadsheetApp.newRichTextValue().setText(it[0]).setLinkUrl(it[0])
        .setTextStyle(SpreadsheetApp.newTextStyle().setBold(true).setFontSize(11).build()).build();
      c.setRichTextValue(rt).setBackground('#FFF4CC'); h.setRowHeight(i+1,30);
    }
    else if(it[1]==='gap'){ c.setBackground(YELLOW); h.setRowHeight(i+1,8); }
    else { c.setFontSize(10).setFontColor(INK).setBackground('#EDEDEA'); h.setRowHeight(i+1,34); }
  });
  h.activate();
  SpreadsheetApp.flush();
}
