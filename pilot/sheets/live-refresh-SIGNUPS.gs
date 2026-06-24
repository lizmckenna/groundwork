/**
 * Groundwork — LIVE SIGNUPS (every training/onboarding, by source) + manual Status.
 * Paste into the tracker sheet: Extensions → Apps Script → paste over everything →
 * Save → run setUp() once (authorize when asked).
 *
 * Tab "Signups (live)": one row per person per event, pulled from the worker feed
 *   every 5 min. Column I "Status" is MANUAL (Scheduled / Confirmed / Declined /
 *   Left message / Attended / No-show) — callers set it, and it is PRESERVED across
 *   refreshes by matching email + event, so the auto-refresh never wipes it.
 * Tab "📊 By source": live counts by source, by event, and by status.
 */
const KEY  = 'p4mps-rKItacZ0arZKMy12UZuRBYwJVP_LJ4iU';
const FEED = 'https://groundwork-pilot.elizabethmck.workers.dev/export/signups.csv';
const TAB  = 'Signups (live)';
const FONT='Archivo', PLUM='#3e4f6e', GOLD='#d5b069', PAPER='#E9E5CE', INK='#1A2418', BAND='#EDEFF4';
const HEADERS = ['First','Last','Email','Phone','Zip','Event','Source','Date'];   // feed columns (A–H)
const STATUS_COL = HEADERS.length + 1;                                            // I = manual Status
const STATUSES = ['Scheduled','Confirmed','Declined','Left message','Attended','No-show'];

function onOpen(){
  SpreadsheetApp.getUi().createMenu('🔄 Groundwork')
    .addItem('Refresh now','refresh')
    .addItem('Rebuild summary','buildSummary')
    .addItem('Re-apply Status colors','reapplyColors')
    .addToUi();
}

function setUp(){
  const ss=SpreadsheetApp.getActive();
  let sh=ss.getSheetByName(TAB); if(!sh) sh=ss.insertSheet(TAB);
  sh.setFrozenRows(1);
  const W=[110,110,220,120,70,210,200,100,130]; W.forEach((w,i)=>sh.setColumnWidth(i+1,w));
  ScriptApp.getProjectTriggers().forEach(t=>{ if(t.getHandlerFunction()==='refresh') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('refresh').timeBased().everyMinutes(5).create();
  refresh();
  buildSummary();
  ss.toast('Live signups connected. Status column added (manual, preserved on refresh). See "📊 By source".','Groundwork',7);
}

function refresh(){
  const sh=SpreadsheetApp.getActive().getSheetByName(TAB); if(!sh) return;
  const resp=UrlFetchApp.fetch(FEED+'?key='+encodeURIComponent(KEY)+'&t='+Date.now(),{muteHttpExceptions:true});
  if(resp.getResponseCode()!==200) return;                                  // abort-safe: never wipe on a bad fetch
  const rows=Utilities.parseCsv(resp.getContentText());
  if(rows.length<1 || String(rows[0][0]||'').toLowerCase()!=='first') return;
  const body=rows.slice(1);

  // 1) snapshot existing manual Status, keyed by email|event (survives row re-ordering)
  const prev={};
  const last=sh.getLastRow();
  if(last>=2){
    const cur=sh.getRange(2,1,last-1,STATUS_COL).getValues();
    cur.forEach(r=>{ const k=key(r[2],r[5]); const st=String(r[STATUS_COL-1]||'').trim(); if(st) prev[k]=st; });
    sh.getRange(2,1,last-1,STATUS_COL).clearContent();
  }

  // 2) headers
  sh.getRange(1,1,1,HEADERS.length).setValues([rows[0].slice(0,HEADERS.length)])
    .setFontFamily(FONT).setFontWeight('bold').setBackground(PLUM).setFontColor(PAPER);
  sh.getRange(1,STATUS_COL).setValue('Status').setFontFamily(FONT).setFontWeight('bold').setBackground(GOLD).setFontColor(INK);
  if(!body.length) return;

  // 3) data (cols A–H)
  sh.getRange(2,1,body.length,HEADERS.length).setValues(body.map(r=>r.slice(0,HEADERS.length)));

  // 4) re-apply Status (default 'Scheduled' for new rows), matched by email|event
  const statusVals=body.map(r=>[ prev[key(r[2],r[5])] || 'Scheduled' ]);
  sh.getRange(2,STATUS_COL,body.length,1).setValues(statusVals);
  const rule=SpreadsheetApp.newDataValidation().requireValueInList(STATUSES,true).setAllowInvalid(false).build();
  sh.getRange(2,STATUS_COL,body.length,1).setDataValidation(rule);

  // 5) formatting
  sh.getRange(1,1,body.length+1,STATUS_COL).setFontFamily(FONT);
  const rng=sh.getRange(2,1,body.length,STATUS_COL);
  rng.getBandings().forEach(b=>b.remove());
  try{ const bd=rng.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY,false,false); bd.setHeaderRowColor(null).setFirstRowColor('#FFFFFF').setSecondRowColor(BAND); }catch(e){}
  try{ const ex=sh.getFilter(); if(ex) ex.remove(); sh.getRange(1,1,body.length+1,STATUS_COL).createFilter(); }catch(e){}
  applyStatusColors(sh);
}

function key(email,event){ return String(email||'').toLowerCase().trim()+'||'+String(event||'').trim(); }

// Color-code the Status column by value (persists; applies by value, not row position).
function applyStatusColors(sh){
  const rng=sh.getRange(2,STATUS_COL,Math.max(sh.getMaxRows()-1,1),1);
  const mk=(txt,bg,fg)=>SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(txt).setBackground(bg).setFontColor(fg).setRanges([rng]).build();
  const keep=sh.getConditionalFormatRules().filter(r=>{ try{ const rs=r.getRanges(); return !(rs.length===1 && rs[0].getColumn()===STATUS_COL); }catch(e){ return true; } });
  keep.push(mk('Confirmed','#D6EFD8','#14622F'));
  keep.push(mk('Attended','#BFE1F6','#0B3954'));
  keep.push(mk('Declined','#F4CCCC','#990000'));
  keep.push(mk('No-show','#E4E4E4','#555555'));
  keep.push(mk('Left message','#FBEFC8','#856200'));
  sh.setConditionalFormatRules(keep);
}
function reapplyColors(){ const sh=SpreadsheetApp.getActive().getSheetByName(TAB); if(sh) applyStatusColors(sh); }

function buildSummary(){
  const ss=SpreadsheetApp.getActive();
  let s=ss.getSheetByName('📊 By source'); if(!s) s=ss.insertSheet('📊 By source',0);
  s.clear(); try{ s.setHiddenGridlines(true); }catch(e){}
  s.getRange(1,1,1,8).merge().setValue('📊 Live signups')
    .setFontSize(15).setFontWeight('bold').setFontColor(GOLD).setBackground(PLUM); s.setRowHeight(1,38);
  s.getRange(3,1,1,2).merge().setValue('BY SOURCE / CHANNEL').setFontWeight('bold').setBackground(GOLD).setFontColor(INK);
  s.getRange(4,1).setFormula(`=QUERY('${TAB}'!A2:I, "select G, count(A) where A is not null group by G order by count(A) desc label G 'Source', count(A) 'Signups'",0)`);
  s.getRange(3,4,1,2).merge().setValue('BY EVENT').setFontWeight('bold').setBackground(GOLD).setFontColor(INK);
  s.getRange(4,4).setFormula(`=QUERY('${TAB}'!A2:I, "select F, count(A) where A is not null group by F order by count(A) desc label F 'Event', count(A) 'Signups'",0)`);
  s.getRange(3,7,1,2).merge().setValue('BY STATUS').setFontWeight('bold').setBackground(GOLD).setFontColor(INK);
  s.getRange(4,7).setFormula(`=QUERY('${TAB}'!A2:I, "select I, count(A) where A is not null group by I order by count(A) desc label I 'Status', count(A) 'Count'",0)`);
  s.getRange(1,1,80,8).setFontFamily(FONT);
  [[1,210],[2,90],[3,30],[4,230],[5,90],[6,30],[7,150],[8,90]].forEach(([c,w])=>s.setColumnWidth(c,w));
  s.activate();
}
