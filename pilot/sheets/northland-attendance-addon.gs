// ATTENDANCE ADD-ON for the Northland tracker.
// Append these TWO functions at the very bottom of the existing Northland script
// (below the last } ). Do NOT change anything else. Save, then run addAttendance() once.
//
// It adds an "Attendance" column (L) with an Attended / No-show / Walk-in dropdown,
// and pushes each mark to Airtable + the events dashboard the moment you set it.
// It never reads or rewrites the RSVP list, so claims + reminders are untouched.
// Best used at or after the event (rows are stable then). It uses the KEY and
// EVENT already defined at the top of your Northland script.

function addAttendance(){
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB);
  const ATT_COL = M_START + 3;   // L — after Claimed by / Reminder assigned / Reminder status
  sh.getRange(1, ATT_COL).setValue('Attendance').setFontWeight('bold').setBackground('#FFF4CC');
  const dv = SpreadsheetApp.newDataValidation().requireValueInList(['Attended','No-show','Walk-in','Canceled'], true).setAllowInvalid(true).build();
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
  const r0 = Math.max(e.range.getRow(), 2), r1 = e.range.getLastRow();   // data starts row 2 on Northland
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
