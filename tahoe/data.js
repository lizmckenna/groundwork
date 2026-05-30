// Tahoe 2026 — data layer
// In production, this fetches from the Apps Script Web App URL configured in
// config.js. With no URL set, it returns realistic mock data so the site is
// previewable end-to-end before you finish the Sheets wiring.

(function () {
  // ---------- People (from "head counts" tab) ----------
  // adult: A column = 1, kid: B column = 1
  // arrivals: list of date strings the person is present (Mon..Sun)
  const ALL_DAYS = ["7/20","7/21","7/22","7/23","7/24","7/25","7/26"];
  const A = ALL_DAYS;

  const MOCK_PEOPLE = [
    // Adults
    { name: "Martha",    role: "adult", days: A },
    { name: "Sue",       role: "adult", days: A },
    { name: "Michael",   role: "adult", days: A },
    { name: "Sheri",     role: "adult", days: ["7/22","7/23","7/24","7/25"], dayVisitor: true, lodgingNote: "AirBnB" },
    { name: "Andrew",    role: "adult", days: ["7/22","7/23","7/24","7/25"], dayVisitor: true, lodgingNote: "AirBnB" },
    { name: "Marlene",   role: "adult", days: A },
    { name: "Peter",     role: "adult", days: A },
    { name: "Laura D",   role: "adult", days: A },
    { name: "DOUB",      role: "adult", days: A },
    { name: "Bob",       role: "adult", days: A },
    { name: "Patty",     role: "adult", days: A },
    { name: "Eileen",    role: "adult", days: A },
    { name: "Jess",      role: "adult", days: A },
    { name: "Jeni",      role: "adult", days: ["7/20","7/21","7/22","7/23","7/24"] },
    { name: "Ryan",      role: "adult", days: A },
    { name: "Sarah",     role: "adult", days: A },
    { name: "Aaron",     role: "adult", days: A },
    { name: "Brooke",    role: "adult", days: A },
    { name: "Danii",     role: "adult", days: A },
    { name: "Nadia",     role: "adult", days: A },
    { name: "Kevin",     role: "adult", days: A },
    { name: "Patrick",   role: "adult", days: A },
    { name: "Liz",       role: "adult", days: A },
    { name: "Alexandre", role: "adult", days: A },
    { name: "Drew",      role: "adult", days: A },
    { name: "Mia",       role: "adult", days: A },
    { name: "Edwin",     role: "adult", days: A },
    { name: "Ana",       role: "adult", days: A },
    { name: "Jeff",      role: "adult", days: A },
    { name: "Bruce",     role: "adult", days: A },
    { name: "Erica",     role: "adult", days: A },
    { name: "Carol",     role: "adult", days: A },
    { name: "Eben",      role: "adult", days: A },
    { name: "Edward",    role: "adult", days: A, lodgingNote: "Sheri/Andrew's AirBnB" },
    { name: "Dan",       role: "adult", days: A },
    { name: "Sheena",    role: "adult", days: ["7/24","7/25","7/26"], lodgingNote: "AirBnB/hotel nearby" },

    // Kids
    { name: "Dillon",    role: "kid", days: A },
    { name: "Mors",      role: "kid", days: A },
    { name: "Rowan",     role: "kid", days: A },
    { name: "Rhys",      role: "kid", days: ["7/20","7/21","7/22","7/23"] },
    { name: "Riley",     role: "kid", days: A },
    { name: "Asher",     role: "kid", days: A },
    { name: "Dov",       role: "kid", days: A },
    { name: "Zaya",      role: "kid", days: A },
    { name: "Karim",     role: "kid", days: A },
    { name: "Oscar",     role: "kid", days: A },
    { name: "Leo",       role: "kid", days: A },
    { name: "Lana",      role: "kid", days: A },
    { name: "Emiliano",  role: "kid", days: A },
    { name: "Zoe",       role: "kid", days: A },
    { name: "Nick",      role: "kid", days: A },
    { name: "Theo",      role: "kid", days: A },
    { name: "Maddox",    role: "kid", days: A },
    { name: "Sami",      role: "kid", days: A },
    { name: "Clara",     role: "kid", days: A },
    { name: "Isaac",     role: "kid", days: A },
    { name: "Cole C.",   role: "kid", days: A },
    { name: "Kellan C.", role: "kid", days: A },
  ];

  // ---------- Dinner & chore roster (from "meals & chores" tab) ----------
  // Daily dinner leads come from row 2 of the sheet
  const DINNER_LEADS = {
    "2026-07-20": { leads: "Martha", menu: "" },
    "2026-07-21": { leads: "",       menu: "" },
    "2026-07-22": { leads: "Andrew/Sheri", menu: "Blackened chicken lasagne" },
    "2026-07-23": { leads: "",       menu: "" },
    "2026-07-24": { leads: "",       menu: "" },
    "2026-07-25": { leads: "",       menu: "" },
    "2026-07-26": { leads: "",       menu: "" },
  };

  // Chore slots: who signed up for what on which day
  // role_kind: 'help' (dinner help sign-up) | 'chore'
  const CHORE_SLOTS = [
    // dinner help
    { date: "2026-07-20", kind: "help", role: "Appetizer",     person: "" },
    { date: "2026-07-20", kind: "help", role: "Side",          person: "" },
    { date: "2026-07-20", kind: "help", role: "Salad",         person: "" },
    { date: "2026-07-20", kind: "help", role: "Dessert",       person: "" },
    { date: "2026-07-20", kind: "help", role: "Sous chef",     person: "" },
    // chores
    { date: "2026-07-20", kind: "chore", role: "Dish washer emptier",   person: "" },
    { date: "2026-07-20", kind: "chore", role: "Set dinner tables",     person: "Leo" },
    { date: "2026-07-20", kind: "chore", role: "Kitchen clean-up",      person: "" },
    { date: "2026-07-20", kind: "chore", role: "Kitchen clean-up",      person: "" },
    { date: "2026-07-20", kind: "chore", role: "Kitchen clean-up",      person: "" },
    { date: "2026-07-20", kind: "chore", role: "Trash czar",            person: "" },
    { date: "2026-07-20", kind: "chore", role: "Beach/grounds clean-up", person: "" },
    { date: "2026-07-20", kind: "chore", role: "Beach/grounds clean-up", person: "" },
    { date: "2026-07-20", kind: "chore", role: "House tidying",         person: "" },

    { date: "2026-07-21", kind: "chore", role: "Set dinner tables",     person: "" },
    { date: "2026-07-21", kind: "chore", role: "Beach/grounds clean-up", person: "Leo" },

    { date: "2026-07-22", kind: "chore", role: "Set dinner tables",     person: "Leo" },
    { date: "2026-07-22", kind: "chore", role: "Beach/grounds clean-up", person: "Leo" },
  ];

  // ---------- Chore completions (the heatmap data) ----------
  // In production this is the new "chore_completions" sheet tab written by the
  // Apps Script POST handler whenever someone taps "Done" on the site.
  const MOCK_COMPLETIONS = [
    // Mon 7/20
    { person: "Martha", date: "2026-07-20", chore: "Dinner lead", at: "2026-07-20T19:30" },
    { person: "Leo",    date: "2026-07-20", chore: "Set dinner tables", at: "2026-07-20T18:10" },
    { person: "Liz",    date: "2026-07-20", chore: "Kitchen clean-up", at: "2026-07-20T20:45" },
    { person: "Liz",    date: "2026-07-20", chore: "Trash czar", at: "2026-07-20T21:10" },
    { person: "Alexandre", date: "2026-07-20", chore: "Beach/grounds clean-up", at: "2026-07-20T11:20" },
    { person: "Patty",  date: "2026-07-20", chore: "Salad", at: "2026-07-20T18:30" },
    { person: "Bob",    date: "2026-07-20", chore: "Dish washer emptier", at: "2026-07-20T22:00" },
    { person: "Jeni",   date: "2026-07-20", chore: "House tidying", at: "2026-07-20T15:30" },

    // Tue 7/21
    { person: "Liz",    date: "2026-07-21", chore: "Kitchen clean-up", at: "2026-07-21T20:55" },
    { person: "Alexandre", date: "2026-07-21", chore: "Sous chef", at: "2026-07-21T17:00" },
    { person: "Leo",    date: "2026-07-21", chore: "Beach/grounds clean-up", at: "2026-07-21T10:30" },
    { person: "Patty",  date: "2026-07-21", chore: "Side", at: "2026-07-21T18:20" },
    { person: "Marlene", date: "2026-07-21", chore: "House tidying", at: "2026-07-21T14:10" },
    { person: "Ryan",   date: "2026-07-21", chore: "Trash czar", at: "2026-07-21T21:15" },

    // Wed 7/22 (today in demo)
    { person: "Andrew", date: "2026-07-22", chore: "Dinner lead", at: "2026-07-22T18:00" },
    { person: "Sheri",  date: "2026-07-22", chore: "Dinner lead", at: "2026-07-22T18:00" },
    { person: "Liz",    date: "2026-07-22", chore: "Salad", at: "2026-07-22T18:45" },
    { person: "Leo",    date: "2026-07-22", chore: "Set dinner tables", at: "2026-07-22T18:30" },
    { person: "Alexandre", date: "2026-07-22", chore: "Beach/grounds clean-up", at: "2026-07-22T11:00" },
    { person: "Patty",  date: "2026-07-22", chore: "Dish washer emptier", at: "2026-07-22T22:10" },
  ];

  // ---------- Lodging (from "lodging" tab) ----------
  const MOCK_LODGING = [
    { location: "Teece Property (Four Ring Road)", room: "Upstairs dorm", bed: "Single", assignments: {} },
    { location: "Teece Property (Four Ring Road)", room: "Upstairs dorm", bed: "Single", assignments: {} },
    { location: "Teece Property (Four Ring Road)", room: "Upstairs dorm", bed: "Single", assignments: {} },
    { location: "Teece Property (Four Ring Road)", room: "Upstairs dorm", bed: "Single", assignments: {} },
    { location: "Teece Property (Four Ring Road)", room: "Upstairs dorm", bed: "Futon double", assignments: {} },
    { location: "Teece Property (Four Ring Road)", room: "Upstairs room", bed: "Double", assignments: { "7/20": "Liz + Alexandre", "7/21": "Liz + Alexandre", "7/22": "Liz + Alexandre", "7/23": "Liz + Alexandre", "7/24": "Liz + Alexandre", "7/25": "Liz + Alexandre", "7/26": "Liz + Alexandre" } },
    { location: "Teece Property (Four Ring Road)", room: "Upstairs room", bed: "Double", assignments: { "7/20": "Leo + Lana", "7/21": "Leo + Lana", "7/22": "Leo + Lana", "7/23": "Leo + Lana", "7/24": "Leo + Lana", "7/25": "Leo + Lana", "7/26": "Leo + Lana" } },
    { location: "Teece Property (Four Ring Road)", room: "Downstairs suite #1", bed: "King", assignments: { "7/20": "Martha", "7/21": "Martha" } },
    { location: "Teece Property (Four Ring Road)", room: "Downstairs suite #2", bed: "King", assignments: {} },
    { location: "Teece Property (Four Ring Road)", room: "Teece Grounds Tent #1", bed: "n/a", assignments: {} },
    { location: "Teece Property (Four Ring Road)", room: "Teece Grounds Tent #2", bed: "n/a", assignments: {} },
    { location: "Teece Property (Four Ring Road)", room: "Teece Grounds Tent #3", bed: "n/a", assignments: {} },
    { location: "Teece Property (Four Ring Road)", room: "Teece Grounds Tent #4", bed: "n/a", assignments: {} },
    { location: "Teece Property (Four Ring Road)", room: "Teece Grounds Tent #5", bed: "n/a", assignments: {} },
    { location: "Teece Property (Four Ring Road)", room: "RV", bed: "n/a", assignments: {} },
    { location: "Overflow", room: "Sunnyside", bed: "n/a", assignments: {} },
    { location: "Overflow", room: "Tahoma cabin, etc.", bed: "n/a", assignments: {} },
  ];

  // ---------- Schedule (a new tab Liz will add) ----------
  const MOCK_SCHEDULE = [
    { date: "2026-07-20", time: "all day", title: "Arrivals", lead: "", kind: "logistics" },
    { date: "2026-07-20", time: "18:00",  title: "Welcome dinner", lead: "Martha", kind: "meal" },
    { date: "2026-07-21", time: "09:30",  title: "Eagle Rock hike (easy)", lead: "Bruce", kind: "hike" },
    { date: "2026-07-22", time: "10:00",  title: "Sand Harbor beach day", lead: "Jeni", kind: "beach" },
    { date: "2026-07-22", time: "18:00",  title: "Blackened chicken lasagne", lead: "Andrew/Sheri", kind: "meal" },
    { date: "2026-07-23", time: "07:30",  title: "Mt. Tallac sunrise (strenuous)", lead: "Ryan", kind: "hike" },
    { date: "2026-07-24", time: "11:00",  title: "Kids' lake olympics", lead: "Patty", kind: "kids" },
  ];

  // ===================================================================
  // Public API
  // ===================================================================

  async function fetchAll() {
    const params = new URLSearchParams(window.location.search);
    const forceMock = params.get("mock") === "1";
    const url = (window.TAHOE_CONFIG && window.TAHOE_CONFIG.appsScriptUrl) || "";

    if (forceMock || !url) {
      return mockBundle();
    }

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("bad status " + res.status);
      const data = await res.json();
      data.mock = false;
      return data;
    } catch (err) {
      console.warn("Tahoe: live fetch failed, falling back to mock data.", err);
      const bundle = mockBundle();
      bundle.mockReason = "live-fetch-failed";
      return bundle;
    }
  }

  function mockBundle() {
    return {
      people: MOCK_PEOPLE,
      dinnerLeads: DINNER_LEADS,
      choreSlots: MOCK_CHORE_SLOTS_FOR_PREVIEW(),
      completions: MOCK_COMPLETIONS,
      lodging: MOCK_LODGING,
      schedule: MOCK_SCHEDULE,
      mock: true,
    };
  }

  // Show the full chore roster in preview mode so each row has signup state
  function MOCK_CHORE_SLOTS_FOR_PREVIEW() {
    return CHORE_SLOTS;
  }

  // Mark a chore done. Dedupes per device via localStorage.
  async function markDone({ person, date, chore }) {
    const url = (window.TAHOE_CONFIG && window.TAHOE_CONFIG.appsScriptUrl) || "";
    const key = `tahoe:done:${person}:${date}:${chore}`;
    if (localStorage.getItem(key)) {
      return { ok: false, reason: "already-marked-on-this-device" };
    }
    localStorage.setItem(key, new Date().toISOString());

    const payload = { action: "complete", person, date, chore, at: new Date().toISOString() };
    if (!url) {
      MOCK_COMPLETIONS.push(payload);
      return { ok: true, mock: true };
    }
    try {
      await fetch(url, {
        method: "POST",
        // Apps Script tolerates text/plain and avoids a CORS preflight
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
      });
      return { ok: true };
    } catch (err) {
      // keep the localStorage record so the UI stays in sync; the row will
      // sync on next page load
      return { ok: true, queued: true };
    }
  }

  // Undo a chore done within the last 30s (best-effort)
  function undoDone({ person, date, chore }) {
    const key = `tahoe:done:${person}:${date}:${chore}`;
    localStorage.removeItem(key);
    const url = (window.TAHOE_CONFIG && window.TAHOE_CONFIG.appsScriptUrl) || "";
    if (!url) {
      const idx = MOCK_COMPLETIONS.findIndex(c => c.person === person && c.date === date && c.chore === chore);
      if (idx >= 0) MOCK_COMPLETIONS.splice(idx, 1);
      return { ok: true, mock: true };
    }
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "undo", person, date, chore }),
    }).then(() => ({ ok: true }));
  }

  window.TAHOE_DATA = { fetchAll, markDone, undoDone };
})();
