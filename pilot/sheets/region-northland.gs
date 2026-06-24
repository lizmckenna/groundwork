/**
 * Groundwork — NORTHLAND REGIONAL TRACKER (rebuilt to Ellen's layout).
 * Paste into Extensions → Apps Script, Save, run setUp() once (authorize when asked).
 *
 * Tabs, in Ellen's order: All Northland Contacts (read-only union, first), then the
 * editable district tabs where leaders work (NKCSD, Park Hill, Liberty, Other),
 * then Team roster, Dashboard, and How-to.
 * Almost everything is editable two-way so leaders clean data as they go — fixes to
 * contact fields save back to the database. The ONLY red, do-not-touch columns are
 * the four Attendance fields (the system records those from check-ins).
 */
const KEY    = 'p4mps-rKItacZ0arZKMy12UZuRBYwJVP_LJ4iU';
const REGION = 'northland';
const FEED   = 'https://groundwork-pilot.elizabethmck.workers.dev/export/region.csv';
const PUSH   = 'https://groundwork-pilot.elizabethmck.workers.dev/sheet-region-update';

// ---- brand ----
const FONT='Archivo';
const PLUM='#3e4f6e', ROSE='#b35049', PAPER='#E9E5CE', INK='#1A2418', GOLD='#d5b069', ALERT='#FBE48A';
const BAND1='#EEF1F6', BAND2='#DFE5EF';   // two shades — no white rows
const C_BLUE='#D8E6F2', C_AMBER='#FBE8B0', C_GREEN='#CDE9D5', C_GREEN_STRONG='#1F7A43', C_GREY='#E0E0E0', C_RED='#F2C9C4';

// organizer dropdown — hard-coded distinct colors so leaders spot their name fast
const ORG_COLORS = {
  'LaNeé Bridewell':'#D7C9F0', 'Ellen Glover':'#D8E6F2', 'Latrice Barnett':'#F4C7C3', 'Sierra Kilpatrick':'#CDE9D5',
  'Holly Kaden':'#FBE8B0', 'Bess Bailey':'#E6D5F2', 'Synthia Larson':'#F2DFC9', 'Emma Fortner':'#CCEEF2',
  'Stephanie Rittgers':'#F0D0E0', 'David Tremaine':'#DCE8BE',
};
const DD = {
  ORG:    ['LaNeé Bridewell','Ellen Glover','Latrice Barnett','Sierra Kilpatrick','Holly Kaden','Bess Bailey','Synthia Larson','Emma Fortner'],
  COMMIT: ['Committed','Planned','Completed','Cancelled'],
  TEAM:   ['Prospect','Regional Team','Core Team','Co-lead'],
  FLAG:   ['Duplicate','Merge','Wrong person','Bad contact'],
  // controlled vocab for cleanup — canonical Northland districts (allow-invalid, so messy incoming values still display)
  DISTRICT: ['North Kansas City Schools','Park Hill School District','Liberty Public Schools','Smithville School District','Kearney School District','Excelsior Springs School District','Platte County R-3','Gladstone','Other / outside Northland'],
};

// column model — Ellen's order (+ County, + Team/Notes/Flag at the end).
// tier: data=editable+writes back, soft=editable no write-back, commit/team/flag=editable sheet-only,
//       ro=red read-only (attendance), hide=hidden.
const COLS = [
  {h:'contact_id',     tier:'hide'},
  {h:'First',          tier:'data', push:'first'},
  {h:'Last',           tier:'data', push:'last'},
  {h:'Organized By',   tier:'soft', dd:'ORG',    preserve:true},
  {h:'Role',           tier:'soft'},
  {h:'Email',          tier:'data', push:'email'},
  {h:'Phone',          tier:'data', push:'phone'},
  {h:'Address',        tier:'data', push:'address'},
  {h:'City',           tier:'data', push:'city'},
  {h:'Zip',            tier:'data', push:'zip'},
  {h:'School',         tier:'data', push:'school'},
  {h:'District',       tier:'data', push:'district', dd:'DISTRICT'},
  {h:'County',         tier:'soft'},
  {h:'Amplifier',      tier:'commit', dd:'COMMIT', preserve:true},
  {h:'House Mtg',      tier:'commit', dd:'COMMIT', preserve:true},
  {h:'School Board',   tier:'commit', dd:'COMMIT', preserve:true},
  {h:'Canvass',        tier:'commit', dd:'COMMIT', preserve:true},
  {h:'Regional Team',  tier:'commit', dd:'COMMIT', preserve:true},
  {h:'Attended Launch?',                      tier:'ro'},
  {h:'Attended/RSVPed Amp Training?',         tier:'ro'},
  {h:'Attended/RSVPed House Mtg Training?',   tier:'ro'},
  {h:'RSVPed for GOTV Launch?',               tier:'ro'},
  {h:'Team',           tier:'team', dd:'TEAM', preserve:true},
  {h:'Notes',          tier:'soft', preserve:true},
  {h:'Flag (dupe / merge)', tier:'flag', dd:'FLAG', preserve:true},
];
const N=COLS.length, FEED_COLS=22, HDR=2, FIRST=3, MAXR=500;
const PRESERVE = COLS.map((c,i)=>c.preserve?i+1:0).filter(Boolean);
const PUSH_BY_COL={}; COLS.forEach((c,i)=>{ if(c.push) PUSH_BY_COL[i+1]=c.push; });
function colL(n){ let s=''; while(n>0){ const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=(n-m-1)/26; } return s; }

const MASTER='All Northland Contacts', TEAM_TAB='Team roster', DASH='📊 Dashboard', HOWTO='📖 How to use';
const DISTRICTS = [
  {tab:'NKCSD',              re:/nkc|north kansas city/i},
  {tab:'Park Hill District', re:/park ?hill/i},
  {tab:'Liberty SD',         re:/liberty/i},
  {tab:'Other Northland',    re:null},   // catch-all: Smithville/Kearney/Excelsior/Platte City/blank district
];
const BANNER_EDIT   = '✏️ YOUR WORKING LIST — edit freely. Fixes to contact info (school, district, phone…) save to the database. The 4 RED Attendance columns are system records, do not edit. Organized By is color-coded so you can find your name.';
const BANNER_MASTER = '👁️ OVERVIEW of the whole region (every district stacked here). READ-ONLY — do your work in your district tab. This updates on its own.';

function onOpen(){
  SpreadsheetApp.getUi().createMenu('🔄 Groundwork')
    .addItem('Refresh now','refreshAll')
    .addItem('Rebuild dashboard + how-to','rebuildExtras')
    .addItem('Re-apply branding','brandAll')
    .addToUi();
}

function setUp(){
  const ss=SpreadsheetApp.getActive();
  buildShell(MASTER, false);
  DISTRICTS.forEach(d=> buildShell(d.tab, true));
  buildTeamRoster();
  ScriptApp.getProjectTriggers().forEach(t=>{const f=t.getHandlerFunction(); if(f==='refreshAll'||f==='onEditRegion')ScriptApp.deleteTrigger(t);});
  ScriptApp.newTrigger('refreshAll').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('onEditRegion').forSpreadsheet(ss).onEdit().create();
  try{ refreshAll(); }catch(e){}
  rebuildExtras();
  brandAll();
  const order=[MASTER, ...DISTRICTS.map(d=>d.tab), TEAM_TAB, DASH, HOWTO];
  order.forEach((name,i)=>{ const s=ss.getSheetByName(name); if(s){ ss.setActiveSheet(s); ss.moveActiveSheet(i+1); } });
  const m=ss.getSheetByName(MASTER); if(m) m.activate();
  ss.toast('Northland tracker built, Ellen layout. Work in your district tab. Master + dashboard update on their own.','Groundwork',7);
}

function buildShell(name, editable){
  const ss=SpreadsheetApp.getActive();
  let sh=ss.getSheetByName(name); if(!sh) sh=ss.insertSheet(name);
  sh.getRange(1,1,1,N).breakApart();
  sh.getRange(1,4,1,N-3).merge().setValue(editable?BANNER_EDIT:BANNER_MASTER)
    .setFontFamily(FONT).setFontWeight('bold').setFontColor(INK).setBackground(editable?ALERT:'#DCE3EE')
    .setWrap(true).setVerticalAlignment('middle').setHorizontalAlignment('left');
  sh.setRowHeight(1,50);
  sh.getRange(HDR,1,1,N).setValues([COLS.map(c=>c.h)]);
  if(editable){
    const dv=list=>SpreadsheetApp.newDataValidation().requireValueInList(list,true).setAllowInvalid(true).build();
    COLS.forEach((c,i)=>{ if(c.dd) sh.getRange(FIRST,i+1,MAXR,1).setDataValidation(dv(DD[c.dd])); });
  }
  sh.setFrozenRows(2); sh.setFrozenColumns(3); sh.hideColumns(1);
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(p=>{ if((p.getDescription()||'').indexOf('GW')===0) p.remove(); });
  if(!editable){ sh.getRange(1,1,sh.getMaxRows(),N).protect().setDescription('GW master ro').setWarningOnly(true); }
  else { COLS.forEach((c,i)=>{ if(c.tier==='ro') sh.getRange(1,i+1,sh.getMaxRows(),1).protect().setDescription('GW ro').setWarningOnly(true); }); }
}

function refreshAll(){
  const resp=UrlFetchApp.fetch(FEED+'?key='+encodeURIComponent(KEY)+'&region='+encodeURIComponent(REGION)+'&t='+Date.now(),{muteHttpExceptions:true});
  if(resp.getResponseCode()!==200) return;                                  // abort-safe
  const rows=Utilities.parseCsv(resp.getContentText());
  if(rows.length<1 || String(rows[0][1]||'').toLowerCase()!=='first') return;
  const body=rows.slice(1);
  if(body.length<1) return;
  DISTRICTS.forEach(d=> writeDistrict(d, body));
  rebuildMaster();
}

function writeDistrict(d, body){
  const sh=SpreadsheetApp.getActive().getSheetByName(d.tab); if(!sh) return;
  const mine=body.filter(r=>{
    const dist=String(r[11]||'');
    if(d.re) return d.re.test(dist);
    return !DISTRICTS.slice(0,3).some(x=> x.re.test(dist));               // catch-all: matches none of the 3
  });
  const last=sh.getLastRow(), saved={};
  if(last>=FIRST){
    const cur=sh.getRange(FIRST,1,last-FIRST+1,N).getValues();
    cur.forEach(row=>{ const id=String(row[0]||'').trim(); if(!id) return; const keep={}; let any=false; PRESERVE.forEach(p=>{const v=row[p-1]; if(v!=='' && v!=null){keep[p]=v; any=true;}}); if(any) saved[id]=keep; });
  }
  if(last>=FIRST) sh.getRange(FIRST,1,last-FIRST+1,N).clearContent();
  const out=mine.map(r=>{
    const row=new Array(N).fill('');
    for(let i=0;i<FEED_COLS;i++) row[i]=r[i]||'';
    const keep=saved[String(r[0]||'').trim()];
    if(keep) PRESERVE.forEach(p=>{ if(keep[p]!==undefined && keep[p]!=='') row[p-1]=keep[p]; });
    return row;
  });
  if(out.length) sh.getRange(FIRST,1,out.length,N).setValues(out);
  brandRows(sh,out.length);
}

function rebuildMaster(){
  const ss=SpreadsheetApp.getActive(), sh=ss.getSheetByName(MASTER); if(!sh) return;
  let all=[];
  DISTRICTS.forEach(d=>{ const t=ss.getSheetByName(d.tab); if(!t) return; const lr=t.getLastRow(); if(lr>=FIRST) all=all.concat(t.getRange(FIRST,1,lr-FIRST+1,N).getValues().filter(r=>String(r[1]||'').trim())); });
  const last=sh.getLastRow();
  if(last>=FIRST) sh.getRange(FIRST,1,last-FIRST+1,N).clearContent();
  if(all.length) sh.getRange(FIRST,1,all.length,N).setValues(all);
  brandRows(sh,all.length);
}

// data-quality edits (district tabs) write back to Airtable
function onEditRegion(e){
  if(!e||!e.range) return;
  const sh=e.range.getSheet(); if(!DISTRICTS.some(d=>d.tab===sh.getName())) return;
  const r0=Math.max(e.range.getRow(),FIRST), r1=e.range.getLastRow(), c0=e.range.getColumn(), c1=e.range.getLastColumn();
  const updates=[];
  for(let c=c0;c<=c1;c++){
    const field=PUSH_BY_COL[c]; if(!field) continue;
    for(let r=r0;r<=r1;r++){
      const id=String(sh.getRange(r,1).getValue()||'').trim(); if(!id) continue;
      updates.push({contact_id:id, field:field, value:String(sh.getRange(r,c).getValue()||'')});
    }
  }
  if(!updates.length) return;
  UrlFetchApp.fetch(PUSH,{method:'post',contentType:'application/json',payload:JSON.stringify({key:KEY,updates:updates}),muteHttpExceptions:true});
}

// ---- branding ----
function brandAll(){ [MASTER, ...DISTRICTS.map(d=>d.tab)].forEach(n=>brandTab(n)); }
function brandTab(name){
  const sh=SpreadsheetApp.getActive().getSheetByName(name); if(!sh) return;
  try{ sh.getRange(1,1,sh.getMaxRows(),N).setFontFamily(FONT); }catch(e){}
  COLS.forEach((c,i)=>{ if(c.tier==='hide') return; const red=c.tier==='ro';
    try{ sh.getRange(HDR,i+1).setFontWeight('bold').setBackground(red?ROSE:PLUM).setFontColor(PAPER).setWrap(true); }catch(e){} });
  const last=Math.max(sh.getLastRow(),HDR);
  try{ const ex=sh.getFilter(); if(ex) ex.remove(); sh.getRange(HDR,1,Math.max(last-HDR+1,1),N).createFilter(); }catch(e){}
  try{ brandRows(sh, Math.max(sh.getLastRow()-FIRST+1,0)); }catch(e){}
  try{ styleStatuses(sh); }catch(e){}
}
function brandRows(sh,n){
  if(n<=0) return;
  const rng=sh.getRange(FIRST,1,n,N);
  rng.getBandings().forEach(b=>b.remove());
  const bd=rng.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY,false,false);
  try{ bd.setHeaderRowColor(null).setFirstRowColor(BAND1).setSecondRowColor(BAND2); }catch(e){}   // shaded, no white
}
function ci(h){ return COLS.findIndex(c=>c.h===h)+1; }
function styleStatuses(sh){
  const maxR=sh.getMaxRows()-FIRST+1;
  const orgCol=ci('Organized By'), teamCol=ci('Team'), flagCol=ci('Flag (dupe / merge)'), flagL=colL(flagCol);
  const commit=COLS.map((c,i)=>c.tier==='commit'?i+1:0).filter(Boolean);
  const ro=COLS.map((c,i)=>c.tier==='ro'?i+1:0).filter(Boolean);
  const eq=(col,txt,bg,fc)=>{ let b=SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(txt).setBackground(bg); if(fc)b=b.setFontColor(fc); return b.setRanges([sh.getRange(FIRST,col,maxR,1)]).build(); };
  const rules=[];
  // FLAGGED rows (any flag value) -> whole row grey + strikethrough. First, so it wins over the color rules.
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$'+flagL+FIRST+'<>""')
    .setBackground('#D9D9D9').setFontColor('#7A7A7A').setStrikethrough(true)
    .setRanges([sh.getRange(FIRST,1,maxR,N)]).build());
  // organizer multicolor
  Object.keys(ORG_COLORS).forEach(name=> rules.push(eq(orgCol,name,ORG_COLORS[name])));
  // commitment statuses
  commit.forEach(col=>{ rules.push(eq(col,'Committed',C_BLUE)); rules.push(eq(col,'Planned',C_AMBER)); rules.push(eq(col,'Completed',C_GREEN)); rules.push(eq(col,'Cancelled',C_GREY)); });
  // attendance Yes
  ro.forEach(col=> rules.push(eq(col,'Yes',C_GREEN)));
  // team
  rules.push(eq(teamCol,'Co-lead',C_GREEN_STRONG,'#ffffff')); rules.push(eq(teamCol,'Core Team',C_GREEN));
  rules.push(eq(teamCol,'Regional Team',C_BLUE)); rules.push(eq(teamCol,'Prospect',C_AMBER));
  sh.setConditionalFormatRules(rules);
}

function rebuildExtras(){ buildDashboard(); rebuildHowTo(); }

function buildTeamRoster(){
  const ss=SpreadsheetApp.getActive(); let s=ss.getSheetByName(TEAM_TAB); if(!s) s=ss.insertSheet(TEAM_TAB);
  const heads=['Status','First','Last','Email','Phone','Role','School','District'];
  s.getRange(1,1,1,8).setValues([heads]).setFontWeight('bold').setBackground(PLUM).setFontColor(PAPER).setFontFamily(FONT);
  if(s.getLastRow()<2){
    const seed=[
      ['Co-lead','Latrice','Barnett','latricelaa@gmail.com','(816) 695-7682','Parent','Greenway','NKC'],
      ['Co-lead','Sierra','Kilpatrick','sierrak830@yahoo.com','(661) 220-0106','Parent','Davidson','Kansas City'],
      ['Core Team','Ellen','Glover','ellenginkc@gmail.com','(952) 334-6348','Parent','Greenway','North Kansas City'],
      ['Core Team','Holly','Kaden','hollykaden@gmail.com','816-898-4128','Parent, Community member','Staley','North Kansas City'],
      ['Core Team','Bess','Bailey','emtoyama@gmail.com','946-549-5914','Parent, Teacher, Community member','Briarcliff Elementary','North Kansas City'],
      ['Core Team','Synthia','Larson','synthiacat@gmail.com','620-203-0810','Parent, Community member','Briarcliff','North Kansas City'],
      ['Prospect','Emma','Fortner','','','','',''],
    ];
    s.getRange(2,1,seed.length,8).setValues(seed);
  }
  const dv=SpreadsheetApp.newDataValidation().requireValueInList(DD.TEAM,true).setAllowInvalid(true).build();
  s.getRange(2,1,200,1).setDataValidation(dv);
  s.setFrozenRows(1);
  const lr=Math.max(s.getLastRow(),2);
  s.getRange(1,1,lr,8).setFontFamily(FONT);
  const rng=s.getRange(2,1,lr-1,8); rng.getBandings().forEach(b=>b.remove());
  try{ const bd=rng.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY,false,false); bd.setHeaderRowColor(null).setFirstRowColor(BAND1).setSecondRowColor(BAND2); }catch(e){}
  // status colors
  let rules=s.getConditionalFormatRules().filter(r=>!r.getRanges().some(rg=>rg.getColumn()===1));
  const eq=(txt,bg,fc)=>{ let b=SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(txt).setBackground(bg); if(fc)b=b.setFontColor(fc); return b.setRanges([s.getRange(2,1,200,1)]).build(); };
  rules.push(eq('Co-lead',C_GREEN_STRONG,'#ffffff')); rules.push(eq('Core Team',C_GREEN)); rules.push(eq('Regional Team',C_BLUE)); rules.push(eq('Prospect',C_AMBER));
  s.setConditionalFormatRules(rules);
  const w=[90,90,90,200,120,180,150,170]; w.forEach((x,i)=>s.setColumnWidth(i+1,x));
}

function buildDashboard(){
  const ss=SpreadsheetApp.getActive(); let d=ss.getSheetByName(DASH); if(!d) d=ss.insertSheet(DASH);
  d.clear(); try{ d.setHiddenGridlines(true); }catch(e){}
  const M="'"+MASTER+"'!";
  const L=h=>colL(ci(h));
  const pad=r=>{ while(r.length<6) r.push(''); return r; };
  const g=[];
  g.push(pad(['📊 Northland — Dashboard']));
  g.push(pad(['']));
  g.push(pad(['REACH']));
  g.push(pad(['Contacts in region',`=COUNTA(${M}B3:B)`]));
  g.push(pad(['Attended the launch',`=COUNTIF(${M}${L('Attended Launch?')}3:${L('Attended Launch?')},"Yes")`]));
  g.push(pad(['Amplifier trained',`=COUNTIF(${M}${L('Attended/RSVPed Amp Training?')}3:${L('Attended/RSVPed Amp Training?')},"Yes")`]));
  g.push(pad(['House meeting trained',`=COUNTIF(${M}${L('Attended/RSVPed House Mtg Training?')}3:${L('Attended/RSVPed House Mtg Training?')},"Yes")`]));
  g.push(pad(['']));
  g.push(pad(['COMMITMENTS (by status)']));
  g.push(pad(['Type','Committed','Planned','Completed','Cancelled','Active']));
  let r=11;
  ['Amplifier','House Mtg','School Board','Canvass','Regional Team'].forEach(t=>{ const c=L(t);
    g.push(pad([t,`=COUNTIF(${M}${c}3:${c},"Committed")`,`=COUNTIF(${M}${c}3:${c},"Planned")`,`=COUNTIF(${M}${c}3:${c},"Completed")`,`=COUNTIF(${M}${c}3:${c},"Cancelled")`,`=B${r}+C${r}+D${r}`])); r++; });
  g.push(pad(['']));
  g.push(pad(['TEAM (tagged on contacts)']));
  const W=L('Team');
  g.push(pad(['Co-leads',`=COUNTIF(${M}${W}3:${W},"Co-lead")`]));
  g.push(pad(['Core Team',`=COUNTIF(${M}${W}3:${W},"Core Team")`]));
  g.push(pad(['Regional Team',`=COUNTIF(${M}${W}3:${W},"Regional Team")`]));
  g.push(pad(['Prospects',`=COUNTIF(${M}${W}3:${W},"Prospect")`]));
  g.push(pad(['']));
  g.push(pad(['DATA HEALTH']));
  g.push(pad(['Flagged (dupe/merge)',`=COUNTA(${M}${L('Flag (dupe / merge)')}3:${L('Flag (dupe / merge)')})`]));
  g.push(pad(['Missing school',`=COUNTA(${M}B3:B)-COUNTA(${M}${L('School')}3:${L('School')})`]));
  g.push(pad(['In "Other Northland" (needs district)',`=COUNTA('Other Northland'!B3:B)`]));
  d.getRange(1,1,g.length,6).setValues(g).setFontFamily(FONT);
  d.setColumnWidth(1,260);
  d.getRange(1,1,1,6).merge().setFontSize(16).setFontWeight('bold').setBackground(PLUM).setFontColor(GOLD); d.setRowHeight(1,40);
  [3,9,16,22].forEach(rr=> d.getRange(rr,1,1,6).merge().setFontWeight('bold').setBackground(GOLD).setFontColor(INK));
  d.getRange(10,1,1,6).setFontWeight('bold').setBackground(PLUM).setFontColor(PAPER);
}

function rebuildHowTo(){
  const ss=SpreadsheetApp.getActive(); let h=ss.getSheetByName(HOWTO); if(!h) h=ss.insertSheet(HOWTO);
  h.clear(); try{ h.setHiddenGridlines(true); }catch(e){}
  h.setColumnWidth(1,880);
  const rows=[
    ['📖 Northland regional tracker — how to use','title'],
    ['','gap'],
    ['Where you work','h'],
    ['Open YOUR district tab (NKCSD, Park Hill, Liberty, or Other Northland) and work your list there. "All Northland Contacts" is a read-only overview of every district stacked together.','p'],
    ['','gap'],
    ['What you can edit','h'],
    ['Almost everything is editable. Fixes to contact info (school, district, phone, email, zip) save back to the database. Organized By, commitment statuses, Team, Notes, and the Flag column are yours too.','p'],
    ['The only RED columns are the four Attendance fields. Those are system records from check-ins — do not edit them.','note'],
    ['','gap'],
    ['Find your name fast','h'],
    ['The Organized By dropdown is color-coded per person, so your rows are easy to spot.','p'],
    ['','gap'],
    ['Track commitments','h'],
    ['Each commitment column (Amplifier, House Mtg, School Board, Canvass, Regional Team) is a status dropdown: Committed, Planned, Completed, Cancelled. The Dashboard counts them automatically.','p'],
    ['','gap'],
    ['Found a duplicate?','h'],
    ['Use the Flag column at the end (Duplicate / Merge / Wrong person / Bad contact). Do not delete the row. A steward cleans flagged records up. Nothing is ever lost.','p'],
    ['','gap'],
    ['Sorting safely','h'],
    ['To sort just for yourself, use Data → Filter views → Create new filter view. It is private and never reorders the shared list.','p'],
  ];
  h.getRange(1,1,rows.length,1).setValues(rows.map(r=>[r[0]]));
  rows.forEach((it,i)=>{
    const c=h.getRange(i+1,1).setWrap(true).setVerticalAlignment('middle').setFontFamily(FONT);
    if(it[1]==='title'){ c.setFontSize(15).setFontWeight('bold').setFontColor(GOLD).setBackground(PLUM); h.setRowHeight(i+1,40); }
    else if(it[1]==='h'){ c.setFontSize(11).setFontWeight('bold').setFontColor(PLUM).setBackground('#EDEDEA'); h.setRowHeight(i+1,24); }
    else if(it[1]==='note'){ c.setFontSize(10).setFontColor('#9A3412').setFontWeight('bold').setBackground('#EDEDEA'); h.setRowHeight(i+1,22); }
    else if(it[1]==='gap'){ c.setBackground(GOLD); h.setRowHeight(i+1,8); }
    else { c.setFontSize(10).setFontColor(INK).setBackground('#EDEDEA'); h.setRowHeight(i+1,32); }
  });
}
