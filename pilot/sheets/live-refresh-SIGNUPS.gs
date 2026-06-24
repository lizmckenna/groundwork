/**
 * Groundwork — LIVE SIGNUPS (every training/onboarding, by source).
 * Paste into Extensions → Apps Script, Save, run setUp() once (authorize when asked).
 *
 * One row per person per event they signed up for, with the channel in Source
 * (a website source, or "LaNeé call" / "Stephanie call" / "Kathryn call" /
 * "Ellen call"). The "By source" tab shows live counts. Refreshes every 5 min.
 * Read-only monitor — launches are separate (they have their own trackers).
 */
const KEY  = 'p4mps-rKItacZ0arZKMy12UZuRBYwJVP_LJ4iU';
const FEED = 'https://groundwork-pilot.elizabethmck.workers.dev/export/signups.csv';
const TAB  = 'Signups (live)';
const FONT='Archivo', PLUM='#3e4f6e', GOLD='#d5b069', PAPER='#E9E5CE', INK='#1A2418', BAND='#EDEFF4';
const HEADERS = ['First','Last','Email','Phone','Zip','Event','Source','Date'];

function onOpen(){
  SpreadsheetApp.getUi().createMenu('🔄 Groundwork')
    .addItem('Refresh now','refresh')
    .addItem('Rebuild summary','buildSummary')
    .addToUi();
}

function setUp(){
  const ss=SpreadsheetApp.getActive();
  let sh=ss.getSheetByName(TAB); if(!sh) sh=ss.insertSheet(TAB);
  sh.getRange(1,1,1,HEADERS.length).setValues([HEADERS])
    .setFontFamily(FONT).setFontWeight('bold').setBackground(PLUM).setFontColor(PAPER);
  sh.setFrozenRows(1);
  const W=[110,110,220,120,70,210,200,100]; W.forEach((w,i)=>sh.setColumnWidth(i+1,w));
  ScriptApp.getProjectTriggers().forEach(t=>{ if(t.getHandlerFunction()==='refresh') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('refresh').timeBased().everyMinutes(5).create();
  refresh();
  buildSummary();
  ss.toast('Live signups connected. Refreshes every 5 min. See the "By source" tab for the breakdown.','Groundwork',6);
}

function refresh(){
  const sh=SpreadsheetApp.getActive().getSheetByName(TAB); if(!sh) return;
  const resp=UrlFetchApp.fetch(FEED+'?key='+encodeURIComponent(KEY)+'&t='+Date.now(),{muteHttpExceptions:true});
  if(resp.getResponseCode()!==200) return;                                  // abort-safe
  const rows=Utilities.parseCsv(resp.getContentText());
  if(rows.length<1 || String(rows[0][0]||'').toLowerCase()!=='first') return;
  const last=sh.getLastRow();
  if(last>=2) sh.getRange(2,1,last-1,HEADERS.length).clearContent();
  sh.getRange(1,1,1,HEADERS.length).setValues([rows[0].slice(0,HEADERS.length)]);
  const body=rows.slice(1);
  if(!body.length) return;
  sh.getRange(2,1,body.length,HEADERS.length).setValues(body.map(r=>r.slice(0,HEADERS.length)));
  sh.getRange(1,1,body.length+1,HEADERS.length).setFontFamily(FONT);
  const rng=sh.getRange(2,1,body.length,HEADERS.length);
  rng.getBandings().forEach(b=>b.remove());
  try{ const bd=rng.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY,false,false); bd.setHeaderRowColor(null).setFirstRowColor('#FFFFFF').setSecondRowColor(BAND); }catch(e){}
  try{ const ex=sh.getFilter(); if(ex) ex.remove(); sh.getRange(1,1,body.length+1,HEADERS.length).createFilter(); }catch(e){}
}

function buildSummary(){
  const ss=SpreadsheetApp.getActive();
  let s=ss.getSheetByName('📊 By source'); if(!s) s=ss.insertSheet('📊 By source',0);
  s.clear(); try{ s.setHiddenGridlines(true); }catch(e){}
  s.getRange(1,1,1,6).merge().setValue('📊 Live signups by source')
    .setFontSize(15).setFontWeight('bold').setFontColor(GOLD).setBackground(PLUM); s.setRowHeight(1,38);
  s.getRange(3,1,1,2).merge().setValue('BY SOURCE / CHANNEL').setFontWeight('bold').setBackground(GOLD).setFontColor(INK);
  s.getRange(4,1).setFormula(`=QUERY('${TAB}'!A2:H, "select G, count(A) where A is not null group by G order by count(A) desc label G 'Source', count(A) 'Signups'",0)`);
  s.getRange(3,4,1,2).merge().setValue('BY EVENT').setFontWeight('bold').setBackground(GOLD).setFontColor(INK);
  s.getRange(4,4).setFormula(`=QUERY('${TAB}'!A2:H, "select F, count(A) where A is not null group by F order by count(A) desc label F 'Event', count(A) 'Signups'",0)`);
  s.getRange(1,1,80,6).setFontFamily(FONT);
  s.getRange(4,1,1,2).setFontWeight('bold').setBackground(PLUM).setFontColor(PAPER);
  s.getRange(4,4,1,2).setFontWeight('bold').setBackground(PLUM).setFontColor(PAPER);
  s.setColumnWidth(1,210); s.setColumnWidth(2,90); s.setColumnWidth(3,30); s.setColumnWidth(4,230); s.setColumnWidth(5,90);
  s.activate();
}
