/**
 * Groundwork — REGIONAL TEAM TRACKER (model build: Northland).
 * Paste into Extensions → Apps Script, Save, run setUp() once (authorize when asked).
 *
 * One master working tab pulled live from Airtable, plus a Dashboard and read-only
 * views (Team roster, Cleanup queue, district slices). Three column tiers:
 *   RED  = system records, do not edit (attendance).
 *   PLUM = editable. Fixes to contact info (school, district, phone...) save back to
 *          the database. Commitment statuses, Team, Follow-up, Flag live in the sheet.
 *   GOLD = Organized By (the owner), with its own organizer dropdown.
 */
const KEY    = 'p4mps-rKItacZ0arZKMy12UZuRBYwJVP_LJ4iU';
const REGION = 'northland';
const FEED   = 'https://groundwork-pilot.elizabethmck.workers.dev/export/region.csv';
const PUSH   = 'https://groundwork-pilot.elizabethmck.workers.dev/sheet-region-update';
const TAB    = 'Contacts (live)';

// ---- brand ----
const FONT='Archivo';
const PLUM='#3e4f6e', GOLD='#d5b069', ROSE='#b35049', PAPER='#E9E5CE', INK='#1A2418', BAND='#EDEFF4', ALERT='#FBE48A';
const C_BLUE='#D8E6F2', C_AMBER='#FBE8B0', C_GREEN='#CDE9D5', C_GREEN_STRONG='#1F7A43', C_GREY='#E0E0E0', C_RED='#F2C9C4';

// dropdown vocabularies
const DD = {
  ORG:      ['Latrice Barnett','Sierra Kilpatrick','Ellen Glover','Holly Kaden','Bess Bailey','Synthia Larson','Emma Fortner'],
  COMMIT:   ['Committed','Planned','Completed','Cancelled'],
  TEAM:     ['Prospect','Regional Team','Core Team','Co-lead'],
  FOLLOWUP: ['Not started','In progress','Reached','1-1 booked','No response','Done'],
  FLAG:     ['Duplicate','Wrong person','Bad contact','Other'],
};

// column model. tier: data=plum editable (push=field writes back), owner=gold dropdown,
// commit/team/work/flag=plum editable sheet-managed, ro=red read-only, hide=hidden.
const COLS = [
  {h:'contact_id',       tier:'hide'},
  {h:'First',            tier:'data', push:'first'},
  {h:'Last',             tier:'data', push:'last'},
  {h:'Organized By',     tier:'owner', dd:'ORG',     preserve:true},
  {h:'Role',             tier:'data'},
  {h:'Email',            tier:'data', push:'email'},
  {h:'Phone',            tier:'data', push:'phone'},
  {h:'Address',          tier:'data', push:'address'},
  {h:'City',             tier:'data', push:'city'},
  {h:'Zip',              tier:'data', push:'zip'},
  {h:'School',           tier:'data', push:'school'},
  {h:'District',         tier:'data', push:'district'},
  {h:'County',           tier:'data'},
  {h:'Amplifier',        tier:'commit', dd:'COMMIT', preserve:true},
  {h:'House Mtg',        tier:'commit', dd:'COMMIT', preserve:true},
  {h:'School Board',     tier:'commit', dd:'COMMIT', preserve:true},
  {h:'Canvass',          tier:'commit', dd:'COMMIT', preserve:true},
  {h:'Regional Team',    tier:'commit', dd:'COMMIT', preserve:true},
  {h:'Attended Launch',  tier:'ro'},
  {h:'Amp Training',     tier:'ro'},
  {h:'HM Training',      tier:'ro'},
  {h:'GOTV RSVP',        tier:'ro'},
  {h:'Team',             tier:'team', dd:'TEAM',     preserve:true},
  {h:'Follow-up status', tier:'work', dd:'FOLLOWUP', preserve:true},
  {h:'Notes',            tier:'work', preserve:true},
  {h:'Flag',             tier:'flag', dd:'FLAG',     preserve:true},
  {h:'Flag note',        tier:'work', preserve:true},
];
const N = COLS.length, FEED_COLS = 22, HDR = 2, FIRST = 3, MAXR = 600;
const PRESERVE = COLS.map((c,i)=>c.preserve?i+1:0).filter(Boolean);   // 1-based cols kept across refresh
const PUSH_BY_COL = {}; COLS.forEach((c,i)=>{ if(c.push) PUSH_BY_COL[i+1]=c.push; });
function colL(n){ let s=''; while(n>0){ const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=(n-m-1)/26; } return s; }
const MT = "'"+TAB+"'!";
const BANNER='⚠️ LIVE from the database. RED columns are system records (do not edit). PLUM columns are yours: edits to contact info (school, district, phone, etc.) save back to the database, and commitments, Team, and Flag live here. GOLD is Organized By. Sort with Data → Filter views so you never reorder the shared list.';
const NEEDS_TAB='Needs data (live)';
const NEEDS_BANNER='⚠️ NEEDS DATA — these people attended a launch but have no school, district, or county, so they cannot be routed to a region. Fill in their School and District (it saves to the database) and they move to the right region automatically on the next refresh.';

function onOpen(){
  SpreadsheetApp.getUi().createMenu('🔄 Groundwork')
    .addItem('Refresh now','refresh')
    .addItem('Rebuild dashboard + views','rebuildExtras')
    .addItem('Re-apply branding','brandSheet')
    .addToUi();
}

function setUp(){
  const ss=SpreadsheetApp.getActive();
  buildShell(TAB, BANNER);
  buildShell(NEEDS_TAB, NEEDS_BANNER);
  ScriptApp.getProjectTriggers().forEach(t=>{const f=t.getHandlerFunction(); if(f==='refresh'||f==='onEditRegion')ScriptApp.deleteTrigger(t);});
  ScriptApp.newTrigger('refresh').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('onEditRegion').forSpreadsheet(ss).onEdit().create();
  brandSheet();
  try{ refresh(); }catch(e){}
  rebuildExtras();
  brandSheet();
  ss.toast('Northland tracker built. Red = system, plum = yours, gold = owner. Refreshes every 5 min.','Groundwork',7);
}

function buildShell(name, banner){
  const ss=SpreadsheetApp.getActive();
  let sh=ss.getSheetByName(name); if(!sh) sh=ss.insertSheet(name);
  sh.getRange(1,1,1,N).breakApart();
  // banner starts at col 4 so it never overlaps the 3 frozen columns (hidden id + First + Last)
  sh.getRange(1,4,1,N-3).merge().setValue(banner)
    .setFontFamily(FONT).setFontWeight('bold').setFontColor(INK).setBackground(ALERT)
    .setWrap(true).setVerticalAlignment('middle').setHorizontalAlignment('left');
  sh.setRowHeight(1,58);
  sh.getRange(HDR,1,1,N).setValues([COLS.map(c=>c.h)]);
  const dv=list=>SpreadsheetApp.newDataValidation().requireValueInList(list,true).setAllowInvalid(true).build();
  COLS.forEach((c,i)=>{ if(c.dd) sh.getRange(FIRST,i+1,MAXR,1).setDataValidation(dv(DD[c.dd])); });
  sh.setFrozenRows(2); sh.setFrozenColumns(3); sh.hideColumns(1);
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(p=>{if(p.getDescription()==='GW ro')p.remove();});
  COLS.forEach((c,i)=>{ if(c.tier==='ro') sh.getRange(1,i+1,sh.getMaxRows(),1).protect().setDescription('GW ro').setWarningOnly(true); });
}

function refresh(){ refreshTab(TAB,''); refreshTab(NEEDS_TAB,'needs-data'); }

function refreshTab(name, bucket){
  const sh=SpreadsheetApp.getActive().getSheetByName(name); if(!sh) return;
  const last=sh.getLastRow(), saved={};
  if(last>=FIRST){
    const all=sh.getRange(FIRST,1,last-FIRST+1,N).getValues();
    for(const row of all){
      const id=String(row[0]||'').trim(); if(!id) continue;
      const keep={}; let any=false;
      PRESERVE.forEach(p=>{ const v=row[p-1]; if(v!=='' && v!=null){ keep[p]=v; any=true; } });
      if(any) saved[id]=keep;
    }
  }
  let url=FEED+'?key='+encodeURIComponent(KEY)+'&region='+encodeURIComponent(REGION)+'&t='+Date.now();
  if(bucket) url+='&bucket='+encodeURIComponent(bucket);
  const resp=UrlFetchApp.fetch(url,{muteHttpExceptions:true});
  if(resp.getResponseCode()!==200) return;                       // abort-safe: never wipe on error
  const rows=Utilities.parseCsv(resp.getContentText());
  if(rows.length<1 || String(rows[0][1]||'').toLowerCase()!=='first') return;   // not our CSV -> never touch
  const body=rows.slice(1);
  if(!bucket && body.length<1) return;                                          // master must never wipe to empty
  if(last>=FIRST) sh.getRange(FIRST,1,last-FIRST+1,N).clearContent();           // needs-data may legitimately be 0
  if(!body.length) return;
  const out=body.map(r=>{
    const row=new Array(N).fill('');
    for(let i=0;i<FEED_COLS;i++) row[i]=r[i]||'';
    const keep=saved[String(r[0]||'').trim()];
    if(keep) PRESERVE.forEach(p=>{ if(keep[p]!==undefined && keep[p]!=='') row[p-1]=keep[p]; });
    return row;
  });
  sh.getRange(FIRST,1,out.length,N).setValues(out);
  brandRows(sh,out.length);
}

// Write data-quality edits back to Airtable (the cleanup tier).
function onEditRegion(e){
  if(!e||!e.range) return;
  const sh=e.range.getSheet(); if(sh.getName()!==TAB && sh.getName()!==NEEDS_TAB) return;
  const r0=Math.max(e.range.getRow(),FIRST), r1=e.range.getLastRow();
  const c0=e.range.getColumn(), c1=e.range.getLastColumn();
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
function brandSheet(){ brandOne(TAB); brandOne(NEEDS_TAB); }
function brandOne(name){
  const sh=SpreadsheetApp.getActive().getSheetByName(name); if(!sh) return;
  const last=Math.max(sh.getLastRow(),FIRST);
  try{ sh.getRange(1,1,sh.getMaxRows(),N).setFontFamily(FONT); }catch(e){}
  COLS.forEach((c,i)=>{
    if(c.tier==='hide') return;
    let bg=PLUM, fc=PAPER;
    if(c.tier==='owner'){ bg=GOLD; fc=INK; }
    else if(c.tier==='ro'){ bg=ROSE; fc=PAPER; }
    try{ sh.getRange(HDR,i+1).setFontWeight('bold').setBackground(bg).setFontColor(fc).setWrap(true); }catch(e){}
  });
  try{ const ex=sh.getFilter(); if(ex) ex.remove(); sh.getRange(HDR,1,Math.max(last-HDR+1,2),N).createFilter(); }catch(e){}
  try{ brandRows(sh,Math.max(last-FIRST+1,0)); }catch(e){}
  try{ styleStatuses(sh); }catch(e){}
}
function brandRows(sh,n){
  if(n<=0) return;
  const rng=sh.getRange(FIRST,1,n,N);
  rng.getBandings().forEach(b=>b.remove());
  const bd=rng.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY,false,false);
  try{ bd.setHeaderRowColor(null).setFirstRowColor('#FFFFFF').setSecondRowColor(BAND); }catch(e){}
}
function colsByTier(t){ return COLS.map((c,i)=>c.tier===t?i+1:0).filter(Boolean); }
function styleStatuses(sh){
  const maxR=sh.getMaxRows()-FIRST+1;
  const commit=colsByTier('commit'), ro=colsByTier('ro'), team=colsByTier('team')[0], flag=colsByTier('flag')[0];
  const fu=COLS.findIndex(c=>c.h==='Follow-up status')+1;
  const touched={}; [].concat(commit,ro,[team,flag,fu]).forEach(c=>touched[c]=1);
  let rules=sh.getConditionalFormatRules().filter(r=>!r.getRanges().some(rg=>touched[rg.getColumn()]));
  const eq=(col,txt,bg,fc)=>{ let b=SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(txt).setBackground(bg); if(fc)b=b.setFontColor(fc); return b.setRanges([sh.getRange(FIRST,col,maxR,1)]).build(); };
  // commitment statuses (each commit column)
  commit.forEach(col=>{
    rules.push(eq(col,'Committed',C_BLUE));
    rules.push(eq(col,'Planned',C_AMBER));
    rules.push(eq(col,'Completed',C_GREEN));
    rules.push(eq(col,'Cancelled',C_GREY));
  });
  // attendance (Yes = green)
  ro.forEach(col=> rules.push(eq(col,'Yes',C_GREEN)));
  // team
  rules.push(eq(team,'Co-lead',C_GREEN_STRONG,'#ffffff'));
  rules.push(eq(team,'Core Team',C_GREEN));
  rules.push(eq(team,'Regional Team',C_BLUE));
  rules.push(eq(team,'Prospect',C_AMBER));
  // follow-up
  rules.push(eq(fu,'Done',C_GREEN_STRONG,'#ffffff'));
  rules.push(eq(fu,'1-1 booked',C_GREEN));
  rules.push(eq(fu,'Reached',C_GREEN));
  rules.push(eq(fu,'In progress',C_AMBER));
  rules.push(eq(fu,'No response',C_RED));
  rules.push(eq(fu,'Not started',C_AMBER));
  // flag cell + whole-row tint when flagged
  const flagL=colL(flag);
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenCellNotEmpty().setBackground(C_RED).setRanges([sh.getRange(FIRST,flag,maxR,1)]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$'+flagL+FIRST+'<>""').setBackground('#FBE9E7').setRanges([sh.getRange(FIRST,1,maxR,N)]).build());
  sh.setConditionalFormatRules(rules);
}

function rebuildExtras(){ buildDashboard(); buildViews(); rebuildHowTo(); }

function buildDashboard(){
  const ss=SpreadsheetApp.getActive();
  let d=ss.getSheetByName('📊 Dashboard'); if(!d) d=ss.insertSheet('📊 Dashboard',0);
  d.clear(); try{ d.setHiddenGridlines(true); }catch(e){}
  const bar=r=>`=IF(N(C${r})=0,"",SPARKLINE(B${r},{"charttype","bar";"max",C${r};"color1","${PLUM}"}))`;
  const ci=h=>colL(COLS.findIndex(c=>c.h===h)+1);
  const C_=ci('County'); // unused guard
  const g=[];
  const pad=row=>{ while(row.length<6) row.push(''); return row; };
  g.push(pad(['📊 Northland — Dashboard']));
  g.push(pad(['']));
  g.push(pad(['REACH']));
  g.push(pad(['Metric','Count','Goal','Progress']));
  g.push(pad(['Contacts in region',`=COUNTA(${MT}B3:B)`,300,bar(5)]));
  g.push(pad(['Attended the launch',`=COUNTIF(${MT}${ci('Attended Launch')}3:${ci('Attended Launch')},"Yes")`,80,bar(6)]));
  g.push(pad(['Amplifier trained',`=COUNTIF(${MT}${ci('Amp Training')}3:${ci('Amp Training')},"Yes")`,40,bar(7)]));
  g.push(pad(['House meeting trained',`=COUNTIF(${MT}${ci('HM Training')}3:${ci('HM Training')},"Yes")`,40,bar(8)]));
  g.push(pad(['']));
  g.push(pad(['COMMITMENTS (by status)']));
  g.push(pad(['Type','Committed','Planned','Completed','Cancelled','Active']));
  const commitTypes=['Amplifier','House Mtg','School Board','Canvass','Regional Team'];
  let r=12;
  commitTypes.forEach(t=>{ const L=ci(t);
    g.push(pad([t,`=COUNTIF(${MT}${L}3:${L},"Committed")`,`=COUNTIF(${MT}${L}3:${L},"Planned")`,`=COUNTIF(${MT}${L}3:${L},"Completed")`,`=COUNTIF(${MT}${L}3:${L},"Cancelled")`,`=B${r}+C${r}+D${r}`])); r++;
  });
  g.push(pad(['']));
  g.push(pad(['TEAM']));
  const W=ci('Team');
  g.push(pad(['Co-leads',`=COUNTIF(${MT}${W}3:${W},"Co-lead")`]));
  g.push(pad(['Core Team',`=COUNTIF(${MT}${W}3:${W},"Core Team")`]));
  g.push(pad(['Regional Team',`=COUNTIF(${MT}${W}3:${W},"Regional Team")`]));
  g.push(pad(['Prospects',`=COUNTIF(${MT}${W}3:${W},"Prospect")`]));
  g.push(pad(['']));
  g.push(pad(['DATA HEALTH']));
  g.push(pad(['Flagged for cleanup',`=COUNTA(${MT}${ci('Flag')}3:${ci('Flag')})`]));
  g.push(pad(['Missing school',`=COUNTA(${MT}B3:B)-COUNTA(${MT}${ci('School')}3:${ci('School')})`]));
  g.push(pad(['Missing district',`=COUNTA(${MT}B3:B)-COUNTA(${MT}${ci('District')}3:${ci('District')})`]));
  d.getRange(1,1,g.length,6).setValues(g).setFontFamily(FONT);
  d.setColumnWidth(1,210);
  // styling
  d.getRange(1,1,1,6).merge().setFontSize(16).setFontWeight('bold').setBackground(PLUM).setFontColor(GOLD); d.setRowHeight(1,40);
  [3,10,18,24].forEach(rr=> d.getRange(rr,1,1,6).merge().setFontWeight('bold').setBackground(GOLD).setFontColor(INK));
  [4,11].forEach(rr=> d.getRange(rr,1,1,6).setFontWeight('bold').setBackground(PLUM).setFontColor(PAPER));
  d.getRange(1,1).activate();
}

function buildViews(){
  const ss=SpreadsheetApp.getActive();
  const view=(name,title,heads,arrCols,cond,empty)=>{
    let v=ss.getSheetByName(name); if(!v) v=ss.insertSheet(name); v.clear();
    try{ v.setHiddenGridlines(true); }catch(e){}
    v.getRange(1,1,1,heads.length).merge().setValue(title).setFontFamily(FONT).setFontWeight('bold').setBackground(GOLD).setFontColor(INK).setWrap(true);
    v.setRowHeight(1,30);
    v.getRange(2,1,1,heads.length).setValues([heads]).setFontFamily(FONT).setFontWeight('bold').setBackground(PLUM).setFontColor(PAPER);
    const arr='{'+arrCols.map(c=>`${MT}${c}3:${c}`).join(',')+'}';
    v.getRange(3,1).setFormula(`=IFERROR(FILTER(${arr}, ${cond}), "${empty}")`);
    v.setFrozenRows(2);
    heads.forEach((_,i)=> v.setColumnWidth(i+1, i<2?110:160));
  };
  const L=h=>colL(COLS.findIndex(c=>c.h===h)+1);
  view('Team roster (view)','Team roster — VIEW ONLY. Work in the Contacts (live) tab.',
    ['First','Last','Organized By','Role','School','District','Team','Follow-up'],
    [L('First'),L('Last'),L('Organized By'),L('Role'),L('School'),L('District'),L('Team'),L('Follow-up status')],
    `${MT}${L('Team')}3:${L('Team')}<>""`,'No one is on a team yet.');
  view('Cleanup queue (view)','Cleanup queue — flagged duplicates and bad records. A steward resolves these.',
    ['First','Last','Organized By','Email','Phone','District','Flag','Flag note'],
    [L('First'),L('Last'),L('Organized By'),L('Email'),L('Phone'),L('District'),L('Flag'),L('Flag note')],
    `${MT}${L('Flag')}3:${L('Flag')}<>""`,'No duplicates flagged.');
  const distHeads=['First','Last','Organized By','School','District','Amplifier','House Mtg','Team','Follow-up'];
  const distCols=[L('First'),L('Last'),L('Organized By'),L('School'),L('District'),L('Amplifier'),L('House Mtg'),L('Team'),L('Follow-up status')];
  const distL=L('District');
  view('NKCSD (view)','North Kansas City — VIEW ONLY (filtered by district). Work in Contacts (live).',
    distHeads,distCols,`REGEXMATCH(${MT}${distL}3:${distL},"(?i)nkc|north kansas city")`,'No one yet.');
  view('Park Hill (view)','Park Hill — VIEW ONLY (filtered by district). Work in Contacts (live).',
    distHeads,distCols,`REGEXMATCH(${MT}${distL}3:${distL},"(?i)park ?hill")`,'No one yet.');
  view('Liberty (view)','Liberty — VIEW ONLY (filtered by district). Work in Contacts (live).',
    distHeads,distCols,`REGEXMATCH(${MT}${distL}3:${distL},"(?i)liberty")`,'No one yet.');
}

function rebuildHowTo(){
  const ss=SpreadsheetApp.getActive();
  let h=ss.getSheetByName('📖 How to use'); if(!h) h=ss.insertSheet('📖 How to use',0);
  h.clear(); try{ h.setHiddenGridlines(true); }catch(e){}
  h.setColumnWidth(1,880);
  const rows=[
    ['📖 Northland regional tracker — how to use','title'],
    ['','gap'],
    ['The colors tell you what each column is','h'],
    ['RED columns are system records (attendance). Do not edit them.','note'],
    ['PLUM columns are yours. Fixes to contact info (school, district, phone, email, zip) save straight back to the database. Commitment statuses, Team, Follow-up, Notes, and Flag live in the sheet.','p'],
    ['GOLD is Organized By, the person responsible for that contact. Pick from the organizer dropdown.','p'],
    ['','gap'],
    ['Clean the data as you go','h'],
    ['When you learn someone\'s real school or district, just fix the cell. Use the dropdowns where they exist so spellings stay consistent. Your fix updates the database and reflows them to the right place.','p'],
    ['','gap'],
    ['Track commitments by status','h'],
    ['Each commitment column (Amplifier, House Mtg, School Board, Canvass, Regional Team) is a dropdown: Committed, Planned, Completed, Cancelled. The Dashboard counts these automatically.','p'],
    ['','gap'],
    ['Team building','h'],
    ['Use the Team column (Prospect, Regional Team, Core Team, Co-lead) to track who is stepping up. The "Team roster" tab is a live view of everyone with a Team value, so there is no separate roster to maintain.','p'],
    ['','gap'],
    ['Flag a duplicate or bad record','h'],
    ['Set the Flag column (Duplicate, Wrong person, Bad contact, Other) and add a note. Do NOT delete the row. Flagged records collect in the "Cleanup queue" tab, and a steward merges or fixes them. Nothing is ever deleted, so it is always recoverable.','p'],
    ['','gap'],
    ['Sort and filter safely','h'],
    ['To sort or filter for yourself, use Data → Filter views → Create new filter view. It is private and never reorders the shared list. The district tabs (NKCSD, Park Hill, Liberty) are read-only views of this same data.','p'],
    ['','gap'],
    ['This is the model','h'],
    ['Once this looks right, we clone it for every region. District tabs that grow a real team and lead can graduate from a view into their own editable tab.','p'],
  ];
  h.getRange(1,1,rows.length,1).setValues(rows.map(r=>[r[0]]));
  rows.forEach((it,i)=>{
    const c=h.getRange(i+1,1).setWrap(true).setVerticalAlignment('middle').setFontFamily(FONT);
    if(it[1]==='title'){ c.setFontSize(15).setFontWeight('bold').setFontColor(GOLD).setBackground(PLUM); h.setRowHeight(i+1,40); }
    else if(it[1]==='h'){ c.setFontSize(11).setFontWeight('bold').setFontColor(PLUM).setBackground('#EDEDEA'); h.setRowHeight(i+1,24); }
    else if(it[1]==='note'){ c.setFontSize(10).setFontColor('#9A3412').setFontWeight('bold').setBackground('#EDEDEA'); h.setRowHeight(i+1,22); }
    else if(it[1]==='gap'){ c.setBackground(GOLD); h.setRowHeight(i+1,8); }
    else { c.setFontSize(10).setFontColor(INK).setBackground('#EDEDEA'); h.setRowHeight(i+1,34); }
  });
  h.activate(); SpreadsheetApp.flush();
}
