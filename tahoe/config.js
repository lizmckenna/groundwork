// Tahoe 2026 — site configuration
// Edit this file to wire the site up to your Google Sheet.

window.TAHOE_CONFIG = {
  // Apps Script Web App URL — bound to the "Tahoe 2026" Google Sheet.
  // See apps-script.gs for the script source and setup notes.
  appsScriptUrl: "https://script.google.com/macros/s/AKfycbzXWoX0XhBcAtrKLcntcMxxv75lzQDpfIEDzYBWjapK-QZoOJ9CI-fq4OFcXHIRfm9x/exec",

  // Demo mode: when there's no Apps Script URL, the heatmap pretends "today" is
  // mid-reunion so you can see what the page will look like during the week.
  demoTodayOverride: "2026-07-22",

  // Reunion dates (checkout Monday 7/27)
  startDate: "2026-07-20",
  endDate: "2026-07-26",
  location: "Four Ring Road, Teece House",
  locationCity: "Lake Tahoe",

  // Food allergies & diets — shown on Home and the Help-out page.
  // Written so a kid can read it. Keep person names matching the roster.
  dietary: [
    { person: "Clara",       emoji: "🌰", label: "ALL tree nuts",           detail: "Including walnuts, pecans, pistachios, and Brazil nuts. No exceptions." },
    { person: "Rhys",        emoji: "🌰", label: "Tree nuts (walnuts OK)",  detail: "Allergic to most tree nuts. Walnuts are the one exception." },
    { person: "Aaron",       emoji: "🌾", label: "Wheat + soy (severe)",    detail: "Any kind of wheat, and soy. He checks carefully, so make ingredients easy to find." },
    { person: "Danielle B.", emoji: "🌱", label: "Vegan",                   detail: "No meat, dairy, or eggs." },
    { person: "Sami",        emoji: "🌱", label: "Vegan",                   detail: "No meat, dairy, or eggs." },
  ],
  dietaryNote: "Gluten-free and vegan dishes (including desserts) arrive Wednesday. Cooks: tell the table what's in your dish. The grown-ups know to ask, the kids may not.",

  // Keywords the site scans menu text for, to auto-flag likely allergens.
  // Better safe than sorry: these are heads-ups, not verdicts — always ask the cook.
  allergenKeywords: {
    "tree nuts": ["nut", "almond", "pecan", "cashew", "pistachio", "hazelnut", "walnut", "praline", "marzipan", "pesto", "nutella", "baklava"],
    "wheat":     ["wheat", "flour", "bread", "pasta", "lasagn", "noodle", "pizza", "cake", "cookie", "pie", "breaded", "cracker", "roll", "bun", "tortilla", "couscous", "orzo"],
    "soy":       ["soy", "tofu", "edamame", "miso", "teriyaki", "tempeh"],
  },

  // Days of the reunion, in order
  days: [
    { label: "Mon", date: "2026-07-20", short: "7/20" },
    { label: "Tue", date: "2026-07-21", short: "7/21" },
    { label: "Wed", date: "2026-07-22", short: "7/22" },
    { label: "Thu", date: "2026-07-23", short: "7/23" },
    { label: "Fri", date: "2026-07-24", short: "7/24" },
    { label: "Sat", date: "2026-07-25", short: "7/25" },
    { label: "Sun", date: "2026-07-26", short: "7/26" },
  ],

  // Past-year photo albums. iCloud Shared Albums and Google Photos / Drive folder
  // links both work — the photos page renders each as a "memory book" card.
  photoAlbums: [
    {
      year: "2026",
      label: "Tahoe 2026: add your photos!",
      url: "https://www.icloud.com/sharedalbum/#B2P5Uzl7VZqBmY",
      kind: "icloud",
    },
    {
      year: "Past years",
      label: "Tahoe family album",
      url: "https://www.icloud.com/sharedalbum/#B2PGY8gBYGeOxv6",
      kind: "icloud",
    },
    {
      year: "Past years",
      label: "More Tahoe memories",
      url: "https://www.icloud.com/sharedalbum/#B2PG6XBubwMvV9",
      kind: "icloud",
    },
    // Add more albums here as you collect them, e.g.:
    // { year: "2024", label: "Tahoe 2024", url: "https://...", kind: "google" },
  ],

  // Heatmap color scale (chores done that day → color)
  heatScale: [
    "#eef2f4", // 0 — empty
    "#bfe1ec", // 1
    "#7ec0d4", // 2
    "#2c7da0", // 3
    "#1a4d6e", // 4+
  ],

  // Silly titles awarded by total chore count (per reunion)
  titles: [
    { min: 12, title: "Chore Czar", emoji: "👑" },
    { min: 8,  title: "Dish Vanquisher", emoji: "🧽" },
    { min: 5,  title: "Salad Sultan", emoji: "🥗" },
    { min: 3,  title: "Trash Hero", emoji: "🗑️" },
    { min: 1,  title: "Pitching In", emoji: "🌲" },
  ],
};
