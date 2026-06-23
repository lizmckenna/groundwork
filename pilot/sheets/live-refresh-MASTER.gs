/**
 * Groundwork — P4MPS MASTER TRACKER (Molly + Ellen).
 * Paste into Extensions → Apps Script, Save, run setUp() once (authorize when asked).
 *
 * Pulls every headline metric live from Airtable (via the Worker rollup feed) and
 * draws a colored progress bar to each goal. Refreshes every 30 minutes. The only
 * thing you edit is the Goal column — your goals are preserved across refreshes.
 */
const KEY  = 'p4mps-rKItacZ0arZKMy12UZuRBYwJVP_LJ4iU';
const FEED = 'https://groundwork-pilot.elizabethmck.workers.dev/export/rollup.csv';
const TAB  = 'Master tracker';
const HDR = 3, FIRST = 4;
const TITLE = 'P4MPS — Master Tracker';

// key → default goal + bar color (goals are editable in the sheet and preserved).
const META = {
  outreach_attempts:   { goal: 5000, color: '#1F5C3D' },
  onboarding_attended: { goal: 500,  color: '#2F8F5B' },
  launch_attended:     { goal: 1000, color: '#B25048' },
  hm_trained:          { goal: 150,  color: '#C99633' },
  amp_trained:         { goal: 150,  color: '#3B6FB0' },
  amp_convos:          { goal: 2000, color: '#7A4FA3' },
  a5_commitments:      { goal: 500,  color: '#1F5C3D' },
  hm_commitments:      { goal: 150,  color: '#C99633' },
  one_on_ones:         { goal: 200,  color: '#B25048' },
  a5_followed_up:      { goal: 300,  color: '#2F8F5B' },
  hm_followed_up:      { goal: 100,  color: '#2F8F5B' },
  vote_reminders:      { goal: 2000, color: '#3B6FB0' },
};

function onOpen(){
  SpreadsheetApp.getUi().createMenu('🔄 Groundwork').addItem('Refresh now','refreshMaster').addToUi();
}

function setUp(){
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(TAB);
  if (!sh) sh = ss.insertSheet(TAB);
  // Title
  sh.getRange(1,1,2,5).breakApart();
  sh.getRange(1,1,1,5).merge().setValue(TITLE)
    .setFontSize(20).setFontWeight('bold').setFontColor('#ffffff').setBackground('#1A2418')
    .setVerticalAlignment('middle');
  sh.setRowHeight(1,46);
  sh.getRange(2,1,1,5).merge().setValue('Live from Airtable · refreshes every 30 minutes · edit only the Goal column')
    .setFontSize(10).setFontStyle('italic').setFontColor('#5b6b58').setBackground('#E9E5CE');
  sh.setRowHeight(2,22);
  // Header
  sh.getRange(HDR,1,1,5).setValues([['Metric','Count','Goal','% to goal','Progress']])
    .setFontWeight('bold').setFontColor('#ffffff').setBackground('#2F5E3D');
  sh.setColumnWidth(1,300); sh.setColumnWidth(2,80); sh.setColumnWidth(3,80);
  sh.setColumnWidth(4,90); sh.setColumnWidth(5,240); sh.setColumnWidth(6,150);
  sh.setFrozenRows(HDR);
  // % to goal color scale (red → yellow → green)
  const pctRange = sh.getRange(FIRST,4,META && Object.keys(META).length || 20,1);
  let rules = sh.getConditionalFormatRules().filter(r => !r.getRanges().some(rg => rg.getColumn()===4));
  rules.push(SpreadsheetApp.newConditionalFormatRule().setGradientMaxpointWithValue('#188038', SpreadsheetApp.InterpolationType.NUMBER, '1')
    .setGradientMidpointWithValue('#FCE588', SpreadsheetApp.InterpolationType.NUMBER, '0.5')
    .setGradientMinpointWithValue('#F4C7C3', SpreadsheetApp.InterpolationType.NUMBER, '0')
    .setRanges([pctRange]).build());
  sh.setConditionalFormatRules(rules);
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction()==='refreshMaster') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('refreshMaster').timeBased().everyMinutes(30).create();
  refreshMaster();
  ss.toast('Master tracker is live. Refreshes every 30 minutes. Edit goals in column C.', 'Groundwork', 6);
}

function refreshMaster(){
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB); if (!sh) return;
  // Preserve any goals already typed, matched by key (hidden column F).
  const goals = {};
  const last = sh.getLastRow();
  if (last >= FIRST){
    const keys = sh.getRange(FIRST,6,last-FIRST+1,1).getValues();
    const gv = sh.getRange(FIRST,3,last-FIRST+1,1).getValues();
    for (let i=0;i<keys.length;i++){ const k=String(keys[i][0]||'').trim(); if (k) goals[k]=gv[i][0]; }
  }
  const url = FEED + '?key='+encodeURIComponent(KEY)+'&t='+Date.now();
  const rows = Utilities.parseCsv(UrlFetchApp.fetch(url,{muteHttpExceptions:true}).getContentText());
  if (rows.length < 2) return;
  const body = rows.slice(1);   // skip header: [key, Metric, Count]
  if (last >= FIRST) sh.getRange(FIRST,1,last-FIRST+1,6).clearContent();
  const out = body.map((r,i) => {
    const key = String(r[0]||'').trim();
    const goal = (goals[key] != null && goals[key] !== '') ? goals[key] : (META[key] ? META[key].goal : '');
    return { key, metric: r[1]||'', count: Number(r[2])||0, goal };
  });
  // Write values (A metric, B count, C goal, F key)
  sh.getRange(FIRST,1,out.length,1).setValues(out.map(o=>[o.metric]));
  sh.getRange(FIRST,2,out.length,1).setValues(out.map(o=>[o.count]));
  sh.getRange(FIRST,3,out.length,1).setValues(out.map(o=>[o.goal]));
  sh.getRange(FIRST,6,out.length,1).setValues(out.map(o=>[o.key]));
  // Formulas: % to goal + colored progress bar
  for (let i=0;i<out.length;i++){
    const r = FIRST+i;
    sh.getRange(r,4).setFormula(`=IF(N(C${r})=0,"",B${r}/C${r})`).setNumberFormat('0%');
    // Bar color tracks progress (live): <10% red, 10–50% orange, 50–80% gold, >80% green.
    sh.getRange(r,5).setFormula(`=IF(N(C${r})=0,"",SPARKLINE(B${r},{"charttype","bar";"max",C${r};"empty","zero";"color1",IF(B${r}/C${r}<0.1,"#D93025",IF(B${r}/C${r}<0.5,"#E8710A",IF(B${r}/C${r}<0.8,"#F4B400","#188038")))}))`);
  }
  // Definitions as cell notes — hover the metric name to see exactly what it counts.
  const NOTES = {
    outreach_attempts: 'Total call / text / email attempts logged across the organizer dashboards.',
    onboarding_attended: 'Distinct people marked Attended or Walk-in at any No on 5 onboarding call.',
    launch_attended: 'Distinct people marked Attended / Walk-in at a regional launch or in-person event (includes door check-ins).',
    hm_trained: 'Distinct people who attended a House Meeting training.',
    amp_trained: 'Distinct people who attended an Amplifier training.',
    amp_convos: 'Total amplifier-to-voter conversations logged (all rounds).',
    a5_commitments: 'Distinct people who made at least one Amendment 5 commitment.',
    hm_commitments: 'Distinct people who made a house-meeting commitment or signed in at a house meeting.',
    one_on_ones: 'Distinct people with a 1-1 booked.',
    a5_followed_up: 'A5 committers who took a REAL next step: a 1-1 booked, a logged conversation, or a training signup. Does NOT count a mere attempted call or text.',
    hm_followed_up: 'House-meeting committers who booked a 1-1 or had a logged conversation. Does NOT count a mere attempt.',
    vote_reminders: 'Distinct people flagged "Wants vote reminder" from the remind-to-vote signup form.',
  };
  for (let i=0;i<out.length;i++){ const nt = NOTES[out[i].key]; if (nt) sh.getRange(FIRST+i,1).setNote(nt); }
  sh.hideColumns(6);
  sh.getRange(2,1,1,5).setValue('Live from Airtable · refreshes every 30 minutes · edit only the Goal column · updated '+new Date().toLocaleString());
  try { sh.getRange(FIRST,1,out.length,5).setVerticalAlignment('middle'); for (let i=0;i<out.length;i++) sh.setRowHeight(FIRST+i,28); } catch(e){}
}
