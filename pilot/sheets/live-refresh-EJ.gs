/**
 * Groundwork live turnout tracker — EASTERN JACKSON COUNTY (7/1). Branded.
 * Paste into Extensions → Apps Script, Save, run setUp() once (authorize when asked).
 */
const KEY     = 'p4mps-rKItacZ0arZKMy12UZuRBYwJVP_LJ4iU';
const EVENT   = 'Eastern Jackson County Emergency Meeting 7/1';
const LEADS   = 'LaNee,David,Facebook,Other';
const STATUS  = 'Not started,Texted,Called,Left message,Confirmed coming,No answer,Declined';
const ATTEND  = 'Scheduled,Self check-in,Attended,No-show,Walk-in,Canceled';
const RSVP_URL    = 'https://parents4mopublicschools.org/launches/eastern-jackson-county/';
const CHECKIN_URL = 'https://parents4mopublicschools.org/checkin/eastern-jackson-county/';

// ---- Brand palette + font. Swap FONT if it does not render in your Sheet. ----
const FONT='Archivo';
const PLUM='#3e4f6e', YELLOW='#d5b069', ROSE='#b35049', TANGERINE='#af5a2b';
const PAPER='#E9E5CE', INK='#1A2418', BAND='#EDEFF4', ALERT='#FBE48A';
const FILL_TINT='#F0E2C2';   // light gold = "please fill this in"
// status colors
const C_RED='#F2C9C4', C_GREEN='#CDE9D5', C_GREEN_STRONG='#1F7A43', C_GREY='#E0E0E0', C_BLUE='#D8E6F2', C_AMBER='#FBE8B0', C_NEUTRAL='#EDEFF4';

const TAB='RSVPs (live)';
const DATA_COLS=8;
const MANUAL=['Claimed by','Reminder: assigned to','Reminder: status','Attendance'];  // I,J,K,L
const M_START=DATA_COLS+1, TOTAL_COLS=DATA_COLS+MANUAL.length, EMAIL_COL=3, HDR=2, FIRST=3;
const BANNER='⚠️ LIVE LIST — pulled from the database. Do NOT touch the RED columns (A–H); anything typed there is erased on the next refresh. The PLUM columns are YOURS: Claimed by, reminders, and Attendance. They survive every refresh.';

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
  styleStatuses(sh);
  ScriptApp.getProjectTriggers().forEach(t=>{const f=t.getHandlerFunction(); if(f==='refreshRSVPs'||f==='onAttendanceEdit')ScriptApp.deleteTrigger(t);});
  ScriptApp.newTrigger('refreshRSVPs').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('onAttendanceEdit').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  refreshRSVPs();
  installHelp();
  brandSheet();
  SpreadsheetApp.getActive().toast('All set — branded, live, wipe-proof. Plum = yours, red = do not touch.','Groundwork',6);
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
    if(!String(m[2]||'').trim()) m[2]='Not started';                       // Reminder status default
    let att=attMap[em]||String(m[3]||'').trim()||'Scheduled';              // live check-in > kept mark > Scheduled
    m[3]=att;
    return m;
  });
  sh.getRange(FIRST,M_START,reM.length,N).setValues(reM);
  brandRows(sh, body.length);
  writeStats();
}

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
  UrlFetchApp.fetch('https://groundwork-pilot.elizabethmck.workers.dev/sheet-attendance?key='+encodeURIComponent(KEY),
    {method:'post',contentType:'application/json',payload:JSON.stringify({event:EVENT,marks:marks}),muteHttpExceptions:true});
}

// ---- Branding ----
function brandSheet(){
  const sh=SpreadsheetApp.getActive().getSheetByName(TAB); if(!sh) return;
  const last=Math.max(sh.getLastRow(),FIRST);
  sh.getRange(1,1,sh.getMaxRows(),TOTAL_COLS).setFontFamily(FONT);
  sh.getRange(HDR,1,1,DATA_COLS).setFontWeight('bold').setBackground(ROSE).setFontColor(PAPER);          // Airtable cols: rose + beige
  sh.getRange(HDR,M_START,1,MANUAL.length).setFontWeight('bold').setBackground(PLUM).setFontColor(YELLOW); // editable: plum + marigold
  const ex=sh.getFilter(); if(ex) ex.remove();
  sh.getRange(HDR,1,Math.max(last-HDR+1,2),TOTAL_COLS).createFilter();
  brandRows(sh, Math.max(last-FIRST+1,0));
  styleStatuses(sh);
}
function brandRows(sh, n){
  if(n<=0) return;
  const bandRange=sh.getRange(FIRST,1,n,DATA_COLS);
  bandRange.getBandings().forEach(b=>b.remove());
  const bd=bandRange.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY,false,false);
  try{ bd.setHeaderRowColor(null).setFirstRowColor('#FFFFFF').setSecondRowColor(BAND); }catch(e){}
}

// Color-code Reminder status + Attendance, and gold-highlight unfilled Claimed by / Reminder-assigned.
function styleStatuses(sh){
  const claimCol=M_START, assignCol=M_START+1, remCol=M_START+2, attCol=M_START+3;
  const maxR=sh.getMaxRows()-FIRST+1;
  const remR=sh.getRange(FIRST,remCol,maxR,1), attR=sh.getRange(FIRST,attCol,maxR,1), fillR=sh.getRange(FIRST,claimCol,maxR,2);
  let rules=sh.getConditionalFormatRules().filter(r=>!r.getRanges().some(rg=>{const c=rg.getColumn(); return c>=claimCol && c<=attCol;}));
  const eq=(rng,txt,bg,fc)=>{let b=SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(txt).setBackground(bg); if(fc)b=b.setFontColor(fc); return b.setRanges([rng]).build();};
  // Reminder status
  rules.push(eq(remR,'Not started',C_RED));
  rules.push(eq(remR,'Texted',C_BLUE));
  rules.push(eq(remR,'Called',C_BLUE));
  rules.push(eq(remR,'Left message',C_AMBER));
  rules.push(eq(remR,'No answer',C_AMBER));
  rules.push(eq(remR,'Confirmed coming',C_GREEN));
  rules.push(eq(remR,'Declined',C_GREY));
  // Attendance
  rules.push(eq(attR,'Scheduled',C_NEUTRAL));
  rules.push(eq(attR,'Self check-in',C_GREEN_STRONG,'#ffffff'));
  rules.push(eq(attR,'Attended',C_GREEN));
  rules.push(eq(attR,'Walk-in',C_GREEN));
  rules.push(eq(attR,'No-show',C_RED));
  rules.push(eq(attR,'Canceled',C_GREY));
  // Unfilled Claimed by / Reminder assigned -> gold "fill me in"
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenCellEmpty().setBackground(FILL_TINT).setRanges([fillR]).build());
  sh.setConditionalFormatRules(rules);
}

// Pizza + childcare onto Goals; live-rsvp-total in tangerine; drop a "Came via FB" row; style the tab.
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
    const cell=g.getRange(row,3).setValue(it[1]);
    if(it[2]==='live rsvp total') cell.setFontColor(TANGERINE).setFontWeight('bold');
  });
  styleGoals(g);
}
function styleGoals(g){
  try{
    // remove a stray "Came via FB" row if present (bottom-up so indices stay valid)
    const a=g.getRange(1,1,Math.max(g.getLastRow(),1),1).getValues();
    for(let i=a.length-1;i>=0;i--){ if(/came via fb|via fb|facebook/i.test(String(a[i][0]))) g.deleteRow(i+1); }
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

// Per-lead "Template (copy me)" + personal tabs: same font, plum header, black body text, banding.
function styleTemplate(){
  const ss=SpreadsheetApp.getActive();
  ss.getSheets().forEach(function(sh){
    const nm=sh.getName();
    if(nm===TAB || nm==='Goals' || nm.indexOf('How to')>=0) return;
    try{
      const lr=Math.max(sh.getLastRow(),1), lc=Math.max(sh.getLastColumn(),1);
      sh.getRange(1,1,Math.max(lr,2),lc).setFontFamily(FONT).setFontColor(INK);     // body text BLACK (was unreadable white)
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
    ['⭐ The two links you need','h'],
    ['Walk-in / door sign-in — share with registrants AND walk-ins:','plabel'],
    [CHECKIN_URL,'linkhl'],
    ['RSVP recruiting link — text this to turn people out before the event:','plabel'],
    [RSVP_URL,'linkhl'],
    ['','gap'],
    ['Claim someone who registered','h'],
    ['Find the person and pick your name in the plum "Claimed by" column. It adds to your number on the Goals tab right away.','p'],
    ['Do NOT type into the RED columns (A–H). They are the live database list and anything typed there is erased on the next refresh.','note'],
    ['','gap'],
    ['The colors tell you what is left','h'],
    ['Reminder status starts at "Not started" (red) and Attendance starts at "Scheduled" — so at a glance you see who still needs a call or a check-in. Update them and the colors change (green = confirmed/attended, grey = declined/canceled). Empty gold cells mean "please fill this in."','p'],
    ['','gap'],
    ['Sorting + filtering safely','h'],
    ['To sort or filter just for yourself, use Data → Filter views → Create new filter view (private, never reorders the shared list). The filter on the sheet covers every column, so a sort moves whole rows together.','p'],
    ['','gap'],
    ['Change a goal / add a lead','h'],
    ['Goals tab: type a new Goal number, or add a name above TOTAL and copy the row above. Duplicate the "Template (copy me)" tab for a personal list.','p'],
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
