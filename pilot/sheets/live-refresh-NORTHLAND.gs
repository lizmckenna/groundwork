const KEY    = 'p4mps-rKItacZ0arZKMy12UZuRBYwJVP_LJ4iU';
const EVENT  = 'Northland Emergency Meeting 6/18';
const LEADS  = 'Holly,Sierra,Latrice,Nina,Brianna,Ellen,Facebook,Other';
const STATUS = 'Not started,Texted,Called,Left message,Confirmed coming,No answer,Declined';
const TAB = 'RSVPs (live)';
const DATA_COLS = 8;
const MANUAL = ['Claimed by','Reminder: assigned to','Reminder: status'];
const M_START = DATA_COLS + 1, EMAIL_COL = 3;
function onOpen(){ SpreadsheetApp.getUi().createMenu('🔄 Groundwork').addItem('Refresh RSVPs now','refreshRSVPs').addToUi(); }
function setUp(){
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB);
  sh.getRange(1,M_START,1,MANUAL.length).setValues([MANUAL]).setFontWeight('bold').setBackground('#FFF4CC');
  const dv=v=>SpreadsheetApp.newDataValidation().requireValueInList(v.split(','),true).setAllowInvalid(true).build();
  sh.getRange(2,M_START,400,1).setDataValidation(dv(LEADS));
  sh.getRange(2,M_START+1,400,1).setDataValidation(dv(LEADS));
  sh.getRange(2,M_START+2,400,1).setDataValidation(dv(STATUS));
  ScriptApp.getProjectTriggers().forEach(t=>{if(t.getHandlerFunction()==='refreshRSVPs')ScriptApp.deleteTrigger(t);});
  ScriptApp.newTrigger('refreshRSVPs').timeBased().everyMinutes(5).create();   // 5-min, not 1-min: every-minute across trackers blows the daily urlfetch quota
  refreshRSVPs();
  SpreadsheetApp.getUi().alert('Set: live refresh (every 5 minutes) + Claimed by / Reminder columns that survive refreshes.');
}
function refreshRSVPs(){
  const sh=SpreadsheetApp.getActive().getSheetByName(TAB); if(!sh)return;
  const last=sh.getLastRow(),N=MANUAL.length,byEmail={},byNP={};
  const npKey=(f,l,p)=>String(f||'').trim().toLowerCase()+'|'+String(l||'').trim().toLowerCase()+'|'+String(p||'').replace(/\D/g,'').slice(-10);
  // 1. Save the manual columns FIRST, keyed by email and by name+phone (fallback).
  if(last>=2){
    const d=sh.getRange(2,1,last-1,DATA_COLS).getValues(), m=sh.getRange(2,M_START,last-1,N).getValues();
    for(let i=0;i<d.length;i++){
      if(!m[i].some(v=>v!=='')) continue;
      const k=String(d[i][EMAIL_COL-1]||'').trim().toLowerCase(); if(k) byEmail[k]=m[i];
      byNP[npKey(d[i][0],d[i][1],d[i][3])]=m[i];
    }
  }
  // 2. Fetch — and BAIL OUT without touching the sheet if anything is wrong.
  const url='https://groundwork-pilot.elizabethmck.workers.dev/export/rsvps.csv?key='+encodeURIComponent(KEY)+'&event='+encodeURIComponent(EVENT)+'&t='+Date.now();
  const resp=UrlFetchApp.fetch(url,{muteHttpExceptions:true});
  if(resp.getResponseCode()!==200) return;                                  // worker error -> leave data alone
  const rows=Utilities.parseCsv(resp.getContentText());
  if(rows.length<2) return;                                                 // empty / header-only -> never wipe
  const hdr=rows[0].map(h=>String(h).toLowerCase());
  if(hdr.indexOf('email')===-1 && hdr.indexOf('first name')===-1) return;   // not our CSV -> never wipe
  const body=rows.slice(1); if(!body.length) return;
  // 3. Now it is safe to rewrite (clear width stays DATA_COLS+N so the Attendance column is untouched).
  if(last>=2) sh.getRange(2,1,last-1,DATA_COLS+N).clearContent();
  sh.getRange(1,1,1,DATA_COLS).setValues([rows[0].slice(0,DATA_COLS)]);
  sh.getRange(2,1,body.length,DATA_COLS).setValues(body.map(r=>r.slice(0,DATA_COLS)));
  sh.getRange(2,M_START,body.length,N).setValues(body.map(r=>{
    const em=String(r[2]||'').trim().toLowerCase();
    return byEmail[em]||byNP[npKey(r[0],r[1],r[3])]||new Array(N).fill('');
  }));
}
// SAFE ADD-ON — only touches the Goals tab. Never reads or writes the RSVPs (live)
// list, so claims + reminders are completely untouched.
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

function installStats(){
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction()==='writeStats') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('writeStats').timeBased().everyMinutes(5).create();    // 5-min, not 1-min: every-minute across trackers blows the daily urlfetch quota
  writeStats();
  SpreadsheetApp.getUi().alert('Pizza + childcare counts added to the Goals tab, refreshing every 5 minutes. Your RSVP list and all claims were not touched.');
}

function addAttendance(){
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB);
  const ATT_COL = M_START + 3;   // L — after Claimed by / Reminder assigned / Reminder status
  sh.getRange(1, ATT_COL).setValue('Attendance').setFontWeight('bold').setBackground('#FFF4CC');
  const dv = SpreadsheetApp.newDataValidation().requireValueInList(['Attended','No-show','Walk-in'], true).setAllowInvalid(true).build();
  sh.getRange(2, ATT_COL, 600, 1).setDataValidation(dv);
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction()==='onAttendanceEdit') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('onAttendanceEdit').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  SpreadsheetApp.getUi().alert('Attendance column added (column L). Mark Attended / No-show there and it flows to the dashboard. Your RSVP list and claims were not touched.');
}

function onAttendanceEdit(e){
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  if (sh.getName() !== TAB) return;
  const ATT_COL = M_START + 3;
  if (e.range.getColumn() > ATT_COL || e.range.getLastColumn() < ATT_COL) return;
  const r0 = Math.max(e.range.getRow(), 2), r1 = e.range.getLastRow();
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
