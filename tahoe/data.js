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

  // Mirrors the "head counts" tab as of 2026-07-02. In live mode this comes
  // from the Apps Script instead.
  const MID = ["7/22","7/23","7/24","7/25","7/26"];        // Wed→Sun
  const MON_FRI = ["7/20","7/21","7/22","7/23","7/24"];
  const MON_SAT = ["7/20","7/21","7/22","7/23","7/24","7/25"];

  const MOCK_PEOPLE = [
    { name: "Martha",      role: "adult", days: A, note: "First night dinner" },
    { name: "Sue",         role: "adult", days: A },
    { name: "Michael",     role: "adult", days: A },
    { name: "Sheri",       role: "adult", days: ["7/22","7/23","7/24","7/25"], dayVisitor: true, lodgingNote: "AirBnB" },
    { name: "Andrew",      role: "adult", days: ["7/22","7/23","7/24","7/25"], dayVisitor: true, lodgingNote: "AirBnB" },
    { name: "Marlene",     role: "adult", days: A },
    { name: "Peter",       role: "adult", days: ["7/21","7/22"], dayVisitor: true },
    { name: "Laura D",     role: "adult", days: ["7/21","7/22"], dayVisitor: true },
    { name: "DOUB",        role: "adult", days: ["7/21","7/22","7/23","7/24","7/25"], note: "may stay at Patty's in Reno Tues 7/21" },
    { name: "Patty",       role: "adult", days: ["7/22"], dayVisitor: true },
    { name: "Jess",        role: "adult", days: A, dayVisitor: true, note: "TBD if on-site or day visitor" },
    { name: "Dillon",      role: "kid",   days: A },
    { name: "Jeni",        role: "adult", days: MON_FRI, dayVisitor: true },
    { name: "Ryan",        role: "adult", days: A, dayVisitor: true },
    { name: "Rowan",       role: "kid",   days: A, dayVisitor: true },
    { name: "Rhys",        role: "kid",   days: MON_FRI, dayVisitor: true },
    { name: "Riley",       role: "kid",   days: A, dayVisitor: true },
    { name: "Aaron",       role: "adult", days: MID, dayVisitor: true, lodgingNote: "AirBnB" },
    { name: "Brooke",      role: "adult", days: MID, dayVisitor: true, lodgingNote: "AirBnB" },
    { name: "Asher",       role: "kid",   days: MID, dayVisitor: true, lodgingNote: "AirBnB" },
    { name: "Dov",         role: "kid",   days: MID, dayVisitor: true, lodgingNote: "AirBnB" },
    { name: "Nadia",       role: "adult", days: A },
    { name: "Kevin",       role: "adult", days: A },
    { name: "Zaya",        role: "kid",   days: A },
    { name: "Karim",       role: "kid",   days: A },
    { name: "Oscar",       role: "kid",   days: A },
    { name: "Patrick",     role: "adult", days: [] },
    { name: "Liz",         role: "adult", days: A },
    { name: "Alexandre",   role: "adult", days: A },
    { name: "Leo",         role: "kid",   days: A },
    { name: "Lana",        role: "kid",   days: A },
    { name: "Drew",        role: "adult", days: [] },
    { name: "Mia",         role: "adult", days: [] },
    { name: "Edwin",       role: "adult", days: [] },
    { name: "Ana",         role: "adult", days: [] },
    { name: "Emiliano",    role: "kid",   days: [] },
    { name: "Zoe",         role: "kid",   days: [] },
    { name: "Jeff",        role: "adult", days: [], note: "TBD if on-site or day visitor" },
    { name: "Nick",        role: "kid",   days: [], note: "TBD if on-site or day visitor" },
    { name: "Theo",        role: "kid",   days: [], note: "TBD if on-site or day visitor" },
    { name: "Sami",        role: "other", days: [] },
    { name: "Edward",      role: "adult", days: MON_SAT, dayVisitor: true, note: "tents or Jeni's RV or AirBnB; fly into Reno late 7/20" },
    { name: "Danielle B.", role: "adult", days: MON_SAT, dayVisitor: true, note: "tents or Jeni's RV or AirBnB; fly into Reno late 7/20" },
    { name: "Clara",       role: "kid",   days: MON_SAT, dayVisitor: true, note: "tents or Jeni's RV or AirBnB" },
    { name: "Isaac",       role: "kid",   days: MON_SAT, dayVisitor: true, note: "tents or Jeni's RV or AirBnB" },
    { name: "Cole C.",     role: "kid",   days: MON_SAT, dayVisitor: true, note: "tents or Jeni's RV or AirBnB" },
    { name: "Kellan C.",   role: "kid",   days: MON_SAT, dayVisitor: true, note: "tents or Jeni's RV or AirBnB" },
    { name: "Sheena",      role: "adult", days: ["7/25","7/26"], dayVisitor: true, lodgingNote: "AirBnB/hotel nearby" },
    { name: "Ted",         role: "adult", days: ["7/25","7/26"], dayVisitor: true, lodgingNote: "AirBnB/hotel nearby" },
    { name: "Rumi",        role: "kid",   days: ["7/25","7/26"], dayVisitor: true, lodgingNote: "AirBnB/hotel nearby" },
    { name: "Ori",         role: "kid",   days: ["7/25","7/26"], dayVisitor: true, lodgingNote: "AirBnB/hotel nearby" },
    { name: "Carol",       role: "adult", days: [], dayVisitor: true },
    { name: "Neal",        role: "adult", days: [], dayVisitor: true },
    { name: "Colette",     role: "adult", days: [], dayVisitor: true },
    { name: "Eric",        role: "other", days: [], dayVisitor: true },
    { name: "Ella",        role: "kid",   days: [], dayVisitor: true },
    { name: "Desi",        role: "kid",   days: [], dayVisitor: true },
    { name: "Bruce",       role: "adult", days: [] },
    { name: "Erica",       role: "adult", days: [] },
    { name: "Eileen",      role: "adult", days: [] },
    { name: "Mara",        role: "adult", days: [] },
    { name: "Maureen/Colleen", role: "adult", days: [] },
    { name: "Chris King",  role: "adult", days: [], dayVisitor: true, note: "Truck camper" },
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
    { person: "Sue",    date: "2026-07-20", chore: "Salad", at: "2026-07-20T18:30" },
    { person: "Michael", date: "2026-07-20", chore: "Dish washer emptier", at: "2026-07-20T22:00" },
    { person: "Jeni",   date: "2026-07-20", chore: "House tidying", at: "2026-07-20T15:30" },

    // Tue 7/21
    { person: "Liz",    date: "2026-07-21", chore: "Kitchen clean-up", at: "2026-07-21T20:55" },
    { person: "Alexandre", date: "2026-07-21", chore: "Sous chef", at: "2026-07-21T17:00" },
    { person: "Leo",    date: "2026-07-21", chore: "Beach/grounds clean-up", at: "2026-07-21T10:30" },
    { person: "Sue",    date: "2026-07-21", chore: "Side", at: "2026-07-21T18:20" },
    { person: "Marlene", date: "2026-07-21", chore: "House tidying", at: "2026-07-21T14:10" },
    { person: "Ryan",   date: "2026-07-21", chore: "Trash czar", at: "2026-07-21T21:15" },

    // Wed 7/22 (today in demo)
    { person: "Andrew", date: "2026-07-22", chore: "Dinner lead", at: "2026-07-22T18:00" },
    { person: "Sheri",  date: "2026-07-22", chore: "Dinner lead", at: "2026-07-22T18:00" },
    { person: "Liz",    date: "2026-07-22", chore: "Salad", at: "2026-07-22T18:45" },
    { person: "Leo",    date: "2026-07-22", chore: "Set dinner tables", at: "2026-07-22T18:30" },
    { person: "Alexandre", date: "2026-07-22", chore: "Beach/grounds clean-up", at: "2026-07-22T11:00" },
    { person: "Patty",  date: "2026-07-22", chore: "Dish washer emptier", at: "2026-07-22T22:10" },
    { person: "Aaron",  date: "2026-07-22", chore: "Kitchen clean-up", at: "2026-07-22T21:30" },
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

  // Scan free-text (a menu, a dish name) for likely allergens.
  // Returns e.g. [{ key: "wheat", label: "may contain wheat" }].
  // Heads-up only — the cook is always the authority.
  function scanAllergens(text) {
    const cfg = window.TAHOE_CONFIG || {};
    const keywords = cfg.allergenKeywords || {};
    const t = (text || "").toLowerCase();
    if (!t) return [];
    const hits = [];
    Object.keys(keywords).forEach(key => {
      if (keywords[key].some(k => t.includes(k))) {
        hits.push({ key, label: "may contain " + key });
      }
    });
    return hits;
  }

  window.TAHOE_DATA = { fetchAll, markDone, undoDone, scanAllergens };
})();
