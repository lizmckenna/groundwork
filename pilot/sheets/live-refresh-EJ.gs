/**
 * Groundwork live turnout tracker — EASTERN JACKSON COUNTY (7/1). Branded.
 * Paste into Extensions → Apps Script, Save, run setUp() once (authorize when asked).
 */
const KEY     = 'p4mps-rKItacZ0arZKMy12UZuRBYwJVP_LJ4iU';
const EVENT   = 'Eastern Jackson County Emergency Meeting 7/1';
const LEADS   = 'LaNee,David,Facebook,Other';
const STATUS  = 'Not started,Texted,Called,Left message,Confirmed coming,No answer,Declined';
const ATTEND  = 'Self check-in,Attended,No-show,Walk-in,Canceled';
const RSVP_URL    = 'https://parents4mopublicschools.org/launches/eastern-jackson-county/';
const CHECKIN_URL = 'https://parents4mopublicschools.org/checkin/eastern-jackson-county/';

// ---- Brand palette + font. Swap FONT if it does not render in your Sheet. ----
const FONT='Archivo', PLUM='#3E4F6E', MARIGOLD='#C99633', YELLOW='#FFD54A';
const PAPER='#E9E5CE', INK='#1A2418', BAND='#EDEFF4', EDIT_TINT='#E7EBF2', ALERT='#FBE48A';

const TAB='RSVPs (live)';
const DATA_COLS=8;
const MANUAL=['Claimed by','Reminder: assigned to','Reminder: status','Attendance'];  // I,J,K,L
const M_START=DATA_COLS+1, TOTAL_COLS=DATA_COLS+MANUAL.length, EMAIL_COL=3, HDR=2, FIRST=3;
const BANNER='⚠️ LIVE LIST — pulled from the database. Do NOT add, edit, or delete rows in the white columns; anything typed there is erased on the next refresh. The plum columns are YOURS: Claimed by, reminders, and Attendance. They survive every refresh.';

function onOpen(){
  SpreadsheetApp.getUi().createMenu('🔄 Groundwork')
    .addItem('Refresh RSVPs now','refreshRSVPs')
    .addItem('Rebuild How-to + Goals','installHelp')
    .addItem('Re-apply branding','brandSheet')
    .addToUi();
}

function setUp(){
  const sh=SpreadsheetApp.getActive().getSheetByName(TAB);
  sh.getRange(1,1,1,TOTAL_COLS).breakApart();
  sh.getRange(1,3,1,TOTAL_COLS-2).merge().setValue(BANNER)
    .setFontFamily(FONT).setFontWeight('bold').setFontColor(INK).setBackground(ALERT)
    .setWrap(true).setVerticalAlignment('middle').setHorizontalAlignment('left');
  sh.setRowHeight(1,52);
  sh.getRange(HDR,M_START,1,MANUAL.length).setValues([MANUAL]);
  const dv=v=>SpreadsheetApp.newDataValidation().requireValueInList(v.split(','),true).setAllowInvalid(true).build();
  sh.getRange(FIRST,M_START,400,1).setDataValidation(dv(LEADS));
  sh.getRange(FIRST,M_START+1,400,1).setDataValidation(dv(LEADS));
  sh.getRange(FIRST,M_START+2,400,1).setDataValidation(dv(STATUS));
  sh.getRange(FIRST,M_START+3,400,1).setDataValidation(dv(ATTEND));
  sh.setFrozenRows(2); sh.setFrozenColumns(2);
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(p=>{if(p.getDescription()==='GW live')p.remove();});
  sh.getRange(1,1,sh.getMaxRows(),DATA_COLS).protect().setDescription('GW live').setWarningOnly(true);
  styleAttendance(sh);
  ScriptApp.getProjectTriggers().forEach(t=>{const f=t.getHandlerFunction(); if(f==='refreshRSVPs'||f==='onAttendanceEdit')ScriptApp.deleteTrigger(t);});
  ScriptApp.newTrigger('refreshRSVPs').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('onAttendanceEdit').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  refreshRSVPs();
  installHelp();
  brandSheet();
  SpreadsheetApp.getActive().toast('All set — branded, live, wipe-proof. The plum columns are yours.','Groundwork',6);
}

function refreshRSVPs(){
  const sh=SpreadsheetApp.getActive().getSheetByName(TAB); if(!sh)return;
  const last=sh.getLastRow(),N=MANUAL.length,byEmail={},byNP={};
  const npKey=(f,l,p)=>String(f||'').trim().toLowerCase()+'|'+String(l||'').trim().toLowerCase()+'|'+String(p||'').replace(/\D/g,'').slice(-10);
  if(last>=FIRST){
    const d=sh.getRange(FIRST,1,last-FIRST+1,DATA_COLS).getValues(), m=sh.getRange(FIRST,M_START,last-FIRST+1,N).getValues();
    for(let i=0;i<d.length;i++){
      if(!m[i].some(v=>v!=='')) continue;
      const k=String(d[i][EMAIL_COL-1]||'').trim().toLowerCase(); if(k) byEmail[k]=m[i];
      byNP[npKey(d[i][0],d[i][1],d[i][3])]=m[i];
    }
  }
  const url='https://groundwork-pilot.elizabethmck.workers.dev/export/rsvps.csv?key='+encodeURIComponent(KEY)+'&event='+encodeURIComponent(EVENT)+'&t='+Date.now();
  const resp=UrlFetchApp.fetch(url,{muteHttpExceptions:true});
  if(resp.getResponseCode()!==200) return;                                 // worker error -> leave data alone
  const rows=Utilities.parseCsv(resp.getContentText());
  if(rows.length<2) return;                                                // empty / header-only -> never wipe
  const hd=rows[0].map(h=>String(h).toLowerCase());
  if(hd.indexOf('email')===-1 && hd.indexOf('first name')===-1) return;    // not our CSV -> never wipe
  const body=rows.slice(1); if(!body.length) return;
  if(last>=FIRST) sh.getRange(FIRST,1,last-FIRST+1,DATA_COLS+N).clearContent();
  sh.getRange(HDR,1,1,DATA_COLS).setValues([rows[0].slice(0,DATA_COLS)]);
  sh.getRange(FIRST,1,body.length,DATA_COLS).setValues(body.map(r=>r.slice(0,DATA_COLS)));
  let attMap={};
  try{
    const au='https://groundwork-pilot.elizabethmck.workers.dev/export/attendance.csv?key='+encodeURIComponent(KEY)+'&event='+encodeURIComponent(EVENT)+'&t='+Date.now();
    Utilities.parseCsv(UrlFetchApp.fetch(au,{muteHttpExceptions:true}).getContentText()).forEach(row=>{const e=String(row[0]||'').trim().toLowerCase(); if(e) attMap[e]=String(row[1]||'Attended').trim();});
  }catch(e){}
  const reM=body.map(r=>{
    const em=String(r[2]||'').trim().toLowerCase();
    const pm=byEmail[em]||byNP[npKey(r[0],r[1],r[3])];
    const m=pm?pm.slice():new Array(N).fill('');
    let att=attMap[em]||'';
    if(!att && /^(no.?show|canceled|cancelled)$/i.test(String(m[N-1]||''))) att=m[N-1];
    m[N-1]=att;
    return m;
  });
  sh.getRange(FIRST,M_START,reM.length,N).setValues(reM);
  brandRows(sh, body.length);   // re-tint editable cols + re-band after the rewrite
  writeStats();
}

// Push Attended / No-show to the database + dashboard when a lead edits Attendance.
function onAttendanceEdit(e){
  if(!e||!e.range) return;
  const sh=e.range.getSheet(); if(sh.getName()!==TAB) return;
  const ATT_COL=M_START+3;
  if(e.range.getColumn()>ATT_COL || e.range.getLastColumn()<ATT_COL) return;
  const r0=Math.max(e.range.getRow(),FIRST), r1=e.range.getLastRow();
  const marks=[];
  for(let r=r0;r<=r1;r++){
    const email=String(sh.getRange(r,EMAIL_COL).getValue()||'').trim();
    if(!email) continue;
    marks.push({email:email, status:String(sh.getRange(r,ATT_COL).getValue()||'').trim()});
  }
  if(!marks.length) return;
  UrlFetchApp.fetch('https://groundwork-pilot.elizabethmck.workers.dev/sheet-attendance?key='+encodeURIComponent(KEY),
    {method:'post',contentType:'application/json',payload:JSON.stringify({event:EVENT,marks:marks}),muteHttpExceptions:true});
}

// ---- Branding: font, plum data header, plum/yellow editable headers, editable tint,
// every-other-row banding, and ONE full-width filter (incl Attendance) so a sort can
// never leave a column behind. ----
function brandSheet(){
  const sh=SpreadsheetApp.getActive().getSheetByName(TAB); if(!sh) return;
  const last=Math.max(sh.getLastRow(),FIRST);
  sh.getRange(1,1,sh.getMaxRows(),TOTAL_COLS).setFontFamily(FONT);
  sh.getRange(HDR,1,1,DATA_COLS).setFontWeight('bold').setBackground(PLUM).setFontColor(PAPER);
  sh.getRange(HDR,M_START,1,MANUAL.length).setFontWeight('bold').setBackground(PLUM).setFontColor(YELLOW);
  // one clean filter across EVERY column (data + manual incl Attendance)
  const ex=sh.getFilter(); if(ex) ex.remove();
  sh.getRange(HDR,1,Math.max(last-HDR+1,2),TOTAL_COLS).createFilter();
  brandRows(sh, Math.max(last-FIRST+1,0));
  styleAttendance(sh);
}
function brandRows(sh, n){
  if(n<=0) return;
  // every-other-row band on the data columns (A..H)
  const bandRange=sh.getRange(FIRST,1,n,DATA_COLS);
  bandRange.getBandings().forEach(b=>b.remove());
  const bd=bandRange.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY,false,false);
  try{ bd.setHeaderRowColor(null).setFirstRowColor('#FFFFFF').setSecondRowColor(BAND); }catch(e){}
  // editable columns get a light-plum tint so they read as "yours"
  sh.getRange(FIRST,M_START,n,MANUAL.length).setBackground(EDIT_TINT);
}

function styleAttendance(sh){
  const attCol=M_START+3;
  const attRange=sh.getRange(FIRST,attCol,sh.getMaxRows()-FIRST+1,1);
  let rules=sh.getConditionalFormatRules().filter(r=>!r.getRanges().some(rg=>rg.getColumn()===attCol));
  const cf=(txt,bg,fc)=>{let b=SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(txt).setBackground(bg); if(fc)b=b.setFontColor(fc); return b.setRanges([attRange]).build();};
  rules.push(cf('Self check-in','#1F7A43','#ffffff'));
  rules.push(cf('Attended','#CFE8D6'));
  rules.push(cf('Walk-in','#CFE8D6'));
  rules.push(cf('No-show','#F0C9C5'));
  rules.push(cf('Canceled','#E0E0E0'));
  sh.setConditionalFormatRules(rules);
}

// Pizza + childcare counts onto the Goals tab, then style the Goals tab.
function writeStats(){
  const g=SpreadsheetApp.getActive().getSheetByName('Goals'); if(!g) return;
  const url='https://groundwork-pilot.elizabethmck.workers.dev/export/rsvps.csv?stats=1&key='+encodeURIComponent(KEY)+'&event='+encodeURIComponent(EVENT)+'&t='+Date.now();
  let m={};
  try{ Utilities.parseCsv(UrlFetchApp.fetch(url,{muteHttpExceptions:true}).getContentText()).slice(1).forEach(r=>m[r[0]]=Number(r[1])||0); }catch(e){ return; }
  const items=[
    ['Live RSVP total (everyone):',m.registered||0,'live rsvp total'],
    ['Want pizza:',m.pizza||0,'want pizza'],
    ['Childcare (families):',m.childcare_families||0,'childcare (families'],
    ['Childcare (kids total):',m.childcare_kids||0,'childcare (kids'],
  ];
  const colA=g.getRange(1,1,Math.max(g.getLastRow(),1),1).getValues().map(r=>String(r[0]).toLowerCase());
  items.forEach(function(it){
    let row=-1;
    for(let i=0;i<colA.length;i++){ if(colA[i].indexOf(it[2])>=0){ row=i+1; break; } }
    if(row<0){ row=g.getLastRow()+1; g.getRange(row,1).setValue(it[0]).setFontWeight('bold'); colA.push(it[0].toLowerCase()); }
    g.getRange(row,3).setValue(it[1]);
  });
  styleGoals(g);
}
function styleGoals(g){
  try{
    const lastR=Math.max(g.getLastRow(),1), lastC=Math.max(g.getLastColumn(),4);
    g.getRange(1,1,lastR,lastC).setFontFamily(FONT);
    const colA=g.getRange(1,1,lastR,1).getValues().map(r=>String(r[0]).trim());
    const hdr=colA.indexOf('Lead');
    if(hdr>=0){
      g.getRange(hdr+1,1,1,lastC).setFontWeight('bold').setBackground(PLUM).setFontColor(YELLOW);
      let totalRow=lastR;
      for(let r=hdr+1;r<lastR;r++){ if(colA[r].toUpperCase()==='TOTAL'){ totalRow=r+1; break; } }
      if(totalRow>hdr+2){
        const rng=g.getRange(hdr+2,1,totalRow-(hdr+2),lastC);
        rng.getBandings().forEach(b=>b.remove());
        const bd=rng.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY,false,false);
        try{ bd.setHeaderRowColor(null).setFirstRowColor('#FFFFFF').setSecondRowColor(BAND); }catch(e){}
      }
    }
  }catch(e){}
}

// Goals formulas (claimed count + %-to-goal, no formula editing to add a lead) + How-to.
function installHelp(){
  const ss=SpreadsheetApp.getActive();
  const g=ss.getSheetByName('Goals');
  if(g){
    const colA=g.getRange(1,1,Math.max(g.getLastRow(),1),1).getValues().map(r=>String(r[0]).trim());
    const hdr=colA.indexOf('Lead');
    if(hdr>=0){
      for(let r=hdr+2;r<=g.getLastRow();r++){
        const name=String(g.getRange(r,1).getValue()).trim();
        if(name.toUpperCase()==='TOTAL') break;
        if(!name) continue;
        g.getRange(r,3).setFormula("=IF($A"+r+"=\"\",\"\",COUNTIF('RSVPs (live)'!$I:$I,$A"+r+"))");
        g.getRange(r,4).setFormula("=IF(OR($A"+r+"=\"\",$B"+r+"=0),\"\",$C"+r+"/$B"+r+")");
      }
    }
    styleGoals(g);
    styleTemplate();
  }
  rebuildHowTo();
}

// Style a per-lead "Template (copy me)" tab (and any duplicated personal lists): same
// font, plum header, every-other-row shading.
function styleTemplate(){
  const ss=SpreadsheetApp.getActive();
  ss.getSheets().forEach(function(sh){
    const nm=sh.getName();
    if(nm===TAB || nm==='Goals' || nm.indexOf('How to')>=0) return;
    if(!/template|copy me/i.test(nm) && sh.getLastRow()<1) return;
    try{
      const lr=Math.max(sh.getLastRow(),1), lc=Math.max(sh.getLastColumn(),1);
      sh.getRange(1,1,Math.max(lr,2),lc).setFontFamily(FONT);
      sh.getRange(1,1,1,lc).setFontWeight('bold').setBackground(PLUM).setFontColor(YELLOW);
      if(lr>1){
        const rng=sh.getRange(2,1,lr-1,lc);
        rng.getBandings().forEach(b=>b.remove());
        const bd=rng.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY,false,false);
        try{ bd.setHeaderRowColor(null).setFirstRowColor('#FFFFFF').setSecondRowColor(BAND); }catch(e){}
      }
    }catch(e){}
  });
}

function rebuildHowTo(){
  const ss=SpreadsheetApp.getActive();
  let h=ss.getSheetByName('📖 How to use');
  if(!h) h=ss.insertSheet('📖 How to use',0);
  h.clear();
  try{ h.setHiddenGridlines(true); }catch(e){}
  h.setColumnWidth(1,860);
  const rows=[
    ['📖 How to use this tracker','title'],
    ['','gap'],
    ['⭐ Door sign-in link — share with registrants AND walk-ins','h'],
    [CHECKIN_URL,'linkhl'],
    ['Put this on a tablet or a printed QR at the welcome table. Registrants start typing their name and tap it; walk-ins tap "I am new here" and add their info (incl. school + district). Self check-ins turn green in the Attendance column automatically.','p'],
    ['','gap'],
    ['Claim someone who registered','h'],
    ['On the RSVPs (live) tab, find the person and pick your name in the plum "Claimed by" column. It adds to your number on the Goals tab right away.','p'],
    ['Never type a person into the white columns. They are the live list from the database, and anything typed there is erased on the next refresh.','note'],
    ['','gap'],
    ['Attendance fills itself in','h'],
    ['When someone checks in at the door, their row turns green and shows "Self check-in" on its own. You can also hand-mark Attended / No-show / Canceled for anyone who did not scan.','p'],
    ['','gap'],
    ['Reminder calls and texts','h'],
    ['Use the plum "Reminder: assigned to" and "Reminder: status" columns. They stay attached to each person through every refresh.','p'],
    ['','gap'],
    ['Sorting + filtering safely','h'],
    ['To sort or filter just for yourself, use Data → Filter views → Create new filter view (it is private and never reorders the shared list). The filter on the sheet covers every column, so a sort moves whole rows together.','p'],
    ['','gap'],
    ['Change a goal','h'],
    ['On the Goals tab, type a new number in the "Goal" column. Everything recalculates on its own.','p'],
    ['','gap'],
    ['Add a new lead','h'],
    ['Goals tab: type the new name above TOTAL and set their Goal, then copy the row above and paste into the new row. Duplicate the "Template (copy me)" tab for their personal list.','p'],
    ['','gap'],
    ['RSVP link (to recruit before the event)','h'],
    [RSVP_URL,'link'],
  ];
  h.getRange(1,1,rows.length,1).setValues(rows.map(function(r){ return [r[0]]; }));
  rows.forEach(function(it,i){
    const c=h.getRange(i+1,1).setWrap(true).setVerticalAlignment('middle').setFontFamily(FONT);
    if(it[1]==='title'){ c.setFontSize(18).setFontWeight('bold').setFontColor(MARIGOLD).setBackground(PLUM); h.setRowHeight(i+1,48); }
    else if(it[1]==='h'){ c.setFontSize(13).setFontWeight('bold').setFontColor(PLUM); h.setRowHeight(i+1,28); }
    else if(it[1]==='note'){ c.setFontSize(11).setFontColor('#9A3412').setFontStyle('italic'); h.setRowHeight(i+1,42); }
    else if(it[1]==='link'){ c.setFontSize(11).setFontColor('#2563EB'); h.setRowHeight(i+1,24); }
    else if(it[1]==='linkhl'){
      const rt=SpreadsheetApp.newRichTextValue().setText(it[0]).setLinkUrl(it[0])
        .setTextStyle(SpreadsheetApp.newTextStyle().setBold(true).setFontSize(13).build()).build();
      c.setRichTextValue(rt).setBackground('#FFF4CC'); h.setRowHeight(i+1,36);
    }
    else if(it[1]==='gap'){ c.setBackground(MARIGOLD); h.setRowHeight(i+1,8); }   // marigold spacer rows
    else { c.setFontSize(11).setFontColor(INK); h.setRowHeight(i+1,38); }
  });
  h.activate();
  SpreadsheetApp.flush();
}
