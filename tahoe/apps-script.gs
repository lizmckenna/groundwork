// ============================================================
// TAHOE 2026 — Google Apps Script backend (~2 minute setup)
// ============================================================
//
// What this does:
//   - Exposes a single Web App URL that:
//       GET  → returns the spreadsheet as JSON (people, chores, lodging, etc.)
//       POST → appends/removes rows in the "chore_completions" tab when
//              someone taps "I did this" on the site.
//   - No login. Anyone with the site can mark a chore done.
//   - Each device dedupes via localStorage so kids can't spam.
//
// SETUP (do this once):
//   1. Open the "Tahoe 2026" Google Sheet.
//   2. Add a new tab called  chore_completions   with these headers in row 1:
//         A1: at  |  B1: person  |  C1: date  |  D1: chore  |  E1: device
//      (you don't have to fill any rows — the script appends to it)
//   3. Add a new tab called  schedule  with these headers in row 1:
//         A1: date  |  B1: time  |  C1: title  |  D1: lead  |  E1: kind
//      kind = one of: meal, hike, beach, kids, logistics
//   4. Extensions → Apps Script. Delete any starter code. Paste ALL of
//      this file in. Save.
//   5. Deploy → New deployment → Type: Web app.
//        Description:   Tahoe 2026
//        Execute as:    Me  (your account)
//        Who has access: Anyone
//      Click Deploy, authorize when prompted.
//   6. Copy the Web app URL it gives you. It looks like:
//        https://script.google.com/macros/s/AKfycbx.../exec
//   7. Paste that URL into tahoe/config.js as `appsScriptUrl`. Done.
//
// To update later: Deploy → Manage deployments → edit → New version.
// ============================================================

const SHEET_HEADCOUNTS  = "head counts";
const SHEET_MEALSCHORES = "meals & chores";
const SHEET_LODGING     = "lodging";
const SHEET_SCHEDULE    = "schedule";
const SHEET_COMPLETIONS = "chore_completions";

function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const payload = {
    people:       readPeople(ss),
    dinnerLeads:  readDinnerLeads(ss),
    choreSlots:   readChoreSlots(ss),
    completions:  readCompletions(ss),
    lodging:      readLodging(ss),
    schedule:     readSchedule(ss),
  };
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_COMPLETIONS) || ss.insertSheet(SHEET_COMPLETIONS);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["at", "person", "date", "chore", "device"]);
  }

  if (data.action === "complete") {
    sheet.appendRow([data.at || new Date().toISOString(), data.person, data.date, data.chore, data.device || ""]);
  } else if (data.action === "undo") {
    // remove the most recent matching row
    const rows = sheet.getDataRange().getValues();
    for (let i = rows.length - 1; i >= 1; i--) {
      if (rows[i][1] === data.person && rows[i][2] === data.date && rows[i][3] === data.chore) {
        sheet.deleteRow(i + 1);
        break;
      }
    }
  }
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- READERS ----------

function readPeople(ss) {
  const sheet = ss.getSheetByName(SHEET_HEADCOUNTS);
  if (!sheet) return [];
  const dayCols = readHeadcountDayCols(sheet); // map of colIdx -> short date "7/20"
  const lastRow = sheet.getLastRow();
  if (lastRow < 5) return [];
  const rng = sheet.getRange(5, 1, lastRow - 4, 12).getValues();
  const out = [];
  rng.forEach(row => {
    const adult = !!row[0];
    const kid   = !!row[1];
    const name  = (row[2] || "").toString().trim();
    if (!name) return;
    const days = [];
    Object.keys(dayCols).forEach(col => {
      if (row[col]) days.push(dayCols[col]);
    });
    const dayVisitor = !!row[10];
    const lodgingNote = (row[11] || "").toString().trim();
    out.push({
      name,
      role: kid ? "kid" : adult ? "adult" : "other",
      days,
      dayVisitor: dayVisitor || undefined,
      lodgingNote: lodgingNote || undefined,
    });
  });
  return out;
}

function readHeadcountDayCols(sheet) {
  // The headcounts sheet has columns Mon..Sun in row 2 ("Mon", "Tu", ...)
  // and row 4 has dates "20","21",... We'll just hard-map for July 20–26.
  return { 3: "7/20", 4: "7/21", 5: "7/22", 6: "7/23", 7: "7/24", 8: "7/25", 9: "7/26" };
}

function readDinnerLeads(ss) {
  const sheet = ss.getSheetByName(SHEET_MEALSCHORES);
  if (!sheet) return {};
  // Row 2 in cols D..J = dinner lead, Row 3 in cols D..J = menu
  const leads = sheet.getRange(2, 4, 1, 7).getValues()[0];
  const menus = sheet.getRange(3, 4, 1, 7).getValues()[0];
  const dates = ["2026-07-20","2026-07-21","2026-07-22","2026-07-23","2026-07-24","2026-07-25","2026-07-26"];
  const out = {};
  dates.forEach((d, i) => {
    out[d] = { leads: (leads[i] || "").toString(), menu: (menus[i] || "").toString() };
  });
  return out;
}

function readChoreSlots(ss) {
  const sheet = ss.getSheetByName(SHEET_MEALSCHORES);
  if (!sheet) return [];
  // Rows 7–11: Dinner help sign-up (Appetizer, Side, Salad, Dessert, Sous chef)
  // Rows 12–20: Chore sign-up
  const dates = ["2026-07-20","2026-07-21","2026-07-22","2026-07-23","2026-07-24","2026-07-25","2026-07-26"];
  const out = [];
  const range = sheet.getRange(7, 3, 14, 8).getValues(); // C..J for rows 7..20
  for (let r = 0; r < range.length; r++) {
    const role = (range[r][0] || "").toString().trim();
    if (!role) continue;
    const kind = r < 5 ? "help" : "chore";
    for (let c = 0; c < 7; c++) {
      const person = (range[r][c + 1] || "").toString().trim();
      out.push({ date: dates[c], kind, role, person });
    }
  }
  return out;
}

function readCompletions(ss) {
  const sheet = ss.getSheetByName(SHEET_COMPLETIONS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
  return rows
    .filter(r => r[1] && r[2] && r[3])
    .map(r => ({
      at:     r[0] ? new Date(r[0]).toISOString() : "",
      person: r[1].toString(),
      date:   r[2].toString(),
      chore:  r[3].toString(),
    }));
}

function readLodging(ss) {
  const sheet = ss.getSheetByName(SHEET_LODGING);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return [];
  // Cols A=Location, B=Room, C=Bed, D..J = 7 days
  const rng = sheet.getRange(3, 1, lastRow - 2, 10).getValues();
  const out = [];
  let lastLoc = "";
  const dayShorts = ["7/20","7/21","7/22","7/23","7/24","7/25","7/26"];
  rng.forEach(row => {
    const loc = (row[0] || "").toString().trim() || lastLoc;
    if (row[0]) lastLoc = loc;
    const room = (row[1] || "").toString().trim();
    if (!room) return;
    const bed = (row[2] || "").toString().trim();
    const assignments = {};
    dayShorts.forEach((s, i) => {
      const v = (row[3 + i] || "").toString().trim();
      if (v) assignments[s] = v;
    });
    out.push({ location: loc, room, bed, assignments });
  });
  return out;
}

function readSchedule(ss) {
  const sheet = ss.getSheetByName(SHEET_SCHEDULE);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
  return rows
    .filter(r => r[0] && r[2])
    .map(r => {
      const dateRaw = r[0];
      const date = (dateRaw instanceof Date)
        ? Utilities.formatDate(dateRaw, Session.getScriptTimeZone(), "yyyy-MM-dd")
        : dateRaw.toString();
      return {
        date,
        time:  (r[1] || "").toString(),
        title: (r[2] || "").toString(),
        lead:  (r[3] || "").toString(),
        kind:  (r[4] || "").toString(),
      };
    });
}
