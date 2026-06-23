/**
 * Groundwork — AMPLIFIER COMMITMENTS follow-up tracker.
 * Paste into Extensions → Apps Script, Save, run setUp() once (authorize when asked).
 *
 * Every voter who said yes to something during an amplifier conversation, live from
 * Airtable, grouped by amplifier. Follow-up leads claim a person, set a status, mark
 * when a 1-1 is booked (that one saves back to the database and drops them off the
 * central lists), and keep notes. Refreshes every minute.
 */
const KEY  = 'p4mps-rKItacZ0arZKMy12UZuRBYwJVP_LJ4iU';
const FEED = 'https://groundwork-pilot.elizabethmck.workers.dev/export/amplifier-commits.csv';
const PUSH = 'https://groundwork-pilot.elizabethmck.workers.dev/sheet-hm-followup';
const STATUS = 'Not started,In progress,Reached,1-1 booked,No response,Done';
const YESNO  = 'Yes';

const TAB = 'Amplifier commitments (live)';
const DATA_COLS = 11;                            // A–K from the feed (First … Contact ID)
const MANUAL = ['Claimed by','Follow-up status','1-1 booked','Notes'];  // L, M, N, O
const M_START = DATA_COLS + 1;                   // L = 12
const TOTAL_COLS = DATA_COLS + MANUAL.length;    // 15
const ID_COL = 11;                               // K = Contact ID, the join key (hidden)
const ONE_ON_ONE_COL = M_START + 2;              // N = 1-1 booked
const HDR = 2, FIRST = 3;
const BANNER = '⚠️ LIVE LIST FROM AIRTABLE. DO NOT ADD, EDIT, OR DELETE ROWS in columns A–K. '
             + 'Anything typed there is erased on the next refresh. Only the yellow columns are yours: '
             + 'Claimed by, Follow-up status, 1-1 booked, and Notes. Setting "1-1 booked = Yes" saves back to the database.';

function onOpen(){
  SpreadsheetApp.getUi().createMenu('🔄 Groundwork')
    .addItem('Refresh now','refreshHM')
    .addItem('Rebuild How-to','rebuildHowTo')
    .addToUi();
}

function setUp(){
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(TAB);
  if (!sh) sh = ss.insertSheet(TAB);
  sh.getRange(1, 1, 1, TOTAL_COLS).breakApart();
  sh.getRange(1, 3, 1, TOTAL_COLS - 2).merge()
    .setValue(BANNER).setFontWeight('bold').setFontColor('#1F5C3D').setBackground('#E6F0E8')
    .setWrap(true).setVerticalAlignment('middle').setHorizontalAlignment('left');
  sh.setRowHeight(1, 54);
  sh.getRange(HDR, M_START, 1, MANUAL.length).setValues([MANUAL]).setFontWeight('bold').setBackground('#FFF4CC');
  const dv = v => SpreadsheetApp.newDataValidation().requireValueInList(v.split(','), true).setAllowInvalid(true).build();
  sh.getRange(FIRST, M_START + 1, 600, 1).setDataValidation(dv(STATUS));
  sh.getRange(FIRST, ONE_ON_ONE_COL, 600, 1).setDataValidation(dv(YESNO));
  sh.setFrozenRows(2);
  sh.setFrozenColumns(2);
  sh.hideColumns(ID_COL);
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(p => { if (p.getDescription()==='GW live') p.remove(); });
  sh.getRange(1, 1, sh.getMaxRows(), DATA_COLS).protect().setDescription('GW live').setWarningOnly(true);
  const statusCol = M_START + 1;
  const stRange = sh.getRange(FIRST, statusCol, sh.getMaxRows()-FIRST+1, 1);
  const ooRange = sh.getRange(FIRST, ONE_ON_ONE_COL, sh.getMaxRows()-FIRST+1, 1);
  let rules = sh.getConditionalFormatRules().filter(r => !r.getRanges().some(rg => rg.getColumn()===statusCol || rg.getColumn()===ONE_ON_ONE_COL));
  const cf = (rng,txt,bg,fc)=>{ let b=SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(txt).setBackground(bg); if(fc)b=b.setFontColor(fc); return b.setRanges([rng]).build(); };
  rules.push(cf(stRange,'Done','#188038','#ffffff'));
  rules.push(cf(stRange,'1-1 booked','#CEEAD6'));
  rules.push(cf(stRange,'Reached','#CEEAD6'));
  rules.push(cf(stRange,'In progress','#FFF4CC'));
  rules.push(cf(stRange,'No response','#F4C7C3'));
  rules.push(cf(ooRange,'Yes','#188038','#ffffff'));
  sh.setConditionalFormatRules(rules);
  ScriptApp.getProjectTriggers().forEach(t => { const f=t.getHandlerFunction(); if (f==='refreshHM'||f==='onHMEdit') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('refreshHM').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('onHMEdit').forSpreadsheet(ss).onEdit().create();
  refreshHM();
  rebuildHowTo();
  ss.toast('All set. Amplifier commitments pull in live (refreshes every minute). Use the yellow columns to follow up.', 'Groundwork', 6);
}

function refreshHM(){
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB); if (!sh) return;
  const last = sh.getLastRow(), N = MANUAL.length, byId = {};
  if (last >= FIRST){
    const ids = sh.getRange(FIRST, ID_COL, last-FIRST+1, 1).getValues();
    const man = sh.getRange(FIRST, M_START, last-FIRST+1, N).getValues();
    for (let i=0;i<ids.length;i++){ const id=String(ids[i][0]||'').trim(); if (id && man[i].some(v=>v!=='')) byId[id]=man[i]; }
  }
  const url = FEED + '?key='+encodeURIComponent(KEY)+'&t='+Date.now();
  const resp = UrlFetchApp.fetch(url,{muteHttpExceptions:true});
  if (resp.getResponseCode() !== 200) return;                 // worker error -> leave the sheet untouched
  const rows = Utilities.parseCsv(resp.getContentText());
  if (rows.length < 2) return;                                // empty / header-only -> never wipe manual data
  const _hdr = rows[0].map(h => String(h).toLowerCase());
  if (_hdr.indexOf('first name') === -1) return;              // not our CSV -> never wipe
  if (last >= FIRST) sh.getRange(FIRST,1,last-FIRST+1,TOTAL_COLS).clearContent();
  sh.getRange(HDR,1,1,DATA_COLS).setValues([rows[0].slice(0,DATA_COLS)])
    .setFontWeight('bold').setBackground('#1F5C3D').setFontColor('#ffffff');
  const body = rows.slice(1); if (!body.length) return;
  sh.getRange(FIRST,1,body.length,DATA_COLS).setValues(body.map(r=>r.slice(0,DATA_COLS)));
  const reM = body.map(r=>{
    const id=String(r[ID_COL-1]||'').trim();
    const pm=byId[id]; const m = pm ? pm.slice() : new Array(N).fill('');
    const feedOO = String(r[11]||'').trim();
    if (!String(m[2]||'').trim() && feedOO) m[2]='Yes';
    return m;
  });
  sh.getRange(FIRST,M_START,reM.length,N).setValues(reM);
}

function onHMEdit(e){
  if (!e || !e.range) return;
  const sh = e.range.getSheet(); if (sh.getName()!==TAB) return;
  if (e.range.getColumn()>ONE_ON_ONE_COL || e.range.getLastColumn()<ONE_ON_ONE_COL) return;
  const r0=Math.max(e.range.getRow(),FIRST), r1=e.range.getLastRow();
  const rows=[];
  for (let r=r0;r<=r1;r++){
    const id=String(sh.getRange(r,ID_COL).getValue()||'').trim();
    if (!id) continue;
    rows.push({ contact_id:id, one_on_one: /^y/i.test(String(sh.getRange(r,ONE_ON_ONE_COL).getValue()||'').trim()) });
  }
  if (!rows.length) return;
  UrlFetchApp.fetch(PUSH+'?t='+Date.now(), { method:'post', contentType:'application/json',
    payload: JSON.stringify({ key:KEY, rows:rows }), muteHttpExceptions:true });
}

function rebuildHowTo(){
  const ss = SpreadsheetApp.getActive();
  let h = ss.getSheetByName('📖 How to use');
  if (!h) h = ss.insertSheet('📖 How to use', 0);
  h.clear();
  try { h.setHiddenGridlines(true); } catch(e){}
  h.setColumnWidth(1, 860);
  const rows = [
    ['📖 Amplifier commitments — how to use','title'],
    ['','gap'],
    ['What this is','h'],
    ['Every voter who said yes to something during an amplifier conversation (wants to amplify, host a house meeting, get postcards, share with their network, and so on), pulled live from the database and grouped by amplifier. It refreshes by itself every minute.','p'],
    ['Never type a person into the Amplifier commitments (live) tab. Columns A–K are the live list; anything typed there is erased on the next refresh.','note'],
    ['','gap'],
    ['Claim someone to follow up with','h'],
    ['Find the person and put your name in the yellow "Claimed by" column. Use "Follow-up status" to track where you are (Reached, No response, Done, and so on).','p'],
    ['','gap'],
    ['When a 1-1 is booked','h'],
    ['Set "1-1 booked" to Yes. That saves straight back to the database and takes the person off the central follow-up call lists, so nobody double-works them. The row turns green.','p'],
    ['','gap'],
    ['Notes','h'],
    ['Use the "Notes" column for anything useful. Notes stay attached to each person through every refresh.','p'],
    ['','gap'],
    ['Who follows up','h'],
    ['Sort or filter by the Amplifier column to see the people a given amplifier talked to.','p'],
  ];
  h.getRange(1,1,rows.length,1).setValues(rows.map(function(r){ return [r[0]]; }));
  rows.forEach(function(it,i){
    const c = h.getRange(i+1,1).setWrap(true).setVerticalAlignment('middle');
    if (it[1]==='title'){ c.setFontSize(18).setFontWeight('bold').setFontColor('#ffffff').setBackground('#1F5C3D'); h.setRowHeight(i+1,48); }
    else if (it[1]==='h'){ c.setFontSize(13).setFontWeight('bold').setFontColor('#1F5C3D'); h.setRowHeight(i+1,28); }
    else if (it[1]==='note'){ c.setFontSize(11).setFontColor('#9A3412').setFontStyle('italic'); h.setRowHeight(i+1,42); }
    else if (it[1]==='gap'){ h.setRowHeight(i+1,8); }
    else { c.setFontSize(11).setFontColor('#1A2418'); h.setRowHeight(i+1,38); }
  });
  h.activate();
  SpreadsheetApp.flush();
}
