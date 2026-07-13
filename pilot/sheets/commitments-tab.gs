/**
 * Groundwork — COMMITMENTS tab add-on.
 * Paste as a file in a spreadsheet's bound Apps Script project, set CT_TABS
 * for that sheet (two ready-made configs below), Save, run ctSetUp once.
 *
 * Tabs are driven by /export/commitments.csv buckets:
 *   bucket=commits        → people with ≥1 REAL commitment (vote-reminder-only
 *                           folks excluded; vote-reminder lines stripped from Other)
 *   bucket=votereminders  → everyone who asked for a vote reminder (GOTV list)
 *   region=kc|northland|… → only people who route to that region
 *
 * Manual follow-up columns (Claimed by / Follow-up status / Notes) survive
 * every refresh, keyed on the hidden contact_id column.
 * '🗳 Commitments' menu → search-first Add-a-commitment dialog: match an
 * existing contact and tick commitments; only net-new people need info typed.
 *
 * Every name is ct-prefixed: safe to paste alongside a region tracker's
 * existing script (shared global namespace, zero collisions).
 */

// ==== PER-SHEET CONFIG — keep exactly one CT_TABS ==========================
// ALL-commitments tracker (statewide, two tabs):
const CT_TABS = [
  { name: 'Commitments', pos: 1, params: 'bucket=commits',
    banner: 'EVERYONE WITH A REAL COMMITMENT, statewide (vote-reminder-only folks live on the next tab) — auto-refreshes; columns A–V come from the database (edits there are overwritten). The PLUM columns are YOURS and survive every refresh. Add new commitments via the 🗳 Commitments menu.' },
  { name: 'Vote reminders', pos: 2, params: 'bucket=votereminders',
    banner: 'EVERYONE WHO ASKED FOR A VOTE REMINDER, statewide (the GOTV list; some also appear on the Commitments tab) — auto-refreshes; columns A–V come from the database. The PLUM columns are YOURS and survive every refresh.' },
];
// Kansas City tracker (single tab, 3rd position) — use this CT_TABS instead:
// const CT_TABS = [
//   { name: 'Commitments', pos: 3, params: 'region=kc&bucket=commits',
//     banner: 'KANSAS CITY commitments only (vote reminders live on the ALL tracker) — auto-refreshes; columns A–V come from the database (edits there are overwritten). The PLUM columns are YOURS and survive every refresh. Add new commitments via the 🗳 Commitments menu.' },
// ];
// ===========================================================================

const CT_KEY    = 'p4mps-rKItacZ0arZKMy12UZuRBYwJVP_LJ4iU';
const CT_WORKER = 'https://groundwork-pilot.elizabethmck.workers.dev';
const CT_HDR    = 2, CT_FIRST = 3;   // banner row 1, header row 2, data from 3

// Feed columns, in feed order (contact_id first). Manual columns appended after.
const CT_FEED_COLS = ['contact_id','First','Last','Region','Organized By','Role','Email','Phone','School','District','County',
  'Amplifier','House Mtg','School Board','Canvass','Regional Team','Other commitments','Latest commitment',
  'Attended Launch','Amp Training','HM Training','Attended Power Camp'];
const CT_MANUAL = ['Claimed by','Follow-up status','Notes'];
const CT_STATUS = ['Not started','Texted','Called','Left message','1-1 booked','Done','No answer','Declined'];
const CT_N_FEED = CT_FEED_COLS.length;            // 22
const CT_M_START = CT_N_FEED + 1;                 // 23 = first manual col
const CT_TOTAL = CT_N_FEED + CT_MANUAL.length;    // 25

// brand (own copies — host constants may differ per region)
const CT_FONT='Archivo', CT_PLUM='#3e4f6e', CT_INK='#1A2418', CT_PAPER='#E9E5CE';
const CT_GREEN='#38761D', CT_COMMIT_BLUE='#6FA8DC', CT_YES_GREEN='#CDE9D5', CT_BAND='#F3F4F6', CT_ALERT='#FBE48A';

function ctSetUp(){
  CT_TABS.forEach(ctBuildTab);
  ctRefresh();
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

function ctBuildTab(cfg){
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(cfg.name);
  if (!sh){ sh = ss.insertSheet(cfg.name, cfg.pos - 1); }
  ss.setActiveSheet(sh); ss.moveActiveSheet(cfg.pos);
  // banner — A1:C1 stay OUT of the merge: Sheets refuses frozen columns that
  // cut through a merged cell, and we freeze 3 columns below.
  sh.getRange(1,1,1,CT_TOTAL).breakApart();
  sh.getRange(1,1,1,CT_TOTAL).setBackground(CT_INK);
  sh.getRange(1,1).setValue('🗳 ' + cfg.name.toUpperCase())
    .setFontFamily(CT_FONT).setFontWeight('bold').setFontSize(11).setFontColor('#ffffff').setVerticalAlignment('middle');
  sh.getRange(1,4,1,CT_TOTAL-3).merge().setValue(cfg.banner)
    .setFontFamily(CT_FONT).setFontSize(10).setFontColor('#ffffff').setBackground(CT_INK).setWrap(true).setVerticalAlignment('middle');
  sh.setRowHeight(1, 44);
  // header
  sh.getRange(CT_HDR,1,1,CT_N_FEED).setValues([CT_FEED_COLS])
    .setFontFamily(CT_FONT).setFontWeight('bold').setFontColor('#ffffff').setBackground(CT_PLUM);
  sh.getRange(CT_HDR,CT_M_START,1,CT_MANUAL.length).setValues([CT_MANUAL])
    .setFontFamily(CT_FONT).setFontWeight('bold').setFontColor('#ffffff').setBackground('#5b3a6e');
  // commitment block header tint
  sh.getRange(CT_HDR,12,1,7).setBackground(CT_GREEN);
  sh.setFrozenRows(CT_HDR); sh.setFrozenColumns(3);
  sh.hideColumns(1);                                    // contact_id
  const widths = {2:90,3:110,4:150,5:130,6:90,7:190,8:110,9:150,10:180,11:130,12:86,13:86,14:96,15:80,16:104,17:230,18:120,19:110,20:96,21:92,22:130,23:120,24:130,25:220};
  Object.keys(widths).forEach(c => sh.setColumnWidth(Number(c), widths[c]));
  // follow-up status dropdown
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(CT_STATUS, true).setAllowInvalid(true).build();
  sh.getRange(CT_FIRST, CT_M_START+1, sh.getMaxRows()-CT_FIRST+1, 1).setDataValidation(rule);
  if (!sh.getFilter()) sh.getRange(CT_HDR,1,sh.getMaxRows()-CT_HDR+1,CT_TOTAL).createFilter();
}

// Abort-safe refresh: NEVER clears a tab unless a valid non-empty feed is
// confirmed (non-200, error body, or missing header → keep what's on screen).
function ctRefresh(){
  const ss = SpreadsheetApp.getActive();
  CT_TABS.forEach(cfg => {
    const sh = ss.getSheetByName(cfg.name); if (!sh) return;
    const resp = UrlFetchApp.fetch(CT_WORKER + '/export/commitments.csv?key=' + encodeURIComponent(CT_KEY) + '&' + cfg.params + '&t=' + Date.now(), {muteHttpExceptions:true});
    if (resp.getResponseCode() !== 200) return;
    const rows = Utilities.parseCsv(resp.getContentText());
    if (rows.length < 2) return;
    if (String(rows[0][0]).trim().toLowerCase() !== 'contact_id') return;
    // preserve manual columns by contact_id
    const last = sh.getLastRow(), byId = {};
    if (last >= CT_FIRST){
      const ids = sh.getRange(CT_FIRST,1,last-CT_FIRST+1,1).getValues();
      const man = sh.getRange(CT_FIRST,CT_M_START,last-CT_FIRST+1,CT_MANUAL.length).getValues();
      for (let i=0;i<ids.length;i++){ const id=String(ids[i][0]||'').trim(); if (id && man[i].some(v=>v!=='')) byId[id]=man[i]; }
    }
    const body = rows.slice(1).map(r => { const o=r.slice(0,CT_N_FEED); while (o.length<CT_N_FEED) o.push(''); return o; });
    if (last >= CT_FIRST) sh.getRange(CT_FIRST,1,last-CT_FIRST+1,CT_TOTAL).clearContent();
    sh.getRange(CT_FIRST,1,body.length,CT_N_FEED).setValues(body);
    const man = body.map(r => byId[String(r[0]||'').trim()] || new Array(CT_MANUAL.length).fill(''));
    sh.getRange(CT_FIRST,CT_M_START,body.length,CT_MANUAL.length).setValues(man);
    ctBrand(sh, body.length);
  });
}

function ctBrand(sh, n){
  if (n < 1) return;
  const all = sh.getRange(CT_FIRST,1,n,CT_TOTAL);
  all.setFontFamily(CT_FONT).setFontSize(10).setVerticalAlignment('middle');
  // banding
  const bands = [];
  for (let i=0;i<n;i++) bands.push([(i%2) ? CT_BAND : '#FFFFFF']);
  for (let c=1;c<=CT_TOTAL;c++) sh.getRange(CT_FIRST,c,n,1).setBackgrounds(bands.map(b=>[b[0]]));
  // Committed cells blue, Yes flags green, unrouted region amber
  const vals = sh.getRange(CT_FIRST,1,n,CT_N_FEED).getValues();
  for (let i=0;i<n;i++){
    for (let c=11;c<=15;c++) if (String(vals[i][c])==='Committed') sh.getRange(CT_FIRST+i,c+1).setBackground(CT_COMMIT_BLUE).setFontWeight('bold');
    for (let c=18;c<=21;c++) if (String(vals[i][c])==='Yes') sh.getRange(CT_FIRST+i,c+1).setBackground(CT_YES_GREEN);
    if (String(vals[i][3]) === '(unrouted)') sh.getRange(CT_FIRST+i,4).setBackground(CT_ALERT);
  }
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
