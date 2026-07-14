/**
 * Groundwork — COMMITMENTS tracker add-on (v2).
 * Paste as a file in a spreadsheet's bound Apps Script project, set CT_TABS
 * for that sheet (two ready-made configs below), Save, run ctSetUp once.
 *
 * Feed tabs come from /export/commitments.csv:
 *   bucket=commits        → people with ≥1 REAL commitment. The worker derives
 *                           Completed from actual work (logged amplifier
 *                           conversations, hosted house meetings).
 *   bucket=votereminders  → everyone who asked for a vote reminder (GOTV list)
 *   region=kc|northland|… → only people who route to that region
 *
 * Sheet-side lifecycle: the five commitment columns are dropdowns
 * (Committed / Planned / Completed / Cancelled). The feed seeds them; your
 * manual upgrades WIN on refresh (except a DB-derived Completed beats a stale
 * Committed). Organized By is a dropdown of live organizers, color-chipped,
 * and manual assignments survive refresh. A 'Goals' tab shows commitments by
 * type and an organizer leaderboard with % converted, RAG-colored.
 *
 * Every name is ct-prefixed: safe to paste alongside a region tracker's
 * existing script (shared global namespace, zero collisions).
 */

// ==== PER-SHEET CONFIG — keep exactly one CT_TABS ==========================
// ALL-commitments tracker (statewide): Goals tab + two feed tabs.
const CT_GOALS = true;   // build the Goals tab (position 1)
const CT_TABS = [
  { name: 'Commitments', pos: 2, params: 'bucket=commits', color: '#2F5E3D', fontColor: '#FFFFFF',
    banner: 'EVERYONE WITH A REAL COMMITMENT, statewide (vote-reminder-only folks live on the next tab) — auto-refreshes. Commitment columns are dropdowns: your upgrades (Completed / Cancelled…) stick. The PLUM columns are YOURS too. Add new commitments via the 🗳 Commitments menu.' },
  { name: 'Vote reminders', pos: 3, params: 'bucket=votereminders', color: '#3E4F6E', fontColor: '#FFFFFF',
    banner: 'EVERYONE WHO ASKED FOR A VOTE REMINDER, statewide (the GOTV list; some also appear on the Commitments tab) — auto-refreshes. The PLUM columns are YOURS and survive every refresh.' },
];
// Kansas City tracker (single tab, 3rd position, no Goals) — use instead:
// const CT_GOALS = false;
// const CT_TABS = [
//   { name: 'Commitments', pos: 3, params: 'region=kc&bucket=commits', color: '#2F5E3D', fontColor: '#FFFFFF',
//     banner: '👁️ ROLLUP of every KC commitment, pulled from the database: web forms, S2W texts, amplifier + house-meeting logs. READ-ONLY — do your work in your school tab; this updates on its own. Two exceptions: the PLUM columns are yours, and ➕ Add a commitment in the 🗳 menu logs new commitments properly.' },
// ];
// ===========================================================================

const CT_KEY    = 'p4mps-rKItacZ0arZKMy12UZuRBYwJVP_LJ4iU';
const CT_WORKER = 'https://groundwork-pilot.elizabethmck.workers.dev';
const CT_HDR    = 2, CT_FIRST = 3, CT_MAXR = 1000;   // banner row 1, header row 2, data 3..1000

// Feed columns, in feed order (contact_id first). Manual columns appended after.
const CT_FEED_COLS = ['contact_id','First','Last','Region','Organized By','Role','Email','Phone','School','District','County',
  'Amplifier','House Mtg','School Board','Canvass','Regional Team','Other commitments','Latest commitment',
  'Attended Launch','Amp Training','HM Training','Attended Power Camp'];
const CT_MANUAL = ['Claimed by','Follow-up status','Notes'];
const CT_STATUS = ['Not started','Texted','Called','Left message','1-1 booked','Done','No answer','Declined'];
const CT_COMMIT_STATUSES = ['Committed','Planned','Completed','Cancelled'];
const CT_N_FEED = CT_FEED_COLS.length;            // 22
const CT_ORG_COL = 5;                             // E = Organized By
const CT_C_START = 12, CT_C_END = 16;             // L..P = the five commitment columns
const CT_M_START = CT_N_FEED + 1;                 // 23 = first manual col (W)
const CT_TOTAL = CT_N_FEED + CT_MANUAL.length;    // 25 (Y)

// brand
const CT_FONT='Archivo', CT_INK='#1A2418', CT_GOLD='#D5B069', CT_BAND='#F3F4F6';
const CT_COMMIT_BLUE='#6FA8DC', CT_PLANNED_AMBER='#FBE8B0', CT_DONE_GREEN='#1F7A43', CT_CANC_GREY='#E0E0E0';
const CT_YES_GREEN='#CDE9D5', CT_ALERT='#FBE48A', CT_RAG_RED='#F2C9C4', CT_RAG_AMBER='#FBE8B0', CT_RAG_GREEN='#CDE9D5';
// organizer chip palette, assigned cyclically in feed order
const CT_ORG_PALETTE = ['#FFCFC9','#FFE5A0','#FFF8B8','#D4EDBC','#BFE1F6','#C6DBE1','#E6CFF2','#FFC8AA','#F2C0D5','#D9D2E9',
  '#B7E1CD','#FCE8B2','#F6C7B6','#CFE2F3','#D9EAD3','#EAD1DC','#FFF2CC','#D0E0E3','#F4CCCC','#E8EAED'];

function ctSetUp(){
  const orgs = ctFetchOrganizers();
  CT_TABS.forEach(cfg => ctBuildTab(cfg, orgs));
  ctRefresh();
  if (CT_GOALS) ctBuildGoals();
  // drop the blank default sheet if this is a fresh spreadsheet
  try {
    const ss = SpreadsheetApp.getActive();
    const s1 = ss.getSheetByName('Sheet1');
    if (s1 && ss.getSheets().length > CT_TABS.length && s1.getDataRange().isBlank()) ss.deleteSheet(s1);
  } catch(e) {}
  // installable triggers: refresh every 10 min + our own menu on open
  ScriptApp.getProjectTriggers().forEach(t => {
    const fn = t.getHandlerFunction();
    if (fn === 'ctRefresh' || fn === 'ctOnOpen') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('ctRefresh').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('ctOnOpen').forSpreadsheet(SpreadsheetApp.getActive()).onOpen().create();
  ctOnOpen();
}

function ctOnOpen(){
  SpreadsheetApp.getUi().createMenu('🗳 Commitments')
    .addItem('➕ Add a commitment', 'ctShowAddDialog')
    .addItem('🔄 Refresh now', 'ctRefresh')
    .addToUi();
}

function ctFetchOrganizers(){
  try {
    const resp = UrlFetchApp.fetch(CT_WORKER + '/export/organizers.csv?key=' + encodeURIComponent(CT_KEY), {muteHttpExceptions:true});
    if (resp.getResponseCode() !== 200) return [];
    return Utilities.parseCsv(resp.getContentText()).slice(1).map(r => String(r[0]||'').trim()).filter(Boolean);
  } catch(e) { return []; }
}

function ctBuildTab(cfg, orgs){
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(cfg.name);
  if (!sh){ sh = ss.insertSheet(cfg.name, Math.min(cfg.pos - 1, ss.getSheets().length)); }
  ss.setActiveSheet(sh);
  ss.moveActiveSheet(Math.min(cfg.pos, ss.getSheets().length));   // clamp: later tabs (Goals) may not exist yet
  // banner — A1:C1 stay OUT of the merge: Sheets refuses frozen columns that
  // cut through a merged cell, and we freeze 3 columns below.
  sh.getRange(1,1,1,CT_TOTAL).breakApart();
  sh.getRange(1,1,1,CT_TOTAL).setBackground(cfg.color);
  sh.getRange(1,1).setValue('🗳 ' + cfg.name.toUpperCase())
    .setFontFamily(CT_FONT).setFontWeight('bold').setFontSize(11).setFontColor(cfg.fontColor).setVerticalAlignment('middle');
  sh.getRange(1,4,1,CT_TOTAL-3).merge().setValue(cfg.banner)
    .setFontFamily(CT_FONT).setFontSize(10).setFontColor(cfg.fontColor).setBackground(cfg.color).setWrap(true).setVerticalAlignment('middle');
  sh.setRowHeight(1, 44);
  // header row in the tab's own color (lightened font stays readable)
  sh.getRange(CT_HDR,1,1,CT_N_FEED).setValues([CT_FEED_COLS])
    .setFontFamily(CT_FONT).setFontWeight('bold').setFontColor(cfg.fontColor).setBackground(cfg.color);
  sh.getRange(CT_HDR,CT_M_START,1,CT_MANUAL.length).setValues([CT_MANUAL])
    .setFontFamily(CT_FONT).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#5B3A6E');
  sh.setFrozenRows(CT_HDR); sh.setFrozenColumns(3);
  sh.hideColumns(1);                                    // contact_id
  const widths = {2:90,3:110,4:150,5:150,6:90,7:190,8:110,9:150,10:180,11:130,12:96,13:96,14:96,15:90,16:104,17:230,18:120,19:110,20:96,21:92,22:130,23:120,24:130,25:220};
  Object.keys(widths).forEach(c => sh.setColumnWidth(Number(c), widths[c]));
  // dropdowns: commitment lifecycle, follow-up status, organizer
  const nRows = CT_MAXR - CT_FIRST + 1;
  const commitRule = SpreadsheetApp.newDataValidation().requireValueInList(CT_COMMIT_STATUSES, true).setAllowInvalid(true).build();
  sh.getRange(CT_FIRST, CT_C_START, nRows, CT_C_END - CT_C_START + 1).setDataValidation(commitRule);
  const statusRule = SpreadsheetApp.newDataValidation().requireValueInList(CT_STATUS, true).setAllowInvalid(true).build();
  sh.getRange(CT_FIRST, CT_M_START+1, nRows, 1).setDataValidation(statusRule);
  if (orgs && orgs.length){
    const orgRule = SpreadsheetApp.newDataValidation().requireValueInList(orgs, true).setAllowInvalid(true).build();
    sh.getRange(CT_FIRST, CT_ORG_COL, nRows, 1).setDataValidation(orgRule);
  }
  // ALL cell colors as conditional-format rules, so dropdown changes recolor live
  const rules = [];
  const commitRange = sh.getRange(CT_FIRST, CT_C_START, nRows, CT_C_END - CT_C_START + 1);
  const mk = (val, bg, fc, strike) => {
    let b = SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(val).setBackground(bg).setRanges([commitRange]);
    if (fc) b = b.setFontColor(fc);
    if (strike) b = b.setStrikethrough(true);
    return b.build();
  };
  rules.push(mk('Committed', CT_COMMIT_BLUE, CT_INK));
  rules.push(mk('Planned', CT_PLANNED_AMBER, CT_INK));
  rules.push(mk('Completed', CT_DONE_GREEN, '#FFFFFF'));
  rules.push(mk('Cancelled', CT_CANC_GREY, '#666666', true));
  const yesRange = sh.getRange(CT_FIRST, 19, nRows, 4);   // S..V attendance flags
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Yes').setBackground(CT_YES_GREEN).setRanges([yesRange]).build());
  const regRange = sh.getRange(CT_FIRST, 4, nRows, 1);
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('(unrouted)').setBackground(CT_ALERT).setRanges([regRange]).build());
  // organizer chips — one color per person, cycled through the palette
  const orgRange = sh.getRange(CT_FIRST, CT_ORG_COL, nRows, 1);
  (orgs || []).forEach((nm, i) => {
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(nm)
      .setBackground(CT_ORG_PALETTE[i % CT_ORG_PALETTE.length]).setRanges([orgRange]).build());
  });
  sh.setConditionalFormatRules(rules);
  if (!sh.getFilter()) sh.getRange(CT_HDR,1,CT_MAXR-CT_HDR+1,CT_TOTAL).createFilter();
}

// Abort-safe refresh: NEVER clears a tab unless a valid non-empty feed is
// confirmed. Preserved across refresh, keyed on contact_id:
//   · manual columns (Claimed by / Follow-up status / Notes) — always yours
//   · Organized By — your value wins over the feed when set
//   · commitment cells — your value wins, EXCEPT a feed 'Completed' upgrades
//     a stale 'Committed' (the DB saw them actually do the work)
function ctRefresh(){
  const ss = SpreadsheetApp.getActive();
  CT_TABS.forEach(cfg => {
    const sh = ss.getSheetByName(cfg.name); if (!sh) return;
    const resp = UrlFetchApp.fetch(CT_WORKER + '/export/commitments.csv?key=' + encodeURIComponent(CT_KEY) + '&' + cfg.params + '&t=' + Date.now(), {muteHttpExceptions:true});
    if (resp.getResponseCode() !== 200) return;
    const rows = Utilities.parseCsv(resp.getContentText());
    if (rows.length < 2) return;
    if (String(rows[0][0]).trim().toLowerCase() !== 'contact_id') return;
    const last = sh.getLastRow(), byId = {};
    if (last >= CT_FIRST){
      const n = last - CT_FIRST + 1;
      const ids = sh.getRange(CT_FIRST,1,n,1).getValues();
      const org = sh.getRange(CT_FIRST,CT_ORG_COL,n,1).getValues();
      const com = sh.getRange(CT_FIRST,CT_C_START,n,CT_C_END-CT_C_START+1).getValues();
      const man = sh.getRange(CT_FIRST,CT_M_START,n,CT_MANUAL.length).getValues();
      for (let i=0;i<n;i++){
        const id=String(ids[i][0]||'').trim(); if (!id) continue;
        byId[id]={ org:String(org[i][0]||'').trim(), com:com[i].map(v=>String(v||'').trim()), man:man[i] };
      }
    }
    const body = rows.slice(1).map(r => { const o=r.slice(0,CT_N_FEED); while (o.length<CT_N_FEED) o.push(''); return o; });
    if (last >= CT_FIRST) sh.getRange(CT_FIRST,1,last-CT_FIRST+1,CT_TOTAL).clearContent();
    const merged = body.map(r => {
      const prev = byId[String(r[0]||'').trim()];
      if (prev){
        if (prev.org) r[CT_ORG_COL-1] = prev.org;
        for (let k=0;k<prev.com.length;k++){
          const cell = prev.com[k], feed = String(r[CT_C_START-1+k]||'').trim();
          if (!cell) continue;                                   // no manual value → feed stands
          r[CT_C_START-1+k] = (feed === 'Completed' && cell === 'Committed') ? 'Completed' : cell;
        }
      }
      return r;
    });
    sh.getRange(CT_FIRST,1,merged.length,CT_N_FEED).setValues(merged);
    const man = merged.map(r => (byId[String(r[0]||'').trim()] || {man:new Array(CT_MANUAL.length).fill('')}).man);
    sh.getRange(CT_FIRST,CT_M_START,merged.length,CT_MANUAL.length).setValues(man);
    ctBrand(sh, merged.length);
  });
}

function ctBrand(sh, n){
  if (n < 1) return;
  sh.getRange(CT_FIRST,1,n,CT_TOTAL).setFontFamily(CT_FONT).setFontSize(10).setVerticalAlignment('middle');
  const bands = [];
  for (let i=0;i<n;i++) bands.push([(i%2) ? CT_BAND : '#FFFFFF']);
  for (let c=1;c<=CT_TOTAL;c++) sh.getRange(CT_FIRST,c,n,1).setBackgrounds(bands);
  // cell-value colors (statuses, chips, flags) are conditional-format rules set at build time
}

// ---------- Goals tab: commitments by type + organizer leaderboard ----------
function ctBuildGoals(){
  const ss = SpreadsheetApp.getActive();
  const NAME = 'Goals';
  let sh = ss.getSheetByName(NAME);
  if (!sh){ sh = ss.insertSheet(NAME, 0); }
  ss.setActiveSheet(sh); ss.moveActiveSheet(1);
  sh.clear();
  const W = 8;
  sh.getRange(1,1,1,W).merge().setValue('🎯 GOALS — live from the Commitments tab: flip a dropdown there and these numbers move. % converted = Completed ÷ (Completed + still open). Red = needs follow-up.')
    .setFontFamily(CT_FONT).setFontSize(10).setFontColor(CT_INK).setBackground(CT_GOLD).setWrap(true).setVerticalAlignment('middle');
  sh.setRowHeight(1, 40);
  // BY TYPE
  sh.getRange(3,1).setValue('BY TYPE').setFontFamily(CT_FONT).setFontWeight('bold').setFontSize(12);
  const th = ['Type','Committed','Planned','Completed','Cancelled','Total','Still open','% converted'];
  sh.getRange(4,1,1,8).setValues([th]).setFontFamily(CT_FONT).setFontWeight('bold').setFontColor('#FFFFFF').setBackground(CT_INK);
  const types = [['Amplifier','L'],['House Mtg','M'],['School Board','N'],['Canvass','O'],['Regional Team','P']];
  types.forEach((t, i) => {
    const r = 5 + i, L = t[1];
    sh.getRange(r,1).setValue(t[0]);
    sh.getRange(r,2).setFormula(`=COUNTIF(Commitments!${L}$3:${L}$${CT_MAXR},"Committed")`);
    sh.getRange(r,3).setFormula(`=COUNTIF(Commitments!${L}$3:${L}$${CT_MAXR},"Planned")`);
    sh.getRange(r,4).setFormula(`=COUNTIF(Commitments!${L}$3:${L}$${CT_MAXR},"Completed")`);
    sh.getRange(r,5).setFormula(`=COUNTIF(Commitments!${L}$3:${L}$${CT_MAXR},"Cancelled")`);
    sh.getRange(r,6).setFormula(`=SUM(B${r}:E${r})`);
    sh.getRange(r,7).setFormula(`=B${r}+C${r}`);
    sh.getRange(r,8).setFormula(`=IFERROR(D${r}/(D${r}+G${r}),"")`);
  });
  sh.getRange(10,1).setValue('TOTAL').setFontWeight('bold');
  ['B','C','D','E','F','G'].forEach(col => sh.getRange(`${col}10`).setFormula(`=SUM(${col}5:${col}9)`).setFontWeight('bold'));
  sh.getRange('H10').setFormula('=IFERROR(D10/(D10+G10),"")').setFontWeight('bold');
  sh.getRange(11,1,1,2).setValues([['Commits with no organizer','']]).setFontStyle('italic');
  sh.getRange('B11').setFormula(`=SUMPRODUCT((Commitments!$B$3:$B$${CT_MAXR}<>"")*(Commitments!$E$3:$E$${CT_MAXR}="")*(Commitments!$L$3:$P$${CT_MAXR}<>""))`).setFontStyle('italic');
  // BY ORGANIZER
  sh.getRange(13,1).setValue('BY ORGANIZER — leaderboard').setFontFamily(CT_FONT).setFontWeight('bold').setFontSize(12);
  sh.getRange(14,1,1,5).setValues([['Organizer','Commits','Still open','Completed','% converted']])
    .setFontFamily(CT_FONT).setFontWeight('bold').setFontColor('#FFFFFF').setBackground(CT_INK);
  sh.getRange('A15').setFormula(`=IFERROR(SORT(UNIQUE(FILTER(Commitments!$E$3:$E$${CT_MAXR},Commitments!$E$3:$E$${CT_MAXR}<>""))),)`);
  for (let r = 15; r <= 60; r++){
    sh.getRange(r,2).setFormula(`=IF($A${r}="","",SUMPRODUCT((Commitments!$E$3:$E$${CT_MAXR}=$A${r})*(Commitments!$L$3:$P$${CT_MAXR}<>"")))`);
    sh.getRange(r,3).setFormula(`=IF($A${r}="","",SUMPRODUCT((Commitments!$E$3:$E$${CT_MAXR}=$A${r})*((Commitments!$L$3:$P$${CT_MAXR}="Committed")+(Commitments!$L$3:$P$${CT_MAXR}="Planned"))))`);
    sh.getRange(r,4).setFormula(`=IF($A${r}="","",SUMPRODUCT((Commitments!$E$3:$E$${CT_MAXR}=$A${r})*(Commitments!$L$3:$P$${CT_MAXR}="Completed")))`);
    sh.getRange(r,5).setFormula(`=IF($A${r}="","",IF(B${r}=0,"",IFERROR(D${r}/(D${r}+C${r}),"")))`);
  }
  // formats
  sh.getRange('H5:H10').setNumberFormat('0%');
  sh.getRange('E15:E60').setNumberFormat('0%');
  sh.getRange(1,1,60,W).setFontFamily(CT_FONT);
  [180,110,100,110,100,90,100,120].forEach((w,i)=>sh.setColumnWidth(i+1,w));
  sh.setFrozenRows(1);
  // RAG conditional formatting on both % columns: red <25%, amber <60%, green ≥60%
  const rag = [sh.getRange('H5:H10'), sh.getRange('E15:E60')];
  const rules = [
    SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0.25).setBackground(CT_RAG_RED).setRanges(rag).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberBetween(0.25, 0.5999).setBackground(CT_RAG_AMBER).setRanges(rag).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(0.6).setBackground(CT_RAG_GREEN).setRanges(rag).build(),
  ];
  sh.setConditionalFormatRules(rules);
}

// ---------- Add-a-commitment dialog ----------
function ctShowAddDialog(){
  const html = HtmlService.createHtmlOutput(CT_DIALOG_HTML).setWidth(430).setHeight(560);
  SpreadsheetApp.getUi().showModalDialog(html, 'Add a commitment');
}

// server calls from the dialog
function ctSearch(q){
  const resp = UrlFetchApp.fetch(CT_WORKER + '/contact-search?key=' + encodeURIComponent(CT_KEY) + '&q=' + encodeURIComponent(q), {muteHttpExceptions:true});
  if (resp.getResponseCode() !== 200) throw new Error('search failed (' + resp.getResponseCode() + ')');
  return JSON.parse(resp.getContentText());
}
function ctSubmit(payload){
  payload.key = CT_KEY;
  payload.sheet = SpreadsheetApp.getActive().getName() + ' tracker';
  const resp = UrlFetchApp.fetch(CT_WORKER + '/commit-add', {
    method:'post', contentType:'application/json', payload: JSON.stringify(payload), muteHttpExceptions:true });
  const body = JSON.parse(resp.getContentText() || '{}');
  if (resp.getResponseCode() !== 200) throw new Error(body.error || ('save failed (' + resp.getResponseCode() + ')'));
  try { ctRefresh(); } catch(e) {}
  return body;
}

const CT_DIALOG_HTML = `
<style>
  body{font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#1A2418;margin:12px}
  h3{margin:0 0 2px;font-size:15px} .sub{color:#666;font-size:11px;margin:0 0 10px}
  input[type=text]{width:100%;box-sizing:border-box;padding:8px;border:1.5px solid #999;border-radius:6px;font-size:13px}
  .match{padding:7px 9px;border:1px solid #ccc;border-radius:6px;margin:5px 0;cursor:pointer}
  .match:hover{background:#eef3fa;border-color:#3e4f6e}
  .match b{font-size:13px} .match .meta{color:#666;font-size:11px}
  .badge{display:inline-block;background:#6FA8DC;color:#fff;border-radius:8px;padding:0 6px;font-size:10px;margin-left:6px}
  .sel{background:#E7F0E9;border:1.5px solid #38761D;border-radius:6px;padding:8px 10px;margin:8px 0}
  label.ck{display:block;margin:4px 0;font-size:13px}
  .row{display:flex;gap:8px} .row>div{flex:1}
  .btn{background:#3e4f6e;color:#fff;border:0;border-radius:6px;padding:10px 16px;font-size:13px;cursor:pointer;width:100%;margin-top:10px}
  .btn:disabled{opacity:.5} .lnk{color:#b35049;font-size:12px;cursor:pointer;text-decoration:underline}
  .ok{background:#E7F0E9;border:1.5px solid #38761D;border-radius:6px;padding:10px;margin-top:10px;font-size:13px}
  .err{color:#b30000;font-size:12px;margin-top:6px;min-height:14px}
  .hint{color:#666;font-size:11px;margin-top:4px}
  fieldset{border:1px solid #ccc;border-radius:6px;margin:10px 0 0;padding:8px}
  legend{font-size:12px;color:#444;padding:0 4px}
</style>
<h3>Who made the commitment?</h3>
<p class="sub">Search first — most people are already in the database.</p>
<input type="text" id="q" placeholder="Type a name or email (2+ letters)…" autocomplete="off">
<div id="matches"></div>
<div id="noneRow" style="display:none"><span class="lnk" onclick="showNew()">Not found → add a new person</span></div>
<div id="newFields" style="display:none">
  <fieldset><legend>New person (only if truly not in the search)</legend>
    <div class="row"><div><input type="text" id="nf" placeholder="First *"></div><div><input type="text" id="nl" placeholder="Last *"></div></div>
    <div class="row" style="margin-top:6px"><div><input type="text" id="np" placeholder="Phone (or email)"></div><div><input type="text" id="ne" placeholder="Email (or phone)"></div></div>
    <div class="row" style="margin-top:6px"><div><input type="text" id="nz" placeholder="Zip"></div><div><input type="text" id="ns" placeholder="School"></div></div>
  </fieldset>
</div>
<div id="selBox" style="display:none" class="sel"></div>
<div id="commitBox" style="display:none">
  <fieldset><legend>They committed to…</legend>
    <label class="ck"><input type="checkbox" value="Amplifier"> Amplifier</label>
    <label class="ck"><input type="checkbox" value="House Meeting"> House meeting (host)</label>
    <label class="ck"><input type="checkbox" value="School Board"> School board</label>
    <label class="ck"><input type="checkbox" value="Canvass"> Canvass</label>
    <label class="ck"><input type="checkbox" value="Regional Team"> Regional team</label>
    <input type="text" id="other" placeholder="Other commitment (free text)" style="margin-top:6px">
  </fieldset>
  <input type="text" id="note" placeholder="Note (optional)" style="margin-top:8px">
  <input type="text" id="who" placeholder="Your name (who's logging this)" style="margin-top:8px">
  <button class="btn" id="go" onclick="submit()">Save commitment</button>
</div>
<div class="err" id="err"></div>
<div id="done" style="display:none" class="ok"></div>
<script>
  var picked=null, isNew=false, t=null;
  var q=document.getElementById('q');
  q.addEventListener('input', function(){
    clearTimeout(t); var v=q.value.trim();
    if (v.length<2){ document.getElementById('matches').innerHTML=''; document.getElementById('noneRow').style.display='none'; return; }
    t=setTimeout(function(){ google.script.run.withSuccessHandler(render).withFailureHandler(fail).ctSearch(v); }, 350);
  });
  try { document.getElementById('who').value = localStorage.getItem('ct_who')||''; } catch(e){}
  function render(d){
    var m=document.getElementById('matches'); m.innerHTML='';
    (d.matches||[]).forEach(function(x){
      var div=document.createElement('div'); div.className='match';
      div.innerHTML='<b>'+esc(x.name)+'</b>'+(x.has_commitments?'<span class="badge">has commitments</span>':'')+
        '<div class="meta">'+esc([x.school||x.district, x.city, x.region].filter(Boolean).join(' · '))+
        (x.phone?' · '+esc(x.phone):'')+'</div>';
      div.onclick=function(){ pick(x); };
      m.appendChild(div);
    });
    document.getElementById('noneRow').style.display='block';
    if (!(d.matches||[]).length) m.innerHTML='<div class="hint">No matches.</div>';
  }
  function pick(x){
    picked=x; isNew=false;
    document.getElementById('matches').innerHTML=''; document.getElementById('newFields').style.display='none';
    document.getElementById('noneRow').style.display='none';
    var s=document.getElementById('selBox'); s.style.display='block';
    s.innerHTML='<b>'+esc(x.name)+'</b> — '+esc([x.school||x.district,x.region].filter(Boolean).join(' · '))+
      ' <span class="lnk" onclick="reset()">change</span>';
    document.getElementById('commitBox').style.display='block';
  }
  function showNew(){
    isNew=true; picked=null;
    document.getElementById('newFields').style.display='block';
    document.getElementById('selBox').style.display='none';
    document.getElementById('commitBox').style.display='block';
  }
  function reset(){
    picked=null; isNew=false;
    document.getElementById('selBox').style.display='none';
    document.getElementById('commitBox').style.display='none';
    document.getElementById('newFields').style.display='none';
    q.value=''; q.focus();
  }
  function submit(){
    var err=document.getElementById('err'); err.textContent='';
    var cs=[]; document.querySelectorAll('#commitBox input[type=checkbox]:checked').forEach(function(c){ cs.push(c.value); });
    var other=document.getElementById('other').value.trim();
    if (!cs.length && !other){ err.textContent='Tick at least one commitment (or fill Other).'; return; }
    var p={ commitments:cs, other:other, note:document.getElementById('note').value.trim(), logged_by:document.getElementById('who').value.trim() };
    try { localStorage.setItem('ct_who', p.logged_by); } catch(e){}
    if (picked){ p.contact_id=picked.id; }
    else if (isNew){
      p.first=document.getElementById('nf').value.trim(); p.last=document.getElementById('nl').value.trim();
      p.phone=document.getElementById('np').value.trim(); p.email=document.getElementById('ne').value.trim();
      p.zip=document.getElementById('nz').value.trim();   p.school=document.getElementById('ns').value.trim();
      if (!p.first || !p.last || (!p.phone && !p.email)){ err.textContent='New person needs first, last, and a phone or email.'; return; }
    } else { err.textContent='Pick a person from the search (or add a new one).'; return; }
    var b=document.getElementById('go'); b.disabled=true; b.textContent='Saving…';
    google.script.run.withSuccessHandler(function(r){
      b.disabled=false; b.textContent='Save commitment';
      var d=document.getElementById('done'); d.style.display='block';
      d.innerHTML='✅ Saved: <b>'+esc(r.name)+'</b> — '+esc((r.commitments||[]).join(', '))+
        (r.status==='created'?' <i>(new person created)</i>':' <i>(matched existing record)</i>')+
        '<br>The Commitments tab is refreshing now.<br><span class="lnk" onclick="fullReset()">Add another</span>';
      document.getElementById('commitBox').style.display='none';
      document.getElementById('selBox').style.display='none';
      document.getElementById('newFields').style.display='none';
    }).withFailureHandler(function(e){ b.disabled=false; b.textContent='Save commitment'; fail(e); }).ctSubmit(p);
  }
  function fullReset(){
    document.getElementById('done').style.display='none';
    document.querySelectorAll('#commitBox input[type=checkbox]').forEach(function(c){ c.checked=false; });
    document.getElementById('other').value=''; document.getElementById('note').value='';
    reset();
  }
  function fail(e){ document.getElementById('err').textContent=(e && e.message)||String(e); }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  q.focus();
</script>`;
