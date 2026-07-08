/**
 * Groundwork - AMPLIFIER ACTIVITY tracker (read-only leaderboard).
 * Paste into Extensions > Apps Script, Save, run setUp() once (authorize when asked).
 *
 * Pulls a live per-amplifier rollup from Airtable: who is making calls, how many
 * conversations, unique voters reached, broken out by round. Refreshes every minute.
 * Nothing to edit - it is a dashboard.
 */
const KEY  = 'p4mps-rKItacZ0arZKMy12UZuRBYwJVP_LJ4iU';
const FEED = 'https://groundwork-pilot.elizabethmck.workers.dev/export/amplifiers.csv';
const TAB  = 'Amplifiers (live)';
const COLS = 7;
const HDR = 2, FIRST = 3;
const TITLE = 'AMPLIFIER ACTIVITY - live from Airtable. Who is making calls and how many. Refreshes every 5 minutes; nothing to edit here.';

function onOpen(){
  SpreadsheetApp.getUi().createMenu('Groundwork').addItem('Refresh now','refreshAMP').addToUi();
}

function setUp(){
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(TAB);
  if (!sh) sh = ss.insertSheet(TAB);
  sh.getRange(1,1,1,COLS).breakApart();
  sh.getRange(1,1,1,COLS).merge().setValue(TITLE)
    .setFontWeight('bold').setFontColor('#1F5C3D').setBackground('#E6F0E8')
    .setWrap(true).setVerticalAlignment('middle');
  sh.setRowHeight(1,44);
  sh.setFrozenRows(2);
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction()==='refreshAMP') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('refreshAMP').timeBased().everyMinutes(5).create();   // 5-min, not 1-min: every-minute across trackers blows the daily urlfetch quota
  refreshAMP();
  ss.toast('Amplifier tracker is live. Refreshes every 5 minutes.', 'Groundwork', 5);
}

function refreshAMP(){
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB); if (!sh) return;
  const url = FEED + '?key='+encodeURIComponent(KEY)+'&t='+Date.now();
  // Fetch defensively: BAIL OUT without touching the sheet if the feed is down,
  // quota-blocked, or malformed. A short/1-column response used to throw
  // "columns in the data does not match the range" every cycle and email on each fail.
  let resp;
  try { resp = UrlFetchApp.fetch(url,{muteHttpExceptions:true}); }
  catch(e){ return; }                                                        // urlfetch quota / network error -> retry next cycle
  if (resp.getResponseCode() !== 200) return;                                // worker error -> leave the sheet alone
  const rows = Utilities.parseCsv(resp.getContentText());
  if (rows.length < 1) return;
  if (rows[0].length < 2 || String(rows[0][0]||'').toLowerCase().indexOf('amplifier') === -1) return;  // not our CSV -> never wipe/throw
  const pad = r => { const s = r.slice(0,COLS); while (s.length < COLS) s.push(''); return s; };        // width-safe: pad short rows instead of throwing
  const last = sh.getLastRow();
  if (last >= HDR) sh.getRange(HDR,1,last-HDR+1,COLS).clearContent();
  // Header row
  sh.getRange(HDR,1,1,COLS).setValues([pad(rows[0])])
    .setFontWeight('bold').setBackground('#1F5C3D').setFontColor('#ffffff');
  const body = rows.slice(1);
  if (body.length) sh.getRange(FIRST,1,body.length,COLS).setValues(body.map(pad));
  // Accurate totals from the stats feed (unique voters can't be summed per-amplifier)
  let st = {};
  try { Utilities.parseCsv(UrlFetchApp.fetch(FEED+'?stats=1&key='+encodeURIComponent(KEY)+'&t='+Date.now(),{muteHttpExceptions:true}).getContentText()).slice(1).forEach(r=>st[r[0]]=Number(r[1])||0); } catch(e){}
  const tr = FIRST + body.length + 1;
  sh.getRange(tr,1,1,COLS).clearContent();
  sh.getRange(tr,1,1,3).setValues([['TOTAL', st.conversations||0, st.unique_voters||0]])
    .setFontWeight('bold').setBackground('#E6F0E8');
  try { sh.autoResizeColumns(1, COLS); } catch(e){}
}
