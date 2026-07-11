// Groundwork pilot worker — v3.7-org-filter-fix, 2026-05-22
// Merge of Liz's deployed copy edits + missing house-meeting endpoints.
// Preserves her edits to the confirmation email:
//   - "three other parents" (was "two")
//   - "Every parent we bring in makes our movement for Missouri's kids stronger" (softer close)
// Adds back:
//   - POST /house-meeting-signup — public form dedupes by email/phone, logs commitments
//   - GET  /house-meeting-hosts  — autocomplete list for the form (seeded + past hosts)
// v3.3: bolder confirmation-email forward-this ask · FROM = Parents for MO Kids · REPLY_TO = lanee4kckids@gmail.com
// v3.2: KV caching on /confirmees, /today-stats, /recent-activity (60s); /queue-count (300s); writes invalidate.

const BASE = 'appQdixHbuttPldx6';
const CONTACTS_TBL = 'tblJeHqz13AOvq71A';
const CONTACT_LOG_TBL = 'tblXQXzxf8z1oht7z';
const ORGANIZERS_TBL = 'tblxknZQg2W4JdTny';
const ONE_ON_ONES_TBL = 'tbl2VM8Net9MgPCXX';
const DONATIONS_TBL = 'tblLgvPvwamyy1ljD';   // ActBlue import: one row per gift (amount, date, contact)
const ATTENDANCE_MIRROR_TBL = 'tblIuEyimGqxkNFrG';   // new linked attendance table (contact<->events); nightly-synced mirror of campaign signups/attendance
// School -> region fallback: a known school routes a contact who has no usable county/city/district.
// Conservative, evidence-based (these schools appear in the data and point to one region). District/city/county win first.
const SCHOOL_REGION = [
  [/border star|hale cook|lincoln prep|foreign language|academ\w* lafayette|\blcpa\b|paseo|holliday|hogan prep|hogan preparatory|crossroads prep|primitivo|wendell phillips|hartman|melcher|wheatley|\bcarver\b|silver city|garfield|\bgarcia\b|woodland|faxon|trailwoods|troost|banneker|longfellow|pitcher|whittier|della lamb|guadalupe center|gordon parks|allen village|frontier school|genesis school|university academy|scuola vita nuova|brookside charter|ewing\w* kauffman/i, 'Kansas City'],
  [/greenway|davidson elem|briarcliff|winnetonka|northview|liberty oaks/i, 'Northland'],
  [/francis howell|south high/i, 'St. Charles / St. Louis'],
];
const EVENTS_TBL = 'tblHJG5AJagnOr33U';
const EVENT_ATTENDANCE_TBL = 'tbl4tvGVOqIPTylrr';
const ORGANIZER_NAME_BY_ID = {
  'rec0OmDN68hlffkTn': 'LaNeé Bridewell',
  'recnnEdYIPcclnPLY': 'Stephanie Rittgers',
  'recMGgwIl623aOVX2': 'Kathryn Evans',
  'rec1CV6zEsH9UWsb9': 'Judith Young',
  'rec3RWUSLZTE63MzA': 'Nina Velazquez',
  'recAMcPTYyNipjg8i': 'Jamie Martin',
  'recDcoyFNsJAacajo': 'Latrice Barnett',
  'recJSepELuqleC3on': 'David Tremaine',
  'recJrwWUsUUYOY3bk': 'Ashley Sadowski',
  'recKxHcVSxbURxJ0R': 'Melissa Miller',
  'recLxOVc6xTdYGdB8': 'Ellen Glover',
  'recPmpR75nlm5anmn': 'Kendra Caruso',
  'recQX4duh229QL6FT': 'Ellen Schwartze',
  'recRuGzcnkxdCJOXP': 'Sarah Laub',
  'recaXi5KrOiNUjmF7': 'Ashley Johnson',
  'recdFsxnr93u6tTNT': 'Benjamin Roesler',
  'reciH5BwGtnG5qOzq': 'Sierra Kilpatrick',
  'recppnwsWdkGUCgLb': 'Molly Fleming',
  'recpy9zfRkhpdFyG2': 'Liz McKenna',
  'recvahGj81QwlcFSL': 'Amber Frazier',
  'recsiDVfHvo66ua4r': 'Holly Kaden',
  'rectxzflcDQxU7EBn': 'Bess Bailey',
  'recvI8X54I8btvVn4': 'Synthia Larson',
  'recqENZKSbItbonLw': 'Emma Fortner',
  'rec6MIYi1KjuF7XxB': 'Valorie Montgomery',
  'rec7dIyOigEFsAVbf': 'Christy Cox',
};
// name -> organizer id (lowercased), for match-only Organized By write-back (no auto-create on typos)
const ORGANIZER_ID_BY_NAME = Object.fromEntries(Object.entries(ORGANIZER_NAME_BY_ID).map(([id, nm]) => [nm.toLowerCase().trim(), id]));
const METHOD_MAP = { called: 'Call', texted: 'Text', emailed: 'Email' };
const METHOD_REVERSE = { Call: 'called', Text: 'texted', Email: 'emailed' };
const CONFIRM_EVENT = 'Confirm 5/26';
// Per-event labels for confirm/attendance tracking, keyed by the dashboard's event key.
// Lets the same confirm/attendance/zoom endpoints serve both the 5/26 and 6/9 tabs.
const EVENT_META = {
  // type: 'onboarding' | 'hm' | 'amp' | 'legacy' — drives which lists offer
  // which signups and whose stats pages show which events.
  '5_26': { type: 'legacy',     date: '2026-05-26', time: '7:30pm CT', label: '5/26 Orientation',          confirmEvent: 'Confirm 5/26', attendEvent: 'Orientation 5/26',      confirmField: 'confirm_5_26_status', attendField: 'attendance_5_26_status', signupField: null,                  confirmTag: '5/26 confirm', attendTag: '5/26 orientation' },
  '6_9':  { type: 'onboarding', date: '2026-06-09', time: '7:30pm CT', label: '6/9 No on 5 Onboarding',    confirmEvent: 'Confirm 6/9',  attendEvent: '6/9 Emergency Meeting',  confirmField: 'confirm_6_9_status',  attendField: 'attendance_6_9_status',  signupField: 'signup_6_9_status',   confirmTag: '6/9 confirm',  attendTag: '6/9 emergency meeting' },
  '6_23': { type: 'onboarding', date: '2026-06-23', time: '7:30pm CT', label: '6/23 No on 5 Onboarding',   confirmEvent: 'Confirm 6/23', attendEvent: '6/23 No on 5 Onboarding', confirmField: 'confirm_6_23_status', attendField: 'attendance_6_23_status', signupField: 'signup_6_23_status', confirmTag: '6/23 confirm', attendTag: '6/23 onboarding' },
  '7_7':  { type: 'onboarding', date: '2026-07-07', time: '7:30pm CT', label: '7/7 No on 5 Onboarding',    confirmEvent: 'Confirm 7/7',  attendEvent: '7/7 No on 5 Onboarding',  confirmField: 'confirm_7_7_status',  attendField: 'attendance_7_7_status',  signupField: 'signup_7_7_status',  confirmTag: '7/7 confirm',  attendTag: '7/7 onboarding' },
  '7_21': { type: 'onboarding', date: '2026-07-21', time: '7:30pm CT', label: '7/21 No on 5 Onboarding',   confirmEvent: 'Confirm 7/21', attendEvent: '7/21 No on 5 Onboarding', confirmField: 'confirm_7_21_status', attendField: 'attendance_7_21_status', signupField: 'signup_7_21_status', confirmTag: '7/21 confirm', attendTag: '7/21 onboarding' },
  // 6/30 makeup onboarding (for anyone who missed 6/23). type 'makeup' (NOT 'onboarding')
  // on purpose: Airtable has no signup_6_30_status/attendance_6_30_status fields and the PAT
  // can't create them, so a null-field 'onboarding' would inject undefined into the type-based
  // call-list/dashboard formulas. As 'makeup' it stays out of that machinery and flows through
  // the generic signup path (events_signed_up + log + Zoom/ICS email) + the live-signups feed.
  // It is excluded from nextOnboardingKey() so the commitment form still defaults to 7/7.
  '6_30': { type: 'makeup', date: '2026-06-30', time: '7:30pm CT', label: '6/30 No on 5 Makeup Onboarding', confirmEvent: 'Confirm 6/30', attendEvent: '6/30 No on 5 Makeup Onboarding', confirmField: null, attendField: 'attendance_6_30_status', signupField: 'signup_6_30_status', confirmTag: '6/30 confirm', attendTag: '6/30 onboarding' },
  // House Meeting trainings — dates from parents4mopublicschools.org/trainings (canonical)
  'hm_6_3':  { type: 'hm', date: '2026-06-03', time: '5:30pm CT', label: 'HM Training 6/3',  confirmEvent: 'Confirm HM 6/3',  attendEvent: 'House Meeting Training 6/3',  confirmField: 'confirm_hm_6_3_status',  attendField: 'attendance_hm_6_3_status',  signupField: 'signup_hm_6_3_status',  confirmTag: 'hm 6/3 confirm',  attendTag: 'hm training 6/3' },
  'hm_6_16': { type: 'hm', date: '2026-06-16', time: '6:00pm CT', label: 'HM Training 6/16', confirmEvent: 'Confirm HM 6/16', attendEvent: 'House Meeting Training 6/16', confirmField: 'confirm_hm_6_16_status', attendField: 'attendance_hm_6_16_status', signupField: 'signup_hm_6_16_status', confirmTag: 'hm 6/16 confirm', attendTag: 'hm training 6/16' },
  'hm_7_1':  { type: 'hm', date: '2026-07-01', time: '5:30pm CT', label: 'HM Training 7/1',  confirmEvent: 'Confirm HM 7/1',  attendEvent: 'House Meeting Training 7/1',  confirmField: 'confirm_hm_7_1_status',  attendField: 'attendance_hm_7_1_status',  signupField: 'signup_hm_7_1_status',  confirmTag: 'hm 7/1 confirm',  attendTag: 'hm training 7/1' },
  'hm_7_16': { type: 'hm', date: '2026-07-16', time: '6:30pm CT', label: 'HM Training 7/16', confirmEvent: 'Confirm HM 7/16', attendEvent: 'House Meeting Training 7/16', confirmField: 'confirm_hm_7_16_status', attendField: 'attendance_hm_7_16_status', signupField: 'signup_hm_7_16_status', confirmTag: 'hm 7/16 confirm', attendTag: 'hm training 7/16' },
  'hm_7_29': { type: 'hm', date: '2026-07-29', time: '5:30pm CT', label: 'HM Training 7/29', confirmEvent: 'Confirm HM 7/29', attendEvent: 'House Meeting Training 7/29', confirmField: 'confirm_hm_7_29_status', attendField: 'attendance_hm_7_29_status', signupField: 'signup_hm_7_29_status', confirmTag: 'hm 7/29 confirm', attendTag: 'hm training 7/29' },
  // Amplifier trainings — dates from the website (Ellen's sheet had typos)
  'amp_6_11': { type: 'amp', date: '2026-06-11', time: '6:30pm CT', label: 'Amplifier 6/11', confirmEvent: 'Confirm Amp 6/11', attendEvent: 'Amplifier Training 6/11', confirmField: 'confirm_amp_6_11_status', attendField: 'attendance_amp_6_11_status', signupField: 'signup_amp_6_11_status', confirmTag: 'amp 6/11 confirm', attendTag: 'amplifier 6/11' },
  'amp_6_27': { type: 'amp', date: '2026-06-27', time: '1:00pm CT', label: 'Amplifier 6/27', confirmEvent: 'Confirm Amp 6/27', attendEvent: 'Amplifier Training 6/27', confirmField: 'confirm_amp_6_27_status', attendField: 'attendance_amp_6_27_status', signupField: 'signup_amp_6_27_status', confirmTag: 'amp 6/27 confirm', attendTag: 'amplifier 6/27' },
  'amp_7_6':  { type: 'amp', date: '2026-07-06', time: '6:30pm CT', label: 'Amplifier 7/6',  confirmEvent: 'Confirm Amp 7/6',  attendEvent: 'Amplifier Training 7/6',  confirmField: 'confirm_amp_7_6_status',  attendField: 'attendance_amp_7_6_status',  signupField: 'signup_amp_7_6_status',  confirmTag: 'amp 7/6 confirm',  attendTag: 'amplifier 7/6' },
  'amp_7_21': { type: 'amp', date: '2026-07-21', time: '6:30pm CT', label: 'Amplifier 7/21', confirmEvent: 'Confirm Amp 7/21', attendEvent: 'Amplifier Training 7/21', confirmField: 'confirm_amp_7_21_status', attendField: 'attendance_amp_7_21_status', signupField: 'signup_amp_7_21_status', confirmTag: 'amp 7/21 confirm', attendTag: 'amplifier 7/21' },
  // Internal-only training (not listed on the website; unlisted signup page at /trainings/online-amplifier/)
  'online_7_14': { type: 'amp', date: '2026-07-14', time: '7:00pm CT', label: 'Online Spaces 7/14', confirmEvent: 'Confirm Online Spaces 7/14', attendEvent: 'How to Amplify No on 5 in Online Spaces 7/14', confirmField: 'confirm_online_7_14_status', attendField: 'attendance_online_7_14_status', signupField: 'signup_online_7_14_status', confirmTag: 'online spaces 7/14 confirm', attendTag: 'online spaces 7/14' },
  // Voices for Small Schools of Missouri — rural/small-schools amplifier training (Laci). Unlisted page at /trainings/voices-small-schools/.
  // type 'makeup' (NOT 'amp') on purpose: no per-event Airtable status fields exist and the PAT can't create them, so
  // null signup/attend/confirm fields would inject `null` into the amp field-mapping queries. As 'makeup' it stays out of
  // that machinery (allMetaEvents remaps makeup->onboarding, which the amp/hm/camp filters skip). RSVPs are tracked via
  // events_signed_up + contact_log + the event_attendance mirror (write-through fires on signup). Confirmation email + ICS
  // are fully controlled by EMAIL_EVENTS['amp_7_19'] + KV zoomlink:amp_7_19. icsTitle overrides the makeup ICS default.
  'amp_7_19': { type: 'makeup', date: '2026-07-19', time: '7:00pm CT', label: 'Voices for Small Schools 7/19', confirmEvent: 'Confirm Voices 7/19', attendEvent: 'Voices for Small Schools Amplifier Training 7/19', confirmField: null, attendField: null, signupField: null, confirmTag: 'voices 7/19 confirm', attendTag: 'voices small schools 7/19', icsTitle: 'Voices for Small Schools Amplifier Training (Parents for Missouri Public Schools)' },
  // Know Your Neighbor (KC) — Kathryn owns reminders per the PMOPS flow (6/11 email)
  'kyn_6_23': { type: 'kyn', inPerson: true, date: '2026-06-23', time: '3:00pm CT',  label: 'Know Your Neighbor 6/23', confirmEvent: 'Confirm KYN 6/23', attendEvent: 'Know Your Neighbor 6/23', confirmField: 'confirm_kyn_6_23_status', attendField: 'attendance_kyn_6_23_status', signupField: 'signup_kyn_6_23_status', confirmTag: 'kyn 6/23 confirm', attendTag: 'kyn 6/23' },
  'kyn_7_25': { type: 'kyn', inPerson: true, date: '2026-07-25', time: '10:00am CT', label: 'Know Your Neighbor 7/25', confirmEvent: 'Confirm KYN 7/25', attendEvent: 'Know Your Neighbor 7/25', confirmField: 'confirm_kyn_7_25_status', attendField: 'attendance_kyn_7_25_status', signupField: 'signup_kyn_7_25_status', confirmTag: 'kyn 7/25 confirm', attendTag: 'kyn 7/25' },
};
function eventMeta(key){ return EVENT_META[key] || EVENT_META['5_26']; }
// The soonest upcoming onboarding key (so nothing is ever hardcoded to a past date).
function nextOnboardingKey(today){
  const obs = Object.entries(EVENT_META).filter(([k,m]) => m.type === 'onboarding').sort((a,b) => a[1].date.localeCompare(b[1].date));
  const up = obs.find(([k,m]) => m.date > today);   // strictly future: today's event has already happened
  return (up || obs[obs.length-1] || ['6_9'])[0];
}
// Outcome key (dashboard) → event meta key, generated for every event with a
// signup field ('signed-up-hm-6-16' → 'hm_6_16').
const SIGNUP_OUTCOME_EVENTS = Object.fromEntries(
  Object.keys(EVENT_META)
    .filter(k => EVENT_META[k].signupField)
    .map(k => ['signed-up-' + k.replace(/_/g, '-'), k])
);
const LANEE_ID = 'rec0OmDN68hlffkTn';
const STEPHANIE_ID = 'recnnEdYIPcclnPLY';
const ELLENG_ID = 'recLxOVc6xTdYGdB8';
const LANEE_COUNTIES = ['jackson', 'cass', 'johnson', 'platte', 'clay', 'lafayette', 'buchanan', 'ray'];
// Ellen Glover owns commitment-form follow-up in these counties (her ask 6/22).
const ELLENG_COUNTIES = ['clay', 'platte', 'buchanan', 'clinton'];
// "Follow-ups to commitments" routing (Ellen G spec 6/22, confirmed).
const LANEE_FOLLOWUP_COUNTIES = ['jackson', 'cass', 'johnson', 'lafayette', 'ray'];
// Stephanie never gets these 9 (KC region + Ellen G counties) on her follow-up list.
const STEPHANIE_EXCLUDE_COUNTIES = ['jackson', 'cass', 'johnson', 'lafayette', 'ray', 'clay', 'platte', 'buchanan', 'clinton'];
// Counties with an established regional team — Stephanie's onboarding catch skips
// these and only fires for new/no-team counties (where we're trying to launch).
const STEPHANIE_TEAM_COUNTIES = ['jackson', 'cass', 'johnson', 'lafayette', 'ray', 'clay', 'platte', 'buchanan', 'clinton', 'st. charles', 'st. louis', 'jefferson', 'franklin'];
// Stephanie's Francis Howell hold — she keeps these specific people on her queue
// even when they are amplifier-only (which would otherwise route to Kathryn). Stephanie 6/23.
const STEPHANIE_HOLD = ['rec19EnUk3Ouw4GZt', 'recbXuhCSBkFoKZry', 'recmnOvMpsc2f6pyV', 'recms3hkAPZoGt2ij', 'reco9FfmiHiyafUyq', 'recohvz2zqlk9YCog'];
// KC-metro cities — fallback when no county is supplied
const LANEE_KC_CITIES = ['kansas city','independence','liberty','gladstone','raytown','grandview',"lee's summit",'lees summit','blue springs','belton','overland park','shawnee','olathe','lenexa','leawood','mission','merriam'];
// ZIP → county lookup for MO + KS (generated from pgeocode/GeoNames data — 1905 entries).
// Used both to derive organizer routing AND to populate the contact's county field
// when the form only collects zip.
const MO_KS_ZIP_COUNTY = {"66732":"Allen County, KS","66742":"Allen County, KS","66748":"Allen County, KS","66749":"Allen County, KS","66751":"Allen County, KS","66755":"Allen County, KS","66772":"Allen County, KS","66015":"Anderson County, KS","66032":"Anderson County, KS","66033":"Anderson County, KS","66039":"Anderson County, KS","66091":"Anderson County, KS","66093":"Anderson County, KS","66002":"Atchison County, KS","66016":"Atchison County, KS","66023":"Atchison County, KS","66041":"Atchison County, KS","66058":"Atchison County, KS","67057":"Barber County, KS","67061":"Barber County, KS","67065":"Barber County, KS","67070":"Barber County, KS","67071":"Barber County, KS","67104":"Barber County, KS","67138":"Barber County, KS","67143":"Barber County, KS","67511":"Barton County, KS","67525":"Barton County, KS","67526":"Barton County, KS","67530":"Barton County, KS","67544":"Barton County, KS","67564":"Barton County, KS","67567":"Barton County, KS","66701":"Bourbon County, KS","66716":"Bourbon County, KS","66738":"Bourbon County, KS","66741":"Bourbon County, KS","66754":"Bourbon County, KS","66769":"Bourbon County, KS","66779":"Bourbon County, KS","66424":"Brown County, KS","66425":"Brown County, KS","66434":"Brown County, KS","66439":"Brown County, KS","66515":"Brown County, KS","66527":"Brown County, KS","66532":"Brown County, KS","66842":"Butler County, KS","67002":"Butler County, KS","67010":"Butler County, KS","67012":"Butler County, KS","67017":"Butler County, KS","67039":"Butler County, KS","67041":"Butler County, KS","67042":"Butler County, KS","67072":"Butler County, KS","67074":"Butler County, KS","67123":"Butler County, KS","67132":"Butler County, KS","67133":"Butler County, KS","67144":"Butler County, KS","67154":"Butler County, KS","66843":"Chase County, KS","66845":"Chase County, KS","66850":"Chase County, KS","66862":"Chase County, KS","66869":"Chase County, KS","67024":"Chautauqua County, KS","67334":"Chautauqua County, KS","67355":"Chautauqua County, KS","67360":"Chautauqua County, KS","67361":"Chautauqua County, KS","66713":"Cherokee County, KS","66725":"Cherokee County, KS","66728":"Cherokee County, KS","66739":"Cherokee County, KS","66770":"Cherokee County, KS","66773":"Cherokee County, KS","66778":"Cherokee County, KS","66781":"Cherokee County, KS","66782":"Cherokee County, KS","67731":"Cheyenne County, KS","67756":"Cheyenne County, KS","67831":"Clark County, KS","67840":"Clark County, KS","67865":"Clark County, KS","67432":"Clay County, KS","67447":"Clay County, KS","67458":"Clay County, KS","67468":"Clay County, KS","67487":"Clay County, KS","66901":"Cloud County, KS","66938":"Cloud County, KS","66948":"Cloud County, KS","67417":"Cloud County, KS","67445":"Cloud County, KS","67466":"Cloud County, KS","66839":"Coffey County, KS","66852":"Coffey County, KS","66856":"Coffey County, KS","66857":"Coffey County, KS","66871":"Coffey County, KS","67029":"Comanche County, KS","67127":"Comanche County, KS","67155":"Comanche County, KS","67005":"Cowley County, KS","67008":"Cowley County, KS","67019":"Cowley County, KS","67023":"Cowley County, KS","67038":"Cowley County, KS","67102":"Cowley County, KS","67131":"Cowley County, KS","67146":"Cowley County, KS","67156":"Cowley County, KS","66711":"Crawford County, KS","66712":"Crawford County, KS","66724":"Crawford County, KS","66734":"Crawford County, KS","66735":"Crawford County, KS","66743":"Crawford County, KS","66746":"Crawford County, KS","66753":"Crawford County, KS","66756":"Crawford County, KS","66760":"Crawford County, KS","66762":"Crawford County, KS","66763":"Crawford County, KS","66780":"Crawford County, KS","67635":"Decatur County, KS","67643":"Decatur County, KS","67653":"Decatur County, KS","67749":"Decatur County, KS","67410":"Dickinson County, KS","67431":"Dickinson County, KS","67441":"Dickinson County, KS","67449":"Dickinson County, KS","67451":"Dickinson County, KS","67480":"Dickinson County, KS","67482":"Dickinson County, KS","67492":"Dickinson County, KS","66008":"Doniphan County, KS","66017":"Doniphan County, KS","66024":"Doniphan County, KS","66035":"Doniphan County, KS","66087":"Doniphan County, KS","66090":"Doniphan County, KS","66094":"Doniphan County, KS","66006":"Douglas County, KS","66025":"Douglas County, KS","66044":"Douglas County, KS","66045":"Douglas County, KS","66046":"Douglas County, KS","66047":"Douglas County, KS","66049":"Douglas County, KS","66050":"Douglas County, KS","67519":"Edwards County, KS","67547":"Edwards County, KS","67552":"Edwards County, KS","67563":"Edwards County, KS","67345":"Elk County, KS","67346":"Elk County, KS","67349":"Elk County, KS","67352":"Elk County, KS","67353":"Elk County, KS","67601":"Ellis County, KS","67627":"Ellis County, KS","67637":"Ellis County, KS","67660":"Ellis County, KS","67667":"Ellis County, KS","67671":"Ellis County, KS","67674":"Ellis County, KS","67439":"Ellsworth County, KS","67450":"Ellsworth County, KS","67454":"Ellsworth County, KS","67459":"Ellsworth County, KS","67490":"Ellsworth County, KS","67846":"Finney County, KS","67851":"Finney County, KS","67868":"Finney County, KS","67801":"Ford County, KS","67834":"Ford County, KS","67842":"Ford County, KS","67843":"Ford County, KS","67876":"Ford County, KS","67882":"Ford County, KS","66042":"Franklin County, KS","66067":"Franklin County, KS","66076":"Franklin County, KS","66078":"Franklin County, KS","66079":"Franklin County, KS","66080":"Franklin County, KS","66092":"Franklin County, KS","66095":"Franklin County, KS","66441":"Geary County, KS","66442":"Geary County, KS","66514":"Geary County, KS","67736":"Gove County, KS","67737":"Gove County, KS","67738":"Gove County, KS","67751":"Gove County, KS","67752":"Gove County, KS","67625":"Graham County, KS","67642":"Graham County, KS","67650":"Graham County, KS","67659":"Graham County, KS","67880":"Grant County, KS","67835":"Gray County, KS","67837":"Gray County, KS","67841":"Gray County, KS","67853":"Gray County, KS","67867":"Gray County, KS","67879":"Greeley County, KS","66853":"Greenwood County, KS","66855":"Greenwood County, KS","66860":"Greenwood County, KS","66863":"Greenwood County, KS","66870":"Greenwood County, KS","67045":"Greenwood County, KS","67047":"Greenwood County, KS","67122":"Greenwood County, KS","67137":"Greenwood County, KS","67836":"Hamilton County, KS","67857":"Hamilton County, KS","67878":"Hamilton County, KS","67003":"Harper County, KS","67009":"Harper County, KS","67018":"Harper County, KS","67036":"Harper County, KS","67049":"Harper County, KS","67058":"Harper County, KS","67150":"Harper County, KS","67020":"Harvey County, KS","67056":"Harvey County, KS","67062":"Harvey County, KS","67114":"Harvey County, KS","67117":"Harvey County, KS","67135":"Harvey County, KS","67151":"Harvey County, KS","67870":"Haskell County, KS","67877":"Haskell County, KS","67849":"Hodgeman County, KS","67854":"Hodgeman County, KS","66416":"Jackson County, KS","66418":"Jackson County, KS","66419":"Jackson County, KS","66436":"Jackson County, KS","66440":"Jackson County, KS","66509":"Jackson County, KS","66516":"Jackson County, KS","66540":"Jackson County, KS","66552":"Jackson County, KS","66054":"Jefferson County, KS","66060":"Jefferson County, KS","66066":"Jefferson County, KS","66070":"Jefferson County, KS","66073":"Jefferson County, KS","66088":"Jefferson County, KS","66097":"Jefferson County, KS","66429":"Jefferson County, KS","66512":"Jefferson County, KS","66936":"Jewell County, KS","66941":"Jewell County, KS","66942":"Jewell County, KS","66949":"Jewell County, KS","66956":"Jewell County, KS","66963":"Jewell County, KS","66970":"Jewell County, KS","66018":"Johnson County, KS","66021":"Johnson County, KS","66030":"Johnson County, KS","66031":"Johnson County, KS","66051":"Johnson County, KS","66061":"Johnson County, KS","66062":"Johnson County, KS","66063":"Johnson County, KS","66083":"Johnson County, KS","66085":"Johnson County, KS","66201":"Johnson County, KS","66202":"Johnson County, KS","66203":"Johnson County, KS","66204":"Johnson County, KS","66205":"Johnson County, KS","66206":"Johnson County, KS","66207":"Johnson County, KS","66208":"Johnson County, KS","66209":"Johnson County, KS","66210":"Johnson County, KS","66211":"Johnson County, KS","66212":"Johnson County, KS","66213":"Johnson County, KS","66214":"Johnson County, KS","66215":"Johnson County, KS","66216":"Johnson County, KS","66217":"Johnson County, KS","66218":"Johnson County, KS","66219":"Johnson County, KS","66220":"Johnson County, KS","66221":"Johnson County, KS","66222":"Johnson County, KS","66223":"Johnson County, KS","66224":"Johnson County, KS","66225":"Johnson County, KS","66226":"Johnson County, KS","66227":"Johnson County, KS","66250":"Johnson County, KS","66251":"Johnson County, KS","66276":"Johnson County, KS","66282":"Johnson County, KS","66283":"Johnson County, KS","66285":"Johnson County, KS","66286":"Johnson County, KS","67838":"Kearny County, KS","67860":"Kearny County, KS","67035":"Kingman County, KS","67068":"Kingman County, KS","67111":"Kingman County, KS","67112":"Kingman County, KS","67118":"Kingman County, KS","67142":"Kingman County, KS","67159":"Kingman County, KS","67054":"Kiowa County, KS","67059":"Kiowa County, KS","67109":"Kiowa County, KS","67330":"Labette County, KS","67332":"Labette County, KS","67336":"Labette County, KS","67341":"Labette County, KS","67342":"Labette County, KS","67354":"Labette County, KS","67356":"Labette County, KS","67357":"Labette County, KS","67839":"Lane County, KS","67850":"Lane County, KS","66007":"Leavenworth County, KS","66020":"Leavenworth County, KS","66027":"Leavenworth County, KS","66043":"Leavenworth County, KS","66048":"Leavenworth County, KS","66052":"Leavenworth County, KS","66086":"Leavenworth County, KS","67418":"Lincoln County, KS","67423":"Lincoln County, KS","67455":"Lincoln County, KS","67481":"Lincoln County, KS","66010":"Linn County, KS","66014":"Linn County, KS","66040":"Linn County, KS","66056":"Linn County, KS","66072":"Linn County, KS","66075":"Linn County, KS","66767":"Linn County, KS","67747":"Logan County, KS","67748":"Logan County, KS","67764":"Logan County, KS","66801":"Lyon County, KS","66830":"Lyon County, KS","66833":"Lyon County, KS","66835":"Lyon County, KS","66854":"Lyon County, KS","66864":"Lyon County, KS","66865":"Lyon County, KS","66868":"Lyon County, KS","67107":"McPherson County, KS","67428":"McPherson County, KS","67443":"McPherson County, KS","67456":"McPherson County, KS","67460":"McPherson County, KS","67464":"McPherson County, KS","67476":"McPherson County, KS","67491":"McPherson County, KS","67546":"McPherson County, KS","66840":"Marion County, KS","66851":"Marion County, KS","66858":"Marion County, KS","66859":"Marion County, KS","66861":"Marion County, KS","66866":"Marion County, KS","67053":"Marion County, KS","67063":"Marion County, KS","67073":"Marion County, KS","67438":"Marion County, KS","67475":"Marion County, KS","67483":"Marion County, KS","66403":"Marshall County, KS","66406":"Marshall County, KS","66411":"Marshall County, KS","66412":"Marshall County, KS","66427":"Marshall County, KS","66438":"Marshall County, KS","66508":"Marshall County, KS","66518":"Marshall County, KS","66541":"Marshall County, KS","66544":"Marshall County, KS","66548":"Marshall County, KS","67844":"Meade County, KS","67864":"Meade County, KS","67869":"Meade County, KS","66013":"Miami County, KS","66026":"Miami County, KS","66036":"Miami County, KS","66053":"Miami County, KS","66064":"Miami County, KS","66071":"Miami County, KS","67420":"Mitchell County, KS","67430":"Mitchell County, KS","67446":"Mitchell County, KS","67452":"Mitchell County, KS","67478":"Mitchell County, KS","67485":"Mitchell County, KS","67301":"Montgomery County, KS","67333":"Montgomery County, KS","67335":"Montgomery County, KS","67337":"Montgomery County, KS","67340":"Montgomery County, KS","67344":"Montgomery County, KS","67347":"Montgomery County, KS","67351":"Montgomery County, KS","67363":"Montgomery County, KS","67364":"Montgomery County, KS","66838":"Morris County, KS","66846":"Morris County, KS","66849":"Morris County, KS","66872":"Morris County, KS","66873":"Morris County, KS","67950":"Morton County, KS","67953":"Morton County, KS","67954":"Morton County, KS","66404":"Nemaha County, KS","66408":"Nemaha County, KS","66415":"Nemaha County, KS","66417":"Nemaha County, KS","66428":"Nemaha County, KS","66522":"Nemaha County, KS","66534":"Nemaha County, KS","66538":"Nemaha County, KS","66550":"Nemaha County, KS","66720":"Neosho County, KS","66733":"Neosho County, KS","66740":"Neosho County, KS","66771":"Neosho County, KS","66775":"Neosho County, KS","66776":"Neosho County, KS","67515":"Ness County, KS","67516":"Ness County, KS","67518":"Ness County, KS","67521":"Ness County, KS","67560":"Ness County, KS","67572":"Ness County, KS","67584":"Ness County, KS","67622":"Norton County, KS","67629":"Norton County, KS","67645":"Norton County, KS","67654":"Norton County, KS","66413":"Osage County, KS","66414":"Osage County, KS","66451":"Osage County, KS","66510":"Osage County, KS","66523":"Osage County, KS","66524":"Osage County, KS","66528":"Osage County, KS","66537":"Osage County, KS","66543":"Osage County, KS","67437":"Osborne County, KS","67473":"Osborne County, KS","67474":"Osborne County, KS","67623":"Osborne County, KS","67651":"Osborne County, KS","67422":"Ottawa County, KS","67436":"Ottawa County, KS","67467":"Ottawa County, KS","67484":"Ottawa County, KS","67523":"Pawnee County, KS","67529":"Pawnee County, KS","67550":"Pawnee County, KS","67574":"Pawnee County, KS","67621":"Phillips County, KS","67639":"Phillips County, KS","67644":"Phillips County, KS","67646":"Phillips County, KS","67647":"Phillips County, KS","67661":"Phillips County, KS","67664":"Phillips County, KS","66407":"Pottawatomie County, KS","66422":"Pottawatomie County, KS","66426":"Pottawatomie County, KS","66432":"Pottawatomie County, KS","66520":"Pottawatomie County, KS","66521":"Pottawatomie County, KS","66535":"Pottawatomie County, KS","66536":"Pottawatomie County, KS","66547":"Pottawatomie County, KS","66549":"Pottawatomie County, KS","67021":"Pratt County, KS","67028":"Pratt County, KS","67066":"Pratt County, KS","67124":"Pratt County, KS","67134":"Pratt County, KS","67730":"Rawlins County, KS","67739":"Rawlins County, KS","67744":"Rawlins County, KS","67745":"Rawlins County, KS","67501":"Reno County, KS","67502":"Reno County, KS","67504":"Reno County, KS","67505":"Reno County, KS","67510":"Reno County, KS","67514":"Reno County, KS","67522":"Reno County, KS","67543":"Reno County, KS","67561":"Reno County, KS","67566":"Reno County, KS","67568":"Reno County, KS","67570":"Reno County, KS","67581":"Reno County, KS","67583":"Reno County, KS","67585":"Reno County, KS","66930":"Republic County, KS","66935":"Republic County, KS","66939":"Republic County, KS","66940":"Republic County, KS","66959":"Republic County, KS","66960":"Republic County, KS","66961":"Republic County, KS","66964":"Republic County, KS","66966":"Republic County, KS","67427":"Rice County, KS","67444":"Rice County, KS","67457":"Rice County, KS","67512":"Rice County, KS","67524":"Rice County, KS","67554":"Rice County, KS","67573":"Rice County, KS","67579":"Rice County, KS","66449":"Riley County, KS","66502":"Riley County, KS","66503":"Riley County, KS","66505":"Riley County, KS","66506":"Riley County, KS","66517":"Riley County, KS","66531":"Riley County, KS","66554":"Riley County, KS","67632":"Rooks County, KS","67657":"Rooks County, KS","67663":"Rooks County, KS","67669":"Rooks County, KS","67675":"Rooks County, KS","67513":"Rush County, KS","67520":"Rush County, KS","67548":"Rush County, KS","67553":"Rush County, KS","67556":"Rush County, KS","67559":"Rush County, KS","67565":"Rush County, KS","67575":"Rush County, KS","67626":"Russell County, KS","67634":"Russell County, KS","67640":"Russell County, KS","67648":"Russell County, KS","67649":"Russell County, KS","67658":"Russell County, KS","67665":"Russell County, KS","67673":"Russell County, KS","67401":"Saline County, KS","67402":"Saline County, KS","67416":"Saline County, KS","67425":"Saline County, KS","67442":"Saline County, KS","67448":"Saline County, KS","67470":"Saline County, KS","67871":"Scott County, KS","67001":"Sedgwick County, KS","67016":"Sedgwick County, KS","67025":"Sedgwick County, KS","67026":"Sedgwick County, KS","67030":"Sedgwick County, KS","67037":"Sedgwick County, KS","67050":"Sedgwick County, KS","67052":"Sedgwick County, KS","67055":"Sedgwick County, KS","67060":"Sedgwick County, KS","67067":"Sedgwick County, KS","67101":"Sedgwick County, KS","67108":"Sedgwick County, KS","67120":"Sedgwick County, KS","67147":"Sedgwick County, KS","67149":"Sedgwick County, KS","67201":"Sedgwick County, KS","67202":"Sedgwick County, KS","67203":"Sedgwick County, KS","67204":"Sedgwick County, KS","67205":"Sedgwick County, KS","67206":"Sedgwick County, KS","67207":"Sedgwick County, KS","67208":"Sedgwick County, KS","67209":"Sedgwick County, KS","67210":"Sedgwick County, KS","67211":"Sedgwick County, KS","67212":"Sedgwick County, KS","67213":"Sedgwick County, KS","67214":"Sedgwick County, KS","67215":"Sedgwick County, KS","67216":"Sedgwick County, KS","67217":"Sedgwick County, KS","67218":"Sedgwick County, KS","67219":"Sedgwick County, KS","67220":"Sedgwick County, KS","67221":"Sedgwick County, KS","67223":"Sedgwick County, KS","67226":"Sedgwick County, KS","67227":"Sedgwick County, KS","67228":"Sedgwick County, KS","67230":"Sedgwick County, KS","67232":"Sedgwick County, KS","67235":"Sedgwick County, KS","67260":"Sedgwick County, KS","67275":"Sedgwick County, KS","67276":"Sedgwick County, KS","67277":"Sedgwick County, KS","67278":"Sedgwick County, KS","67859":"Seward County, KS","67901":"Seward County, KS","67905":"Seward County, KS","66402":"Shawnee County, KS","66409":"Shawnee County, KS","66420":"Shawnee County, KS","66533":"Shawnee County, KS","66539":"Shawnee County, KS","66542":"Shawnee County, KS","66546":"Shawnee County, KS","66601":"Shawnee County, KS","66603":"Shawnee County, KS","66604":"Shawnee County, KS","66605":"Shawnee County, KS","66606":"Shawnee County, KS","66607":"Shawnee County, KS","66608":"Shawnee County, KS","66609":"Shawnee County, KS","66610":"Shawnee County, KS","66611":"Shawnee County, KS","66612":"Shawnee County, KS","66614":"Shawnee County, KS","66615":"Shawnee County, KS","66616":"Shawnee County, KS","66617":"Shawnee County, KS","66618":"Shawnee County, KS","66619":"Shawnee County, KS","66620":"Shawnee County, KS","66621":"Shawnee County, KS","66622":"Shawnee County, KS","66624":"Shawnee County, KS","66625":"Shawnee County, KS","66626":"Shawnee County, KS","66629":"Shawnee County, KS","66630":"Shawnee County, KS","66636":"Shawnee County, KS","66647":"Shawnee County, KS","66667":"Shawnee County, KS","66675":"Shawnee County, KS","66683":"Shawnee County, KS","66699":"Shawnee County, KS","67740":"Sheridan County, KS","67757":"Sheridan County, KS","67733":"Sherman County, KS","67735":"Sherman County, KS","67741":"Sherman County, KS","66932":"Smith County, KS","66951":"Smith County, KS","66952":"Smith County, KS","66967":"Smith County, KS","67628":"Smith County, KS","67638":"Smith County, KS","67545":"Stafford County, KS","67557":"Stafford County, KS","67576":"Stafford County, KS","67578":"Stafford County, KS","67855":"Stanton County, KS","67862":"Stanton County, KS","67951":"Stevens County, KS","67952":"Stevens County, KS","67004":"Sumner County, KS","67013":"Sumner County, KS","67022":"Sumner County, KS","67031":"Sumner County, KS","67051":"Sumner County, KS","67103":"Sumner County, KS","67105":"Sumner County, KS","67106":"Sumner County, KS","67110":"Sumner County, KS","67119":"Sumner County, KS","67140":"Sumner County, KS","67152":"Sumner County, KS","67701":"Thomas County, KS","67732":"Thomas County, KS","67734":"Thomas County, KS","67743":"Thomas County, KS","67753":"Thomas County, KS","67631":"Trego County, KS","67656":"Trego County, KS","67672":"Trego County, KS","66401":"Wabaunsee County, KS","66423":"Wabaunsee County, KS","66431":"Wabaunsee County, KS","66501":"Wabaunsee County, KS","66507":"Wabaunsee County, KS","66526":"Wabaunsee County, KS","66834":"Wabaunsee County, KS","67758":"Wallace County, KS","67761":"Wallace County, KS","67762":"Wallace County, KS","66933":"Washington County, KS","66937":"Washington County, KS","66943":"Washington County, KS","66944":"Washington County, KS","66945":"Washington County, KS","66946":"Washington County, KS","66953":"Washington County, KS","66955":"Washington County, KS","66958":"Washington County, KS","66962":"Washington County, KS","66968":"Washington County, KS","67861":"Wichita County, KS","67863":"Wichita County, KS","66710":"Wilson County, KS","66714":"Wilson County, KS","66717":"Wilson County, KS","66736":"Wilson County, KS","66757":"Wilson County, KS","66759":"Wilson County, KS","66758":"Woodson County, KS","66761":"Woodson County, KS","66777":"Woodson County, KS","66783":"Woodson County, KS","66012":"Wyandotte County, KS","66101":"Wyandotte County, KS","66102":"Wyandotte County, KS","66103":"Wyandotte County, KS","66104":"Wyandotte County, KS","66105":"Wyandotte County, KS","66106":"Wyandotte County, KS","66109":"Wyandotte County, KS","66110":"Wyandotte County, KS","66111":"Wyandotte County, KS","66112":"Wyandotte County, KS","66113":"Wyandotte County, KS","66115":"Wyandotte County, KS","66117":"Wyandotte County, KS","66118":"Wyandotte County, KS","66119":"Wyandotte County, KS","66160":"Wyandotte County, KS","63501":"Adair County, MO","63533":"Adair County, MO","63540":"Adair County, MO","63546":"Adair County, MO","63559":"Adair County, MO","64421":"Andrew County, MO","64427":"Andrew County, MO","64436":"Andrew County, MO","64449":"Andrew County, MO","64459":"Andrew County, MO","64480":"Andrew County, MO","64483":"Andrew County, MO","64485":"Andrew County, MO","64506":"Andrew County, MO","64446":"Atchison County, MO","64482":"Atchison County, MO","64491":"Atchison County, MO","64496":"Atchison County, MO","64498":"Atchison County, MO","63345":"Audrain County, MO","63352":"Audrain County, MO","63382":"Audrain County, MO","65232":"Audrain County, MO","65264":"Audrain County, MO","65265":"Audrain County, MO","65280":"Audrain County, MO","65285":"Audrain County, MO","64874":"Barry County, MO","65623":"Barry County, MO","65625":"Barry County, MO","65641":"Barry County, MO","65647":"Barry County, MO","65658":"Barry County, MO","65708":"Barry County, MO","65734":"Barry County, MO","65745":"Barry County, MO","65747":"Barry County, MO","65772":"Barry County, MO","64748":"Barton County, MO","64759":"Barton County, MO","64762":"Barton County, MO","64766":"Barton County, MO","64769":"Barton County, MO","64720":"Bates County, MO","64722":"Bates County, MO","64723":"Bates County, MO","64730":"Bates County, MO","64742":"Bates County, MO","64745":"Bates County, MO","64752":"Bates County, MO","64779":"Bates County, MO","64780":"Bates County, MO","65325":"Benton County, MO","65326":"Benton County, MO","65335":"Benton County, MO","65338":"Benton County, MO","65355":"Benton County, MO","63662":"Bollinger County, MO","63750":"Bollinger County, MO","63751":"Bollinger County, MO","63760":"Bollinger County, MO","63764":"Bollinger County, MO","63781":"Bollinger County, MO","63782":"Bollinger County, MO","63787":"Bollinger County, MO","65010":"Boone County, MO","65039":"Boone County, MO","65201":"Boone County, MO","65202":"Boone County, MO","65203":"Boone County, MO","65205":"Boone County, MO","65211":"Boone County, MO","65212":"Boone County, MO","65215":"Boone County, MO","65216":"Boone County, MO","65217":"Boone County, MO","65218":"Boone County, MO","65240":"Boone County, MO","65255":"Boone County, MO","65256":"Boone County, MO","65279":"Boone County, MO","65284":"Boone County, MO","65299":"Boone County, MO","64401":"Buchanan County, MO","64440":"Buchanan County, MO","64443":"Buchanan County, MO","64448":"Buchanan County, MO","64484":"Buchanan County, MO","64501":"Buchanan County, MO","64502":"Buchanan County, MO","64503":"Buchanan County, MO","64504":"Buchanan County, MO","64505":"Buchanan County, MO","64507":"Buchanan County, MO","64508":"Buchanan County, MO","63901":"Butler County, MO","63902":"Butler County, MO","63932":"Butler County, MO","63938":"Butler County, MO","63940":"Butler County, MO","63945":"Butler County, MO","63954":"Butler County, MO","63961":"Butler County, MO","63962":"Butler County, MO","64624":"Caldwell County, MO","64625":"Caldwell County, MO","64637":"Caldwell County, MO","64644":"Caldwell County, MO","64649":"Caldwell County, MO","64650":"Caldwell County, MO","64671":"Caldwell County, MO","63388":"Callaway County, MO","65043":"Callaway County, MO","65059":"Callaway County, MO","65063":"Callaway County, MO","65067":"Callaway County, MO","65077":"Callaway County, MO","65080":"Callaway County, MO","65231":"Callaway County, MO","65251":"Callaway County, MO","65262":"Callaway County, MO","65020":"Camden County, MO","65049":"Camden County, MO","65052":"Camden County, MO","65065":"Camden County, MO","65079":"Camden County, MO","65324":"Camden County, MO","65567":"Camden County, MO","65591":"Camden County, MO","65786":"Camden County, MO","65787":"Camden County, MO","63701":"Cape Girardeau County, MO","63702":"Cape Girardeau County, MO","63703":"Cape Girardeau County, MO","63739":"Cape Girardeau County, MO","63743":"Cape Girardeau County, MO","63744":"Cape Girardeau County, MO","63745":"Cape Girardeau County, MO","63747":"Cape Girardeau County, MO","63752":"Cape Girardeau County, MO","63755":"Cape Girardeau County, MO","63766":"Cape Girardeau County, MO","63769":"Cape Girardeau County, MO","63770":"Cape Girardeau County, MO","63779":"Cape Girardeau County, MO","63785":"Cape Girardeau County, MO","64622":"Carroll County, MO","64623":"Carroll County, MO","64633":"Carroll County, MO","64639":"Carroll County, MO","64643":"Carroll County, MO","64668":"Carroll County, MO","64680":"Carroll County, MO","64682":"Carroll County, MO","63937":"Carter County, MO","63941":"Carter County, MO","63943":"Carter County, MO","63965":"Carter County, MO","64012":"Cass County, MO","64078":"Cass County, MO","64080":"Cass County, MO","64083":"Cass County, MO","64090":"Cass County, MO","64701":"Cass County, MO","64725":"Cass County, MO","64734":"Cass County, MO","64739":"Cass County, MO","64743":"Cass County, MO","64746":"Cass County, MO","64747":"Cass County, MO","64744":"Cedar County, MO","64756":"Cedar County, MO","65607":"Cedar County, MO","65785":"Cedar County, MO","64660":"Chariton County, MO","64676":"Chariton County, MO","64681":"Chariton County, MO","65236":"Chariton County, MO","65246":"Chariton County, MO","65261":"Chariton County, MO","65281":"Chariton County, MO","65286":"Chariton County, MO","65610":"Christian County, MO","65620":"Christian County, MO","65629":"Christian County, MO","65630":"Christian County, MO","65631":"Christian County, MO","65657":"Christian County, MO","65669":"Christian County, MO","65714":"Christian County, MO","65720":"Christian County, MO","65721":"Christian County, MO","65753":"Christian County, MO","65754":"Christian County, MO","72643":"Christian County, MO","63430":"Clark County, MO","63445":"Clark County, MO","63453":"Clark County, MO","63465":"Clark County, MO","63466":"Clark County, MO","63472":"Clark County, MO","63474":"Clark County, MO","64024":"Clay County, MO","64048":"Clay County, MO","64060":"Clay County, MO","64068":"Clay County, MO","64069":"Clay County, MO","64072":"Clay County, MO","64073":"Clay County, MO","64089":"Clay County, MO","64116":"Clay County, MO","64117":"Clay County, MO","64118":"Clay County, MO","64119":"Clay County, MO","64144":"Clay County, MO","64155":"Clay County, MO","64156":"Clay County, MO","64157":"Clay County, MO","64158":"Clay County, MO","64161":"Clay County, MO","64162":"Clay County, MO","64165":"Clay County, MO","64166":"Clay County, MO","64167":"Clay County, MO","64429":"Clinton County, MO","64454":"Clinton County, MO","64465":"Clinton County, MO","64477":"Clinton County, MO","64492":"Clinton County, MO","64493":"Clinton County, MO","65023":"Cole County, MO","65032":"Cole County, MO","65040":"Cole County, MO","65053":"Cole County, MO","65074":"Cole County, MO","65076":"Cole County, MO","65101":"Cole County, MO","65102":"Cole County, MO","65103":"Cole County, MO","65104":"Cole County, MO","65105":"Cole County, MO","65106":"Cole County, MO","65107":"Cole County, MO","65108":"Cole County, MO","65109":"Cole County, MO","65110":"Cole County, MO","65111":"Cole County, MO","65068":"Cooper County, MO","65233":"Cooper County, MO","65237":"Cooper County, MO","65276":"Cooper County, MO","65287":"Cooper County, MO","65322":"Cooper County, MO","65348":"Cooper County, MO","65441":"Crawford County, MO","65446":"Crawford County, MO","65449":"Crawford County, MO","65453":"Crawford County, MO","65456":"Crawford County, MO","65535":"Crawford County, MO","65565":"Crawford County, MO","65586":"Crawford County, MO","65603":"Dade County, MO","65635":"Dade County, MO","65646":"Dade County, MO","65661":"Dade County, MO","65682":"Dade County, MO","65752":"Dade County, MO","65590":"Dallas County, MO","65622":"Dallas County, MO","65685":"Dallas County, MO","65764":"Dallas County, MO","65767":"Dallas County, MO","65783":"Dallas County, MO","64620":"Daviess County, MO","64636":"Daviess County, MO","64640":"Daviess County, MO","64642":"Daviess County, MO","64647":"Daviess County, MO","64648":"Daviess County, MO","64654":"Daviess County, MO","64670":"Daviess County, MO","64689":"Daviess County, MO","64422":"DeKalb County, MO","64430":"DeKalb County, MO","64469":"DeKalb County, MO","64474":"DeKalb County, MO","64490":"DeKalb County, MO","64494":"DeKalb County, MO","64497":"DeKalb County, MO","65440":"Dent County, MO","65501":"Dent County, MO","65532":"Dent County, MO","65541":"Dent County, MO","65560":"Dent County, MO","65608":"Douglas County, MO","65638":"Douglas County, MO","65755":"Douglas County, MO","65768":"Douglas County, MO","63821":"Dunklin County, MO","63829":"Dunklin County, MO","63837":"Dunklin County, MO","63847":"Dunklin County, MO","63852":"Dunklin County, MO","63855":"Dunklin County, MO","63857":"Dunklin County, MO","63863":"Dunklin County, MO","63875":"Dunklin County, MO","63876":"Dunklin County, MO","63880":"Dunklin County, MO","63933":"Dunklin County, MO","63013":"Franklin County, MO","63014":"Franklin County, MO","63015":"Franklin County, MO","63037":"Franklin County, MO","63039":"Franklin County, MO","63055":"Franklin County, MO","63056":"Franklin County, MO","63060":"Franklin County, MO","63061":"Franklin County, MO","63068":"Franklin County, MO","63069":"Franklin County, MO","63072":"Franklin County, MO","63073":"Franklin County, MO","63077":"Franklin County, MO","63079":"Franklin County, MO","63080":"Franklin County, MO","63084":"Franklin County, MO","63089":"Franklin County, MO","63090":"Franklin County, MO","63091":"Gasconade County, MO","65014":"Gasconade County, MO","65036":"Gasconade County, MO","65041":"Gasconade County, MO","65061":"Gasconade County, MO","65062":"Gasconade County, MO","65066":"Gasconade County, MO","64402":"Gentry County, MO","64438":"Gentry County, MO","64453":"Gentry County, MO","64463":"Gentry County, MO","64489":"Gentry County, MO","64657":"Gentry County, MO","65604":"Greene County, MO","65612":"Greene County, MO","65619":"Greene County, MO","65648":"Greene County, MO","65738":"Greene County, MO","65757":"Greene County, MO","65765":"Greene County, MO","65770":"Greene County, MO","65781":"Greene County, MO","65801":"Greene County, MO","65802":"Greene County, MO","65803":"Greene County, MO","65804":"Greene County, MO","65805":"Greene County, MO","65806":"Greene County, MO","65807":"Greene County, MO","65808":"Greene County, MO","65809":"Greene County, MO","65810":"Greene County, MO","65814":"Greene County, MO","65817":"Greene County, MO","65890":"Greene County, MO","65897":"Greene County, MO","65898":"Greene County, MO","65899":"Greene County, MO","64641":"Grundy County, MO","64652":"Grundy County, MO","64679":"Grundy County, MO","64683":"Grundy County, MO","64424":"Harrison County, MO","64426":"Harrison County, MO","64442":"Harrison County, MO","64458":"Harrison County, MO","64467":"Harrison County, MO","64471":"Harrison County, MO","64481":"Harrison County, MO","64632":"Harrison County, MO","64726":"Henry County, MO","64735":"Henry County, MO","64740":"Henry County, MO","64770":"Henry County, MO","64788":"Henry County, MO","65323":"Henry County, MO","65360":"Henry County, MO","65634":"Hickory County, MO","65668":"Hickory County, MO","65724":"Hickory County, MO","65732":"Hickory County, MO","65735":"Hickory County, MO","65774":"Hickory County, MO","65779":"Hickory County, MO","64437":"Holt County, MO","64451":"Holt County, MO","64466":"Holt County, MO","64470":"Holt County, MO","64473":"Holt County, MO","65230":"Howard County, MO","65248":"Howard County, MO","65250":"Howard County, MO","65254":"Howard County, MO","65274":"Howard County, MO","65548":"Howell County, MO","65626":"Howell County, MO","65688":"Howell County, MO","65775":"Howell County, MO","65777":"Howell County, MO","65788":"Howell County, MO","65789":"Howell County, MO","65790":"Howell County, MO","65793":"Howell County, MO","63620":"Iron County, MO","63621":"Iron County, MO","63623":"Iron County, MO","63636":"Iron County, MO","63650":"Iron County, MO","63656":"Iron County, MO","63663":"Iron County, MO","63675":"Iron County, MO","65439":"Iron County, MO","65566":"Iron County, MO","64002":"Jackson County, MO","64013":"Jackson County, MO","64014":"Jackson County, MO","64015":"Jackson County, MO","64016":"Jackson County, MO","64029":"Jackson County, MO","64030":"Jackson County, MO","64034":"Jackson County, MO","64050":"Jackson County, MO","64051":"Jackson County, MO","64052":"Jackson County, MO","64053":"Jackson County, MO","64054":"Jackson County, MO","64055":"Jackson County, MO","64056":"Jackson County, MO","64057":"Jackson County, MO","64058":"Jackson County, MO","64063":"Jackson County, MO","64064":"Jackson County, MO","64065":"Jackson County, MO","64066":"Jackson County, MO","64070":"Jackson County, MO","64075":"Jackson County, MO","64081":"Jackson County, MO","64082":"Jackson County, MO","64086":"Jackson County, MO","64088":"Jackson County, MO","64101":"Jackson County, MO","64102":"Jackson County, MO","64105":"Jackson County, MO","64106":"Jackson County, MO","64108":"Jackson County, MO","64109":"Jackson County, MO","64110":"Jackson County, MO","64111":"Jackson County, MO","64112":"Jackson County, MO","64113":"Jackson County, MO","64114":"Jackson County, MO","64120":"Jackson County, MO","64121":"Jackson County, MO","64123":"Jackson County, MO","64124":"Jackson County, MO","64125":"Jackson County, MO","64126":"Jackson County, MO","64127":"Jackson County, MO","64128":"Jackson County, MO","64129":"Jackson County, MO","64130":"Jackson County, MO","64131":"Jackson County, MO","64132":"Jackson County, MO","64133":"Jackson County, MO","64134":"Jackson County, MO","64136":"Jackson County, MO","64137":"Jackson County, MO","64138":"Jackson County, MO","64139":"Jackson County, MO","64141":"Jackson County, MO","64145":"Jackson County, MO","64146":"Jackson County, MO","64147":"Jackson County, MO","64148":"Jackson County, MO","64149":"Jackson County, MO","64170":"Jackson County, MO","64171":"Jackson County, MO","64179":"Jackson County, MO","64180":"Jackson County, MO","64184":"Jackson County, MO","64187":"Jackson County, MO","64188":"Jackson County, MO","64191":"Jackson County, MO","64196":"Jackson County, MO","64197":"Jackson County, MO","64198":"Jackson County, MO","64199":"Jackson County, MO","64999":"Jackson County, MO","64755":"Jasper County, MO","64801":"Jasper County, MO","64802":"Jasper County, MO","64803":"Jasper County, MO","64804":"Jasper County, MO","64830":"Jasper County, MO","64832":"Jasper County, MO","64833":"Jasper County, MO","64834":"Jasper County, MO","64835":"Jasper County, MO","64836":"Jasper County, MO","64841":"Jasper County, MO","64848":"Jasper County, MO","64849":"Jasper County, MO","64855":"Jasper County, MO","64857":"Jasper County, MO","64859":"Jasper County, MO","64862":"Jasper County, MO","64870":"Jasper County, MO","63010":"Jefferson County, MO","63012":"Jefferson County, MO","63016":"Jefferson County, MO","63019":"Jefferson County, MO","63020":"Jefferson County, MO","63023":"Jefferson County, MO","63028":"Jefferson County, MO","63030":"Jefferson County, MO","63041":"Jefferson County, MO","63047":"Jefferson County, MO","63048":"Jefferson County, MO","63049":"Jefferson County, MO","63050":"Jefferson County, MO","63051":"Jefferson County, MO","63052":"Jefferson County, MO","63053":"Jefferson County, MO","63057":"Jefferson County, MO","63065":"Jefferson County, MO","63066":"Jefferson County, MO","63070":"Jefferson County, MO","64019":"Johnson County, MO","64040":"Johnson County, MO","64061":"Johnson County, MO","64093":"Johnson County, MO","64733":"Johnson County, MO","64761":"Johnson County, MO","65305":"Johnson County, MO","65336":"Johnson County, MO","63446":"Knox County, MO","63458":"Knox County, MO","63460":"Knox County, MO","63464":"Knox County, MO","63531":"Knox County, MO","63537":"Knox County, MO","63547":"Knox County, MO","65463":"Laclede County, MO","65470":"Laclede County, MO","65536":"Laclede County, MO","65543":"Laclede County, MO","65632":"Laclede County, MO","65722":"Laclede County, MO","64001":"Lafayette County, MO","64010":"Jackson County, MO","64011":"Lafayette County, MO","64020":"Lafayette County, MO","64021":"Lafayette County, MO","64022":"Lafayette County, MO","64037":"Lafayette County, MO","64067":"Lafayette County, MO","64071":"Lafayette County, MO","64074":"Lafayette County, MO","64076":"Lafayette County, MO","64096":"Lafayette County, MO","64097":"Lafayette County, MO","65327":"Lafayette County, MO","65605":"Lawrence County, MO","65654":"Lawrence County, MO","65664":"Lawrence County, MO","65705":"Lawrence County, MO","65707":"Lawrence County, MO","65712":"Lawrence County, MO","65723":"Lawrence County, MO","65756":"Lawrence County, MO","65769":"Lawrence County, MO","63435":"Lewis County, MO","63438":"Lewis County, MO","63440":"Lewis County, MO","63447":"Lewis County, MO","63448":"Lewis County, MO","63452":"Lewis County, MO","63457":"Lewis County, MO","63473":"Lewis County, MO","63343":"Lincoln County, MO","63347":"Lincoln County, MO","63349":"Lincoln County, MO","63362":"Lincoln County, MO","63369":"Lincoln County, MO","63370":"Lincoln County, MO","63377":"Lincoln County, MO","63379":"Lincoln County, MO","63381":"Lincoln County, MO","63387":"Lincoln County, MO","63389":"Lincoln County, MO","63557":"Linn County, MO","64628":"Linn County, MO","64630":"Linn County, MO","64631":"Linn County, MO","64651":"Linn County, MO","64653":"Linn County, MO","64658":"Linn County, MO","64659":"Linn County, MO","64674":"Linn County, MO","64601":"Livingston County, MO","64635":"Livingston County, MO","64638":"Livingston County, MO","64656":"Livingston County, MO","64664":"Livingston County, MO","64686":"Livingston County, MO","64688":"Livingston County, MO","64831":"McDonald County, MO","64843":"McDonald County, MO","64847":"McDonald County, MO","64854":"McDonald County, MO","64856":"McDonald County, MO","64861":"McDonald County, MO","64863":"McDonald County, MO","64868":"McDonald County, MO","65730":"McDonald County, MO","63431":"Macon County, MO","63530":"Macon County, MO","63532":"Macon County, MO","63534":"Macon County, MO","63538":"Macon County, MO","63539":"Macon County, MO","63549":"Macon County, MO","63552":"Macon County, MO","63558":"Macon County, MO","65247":"Macon County, MO","63645":"Madison County, MO","63655":"Madison County, MO","65013":"Maries County, MO","65443":"Maries County, MO","65580":"Maries County, MO","65582":"Maries County, MO","63401":"Marion County, MO","63454":"Marion County, MO","63461":"Marion County, MO","63463":"Marion County, MO","63471":"Marion County, MO","64661":"Mercer County, MO","64673":"Mercer County, MO","65017":"Miller County, MO","65026":"Miller County, MO","65047":"Miller County, MO","65064":"Miller County, MO","65075":"Miller County, MO","65082":"Miller County, MO","65083":"Miller County, MO","65486":"Miller County, MO","63820":"Mississippi County, MO","63823":"Mississippi County, MO","63834":"Mississippi County, MO","63845":"Mississippi County, MO","63881":"Mississippi County, MO","63882":"Mississippi County, MO","65018":"Moniteau County, MO","65025":"Moniteau County, MO","65034":"Moniteau County, MO","65042":"Moniteau County, MO","65046":"Moniteau County, MO","65050":"Moniteau County, MO","65055":"Moniteau County, MO","65081":"Moniteau County, MO","63456":"Monroe County, MO","65258":"Monroe County, MO","65263":"Monroe County, MO","65275":"Monroe County, MO","65282":"Monroe County, MO","65283":"Monroe County, MO","63333":"Montgomery County, MO","63350":"Montgomery County, MO","63351":"Montgomery County, MO","63359":"Montgomery County, MO","63361":"Montgomery County, MO","63363":"Montgomery County, MO","63384":"Montgomery County, MO","65069":"Montgomery County, MO","65011":"Morgan County, MO","65037":"Morgan County, MO","65038":"Morgan County, MO","65072":"Morgan County, MO","65078":"Morgan County, MO","65084":"Morgan County, MO","65329":"Morgan County, MO","65354":"Morgan County, MO","63828":"New Madrid County, MO","63833":"New Madrid County, MO","63848":"New Madrid County, MO","63860":"New Madrid County, MO","63862":"New Madrid County, MO","63866":"New Madrid County, MO","63867":"New Madrid County, MO","63868":"New Madrid County, MO","63869":"New Madrid County, MO","63870":"New Madrid County, MO","63873":"New Madrid County, MO","63874":"New Madrid County, MO","63878":"New Madrid County, MO","64840":"Newton County, MO","64842":"Newton County, MO","64844":"Newton County, MO","64850":"Newton County, MO","64853":"Newton County, MO","64858":"Newton County, MO","64864":"Newton County, MO","64865":"Newton County, MO","64866":"Newton County, MO","64867":"Newton County, MO","64873":"Newton County, MO","64423":"Nodaway County, MO","64428":"Nodaway County, MO","64431":"Nodaway County, MO","64432":"Nodaway County, MO","64433":"Nodaway County, MO","64434":"Nodaway County, MO","64445":"Nodaway County, MO","64455":"Nodaway County, MO","64457":"Nodaway County, MO","64461":"Nodaway County, MO","64468":"Nodaway County, MO","64475":"Nodaway County, MO","64476":"Nodaway County, MO","64479":"Nodaway County, MO","64487":"Nodaway County, MO","65606":"Oregon County, MO","65690":"Oregon County, MO","65692":"Oregon County, MO","65778":"Oregon County, MO","65791":"Oregon County, MO","65001":"Osage County, MO","65016":"Osage County, MO","65024":"Osage County, MO","65035":"Osage County, MO","65048":"Osage County, MO","65051":"Osage County, MO","65054":"Osage County, MO","65058":"Osage County, MO","65085":"Osage County, MO","65609":"Ozark County, MO","65618":"Ozark County, MO","65637":"Ozark County, MO","65655":"Ozark County, MO","65666":"Ozark County, MO","65676":"Ozark County, MO","65715":"Ozark County, MO","65729":"Ozark County, MO","65741":"Ozark County, MO","65760":"Ozark County, MO","65761":"Ozark County, MO","65762":"Ozark County, MO","65766":"Ozark County, MO","65773":"Ozark County, MO","65784":"Ozark County, MO","63826":"Pemiscot County, MO","63827":"Pemiscot County, MO","63830":"Pemiscot County, MO","63839":"Pemiscot County, MO","63840":"Pemiscot County, MO","63849":"Pemiscot County, MO","63851":"Pemiscot County, MO","63853":"Pemiscot County, MO","63877":"Pemiscot County, MO","63879":"Pemiscot County, MO","63732":"Perry County, MO","63737":"Perry County, MO","63746":"Perry County, MO","63748":"Perry County, MO","63775":"Perry County, MO","63776":"Perry County, MO","63783":"Perry County, MO","65301":"Pettis County, MO","65302":"Pettis County, MO","65332":"Pettis County, MO","65333":"Pettis County, MO","65334":"Pettis County, MO","65337":"Pettis County, MO","65345":"Pettis County, MO","65350":"Pettis County, MO","65401":"Phelps County, MO","65402":"Phelps County, MO","65409":"Phelps County, MO","65436":"Phelps County, MO","65461":"Phelps County, MO","65462":"Phelps County, MO","65529":"Phelps County, MO","65550":"Phelps County, MO","65559":"Phelps County, MO","63330":"Pike County, MO","63334":"Pike County, MO","63336":"Pike County, MO","63339":"Pike County, MO","63344":"Pike County, MO","63353":"Pike County, MO","63433":"Pike County, MO","63441":"Pike County, MO","64018":"Platte County, MO","64028":"Platte County, MO","64079":"Platte County, MO","64092":"Platte County, MO","64098":"Platte County, MO","64150":"Platte County, MO","64151":"Platte County, MO","64152":"Platte County, MO","64153":"Platte County, MO","64154":"Platte County, MO","64163":"Platte County, MO","64164":"Platte County, MO","64168":"Platte County, MO","64190":"Platte County, MO","64195":"Platte County, MO","64439":"Platte County, MO","64444":"Platte County, MO","65601":"Polk County, MO","65613":"Polk County, MO","65617":"Polk County, MO","65640":"Polk County, MO","65645":"Polk County, MO","65649":"Polk County, MO","65650":"Polk County, MO","65663":"Polk County, MO","65674":"Polk County, MO","65710":"Polk County, MO","65725":"Polk County, MO","65727":"Polk County, MO","65452":"Pulaski County, MO","65457":"Pulaski County, MO","65459":"Pulaski County, MO","65473":"Pulaski County, MO","65534":"Pulaski County, MO","65556":"Pulaski County, MO","65583":"Pulaski County, MO","65584":"Pulaski County, MO","63551":"Putnam County, MO","63565":"Putnam County, MO","63567":"Putnam County, MO","64655":"Putnam County, MO","64672":"Putnam County, MO","63436":"Ralls County, MO","63459":"Ralls County, MO","63462":"Ralls County, MO","63467":"Ralls County, MO","65239":"Randolph County, MO","65243":"Randolph County, MO","65244":"Randolph County, MO","65257":"Randolph County, MO","65259":"Randolph County, MO","65260":"Randolph County, MO","65270":"Randolph County, MO","65278":"Randolph County, MO","64017":"Ray County, MO","64035":"Ray County, MO","64036":"Ray County, MO","64062":"Ray County, MO","64077":"Ray County, MO","64084":"Ray County, MO","64085":"Ray County, MO","63625":"Reynolds County, MO","63629":"Reynolds County, MO","63633":"Reynolds County, MO","63638":"Reynolds County, MO","63654":"Reynolds County, MO","63665":"Reynolds County, MO","63666":"Reynolds County, MO","63931":"Ripley County, MO","63935":"Ripley County, MO","63939":"Ripley County, MO","63942":"Ripley County, MO","63953":"Ripley County, MO","63955":"Ripley County, MO","63301":"St. Charles County, MO","63302":"St. Charles County, MO","63303":"St. Charles County, MO","63304":"St. Charles County, MO","63332":"St. Charles County, MO","63338":"St. Charles County, MO","63341":"St. Charles County, MO","63346":"St. Charles County, MO","63348":"St. Charles County, MO","63365":"St. Charles County, MO","63366":"St. Charles County, MO","63367":"St. Charles County, MO","63368":"St. Charles County, MO","63373":"St. Charles County, MO","63376":"St. Charles County, MO","63385":"St. Charles County, MO","63386":"St. Charles County, MO","64724":"St. Clair County, MO","64738":"St. Clair County, MO","64763":"St. Clair County, MO","64776":"St. Clair County, MO","64781":"St. Clair County, MO","63627":"Ste. Genevieve County, MO","63670":"Ste. Genevieve County, MO","63673":"Ste. Genevieve County, MO","63036":"St. Francois County, MO","63087":"St. Francois County, MO","63601":"St. Francois County, MO","63624":"St. Francois County, MO","63626":"St. Francois County, MO","63628":"St. Francois County, MO","63637":"St. Francois County, MO","63640":"St. Francois County, MO","63651":"St. Francois County, MO","63653":"St. Francois County, MO","63005":"St. Louis County, MO","63006":"St. Louis County, MO","63011":"St. Louis County, MO","63017":"St. Louis County, MO","63021":"St. Louis County, MO","63022":"St. Louis County, MO","63024":"St. Louis County, MO","63025":"St. Louis County, MO","63026":"St. Louis County, MO","63031":"St. Louis County, MO","63032":"St. Louis County, MO","63033":"St. Louis County, MO","63034":"St. Louis County, MO","63038":"St. Louis County, MO","63040":"St. Louis County, MO","63042":"St. Louis County, MO","63043":"St. Louis County, MO","63044":"St. Louis County, MO","63045":"St. Louis County, MO","63074":"St. Louis County, MO","63088":"St. Louis County, MO","63099":"St. Louis County, MO","63105":"St. Louis County, MO","63114":"St. Louis County, MO","63117":"St. Louis County, MO","63119":"St. Louis County, MO","63121":"St. Louis County, MO","63122":"St. Louis County, MO","63123":"St. Louis County, MO","63124":"St. Louis County, MO","63125":"St. Louis County, MO","63126":"St. Louis County, MO","63127":"St. Louis County, MO","63128":"St. Louis County, MO","63129":"St. Louis County, MO","63130":"St. Louis County, MO","63131":"St. Louis County, MO","63132":"St. Louis County, MO","63133":"St. Louis County, MO","63134":"St. Louis County, MO","63135":"St. Louis County, MO","63136":"St. Louis County, MO","63137":"St. Louis County, MO","63138":"St. Louis County, MO","63140":"St. Louis County, MO","63141":"St. Louis County, MO","63143":"St. Louis County, MO","63144":"St. Louis County, MO","63145":"St. Louis County, MO","63146":"St. Louis County, MO","63151":"St. Louis County, MO","63167":"St. Louis County, MO","65320":"Saline County, MO","65321":"Saline County, MO","65330":"Saline County, MO","65339":"Saline County, MO","65340":"Saline County, MO","65344":"Saline County, MO","65347":"Saline County, MO","65349":"Saline County, MO","65351":"Saline County, MO","63535":"Schuyler County, MO","63536":"Schuyler County, MO","63541":"Schuyler County, MO","63548":"Schuyler County, MO","63561":"Schuyler County, MO","63432":"Scotland County, MO","63442":"Scotland County, MO","63543":"Scotland County, MO","63555":"Scotland County, MO","63563":"Scotland County, MO","63736":"Scott County, MO","63740":"Scott County, MO","63742":"Scott County, MO","63758":"Scott County, MO","63767":"Scott County, MO","63771":"Scott County, MO","63774":"Scott County, MO","63780":"Scott County, MO","63784":"Scott County, MO","63801":"Scott County, MO","63824":"Scott County, MO","65438":"Shannon County, MO","65466":"Shannon County, MO","65546":"Shannon County, MO","65588":"Shannon County, MO","63434":"Shelby County, MO","63437":"Shelby County, MO","63439":"Shelby County, MO","63443":"Shelby County, MO","63450":"Shelby County, MO","63451":"Shelby County, MO","63468":"Shelby County, MO","63469":"Shelby County, MO","63730":"Stoddard County, MO","63735":"Stoddard County, MO","63738":"Stoddard County, MO","63822":"Stoddard County, MO","63825":"Stoddard County, MO","63841":"Stoddard County, MO","63846":"Stoddard County, MO","63850":"Stoddard County, MO","63936":"Stoddard County, MO","63960":"Stoddard County, MO","65611":"Stone County, MO","65624":"Stone County, MO","65633":"Stone County, MO","65656":"Stone County, MO","65675":"Stone County, MO","65681":"Stone County, MO","65686":"Stone County, MO","65728":"Stone County, MO","65737":"Stone County, MO","63544":"Sullivan County, MO","63545":"Sullivan County, MO","63556":"Sullivan County, MO","63560":"Sullivan County, MO","63566":"Sullivan County, MO","64645":"Sullivan County, MO","64646":"Sullivan County, MO","64667":"Sullivan County, MO","65614":"Taney County, MO","65615":"Taney County, MO","65616":"Taney County, MO","65627":"Taney County, MO","65653":"Taney County, MO","65672":"Taney County, MO","65673":"Taney County, MO","65679":"Taney County, MO","65680":"Taney County, MO","65726":"Taney County, MO","65731":"Taney County, MO","65733":"Taney County, MO","65739":"Taney County, MO","65740":"Taney County, MO","65744":"Taney County, MO","65759":"Taney County, MO","65771":"Taney County, MO","65444":"Texas County, MO","65464":"Texas County, MO","65468":"Texas County, MO","65479":"Texas County, MO","65483":"Texas County, MO","65484":"Texas County, MO","65542":"Texas County, MO","65552":"Texas County, MO","65555":"Texas County, MO","65557":"Texas County, MO","65564":"Texas County, MO","65570":"Texas County, MO","65571":"Texas County, MO","65589":"Texas County, MO","65689":"Texas County, MO","64728":"Vernon County, MO","64741":"Vernon County, MO","64750":"Vernon County, MO","64765":"Vernon County, MO","64767":"Vernon County, MO","64771":"Vernon County, MO","64772":"Vernon County, MO","64778":"Vernon County, MO","64783":"Vernon County, MO","64784":"Vernon County, MO","64790":"Vernon County, MO","63342":"Warren County, MO","63357":"Warren County, MO","63378":"Warren County, MO","63380":"Warren County, MO","63383":"Warren County, MO","63390":"Warren County, MO","63071":"Washington County, MO","63622":"Washington County, MO","63630":"Washington County, MO","63631":"Washington County, MO","63648":"Washington County, MO","63660":"Washington County, MO","63664":"Washington County, MO","63674":"Washington County, MO","63632":"Wayne County, MO","63763":"Wayne County, MO","63934":"Wayne County, MO","63944":"Wayne County, MO","63950":"Wayne County, MO","63951":"Wayne County, MO","63952":"Wayne County, MO","63956":"Wayne County, MO","63957":"Wayne County, MO","63964":"Wayne County, MO","63966":"Wayne County, MO","63967":"Wayne County, MO","65636":"Webster County, MO","65644":"Webster County, MO","65652":"Webster County, MO","65706":"Webster County, MO","65713":"Webster County, MO","65742":"Webster County, MO","65746":"Webster County, MO","64420":"Worth County, MO","64441":"Worth County, MO","64456":"Worth County, MO","64486":"Worth County, MO","64499":"Worth County, MO","65660":"Wright County, MO","65662":"Wright County, MO","65667":"Wright County, MO","65702":"Wright County, MO","65704":"Wright County, MO","65711":"Wright County, MO","65717":"Wright County, MO","63101":"St. Louis (city) County, MO","63102":"St. Louis (city) County, MO","63103":"St. Louis (city) County, MO","63104":"St. Louis (city) County, MO","63106":"St. Louis (city) County, MO","63107":"St. Louis (city) County, MO","63108":"St. Louis (city) County, MO","63109":"St. Louis (city) County, MO","63110":"St. Louis (city) County, MO","63111":"St. Louis (city) County, MO","63112":"St. Louis (city) County, MO","63113":"St. Louis (city) County, MO","63115":"St. Louis (city) County, MO","63116":"St. Louis (city) County, MO","63118":"St. Louis (city) County, MO","63120":"St. Louis (city) County, MO","63139":"St. Louis (city) County, MO","63147":"St. Louis (city) County, MO","63150":"St. Louis (city) County, MO","63155":"St. Louis (city) County, MO","63156":"St. Louis (city) County, MO","63157":"St. Louis (city) County, MO","63158":"St. Louis (city) County, MO","63160":"St. Louis (city) County, MO","63163":"St. Louis (city) County, MO","63164":"St. Louis (city) County, MO","63166":"St. Louis (city) County, MO","63169":"St. Louis (city) County, MO","63171":"St. Louis (city) County, MO","63177":"St. Louis (city) County, MO","63178":"St. Louis (city) County, MO","63179":"St. Louis (city) County, MO","63180":"St. Louis (city) County, MO","63182":"St. Louis (city) County, MO","63188":"St. Louis (city) County, MO","63195":"St. Louis (city) County, MO","63197":"St. Louis (city) County, MO","63199":"St. Louis (city) County, MO"};
// zip → [lat, lon, place] for MO+KS (pgeocode/GeoNames). Powers the live attendee map.
const ZIP_LATLON = {"66732":[37.8035,-95.1546,"Elsmore"],"66742":[37.9232,-95.3467,"Gas"],"66748":[37.8045,-95.422,"Humboldt"],"66749":[37.9245,-95.4,"Iola"],"66751":[37.917,-95.2991,"La Harpe"],"66755":[37.9342,-95.1647,"Moran"],"66772":[37.7517,-95.1545,"Savonburg"],"66015":[38.0761,-95.3287,"Colony"],"66032":[38.2859,-95.2594,"Garnett"],"66033":[38.3524,-95.1188,"Greeley"],"66039":[38.1104,-95.1886,"Kincaid"],"66091":[38.1686,-95.3096,"Welda"],"66093":[38.1718,-95.4665,"Westphalia"],"66002":[39.5594,-95.1304,"Atchison"],"66016":[39.483,-95.2863,"Cummings"],"66023":[39.5222,-95.4008,"Effingham"],"66041":[39.5952,-95.3036,"Lancaster"],"66058":[39.5388,-95.5175,"Muscotah"],"67057":[37.03,-98.6547,"Hardtner"],"67061":[37.0984,-98.4003,"Hazelton"],"67065":[37.4485,-98.5351,"Isabel"],"67070":[37.0172,-98.4859,"Kiowa"],"67071":[37.3569,-98.8098,"Lake City"],"67104":[37.2845,-98.5848,"Medicine Lodge"],"67138":[37.2492,-98.4142,"Sharon"],"67143":[37.3786,-98.9159,"Sun City"],"67511":[38.4528,-99.0115,"Albert"],"67525":[38.5409,-98.5372,"Claflin"],"67526":[38.3565,-98.5849,"Ellinwood"],"67530":[38.3936,-98.7751,"Great Bend"],"67544":[38.4789,-98.7565,"Hoisington"],"67564":[38.5167,-98.9365,"Olmitz"],"67567":[38.2782,-98.9814,"Pawnee Rock"],"66701":[37.8216,-94.7148,"Fort Scott"],"66716":[37.9214,-95.0303,"Bronson"],"66738":[38.0134,-94.7183,"Fulton"],"66741":[37.7175,-94.6613,"Garland"],"66754":[38.0228,-94.8735,"Mapleton"],"66769":[37.8367,-94.8805,"Redfield"],"66779":[37.8473,-94.9752,"Uniontown"],"66424":[39.688,-95.4138,"Everest"],"66425":[39.8445,-95.711,"Fairview"],"66434":[39.7914,-95.6004,"Hiawatha"],"66439":[39.6789,-95.5299,"Horton"],"66515":[39.9356,-95.712,"Morrill"],"66527":[39.7177,-95.6751,"Powhattan"],"66532":[39.8182,-95.4567,"Robinson"],"66842":[38.0298,-96.6746,"Cassoday"],"67002":[37.6985,-97.1179,"Andover"],"67010":[37.6836,-96.9648,"Augusta"],"67012":[37.658,-96.5329,"Beaumont"],"67017":[37.7946,-97.0971,"Benton"],"67039":[37.5195,-96.9948,"Douglass"],"67041":[38.0545,-97.1284,"Elbing"],"67042":[37.8226,-96.8543,"El Dorado"],"67072":[37.531,-96.6791,"Latham"],"67074":[37.6813,-96.7526,"Leon"],"67123":[37.9389,-97.0198,"Potwin"],"67132":[37.796,-96.6482,"Rosalia"],"67133":[37.5784,-97.1173,"Rose Hill"],"67144":[37.8005,-96.9918,"Towanda"],"67154":[37.9612,-97.1308,"Whitewater"],"66843":[38.26,-96.8228,"Cedar Point"],"66845":[38.3565,-96.5418,"Cottonwood Falls"],"66850":[38.3779,-96.6675,"Elmdale"],"66862":[38.1448,-96.5541,"Matfield Green"],"66869":[38.4129,-96.5172,"Strong City"],"67024":[37.1265,-96.4701,"Cedar Vale"],"67334":[37.0262,-96.1783,"Chautauqua"],"67355":[37.037,-96.0121,"Niotaze"],"67360":[37.0568,-96.1404,"Peru"],"67361":[37.1297,-96.1732,"Sedan"],"66713":[37.0281,-94.7393,"Baxter Springs"],"66725":[37.1699,-94.8899,"Columbus"],"66728":[37.1694,-94.7041,"Crestline"],"66739":[37.0632,-94.6557,"Galena"],"66770":[37.081,-94.7175,"Riverton"],"66773":[37.2809,-94.8092,"Scammon"],"66778":[37.0005,-94.8409,"Treece"],"66781":[37.2912,-94.7286,"Weir"],"66782":[37.2851,-94.9261,"West Mineral"],"67731":[39.7579,-101.5319,"Bird City"],"67756":[39.6804,-101.9093,"Saint Francis"],"67831":[37.1823,-99.759,"Ashland"],"67840":[37.0384,-99.9835,"Englewood"],"67865":[37.4425,-100.0088,"Minneola"],"67432":[39.3844,-97.1278,"Clay Center"],"67447":[39.4803,-97.0149,"Green"],"67458":[39.1834,-97.2499,"Longford"],"67468":[39.4607,-97.2467,"Morganville"],"67487":[39.2249,-97.0229,"Wakefield"],"66901":[39.5516,-97.6568,"Concordia"],"66938":[39.5758,-97.408,"Clyde"],"66948":[39.6021,-97.8631,"Jamestown"],"67417":[39.4472,-97.5304,"Aurora"],"67445":[39.3621,-97.8418,"Glasco"],"67466":[39.3481,-97.4579,"Miltonvale"],"66839":[38.2363,-95.7336,"Burlington"],"66852":[38.1012,-95.8874,"Gridley"],"66856":[38.4161,-95.8222,"Lebo"],"66857":[38.0874,-95.6227,"Le Roy"],"66871":[38.3782,-95.5982,"Waverly"],"67029":[37.2479,-99.3115,"Coldwater"],"67127":[37.1968,-99.4816,"Protection"],"67155":[37.3318,-99.1846,"Wilmore"],"67005":[37.0676,-97.0357,"Arkansas City"],"67008":[37.4343,-96.7661,"Atlanta"],"67019":[37.3209,-96.757,"Burden"],"67023":[37.3161,-96.6645,"Cambridge"],"67038":[37.1641,-96.6917,"Dexter"],"67102":[37.2377,-96.8389,"Maple City"],"67131":[37.4413,-97.0059,"Rock"],"67146":[37.3939,-97.1108,"Udall"],"67156":[37.2416,-96.98,"Winfield"],"66711":[37.6341,-94.6548,"Arcadia"],"66712":[37.5573,-94.6949,"Arma"],"66724":[37.3694,-94.8424,"Cherokee"],"66734":[37.6163,-94.8479,"Farlington"],"66735":[37.5219,-94.7096,"Franklin"],"66743":[37.5091,-94.8569,"Girard"],"66746":[37.6576,-94.9892,"Hepler"],"66753":[37.3468,-95.0376,"Mc Cune"],"66756":[37.5442,-94.6839,"Mulberry"],"66760":[37.342,-94.6199,"Opolis"],"66762":[37.3951,-94.7105,"Pittsburg"],"66763":[37.4466,-94.6916,"Frontenac"],"66780":[37.5967,-95.0455,"Walnut"],"67635":[39.6094,-100.4112,"Dresden"],"67643":[39.6762,-100.2834,"Jennings"],"67653":[39.8447,-100.2007,"Norcatur"],"67749":[39.8275,-100.5314,"Oberlin"],"67410":[38.9371,-97.2063,"Abilene"],"67431":[38.9722,-97.017,"Chapman"],"67441":[38.9063,-97.1122,"Enterprise"],"67449":[38.6767,-96.8941,"Herington"],"67451":[38.6776,-97.1061,"Hope"],"67480":[38.9194,-97.3518,"Solomon"],"67482":[39.0269,-97.2597,"Talmage"],"67492":[38.8131,-96.9619,"Woodbine"],"66008":[39.7174,-95.1765,"Bendena"],"66017":[39.7154,-95.2744,"Denton"],"66024":[39.7573,-94.8824,"Elwood"],"66035":[39.8608,-95.2583,"Highland"],"66087":[39.7906,-95.1434,"Troy"],"66090":[39.7625,-94.9255,"Wathena"],"66094":[39.9627,-95.2982,"White Cloud"],"66006":[38.7953,-95.2276,"Baldwin City"],"66025":[38.933,-95.1022,"Eudora"],"66044":[39.0289,-95.2086,"Lawrence"],"66045":[38.959,-95.2499,"Lawrence"],"66046":[38.9369,-95.242,"Lawrence"],"66047":[38.9407,-95.2779,"Lawrence"],"66049":[38.9704,-95.2769,"Lawrence"],"66050":[39.0154,-95.4392,"Lecompton"],"67519":[37.9347,-99.0936,"Belpre"],"67547":[37.9247,-99.4116,"Kinsley"],"67552":[37.9062,-99.248,"Lewis"],"67563":[37.8828,-99.5498,"Offerle"],"67345":[37.3745,-96.1959,"Elk Falls"],"67346":[37.3668,-96.4396,"Grenola"],"67349":[37.4809,-96.2563,"Howard"],"67352":[37.3905,-96.0814,"Longton"],"67353":[37.3649,-96.3069,"Moline"],"67601":[38.8782,-99.3348,"Hays"],"67627":[38.9276,-99.2161,"Catharine"],"67637":[38.9471,-99.5285,"Ellis"],"67660":[38.7153,-99.1718,"Pfeifer"],"67667":[38.7128,-99.3322,"Schoenchen"],"67671":[38.8589,-99.1391,"Victoria"],"67674":[38.8672,-99.0759,"Walker"],"67439":[38.7312,-98.2057,"Ellsworth"],"67450":[38.59,-98.4159,"Holyrood"],"67454":[38.7091,-98.1575,"Kanopolis"],"67459":[38.5652,-98.29,"Lorraine"],"67490":[38.8134,-98.4432,"Wilson"],"67846":[37.9769,-100.8621,"Garden City"],"67851":[37.9931,-100.9893,"Holcomb"],"67868":[37.906,-100.7523,"Pierceville"],"67801":[37.7569,-100.0241,"Dodge City"],"67834":[37.553,-99.6325,"Bucklin"],"67842":[37.6323,-99.7642,"Ford"],"67843":[37.7303,-99.937,"Fort Dodge"],"67876":[37.8235,-99.737,"Spearville"],"67882":[37.7806,-99.8921,"Wright"],"66042":[38.4347,-95.0804,"Lane"],"66067":[38.6142,-95.2745,"Ottawa"],"66076":[38.6153,-95.4489,"Pomona"],"66078":[38.4847,-95.2764,"Princeton"],"66079":[38.5666,-95.1234,"Rantoul"],"66080":[38.4074,-95.2489,"Richmond"],"66092":[38.7137,-95.0916,"Wellsville"],"66095":[38.4902,-95.4226,"Williamsburg"],"66441":[39.0299,-96.8396,"Junction City"],"66442":[39.0619,-96.7873,"Fort Riley"],"66514":[39.1692,-96.91,"Milford"],"67736":[38.887,-100.4867,"Gove"],"67737":[39.103,-100.468,"Grainfield"],"67738":[39.0851,-100.6621,"Grinnell"],"67751":[39.0788,-100.3469,"Park"],"67752":[39.0363,-100.2337,"Quinter"],"67625":[39.3782,-99.6788,"Bogue"],"67642":[39.3566,-99.8429,"Hill City"],"67650":[39.3229,-100.0733,"Morland"],"67659":[39.3482,-99.9719,"Penokee"],"67880":[37.5792,-101.3488,"Ulysses"],"67835":[37.8127,-100.3438,"Cimarron"],"67837":[37.568,-100.6148,"Copeland"],"67841":[37.6414,-100.2496,"Ensign"],"67853":[37.8293,-100.5143,"Ingalls"],"67867":[37.6016,-100.4461,"Montezuma"],"67879":[38.4962,-101.7656,"Tribune"],"66853":[37.9791,-96.1691,"Hamilton"],"66855":[38.1125,-96.0267,"Lamont"],"66860":[38.1278,-96.1213,"Madison"],"66863":[37.8329,-96.0818,"Neal"],"66870":[37.8976,-96.0329,"Virgil"],"67045":[37.8265,-96.2959,"Eureka"],"67047":[37.621,-96.0435,"Fall River"],"67122":[37.6372,-96.3695,"Piedmont"],"67137":[37.617,-96.2252,"Severy"],"67836":[38.0215,-102.007,"Coolidge"],"67857":[37.9347,-101.546,"Kendall"],"67878":[37.9826,-101.7687,"Syracuse"],"67003":[37.1512,-98.0285,"Anthony"],"67009":[37.2528,-98.2264,"Attica"],"67018":[37.0838,-97.8754,"Bluff City"],"67036":[37.2674,-97.8689,"Danville"],"67049":[37.1903,-97.8634,"Freeport"],"67058":[37.2909,-98.018,"Harper"],"67150":[37.0022,-98.1826,"Waldron"],"67020":[38.0261,-97.6666,"Burrton"],"67056":[38.0064,-97.5118,"Halstead"],"67062":[38.136,-97.4495,"Hesston"],"67114":[38.0451,-97.3435,"Newton"],"67117":[38.0743,-97.3473,"North Newton"],"67135":[37.9167,-97.4225,"Sedgwick"],"67151":[38.1239,-97.2361,"Walton"],"67870":[37.4409,-100.9691,"Satanta"],"67877":[37.5221,-100.8208,"Sublette"],"67849":[38.109,-99.6928,"Hanston"],"67854":[38.0738,-99.9327,"Jetmore"],"66416":[39.5155,-95.8517,"Circleville"],"66418":[39.2655,-95.9608,"Delia"],"66419":[39.354,-95.6127,"Denison"],"66436":[39.4436,-95.7525,"Holton"],"66440":[39.2552,-95.6867,"Hoyt"],"66509":[39.3489,-95.6928,"Mayetta"],"66516":[39.6063,-95.727,"Netawaka"],"66540":[39.5013,-95.9652,"Soldier"],"66552":[39.5974,-95.6158,"Whiting"],"66054":[39.1668,-95.2183,"Mc Louth"],"66060":[39.4095,-95.3236,"Nortonville"],"66066":[39.2152,-95.3135,"Oskaloosa"],"66070":[39.2136,-95.4404,"Ozawkie"],"66073":[39.0875,-95.3731,"Perry"],"66088":[39.3484,-95.467,"Valley Falls"],"66097":[39.3245,-95.2696,"Winchester"],"66429":[39.0972,-95.5397,"Grantville"],"66512":[39.2038,-95.5476,"Meriden"],"66936":[39.8932,-98.3499,"Burr Oak"],"66941":[39.7562,-98.4462,"Esbon"],"66942":[39.7795,-97.9889,"Formoso"],"66949":[39.6719,-98.1472,"Jewell"],"66956":[39.7833,-98.2152,"Mankato"],"66963":[39.6286,-98.0661,"Randall"],"66970":[39.935,-98.035,"Webber"],"66018":[38.9462,-94.9714,"De Soto"],"66021":[38.7811,-95.0094,"Edgerton"],"66030":[38.8075,-94.9157,"Gardner"],"66031":[38.8249,-94.8992,"New Century"],"66051":[38.8999,-94.832,"Olathe"],"66061":[38.8865,-94.8204,"Olathe"],"66062":[38.8733,-94.7752,"Olathe"],"66063":[38.8999,-94.832,"Olathe"],"66083":[38.7631,-94.8246,"Spring Hill"],"66085":[38.7902,-94.6643,"Stilwell"],"66201":[39.0278,-94.6558,"Mission"],"66202":[39.0278,-94.6558,"Mission"],"66203":[39.0417,-94.7202,"Shawnee"],"66204":[38.9928,-94.6771,"Overland Park"],"66205":[39.0278,-94.6558,"Mission"],"66206":[38.9667,-94.6169,"Leawood"],"66207":[38.9575,-94.6452,"Overland Park"],"66208":[38.9917,-94.6336,"Prairie Village"],"66209":[38.9667,-94.6169,"Leawood"],"66210":[38.9273,-94.7143,"Overland Park"],"66211":[38.9667,-94.6169,"Leawood"],"66212":[38.9568,-94.6832,"Overland Park"],"66213":[38.8982,-94.7049,"Overland Park"],"66214":[38.9649,-94.7209,"Overland Park"],"66215":[38.9536,-94.7336,"Lenexa"],"66216":[39.0417,-94.7202,"Shawnee"],"66217":[39.0417,-94.7202,"Shawnee"],"66218":[39.0417,-94.7202,"Shawnee"],"66219":[38.9536,-94.7336,"Lenexa"],"66220":[38.9536,-94.7336,"Lenexa"],"66221":[38.8636,-94.7103,"Overland Park"],"66222":[39.0278,-94.6558,"Mission"],"66223":[38.8619,-94.661,"Overland Park"],"66224":[38.8591,-94.6314,"Overland Park"],"66225":[38.8999,-94.832,"Overland Park"],"66226":[39.0417,-94.7202,"Shawnee"],"66227":[38.9536,-94.7336,"Lenexa"],"66250":[38.9536,-94.7336,"Lenexa"],"66251":[38.8999,-94.832,"Overland Park"],"66276":[38.8999,-94.832,"Shawnee Mission"],"66282":[38.8999,-94.832,"Overland Park"],"66283":[38.8999,-94.832,"Overland Park"],"66285":[38.9536,-94.7336,"Lenexa"],"66286":[39.0417,-94.7202,"Shawnee"],"67838":[38.0068,-101.1431,"Deerfield"],"67860":[37.9382,-101.2713,"Lakin"],"67035":[37.6309,-98.3564,"Cunningham"],"67068":[37.5964,-98.1304,"Kingman"],"67111":[37.6099,-97.9503,"Murdock"],"67112":[37.4344,-98.4171,"Nashville"],"67118":[37.4501,-97.8662,"Norwich"],"67142":[37.441,-98.1751,"Spivey"],"67159":[37.4373,-98.2874,"Zenda"],"67054":[37.6084,-99.3011,"Greensburg"],"67059":[37.6096,-99.134,"Haviland"],"67109":[37.5716,-99.4639,"Mullinville"],"67330":[37.1873,-95.2983,"Altamont"],"67332":[37.0601,-95.2115,"Bartlett"],"67336":[37.0418,-95.0796,"Chetopa"],"67341":[37.3243,-95.4116,"Dennis"],"67342":[37.0561,-95.3442,"Edna"],"67354":[37.2091,-95.4247,"Mound Valley"],"67356":[37.1823,-95.1335,"Oswego"],"67357":[37.3389,-95.2693,"Parsons"],"67839":[38.4742,-100.4647,"Dighton"],"67850":[38.5664,-100.6159,"Healy"],"66007":[39.1281,-94.957,"Basehor"],"66020":[39.3391,-95.0999,"Easton"],"66027":[39.3485,-94.9265,"Fort Leavenworth"],"66043":[39.2502,-94.8994,"Lansing"],"66048":[39.3015,-94.9339,"Leavenworth"],"66052":[39.0014,-95.0391,"Linwood"],"66086":[39.1026,-95.1051,"Tonganoxie"],"67418":[39.1816,-98.0711,"Barnard"],"67423":[38.9844,-97.9818,"Beverly"],"67455":[39.1027,-98.2149,"Lincoln"],"67481":[39.0324,-98.373,"Sylvan Grove"],"66010":[38.0908,-95.0053,"Blue Mound"],"66014":[38.213,-94.9934,"Centerville"],"66040":[39.0478,-95.1538,"Lacygne"],"66056":[38.156,-94.8186,"Mound City"],"66072":[38.3303,-94.9871,"Parker"],"66075":[38.1823,-94.7057,"Pleasanton"],"66767":[38.0718,-94.7008,"Prescott"],"67747":[39.079,-101.035,"Monument"],"67748":[39.1121,-100.858,"Oakley"],"67764":[39.061,-101.2216,"Winona"],"66801":[38.4184,-96.1871,"Emporia"],"66830":[38.6393,-96.1017,"Admire"],"66833":[38.652,-96.1735,"Allen"],"66835":[38.5098,-96.2608,"Americus"],"66854":[38.2833,-95.9997,"Hartford"],"66864":[38.3948,-96.0168,"Neosho Rapids"],"66865":[38.2578,-96.1891,"Olpe"],"66868":[38.529,-95.9895,"Reading"],"67107":[38.206,-97.5088,"Moundridge"],"67428":[38.3858,-97.4291,"Canton"],"67443":[38.3824,-97.5359,"Galva"],"67456":[38.5761,-97.6739,"Lindsborg"],"67460":[38.3763,-97.6702,"Mcpherson"],"67464":[38.556,-97.8381,"Marquette"],"67476":[38.5508,-97.4303,"Roxbury"],"67491":[38.3845,-97.8965,"Windom"],"67546":[38.2232,-97.7951,"Inman"],"66840":[38.1222,-96.8634,"Burns"],"66851":[38.2415,-96.9346,"Florence"],"66858":[38.4933,-96.9626,"Lincolnville"],"66859":[38.5657,-96.9799,"Lost Springs"],"66861":[38.3554,-97.0204,"Marion"],"66866":[38.1737,-97.1184,"Peabody"],"67053":[38.2468,-97.3463,"Goessel"],"67063":[38.3449,-97.2122,"Hillsboro"],"67073":[38.3771,-97.3043,"Lehigh"],"67438":[38.5038,-97.2555,"Durham"],"67475":[38.5777,-97.0759,"Ramona"],"67483":[38.5534,-97.1774,"Tampa"],"66403":[39.8707,-96.2676,"Axtell"],"66406":[39.8988,-96.4286,"Beattie"],"66411":[39.675,-96.6359,"Blue Rapids"],"66412":[39.8775,-96.7458,"Bremen"],"66427":[39.7333,-96.5223,"Frankfort"],"66438":[39.8488,-96.5063,"Home"],"66508":[39.8428,-96.6422,"Marysville"],"66518":[39.9598,-96.6235,"Oketo"],"66541":[39.9798,-96.3279,"Summerfield"],"66544":[39.6946,-96.278,"Vermillion"],"66548":[39.6971,-96.7498,"Waterville"],"67844":[37.3542,-100.1981,"Fowler"],"67864":[37.2821,-100.3364,"Meade"],"67869":[37.2701,-100.5732,"Plains"],"66013":[38.7283,-94.6887,"Bucyrus"],"66026":[38.4102,-94.8718,"Fontana"],"66036":[38.6581,-94.8521,"Hillsdale"],"66053":[38.6073,-94.6829,"Louisburg"],"66064":[38.4888,-94.962,"Osawatomie"],"66071":[38.572,-94.8937,"Paola"],"67420":[39.4416,-98.1192,"Beloit"],"67430":[39.5115,-98.4335,"Cawker City"],"67446":[39.4958,-98.3155,"Glen Elder"],"67452":[39.243,-98.4017,"Hunter"],"67478":[39.3851,-97.9328,"Simpson"],"67485":[39.3436,-98.4644,"Tipton"],"67301":[37.2292,-95.7165,"Independence"],"67333":[37.0224,-95.9091,"Caney"],"67335":[37.2668,-95.559,"Cherryvale"],"67337":[37.0441,-95.6328,"Coffeyville"],"67340":[37.0596,-95.7131,"Dearing"],"67344":[37.3146,-95.9135,"Elk City"],"67347":[37.0917,-95.9414,"Havana"],"67351":[37.1576,-95.6017,"Liberty"],"67363":[37.3281,-95.717,"Sycamore"],"67364":[37.037,-95.8237,"Tyro"],"66838":[38.5674,-96.8396,"Burdick"],"66846":[38.6959,-96.5469,"Council Grove"],"66849":[38.8389,-96.5802,"Dwight"],"66872":[38.789,-96.7637,"White City"],"66873":[38.6361,-96.6753,"Wilsey"],"67950":[37.0154,-101.9012,"Elkhart"],"67953":[37.2834,-101.7004,"Richfield"],"67954":[37.1089,-101.6447,"Rolla"],"66404":[39.8816,-96.1801,"Baileyville"],"66408":[39.9571,-95.961,"Bern"],"66415":[39.7381,-96.1486,"Centralia"],"66417":[39.6572,-96.0294,"Corning"],"66428":[39.6654,-95.9574,"Goff"],"66522":[39.8639,-95.9392,"Oneida"],"66534":[39.8993,-95.8113,"Sabetha"],"66538":[39.8473,-96.0316,"Seneca"],"66550":[39.6428,-95.8231,"Wetmore"],"66720":[37.6749,-95.457,"Chanute"],"66733":[37.6044,-95.2514,"Erie"],"66740":[37.4724,-95.3707,"Galesburg"],"66771":[37.518,-95.1688,"Saint Paul"],"66775":[37.6811,-95.1388,"Stark"],"66776":[37.4527,-95.4671,"Thayer"],"67515":[38.6403,-100.0462,"Arnold"],"67516":[38.4565,-99.7016,"Bazine"],"67518":[38.4445,-100.1949,"Beeler"],"67521":[38.6239,-99.7328,"Brownell"],"67560":[38.4388,-99.9029,"Ness City"],"67572":[38.64,-99.9267,"Ransom"],"67584":[38.6411,-100.138,"Utica"],"67622":[39.8891,-99.7042,"Almena"],"67629":[39.7375,-100.1776,"Clayton"],"67645":[39.6105,-100.0028,"Lenora"],"67654":[39.8407,-99.8878,"Norton"],"66413":[38.7634,-95.84,"Burlingame"],"66414":[38.8206,-95.6871,"Carbondale"],"66451":[38.6356,-95.6802,"Lyndon"],"66510":[38.5027,-95.629,"Melvern"],"66523":[38.6269,-95.8303,"Osage City"],"66524":[38.7922,-95.5616,"Overbrook"],"66528":[38.5785,-95.5362,"Quenemo"],"66537":[38.788,-95.748,"Scranton"],"66543":[38.6419,-95.6012,"Vassar"],"67437":[39.5028,-98.5441,"Downs"],"67473":[39.4194,-98.6961,"Osborne"],"67474":[39.5455,-98.6904,"Portis"],"67623":[39.4514,-98.9539,"Alton"],"67651":[39.2013,-98.9829,"Natoma"],"67422":[39.0224,-97.6031,"Bennington"],"67436":[39.2731,-97.7717,"Delphos"],"67467":[39.1295,-97.6688,"Minneapolis"],"67484":[38.9916,-97.8319,"Tescott"],"67523":[38.2104,-99.5275,"Burdett"],"67529":[38.0649,-99.2374,"Garfield"],"67550":[38.1946,-99.101,"Larned"],"67574":[38.2148,-99.4048,"Rozel"],"67621":[39.8037,-99.1255,"Agra"],"67639":[39.6704,-99.2996,"Glade"],"67644":[39.6717,-99.1204,"Kirwin"],"67646":[39.6611,-99.5687,"Logan"],"67647":[39.9517,-99.5391,"Long Island"],"67661":[39.7623,-99.3328,"Phillipsburg"],"67664":[39.837,-99.5683,"Prairie View"],"66407":[39.2273,-96.1866,"Belvue"],"66422":[39.3048,-96.0593,"Emmett"],"66426":[39.4398,-96.5068,"Fostoria"],"66432":[39.4942,-96.0769,"Havensville"],"66520":[39.4125,-96.6002,"Olsburg"],"66521":[39.4889,-96.17,"Onaga"],"66535":[39.2108,-96.4345,"Saint George"],"66536":[39.1987,-96.0683,"Saint Marys"],"66547":[39.21,-96.3153,"Wamego"],"66549":[39.4138,-96.4374,"Westmoreland"],"67021":[37.7847,-98.9017,"Byers"],"67028":[37.5125,-98.8504,"Coats"],"67066":[37.7397,-98.7361,"Iuka"],"67124":[37.6502,-98.73,"Pratt"],"67134":[37.5101,-98.6642,"Sawyer"],"67730":[39.7926,-101.0318,"Atwood"],"67739":[39.9036,-100.8139,"Herndon"],"67744":[39.863,-100.9604,"Ludell"],"67745":[39.7923,-101.3227,"Mc Donald"],"67501":[38.055,-97.9311,"Hutchinson"],"67502":[38.1156,-97.8937,"Hutchinson"],"67504":[37.9532,-98.0859,"Hutchinson"],"67505":[38.0282,-97.9431,"South Hutchinson"],"67510":[37.9626,-98.2071,"Abbyville"],"67514":[37.8598,-98.159,"Arlington"],"67522":[38.1309,-97.7691,"Buhler"],"67543":[37.8989,-97.7828,"Haven"],"67561":[38.1412,-98.0674,"Nickerson"],"67566":[37.9671,-98.0798,"Partridge"],"67568":[37.9658,-98.2988,"Plevna"],"67570":[37.7783,-97.9886,"Pretty Prairie"],"67581":[37.9557,-98.4068,"Sylvia"],"67583":[37.8224,-98.3591,"Turon"],"67585":[37.9412,-97.8711,"Yoder"],"66930":[39.7044,-97.4465,"Agenda"],"66935":[39.8241,-97.629,"Belleville"],"66939":[39.7851,-97.89,"Courtland"],"66940":[39.7975,-97.4496,"Cuba"],"66959":[39.9272,-97.5403,"Munden"],"66960":[39.9582,-97.4243,"Narka"],"66961":[39.8279,-97.6509,"Norway"],"66964":[39.9376,-97.8435,"Republic"],"66966":[39.7939,-97.7786,"Scandia"],"67427":[38.5018,-98.4016,"Bushton"],"67444":[38.5037,-98.1858,"Geneseo"],"67457":[38.4079,-98.0113,"Little River"],"67512":[38.2343,-98.3112,"Alden"],"67524":[38.3635,-98.3556,"Chase"],"67554":[38.3349,-98.1831,"Lyons"],"67573":[38.2877,-98.4119,"Raymond"],"67579":[38.2126,-98.2055,"Sterling"],"66449":[39.3644,-96.8589,"Leonardville"],"66502":[39.1938,-96.5858,"Manhattan"],"66503":[39.2458,-96.6336,"Manhattan"],"66505":[39.3049,-96.6753,"Manhattan"],"66506":[39.196,-96.5839,"Manhattan"],"66517":[39.1153,-96.7101,"Ogden"],"66531":[39.3005,-96.8222,"Riley"],"66554":[39.4879,-96.7828,"Randolph"],"67632":[39.3242,-99.5811,"Damar"],"67657":[39.2531,-99.5593,"Palco"],"67663":[39.2308,-99.3008,"Plainville"],"67669":[39.4376,-99.2871,"Stockton"],"67675":[39.4431,-99.1037,"Woodston"],"67513":[38.457,-99.5378,"Alexander"],"67520":[38.5193,-99.1986,"Bison"],"67548":[38.5311,-99.3097,"La Crosse"],"67553":[38.6557,-99.3203,"Liebenthal"],"67556":[38.5957,-99.554,"Mc Cracken"],"67559":[38.4372,-99.4234,"Nekoma"],"67565":[38.5353,-99.0534,"Otis"],"67575":[38.4533,-99.3079,"Rush Center"],"67626":[38.8758,-98.704,"Bunker Hill"],"67634":[38.8348,-98.5695,"Dorrance"],"67640":[38.8722,-99.0112,"Gorham"],"67648":[39.0581,-98.5352,"Lucas"],"67649":[39.1039,-98.6851,"Luray"],"67658":[39.0756,-98.9207,"Paradise"],"67665":[38.8806,-98.8595,"Russell"],"67673":[39.0877,-98.7785,"Waldo"],"67401":[38.8237,-97.6421,"Salina"],"67402":[38.8403,-97.6114,"Salina"],"67416":[38.6676,-97.6203,"Assaria"],"67425":[38.7858,-97.863,"Brookville"],"67442":[38.6648,-97.7554,"Falun"],"67448":[38.7047,-97.4338,"Gypsum"],"67470":[38.896,-97.523,"New Cambria"],"67871":[38.4823,-100.9064,"Scott City"],"67001":[37.7797,-97.6366,"Andale"],"67016":[37.8866,-97.5166,"Bentley"],"67025":[37.6353,-97.7686,"Cheney"],"67026":[37.5076,-97.5082,"Clearwater"],"67030":[37.7782,-97.5405,"Colwich"],"67037":[37.553,-97.2549,"Derby"],"67050":[37.6767,-97.66,"Garden Plain"],"67052":[37.6597,-97.5753,"Goddard"],"67055":[37.7833,-97.2054,"Greenwich"],"67060":[37.5647,-97.3553,"Haysville"],"67067":[37.7934,-97.2737,"Kechi"],"67101":[37.7747,-97.4689,"Maize"],"67108":[37.8684,-97.6591,"Mount Hope"],"67120":[37.5054,-97.3408,"Peck"],"67147":[37.8616,-97.2621,"Valley Center"],"67149":[37.5696,-97.6306,"Viola"],"67201":[37.6922,-97.3375,"Wichita"],"67202":[37.6899,-97.3355,"Wichita"],"67203":[37.7048,-97.3638,"Wichita"],"67204":[37.7488,-97.3566,"Wichita"],"67205":[37.7639,-97.4269,"Wichita"],"67206":[37.7038,-97.2253,"Wichita"],"67207":[37.671,-97.2179,"Wichita"],"67208":[37.7024,-97.2811,"Wichita"],"67209":[37.6779,-97.4235,"Wichita"],"67210":[37.6379,-97.2613,"Wichita"],"67211":[37.6662,-97.3165,"Wichita"],"67212":[37.7007,-97.4383,"Wichita"],"67213":[37.668,-97.3591,"Wichita"],"67214":[37.7051,-97.3133,"Wichita"],"67215":[37.6333,-97.425,"Wichita"],"67216":[37.6223,-97.3136,"Wichita"],"67217":[37.6266,-97.3581,"Wichita"],"67218":[37.669,-97.2802,"Wichita"],"67219":[37.7719,-97.3175,"Wichita"],"67220":[37.7667,-97.2805,"Wichita"],"67221":[37.6066,-97.2979,"Mcconnell Afb"],"67223":[37.7367,-97.499,"Wichita"],"67226":[37.7379,-97.2479,"Wichita"],"67227":[37.6281,-97.4916,"Wichita"],"67228":[37.7742,-97.1711,"Wichita"],"67230":[37.6808,-97.1558,"Wichita"],"67232":[37.6395,-97.1714,"Wichita"],"67235":[37.7149,-97.499,"Wichita"],"67260":[37.7194,-97.2936,"Wichita"],"67275":[37.6936,-97.4804,"Wichita"],"67276":[37.6936,-97.4804,"Wichita"],"67277":[37.6936,-97.4804,"Wichita"],"67278":[37.6922,-97.3375,"Wichita"],"67859":[37.2042,-100.7014,"Kismet"],"67901":[37.0438,-100.9286,"Liberal"],"67905":[37.0216,-100.938,"Liberal"],"66402":[38.9167,-95.8199,"Auburn"],"66409":[38.9442,-95.5825,"Berryton"],"66420":[38.9645,-95.9172,"Dover"],"66533":[39.1451,-95.9553,"Rossville"],"66539":[39.1102,-95.8552,"Silver Lake"],"66542":[39.0217,-95.5379,"Tecumseh"],"66546":[38.9045,-95.7015,"Wakarusa"],"66601":[39.0483,-95.678,"Topeka"],"66603":[39.0553,-95.6802,"Topeka"],"66604":[39.0405,-95.7178,"Topeka"],"66605":[39.0151,-95.6439,"Topeka"],"66606":[39.0583,-95.7095,"Topeka"],"66607":[39.0421,-95.6449,"Topeka"],"66608":[39.0858,-95.6867,"Topeka"],"66609":[38.9919,-95.6681,"Topeka"],"66610":[38.9822,-95.7461,"Topeka"],"66611":[39.0142,-95.6981,"Topeka"],"66612":[39.0427,-95.6818,"Topeka"],"66614":[39.0154,-95.7469,"Topeka"],"66615":[39.0446,-95.7906,"Topeka"],"66616":[39.0645,-95.6413,"Topeka"],"66617":[39.1271,-95.6384,"Topeka"],"66618":[39.1329,-95.7023,"Topeka"],"66619":[38.9536,-95.7236,"Topeka"],"66620":[39.0429,-95.7697,"Topeka"],"66621":[39.0333,-95.7015,"Topeka"],"66622":[39.0429,-95.7697,"Topeka"],"66624":[39.0429,-95.7697,"Topeka"],"66625":[39.0483,-95.678,"Topeka"],"66626":[39.0483,-95.678,"Topeka"],"66629":[39.0483,-95.678,"Topeka"],"66630":[39.0483,-95.678,"Topeka"],"66636":[39.0483,-95.678,"Topeka"],"66647":[39.0429,-95.7697,"Topeka"],"66667":[39.0429,-95.7697,"Topeka"],"66675":[39.0429,-95.7697,"Topeka"],"66683":[39.0483,-95.678,"Topeka"],"66699":[39.0483,-95.678,"Topeka"],"67740":[39.3322,-100.4758,"Hoxie"],"67757":[39.5216,-100.5257,"Selden"],"67733":[39.3579,-101.521,"Edson"],"67735":[39.3491,-101.7164,"Goodland"],"67741":[39.3438,-102.0015,"Kanorado"],"66932":[39.7719,-98.9077,"Athol"],"66951":[39.7692,-99.0308,"Kensington"],"66952":[39.8077,-98.556,"Lebanon"],"66967":[39.8042,-98.7842,"Smith Center"],"67628":[39.6602,-98.9369,"Cedar"],"67638":[39.6439,-98.8476,"Gaylord"],"67545":[38.1485,-98.6408,"Hudson"],"67557":[37.9433,-98.9481,"Macksville"],"67576":[38.0022,-98.7601,"St John"],"67578":[37.9554,-98.5929,"Stafford"],"67855":[37.5694,-101.7194,"Johnson"],"67862":[37.5451,-101.9109,"Manter"],"67951":[37.1682,-101.3346,"Hugoton"],"67952":[37.3172,-101.2427,"Moscow"],"67004":[37.284,-97.7557,"Argonia"],"67013":[37.4052,-97.2852,"Belle Plaine"],"67022":[37.0452,-97.6247,"Caldwell"],"67031":[37.3903,-97.6284,"Conway Springs"],"67051":[37.0809,-97.1795,"Geuda Springs"],"67103":[37.2518,-97.5416,"Mayfield"],"67105":[37.2578,-97.6521,"Milan"],"67106":[37.4401,-97.7592,"Milton"],"67110":[37.4764,-97.232,"Mulvane"],"67119":[37.2653,-97.1761,"Oxford"],"67140":[37.05,-97.4042,"South Haven"],"67152":[37.2778,-97.391,"Wellington"],"67701":[39.383,-101.0442,"Colby"],"67732":[39.3655,-101.373,"Brewster"],"67734":[39.4296,-100.8948,"Gem"],"67743":[39.3841,-101.2096,"Levant"],"67753":[39.4267,-100.7461,"Rexford"],"67631":[39.0038,-100.0862,"Collyer"],"67656":[38.9914,-99.7323,"Ogallah"],"67672":[39.025,-99.8796,"Wakeeney"],"66401":[39.0092,-96.2923,"Alma"],"66423":[38.8514,-96.1016,"Eskridge"],"66431":[38.79,-95.9617,"Harveyville"],"66501":[39.0535,-96.2379,"Mc Farland"],"66507":[39.0447,-96.0397,"Maple Hill"],"66526":[39.0803,-96.1818,"Paxico"],"66834":[38.8636,-96.48,"Alta Vista"],"67758":[38.8857,-101.7431,"Sharon Springs"],"67761":[38.8747,-101.5735,"Wallace"],"67762":[38.8649,-101.9512,"Weskan"],"66933":[39.6841,-96.8676,"Barnes"],"66937":[39.6201,-97.2611,"Clifton"],"66943":[39.7061,-96.9775,"Greenleaf"],"66944":[39.852,-97.3081,"Haddam"],"66945":[39.8927,-96.8689,"Hanover"],"66946":[39.96,-96.9735,"Hollenberg"],"66953":[39.6847,-97.0854,"Linn"],"66955":[39.9845,-97.3453,"Mahaska"],"66958":[39.8616,-97.1825,"Morrowville"],"66962":[39.6192,-97.1122,"Palmer"],"66968":[39.8223,-97.0484,"Washington"],"67861":[38.4987,-101.3589,"Leoti"],"67863":[38.4875,-101.2129,"Marienthal"],"66710":[37.5197,-95.6483,"Altoona"],"66714":[37.6118,-95.7038,"Benedict"],"66717":[37.7011,-95.7014,"Buffalo"],"66736":[37.5717,-95.7484,"Fredonia"],"66757":[37.4257,-95.6765,"Neodesha"],"66759":[37.569,-95.9379,"New Albany"],"66758":[37.9669,-95.5497,"Neosho Falls"],"66761":[37.9228,-95.5353,"Piqua"],"66777":[37.7953,-95.9368,"Toronto"],"66783":[37.8801,-95.7289,"Yates Center"],"66012":[39.0672,-94.9227,"Bonner Springs"],"66101":[39.1157,-94.6271,"Kansas City"],"66102":[39.1132,-94.6693,"Kansas City"],"66103":[39.0668,-94.6282,"Kansas City"],"66104":[39.1375,-94.6792,"Kansas City"],"66105":[39.085,-94.6356,"Kansas City"],"66106":[39.0694,-94.7178,"Kansas City"],"66109":[39.1434,-94.7856,"Kansas City"],"66110":[39.0966,-94.7495,"Kansas City"],"66111":[39.0803,-94.7806,"Kansas City"],"66112":[39.116,-94.764,"Kansas City"],"66113":[39.0735,-94.7233,"Edwardsville"],"66115":[39.1364,-94.616,"Kansas City"],"66117":[39.1142,-94.6275,"Kansas City"],"66118":[39.1011,-94.6144,"Kansas City"],"66119":[39.0966,-94.7495,"Kansas City"],"66160":[39.0966,-94.7495,"Kansas City"],"63501":[40.1908,-92.5856,"Kirksville"],"63533":[40.1959,-92.4333,"Brashear"],"63540":[40.104,-92.4066,"Gibbs"],"63546":[40.3446,-92.5567,"Greentop"],"63559":[40.2685,-92.7172,"Novinger"],"64421":[39.9092,-94.9113,"Amazonia"],"64427":[40.1007,-94.8847,"Bolckow"],"64436":[39.8555,-94.6977,"Cosby"],"64449":[40.0142,-94.9555,"Fillmore"],"64459":[39.9295,-94.6465,"Helena"],"64480":[40.0593,-94.7002,"Rea"],"64483":[40.0399,-94.8328,"Rosendale"],"64485":[39.9168,-94.8267,"Savannah"],"64506":[39.7893,-94.8043,"Saint Joseph"],"64446":[40.3302,-95.3751,"Fairfax"],"64482":[40.4306,-95.5274,"Rock Port"],"64491":[40.4418,-95.3786,"Tarkio"],"64496":[40.478,-95.6193,"Watson"],"64498":[40.5357,-95.3134,"Westboro"],"63345":[39.2742,-91.5798,"Farber"],"63352":[39.2425,-91.6454,"Laddonia"],"63382":[39.2949,-91.4883,"Vandalia"],"65232":[39.1209,-91.7661,"Benton City"],"65264":[39.0968,-91.6646,"Martinsburg"],"65265":[39.1712,-91.8895,"Mexico"],"65280":[39.21,-91.7216,"Rush Hill"],"65285":[39.2128,-92.0046,"Thompson"],"64874":[36.7651,-94.0492,"Wheaton"],"65623":[36.749,-93.9064,"Butterfield"],"65625":[36.6784,-93.8467,"Cassville"],"65641":[36.548,-93.7336,"Eagle Rock"],"65647":[36.6815,-93.9702,"Exeter"],"65658":[36.5625,-93.623,"Golden"],"65708":[36.9212,-93.9258,"Monett"],"65734":[36.8069,-93.9164,"Purdy"],"65745":[36.5276,-93.9359,"Seligman"],"65747":[36.6167,-93.6249,"Shell Knob"],"65772":[36.5807,-93.992,"Washburn"],"64748":[37.3995,-94.1027,"Golden City"],"64759":[37.5191,-94.3364,"Lamar"],"64762":[37.5725,-94.5204,"Liberal"],"64766":[37.5848,-94.1572,"Milford"],"64769":[37.452,-94.5756,"Mindenmines"],"64720":[38.4125,-94.3683,"Adrian"],"64722":[38.2605,-94.5734,"Amoret"],"64723":[38.3954,-94.5763,"Amsterdam"],"64730":[38.2712,-94.3137,"Butler"],"64742":[38.4956,-94.5928,"Drexel"],"64745":[38.1661,-94.5075,"Foster"],"64752":[38.09,-94.5838,"Hume"],"64779":[38.0944,-94.3635,"Rich Hill"],"64780":[38.0766,-94.1299,"Rockville"],"65325":[38.4531,-93.1915,"Cole Camp"],"65326":[38.1906,-93.1471,"Edwards"],"65335":[38.5019,-93.3224,"Ionia"],"65338":[38.4073,-93.3668,"Lincoln"],"65355":[38.2431,-93.3819,"Warsaw"],"63662":[37.4733,-90.05,"Patton"],"63750":[37.147,-90.1795,"Gipsy"],"63751":[37.3231,-90.0515,"Glenallen"],"63760":[37.2609,-89.9227,"Leopold"],"63764":[37.3061,-89.9823,"Marble Hill"],"63781":[37.537,-89.9272,"Sedgewickville"],"63782":[37.071,-90.0092,"Sturdivant"],"63787":[37.1365,-90.0757,"Zalma"],"65010":[38.7878,-92.2537,"Ashland"],"65039":[38.7159,-92.2864,"Hartsburg"],"65201":[38.9382,-92.3049,"Columbia"],"65202":[38.995,-92.3112,"Columbia"],"65203":[38.9348,-92.3639,"Columbia"],"65205":[39.0447,-92.3496,"Columbia"],"65211":[38.9517,-92.3341,"Columbia"],"65212":[38.9376,-92.3304,"Columbia"],"65215":[38.9532,-92.3208,"Columbia"],"65216":[38.9517,-92.3341,"Columbia"],"65217":[38.9517,-92.3341,"Columbia"],"65218":[38.9517,-92.3341,"Columbia"],"65240":[39.1961,-92.1472,"Centralia"],"65255":[39.1054,-92.2239,"Hallsville"],"65256":[39.1203,-92.441,"Harrisburg"],"65279":[38.9756,-92.5079,"Rocheport"],"65284":[39.2057,-92.2953,"Sturgeon"],"65299":[38.9033,-92.1022,"Mid Missouri"],"64401":[39.6662,-94.717,"Agency"],"64440":[39.5834,-94.927,"De Kalb"],"64443":[39.7517,-94.6582,"Easton"],"64448":[39.5891,-94.7913,"Faucett"],"64484":[39.5653,-95.0413,"Rushville"],"64501":[39.7688,-94.8385,"Saint Joseph"],"64502":[39.7686,-94.8466,"Saint Joseph"],"64503":[39.734,-94.8171,"Saint Joseph"],"64504":[39.7076,-94.8677,"Saint Joseph"],"64505":[39.7965,-94.8443,"Saint Joseph"],"64507":[39.7551,-94.8173,"Saint Joseph"],"64508":[39.6763,-94.8574,"Saint Joseph"],"63901":[36.7662,-90.4166,"Poplar Bluff"],"63902":[36.7125,-90.407,"Poplar Bluff"],"63932":[36.6899,-90.2508,"Broseley"],"63938":[36.5114,-90.267,"Fagus"],"63940":[36.7836,-90.2168,"Fisk"],"63945":[36.6723,-90.5583,"Harviell"],"63954":[36.571,-90.4995,"Neelyville"],"63961":[36.5818,-90.2617,"Qulin"],"63962":[36.8431,-90.2801,"Rombauer"],"64624":[39.5915,-93.7887,"Braymer"],"64625":[39.7582,-93.8068,"Breckenridge"],"64637":[39.5643,-93.9295,"Cowgill"],"64644":[39.7364,-93.9909,"Hamilton"],"64649":[39.7803,-94.1024,"Kidder"],"64650":[39.6508,-94.0827,"Kingston"],"64671":[39.5647,-94.0743,"Polo"],"63388":[38.8874,-91.7689,"Williamsburg"],"65043":[38.6328,-92.1163,"Holts Summit"],"65059":[38.6998,-91.8868,"Mokane"],"65063":[38.71,-92.083,"New Bloomfield"],"65067":[38.7109,-91.7177,"Portland"],"65077":[38.7566,-91.7888,"Steedman"],"65080":[38.6402,-91.9673,"Tebbetts"],"65231":[39.0122,-91.8858,"Auxvasse"],"65251":[38.8518,-91.9605,"Fulton"],"65262":[38.9551,-91.952,"Kingdom City"],"65020":[38.0185,-92.7677,"Camdenton"],"65049":[38.2003,-92.6684,"Lake Ozark"],"65052":[38.0605,-92.6831,"Linn Creek"],"65065":[38.138,-92.6664,"Osage Beach"],"65079":[38.1558,-92.7854,"Sunrise Beach"],"65324":[38.1396,-92.9537,"Climax Springs"],"65567":[37.8693,-92.5114,"Stoutland"],"65591":[37.9851,-92.547,"Montreal"],"65786":[37.9616,-92.9603,"Macks Creek"],"65787":[38.1025,-92.9148,"Roach"],"63701":[37.3169,-89.5459,"Cape Girardeau"],"63702":[37.3506,-89.5094,"Cape Girardeau"],"63703":[37.3059,-89.5181,"Cape Girardeau"],"63739":[37.3632,-89.8206,"Burfordville"],"63743":[37.5151,-89.8213,"Daisy"],"63744":[37.1967,-89.7362,"Delta"],"63745":[37.2424,-89.6977,"Dutchtown"],"63747":[37.5669,-89.8376,"Friedheim"],"63752":[37.3092,-89.6989,"Gordonville"],"63755":[37.3879,-89.6519,"Jackson"],"63766":[37.4401,-89.795,"Millersville"],"63769":[37.5258,-89.7508,"Oak Ridge"],"63770":[37.5975,-89.703,"Old Appleton"],"63779":[37.5007,-89.6396,"Pocahontas"],"63785":[37.2781,-89.8061,"Whitewater"],"64622":[39.4994,-93.5374,"Bogard"],"64623":[39.4767,-93.3335,"Bosworth"],"64633":[39.3673,-93.4926,"Carrollton"],"64639":[39.384,-93.2238,"De Witt"],"64643":[39.5953,-93.3445,"Hale"],"64668":[39.3299,-93.6761,"Norborne"],"64680":[39.4231,-93.7588,"Stet"],"64682":[39.5518,-93.4647,"Tina"],"63937":[36.9453,-90.7485,"Ellsinore"],"63941":[36.9172,-91.144,"Fremont"],"63943":[36.828,-90.7942,"Grandin"],"63965":[37.0015,-91.0007,"Van Buren"],"64012":[38.8161,-94.5328,"Belton"],"64078":[38.7165,-94.4405,"Peculiar"],"64080":[38.7859,-94.244,"Pleasant Hill"],"64083":[38.8019,-94.4529,"Raymore"],"64090":[38.7658,-94.1609,"Strasburg"],"64701":[38.6419,-94.3285,"Harrisonville"],"64725":[38.4986,-94.363,"Archie"],"64734":[38.6898,-94.5695,"Cleveland"],"64739":[38.5078,-94.0926,"Creighton"],"64743":[38.6682,-94.2333,"East Lynne"],"64746":[38.6245,-94.4956,"Freeman"],"64747":[38.5681,-94.1825,"Garden City"],"64744":[37.8652,-94.0124,"El Dorado Springs"],"64756":[37.6613,-94.0129,"Jerico Springs"],"65607":[37.7942,-93.8044,"Caplinger Mills"],"65785":[37.7241,-93.796,"Stockton"],"64660":[39.5828,-93.0892,"Mendon"],"64676":[39.6627,-93.0467,"Rothville"],"64681":[39.655,-93.2241,"Sumner"],"65236":[39.4374,-93.1187,"Brunswick"],"65246":[39.4035,-92.9944,"Dalton"],"65261":[39.4794,-92.9302,"Keytesville"],"65281":[39.4319,-92.8014,"Salisbury"],"65286":[39.5011,-93.1928,"Triplett"],"65610":[37.0628,-93.5476,"Billings"],"65620":[36.999,-92.9692,"Bruner"],"65629":[36.922,-93.0451,"Chadwick"],"65630":[36.8359,-93.2291,"Chestnutridge"],"65631":[37.0447,-93.4383,"Clever"],"65657":[36.8389,-93.0196,"Garrison"],"65669":[36.9408,-93.268,"Highlandville"],"65714":[37.0512,-93.2972,"Nixa"],"65720":[36.9404,-92.9528,"Oldfield"],"65721":[37.0169,-93.2022,"Ozark"],"65753":[36.9775,-93.1065,"Sparta"],"65754":[36.8636,-93.2754,"Spokane"],"72643":[36.9404,-92.9528,"Lead Hill"],"63430":[40.3445,-91.5154,"Alexandria"],"63445":[40.4266,-91.725,"Kahoka"],"63453":[40.4931,-91.8912,"Luray"],"63465":[40.5172,-91.6753,"Revere"],"63466":[40.4312,-91.6851,"Saint Patrick"],"63472":[40.4001,-91.5842,"Wayland"],"63474":[40.3721,-91.9071,"Wyaconda"],"64024":[39.3392,-94.2261,"Excelsior Springs"],"64048":[39.4289,-94.3689,"Holt"],"64060":[39.3652,-94.3621,"Kearney"],"64068":[39.2461,-94.4191,"Liberty"],"64069":[39.2461,-94.4191,"Liberty"],"64072":[39.2458,-94.2924,"Missouri City"],"64073":[39.3149,-94.2939,"Mosby"],"64089":[39.3917,-94.5592,"Smithville"],"64116":[39.1479,-94.568,"Kansas City"],"64117":[39.1651,-94.5256,"Kansas City"],"64118":[39.2133,-94.5743,"Kansas City"],"64119":[39.1979,-94.5199,"Kansas City"],"64144":[39.2829,-94.409,"Kansas City"],"64155":[39.2758,-94.5704,"Kansas City"],"64156":[39.2901,-94.5336,"Kansas City"],"64157":[39.2767,-94.4595,"Kansas City"],"64158":[39.2284,-94.472,"Kansas City"],"64161":[39.1661,-94.464,"Kansas City"],"64162":[39.1562,-94.4797,"Kansas City"],"64165":[39.3113,-94.5431,"Kansas City"],"64166":[39.3294,-94.5199,"Kansas City"],"64167":[39.32,-94.4877,"Kansas City"],"64429":[39.7309,-94.2437,"Cameron"],"64454":[39.602,-94.5965,"Gower"],"64465":[39.5177,-94.3093,"Lathrop"],"64477":[39.5705,-94.4338,"Plattsburg"],"64492":[39.4871,-94.5512,"Trimble"],"64493":[39.6318,-94.2972,"Turney"],"65023":[38.6297,-92.3995,"Centertown"],"65032":[38.3424,-92.3823,"Eugene"],"65040":[38.3445,-92.3224,"Henley"],"65053":[38.5484,-92.3842,"Lohman"],"65074":[38.5005,-92.4291,"Russellville"],"65076":[38.3912,-92.1894,"Saint Thomas"],"65101":[38.5462,-92.1525,"Jefferson City"],"65102":[38.5767,-92.1735,"Jefferson City"],"65103":[38.5767,-92.1735,"Jefferson City"],"65104":[38.5767,-92.1735,"Jefferson City"],"65105":[38.5767,-92.1735,"Jefferson City"],"65106":[38.5767,-92.1735,"Jefferson City"],"65107":[38.5767,-92.1735,"Jefferson City"],"65108":[38.5767,-92.1735,"Jefferson City"],"65109":[38.5773,-92.2443,"Jefferson City"],"65110":[38.5767,-92.1735,"Jefferson City"],"65111":[38.5309,-92.2493,"Jefferson City"],"65068":[38.8253,-92.5974,"Prairie Home"],"65233":[38.9536,-92.745,"Boonville"],"65237":[38.7881,-92.7994,"Bunceton"],"65276":[38.8712,-92.9305,"Pilot Grove"],"65287":[38.8983,-92.5667,"Wooldridge"],"65322":[38.9727,-92.9683,"Blackwater"],"65348":[38.7161,-93.0108,"Otterville"],"65441":[38.172,-91.2225,"Bourbon"],"65446":[37.8066,-91.2348,"Cherryville"],"65449":[37.8242,-91.5623,"Cook Sta"],"65453":[38.0926,-91.4081,"Cuba"],"65456":[37.787,-91.2116,"Davisville"],"65535":[38.092,-91.2965,"Leasburg"],"65565":[37.8904,-91.3032,"Steelville"],"65586":[37.8585,-91.4267,"Wesco"],"65603":[37.5512,-93.8619,"Arcola"],"65635":[37.5105,-93.6956,"Dadeville"],"65646":[37.3425,-93.7024,"Everton"],"65661":[37.4197,-93.8407,"Greenfield"],"65682":[37.386,-93.9541,"Lockwood"],"65752":[37.3743,-93.8445,"South Greenfield"],"65590":[37.5808,-92.9309,"Long Lane"],"65622":[37.6429,-93.0906,"Buffalo"],"65685":[37.7542,-93.1566,"Louisburg"],"65764":[37.8392,-92.9808,"Tunas"],"65767":[37.8523,-93.151,"Urbana"],"65783":[37.7182,-92.9379,"Windyville"],"64620":[39.896,-94.0897,"Altamont"],"64636":[40.0999,-94.0252,"Coffey"],"64640":[39.9025,-93.9787,"Gallatin"],"64642":[40.145,-93.832,"Gilman City"],"64647":[40.0046,-93.9597,"Jameson"],"64648":[39.9837,-93.78,"Jamesport"],"64654":[39.8489,-93.7774,"Lock Springs"],"64670":[40.0428,-94.1343,"Pattonsburg"],"64689":[39.8499,-94.1487,"Winston"],"64422":[39.8837,-94.5136,"Amity"],"64430":[39.8137,-94.5421,"Clarksdale"],"64469":[39.9112,-94.3548,"Maysville"],"64474":[39.7912,-94.3974,"Osborn"],"64490":[39.7984,-94.5175,"Stewartsville"],"64494":[39.9846,-94.5787,"Union Star"],"64497":[39.9277,-94.2429,"Weatherby"],"65440":[37.6373,-91.2109,"Boss"],"65501":[37.4867,-91.571,"Jadwin"],"65532":[37.7825,-91.6788,"Lake Spring"],"65541":[37.6531,-91.7613,"Lenox"],"65560":[37.617,-91.5258,"Salem"],"65608":[36.9407,-92.6765,"Ava"],"65638":[36.9319,-92.3664,"Drury"],"65755":[36.8504,-92.5844,"Squires"],"65768":[36.9698,-92.3029,"Vanzant"],"63821":[36.0501,-90.2284,"Arbyrd"],"63829":[36.0434,-90.2907,"Cardwell"],"63837":[36.4478,-89.9729,"Clarkton"],"63847":[36.4412,-90.0309,"Gibson"],"63852":[36.3885,-90.0208,"Holcomb"],"63855":[36.0627,-90.0816,"Hornersville"],"63857":[36.2407,-90.0491,"Kennett"],"63863":[36.5672,-89.9737,"Malden"],"63875":[36.0937,-90.0134,"Rives"],"63876":[36.1324,-90.1632,"Senath"],"63880":[36.3133,-90.1658,"Whiteoak"],"63933":[36.5197,-90.0829,"Campbell"],"63013":[38.4294,-91.1709,"Beaufort"],"63014":[38.6444,-91.3374,"Berger"],"63015":[38.4047,-90.7806,"Catawissa"],"63037":[38.3507,-91.2931,"Gerald"],"63039":[38.503,-90.8292,"Gray Summit"],"63055":[38.52,-90.877,"Labadie"],"63056":[38.4555,-91.2328,"Leslie"],"63060":[38.2743,-90.8903,"Lonedell"],"63061":[38.2615,-90.8027,"Luebbering"],"63068":[38.574,-91.2291,"New Haven"],"63069":[38.4922,-90.748,"Pacific"],"63072":[38.3816,-90.8016,"Robertsville"],"63073":[38.5792,-90.7751,"Saint Albans"],"63077":[38.3299,-90.9713,"Saint Clair"],"63079":[38.2745,-91.1057,"Stanton"],"63080":[38.2307,-91.1567,"Sullivan"],"63084":[38.4456,-91.0206,"Union"],"63089":[38.4601,-90.8822,"Villa Ridge"],"63090":[38.5459,-91.0193,"Washington"],"63091":[38.3853,-91.3974,"Rosebud"],"65014":[38.3074,-91.6263,"Bland"],"65036":[38.6703,-91.5592,"Gasconade"],"65041":[38.5876,-91.4991,"Hermann"],"65061":[38.606,-91.658,"Morrison"],"65062":[38.4956,-91.6515,"Mount Sterling"],"65066":[38.3511,-91.4867,"Owensville"],"64402":[40.2513,-94.327,"Albany"],"64438":[40.1955,-94.4049,"Darlington"],"64453":[40.3411,-94.4142,"Gentry"],"64463":[40.0652,-94.5234,"King City"],"64489":[40.2293,-94.5387,"Stanberry"],"64657":[40.1051,-94.3003,"Mc Fall"],"65604":[37.316,-93.5781,"Ash Grove"],"65612":[37.2214,-93.5447,"Bois D Arc"],"65619":[37.1634,-93.4202,"Brookline"],"65648":[37.3721,-93.1428,"Fair Grove"],"65738":[37.123,-93.48,"Republic"],"65757":[37.2797,-93.1066,"Strafford"],"65765":[37.1809,-93.1555,"Turners"],"65770":[37.3943,-93.5044,"Walnut Grove"],"65781":[37.2962,-93.4259,"Willard"],"65801":[37.2581,-93.3437,"Springfield"],"65802":[37.2117,-93.299,"Springfield"],"65803":[37.2593,-93.2912,"Springfield"],"65804":[37.1654,-93.2522,"Springfield"],"65805":[37.2581,-93.3437,"Springfield"],"65806":[37.2031,-93.2971,"Springfield"],"65807":[37.1668,-93.3085,"Springfield"],"65808":[37.2581,-93.3437,"Springfield"],"65809":[37.1852,-93.2057,"Springfield"],"65810":[37.1136,-93.2896,"Springfield"],"65814":[37.2581,-93.3437,"Springfield"],"65817":[37.2581,-93.3437,"Springfield"],"65890":[37.2581,-93.3437,"Springfield"],"65897":[37.1987,-93.2784,"Springfield"],"65898":[37.2153,-93.2982,"Springfield"],"65899":[37.1815,-93.2596,"Springfield"],"64641":[40.144,-93.3953,"Galt"],"64652":[40.0144,-93.4407,"Laredo"],"64679":[40.2439,-93.5944,"Spickard"],"64683":[40.0823,-93.6086,"Trenton"],"64424":[40.2601,-94.0189,"Bethany"],"64426":[40.5024,-93.8954,"Blythedale"],"64442":[40.4912,-93.9951,"Eagleville"],"64458":[40.5219,-94.1691,"Hatfield"],"64467":[40.3662,-94.1645,"Martinsville"],"64471":[40.2444,-94.1786,"New Hampton"],"64481":[40.3999,-93.9575,"Ridgeway"],"64632":[40.4578,-93.759,"Cainsville"],"64726":[38.5319,-93.9221,"Blairstown"],"64735":[38.4018,-93.785,"Clinton"],"64740":[38.2432,-93.7303,"Deepwater"],"64770":[38.2597,-93.9952,"Montrose"],"64788":[38.4449,-93.9785,"Urich"],"65323":[38.4858,-93.6459,"Calhoun"],"65360":[38.5272,-93.5269,"Windsor"],"65634":[38.0239,-93.1978,"Cross Timbers"],"65668":[37.8969,-93.2979,"Hermitage"],"65724":[37.8442,-93.3356,"Pittsburg"],"65732":[37.939,-93.1713,"Preston"],"65735":[38.0084,-93.4724,"Quincy"],"65774":[37.8906,-93.5419,"Weaubleau"],"65779":[37.9103,-93.3981,"Wheatland"],"64437":[40.1267,-95.3291,"Craig"],"64451":[39.9897,-95.1916,"Forest City"],"64466":[40.1991,-95.0927,"Maitland"],"64470":[40.1362,-95.2138,"Mound City"],"64473":[39.9809,-95.1234,"Oregon"],"65230":[39.2566,-92.709,"Armstrong"],"65248":[39.143,-92.6583,"Fayette"],"65250":[39.0668,-92.8316,"Franklin"],"65254":[39.2257,-92.8318,"Glasgow"],"65274":[39.02,-92.7386,"New Franklin"],"65548":[36.9892,-91.7099,"Mountain View"],"65626":[36.6035,-92.0678,"Caulfield"],"65688":[36.6488,-91.6976,"Brandsville"],"65775":[36.7284,-91.8717,"West Plains"],"65777":[36.533,-91.9898,"Moody"],"65788":[36.8091,-91.6938,"Peace Valley"],"65789":[36.8441,-91.9137,"Pomona"],"65790":[36.7068,-92.044,"Pottersville"],"65793":[36.9958,-91.9405,"Willow Springs"],"63620":[37.3981,-90.6702,"Annapolis"],"63621":[37.4871,-90.6062,"Arcadia"],"63623":[37.682,-90.7991,"Belleview"],"63636":[37.2955,-90.6279,"Des Arc"],"63650":[37.6168,-90.5985,"Ironton"],"63656":[37.5055,-90.845,"Middle Brook"],"63663":[37.625,-90.646,"Pilot Knob"],"63675":[37.306,-90.7106,"Vulcan"],"65439":[37.6603,-91.1151,"Bixby"],"65566":[37.7151,-91.1289,"Viburnum"],"64002":[38.9285,-94.3983,"Lees Summit"],"64013":[39.017,-94.2816,"Blue Springs"],"64014":[39.0152,-94.2604,"Blue Springs"],"64015":[39.015,-94.3118,"Blue Springs"],"64016":[39.1303,-94.2062,"Buckner"],"64029":[39.0274,-94.2087,"Grain Valley"],"64030":[38.8819,-94.5205,"Grandview"],"64034":[38.8644,-94.2815,"Greenwood"],"64050":[39.0983,-94.4111,"Independence"],"64051":[39.0911,-94.4155,"Independence"],"64052":[39.075,-94.4499,"Independence"],"64053":[39.105,-94.4625,"Independence"],"64054":[39.11,-94.4401,"Independence"],"64055":[39.0545,-94.4039,"Independence"],"64056":[39.1177,-94.3596,"Independence"],"64057":[39.0731,-94.3533,"Independence"],"64058":[39.1412,-94.3515,"Independence"],"64063":[38.912,-94.3517,"Lees Summit"],"64064":[38.9953,-94.3652,"Lees Summit"],"64065":[38.9529,-94.4058,"Lees Summit"],"64066":[39.1356,-94.133,"Levasy"],"64070":[38.8918,-94.1615,"Lone Jack"],"64075":[38.9985,-94.1399,"Oak Grove"],"64081":[38.9142,-94.4073,"Lees Summit"],"64082":[38.8518,-94.3944,"Lees Summit"],"64086":[38.944,-94.2881,"Lees Summit"],"64088":[39.1584,-94.1844,"Sibley"],"64101":[39.1024,-94.5986,"Kansas City"],"64102":[39.0861,-94.6066,"Kansas City"],"64105":[39.1025,-94.5901,"Kansas City"],"64106":[39.1052,-94.5699,"Kansas City"],"64108":[39.0837,-94.5868,"Kansas City"],"64109":[39.0663,-94.5674,"Kansas City"],"64110":[39.0361,-94.5722,"Kansas City"],"64111":[39.0565,-94.5929,"Kansas City"],"64112":[39.0382,-94.5929,"Kansas City"],"64113":[39.0123,-94.5938,"Kansas City"],"64114":[38.9621,-94.5959,"Kansas City"],"64120":[39.1222,-94.5487,"Kansas City"],"64121":[39.0997,-94.5786,"Kansas City"],"64123":[39.1136,-94.5235,"Kansas City"],"64124":[39.1068,-94.5394,"Kansas City"],"64125":[39.1042,-94.4923,"Kansas City"],"64126":[39.0923,-94.5047,"Kansas City"],"64127":[39.0883,-94.5366,"Kansas City"],"64128":[39.0659,-94.5386,"Kansas City"],"64129":[39.0401,-94.4951,"Kansas City"],"64130":[39.0351,-94.5467,"Kansas City"],"64131":[38.9713,-94.5774,"Kansas City"],"64132":[38.9911,-94.5522,"Kansas City"],"64133":[39.0323,-94.47,"Kansas City"],"64134":[38.9296,-94.5009,"Kansas City"],"64136":[39.0187,-94.4008,"Kansas City"],"64137":[38.9299,-94.5405,"Kansas City"],"64138":[38.9528,-94.4705,"Kansas City"],"64139":[38.9659,-94.4061,"Kansas City"],"64141":[39.0997,-94.5786,"Kansas City"],"64145":[38.8977,-94.5976,"Kansas City"],"64146":[38.8973,-94.5764,"Kansas City"],"64147":[38.8549,-94.5568,"Kansas City"],"64148":[39.0997,-94.5786,"Kansas City"],"64149":[38.8606,-94.4636,"Kansas City"],"64170":[39.0997,-94.5786,"Kansas City"],"64171":[39.0997,-94.5786,"Kansas City"],"64179":[39.0997,-94.5786,"Kansas City"],"64180":[39.0997,-94.5786,"Kansas City"],"64184":[39.0997,-94.5786,"Kansas City"],"64187":[39.0997,-94.5786,"Kansas City"],"64188":[39.0997,-94.5786,"Kansas City"],"64191":[39.0997,-94.5786,"Kansas City"],"64196":[39.0997,-94.5786,"Kansas City"],"64197":[39.0997,-94.5786,"Kansas City"],"64198":[39.0997,-94.5786,"Kansas City"],"64199":[39.0997,-94.5786,"Kansas City"],"64999":[39.0997,-94.5786,"Kansas City"],"64755":[37.3362,-94.3013,"Jasper"],"64801":[37.0969,-94.5051,"Joplin"],"64802":[37.0842,-94.5133,"Joplin"],"64803":[37.0842,-94.5133,"Joplin"],"64804":[37.0465,-94.5103,"Joplin"],"64830":[37.2367,-94.418,"Alba"],"64832":[37.2942,-94.5655,"Asbury"],"64833":[37.1953,-94.1297,"Avilla"],"64834":[37.1795,-94.555,"Carl Junction"],"64835":[37.1507,-94.4359,"Carterville"],"64836":[37.1597,-94.3112,"Carthage"],"64841":[37.076,-94.4071,"Duenweg"],"64848":[37.1739,-94.0329,"La Russell"],"64849":[37.257,-94.4444,"Neck City"],"64855":[37.2717,-94.4865,"Oronogo"],"64857":[37.2423,-94.4352,"Purcell"],"64859":[37.1225,-94.1613,"Reeds"],"64862":[37.0724,-94.1151,"Sarcoxie"],"64870":[37.144,-94.4727,"Webb City"],"63010":[38.4305,-90.387,"Arnold"],"63012":[38.3384,-90.4142,"Barnhart"],"63016":[38.3573,-90.6498,"Cedar Hill"],"63019":[38.23,-90.3825,"Crystal City"],"63020":[38.1204,-90.5546,"De Soto"],"63023":[38.3155,-90.6911,"Dittmer"],"63028":[38.1879,-90.4286,"Festus"],"63030":[38.1659,-90.7335,"Fletcher"],"63041":[38.251,-90.7901,"Grubville"],"63047":[38.202,-90.481,"Hematite"],"63048":[38.2625,-90.3896,"Herculaneum"],"63049":[38.4728,-90.5281,"High Ridge"],"63050":[38.2586,-90.5782,"Hillsboro"],"63051":[38.4131,-90.5575,"House Springs"],"63052":[38.4069,-90.4381,"Imperial"],"63053":[38.3653,-90.3629,"Kimmswick"],"63057":[38.3419,-90.4082,"Liguori"],"63065":[38.2489,-90.4835,"Mapaville"],"63066":[38.2809,-90.6521,"Morse Mill"],"63070":[38.2799,-90.4111,"Pevely"],"64019":[38.7897,-93.8702,"Centerview"],"64040":[38.7186,-93.9856,"Holden"],"64061":[38.8178,-94.0462,"Kingsville"],"64093":[38.7667,-93.7273,"Warrensburg"],"64733":[38.6126,-93.8653,"Chilhowee"],"64761":[38.5831,-93.6947,"Leeton"],"65305":[38.7318,-93.5731,"Whiteman Air Force Base"],"65336":[38.7667,-93.5585,"Knob Noster"],"63446":[40.1384,-92.0077,"Knox City"],"63458":[39.9931,-91.973,"Newark"],"63460":[40.0125,-92.2082,"Novelty"],"63464":[39.9765,-92.0852,"Plevna"],"63531":[40.2509,-92.2311,"Baring"],"63537":[40.1795,-92.1455,"Edina"],"63547":[40.1609,-92.2791,"Hurdland"],"65463":[37.8346,-92.7382,"Eldridge"],"65470":[37.6061,-92.3466,"Falcon"],"65536":[37.685,-92.655,"Lebanon"],"65543":[37.5054,-92.3202,"Lynchburg"],"65632":[37.5085,-92.7891,"Conway"],"65722":[37.5832,-92.7416,"Phillipsburg"],"64001":[39.1048,-93.5429,"Alma"],"64011":[39.0219,-94.0798,"Bates City"],"64020":[38.9776,-93.5812,"Concordia"],"64021":[39.1024,-93.6391,"Corder"],"64022":[39.1926,-93.6684,"Dover"],"64037":[39.0705,-93.7133,"Higginsville"],"64067":[39.1742,-93.8714,"Lexington"],"64071":[39.0459,-93.8353,"Mayview"],"64074":[39.114,-94.0709,"Napoleon"],"64076":[38.9829,-93.9757,"Odessa"],"64096":[39.2055,-93.5257,"Waverly"],"64097":[39.1258,-93.9855,"Wellington"],"65327":[38.9717,-93.4947,"Emma"],"65605":[36.9709,-93.718,"Aurora"],"65654":[37.0211,-93.8974,"Freistatt"],"65664":[37.1944,-93.6275,"Halltown"],"65705":[37.0009,-93.6413,"Marionville"],"65707":[37.2225,-93.8422,"Miller"],"65712":[37.1045,-93.7976,"Mount Vernon"],"65723":[36.973,-94.0024,"Pierce City"],"65756":[37.1031,-93.9543,"Stotts City"],"65769":[36.937,-93.8005,"Verona"],"63435":[40.1437,-91.548,"Canton"],"63438":[39.9625,-91.6704,"Durham"],"63440":[39.9962,-91.7216,"Ewing"],"63447":[40.1164,-91.9171,"La Belle"],"63448":[40.0391,-91.5182,"La Grange"],"63452":[40.0867,-91.8157,"Lewistown"],"63457":[40.1184,-91.7121,"Monticello"],"63473":[40.2491,-91.7852,"Williamstown"],"63343":[39.159,-90.816,"Elsberry"],"63347":[39.053,-90.7775,"Foley"],"63349":[38.9766,-91.1211,"Hawk Point"],"63362":[38.9482,-90.9138,"Moscow Mills"],"63369":[38.9346,-90.7782,"Old Monroe"],"63370":[39.0839,-91.2432,"Olney"],"63377":[39.1166,-91.037,"Silex"],"63379":[39.0012,-90.9624,"Troy"],"63381":[38.967,-91.2126,"Truxton"],"63387":[39.1853,-91.0168,"Whiteside"],"63389":[38.9897,-90.8213,"Winfield"],"63557":[39.9332,-92.916,"New Boston"],"64628":[39.7846,-93.0719,"Brookfield"],"64630":[40.029,-93.1607,"Browning"],"64631":[39.8006,-92.8928,"Bucklin"],"64651":[39.7837,-93.168,"Laclede"],"64653":[39.9099,-93.1885,"Linneus"],"64658":[39.7125,-92.9455,"Marceline"],"64659":[39.7795,-93.3014,"Meadville"],"64674":[39.9529,-93.17,"Purdin"],"64601":[39.7966,-93.5509,"Chillicothe"],"64635":[39.9226,-93.4841,"Chula"],"64638":[39.6665,-93.5964,"Dawn"],"64656":[39.6551,-93.7046,"Ludlow"],"64664":[39.7425,-93.7169,"Mooresville"],"64686":[39.7417,-93.6289,"Utica"],"64688":[39.8011,-93.3868,"Wheeling"],"64831":[36.6506,-94.4436,"Anderson"],"64843":[36.7323,-94.3986,"Goodman"],"64847":[36.606,-94.4551,"Lanagan"],"64854":[36.5417,-94.4906,"Noel"],"64856":[36.574,-94.377,"Pineville"],"64861":[36.7175,-94.1091,"Rocky Comfort"],"64863":[36.5319,-94.5961,"South West City"],"64868":[36.6684,-94.6172,"Tiff City"],"65730":[36.6237,-94.1773,"Powell"],"63431":[39.7428,-92.328,"Anabel"],"63530":[39.9146,-92.475,"Atlanta"],"63532":[39.7497,-92.5619,"Bevier"],"63534":[39.7448,-92.6351,"Callao"],"63538":[39.9415,-92.6424,"Elmer"],"63539":[39.9146,-92.7664,"Ethel"],"63549":[40.0208,-92.5077,"La Plata"],"63552":[39.7481,-92.4622,"Macon"],"63558":[39.7551,-92.7695,"New Cambria"],"65247":[39.6455,-92.4757,"Excello"],"63645":[37.4906,-90.3362,"Fredericktown"],"63655":[37.4274,-90.1741,"Marquand"],"65013":[38.2711,-91.7303,"Belle"],"65443":[38.1483,-92.1015,"Brinktown"],"65580":[38.098,-91.7788,"Vichy"],"65582":[38.1919,-91.9422,"Vienna"],"63401":[39.7064,-91.3839,"Hannibal"],"63454":[39.9333,-91.6148,"Maywood"],"63461":[39.7913,-91.5368,"Palmyra"],"63463":[39.8359,-91.7538,"Philadelphia"],"63471":[39.9145,-91.5278,"Taylor"],"64661":[40.5169,-93.5242,"Mercer"],"64673":[40.3855,-93.5774,"Princeton"],"65017":[38.0709,-92.4747,"Brumley"],"65026":[38.3401,-92.5736,"Eldon"],"65047":[38.1637,-92.5799,"Kaiser"],"65064":[38.4109,-92.5294,"Olean"],"65075":[38.2712,-92.2635,"Saint Elizabeth"],"65082":[38.2181,-92.4461,"Tuscumbia"],"65083":[38.1505,-92.433,"Ulman"],"65486":[38.1219,-92.2989,"Iberia"],"63820":[36.8259,-89.3279,"Anniston"],"63823":[36.8927,-89.4483,"Bertrand"],"63834":[36.9213,-89.3342,"Charleston"],"63845":[36.7776,-89.3726,"East Prairie"],"63881":[36.7392,-89.2103,"Wolf Island"],"63882":[36.9092,-89.2226,"Wyatt"],"65018":[38.6224,-92.5456,"California"],"65025":[38.6432,-92.6729,"Clarksburg"],"65034":[38.5667,-92.798,"Fortuna"],"65042":[38.6749,-92.6109,"High Point"],"65046":[38.7793,-92.4807,"Jamestown"],"65050":[38.5466,-92.6817,"Latham"],"65055":[38.6749,-92.6109,"Mc Girk"],"65081":[38.6548,-92.7814,"Tipton"],"63456":[39.6546,-91.723,"Monroe City"],"65258":[39.4904,-92.1318,"Holliday"],"65263":[39.4615,-92.2287,"Madison"],"65275":[39.4932,-92.0113,"Paris"],"65282":[39.3989,-91.8294,"Santa Fe"],"65283":[39.5594,-91.8297,"Stoutsville"],"63333":[39.0012,-91.3489,"Bellflower"],"63350":[38.8902,-91.3715,"High Hill"],"63351":[38.8717,-91.3019,"Jonesburg"],"63359":[39.1055,-91.3873,"Middletown"],"63361":[38.9839,-91.5085,"Montgomery City"],"63363":[38.9023,-91.4909,"New Florence"],"63384":[39.0765,-91.5645,"Wellsville"],"65069":[38.7942,-91.5737,"Rhineland"],"65011":[38.3967,-92.6686,"Barnett"],"65037":[38.2584,-92.823,"Gravois Mills"],"65038":[38.1992,-92.8335,"Laurie"],"65072":[38.2911,-92.7059,"Rocky Mount"],"65078":[38.4414,-92.9947,"Stover"],"65084":[38.4365,-92.8258,"Versailles"],"65329":[38.6101,-92.9986,"Florence"],"65354":[38.6547,-92.8929,"Syracuse"],"63828":[36.7504,-89.6918,"Canalou"],"63833":[36.6876,-89.7706,"Catron"],"63848":[36.4538,-89.9135,"Gideon"],"63860":[36.6726,-89.5639,"Kewanee"],"63862":[36.5853,-89.6112,"Lilbourn"],"63866":[36.519,-89.6126,"Marston"],"63867":[36.7154,-89.6287,"Matthews"],"63868":[36.8504,-89.6847,"Morehouse"],"63869":[36.6073,-89.5366,"New Madrid"],"63870":[36.5856,-89.819,"Parma"],"63873":[36.4279,-89.7002,"Portageville"],"63874":[36.5534,-89.8179,"Risco"],"63878":[36.503,-89.8224,"Tallapoosa"],"64840":[37.006,-94.3204,"Diamond"],"64842":[36.8254,-94.0912,"Fairview"],"64844":[36.9066,-94.2643,"Granby"],"64850":[36.8706,-94.3862,"Neosho"],"64853":[36.8767,-94.1855,"Newtonia"],"64858":[36.901,-94.5321,"Racine"],"64864":[37.024,-94.4683,"Saginaw"],"64865":[36.8408,-94.5781,"Seneca"],"64866":[36.8785,-94.1548,"Stark City"],"64867":[36.7516,-94.2086,"Stella"],"64873":[37.0177,-94.0514,"Wentworth"],"64423":[40.1862,-94.8056,"Barnard"],"64428":[40.4475,-95.063,"Burlington Junction"],"64431":[40.5175,-95.0055,"Clearmont"],"64432":[40.2635,-94.6687,"Clyde"],"64433":[40.2428,-94.6869,"Conception"],"64434":[40.2659,-94.6915,"Conception Junction"],"64445":[40.5185,-95.1236,"Elmo"],"64455":[40.2012,-95.0121,"Graham"],"64457":[40.1746,-94.6951,"Guilford"],"64461":[40.5483,-94.8189,"Hopkins"],"64468":[40.3434,-94.8735,"Maryville"],"64475":[40.44,-94.6233,"Parnell"],"64476":[40.4591,-94.8411,"Pickering"],"64479":[40.3579,-94.6805,"Ravenwood"],"64487":[40.2896,-95.0792,"Skidmore"],"65606":[36.6929,-91.3971,"Alton"],"65690":[36.5853,-91.2724,"Couch"],"65692":[36.6056,-91.6304,"Koshkonong"],"65778":[36.5217,-91.2706,"Myrtle"],"65791":[36.5327,-91.5418,"Thayer"],"65001":[38.2986,-92.0155,"Argyle"],"65016":[38.5533,-91.9293,"Bonnots Mill"],"65024":[38.6527,-91.7697,"Chamois"],"65035":[38.3551,-91.9276,"Freeburg"],"65048":[38.3615,-92.0468,"Koeltztown"],"65051":[38.4739,-91.8195,"Linn"],"65054":[38.4717,-91.9591,"Loose Creek"],"65058":[38.25,-92.1358,"Meta"],"65085":[38.427,-92.0392,"Westphalia"],"65609":[36.5332,-92.1507,"Bakersfield"],"65618":[36.759,-92.4026,"Brixey"],"65637":[36.756,-92.2378,"Dora"],"65655":[36.5901,-92.4162,"Gainesville"],"65666":[36.5892,-92.3713,"Hardenville"],"65676":[36.5749,-92.6053,"Isabella"],"65715":[36.7441,-92.5769,"Noble"],"65729":[36.5156,-92.6038,"Pontiac"],"65741":[36.7895,-92.4091,"Rockbridge"],"65760":[36.5875,-92.2598,"Tecumseh"],"65761":[36.583,-92.6628,"Theodosia"],"65762":[36.6875,-92.6534,"Thornfield"],"65766":[36.544,-92.2588,"Udall"],"65773":[36.7573,-92.5093,"Wasola"],"65784":[36.6862,-92.3318,"Zanoni"],"63826":[36.1753,-89.8295,"Braggadocio"],"63827":[36.2732,-89.8736,"Bragg City"],"63830":[36.1802,-89.6683,"Caruthersville"],"63839":[36.0476,-89.8091,"Cooter"],"63840":[36.1909,-89.8829,"Deering"],"63849":[36.159,-89.9349,"Gobler"],"63851":[36.2337,-89.7495,"Hayti"],"63853":[36.0559,-89.8709,"Holland"],"63877":[36.0915,-89.8346,"Steele"],"63879":[36.3478,-89.8181,"Wardell"],"63732":[37.6279,-89.5745,"Altenburg"],"63737":[37.6633,-89.6529,"Brazeau"],"63746":[37.7078,-89.6948,"Farrar"],"63748":[37.6686,-89.6619,"Frohna"],"63775":[37.7174,-89.8737,"Perryville"],"63776":[37.7348,-89.8116,"Mc Bride"],"63783":[37.6073,-89.6798,"Uniontown"],"65301":[38.6961,-93.2323,"Sedalia"],"65302":[38.7045,-93.2283,"Sedalia"],"65332":[38.619,-93.4374,"Green Ridge"],"65333":[38.9106,-93.3325,"Houstonia"],"65334":[38.8494,-93.2159,"Hughesville"],"65337":[38.7753,-93.4313,"La Monte"],"65345":[38.5207,-93.2272,"Mora"],"65350":[38.66,-93.1088,"Smithton"],"65401":[37.9485,-91.7603,"Rolla"],"65402":[37.9514,-91.7713,"Rolla"],"65409":[37.9514,-91.7713,"Rolla"],"65436":[37.6158,-91.9064,"Beulah"],"65461":[37.6603,-92.0107,"Duke"],"65462":[37.7365,-91.8906,"Edgar Springs"],"65529":[37.9262,-91.9777,"Jerome"],"65550":[37.9008,-91.8807,"Newburg"],"65559":[38.0056,-91.6076,"Saint James"],"63330":[39.2558,-90.8224,"Annada"],"63334":[39.3346,-91.1962,"Bowling Green"],"63336":[39.3465,-90.9362,"Clarksville"],"63339":[39.3257,-91.3493,"Curryville"],"63344":[39.2431,-91.0093,"Eolia"],"63353":[39.4336,-91.0664,"Louisiana"],"63433":[39.561,-91.1844,"Ashburn"],"63441":[39.4892,-91.3031,"Frankford"],"64018":[39.4515,-94.7444,"Camden Point"],"64028":[39.2839,-94.8302,"Farley"],"64079":[39.3602,-94.789,"Platte City"],"64092":[39.2289,-94.8057,"Waldron"],"64098":[39.4453,-94.9145,"Weston"],"64150":[39.1776,-94.6321,"Riverside"],"64151":[39.2127,-94.6383,"Kansas City"],"64152":[39.2176,-94.7238,"Kansas City"],"64153":[39.2627,-94.697,"Kansas City"],"64154":[39.2547,-94.6354,"Kansas City"],"64163":[39.3402,-94.6908,"Kansas City"],"64164":[39.3426,-94.6446,"Kansas City"],"64168":[39.3432,-94.8516,"Kansas City"],"64190":[39.3432,-94.8516,"Kansas City"],"64195":[39.3432,-94.8516,"Kansas City"],"64439":[39.5172,-94.7664,"Dearborn"],"64444":[39.4742,-94.6352,"Edgerton"],"65601":[37.5057,-93.5576,"Aldrich"],"65613":[37.6085,-93.4126,"Bolivar"],"65617":[37.4728,-93.3603,"Brighton"],"65640":[37.7031,-93.5216,"Dunnegan"],"65645":[37.4767,-93.5397,"Eudora"],"65649":[37.6335,-93.6064,"Fair Play"],"65650":[37.7803,-93.4471,"Flemington"],"65663":[37.6018,-93.242,"Half Way"],"65674":[37.7923,-93.5795,"Humansville"],"65710":[37.4686,-93.4275,"Morrisville"],"65725":[37.4615,-93.2617,"Pleasant Hope"],"65727":[37.7292,-93.2994,"Polk"],"65452":[37.9446,-92.27,"Crocker"],"65457":[37.8512,-92.0569,"Devils Elbow"],"65459":[37.9848,-92.0897,"Dixon"],"65473":[37.7677,-92.112,"Fort Leonard Wood"],"65534":[37.6953,-92.2808,"Laquey"],"65556":[37.8528,-92.3962,"Richland"],"65583":[37.7676,-92.2105,"Waynesville"],"65584":[37.8283,-92.131,"Saint Robert"],"63551":[40.5112,-92.7241,"Livonia"],"63565":[40.4815,-92.9951,"Unionville"],"63567":[40.4084,-92.6888,"Worthington"],"64655":[40.4382,-93.2867,"Lucerne"],"64672":[40.5492,-93.3002,"Powersville"],"63436":[39.5154,-91.5398,"Center"],"63459":[39.5917,-91.396,"New London"],"63462":[39.4207,-91.6641,"Perry"],"63467":[39.65,-91.2705,"Saverton"],"65239":[39.5114,-92.44,"Cairo"],"65243":[39.2811,-92.3427,"Clark"],"65244":[39.426,-92.6677,"Clifton Hill"],"65257":[39.3055,-92.5163,"Higbee"],"65259":[39.4354,-92.553,"Huntsville"],"65260":[39.5791,-92.4315,"Jacksonville"],"65270":[39.4202,-92.4358,"Moberly"],"65278":[39.3414,-92.411,"Renick"],"64017":[39.2048,-94.0259,"Camden"],"64035":[39.3504,-93.8409,"Hardin"],"64036":[39.2367,-93.9369,"Henrietta"],"64062":[39.4401,-94.1966,"Lawson"],"64077":[39.2116,-94.1239,"Orrick"],"64084":[39.3853,-94.0284,"Rayville"],"64085":[39.2793,-93.9792,"Richmond"],"63625":[37.5473,-90.9917,"Black"],"63629":[37.4772,-91.1927,"Bunker"],"63633":[37.4285,-90.9757,"Centerville"],"63638":[37.2398,-90.9589,"Ellington"],"63654":[37.482,-90.8425,"Lesterville"],"63665":[37.32,-90.8985,"Redford"],"63666":[37.4009,-91.0735,"Reynolds"],"63931":[36.661,-90.8508,"Briar"],"63935":[36.6501,-90.8106,"Doniphan"],"63939":[36.6704,-90.6335,"Fairdealing"],"63942":[36.5626,-91.0703,"Gatewood"],"63953":[36.5843,-90.6124,"Naylor"],"63955":[36.5874,-90.692,"Oxly"],"63301":[38.8014,-90.5065,"Saint Charles"],"63302":[38.7839,-90.4812,"Saint Charles"],"63303":[38.7622,-90.5471,"Saint Charles"],"63304":[38.7378,-90.6234,"Saint Charles"],"63332":[38.5728,-90.8815,"Augusta"],"63338":[38.7462,-90.654,"Cottleville"],"63341":[38.6616,-90.8302,"Defiance"],"63346":[38.7509,-90.5368,"Flinthill"],"63348":[38.7626,-90.9343,"Foristell"],"63365":[38.7163,-90.8751,"New Melle"],"63366":[38.8239,-90.7427,"O Fallon"],"63367":[38.7936,-90.7854,"Lake Saint Louis"],"63368":[38.7513,-90.7296,"O Fallon"],"63373":[38.9259,-90.3863,"Portage Des Sioux"],"63376":[38.7802,-90.6228,"Saint Peters"],"63385":[38.802,-90.8534,"Wentzville"],"63386":[38.8758,-90.2384,"West Alton"],"64724":[38.1848,-94.0229,"Appleton City"],"64738":[37.881,-93.6608,"Collins"],"64763":[38.1404,-93.7114,"Lowry City"],"64776":[38.0286,-93.7536,"Osceola"],"64781":[37.9728,-93.8122,"Roscoe"],"63627":[38.0451,-90.2805,"Bloomsdale"],"63670":[37.8655,-90.1752,"Sainte Genevieve"],"63673":[37.8325,-89.977,"Saint Mary"],"63036":[37.9961,-90.4005,"French Village"],"63087":[37.9998,-90.4407,"Valles Mines"],"63601":[37.8498,-90.4885,"Park Hills"],"63624":[37.7539,-90.5984,"Bismarck"],"63626":[38.0544,-90.6279,"Blackwell"],"63628":[37.9231,-90.5554,"Bonne Terre"],"63637":[37.7348,-90.4968,"Doe Run"],"63640":[37.7773,-90.4094,"Farmington"],"63651":[37.6754,-90.3677,"Knob Lick"],"63653":[37.8577,-90.5879,"Leadwood"],"63005":[38.6318,-90.6142,"Chesterfield"],"63006":[38.6631,-90.5771,"Chesterfield"],"63011":[38.6091,-90.5598,"Ballwin"],"63017":[38.6491,-90.5358,"Chesterfield"],"63021":[38.577,-90.5255,"Ballwin"],"63022":[38.5951,-90.5462,"Ballwin"],"63024":[38.5951,-90.5462,"Ballwin"],"63025":[38.5128,-90.6306,"Eureka"],"63026":[38.5015,-90.4683,"Fenton"],"63031":[38.8069,-90.3401,"Florissant"],"63032":[38.6383,-90.4271,"Florissant"],"63033":[38.7947,-90.2831,"Florissant"],"63034":[38.8338,-90.2936,"Florissant"],"63038":[38.5878,-90.6639,"Glencoe"],"63040":[38.5667,-90.631,"Grover"],"63042":[38.7809,-90.3669,"Hazelwood"],"63043":[38.7229,-90.4474,"Maryland Heights"],"63044":[38.7506,-90.4161,"Bridgeton"],"63045":[38.7689,-90.4662,"Earth City"],"63074":[38.7259,-90.3864,"Saint Ann"],"63088":[38.5576,-90.4924,"Valley Park"],"63099":[38.6383,-90.4271,"Fenton"],"63105":[38.6459,-90.3264,"Saint Louis"],"63114":[38.7023,-90.3644,"Saint Louis"],"63117":[38.6295,-90.3342,"Saint Louis"],"63119":[38.5893,-90.3481,"Saint Louis"],"63121":[38.7071,-90.3055,"Saint Louis"],"63122":[38.5781,-90.4256,"Saint Louis"],"63123":[38.5476,-90.3241,"Saint Louis"],"63124":[38.6372,-90.3776,"Saint Louis"],"63125":[38.5222,-90.3021,"Saint Louis"],"63126":[38.5495,-90.3811,"Saint Louis"],"63127":[38.5355,-90.407,"Saint Louis"],"63128":[38.4915,-90.3772,"Saint Louis"],"63129":[38.4566,-90.3282,"Saint Louis"],"63130":[38.6669,-90.3225,"Saint Louis"],"63131":[38.6171,-90.4504,"Saint Louis"],"63132":[38.6746,-90.3747,"Saint Louis"],"63133":[38.6779,-90.3033,"Saint Louis"],"63134":[38.7435,-90.341,"Saint Louis"],"63135":[38.7497,-90.3012,"Saint Louis"],"63136":[38.7196,-90.27,"Saint Louis"],"63137":[38.7468,-90.2131,"Saint Louis"],"63138":[38.8033,-90.2065,"Saint Louis"],"63140":[38.7375,-90.3265,"Saint Louis"],"63141":[38.6565,-90.4542,"Saint Louis"],"63143":[38.6111,-90.3225,"Saint Louis"],"63144":[38.6182,-90.3489,"Saint Louis"],"63145":[38.6383,-90.4271,"Saint Louis"],"63146":[38.7033,-90.4618,"Saint Louis"],"63151":[38.6383,-90.4271,"Saint Louis"],"63167":[38.6383,-90.4271,"Saint Louis"],"65320":[39.0694,-92.9487,"Arrow Rock"],"65321":[39.0988,-93.4281,"Blackburn"],"65330":[39.2447,-92.9932,"Gilliam"],"65339":[39.1481,-93.3776,"Malta Bend"],"65340":[39.1614,-93.2444,"Marshall"],"65344":[39.2821,-93.1968,"Miami"],"65347":[39.0104,-93.0311,"Nelson"],"65349":[39.2163,-93.0547,"Slater"],"65351":[38.966,-93.4247,"Sweet Springs"],"63535":[40.5665,-92.6388,"Coatsville"],"63536":[40.4875,-92.3694,"Downing"],"63541":[40.5149,-92.5886,"Glenwood"],"63548":[40.5253,-92.5264,"Lancaster"],"63561":[40.4152,-92.5663,"Queen City"],"63432":[40.4863,-92.0047,"Arbela"],"63442":[40.4533,-92.1474,"Granger"],"63543":[40.3622,-92.014,"Gorin"],"63555":[40.4619,-92.1851,"Memphis"],"63563":[40.329,-92.0976,"Rutledge"],"63736":[37.0697,-89.5664,"Benton"],"63740":[37.1726,-89.6457,"Chaffee"],"63742":[37.157,-89.4484,"Commerce"],"63758":[37.1858,-89.5575,"Kelso"],"63767":[37.0411,-89.6076,"Morley"],"63771":[37.087,-89.6734,"Oran"],"63774":[37.0948,-89.7754,"Perkins"],"63780":[37.2077,-89.5181,"Scott City"],"63784":[36.9912,-89.6885,"Vanduser"],"63801":[36.8911,-89.582,"Sikeston"],"63824":[37.0042,-89.5266,"Blodgett"],"65438":[36.9476,-91.5008,"Birch Tree"],"65466":[37.1626,-91.4519,"Eminence"],"65546":[36.987,-91.5754,"Montier"],"65588":[37.0169,-91.3121,"Winona"],"63434":[39.8922,-92.0316,"Bethel"],"63437":[39.7366,-92.253,"Clarence"],"63439":[39.8019,-91.8606,"Emden"],"63443":[39.7018,-91.8832,"Hunnewell"],"63450":[39.7123,-92.1489,"Lentner"],"63451":[39.9076,-92.1947,"Leonard"],"63468":[39.6947,-92.0371,"Shelbina"],"63469":[39.8108,-92.0498,"Shelbyville"],"63730":[37.0922,-89.9106,"Advance"],"63735":[37.0116,-89.7984,"Bell City"],"63738":[37.0828,-89.9523,"Brownwood"],"63822":[36.6727,-89.9878,"Bernie"],"63825":[36.8989,-89.9456,"Bloomfield"],"63841":[36.7885,-89.9639,"Dexter"],"63846":[36.8109,-89.8366,"Essex"],"63850":[36.8283,-89.7565,"Grayridge"],"63936":[36.811,-90.121,"Dudley"],"63960":[36.9422,-90.1623,"Puxico"],"65611":[36.5493,-93.3388,"Blue Eye"],"65624":[36.7311,-93.5674,"Cape Fair"],"65633":[36.9258,-93.5303,"Crane"],"65656":[36.8198,-93.4811,"Galena"],"65675":[36.9305,-93.4965,"Hurley"],"65681":[36.5767,-93.4516,"Lampe"],"65686":[36.6393,-93.4372,"Kimberling City"],"65728":[36.8759,-93.3516,"Ponce De Leon"],"65737":[36.6907,-93.3447,"Reeds Spring"],"63544":[40.2703,-92.878,"Green Castle"],"63545":[40.2601,-92.9532,"Green City"],"63556":[40.1844,-93.1361,"Milan"],"63560":[40.3385,-93.1115,"Pollock"],"63566":[40.0371,-92.9301,"Winigan"],"64645":[40.3075,-93.3501,"Harris"],"64646":[40.1144,-93.3015,"Humphreys"],"64667":[40.3612,-93.3073,"Newtown"],"65614":[36.7659,-92.9151,"Bradleyville"],"65615":[36.661,-93.2358,"Branson"],"65616":[36.669,-93.2481,"Branson"],"65627":[36.571,-93.0172,"Cedarcreek"],"65653":[36.6955,-93.115,"Forsyth"],"65672":[36.6107,-93.2286,"Hollister"],"65673":[36.6179,-93.2162,"Hollister"],"65679":[36.5792,-93.1263,"Kirbyville"],"65680":[36.6704,-93.0377,"Kissee Mills"],"65726":[36.6165,-93.2418,"Point Lookout"],"65731":[36.6578,-93.1243,"Powersite"],"65733":[36.5286,-92.8465,"Protem"],"65739":[36.5247,-93.2778,"Ridgedale"],"65740":[36.7137,-93.1715,"Rockaway Beach"],"65744":[36.6314,-92.9188,"Rueter"],"65759":[36.7405,-93.028,"Taneyville"],"65771":[36.7704,-93.2148,"Walnut Shade"],"65444":[37.3972,-92.0465,"Bucyrus"],"65464":[37.1878,-91.9134,"Elk Creek"],"65468":[37.248,-91.7834,"Eunice"],"65479":[37.2843,-91.6834,"Hartshorn"],"65483":[37.3218,-91.953,"Houston"],"65484":[37.3538,-92.2153,"Huggins"],"65542":[37.5091,-91.8556,"Licking"],"65552":[37.5122,-92.1709,"Plato"],"65555":[37.3569,-91.8131,"Raymondville"],"65557":[37.5156,-92.139,"Roby"],"65564":[37.2428,-91.9624,"Solo"],"65570":[37.4626,-92.0909,"Success"],"65571":[37.1484,-91.6828,"Summersville"],"65589":[37.2311,-91.8244,"Yukon"],"65689":[37.1314,-92.1144,"Cabool"],"64728":[37.69,-94.486,"Bronaugh"],"64741":[37.8197,-94.5608,"Deerfield"],"64750":[37.953,-94.1402,"Harwood"],"64765":[37.9975,-94.4433,"Metz"],"64767":[37.7446,-94.3046,"Milo"],"64771":[37.7476,-94.4496,"Moundville"],"64772":[37.8409,-94.3571,"Nevada"],"64778":[37.9061,-94.5592,"Richards"],"64783":[38.0094,-94.1579,"Schell City"],"64784":[37.684,-94.2548,"Sheldon"],"64790":[37.893,-94.2293,"Walker"],"63342":[38.606,-90.9962,"Dutzow"],"63357":[38.6512,-91.1516,"Marthasville"],"63378":[38.6445,-91.1879,"Treloar"],"63380":[38.8117,-91.1304,"Truesdale"],"63383":[38.805,-91.174,"Warrenton"],"63390":[38.8097,-91.0329,"Wright City"],"63071":[38.1496,-90.831,"Richwoods"],"63622":[37.7889,-90.8613,"Belgrade"],"63630":[38.0125,-90.7439,"Cadet"],"63631":[37.7639,-90.7409,"Caledonia"],"63648":[37.8296,-90.6984,"Irondale"],"63660":[37.9156,-90.7193,"Mineral Point"],"63664":[37.9549,-90.8415,"Potosi"],"63674":[38.0192,-90.6529,"Tiff"],"63632":[37.2995,-90.2693,"Cascade"],"63763":[37.1196,-90.445,"Mc Gee"],"63934":[37.2145,-90.3457,"Clubb"],"63944":[37.1108,-90.4514,"Greenville"],"63950":[37.1196,-90.445,"Lodi"],"63951":[37.1343,-90.2544,"Lowndes"],"63952":[37.0675,-90.6746,"Mill Spring"],"63956":[37.1884,-90.5507,"Patterson"],"63957":[37.1573,-90.699,"Piedmont"],"63964":[37.2119,-90.4375,"Silva"],"63966":[36.9356,-90.2709,"Wappapello"],"63967":[36.9638,-90.4879,"Williamsville"],"65636":[37.1726,-92.8543,"Diggins"],"65644":[37.4336,-93.021,"Elkland"],"65652":[37.1447,-92.9111,"Fordland"],"65706":[37.3312,-92.925,"Marshfield"],"65713":[37.3985,-92.7763,"Niangua"],"65742":[37.131,-93.0964,"Rogersville"],"65746":[37.1667,-92.7857,"Seymour"],"64420":[40.4855,-94.2886,"Allendale"],"64441":[40.4181,-94.3066,"Denver"],"64456":[40.4924,-94.3979,"Grant City"],"64486":[40.4928,-94.5701,"Sheridan"],"64499":[40.3939,-94.4398,"Worth"],"65660":[37.3262,-92.2647,"Graff"],"65662":[37.4947,-92.6001,"Grovespring"],"65667":[37.2735,-92.5181,"Hartville"],"65702":[37.1049,-92.4821,"Macomb"],"65704":[37.1273,-92.5936,"Mansfield"],"65711":[37.1626,-92.2839,"Mountain Grove"],"65717":[37.0687,-92.4082,"Norwood"],"63101":[38.6346,-90.1913,"Saint Louis"],"63102":[38.6352,-90.1864,"Saint Louis"],"63103":[38.6332,-90.2164,"Saint Louis"],"63104":[38.6128,-90.2185,"Saint Louis"],"63106":[38.6442,-90.2082,"Saint Louis"],"63107":[38.6645,-90.2125,"Saint Louis"],"63108":[38.6445,-90.2544,"Saint Louis"],"63109":[38.5855,-90.2929,"Saint Louis"],"63110":[38.6185,-90.2564,"Saint Louis"],"63111":[38.5633,-90.2495,"Saint Louis"],"63112":[38.6616,-90.2819,"Saint Louis"],"63113":[38.659,-90.2496,"Saint Louis"],"63115":[38.6756,-90.2385,"Saint Louis"],"63116":[38.5814,-90.2625,"Saint Louis"],"63118":[38.5943,-90.2309,"Saint Louis"],"63120":[38.6909,-90.2595,"Saint Louis"],"63139":[38.6108,-90.292,"Saint Louis"],"63147":[38.7139,-90.2375,"Saint Louis"],"63150":[38.6273,-90.1979,"Saint Louis"],"63155":[38.6273,-90.1979,"Saint Louis"],"63156":[38.6531,-90.2435,"Saint Louis"],"63157":[38.6531,-90.2435,"Saint Louis"],"63158":[38.6531,-90.2435,"Saint Louis"],"63160":[38.6531,-90.2435,"Saint Louis"],"63163":[38.6531,-90.2435,"Saint Louis"],"63164":[38.6531,-90.2435,"Saint Louis"],"63166":[38.6531,-90.2435,"Saint Louis"],"63169":[38.6273,-90.1979,"Saint Louis"],"63171":[38.6531,-90.2435,"Saint Louis"],"63177":[38.6531,-90.2435,"Saint Louis"],"63178":[38.6531,-90.2435,"Saint Louis"],"63179":[38.6531,-90.2435,"Saint Louis"],"63180":[38.6273,-90.1979,"Saint Louis"],"63182":[38.6273,-90.1979,"Saint Louis"],"63188":[38.6273,-90.1979,"Saint Louis"],"63195":[38.6531,-90.2435,"Saint Louis"],"63197":[38.6273,-90.1979,"Saint Louis"],"63199":[38.6531,-90.2435,"Saint Louis"]};
function zipToCounty(zip) {
  const z = String(zip || '').trim();
  return MO_KS_ZIP_COUNTY[z] || null;
}
// ZIP → school district for the KC metro (Northland, Eastern Jackson, KC core). Auto-fills
// district on a signup so suburban folks route without the team having to touch them.
const ZIP_DISTRICT = {"64013":"Blue Springs School District", "64014":"Blue Springs School District", "64015":"Blue Springs School District", "64016":"Fort Osage R-1", "64024":"Excelsior Springs School District", "64029":"Grain Valley R-5", "64030":"Grandview C-4", "64048":"Fort Osage R-1", "64050":"Independence School District", "64051":"Independence School District", "64052":"Independence School District", "64053":"Independence School District", "64054":"Independence School District", "64055":"Independence School District", "64056":"Independence School District", "64057":"Independence School District", "64058":"Independence School District", "64060":"Kearney School District", "64062":"Kearney School District", "64063":"Lee's Summit R-7", "64064":"Lee's Summit R-7", "64068":"Liberty Public Schools", "64069":"Liberty Public Schools", "64072":"Fort Osage R-1", "64074":"Fort Osage R-1", "64075":"Oak Grove R-6", "64078":"Raymore-Peculiar", "64079":"Platte County R-3", "64081":"Lee's Summit R-7", "64082":"Lee's Summit R-7", "64083":"Raymore-Peculiar", "64086":"Lee's Summit R-7", "64089":"Smithville School District", "64092":"Platte County R-3", "64098":"Platte County R-3", "64101":"Kansas City Public Schools", "64105":"Kansas City Public Schools", "64106":"Kansas City Public Schools", "64108":"Kansas City Public Schools", "64109":"Kansas City Public Schools", "64110":"Kansas City Public Schools", "64111":"Kansas City Public Schools", "64112":"Kansas City Public Schools", "64113":"Kansas City Public Schools", "64114":"Center 58", "64116":"North Kansas City Schools", "64117":"North Kansas City Schools", "64118":"North Kansas City Schools", "64119":"North Kansas City Schools", "64120":"Kansas City Public Schools", "64121":"Kansas City Public Schools", "64123":"Kansas City Public Schools", "64124":"Kansas City Public Schools", "64125":"Kansas City Public Schools", "64126":"Kansas City Public Schools", "64127":"Kansas City Public Schools", "64128":"Kansas City Public Schools", "64130":"Kansas City Public Schools", "64131":"Center 58", "64132":"Kansas City Public Schools", "64133":"Raytown C-2", "64134":"Hickman Mills C-1", "64137":"Hickman Mills C-1", "64138":"Raytown C-2", "64145":"Center 58", "64146":"Hickman Mills C-1", "64147":"Hickman Mills C-1", "64149":"Hickman Mills C-1", "64151":"Park Hill School District", "64152":"Park Hill School District", "64153":"Park Hill School District", "64154":"Park Hill School District", "64155":"North Kansas City Schools", "64156":"North Kansas City Schools", "64157":"North Kansas City Schools", "64158":"North Kansas City Schools", "64161":"North Kansas City Schools", "64163":"Park Hill School District", "64164":"Park Hill School District", "64165":"North Kansas City Schools", "64166":"Park Hill School District", "64167":"North Kansas City Schools", "64168":"North Kansas City Schools"};
function zipToDistrict(zip) {
  const z = String(zip || '').trim().slice(0, 5);
  return ZIP_DISTRICT[z] || null;
}
// School district -> county fallback, for signups with no zip (organizers
// registering call-backs know the district — it's required on launch forms —
// but often not the zip). Substring match, lowercase.
const DISTRICT_COUNTY_HINTS = [
  [['kcps', 'kansas city public', 'kansas city 33', 'center', 'hickman mills', 'blue springs', 'independence', "lee's summit", 'lees summit', 'raytown', 'grandview', 'grain valley', 'oak grove', 'fort osage', 'raymore'], 'Jackson County, MO'],
  [['nkc', 'north kansas city', 'liberty', 'smithville', 'kearney', 'excelsior'], 'Clay County, MO'],
  [['park hill', 'platte city'], 'Platte County, MO'],
  [['francis howell', 'wentzville', 'zumwalt', 'orchard farm', 'st. charles'], 'St. Charles County, MO'],
  [['slps', 'st. louis public', 'riverview gardens', 'jennings', 'normandy', 'ferguson', 'florissant', 'hazelwood', 'pattonville', 'ritenour', 'university city', 'rockwood', 'parkway', 'kirkwood', 'webster groves', 'ladue', 'clayton', 'lindbergh', 'mehlville', 'bayless', 'hancock place', 'maplewood', 'brentwood', 'affton', 'valley park'], 'St. Louis County, MO'],
  [['st. joseph', 'st joseph', 'mid-buchanan'], 'Buchanan County, MO'],
  [['columbia'], 'Boone County, MO'],
];
function districtToCounty(district) {
  const d = String(district || '').toLowerCase().trim();
  if (!d) return null;
  for (const [hints, county] of DISTRICT_COUNTY_HINTS) if (hints.some(h => d.includes(h))) return county;
  return null;
}
function deriveOrganizerId({ county, city, zip, district }) {
  // 1. Use supplied county if present
  let c = (county || '').toLowerCase();
  // 2. If no county, try to derive from zip
  if (!c) {
    const derived = zipToCounty(zip);
    if (derived) c = derived.toLowerCase();
  }
  if (!c) {
    const dc = districtToCounty(district);
    if (dc) c = dc.toLowerCase();
  }
  if (c && LANEE_COUNTIES.some(x => c.includes(x))) return LANEE_ID;
  const ci = (city || '').toLowerCase();
  if (ci && LANEE_KC_CITIES.some(x => ci.includes(x))) return LANEE_ID;
  // Final fallback: zip prefix
  const z = String(zip || '').trim();
  if (/^64[01]\d{2}$/.test(z) || /^66[012]\d{2}$/.test(z)) return LANEE_ID;
  return STEPHANIE_ID;
}

// Canonical organizer mapping — keys are LOWERCASE to match what pages send.
// Always look up via organizerId(name) to normalize case.
const ORGANIZER_IDS_LC = {
  'lanee':     LANEE_ID,
  'laneé':     LANEE_ID,
  'stephanie': STEPHANIE_ID,
  'kathryn':   'recMGgwIl623aOVX2',   // Kathryn Evans — walk-ins + signups from her dashboard attribute to her
  'elleng':    ELLENG_ID,             // Ellen Glover — commitment follow-up in Clay/Platte/Buchanan/Clinton
};
function organizerId(name) {
  if (!name) return null;
  return ORGANIZER_IDS_LC[String(name).toLowerCase().trim()] || null;
}
// Backward-compat alias for any code still using ORGANIZER_IDS[name]
const ORGANIZER_IDS = new Proxy({}, { get: (_, k) => organizerId(k) });

// Auto-send the branded Zoom confirmation the moment a signup is saved from
// the call sheet (team asked for this — removes a manual step mid-call).
// Undo deletes the log but cannot unsend the email.
const AUTO_CONFIRM_EMAIL = true;
const ZOOM_LINK_5_26 = 'https://us02web.zoom.us/j/6284644152?pwd=kweXnAjyLKIcGqxY3uxQSKeMKYfqMv.1';
const EVENT_NAME = 'Emergency Meeting on Public School Funding in Missouri';
const EVENT_DATE_LABEL = 'Tuesday, May 26 · 7:30 PM CST';
const FROM_CONFIRM = 'Parents for Missouri Public Schools <groundwork@civicpowerlab.us>';
// Signup-pipeline canary: a synthetic user the cron signs up ~36h before each event,
// to prove the confirmation email + Airtable record land. Change these to a dedicated
// monitor inbox / the people who should get failure alerts.
const CANARY_MONITOR_EMAIL = 'elizabethmck+gwcanary@gmail.com';   // lands in Liz's gmail; +alias never collides with a real record
const CANARY_ALERT_TO = ['emckenna@hks.harvard.edu'];
// The fixed key every deployed turnout-tracker Sheet (.gs) sends on /export/*.
// If the worker's EXPORT_KEY secret ever drifts from this, every tracker Sheet
// refresh silently 403s and shows stale counts (the 2026-07-08 incident). The
// daily export canary asserts they still match and emails CANARY_ALERT_TO if not.
const SHEET_EXPORT_KEY = 'p4mps-rKItacZ0arZKMy12UZuRBYwJVP_LJ4iU';
const REPLY_TO_CONFIRM = 'lanee4kckids@gmail.com';
// Per-organizer profile used by sendConfirmationEmail.
// Key is the lowercase organizer slug the dashboard sends (e.g. 'lanee', 'stephanie').
// If missing → falls back to LaNeé.
const ORGANIZER_PROFILE = {
  'lanee':     { name: 'LaNeé Bridewell',    group: 'Parents for Missouri Public Schools', reply_to: 'lanee4kckids@gmail.com' },
  'laneé':     { name: 'LaNeé Bridewell',    group: 'Parents for Missouri Public Schools', reply_to: 'lanee4kckids@gmail.com' },
  'stephanie': { name: 'Stephanie Rittgers', group: 'Parents for Missouri Public Schools', reply_to: 'srttgrs+civicwork@gmail.com' },
  'kathryn':   { name: 'Kathryn',            group: 'Parents for Missouri Public Schools', reply_to: 'kathryn@rootedstrategy.com' },
};
// Legacy lookup, kept for any code still reading reply-to only.
const ORGANIZER_REPLY_TO = Object.fromEntries(Object.entries(ORGANIZER_PROFILE).map(([k,v]) => [k, v.reply_to]));

const ALLOWLIST = [
  'laneebridewell@gmail.com',
  'srttgrs@yahoo.com',
  'elizabethmck@gmail.com',
  'emckenna@hks.harvard.edu',
  'ellenginkc@gmail.com',
  'ellenschwartze@gmail.com',
  'mcflemi@gmail.com',
  'tianyi@statepowerfund.org',
  'joymcushman@gmail.com',
  'kathryn@rootedstrategy.com',
];

const LOGIN_URL = 'https://lizmckenna.github.io/groundwork/pilot/lanee/';
const LOGO_URL = 'https://lizmckenna.github.io/groundwork/groundwork-logo-256.png';
const FROM_AUTH = 'Groundwork <groundwork@civicpowerlab.us>';
const CODE_TTL = 600;
const SESSION_TTL = 604800;

// --- KV read-cache ---
const READ_CACHE_TTL = 60; // seconds
const READ_CACHE_KEYS = [
  'cache:confirmees',
  'cache:confirmees:lanee',
  'cache:confirmees:stephanie',
  'cache:today-stats',
  'cache:recent-activity:7',
  'cache:recent-activity:14',
  'cache:recent-activity:30',
  'cache:recent-activity:14:lanee',
  'cache:recent-activity:14:stephanie',
  'cache:recent-activity:14:kathryn',
  'cache:recent-activity:7:lanee',
  'cache:recent-activity:7:stephanie',
  'cache:recent-activity:7:kathryn',
  'cache:today-stats:lanee',
  'cache:today-stats:stephanie',
  'cache:today-stats:kathryn',
  'cache:org-contacts:lanee',
  'cache:org-contacts:stephanie',
  'cache:org-contacts:kathryn',
  'cache:house-hosts',
  'queue:count',
  'queue:count:lanee',
  'queue:count:stephanie',
  'queue:count:kathryn',
  // Per-event confirmee + stats caches (60s TTL self-heals, but flush on writes too)
  ...['5_26','6_9','6_23','7_7'].flatMap(ev => [
    `cache:confirmees:${ev}:all`,
    `cache:confirmees:${ev}:lanee`,
    `cache:confirmees:${ev}:stephanie`,
    `cache:confirmees:${ev}:kathryn`,
    `cache:event-stats:${ev}`,
  ]),
];
async function cacheGet(env, key) {
  try {
    const v = await env.KV_BINDING.get(key);
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}
async function cachePut(env, key, payload, ttl = READ_CACHE_TTL) {
  try {
    await env.KV_BINDING.put(key, JSON.stringify(payload), { expirationTtl: ttl });
  } catch {}
}
async function invalidateReadCaches(env) {
  // Re-enabled now that account is on Workers Paid (1M deletes/month).
  // Each delete wrapped individually so a one-off failure doesn't crash
  // the request that triggered it.
  await Promise.all(READ_CACHE_KEYS.map(k =>
    env.KV_BINDING.delete(k).catch(() => null)
  ));
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });
    const url = new URL(request.url);
    try {
      if (url.pathname === '/auth/start' && request.method === 'POST') return await authStart(request, env);
      if (url.pathname === '/auth/verify' && request.method === 'POST') return await authVerify(request, env);
      if (url.pathname === '/signup' && request.method === 'POST') return await signup(request, env);
      if (url.pathname === '/house-meeting-signup' && request.method === 'POST') return await houseMeetingSignup(request, env);
      if (url.pathname === '/amplifier-log' && request.method === 'POST') return await amplifierLog(request, env);
      if (url.pathname === '/amplifier-progress' && request.method === 'GET') return await amplifierProgress(request, env, url);
      if (url.pathname === '/amplifier-voters' && request.method === 'GET') return await amplifierVoters(request, env, url);
      if (url.pathname === '/amplifier-voter-update' && request.method === 'POST') return await amplifierVoterUpdate(request, env);
      if (url.pathname === '/amendment5-signup' && request.method === 'POST') return await amendment5Signup(request, env);
      if (url.pathname === '/training-signup' && request.method === 'POST') return await trainingSignup(request, env);
      if (url.pathname === '/search-contact-public' && request.method === 'GET') return await searchContactPublic(request, env, url);
      if (url.pathname === '/list-fellows-public' && request.method === 'GET') return await listFellowsPublic(env);
      if (url.pathname === '/log-1on1' && request.method === 'POST') return await log1on1(request, env);
      if (url.pathname === '/get-my-share-link' && request.method === 'POST') return await getMyShareLink(request, env);
      if (url.pathname === '/launch-rsvp' && request.method === 'POST') return await launchRsvp(request, env);
      if (url.pathname === '/ingest/s2w' && request.method === 'POST') return await ingestS2W(request, env);
      if (url.pathname === '/event-checkin' && request.method === 'POST') return await eventCheckin(request, env);
      if (url.pathname === '/event-roster-public' && request.method === 'GET') return await eventRosterPublic(env, url);
      if (url.pathname === '/remind-signup' && request.method === 'POST') return await remindSignup(request, env);
      if (url.pathname === '/house-meeting-hosts' && request.method === 'GET') return await houseMeetingHosts(env);
      if (url.pathname === '/event-detail' && request.method === 'GET') return await eventDetail(env, url);
      if (url.pathname === '/event-rsvp' && request.method === 'POST') return await eventRsvp(request, env);
      // Live CSV feed for Google Sheets IMPORTDATA — token in the URL (no session,
      // since IMPORTDATA can't send headers). The canonical deduped RSVP list, so
      // a shared turnout-tracking Sheet always shows the same count as the dashboard.
      if (url.pathname === '/export/rsvps.csv' && request.method === 'GET') return await rsvpExportCsv(env, url);
      // Full deduped mailable contact list for the newsletter, ranked warmest-first
      // with a warm-up batch column. Feeds a read-only Google Sheet for comms.
      if (url.pathname === '/export/contacts.csv' && request.method === 'GET') return await contactsExportCsv(env, url);
      // Who has attended/checked in (by email) — lets the turnout Sheet fill its
      // Attendance column live from check-ins without shifting any columns.
      if (url.pathname === '/export/attendance.csv' && request.method === 'GET') return await attendanceExportCsv(env, url);
      // Commitments made by attendees of a given event (Amplifier / Canvass / Regional team, etc.),
      // for the turnout Sheet's "commitments made that night" block. Intersects method='Commitment'
      // rows with the event's attendee set; optional since=YYYY-MM-DD limits to that night's cards.
      if (url.pathname === '/export/event-commitments.csv' && request.method === 'GET') return await eventCommitmentsCsv(env, url);
      // Live feed of house-meeting attendees + their commitments for the HM
      // follow-up Sheet (host follow-up). Append-ordered so manual columns stay aligned.
      if (url.pathname === '/export/house-meetings.csv' && request.method === 'GET') return await houseMeetingsExportCsv(env, url);
      // Per-amplifier activity rollup (who's calling, how many, unique voters) — read-only leaderboard feed.
      if (url.pathname === '/export/amplifiers.csv' && request.method === 'GET') return await amplifiersExportCsv(env, url);
      // Voters who committed during an amplifier conversation — follow-up feed (HM-shaped, reuses HM sheet + write-back).
      if (url.pathname === '/export/amplifier-commits.csv' && request.method === 'GET') return await amplifierCommitsExportCsv(env, url);
      // Master rollup of every headline metric for Molly + Ellen's dashboard.
      if (url.pathname === '/export/rollup.csv' && request.method === 'GET') return await rollupExportCsv(env, url);
      if (url.pathname === '/admin/sync-attendance' && request.method === 'GET') {
        if (url.searchParams.get('key') !== env.EXPORT_KEY) return json({ error: 'forbidden' }, 403);
        return json(await syncAttendanceMirror(env));
      }
      // Targeted single-contact patch — find by name, patch a small allowlisted set
      // of fields, optionally clear assigned_organizer. Belt-and-suspenders for one-off
      // organizer-cleanup asks like "move Jordan Williams into Platte, off LaNeé's queue."
      // Dry-run by default; add &apply=1 to write.
      if (url.pathname === '/admin/patch-contact-by-name' && request.method === 'GET') {
        if (url.searchParams.get('key') !== env.EXPORT_KEY) return json({ error: 'forbidden' }, 403);
        const nameQ = (url.searchParams.get('name') || '').trim();
        if (!nameQ) return json({ error: 'name required' }, 400);
        const county = url.searchParams.get('county');
        const clearOrganizer = url.searchParams.get('clear_organizer') === '1';
        const dryRun = url.searchParams.get('apply') !== '1';
        const esc = nameQ.replace(/'/g, "\\'");
        const q = `?filterByFormula=${encodeURIComponent(`LOWER({Name})='${esc.toLowerCase()}'`)}&maxRecords=5&fields%5B%5D=Name&fields%5B%5D=county&fields%5B%5D=city&fields%5B%5D=zip&fields%5B%5D=district&fields%5B%5D=assigned_organizer`;
        const r = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
        if (!r.records.length) return json({ error: 'not found', name: nameQ }, 404);
        const results = [];
        for (const rec of r.records) {
          const fields = {};
          if (county) fields.county = county;
          if (clearOrganizer) fields.assigned_organizer = [];
          const linked = Array.isArray(rec.fields.assigned_organizer) ? rec.fields.assigned_organizer : [];
          const oldOrgIds = linked.map(x => typeof x === 'string' ? x : (x && x.id)).filter(Boolean);
          const before = {
            county: rec.fields.county || '',
            assigned_organizer: oldOrgIds.map(id => ORGANIZER_NAME_BY_ID[id] || id),
          };
          if (!dryRun && Object.keys(fields).length) {
            await at(env, `/${BASE}/${CONTACTS_TBL}/${rec.id}`, { method: 'PATCH', body: JSON.stringify({ fields, typecast: true }) });
          }
          results.push({ id: rec.id, name: rec.fields.Name, before, patch: fields });
        }
        if (!dryRun) await invalidateReadCaches(env);
        return json({ dry_run: dryRun, updated: results.length, results });
      }
      // Reroute confirmees for a given event: for anyone signed up whose assigned_organizer
      // is NOT LaNeé or Stephanie (parent-leader / unassigned), derive the correct organizer
      // from geo and reassign. Dry-run by default; add &apply=1 to actually write.
      if (url.pathname === '/admin/reroute-confirmees' && request.method === 'GET') {
        if (url.searchParams.get('key') !== env.EXPORT_KEY) return json({ error: 'forbidden' }, 403);
        const ev = url.searchParams.get('event') || '7_7';
        const apply = url.searchParams.get('apply') === '1';
        const meta = eventMeta(ev);
        const signupClause = meta.signupField
          ? `{${meta.signupField}}='Signed up'`
          : `{last_attempt_result}='Signed up'`;
        const rows = [];
        let off = null;
        do {
          let q = `?filterByFormula=${encodeURIComponent(signupClause)}&pageSize=100&fields%5B%5D=Name&fields%5B%5D=assigned_organizer&fields%5B%5D=city&fields%5B%5D=county&fields%5B%5D=zip&fields%5B%5D=district`;
          if (off) q += `&offset=${encodeURIComponent(off)}`;
          const p = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
          rows.push(...p.records);
          off = p.offset;
        } while (off);
        const targets = [];
        for (const r of rows) {
          const raw = r.fields.assigned_organizer;
          const linked = Array.isArray(raw) ? raw : (raw ? [raw] : []);
          const orgIds = linked.map(x => typeof x === 'string' ? x : (x && x.id)).filter(Boolean);
          const isLanee = orgIds.includes(LANEE_ID);
          const isSteph = orgIds.includes(STEPHANIE_ID);
          if (isLanee || isSteph) continue;
          const derived = deriveOrganizerId({
            county: r.fields.county, city: r.fields.city, zip: r.fields.zip, district: r.fields.district,
          }) || STEPHANIE_ID;
          targets.push({
            id: r.id, name: r.fields.Name || '(no name)',
            from: orgIds.map(id => ORGANIZER_NAME_BY_ID[id] || id).join(', ') || '(unassigned)',
            to: ORGANIZER_NAME_BY_ID[derived] || derived,
            to_id: derived,
            city: r.fields.city || '', county: r.fields.county || '', zip: r.fields.zip || '',
          });
        }
        if (apply && targets.length) {
          for (let i = 0; i < targets.length; i += 10) {
            const batch = targets.slice(i, i + 10).map(t => ({
              id: t.id,
              fields: { assigned_organizer: [t.to_id] },
            }));
            await at(env, `/${BASE}/${CONTACTS_TBL}`, { method: 'PATCH', body: JSON.stringify({ records: batch, typecast: true }) });
          }
          await invalidateReadCaches(env);
        }
        return json({ event: ev, dry_run: !apply, count: targets.length, targets });
      }
      // Confirm-queue split by organizer for a given event. Reports counts + any
      // overlap between LaNeé and Stephanie (should always be zero — routing is
      // exclusive by the assigned_organizer field).
      if (url.pathname === '/admin/event-split' && request.method === 'GET') {
        if (url.searchParams.get('key') !== env.EXPORT_KEY) return json({ error: 'forbidden' }, 403);
        const ev = url.searchParams.get('event') || '7_7';
        const meta = eventMeta(ev);
        const signupClause = meta.signupField
          ? `{${meta.signupField}}='Signed up'`
          : `{last_attempt_result}='Signed up'`;
        const rows = [];
        let off = null;
        do {
          let q = `?filterByFormula=${encodeURIComponent(signupClause)}&pageSize=100&fields%5B%5D=Name&fields%5B%5D=assigned_organizer`;
          if (off) q += `&offset=${encodeURIComponent(off)}`;
          const p = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
          rows.push(...p.records);
          off = p.offset;
        } while (off);
        // assigned_organizer may be a linked-record array OR a string (lookup field).
        const counts = { lanee: [], stephanie: [], other: [], unassigned: [] };
        for (const r of rows) {
          const raw = r.fields.assigned_organizer;
          const linked = Array.isArray(raw) ? raw : (raw ? [raw] : []);
          const orgIds = linked.map(x => typeof x === 'string' ? x : (x && x.id)).filter(Boolean);
          const orgNames = orgIds.map(id => ORGANIZER_NAME_BY_ID[id] || id);
          const name = r.fields.Name || '(no name)';
          const isLanee = orgIds.includes(LANEE_ID) || orgNames.some(n => String(n).toLowerCase().includes('lane'));
          const isSteph = orgIds.includes(STEPHANIE_ID) || orgNames.some(n => String(n).toLowerCase().includes('rittgers') || String(n).toLowerCase().includes('stephanie'));
          if (!orgIds.length) counts.unassigned.push(name);
          else if (isLanee) counts.lanee.push(name);
          else if (isSteph) counts.stephanie.push(name);
          else counts.other.push(`${name} → ${orgNames.join(', ')}`);
        }
        const laneeSet = new Set(counts.lanee);
        const overlap = counts.stephanie.filter(n => laneeSet.has(n));
        return json({
          event: ev, total: rows.length,
          lanee: counts.lanee.length,
          stephanie: counts.stephanie.length,
          other_count: counts.other.length,
          unassigned_count: counts.unassigned.length,
          overlap: overlap.length,
          overlap_names: overlap,
          other: counts.other,
          unassigned: counts.unassigned,
        });
      }
      if (url.pathname === '/export/scoreboard.csv' && request.method === 'GET') return await scoreboardExportCsv(env, url);
      if (url.pathname === '/export/recruit-chains.csv' && request.method === 'GET') return await recruitChainsExportCsv(env, url);
      if (url.pathname === '/board/data.json' && request.method === 'GET') return await boardData(env, url);
      if (url.pathname === '/board/map.json' && request.method === 'GET') return await boardMapData(env, url);
      if (url.pathname === '/board/save' && request.method === 'POST') return await boardSave(request, env, url);
      if (url.pathname.startsWith('/board/') && request.method === 'GET') return boardPage(env, url);
      if (url.pathname === '/export/region.csv' && request.method === 'GET') return await regionExportCsv(env, url);
      if (url.pathname === '/export/all.csv' && request.method === 'GET') return await allContactsExportCsv(env, url);
      if (url.pathname === '/sheet-region-update' && request.method === 'POST') return await sheetRegionUpdate(request, env);
      if (url.pathname === '/sheet-add-contact' && request.method === 'POST') return await sheetAddContact(request, env);
      if (url.pathname === '/sheet-add-organizer' && request.method === 'POST') return await sheetAddOrganizer(request, env);
      if (url.pathname === '/export/organizers.csv' && request.method === 'GET') return await organizersExportCsv(env, url);
      if (url.pathname === '/export/signups.csv' && request.method === 'GET') return await signupsExportCsv(env, url);
      // Per-event training roster for a volunteer's Google Sheet (live IMPORTDATA feed).
      // Auth: master EXPORT_KEY, OR a per-event scoped token (t=) so an organizer can
      // hold the feed link without the master key — leaking t exposes only this roster.
      if (url.pathname === '/export/training-roster.csv' && request.method === 'GET') return await trainingRosterCsv(env, url);
      // Sheet → Airtable write-back for HM follow-up columns (status, 1-1, notes), by contact id.
      if (url.pathname === '/sheet-hm-followup' && request.method === 'POST') return await sheetHmFollowup(request, env);
      // Sheet → Airtable attendance write-back for launches (gated by EXPORT_KEY,
      // same key the turnout Sheets already carry). Leads mark Attended/No-show in
      // the Sheet; this upserts the 'Event attendance' rows the dashboard counts.
      if (url.pathname === '/sheet-attendance' && request.method === 'POST') return await sheetAttendance(request, env);
      // Import paper commitment cards: {date, people:[{email, commitments:[bucketKey]}]}.
      // Finds each contact by email, creates the missing method='Commitment' log rows
      // (idempotent — skips buckets the contact already has). Key-gated.
      if (url.pathname === '/import-commitments' && request.method === 'POST') return await importCommitments(request, env);
      // One-time cleanup: an earlier import run created duplicate paper-commitment
      // rows (the idempotency check was broken). This finds Commitment rows whose
      // notes say "Paper commitment card" dated 2026-07-09, groups by contact+bucket,
      // and deletes the extras so each contact+bucket keeps exactly one row. Never
      // touches a non-paper row. Dry-run by default; add &confirm=1 to delete. Key-gated.
      if (url.pathname === '/cleanup-commitment-dupes' && request.method === 'GET') return await cleanupCommitmentDupes(env, url);
      // One-shot fix: rename the organizer record at rec0OmDN68hlffkTn back to
      // "LaNeé Bridewell". Someone typed "Laci Horn" over it in Airtable, which
      // silently attributed 1,119 of LaNee's contacts to Laci on the scoreboard.
      if (url.pathname === '/admin/rename-lanee-back' && request.method === 'GET') {
        if (url.searchParams.get('key') !== env.EXPORT_KEY) return json({ error: 'forbidden' }, 403);
        const before = await at(env, `/${BASE}/${ORGANIZERS_TBL}/rec0OmDN68hlffkTn`);
        const oldName = before.fields.name || '';
        if (oldName === 'LaNeé Bridewell') return json({ status: 'no_op', already: oldName });
        await at(env, `/${BASE}/${ORGANIZERS_TBL}/rec0OmDN68hlffkTn`, {
          method: 'PATCH',
          body: JSON.stringify({ fields: { name: 'LaNeé Bridewell' }, typecast: true }),
        });
        // Nuke the cached name map + scoreboard so the fix shows up immediately.
        try { await env.KV_BINDING.delete('cache:orgnamebyid:v1'); } catch (e) {}
        try { await env.KV_BINDING.delete('cache:scoreboard:v3'); } catch (e) {}
        try { await env.KV_BINDING.delete('cache:scoreboard:v2'); } catch (e) {}
        return json({ status: 'renamed', from: oldName, to: 'LaNeé Bridewell' });
      }
      // Show event_attendance mirror rows + contacts data for a given contact_id
      if (url.pathname === '/admin/contact-full-dump' && request.method === 'GET') {
        if (url.searchParams.get('key') !== env.EXPORT_KEY) return json({ error: 'forbidden' }, 403);
        const cid = url.searchParams.get('contact_id');
        if (!cid) return json({ error: 'contact_id required' }, 400);
        // Contact fields
        const c = await at(env, `/${BASE}/${CONTACTS_TBL}/${cid}`);
        // Event attendance mirror
        const mirrorRows = [];
        let off = null;
        do {
          let q = `?filterByFormula=${encodeURIComponent(`FIND('${cid}',ARRAYJOIN({contact}))>0`)}&pageSize=100&fields%5B%5D=event&fields%5B%5D=attended&fields%5B%5D=reminder_status`;
          if (off) q += `&offset=${encodeURIComponent(off)}`;
          const p = await at(env, `/${BASE}/${ATTENDANCE_MIRROR_TBL}${q}`);
          mirrorRows.push(...p.records);
          off = p.offset;
        } while (off);
        return json({
          contact_id: cid,
          contact_fields: c.fields,
          event_attendance_mirror: mirrorRows.map(r => ({
            id: r.id,
            event: r.fields.event, attended: r.fields.attended, reminder_status: r.fields.reminder_status,
          })),
        });
      }
      // Show all contact_log rows for a given contact_id
      if (url.pathname === '/admin/contact-log-dump' && request.method === 'GET') {
        if (url.searchParams.get('key') !== env.EXPORT_KEY) return json({ error: 'forbidden' }, 403);
        const cid = url.searchParams.get('contact_id');
        if (!cid) return json({ error: 'contact_id required' }, 400);
        const rows = [];
        let off = null;
        do {
          let q = `?filterByFormula=${encodeURIComponent(`FIND('${cid}',ARRAYJOIN({contact}))>0`)}&pageSize=100&fields%5B%5D=Summary&fields%5B%5D=date&fields%5B%5D=method&fields%5B%5D=result&fields%5B%5D=event&fields%5B%5D=rsvp_launch&fields%5B%5D=notes`;
          if (off) q += `&offset=${encodeURIComponent(off)}`;
          const p = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
          rows.push(...p.records);
          off = p.offset;
        } while (off);
        return json({
          contact_id: cid, total: rows.length,
          logs: rows.map(r => ({
            id: r.id, date: r.fields.date, method: r.fields.method,
            result: r.fields.result, event: r.fields.event,
            rsvp_launch: r.fields.rsvp_launch,
            summary: r.fields.Summary, notes: (r.fields.notes || '').slice(0, 200),
          })).sort((a, b) => String(b.date).localeCompare(String(a.date))),
        });
      }
      // Diagnostic: raw distribution of assigned_organizer IDs across all contacts.
      // Reveals ghost records or duplicates that cause organizers to vanish from
      // the scoreboard (e.g., a second Laci or LaNee record with empty name).
      if (url.pathname === '/admin/organizer-id-distribution' && request.method === 'GET') {
        if (url.searchParams.get('key') !== env.EXPORT_KEY) return json({ error: 'forbidden' }, 403);
        const rows = [];
        let off = null;
        do {
          let q = `?pageSize=100&fields%5B%5D=assigned_organizer`;
          if (off) q += `&offset=${encodeURIComponent(off)}`;
          const p = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
          rows.push(...p.records);
          off = p.offset;
        } while (off);
        const byId = {};
        for (const r of rows) {
          const raw = r.fields.assigned_organizer;
          const linked = Array.isArray(raw) ? raw : (raw ? [raw] : []);
          const ids = linked.map(x => typeof x === 'string' ? x : (x && x.id)).filter(Boolean);
          if (!ids.length) byId['(none)'] = (byId['(none)'] || 0) + 1;
          for (const id of ids) byId[id] = (byId[id] || 0) + 1;
        }
        const orgMap = await orgNameById(env);
        const HARD = { 'rec0OmDN68hlffkTn': 'LaNeé Bridewell (hardcoded)', 'recnnEdYIPcclnPLY': 'Stephanie (hardcoded)' };
        const out = Object.entries(byId).sort((a, b) => b[1] - a[1]).map(([id, count]) => ({
          id, count,
          name_from_airtable: orgMap[id] || null,
          name_from_code_const: HARD[id] || null,
        }));
        return json({ total_contacts: rows.length, by_organizer_id: out });
      }
      // Deeper diagnostic: for contacts assigned to <org>, show who actually WORKED
      // them (via last_attempt_by) so we can see if the "leads worked" credit belongs
      // to that organizer or someone else.
      if (url.pathname === '/admin/who-worked-them' && request.method === 'GET') {
        if (url.searchParams.get('key') !== env.EXPORT_KEY) return json({ error: 'forbidden' }, 403);
        const fname = (url.searchParams.get('org') || '').toLowerCase().trim();
        const orgMap = await orgNameById(env);
        let fid = Object.entries(orgMap).find(([, n]) => String(n).toLowerCase() === fname)?.[0];
        if (!fid) return json({ error: 'unknown org', tried: fname });
        const fullName = orgMap[fid];
        const rows = [];
        let off = null;
        do {
          const fesc = fullName.replace(/'/g, "\\'");
          let q = `?filterByFormula=${encodeURIComponent(`AND(FIND('${fesc}',{assigned_organizer}&'')>0,OR({attempt_count}>0,{last_attempt_result}))`)}&pageSize=100&fields%5B%5D=Name&fields%5B%5D=source&fields%5B%5D=last_attempt_by&fields%5B%5D=last_attempt_result&fields%5B%5D=last_attempt_date&fields%5B%5D=attempt_count`;
          if (off) q += `&offset=${encodeURIComponent(off)}`;
          const p = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
          rows.push(...p.records);
          off = p.offset;
        } while (off);
        const byWorker = {}, byResult = {}, bySource = {};
        for (const r of rows) {
          const w = String(r.fields.last_attempt_by || '(no attempt_by)').trim() || '(no attempt_by)';
          const res = String(r.fields.last_attempt_result || '(no result)').trim() || '(no result)';
          const src = String(r.fields.source || '(empty)').trim() || '(empty)';
          byWorker[w] = (byWorker[w] || 0) + 1;
          byResult[res] = (byResult[res] || 0) + 1;
          bySource[src] = (bySource[src] || 0) + 1;
        }
        return json({
          org: fullName, worked_total: rows.length,
          by_last_attempt_by: Object.entries(byWorker).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ actor: k, count: v })),
          by_last_attempt_result: Object.entries(byResult).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ result: k, count: v })),
          by_source: Object.entries(bySource).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => ({ source: k, count: v })),
        });
      }
      // Diagnostic: sample contacts assigned to a given organizer, show their source
      // + assignment pattern so we can figure out how they landed there.
      if (url.pathname === '/admin/who-owns-what' && request.method === 'GET') {
        if (url.searchParams.get('key') !== env.EXPORT_KEY) return json({ error: 'forbidden' }, 403);
        const fname = (url.searchParams.get('org') || '').toLowerCase().trim();
        // Look up live from the organizers table (not the hardcoded const, which
        // may be missing recently-added organizers like Laci Horn).
        const orgMap = await orgNameById(env);
        let fid = Object.entries(orgMap).find(([, n]) => String(n).toLowerCase() === fname)?.[0];
        if (!fid) return json({ error: 'unknown org', tried: fname, known: Object.values(orgMap) });
        const fullName = orgMap[fid];
        const rows = [];
        let off = null;
        do {
          const fesc = fullName.replace(/'/g, "\\'");
          let q = `?filterByFormula=${encodeURIComponent(`FIND('${fesc}',{assigned_organizer}&'')>0`)}&pageSize=100&fields%5B%5D=Name&fields%5B%5D=source&fields%5B%5D=county&fields%5B%5D=Created`;
          if (off) q += `&offset=${encodeURIComponent(off)}`;
          const p = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
          rows.push(...p.records);
          off = p.offset;
        } while (off);
        const bySource = {}, byCounty = {}, byMonth = {};
        for (const r of rows) {
          const s = String(r.fields.source || '(empty)').trim() || '(empty)';
          bySource[s] = (bySource[s] || 0) + 1;
          const c = String(r.fields.county || '(unknown)').trim() || '(unknown)';
          byCounty[c] = (byCounty[c] || 0) + 1;
          const m = String(r.fields.Created || '').slice(0, 7);
          if (m) byMonth[m] = (byMonth[m] || 0) + 1;
        }
        return json({
          org: fullName, total: rows.length,
          top_sources: Object.entries(bySource).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([s, c]) => ({ source: s, count: c })),
          top_counties: Object.entries(byCounty).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([c, n]) => ({ county: c, count: n })),
          by_month: Object.entries(byMonth).sort().map(([m, n]) => ({ month: m, count: n })),
        });
      }
      // Clear the stale scoreboard cache and force fresh compute.
      if (url.pathname === '/admin/nuke-scoreboard-cache' && request.method === 'GET') {
        if (url.searchParams.get('key') !== env.EXPORT_KEY) return json({ error: 'forbidden' }, 403);
        try {
          await env.KV_BINDING.delete('cache:scoreboard:v3');
          await env.KV_BINDING.delete('cache:scoreboard:v2');
        } catch (e) {}
        return json({ status: 'cleared' });
      }
      // CSV of every remind-me-to-vote signup: who, where, source attribution.
      if (url.pathname === '/admin/remind-me-signups.csv' && request.method === 'GET') {
        if (url.searchParams.get('key') !== env.EXPORT_KEY) return json({ error: 'forbidden' }, 403);
        const filter = `FIND('remind me to vote',LOWER({source}&''))>0`;
        const fields = ['Name','first','last','email','phone','city','county','zip','district','school',
          'source','recruited_by','assigned_organizer','wants_amendment5_updates','wants_to_volunteer','Created'];
        const rows = [];
        let off = null;
        do {
          let qStr = `?filterByFormula=${encodeURIComponent(filter)}&pageSize=100`;
          for (const f of fields) qStr += `&fields%5B%5D=${encodeURIComponent(f)}`;
          if (off) qStr += `&offset=${encodeURIComponent(off)}`;
          const p = await at(env, `/${BASE}/${CONTACTS_TBL}${qStr}`);
          rows.push(...p.records);
          off = p.offset;
        } while (off);
        const qcsv = (v) => {
          const s = v == null ? '' : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const resolveOrg = (raw) => {
          const linked = Array.isArray(raw) ? raw : (raw ? [raw] : []);
          const ids = linked.map(x => typeof x === 'string' ? x : (x && x.id)).filter(Boolean);
          return ids.map(id => ORGANIZER_NAME_BY_ID[id] || id).join(', ');
        };
        const resolveRecruiter = (raw) => {
          if (!raw) return '';
          if (Array.isArray(raw)) return raw.map(x => typeof x === 'string' ? x : (x && (x.name || x.id))).join(', ');
          return String(raw);
        };
        const header = ['Name','First','Last','Email','Phone','City','County','Zip','District','School',
                        'Source','Recruited by','Assigned organizer','Wants A5 updates','Wants to volunteer','Created'];
        const csv = [header.map(qcsv).join(',')];
        rows.sort((a, b) => String(b.fields.Created || '').localeCompare(String(a.fields.Created || '')));
        for (const r of rows) {
          const f = r.fields;
          csv.push([
            f.Name || `${f.first || ''} ${f.last || ''}`.trim(),
            f.first || '', f.last || '', f.email || '', f.phone || '',
            f.city || '', f.county || '', f.zip || '', f.district || '', f.school || '',
            f.source || '', resolveRecruiter(f.recruited_by), resolveOrg(f.assigned_organizer),
            f.wants_amendment5_updates ? 'Yes' : '', f.wants_to_volunteer ? 'Yes' : '',
            f.Created || '',
          ].map(qcsv).join(','));
        }
        return new Response(csv.join('\n'), {
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': 'attachment; filename="remind-me-to-vote-signups.csv"',
          },
        });
      }
      // Probe: for a given fellow, list every contact_log row on contacts they
      // own, so we can eyeball which are 1:1s regardless of notes phrasing.
      if (url.pathname === '/admin/list-fellow-logs' && request.method === 'GET') {
        if (url.searchParams.get('key') !== env.EXPORT_KEY) return json({ error: 'forbidden' }, 403);
        const fname = (url.searchParams.get('fellow') || '').toLowerCase().trim();
        const fid = Object.entries(ORGANIZER_NAME_BY_ID).find(([, n]) => n.toLowerCase() === fname)?.[0];
        if (!fid) return json({ error: 'unknown fellow' }, 400);
        const fullName = ORGANIZER_NAME_BY_ID[fid];
        // Linked-record fields render as their primary-field display name in
        // formula ARRAYJOIN, not the record ID. So filter by name string.
        const contactIds = [];
        let off = null;
        do {
          const fesc = fullName.replace(/'/g, "\\'");
          let q = `?filterByFormula=${encodeURIComponent(`OR(FIND('${fesc}',{assigned_organizer}&'')>0,FIND('${fesc}',{organized_by}&'')>0,FIND('${fesc}',{relational_owner}&'')>0,FIND('${fesc}',{owns_relationship_with}&'')>0)`)}&pageSize=100&fields%5B%5D=Name`;
          if (off) q += `&offset=${encodeURIComponent(off)}`;
          const p = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
          for (const r of p.records) contactIds.push({ id: r.id, name: r.fields.Name || '' });
          off = p.offset;
        } while (off);
        // For each contact, fetch its contact_log rows
        const logs = [];
        for (const c of contactIds) {
          try {
            const q = `?filterByFormula=${encodeURIComponent(`FIND('${c.id}',ARRAYJOIN({contact}))>0`)}&pageSize=100&fields%5B%5D=date&fields%5B%5D=method&fields%5B%5D=result&fields%5B%5D=notes&fields%5B%5D=event&fields%5B%5D=Summary`;
            const p = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
            for (const r of p.records) logs.push({
              log_id: r.id, contact_id: c.id, contact_name: c.name,
              date: r.fields.date || '', method: r.fields.method || '',
              result: r.fields.result || '', event: r.fields.event || '',
              summary: r.fields.Summary || '',
              notes: (r.fields.notes || '').slice(0, 300),
            });
          } catch (e) {}
        }
        return json({
          fellow: fname, contacts_owned: contactIds.length,
          logs_total: logs.length,
          logs: logs.sort((a, b) => (b.date || '').localeCompare(a.date || '')),
        });
      }
      // One-time: rename the "who led it" field on the one_on_ones table.
      // Handles any legacy names (fellow_who_had_it, led_by) → person.
      if (url.pathname === '/admin/rename-1on1-field' && request.method === 'GET') {
        if (url.searchParams.get('key') !== env.EXPORT_KEY) return json({ error: 'forbidden' }, 403);
        const target = url.searchParams.get('to') || 'person';
        const meta = await at(env, `/meta/bases/${BASE}/tables`);
        const tbl = (meta.tables || []).find(t => t.id === ONE_ON_ONES_TBL);
        if (!tbl) return json({ error: 'one_on_ones table not found' }, 404);
        const field = tbl.fields.find(f => ['fellow_who_had_it', 'led_by', 'person'].includes(f.name));
        if (!field) return json({ status: 'no matching field' });
        if (field.name === target) return json({ status: 'already_named', field_id: field.id });
        await at(env, `/meta/bases/${BASE}/tables/${ONE_ON_ONES_TBL}/fields/${field.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: target }),
        });
        return json({ status: 'renamed', from: field.name, to: target, field_id: field.id });
      }
      // Rollback: delete any one_on_ones rows tagged as migrated from contact_log.
      if (url.pathname === '/admin/rollback-1on1-migration' && request.method === 'GET') {
        if (url.searchParams.get('key') !== env.EXPORT_KEY) return json({ error: 'forbidden' }, 403);
        const apply = url.searchParams.get('apply') === '1';
        const rows = [];
        let off = null;
        do {
          let q = `?filterByFormula=${encodeURIComponent(`FIND('migrated from contact_log',{source}&'')>0`)}&pageSize=100&fields%5B%5D=source&fields%5B%5D=date&fields%5B%5D=contact`;
          if (off) q += `&offset=${encodeURIComponent(off)}`;
          const p = await at(env, `/${BASE}/${ONE_ON_ONES_TBL}${q}`);
          rows.push(...p.records);
          off = p.offset;
        } while (off);
        if (apply && rows.length) {
          for (let i = 0; i < rows.length; i += 10) {
            const params = new URLSearchParams();
            for (const r of rows.slice(i, i + 10)) params.append('records[]', r.id);
            await at(env, `/${BASE}/${ONE_ON_ONES_TBL}?${params.toString()}`, { method: 'DELETE' });
          }
        }
        return json({ dry_run: !apply, count: rows.length, deleted: apply ? rows.length : 0 });
      }
      // One-time migration: port already-logged 1-on-1s from contact_log into the
      // new one_on_ones table. Matches either the "1:1 scheduled" notes convention
      // (per the old Airtable guide) OR contact_log rows with event='1:1 meeting'.
      // Optional &fellow=<name> restricts to contacts assigned to that fellow.
      // Idempotent — skips any (contact, date) pair already present in one_on_ones.
      if (url.pathname === '/admin/migrate-1on1s-from-log' && request.method === 'GET') {
        if (url.searchParams.get('key') !== env.EXPORT_KEY) return json({ error: 'forbidden' }, 403);
        const apply = url.searchParams.get('apply') === '1';
        const fellowFilter = (url.searchParams.get('fellow') || '').toLowerCase().trim();
        const fellowIdFilter = Object.entries(ORGANIZER_NAME_BY_ID)
          .find(([, n]) => n.toLowerCase() === fellowFilter)?.[0] || null;
        // Fetch matching log rows
        const filter = `OR(FIND('1:1 scheduled',{notes}&'')>0,FIND('1-on-1',{notes}&'')>0,FIND('1:1 meeting',{event}&'')>0,FIND('1:1 with',{Summary}&'')>0,FIND('1:1 conversation',{notes}&'')>0)`;
        const logs = [];
        let off = null;
        do {
          let q = `?filterByFormula=${encodeURIComponent(filter)}&pageSize=100&fields%5B%5D=Summary&fields%5B%5D=date&fields%5B%5D=method&fields%5B%5D=result&fields%5B%5D=notes&fields%5B%5D=event&fields%5B%5D=contact`;
          if (off) q += `&offset=${encodeURIComponent(off)}`;
          const p = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
          logs.push(...p.records);
          off = p.offset;
        } while (off);
        // Fetch existing one_on_ones so we can dedupe on (contact, date)
        const existing = new Set();
        off = null;
        do {
          let q = `?pageSize=100&fields%5B%5D=contact&fields%5B%5D=date`;
          if (off) q += `&offset=${encodeURIComponent(off)}`;
          const p = await at(env, `/${BASE}/${ONE_ON_ONES_TBL}${q}`);
          for (const r of p.records) {
            const cid = (r.fields.contact || [])[0];
            const d = r.fields.date || '';
            if (cid && d) existing.add(`${cid}|${d}`);
          }
          off = p.offset;
        } while (off);
        // For each log row, resolve fellow name (from last-attempt or assigned_organizer)
        // and try to pull commitment hints from notes.
        const contactCache = new Map();
        const getAssignedFellow = async (cid) => {
          if (contactCache.has(cid)) return contactCache.get(cid);
          try {
            const r = await at(env, `/${BASE}/${CONTACTS_TBL}/${cid}`);
            // Try every linked-organizer field the base uses.
            const collectIds = (raw) => {
              const linked = Array.isArray(raw) ? raw : (raw ? [raw] : []);
              return linked.map(x => typeof x === 'string' ? x : (x && x.id)).filter(Boolean);
            };
            const orgIds = [
              ...collectIds(r.fields.assigned_organizer),
              ...collectIds(r.fields.organized_by),
              ...collectIds(r.fields.relational_owner),
              ...collectIds(r.fields.owns_relationship_with),
            ];
            const orgName = orgIds.map(id => ORGANIZER_NAME_BY_ID[id] || null).filter(Boolean)[0]
              || String(r.fields.last_attempt_by || '').trim()
              || null;
            const info = { orgIds: [...new Set(orgIds)], orgName };
            contactCache.set(cid, info);
            return info;
          } catch (e) { contactCache.set(cid, { orgIds: [], orgName: null }); return { orgIds: [], orgName: null }; }
        };
        const detectCommitments = (notes) => {
          const s = String(notes || '').toLowerCase();
          const hits = [];
          if (/house meeting/.test(s)) hits.push('Host house meeting');
          if (/amplifi/.test(s)) hits.push('Amplifier training');
          if (/onboarding|attend.*(6\/|7\/)/.test(s)) hits.push('Attend next onboarding');
          if (/recruit|bring|refer/.test(s)) hits.push('Recruit others');
          if (/board|resolution|pta/.test(s)) hits.push('Talk to board or PTA');
          if (/donate|donation|actblue/.test(s)) hits.push('Donate');
          if (/volunteer|help/.test(s) && !hits.length) hits.push('Volunteer at event');
          return hits;
        };
        const targets = [];
        const filteredOut = { by_fellow: 0, already_migrated: 0, no_date: 0 };
        for (const r of logs) {
          const cid = (r.fields.contact || [])[0];
          if (!cid) continue;
          const d = r.fields.date || '';
          if (!d) { filteredOut.no_date++; continue; }
          const key = `${cid}|${d}`;
          if (existing.has(key)) { filteredOut.already_migrated++; continue; }
          const info = await getAssignedFellow(cid);
          if (fellowIdFilter && !info.orgIds.includes(fellowIdFilter)) {
            filteredOut.by_fellow++;
            continue;
          }
          const commitments = detectCommitments(r.fields.notes);
          targets.push({
            log_id: r.id,
            contact_id: cid,
            date: d,
            fellow_ids: info.orgIds,
            fellow_name: info.orgName,
            summary: r.fields.Summary || '',
            notes: r.fields.notes || '',
            detected_commitments: commitments,
          });
          existing.add(key);
        }
        if (apply && targets.length) {
          const batchSize = 10;
          for (let i = 0; i < targets.length; i += batchSize) {
            const batch = targets.slice(i, i + batchSize).map(t => ({
              fields: {
                Summary: `${t.date} — ${t.fellow_name || 'fellow'} × contact (imported)`,
                contact: [t.contact_id],
                person: t.fellow_ids.length ? [t.fellow_ids[0]] : undefined,
                date: t.date,
                notes: t.notes,
                commitments: t.detected_commitments,
                source: 'migrated from contact_log',
              },
            }));
            // Strip undefined values before send
            for (const rec of batch) {
              for (const k of Object.keys(rec.fields)) if (rec.fields[k] === undefined) delete rec.fields[k];
            }
            await at(env, `/${BASE}/${ONE_ON_ONES_TBL}`, { method: 'POST', body: JSON.stringify({ records: batch, typecast: true }) });
          }
        }
        return json({
          dry_run: !apply,
          fellow_filter: fellowFilter || '(no filter)',
          fellow_id_resolved: fellowIdFilter,
          logs_scanned: logs.length,
          candidates_found: targets.length,
          filtered_out: filteredOut,
          preview: targets.slice(0, 20),
        });
      }
      // One-time: create the one_on_ones Airtable table if it doesn't exist yet.
      // Idempotent — returns the existing table's id if it's already there.
      if (url.pathname === '/admin/create-1on1-table' && request.method === 'GET') {
        if (url.searchParams.get('key') !== env.EXPORT_KEY) return json({ error: 'forbidden' }, 403);
        const meta = await at(env, `/meta/bases/${BASE}/tables`);
        const existing = (meta.tables || []).find(t => t.name === 'one_on_ones');
        if (existing) return json({ status: 'already_exists', table_id: existing.id });
        const schema = {
          name: 'one_on_ones',
          fields: [
            { name: 'Summary', type: 'singleLineText' },
            { name: 'contact', type: 'multipleRecordLinks', options: { linkedTableId: CONTACTS_TBL } },
            { name: 'fellow_who_had_it', type: 'multipleRecordLinks', options: { linkedTableId: ORGANIZERS_TBL } },
            { name: 'date', type: 'date', options: { dateFormat: { name: 'local' } } },
            { name: 'self_interest', type: 'multilineText' },
            { name: 'commitments', type: 'multipleSelects', options: { choices: [
              { name: '1-on-1 back' }, { name: 'Attend next onboarding' }, { name: 'Host house meeting' },
              { name: 'Volunteer at event' }, { name: 'Amplifier training' }, { name: 'Donate' },
              { name: 'Talk to board or PTA' }, { name: 'Recruit others' }, { name: 'Other' },
            ] } },
            { name: 'notes', type: 'multilineText' },
            { name: 'next_step', type: 'singleLineText' },
            { name: 'next_step_by', type: 'date', options: { dateFormat: { name: 'local' } } },
            { name: 'relationship_stage', type: 'singleSelect', options: { choices: [
              { name: 'First meeting', color: 'blueLight2' },
              { name: 'Deepening', color: 'yellowLight2' },
              { name: 'Ready to lead', color: 'greenLight2' },
              { name: 'Struggling to reach', color: 'redLight2' },
            ] } },
            { name: 'source', type: 'singleLineText' },
          ],
        };
        const created = await at(env, `/meta/bases/${BASE}/tables`, { method: 'POST', body: JSON.stringify(schema) });
        return json({ status: 'created', table_id: created.id, table: created });
      }
      // Post-event summary: signups + attendance broken down by assigned organizer
      // (LaNeé vs Stephanie vs others). Reads current contact state — call any time
      // after mark-attendance-from-list has run.
      if (url.pathname === '/admin/event-attendance-by-organizer' && request.method === 'GET') {
        if (url.searchParams.get('key') !== env.EXPORT_KEY) return json({ error: 'forbidden' }, 403);
        const ev = url.searchParams.get('event') || '7_7';
        const meta = eventMeta(ev);
        if (!meta.signupField) return json({ error: `event ${ev} has no signup field` }, 400);
        const rows = [];
        let off = null;
        do {
          let q = `?filterByFormula=${encodeURIComponent(`{${meta.signupField}}='Signed up'`)}&pageSize=100&fields%5B%5D=Name&fields%5B%5D=assigned_organizer&fields%5B%5D=${encodeURIComponent(meta.attendField)}&fields%5B%5D=${encodeURIComponent(meta.confirmField)}`;
          if (off) q += `&offset=${encodeURIComponent(off)}`;
          const p = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
          rows.push(...p.records);
          off = p.offset;
        } while (off);
        const buckets = {};
        for (const r of rows) {
          const raw = r.fields.assigned_organizer;
          const linked = Array.isArray(raw) ? raw : (raw ? [raw] : []);
          const orgIds = linked.map(x => typeof x === 'string' ? x : (x && x.id)).filter(Boolean);
          let label = '(unassigned)';
          if (orgIds.includes(LANEE_ID)) label = 'LaNeé';
          else if (orgIds.includes(STEPHANIE_ID)) label = 'Stephanie';
          else if (orgIds.length) label = orgIds.map(id => ORGANIZER_NAME_BY_ID[id] || id).join(', ');
          buckets[label] = buckets[label] || { signed_up: 0, attended: 0, no_show: 0, other: 0,
            confirmed: 0, confirmed_attended: 0, reminder_sent: 0, reminder_sent_attended: 0,
            no_confirm_status: 0, no_confirm_attended: 0 };
          const b = buckets[label];
          b.signed_up++;
          const att = String(r.fields[meta.attendField] || '').toLowerCase().trim();
          const attended = (att === 'attended' || att === 'walk-in');
          if (attended) b.attended++;
          else if (att === 'no-show') b.no_show++;
          else b.other++;
          const cs = String(r.fields[meta.confirmField] || '').trim();
          if (cs === 'Confirmed') { b.confirmed++; if (attended) b.confirmed_attended++; }
          else if (cs === 'Reminder sent') { b.reminder_sent++; if (attended) b.reminder_sent_attended++; }
          else if (!cs) { b.no_confirm_status++; if (attended) b.no_confirm_attended++; }
        }
        const out = Object.entries(buckets).map(([organizer, b]) => ({
          organizer,
          signed_up: b.signed_up,
          attended: b.attended,
          no_show: b.no_show,
          uncoded: b.other,
          show_rate_pct: b.signed_up ? Math.round(b.attended / b.signed_up * 1000) / 10 : 0,
          confirmed_signed_up: b.confirmed,
          confirmed_attended: b.confirmed_attended,
          confirmed_show_rate_pct: b.confirmed ? Math.round(b.confirmed_attended / b.confirmed * 1000) / 10 : null,
          reminder_signed_up: b.reminder_sent,
          reminder_attended: b.reminder_sent_attended,
          reminder_show_rate_pct: b.reminder_sent ? Math.round(b.reminder_sent_attended / b.reminder_sent * 1000) / 10 : null,
          no_confirm_signed_up: b.no_confirm_status,
          no_confirm_attended: b.no_confirm_attended,
        })).sort((a, b) => b.signed_up - a.signed_up);
        return json({ event: ev, by_organizer: out, total_signed_up: rows.length,
          total_attended: out.reduce((s, x) => s + x.attended, 0) });
      }
      // Cleanup: for a given event, dedupe event_attendance mirror rows keeping
      // the row with the highest-rank `attended` value per (contact,event) pair.
      // Prevents duplicates from the July 8 bulk-write bug (where a lookup mistake
      // caused new rows to be created alongside the existing "Registered" rows).
      if (url.pathname === '/admin/dedupe-mirror-rows' && request.method === 'GET') {
        if (url.searchParams.get('key') !== env.EXPORT_KEY) return json({ error: 'forbidden' }, 403);
        const ev = url.searchParams.get('event') || '7_7';
        const apply = url.searchParams.get('apply') === '1';
        const meta = eventMeta(ev);
        const evName = mirrorEventName(meta);
        const esc = evName.replace(/'/g, "\\'");
        // Fetch all mirror rows for this event
        const rows = [];
        let off = null;
        do {
          // reminder_status is optional (some bases have it, some don't); zoom_link_sent
          // was never added by Liz, so drop it. Just request the fields we need for
          // survivor scoring — attended rank is the main signal.
          let q = `?filterByFormula=${encodeURIComponent(`FIND('${esc}',{Attendance Record}&'')>0`)}&pageSize=100&fields%5B%5D=contact&fields%5B%5D=event&fields%5B%5D=attended`;
          if (off) q += `&offset=${encodeURIComponent(off)}`;
          const p = await at(env, `/${BASE}/${ATTENDANCE_MIRROR_TBL}${q}`);
          rows.push(...p.records);
          off = p.offset;
        } while (off);
        // Group by contact ID
        const byContact = {};
        for (const r of rows) {
          const cid = (r.fields.contact || [])[0];
          if (!cid) continue;
          (byContact[cid] = byContact[cid] || []).push(r);
        }
        const toDelete = [];
        const kept = [];
        for (const [cid, list] of Object.entries(byContact)) {
          if (list.length === 1) { kept.push(list[0].id); continue; }
          // Pick the survivor: highest attended-rank, then any with reminder_status,
          // then any with zoom_link_sent. Delete the rest.
          const scored = list.map(r => ({
            r,
            score: (MIRROR_RANK[r.fields.attended] || 0),
          }));
          scored.sort((a, b) => b.score - a.score);
          kept.push(scored[0].r.id);
          for (const s of scored.slice(1)) toDelete.push(s.r.id);
        }
        if (apply && toDelete.length) {
          for (let i = 0; i < toDelete.length; i += 10) {
            const params = new URLSearchParams();
            for (const id of toDelete.slice(i, i + 10)) params.append('records[]', id);
            await at(env, `/${BASE}/${ATTENDANCE_MIRROR_TBL}?${params.toString()}`, { method: 'DELETE' });
          }
          await invalidateReadCaches(env);
        }
        return json({
          event: ev,
          dry_run: !apply,
          total_mirror_rows: rows.length,
          unique_contacts: Object.keys(byContact).length,
          duplicates_found: toDelete.length,
          kept: kept.length,
          deleted: apply ? toDelete.length : 0,
        });
      }
      // Bulk-mark attendance for an event from an attendee list (typically Zoom
      // export). POST body: { event, apply, attendees: [{email,name,duration}...],
      // ignore_names: [...] }. Matches by email, then by normalized name. Returns
      // a full analysis: flake rate, walk-ins, and show-rate by confirmation status.
      if (url.pathname === '/admin/mark-attendance-from-list' && request.method === 'POST') {
        if (url.searchParams.get('key') !== env.EXPORT_KEY) return json({ error: 'forbidden' }, 403);
        const body = await request.json().catch(() => ({}));
        const ev = String(body.event || '7_7');
        const apply = body.apply === true || body.apply === 1;
        const attendees = Array.isArray(body.attendees) ? body.attendees : [];
        // Normalize the ignore list the same way we normalize attendee names, so
        // "Jake | Hoosier Action" in the list correctly matches its cleaned form "jake".
        const _cleanForIgnore = (s) => String(s || '').toLowerCase()
          .replace(/\(.*?\)/g, '').replace(/\|.*$/, '')
          .replace(/[^\p{L}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim();
        const ignoreNames = new Set((Array.isArray(body.ignore_names) ? body.ignore_names : [])
          .flatMap(n => [String(n).toLowerCase().trim(), _cleanForIgnore(n)]));
        if (!attendees.length) return json({ error: 'attendees required' }, 400);
        const meta = eventMeta(ev);
        if (!meta.signupField) return json({ error: `event ${ev} has no signup field` }, 400);
        // Fetch all signed-up contacts for the event
        const rows = [];
        let off = null;
        do {
          let q = `?filterByFormula=${encodeURIComponent(`{${meta.signupField}}='Signed up'`)}&pageSize=100&fields%5B%5D=Name&fields%5B%5D=first&fields%5B%5D=last&fields%5B%5D=email&fields%5B%5D=phone&fields%5B%5D=${encodeURIComponent(meta.confirmField)}&fields%5B%5D=${encodeURIComponent(meta.attendField)}`;
          if (off) q += `&offset=${encodeURIComponent(off)}`;
          const p = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
          rows.push(...p.records);
          off = p.offset;
        } while (off);
        const cleanName = (s) => String(s || '')
          .toLowerCase()
          .replace(/\(.*?\)/g, '')
          .replace(/\|.*$/, '')
          .replace(/[^\p{L}\s'-]/gu, ' ')
          .replace(/\s+/g, ' ').trim();
        const cleanEmail = (s) => String(s || '').toLowerCase().trim();
        const byEmail = new Map();
        const byName = new Map();
        for (const r of rows) {
          const e = cleanEmail(r.fields.email);
          if (e) byEmail.set(e, r);
          const nm = cleanName(r.fields.Name || `${r.fields.first || ''} ${r.fields.last || ''}`);
          if (nm) {
            if (!byName.has(nm)) byName.set(nm, []);
            byName.get(nm).push(r);
          }
        }
        const matched = new Set();
        const walkins = [];
        const ignored = [];
        for (const a of attendees) {
          const nm = cleanName(a.name);
          const e = cleanEmail(a.email);
          let hit = null;
          // Check ignore list BEFORE any name matching so guests/staff never get
          // fuzzy-matched to a real signed-up person with a shared first name.
          const nmRaw = String(a.name).toLowerCase().trim();
          const isIgnored = ignoreNames.has(nm) || ignoreNames.has(nmRaw);
          if (isIgnored) {
            ignored.push({ name: a.name, email: a.email, reason: 'ignore_list' });
            continue;
          }
          if (e && byEmail.has(e)) hit = byEmail.get(e);
          else if (nm && nm.split(' ').length >= 2 && byName.has(nm) && byName.get(nm).length === 1) hit = byName.get(nm)[0];
          else if (nm && nm.split(' ').length >= 2) {
            // Require BOTH first + last for fuzzy match. Single-token names would
            // collide with any Airtable contact sharing that first name.
            const short = nm.split(' ').slice(0, 2).join(' ');
            for (const [k, arr] of byName) {
              if (arr.length === 1 && (k.startsWith(short + ' ') || k === short)) { hit = arr[0]; break; }
            }
          }
          if (hit) { matched.add(hit.id); }
          else if (false) {
            ignored.push({ name: a.name, email: a.email, reason: 'ignore_list' });
          } else {
            walkins.push({ name: a.name, email: a.email, duration: a.duration || null });
          }
        }
        const attendedIds = [...matched];
        const noShowIds = rows.filter(r => !matched.has(r.id)).map(r => r.id);
        let mirrorLog = null;
        if (apply) {
          const patchAttField = meta.attendField;
          const mirrorEv = mirrorEventName(meta);
          for (let i = 0; i < attendedIds.length; i += 10) {
            const batch = attendedIds.slice(i, i + 10).map(id => ({ id, fields: { [patchAttField]: 'Attended' } }));
            await at(env, `/${BASE}/${CONTACTS_TBL}`, { method: 'PATCH', body: JSON.stringify({ records: batch, typecast: true }) });
          }
          for (let i = 0; i < noShowIds.length; i += 10) {
            const batch = noShowIds.slice(i, i + 10).map(id => ({ id, fields: { [patchAttField]: 'No-show' } }));
            await at(env, `/${BASE}/${CONTACTS_TBL}`, { method: 'PATCH', body: JSON.stringify({ records: batch, typecast: true }) });
          }
          // Also write through to the event_attendance mirror so grid views reflect
          // reality. Mirror uses "Showed up" / "No show" (contacts uses "Attended" /
          // "No-show"). Surface errors so a broken mirror doesn't fail silently.
          mirrorLog = { attempted: 0, created: 0, upgraded: 0, unchanged: 0, errors: [] };
          for (const id of attendedIds) {
            mirrorLog.attempted++;
            try {
              const r = await mirrorWriteThroughInstrumented(env, id, mirrorEv, 'Showed up');
              mirrorLog[r]++;
            } catch (e) { mirrorLog.errors.push(`attended ${id}: ${e.message}`); }
          }
          for (const id of noShowIds) {
            mirrorLog.attempted++;
            try {
              const r = await mirrorWriteThroughInstrumented(env, id, mirrorEv, 'No show');
              mirrorLog[r]++;
            } catch (e) { mirrorLog.errors.push(`noshow ${id}: ${e.message}`); }
          }
          // Walk-ins: create a contact and mirror row if we have contact info
          for (const w of walkins) {
            if (!w.email && !w.name) continue;
            try {
              // Find or create the contact
              let cid = null;
              const emailLower = String(w.email || '').toLowerCase().trim();
              if (emailLower) {
                const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`LOWER({email})='${emailLower.replace(/'/g, "\\'")}'`)}&maxRecords=1`);
                if (r.records.length) cid = r.records[0].id;
              }
              if (!cid) {
                const parts = String(w.name || '').trim().split(/\s+/);
                const first = parts[0] || '';
                const last = parts.slice(1).join(' ') || '';
                const fields = { first, last, leader_ladder: 'Prospect', source: `walk-in ${ev}` };
                if (emailLower) fields.email = emailLower;
                const c = await at(env, `/${BASE}/${CONTACTS_TBL}`, { method: 'POST', body: JSON.stringify({ records: [{ fields }], typecast: true }) });
                cid = c.records[0].id;
              }
              // Patch attendance status on the contact
              await at(env, `/${BASE}/${CONTACTS_TBL}/${cid}`, { method: 'PATCH', body: JSON.stringify({ fields: { [patchAttField]: 'Walk-in' }, typecast: true }) });
              // Write-through to the mirror as "Showed up" (walk-in is still a show)
              await mirrorWriteThrough(env, cid, mirrorEv, 'Showed up');
            } catch (e) { /* per-walk-in errors non-fatal */ }
          }
          await invalidateReadCaches(env);
        }
        const statusBuckets = {};
        for (const r of rows) {
          const cs = String(r.fields[meta.confirmField] || '(no status)').trim() || '(no status)';
          if (!statusBuckets[cs]) statusBuckets[cs] = { signed_up: 0, attended: 0, no_show: 0 };
          statusBuckets[cs].signed_up++;
          if (matched.has(r.id)) statusBuckets[cs].attended++;
          else statusBuckets[cs].no_show++;
        }
        const breakdown = Object.entries(statusBuckets).map(([status, v]) => ({
          confirm_status: status,
          signed_up: v.signed_up,
          attended: v.attended,
          no_show: v.no_show,
          show_rate_pct: v.signed_up ? Math.round(v.attended / v.signed_up * 1000) / 10 : 0,
        })).sort((a, b) => b.signed_up - a.signed_up);
        const total = rows.length;
        const attended = attendedIds.length;
        return json({
          event: ev,
          dry_run: !apply,
          total_signed_up: total,
          total_attended: attended,
          total_no_show: total - attended,
          flake_rate_pct: total ? Math.round((total - attended) / total * 1000) / 10 : 0,
          show_rate_pct: total ? Math.round(attended / total * 1000) / 10 : 0,
          by_confirm_status: breakdown,
          walk_ins: walkins,
          ignored_from_attendee_list: ignored,
          matched_attendee_names: rows.filter(r => matched.has(r.id)).map(r => r.fields.Name),
          no_show_names: rows.filter(r => !matched.has(r.id)).map(r => r.fields.Name),
          mirror_log: mirrorLog,
        });
      }
      // Admin endpoints — gated by X-Admin-Key header instead of session token
      if (url.pathname === '/admin/dedupe-merge' && request.method === 'POST') return await adminDedupeMerge(request, env);
      if (url.pathname === '/admin/contacts-dump' && request.method === 'GET') return await adminContactsDump(request, env, url);
      if (url.pathname === '/admin/role-append' && request.method === 'POST') return await adminRoleAppend(request, env);
      if (url.pathname === '/admin/queue-check' && request.method === 'GET') return await adminQueueCheck(request, env, url);
      if (url.pathname === '/admin/run-canary' && request.method === 'GET') return await adminRunCanary(env, url);
      if (url.pathname === '/admin/run-export-canary' && request.method === 'GET') return await adminRunExportCanary(env, url);
      if (url.pathname === '/admin/preview-email' && request.method === 'GET') {
        if (url.searchParams.get('key') !== env.EXPORT_KEY) return new Response('forbidden', { status: 403 });
        const evKey = url.searchParams.get('event') || '6_30';
        let link = null, err = null;
        try { link = await env.KV_BINDING.get(`zoomlink:${evKey}`); } catch (e) { err = String(e); }
        const evObj = { ...(EMAIL_EVENTS[evKey] || autoEmailEvent(evKey) || {}) };
        if (link) evObj.zoom_link = link;
        const ics = buildEventIcs(evKey, evObj, url.searchParams.get('to') || 'preview@example.com', 'Preview');
        const L = (ics || '').split('\r\n');
        return json({ event: evKey, zoomlink_resolved: link, button_would_render: !!link,
          email_subject: evObj.subject || '',
          email_signoff_name: evObj.signoff_name || 'LaNeé Bridewell (default)',
          email_reply_to: evObj.signoff_reply_to || 'lanee4kckids@gmail.com (default)',
          email_body_date: evObj.big_date_html || '',
          ics_location: L.find(l => l.startsWith('LOCATION')) || '(no ics)',
          ics_method: L.find(l => l.startsWith('METHOD')) || '',
          ics_has_organizer: L.some(l => l.startsWith('ORGANIZER')),
          ics_has_attendee: L.some(l => l.startsWith('ATTENDEE')),
          calendar_links: calendarLinks(evKey, evObj),
          kv_error: err });
      }
      if (url.pathname === '/admin/send-venue-update') return await adminSendVenueUpdate(request, env, url);
      if (url.pathname === '/admin/kv-set-zoomlink' && request.method === 'GET') {
        if (url.searchParams.get('key') !== env.EXPORT_KEY) return new Response('forbidden', { status: 403 });
        const ev = url.searchParams.get('event'); const link = url.searchParams.get('link');
        if (!ev || !link) return json({ error: 'event+link required' }, 400);
        await env.KV_BINDING.put(`zoomlink:${ev}`, link);     // write through the binding the worker reads
        const readback = await env.KV_BINDING.get(`zoomlink:${ev}`);
        return json({ set: ev, readback });
      }
      if (url.pathname === '/admin/kv-set-roster-token' && request.method === 'GET') {
        if (url.searchParams.get('key') !== env.EXPORT_KEY) return new Response('forbidden', { status: 403 });
        const ev = url.searchParams.get('event'); const token = url.searchParams.get('token');
        if (!ev || !token) return json({ error: 'event+token required' }, 400);
        await env.KV_BINDING.put(`roster-token:${ev}`, token);   // scoped token that unlocks only this event's roster CSV
        const readback = await env.KV_BINDING.get(`roster-token:${ev}`);
        return json({ set: ev, readback });
      }
      if (url.pathname === '/admin/auto-register' && request.method === 'POST') {
        if (url.searchParams.get('key') !== env.EXPORT_KEY) return json({ error: 'forbidden' }, 403);
        const body = await request.json();
        const eventKey = body.event || '6_30';
        const meta = EVENT_META[eventKey];
        if (!meta) return json({ error: 'unknown event' }, 400);
        const emails = (body.emails || []).map(e => String(e || '').toLowerCase().trim()).filter(Boolean);
        const dry = !!body.dry;
        const results = [];
        for (const email of emails) {
          try {
            const q = `LOWER({email})='${email.replace(/'/g, "\\'")}'`;
            const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(q)}&maxRecords=1`);
            if (!r.records.length) { results.push({ email, status: 'not_found' }); continue; }
            const rec = r.records[0], f = rec.fields;
            const existing = Array.isArray(f.events_signed_up) ? f.events_signed_up
              : (typeof f.events_signed_up === 'string' && f.events_signed_up ? f.events_signed_up.split(',').map(s => s.trim()) : []);
            const already = existing.some(e => String(e).toLowerCase() === meta.attendEvent.toLowerCase());
            if (dry) { results.push({ email, status: already ? 'already_on_6_30' : 'will_register', name: `${f.first || ''} ${f.last || ''}`.trim(), county: f.county || null, has_email: !!f.email }); continue; }
            if (!already) {
              const fields = { events_signed_up: [...existing, meta.attendEvent] };   // ONLY add the event; geo/source/zip untouched
              if (meta.signupField) fields[meta.signupField] = 'Signed up';
              await at(env, `/${BASE}/${CONTACTS_TBL}/${rec.id}`, { method: 'PATCH', body: JSON.stringify({ fields, typecast: true }) });
            }
            let emailed = false;
            try { await sendConfirmationEmail(env, email, f.first || '', rec.id, null, eventKey); emailed = true; } catch (e) { results.push({ email, status: 'registered_email_FAILED', error: String(e) }); continue; }
            results.push({ email, status: already ? 'reconfirmed' : 'registered', emailed });
          } catch (e) { results.push({ email, status: 'error', error: String(e) }); }
        }
        if (!dry) await invalidateReadCaches(env);
        const summary = results.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
        return json({ event: eventKey, requested: emails.length, summary, results });
      }
      if (url.pathname === '/event.ics' && request.method === 'GET') {
        const evKey = url.searchParams.get('event') || '6_30';
        if (!EVENT_META[evKey]) return new Response('not found', { status: 404 });
        const evObj = { ...(EMAIL_EVENTS[evKey] || autoEmailEvent(evKey) || {}) };
        try { const l = await env.KV_BINDING.get(`zoomlink:${evKey}`); if (l) evObj.zoom_link = l; } catch (e) {}
        const ics = buildEventIcs(evKey, evObj, null, null, 'PUBLISH');
        if (!ics) return new Response('no event', { status: 404 });
        return new Response(ics, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="no-on-5-onboarding.ics"', 'Access-Control-Allow-Origin': '*' } });
      }
      if (url.pathname === '/admin/log-debug' && request.method === 'GET') return await adminLogDebug(request, env, url);
      if (url.pathname === '/admin/recent-debug' && request.method === 'GET') return await adminRecentDebug(request, env, url);
      if (url.pathname === '/admin/bulk-reassign' && request.method === 'POST') return await adminBulkReassign(request, env);
      if (url.pathname === '/admin/reassign-website-signups' && request.method === 'POST') return await adminReassignWebsiteSignups(request, env);
      if (url.pathname === '/admin/org-set' && request.method === 'GET') {
        const k = request.headers.get('X-Admin-Key');
        if (!env.ADMIN_KEY || k !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
        const org = url.searchParams.get('organizer');
        const orgFullName = organizerName(org);
        if (!orgFullName) return json({ error: 'unknown organizer' }, 400);
        const filter = `FIND('${orgFullName}',{assigned_organizer}&'')>0`;
        const ids = [];
        let offset = null;
        do {
          let q = `?filterByFormula=${encodeURIComponent(filter)}&pageSize=100&fields%5B%5D=Name&fields%5B%5D=assigned_organizer&fields%5B%5D=last_attempt_result&fields%5B%5D=source`;
          if (offset) q += `&offset=${offset}`;
          const data = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
          for (const r of data.records) ids.push({ id: r.id, name: r.fields.Name, assigned: r.fields.assigned_organizer, last_result: r.fields.last_attempt_result, source: r.fields.source });
          offset = data.offset;
        } while (offset);
        return json({ organizer: org, filter, count: ids.length, contacts: ids });
      }
      if (url.pathname === '/admin/cache-flush' && request.method === 'POST') {
        const k = request.headers.get('X-Admin-Key');
        if (!env.ADMIN_KEY || k !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
        await invalidateReadCaches(env);
        return json({ ok: true, flushed: READ_CACHE_KEYS.length });
      }
      if (url.pathname === '/admin/bulk-import' && request.method === 'POST') {
        const k = request.headers.get('X-Admin-Key');
        if (!env.ADMIN_KEY || k !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
        const body = await request.json();
        const rows = body.rows || [];
        const source = body.source || 'bulk import';
        const signup_5_26 = body.signup_5_26 !== false;  // default true
        const date = todayCT();
        const results = [];
        for (const r of rows) {
          try {
            const { first, last, email, phone, street_address, city, zip, county, school, district } = r;
            if (!first || !last) { results.push({ row: r, status: 'skipped', reason: 'no name' }); continue; }
            const organizerId = deriveOrganizerId({ county, city, zip });
            const isLanee = organizerId === LANEE_ID;
            let existingId = null;
            if (email) {
              const e = String(email).toLowerCase().trim();
              const lookup = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`LOWER({email})='${e}'`)}&maxRecords=1`);
              if (lookup.records.length > 0) existingId = lookup.records[0].id;
            }
            if (!existingId && phone) {
              const digits = String(phone).replace(/\D/g, '').slice(-10);
              if (digits.length === 10) {
                const lookup = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`REGEX_REPLACE({phone},'\\\\D','')='${digits}'`)}&maxRecords=1`);
                if (lookup.records.length > 0) existingId = lookup.records[0].id;
              }
            }
            let contactId, action;
            if (existingId) {
              contactId = existingId;
              action = 'updated';
              const patch = { source, assigned_organizer: [organizerId] };
              if (signup_5_26) { patch.last_attempt_date = date; patch.last_attempt_result = 'Signed up'; }
              if (street_address) patch.street_address = street_address;
              if (city) patch.city = city;
              if (zip) patch.zip = String(zip);
              if (county) patch.county = county;
              if (school) patch.school = school;
              { const d = district || zipToDistrict(zip); if (d) patch.district = d; }
              if (email) patch.email = String(email).toLowerCase().trim();
              if (phone) patch.phone = String(phone).trim();
              await at(env, `/${BASE}/${CONTACTS_TBL}/${contactId}`, {
                method: 'PATCH',
                body: JSON.stringify({ fields: patch, typecast: true }),
              });
            } else {
              action = 'created';
              const fields = {
                first: String(first).trim(),
                last: String(last).trim(),
                leader_ladder: 'Prospect',
                assigned_organizer: [organizerId],
                source,
              };
              if (email) fields.email = String(email).toLowerCase().trim();
              if (phone) fields.phone = String(phone).trim();
              if (street_address) fields.street_address = street_address;
              if (city) fields.city = city;
              if (zip) fields.zip = String(zip);
              if (county) fields.county = county;
              if (school) fields.school = school;
              { const d = district || zipToDistrict(zip); if (d) fields.district = d; }
              if (signup_5_26) { fields.last_attempt_date = date; fields.last_attempt_result = 'Signed up'; }
              const created = await at(env, `/${BASE}/${CONTACTS_TBL}`, {
                method: 'POST',
                body: JSON.stringify({ records: [{ fields }], typecast: true }),
              });
              contactId = created.records[0].id;
            }
            if (signup_5_26) {
              await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, {
                method: 'POST',
                body: JSON.stringify({ records: [{ fields: {
                  Summary: `${date} — signup 5/26 via ${source}`,
                  date,
                  method: 'Event attendance',
                  result: 'Signed up',
                  event: 'Orientation 5/26',
                  contact: [contactId],
                  notes: `Source: ${source}`,
                }}], typecast: true }),
              });
            }
            results.push({ contact_id: contactId, name: `${first} ${last}`, organizer: isLanee ? 'LaNeé' : 'Stephanie', action });
          } catch (e) {
            results.push({ row: r, status: 'error', error: e.message });
          }
        }
        await invalidateReadCaches(env);
        return json({ ok: true, processed: results.length, results });
      }
      if (url.pathname === '/admin/bulk-patch-contacts' && request.method === 'POST') {
        const k = request.headers.get('X-Admin-Key');
        if (!env.ADMIN_KEY || k !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
        const body = await request.json();
        const records = body.records || [];  // [{id, fields:{...}}]
        const updated = [];
        const errors = [];
        for (let i = 0; i < records.length; i += 10) {
          const batch = records.slice(i, i + 10);
          try {
            await at(env, `/${BASE}/${CONTACTS_TBL}`, {
              method: 'PATCH',
              body: JSON.stringify({ records: batch, typecast: true })
            });
            for (const r of batch) updated.push(r.id);
          } catch (e) {
            errors.push({ batch_start: i, error: e.message });
          }
        }
        await invalidateReadCaches(env);
        return json({ ok: true, updated_count: updated.length, errors });
      }
      if (url.pathname === '/admin/bulk-log' && request.method === 'POST') {
        const k = request.headers.get('X-Admin-Key');
        if (!env.ADMIN_KEY || k !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
        const body = await request.json();
        const entries = body.entries || [];
        // Each entry: { contact_id, method, result, event, notes, date }
        const date = body.date || todayCT();
        const created = [];
        const errors = [];
        // Batch in 10s for Airtable
        for (let i = 0; i < entries.length; i += 10) {
          const batch = entries.slice(i, i + 10);
          const records = batch.map(e => ({
            fields: {
              Summary: e.summary || `${e.date || date} — ${e.method || 'Other'}`,
              date: e.date || date,
              method: e.method || 'Other',
              ...(e.result ? { result: e.result } : {}),
              ...(e.event ? { event: e.event } : {}),
              contact: [e.contact_id],
              ...(e.notes ? { notes: e.notes } : {}),
            }
          }));
          try {
            const resp = await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, {
              method: 'POST',
              body: JSON.stringify({ records, typecast: true })
            });
            for (const r of resp.records) created.push(r.id);
          } catch (e) {
            errors.push({ batch_start: i, error: e.message });
          }
        }
        await invalidateReadCaches(env);
        return json({ ok: true, created_count: created.length, created, errors });
      }
      if (url.pathname === '/admin/base-schema' && request.method === 'GET') {
        const k = request.headers.get('X-Admin-Key');
        const schemaOk = (env.ADMIN_KEY && k === env.ADMIN_KEY) || (env.SETUP_KEY && k === env.SETUP_KEY);
        if (!schemaOk) return json({ error: 'forbidden' }, 403);
        const r = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables`, {
          headers: { 'Authorization': `Bearer ${env.AIRTABLE_TOKEN}` },
        });
        return json({ ok: r.ok, status: r.status, body: JSON.parse(await r.text()) });
      }
      if (url.pathname === '/admin/list-records' && request.method === 'GET') {
        const k = request.headers.get('X-Admin-Key');
        if (!env.ADMIN_KEY || k !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
        const tableId = url.searchParams.get('table');
        if (!tableId) return json({ error: 'table param required' }, 400);
        const r = await fetch(`https://api.airtable.com/v0/${BASE}/${tableId}?maxRecords=100`, {
          headers: { 'Authorization': `Bearer ${env.AIRTABLE_TOKEN}` },
        });
        return json({ ok: r.ok, status: r.status, body: JSON.parse(await r.text()) });
      }
      if (url.pathname === '/admin/patch-records' && request.method === 'POST') {
        const k = request.headers.get('X-Admin-Key');
        if (!env.ADMIN_KEY || k !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
        const body = await request.json();
        const tableId = body.table;
        const records = body.records || [];
        if (!tableId) return json({ error: 'table required' }, 400);
        const updated = [];
        const errors = [];
        for (let i = 0; i < records.length; i += 10) {
          const chunk = records.slice(i, i + 10);
          const r = await fetch(`https://api.airtable.com/v0/${BASE}/${tableId}`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ records: chunk, typecast: true }),
          });
          if (r.ok) updated.push(...chunk.map(c => c.id));
          else errors.push({ batch_start: i, status: r.status, body: await r.text() });
        }
        return json({ ok: true, updated_count: updated.length, errors });
      }
      if (url.pathname === '/admin/create-view' && request.method === 'POST') {
        const k = request.headers.get('X-Admin-Key');
        const cvOk = (env.ADMIN_KEY && k === env.ADMIN_KEY) || (env.SETUP_KEY && k === env.SETUP_KEY);
        if (!cvOk) return json({ error: 'forbidden' }, 403);
        const body = await request.json();
        const tableId = body.table || CONTACTS_TBL;
        const payload = {
          name: body.name,
          type: body.type || 'grid',
        };
        if (body.visibleFieldIds) payload.visibleFieldIds = body.visibleFieldIds;
        const r = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables/${tableId}/views`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        return json({ ok: r.ok, status: r.status, body: await r.text() });
      }
      if (url.pathname === '/admin/create-records' && request.method === 'POST') {
        const k = request.headers.get('X-Admin-Key');
        if (!env.ADMIN_KEY || k !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
        const body = await request.json();
        const tableId = body.table;
        const records = body.records || [];
        if (!tableId) return json({ error: 'table required' }, 400);
        const created = [];
        const errors = [];
        for (let i = 0; i < records.length; i += 10) {
          const chunk = records.slice(i, i + 10);
          const r = await fetch(`https://api.airtable.com/v0/${BASE}/${tableId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ records: chunk, typecast: true }),
          });
          if (r.ok) {
            const j = await r.json();
            created.push(...j.records.map(rec => ({ id: rec.id, name: rec.fields.Name || rec.fields.name || '' })));
          } else {
            errors.push({ batch_start: i, status: r.status, body: await r.text() });
          }
        }
        return json({ ok: true, created_count: created.length, created, errors });
      }
      if (url.pathname === '/admin/update-field' && request.method === 'POST') {
        // Rename a field / set its description (Airtable API can't edit
        // formulas, but it can rename — used to retire superseded fields).
        const k = request.headers.get('X-Admin-Key');
        const ufOk = (env.ADMIN_KEY && k === env.ADMIN_KEY) || (env.SETUP_KEY && k === env.SETUP_KEY);
        if (!ufOk) return json({ error: 'forbidden' }, 403);
        const body = await request.json();
        if (!body.field_id) return json({ error: 'field_id required' }, 400);
        const payload = {};
        if (body.name) payload.name = body.name;
        if (body.description != null) payload.description = body.description;
        const r = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables/${body.table_id || CONTACTS_TBL}/fields/${body.field_id}`, {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        return json({ ok: r.ok, status: r.status, body: await r.text() });
      }
      if (url.pathname === '/admin/create-field' && request.method === 'POST') {
        const k = request.headers.get('X-Admin-Key');
        const cfOk = (env.ADMIN_KEY && k === env.ADMIN_KEY) || (env.SETUP_KEY && k === env.SETUP_KEY);
        if (!cfOk) return json({ error: 'forbidden' }, 403);
        const body = await request.json();
        const f = { name: body.name, type: body.type };
        if (body.options) f.options = body.options;
        const tableId = body.table_id || CONTACTS_TBL;
        const r = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables/${tableId}/fields`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(f),
        });
        const txt = await r.text();
        return json({ ok: r.ok, status: r.status, body: txt });
      }
      if (url.pathname === '/admin/setup-a5-field' && request.method === 'POST') {
        const k = request.headers.get('X-Admin-Key');
        if (!env.ADMIN_KEY || k !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
        const out = { fields_created: [], errors: [] };
        const f = { name: 'amendment5_commitments', type: 'multilineText' };
        const r = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables/${CONTACTS_TBL}/fields`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(f),
        });
        if (r.ok) out.fields_created.push(f.name);
        else out.errors.push({ status: r.status, body: await r.text() });
        return json(out);
      }
      if (url.pathname === '/admin/setup-event-fields' && request.method === 'POST') {
        // Creates the three per-event tracking fields (signup/confirm/attendance)
        // for any EVENT_META key. Accepts ADMIN_KEY or SETUP_KEY so field setup
        // for new events doesn't require the primary admin credential.
        const k = request.headers.get('X-Admin-Key');
        const authorized = (env.ADMIN_KEY && k === env.ADMIN_KEY) || (env.SETUP_KEY && k === env.SETUP_KEY);
        if (!authorized) return json({ error: 'forbidden' }, 403);
        const body = await request.json();
        const meta = EVENT_META[body.event];
        if (!meta) return json({ error: `unknown event key — add to EVENT_META first. Known: ${Object.keys(EVENT_META).join(', ')}` }, 400);
        const out = { event: body.event, fields_created: [], errors: [] };
        const defs = [];
        if (meta.signupField) defs.push({ name: meta.signupField, type: 'singleSelect', options: { choices: [
          { name: 'Signed up', color: 'greenBright' },
          { name: 'Maybe', color: 'yellowBright' },
          { name: 'Not interested', color: 'redLight2' },
        ]}});
        defs.push({ name: meta.confirmField, type: 'singleSelect', options: { choices: [
          { name: 'Confirmed', color: 'greenBright' },
          { name: 'Declined', color: 'redBright' },
          { name: 'Cancelled', color: 'redLight2' },
          { name: 'No answer', color: 'grayLight2' },
          { name: 'Reminder sent', color: 'purpleLight2' },
        ]}});
        defs.push({ name: meta.attendField, type: 'singleSelect', options: { choices: [
          { name: 'Attended', color: 'greenBright' },
          { name: 'No-show', color: 'redBright' },
          { name: 'Walk-in', color: 'purpleBright' },
        ]}});
        for (const f of defs) {
          const r = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables/${CONTACTS_TBL}/fields`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(f),
          });
          if (r.ok) out.fields_created.push(f.name);
          else out.errors.push({ field: f.name, status: r.status, body: await r.text() });
        }
        return json(out);
      }
      if (url.pathname === '/admin/backfill-dnc-flags' && request.method === 'POST') {
        const k = request.headers.get('X-Admin-Key');
        const authorized = (env.ADMIN_KEY && k === env.ADMIN_KEY) || (env.SETUP_KEY && k === env.SETUP_KEY);
        if (!authorized) return json({ error: 'forbidden' }, 403);
        const f = `{result}='Do not contact'`;
        const byContact = {};
        let offset = null;
        do {
          let q = `?filterByFormula=${encodeURIComponent(f)}&pageSize=100&fields%5B%5D=contact&fields%5B%5D=date`;
          if (offset) q += `&offset=${offset}`;
          const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
          for (const r of d.records) {
            const cid = (r.fields.contact || [])[0];
            if (!cid) continue;
            if (!byContact[cid] || (r.fields.date || '') > byContact[cid]) byContact[cid] = r.fields.date || '';
          }
          offset = d.offset;
        } while (offset);
        const updates = Object.entries(byContact).map(([id, date]) => ({ id, fields: { dnc_flag_date: date } }));
        let updated = 0;
        for (let i = 0; i < updates.length; i += 10) {
          await at(env, `/${BASE}/${CONTACTS_TBL}`, { method: 'PATCH', body: JSON.stringify({ records: updates.slice(i, i + 10), typecast: true }) });
          updated += Math.min(10, updates.length - i);
        }
        await invalidateReadCaches(env);
        return json({ updated });
      }
      if (url.pathname === '/admin/backfill-attempt-counts' && request.method === 'POST') {
        // Recompute attempt_count (Call/Text/Email logs) + one_on_one_booked
        // for every contact from the full log table.
        const k = request.headers.get('X-Admin-Key');
        const authorized = (env.ADMIN_KEY && k === env.ADMIN_KEY) || (env.SETUP_KEY && k === env.SETUP_KEY);
        if (!authorized) return json({ error: 'forbidden' }, 403);
        const counts = {}; const oneOnOnes = new Set();
        let offset = null;
        do {
          let q = `?pageSize=100&fields%5B%5D=contact&fields%5B%5D=method&fields%5B%5D=event`;
          if (offset) q += `&offset=${offset}`;
          const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
          for (const r of d.records) {
            const cid = (r.fields.contact || [])[0];
            if (!cid) continue;
            if (['Call', 'Text', 'Email'].includes(r.fields.method)) counts[cid] = (counts[cid] || 0) + 1;
            if (r.fields.event === '1-1 meeting') oneOnOnes.add(cid);
          }
          offset = d.offset;
        } while (offset);
        const ids = new Set([...Object.keys(counts), ...oneOnOnes]);
        const updates = [...ids].map(id => ({ id, fields: { attempt_count: counts[id] || 0, one_on_one_booked: oneOnOnes.has(id) } }));
        let updated = 0; const errors = [];
        for (let i = 0; i < updates.length; i += 10) {
          try {
            await at(env, `/${BASE}/${CONTACTS_TBL}`, { method: 'PATCH', body: JSON.stringify({ records: updates.slice(i, i + 10), typecast: true }) });
            updated += Math.min(10, updates.length - i);
          } catch (e) { errors.push({ at: i, error: e.message }); }
        }
        await invalidateReadCaches(env);
        return json({ updated, contacts_with_attempts: Object.keys(counts).length, one_on_ones: oneOnOnes.size, errors });
      }
      if (url.pathname === '/admin/backfill-log-organizer' && request.method === 'POST') {
        // Stamp `organizer` on historical outreach logs from the contact's
        // assigned organizer. Valid because the lists never overlap: each
        // contact is assigned to exactly ONE organizer, and only that
        // organizer's dashboard ever surfaced them.
        const k = request.headers.get('X-Admin-Key');
        const authorized = (env.ADMIN_KEY && k === env.ADMIN_KEY) || (env.SETUP_KEY && k === env.SETUP_KEY);
        if (!authorized) return json({ error: 'forbidden' }, 403);
        const dryRun = url.searchParams.get('dry') === '1';
        // 1. contact id → organizer display name
        const orgByContact = {};
        {
          let offset = null;
          do {
            let q = `?pageSize=100&fields%5B%5D=assigned_organizer`;
            if (offset) q += `&offset=${offset}`;
            const d = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
            for (const r of d.records) {
              const ids = r.fields.assigned_organizer || [];
              if (ids.length) orgByContact[r.id] = ids[0];
            }
            offset = d.offset;
          } while (offset);
        }
        // organizer record id → name
        const orgNames = {};
        {
          const d = await at(env, `/${BASE}/tblxknZQg2W4JdTny?pageSize=100&fields%5B%5D=name`);
          for (const r of d.records) orgNames[r.id] = r.fields.name || '';
        }
        // 2. logs with outreach method + blank organizer
        const targets = [];
        {
          const f = `AND(OR({method}='Call',{method}='Text',{method}='Email',{method}='Other'),{organizer}=BLANK())`;
          let offset = null;
          do {
            let q = `?filterByFormula=${encodeURIComponent(f)}&pageSize=100&fields%5B%5D=contact&fields%5B%5D=organizer`;
            if (offset) q += `&offset=${offset}`;
            const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
            for (const r of d.records) {
              const cid = (r.fields.contact || [])[0];
              const orgRec = cid ? orgByContact[cid] : null;
              const name = orgRec ? orgNames[orgRec] : null;
              if (name) targets.push({ id: r.id, organizer: name });
            }
            offset = d.offset;
          } while (offset);
        }
        if (dryRun) {
          const byOrg = {};
          targets.forEach(t => { byOrg[t.organizer] = (byOrg[t.organizer] || 0) + 1; });
          return json({ dry_run: true, would_update: targets.length, by_organizer: byOrg });
        }
        let updated = 0; const errors = [];
        for (let i = 0; i < targets.length; i += 10) {
          const batch = targets.slice(i, i + 10).map(t => ({ id: t.id, fields: { organizer: t.organizer } }));
          try {
            await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, { method: 'PATCH', body: JSON.stringify({ records: batch, typecast: true }) });
            updated += batch.length;
          } catch (e) { errors.push({ at: i, error: e.message }); }
        }
        await invalidateReadCaches(env);
        return json({ updated, total: targets.length, errors });
      }
      if (url.pathname === '/admin/backfill-event-dates' && request.method === 'POST') {
        // Fill blank dates on event_attendance rows. dry=1 lists the distinct
        // blank-date event names; apply with body {"mappings": {"substring": "YYYY-MM-DD"}}.
        const k = request.headers.get('X-Admin-Key');
        const authorized = (env.ADMIN_KEY && k === env.ADMIN_KEY) || (env.SETUP_KEY && k === env.SETUP_KEY);
        if (!authorized) return json({ error: 'forbidden' }, 403);
        const dryRun = url.searchParams.get('dry') === '1';
        const rows = [];
        {
          const f = `{date}=BLANK()`;
          let offset = null;
          do {
            let q = `?filterByFormula=${encodeURIComponent(f)}&pageSize=100&fields%5B%5D=event&fields%5B%5D=Summary`;
            if (offset) q += `&offset=${offset}`;
            const d = await at(env, `/${BASE}/${EVENT_ATTENDANCE_TBL}${q}`);
            for (const r of d.records) rows.push({ id: r.id, event: r.fields.event || r.fields.Summary || '' });
            offset = d.offset;
          } while (offset);
        }
        if (dryRun) {
          const names = {};
          rows.forEach(r => { names[r.event] = (names[r.event] || 0) + 1; });
          return json({ dry_run: true, blank_date_rows: rows.length, by_event_name: names });
        }
        const body = await request.json();
        const mappings = body.mappings || {};
        const updates = [];
        for (const r of rows) {
          for (const [substr, date] of Object.entries(mappings)) {
            if (r.event.toLowerCase().includes(substr.toLowerCase())) { updates.push({ id: r.id, fields: { date } }); break; }
          }
        }
        let updated = 0; const errors = [];
        for (let i = 0; i < updates.length; i += 10) {
          const batch = updates.slice(i, i + 10);
          try {
            await at(env, `/${BASE}/${EVENT_ATTENDANCE_TBL}`, { method: 'PATCH', body: JSON.stringify({ records: batch, typecast: true }) });
            updated += batch.length;
          } catch (e) { errors.push({ at: i, error: e.message }); }
        }
        await invalidateReadCaches(env);
        return json({ updated, matched: updates.length, blank_total: rows.length, errors });
      }
      if (url.pathname === '/pilot/webhook/register' && request.method === 'POST') {
        // Register a tracker-sheet webhook URL for an event. Idempotent — no
        // secret required (URLs are unguessable Apps-Script deployment tokens),
        // but we lightly rate-limit and cap the list.
        const body = await request.json().catch(() => ({}));
        const ev = String(body.event || '').trim();
        const hookUrl = String(body.url || '').trim();
        if (!ev || !hookUrl.startsWith('https://script.google.com/'))
          return json({ error: 'need {event, url} where url is a script.google.com Web App URL' }, 400);
        const cur = await loadWebhooks(env, ev);
        if (cur.length >= 20) return json({ error: 'too many hooks for this event' }, 429);
        const next = await saveWebhooks(env, ev, cur.concat([hookUrl]));
        return json({ ok: true, event: ev, count: next.length, url: hookUrl });
      }
      if (url.pathname === '/pilot/webhook/list' && request.method === 'GET') {
        const ev = url.searchParams.get('event') || '';
        const cur = await loadWebhooks(env, ev);
        return json({ ok: true, event: ev, count: cur.length, urls: cur });
      }
      if (url.pathname === '/pilot/webhook/remove' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const ev = String(body.event || '').trim();
        const hookUrl = String(body.url || '').trim();
        if (!ev) return json({ error: 'need {event, url?}' }, 400);
        if (!hookUrl) {                                    // clear all for event
          await env.KV_BINDING.delete(`webhook:${ev}`);
          return json({ ok: true, event: ev, cleared: true });
        }
        const cur = await loadWebhooks(env, ev);
        const next = await saveWebhooks(env, ev, cur.filter(u => u !== hookUrl));
        return json({ ok: true, event: ev, count: next.length });
      }
      if (url.pathname === '/pilot/webhook/replay' && request.method === 'POST') {
        // Backfill a newly-registered sheet with existing RSVPs for an event.
        // No admin key: any registered webhook URL for the event can trigger
        // its own replay by including itself in `url` — worker only pushes to
        // that URL, not the whole fanout list, so it can't be abused to spam.
        const body = await request.json().catch(() => ({}));
        const ev = String(body.event || '').trim();
        const hookUrl = String(body.url || '').trim();
        if (!ev || !hookUrl) return json({ error: 'need {event, url}' }, 400);
        const registered = await loadWebhooks(env, ev);
        if (!registered.includes(hookUrl)) return json({ error: 'url not registered for this event' }, 403);
        const evEsc = ev.replace(/'/g, "\\'");
        // Pull every RSVP contact_log row for this event, then push each to just this URL.
        const q = `?filterByFormula=${encodeURIComponent(`AND({method}='Event RSVP',{rsvp_launch}='${evEsc}')`)}&pageSize=100`;
        const res = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
        const rows = res.records || [];
        let pushed = 0;
        for (const r of rows) {
          const contactIds = r.fields.contact || [];
          if (!contactIds.length) continue;
          const cRes = await at(env, `/${BASE}/${CONTACTS_TBL}/${contactIds[0]}`);
          const cf = cRes.fields || {};
          const payload = {
            event: ev,
            first: cf.first || '', last: cf.last || '',
            email: cf.email || '', phone: cf.phone || '',
            role: (Array.isArray(cf.role) ? cf.role.join(', ') : (cf.role || '')),
            school: cf.school || '', district: cf.district || '',
            notes: r.fields.notes || '',
            rsvp_pizza: r.fields.rsvp_pizza || '', rsvp_childcare: r.fields.rsvp_childcare || '',
            childcare_kids: r.fields.rsvp_childcare_kids || '',
            accessibility: r.fields.rsvp_accessibility || '',
            created_new: false, replay: true,
            ts: Date.now(),
          };
          try {
            await fetch(hookUrl, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload), signal: AbortSignal.timeout(8000),
            });
            pushed++;
          } catch (e) { /* skip */ }
        }
        return json({ ok: true, event: ev, pushed, total: rows.length });
      }
      if (url.pathname === '/admin/set-zoom-link' && request.method === 'POST') {
        // Per-event Zoom/registration link, stored in KV — no redeploy.
        const k = request.headers.get('X-Admin-Key');
        const zOk = (env.ADMIN_KEY && k === env.ADMIN_KEY) || (env.SETUP_KEY && k === env.SETUP_KEY);
        if (!zOk) return json({ error: 'forbidden' }, 403);
        const body = await request.json();
        if (!body.event || !EVENT_META[body.event]) return json({ error: 'unknown event' }, 400);
        if (body.link) await env.KV_BINDING.put(`zoomlink:${body.event}`, String(body.link));
        else await env.KV_BINDING.delete(`zoomlink:${body.event}`);
        return json({ ok: true, event: body.event, link: body.link || null });
      }
      if (url.pathname === '/admin/setup-pilot-fields' && request.method === 'POST') {
        // One-shot: attribution + note denormalization fields.
        const k = request.headers.get('X-Admin-Key');
        const authorized = (env.ADMIN_KEY && k === env.ADMIN_KEY) || (env.SETUP_KEY && k === env.SETUP_KEY);
        if (!authorized) return json({ error: 'forbidden' }, 403);
        const out = { fields_created: [], errors: [] };
        const jobs = [
          { tbl: CONTACTS_TBL, f: { name: 'last_attempt_by', type: 'singleLineText' } },
          { tbl: CONTACTS_TBL, f: { name: 'last_attempt_note', type: 'multilineText' } },
          { tbl: CONTACT_LOG_TBL, f: { name: 'organizer', type: 'singleLineText' } },
        ];
        for (const { tbl, f } of jobs) {
          const r = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables/${tbl}/fields`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(f),
          });
          if (r.ok) out.fields_created.push(f.name);
          else out.errors.push({ field: f.name, status: r.status, body: await r.text() });
        }
        return json(out);
      }
      if (url.pathname === '/admin/setup-6-9-field' && request.method === 'POST') {
        const k = request.headers.get('X-Admin-Key');
        if (!env.ADMIN_KEY || k !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
        const out = { fields_created: [], errors: [] };
        const f = {
          name: 'signup_6_9_status',
          type: 'singleSelect',
          options: { choices: [
            { name: 'Signed up', color: 'greenBright' },
            { name: 'Maybe', color: 'yellowBright' },
            { name: 'Not interested', color: 'redLight2' },
          ]},
        };
        const r = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables/${CONTACTS_TBL}/fields`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(f),
        });
        if (r.ok) out.fields_created.push(f.name);
        else out.errors.push({ field: f.name, status: r.status, body: await r.text() });
        return json(out);
      }
      if (url.pathname === '/admin/setup-hm-fields' && request.method === 'POST') {
        const k = request.headers.get('X-Admin-Key');
        if (!env.ADMIN_KEY || k !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
        const out = { fields_created: [], errors: [] };
        const defs = [
          { name: 'house_meeting_date', type: 'date', options: { dateFormat: { name: 'iso' } } },
          { name: 'house_meeting_host', type: 'singleLineText' },
          { name: 'house_meeting_commitments', type: 'multilineText' },
        ];
        for (const f of defs) {
          const r = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables/${CONTACTS_TBL}/fields`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(f),
          });
          if (r.ok) out.fields_created.push(f.name);
          else out.errors.push({ field: f.name, status: r.status, body: await r.text() });
        }
        return json(out);
      }
      if (url.pathname === '/admin/backfill-house-meetings' && request.method === 'POST') {
        const k = request.headers.get('X-Admin-Key');
        if (!env.ADMIN_KEY || k !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
        // Read all House meeting + Commitment logs grouped by contact, then patch contact
        const dataByContact = {};
        let offset = null;
        do {
          let q = `?filterByFormula=${encodeURIComponent(`OR({method}='House meeting',{method}='Commitment')`)}&pageSize=100&fields%5B%5D=contact&fields%5B%5D=method&fields%5B%5D=event&fields%5B%5D=date&fields%5B%5D=notes`;
          if (offset) q += `&offset=${offset}`;
          const data = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
          for (const r of data.records) {
            const cid = (r.fields.contact || [])[0];
            if (!cid) continue;
            if (!dataByContact[cid]) dataByContact[cid] = { date: null, host: null, commitments: [] };
            const d = dataByContact[cid];
            if (r.fields.method === 'House meeting') {
              if (!d.date || (r.fields.date && r.fields.date > d.date)) {
                d.date = r.fields.date;
                const notes = r.fields.notes || '';
                const m = notes.match(/Host:\s*([^·]+)/);
                if (m) d.host = m[1].trim();
              }
            }
            if (r.fields.method === 'Commitment' && r.fields.event) {
              if (!d.commitments.includes(r.fields.event)) d.commitments.push(r.fields.event);
            }
          }
          offset = data.offset;
        } while (offset);
        const ids = Object.keys(dataByContact);
        let ok = 0; const errors = [];
        for (let i = 0; i < ids.length; i += 10) {
          const batch = ids.slice(i, i + 10).map(id => {
            const d = dataByContact[id];
            const fields = {};
            if (d.date) fields.house_meeting_date = d.date;
            if (d.host) fields.house_meeting_host = d.host;
            if (d.commitments.length) fields.house_meeting_commitments = d.commitments.join(' · ');
            return { id, fields };
          });
          try {
            await at(env, `/${BASE}/${CONTACTS_TBL}`, {
              method: 'PATCH',
              body: JSON.stringify({ records: batch, typecast: true }),
            });
            ok += batch.length;
          } catch (e) { errors.push({ batch_start: i, error: e.message }); }
        }
        await invalidateReadCaches(env);
        return json({ updated_contacts: ok, total: ids.length, errors });
      }
      if (url.pathname === '/admin/setup-status-fields' && request.method === 'POST') {
        const k = request.headers.get('X-Admin-Key');
        if (!env.ADMIN_KEY || k !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
        const out = { fields_created: [], errors: [] };
        const fieldDefs = [
          { name: 'confirm_5_26_status', type: 'singleSelect', options: { choices: [
            { name: 'Confirmed', color: 'greenBright' },
            { name: 'Declined', color: 'redBright' },
            { name: 'Cancelled', color: 'redLight2' },
            { name: 'No answer', color: 'grayLight2' },
            { name: 'Reminder sent', color: 'purpleLight2' },
          ]}},
          { name: 'attendance_5_26_status', type: 'singleSelect', options: { choices: [
            { name: 'Attended', color: 'greenBright' },
            { name: 'No-show', color: 'redBright' },
            { name: 'Walk-in', color: 'purpleBright' },
          ]}},
        ];
        for (const f of fieldDefs) {
          const r = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables/${CONTACTS_TBL}/fields`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(f),
          });
          if (r.ok) out.fields_created.push(f.name);
          else out.errors.push({ field: f.name, status: r.status, body: await r.text() });
        }
        return json(out);
      }
      if (url.pathname === '/admin/backfill-statuses' && request.method === 'POST') {
        const k = request.headers.get('X-Admin-Key');
        if (!env.ADMIN_KEY || k !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
        const confirmByContact = {};
        const attendByContact = {};
        const rank = { 'Confirmed': 5, 'Cancelled': 4, 'Declined': 3, 'No answer': 2, 'Reminder sent': 1 };
        let offset = null;
        do {
          let q = `?filterByFormula=${encodeURIComponent(`OR({event}='${CONFIRM_EVENT}',{event}='Orientation 5/26')`)}&pageSize=100&fields%5B%5D=contact&fields%5B%5D=method&fields%5B%5D=result&fields%5B%5D=event&fields%5B%5D=date`;
          if (offset) q += `&offset=${offset}`;
          const data = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
          for (const r of data.records) {
            const cid = (r.fields.contact || [])[0];
            if (!cid) continue;
            const res = r.fields.result;
            if (r.fields.event === CONFIRM_EVENT && res) {
              const prev = confirmByContact[cid];
              if (!prev || (rank[res] || 0) > (rank[prev.result] || 0)) {
                confirmByContact[cid] = { result: res, date: r.fields.date };
              }
            }
            if (r.fields.event === 'Orientation 5/26' && r.fields.method === 'Event attendance' && res && ['Attended','No-show','Walk-in'].includes(res)) {
              const prev = attendByContact[cid];
              if (!prev || (r.fields.date && r.fields.date > prev.date)) {
                attendByContact[cid] = { result: res, date: r.fields.date };
              }
            }
          }
          offset = data.offset;
        } while (offset);
        const updates = {};
        for (const [cid, v] of Object.entries(confirmByContact)) (updates[cid] = updates[cid] || {}).confirm_5_26_status = v.result;
        for (const [cid, v] of Object.entries(attendByContact)) (updates[cid] = updates[cid] || {}).attendance_5_26_status = v.result;
        const ids = Object.keys(updates);
        let ok = 0; const errors = [];
        for (let i = 0; i < ids.length; i += 10) {
          const batch = ids.slice(i, i + 10).map(id => ({ id, fields: updates[id] }));
          try {
            await at(env, `/${BASE}/${CONTACTS_TBL}`, {
              method: 'PATCH',
              body: JSON.stringify({ records: batch, typecast: true }),
            });
            ok += batch.length;
          } catch (e) { errors.push({ batch_start: i, error: e.message }); }
        }
        await invalidateReadCaches(env);
        return json({ updated_contacts: ok, total: ids.length, errors });
      }
      if (url.pathname.startsWith('/admin/contact/') && request.method === 'GET') {
        const cid = url.pathname.split('/').pop();
        const key2 = request.headers.get('X-Admin-Key');
        if (!env.ADMIN_KEY || key2 !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
        const data = await at(env, `/${BASE}/${CONTACTS_TBL}/${cid}`);
        return json({ id: data.id, ...data.fields });
      }
      const sessionToken = request.headers.get('X-Groundwork-Session');
      const email = sessionToken ? await env.KV_BINDING.get(`session:${sessionToken}`) : null;
      if (!email) return json({ error: 'unauthorized' }, 401);
      if (url.pathname === '/me') return json({ email });
      if (url.pathname === '/prospects') return await getProspects(env, url);
      if (url.pathname === '/call-list') return await getCallList(env, url);
      if (url.pathname === '/contact-history') return await getContactHistory(env, url);
      if (url.pathname === '/add-contact' && request.method === 'POST') return await addContact(request, env);
      if (url.pathname === '/log' && request.method === 'POST') return await logOutcome(request, env);
      if (url.pathname === '/undo' && request.method === 'POST') return await undoSave(request, env);
      if (url.pathname === '/confirmees') return await getConfirmees(env, url);
      if (url.pathname === '/confirm-log' && request.method === 'POST') return await confirmLog(request, env);
      if (url.pathname === '/attendance-log' && request.method === 'POST') return await attendanceLog(request, env);
      if (url.pathname === '/walkin' && request.method === 'POST') return await walkinSignup(request, env);
      if (url.pathname === '/today-stats') return await getTodayStats(env, url);
      if (url.pathname === '/event-stats') return await getEventStats(env, url);
      if (url.pathname === '/events-overview') return await getEventsOverview(env);
      if (url.pathname === '/event-roster') return await getEventRoster(env, url);
      if (url.pathname === '/commitments-overview') return await getCommitmentsOverview(env);
      if (url.pathname === '/commitment-conversion') return await getCommitmentConversion(env);
      if (url.pathname === '/training-totals') return await getTrainingTotals(env);
      if (url.pathname === '/recent-activity') return await getRecentActivity(env, url);
      if (url.pathname === '/search') return await searchContacts(env, url);
      if (url.pathname === '/queue-count') return await getQueueCount(env, url);
      if (url.pathname === '/send-zoom-email' && request.method === 'POST') return await sendZoomEmailNow(request, env);
      if (url.pathname === '/feedback' && request.method === 'POST') return await submitFeedback(request, env, email);
      if (url.pathname === '/event-create' && request.method === 'POST') return await createEvent(request, env);
      if (url.pathname === '/events' && request.method === 'GET') return await listEvents(env, url);
      // Note: /event-detail and /event-rsvp are below in the public route block
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  },
  // Cron: pre-event signup-pipeline self-test. Signs up a synthetic user ~36h before
  // each event and emails an alert if the confirmation or the record fails to land.
  async scheduled(event, env, ctx) {
    // Hourly cron: attendance-mirror sync + the EXPORT_KEY drift check. Running
    // the export canary hourly (not just on the daily run) is what turns an
    // EXPORT_KEY outage from a silent multi-hour dead tracker into a <=1-hour
    // emailed alert (the 7/8 incident sat silent because the check was daily-only).
    if (event.cron === '0 * * * *') {
      ctx.waitUntil(syncAttendanceMirror(env).catch(() => {}));
      ctx.waitUntil(runExportCanary(env).catch(() => {}));
      return;
    }
    ctx.waitUntil(runSignupCanary(env).catch(() => {}));
    // Tracker-READ canary: alert if the worker's EXPORT_KEY drifts from the key
    // the Sheets send, which silently 403s every turnout tracker (the 7/8 outage).
    ctx.waitUntil(runExportCanary(env).catch(() => {}));
    // Daily board snapshot -> the master-tracker trend line.
    ctx.waitUntil((async () => {
      try { await env.KV_BINDING.delete('cache:rollup:v2'); const m = await computeRollupMetrics(env); await snapshotBoard(env, m, await boardDonations(env), true); } catch {}
    })());
    // Nightly mirror of campaign signups/attendance into the linked attendance table.
    ctx.waitUntil(syncAttendanceMirror(env).catch(() => {}));
  }
};

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Groundwork-Session',
  };
}
// Honeypot named "website" was rejecting real RSVPs because browser autofill
// fills off-screen "website" fields (Chrome ignores autocomplete="off" on
// heuristic matches). Only treat it as a bot if it contains an actual link —
// the spam-bot signature. Autofill of a name/email/phone passes through; rate
// limiting (on every form) remains the real flood defense.
function honeypotBot(body) {
  const hp = String(body.website || '').trim();
  return !!hp && /https?:\/\/|www\.|<a\b|\[url|href\s*=/i.test(hp);
}

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json', ...cors(), ...extraHeaders }
  });
}
async function at(env, path, options = {}) {
  const res = await fetch(`https://api.airtable.com/v0${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${env.AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json',
    }
  });
  if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`);
  return res.json();
}
function genToken(length = 32) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < length; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
// All "today" timestamps anchored to Central Time so dates match how organizers experience them.
function todayCT() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
}

async function signup(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rlKey = `rl:signup:${ip}`;
  let count = 0;
  try { count = parseInt(await env.KV_BINDING.get(rlKey) || '0'); } catch {}
  if (count >= 5) return json({ error: 'too many requests, try again in 5 min' }, 429, { 'Retry-After': '300' });
  try { await env.KV_BINDING.put(rlKey, String(count + 1), { expirationTtl: 300 }); } catch {}

  const body = await request.json();
  if (honeypotBot(body)) return json({ error: 'bot detected' }, 400);
  const { first, last, email, phone, school, district, county, city, zip, signup_5_26, signup_6_9, recruited_by, source } = body;
  if (!first || !last || (!email && !phone)) {
    return json({ error: 'first name, last name, and email or phone are required' }, 400);
  }
  const cRecruiter = recruited_by ? String(recruited_by).trim() : '';

  const clean = (s) => String(s || '').replace(/^[^\w\s]+/, '').trim();
  const cFirst = clean(first);
  const cLast = clean(last);

  let existingId = null;
  if (email) {
    const e = String(email).toLowerCase().trim();
    const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`LOWER({email})='${e}'`)}&maxRecords=1`);
    if (r.records.length > 0) existingId = r.records[0].id;
  }
  if (!existingId && phone) {
    const digits = String(phone).replace(/\D/g, '').slice(-10);
    if (digits.length === 10) {
      const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`REGEX_REPLACE({phone},'\\\\D','')='${digits}'`)}&maxRecords=1`);
      if (r.records.length > 0) existingId = r.records[0].id;
    }
  }

  const organizerId = deriveOrganizerId({ county, city, zip });
  const today = todayCT();

  let contactId;
  let contactEmail = email ? String(email).toLowerCase().trim() : null;
  let contactFirst = cFirst;
  if (existingId) {
    contactId = existingId;
    const patch = {};
    if (signup_5_26) {
      patch.last_attempt_date = today;
      patch.last_attempt_result = 'Signed up';
    }
    if (signup_6_9) {
      // 6/9 signups don't take over last_attempt_result (which gates the 5/26
      // confirm queue). They get their own denormalized flag.
      patch.signup_6_9_status = 'Signed up';
      if (!signup_5_26) patch.last_attempt_date = today;
    }
    if (cRecruiter) patch.recruited_by = cRecruiter;
    if (Object.keys(patch).length) {
      await at(env, `/${BASE}/${CONTACTS_TBL}/${contactId}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: patch, typecast: true })
      });
    }
  } else {
    const fields = {
      first: cFirst,
      last: cLast,
      leader_ladder: 'Prospect',
      assigned_organizer: [organizerId],
      source: source || 'parents4mopublicschools website signup',
    };
    if (email) fields.email = String(email).toLowerCase().trim();
    if (phone) fields.phone = String(phone).trim();
    if (school) fields.school = String(school).trim();
    if (district) fields.district = String(district).trim();
    // County: prefer supplied; fall back to zip-derived
    const finalCounty = county ? String(county).trim() : zipToCounty(zip);
    if (finalCounty) fields.county = finalCounty;
    if (city) fields.city = String(city).trim();
    if (zip) fields.zip = String(zip).trim();
    if (signup_5_26) {
      fields.last_attempt_date = today;
      fields.last_attempt_result = 'Signed up';
    }
    if (signup_6_9) {
      fields.signup_6_9_status = 'Signed up';
      if (!signup_5_26) fields.last_attempt_date = today;
    }
    if (cRecruiter) fields.recruited_by = cRecruiter;
    const created = await at(env, `/${BASE}/${CONTACTS_TBL}`, {
      method: 'POST',
      body: JSON.stringify({ records: [{ fields }], typecast: true })
    });
    contactId = created.records[0].id;
  }

  if (signup_5_26) {
    await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, {
      method: 'POST',
      body: JSON.stringify({
        records: [{ fields: {
          Summary: `${today} — signup 5/26 via website`,
          date: today,
          method: 'Event attendance',
          result: 'Signed up',
          event: 'Orientation 5/26',
          contact: [contactId],
          notes: `Source: ${source || 'parents4mopublicschools website signup'}`,
        }}],
        typecast: true
      })
    });
    if (AUTO_CONFIRM_EMAIL && contactEmail) {
      await sendConfirmationEmail(env, contactEmail, contactFirst, contactId, null, '5_26');
    }
  }

  if (signup_6_9) {
    await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, {
      method: 'POST',
      body: JSON.stringify({
        records: [{ fields: {
          Summary: `${today} — signup 6/9 via website`,
          date: today,
          method: 'Event attendance',
          result: 'Signed up',
          event: '6/9 Emergency Meeting',
          contact: [contactId],
          notes: `Source: ${source || 'parents4mopublicschools website signup'}`,
        }}],
        typecast: true
      })
    });
    if (AUTO_CONFIRM_EMAIL && contactEmail) {
      await sendConfirmationEmail(env, contactEmail, contactFirst, contactId, null, '6_9');
    }
  }

  await invalidateReadCaches(env);
  return json({ ok: true, contact_id: contactId, message: 'thanks for signing up' });
}

// =========================================================================
// /house-meeting-hosts — list of known hosts for autocomplete on the sign-in form.
// Seeded list + distinct host names from past sign-ins (extracted from log notes).
// Cached 5 minutes in KV.
// =========================================================================
const SEEDED_HOSTS = [
  'Catherine Evans',
  'Ellen Gin',
  'Molly Fleming',
  'LaNeé Bridewell',
  'Stephanie Rittgers',
  'Rachel Hogan',
];

async function houseMeetingHosts(env) {
  const cacheKey = 'cache:house-hosts';
  const cached = await cacheGet(env, cacheKey);
  if (cached) return json(cached);

  const filter = `OR({method}='House meeting',FIND('Host: ',{notes}&'')>0)`;
  const records = [];
  let offset = null;
  do {
    let q = `?filterByFormula=${encodeURIComponent(filter)}&pageSize=100&fields%5B%5D=notes&maxRecords=500`;
    if (offset) q += `&offset=${offset}`;
    try {
      const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
      records.push(...d.records);
      offset = d.offset;
    } catch (e) { offset = null; }
  } while (offset);

  const found = new Set(SEEDED_HOSTS);
  for (const r of records) {
    const notes = r.fields.notes || '';
    const m = notes.match(/Host:\s*([^·\n]+?)(?:\s*·|$)/);
    if (m && m[1]) found.add(m[1].trim());
  }
  const hosts = Array.from(found).sort();
  const payload = { hosts };
  await cachePut(env, cacheKey, payload, 300);
  return json(payload);
}

// =========================================================================
// /house-meeting-signup — public sign-in form for in-person house meetings.
// Dedupes by email/phone. Creates one contact_log row per commitment.
// =========================================================================
async function houseMeetingSignup(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rlKey = `rl:hmsignup:${ip}`;
  const count = parseInt(await env.KV_BINDING.get(rlKey) || '0');
  if (count >= 20) return json({ error: 'too many requests, try again later' }, 429, { 'Retry-After': '300' });
  await env.KV_BINDING.put(rlKey, String(count + 1), { expirationTtl: 300 });

  const body = await request.json();
  if (honeypotBot(body)) return json({ error: 'bot detected' }, 400);
  const { date, host_name, first, last, phone, email, street_address, city, state, zip, district, school, commitments = [], other_text, source } = body;
  if (!first || !last || (!email && !phone) || !date || !host_name) {
    return json({ error: 'first and last name, an email or phone, plus the meeting date and host are required' }, 400);
  }

  const clean = (s) => String(s || '').replace(/^[^\w\s]+/, '').trim();
  const cFirst = clean(first);
  const cLast = clean(last);
  const cEmail = email ? String(email).toLowerCase().trim() : '';
  const cPhone = phone ? String(phone).trim() : '';

  let existingId = null;
  if (cEmail) {
    const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`LOWER({email})='${cEmail}'`)}&maxRecords=1`);
    if (r.records.length > 0) existingId = r.records[0].id;
  }
  if (!existingId && cPhone) {
    const digits = cPhone.replace(/\D/g, '').slice(-10);
    if (digits.length === 10) {
      const r2 = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`REGEX_REPLACE({phone},'\\\\D','')='${digits}'`)}&maxRecords=1`);
      if (r2.records.length > 0) existingId = r2.records[0].id;
    }
  }

  // Organizer assignment via county → city → zip cascade
  const organizerId = deriveOrganizerId({ city, zip, district });

  let contactId;
  const baseFields = {
    first: cFirst,
    last: cLast,
    source: source || 'house meeting sign-in',
  };
  if (cEmail) baseFields.email = cEmail;
  if (cPhone) baseFields.phone = cPhone;
  if (street_address) baseFields.street_address = String(street_address).trim();
  if (city) baseFields.city = String(city).trim();
  if (zip) baseFields.zip = String(zip).trim();
  if (district) baseFields.district = String(district).trim();
  if (school) baseFields.school = String(school).trim();

  // House-meeting denormalized fields (so Kathryn's view is self-contained)
  const hmCommitmentsStr = (commitments || []).filter(c => c && c !== 'Other').join(' · ');
  const hmFields = {
    house_meeting_date: date,
    house_meeting_host: host_name,
  };
  if (hmCommitmentsStr) hmFields.house_meeting_commitments = hmCommitmentsStr;

  if (existingId) {
    contactId = existingId;
    const patch = { ...hmFields };
    if (street_address) patch.street_address = baseFields.street_address;
    if (city) patch.city = baseFields.city;
    if (zip) patch.zip = baseFields.zip;
    if (district) patch.district = baseFields.district;
    if (school) patch.school = baseFields.school;
    try {
      await at(env, `/${BASE}/${CONTACTS_TBL}/${contactId}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: patch, typecast: true })
      });
    } catch (e) { /* hm fields may not exist yet — non-fatal */ }
  } else {
    const fields = {
      ...baseFields,
      ...hmFields,
      leader_ladder: 'Prospect',
      assigned_organizer: [organizerId],
    };
    const created = await at(env, `/${BASE}/${CONTACTS_TBL}`, {
      method: 'POST',
      body: JSON.stringify({ records: [{ fields }], typecast: true })
    });
    contactId = created.records[0].id;
  }

  const logRecords = [];
  logRecords.push({
    fields: {
      Summary: `${date} — house meeting sign-in (host: ${host_name})`,
      date,
      method: 'House meeting',
      result: 'Attended',
      event: `House meeting ${date}`,
      contact: [contactId],
      notes: `Host: ${host_name}${commitments.length ? ` · Commitments: ${commitments.join(', ')}` : ''}${other_text ? ` · Other: ${other_text}` : ''}`,
    }
  });

  for (const c of commitments) {
    if (c === 'Other') continue;
    logRecords.push({
      fields: {
        Summary: `${date} — commitment: ${c}`,
        date,
        method: 'Commitment',
        result: 'Committed',
        event: c,
        contact: [contactId],
        notes: `From house meeting on ${date}, host ${host_name}`,
      }
    });
  }

  for (let i = 0; i < logRecords.length; i += 10) {
    const batch = logRecords.slice(i, i + 10);
    await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, {
      method: 'POST',
      body: JSON.stringify({ records: batch, typecast: true })
    });
  }

  await invalidateReadCaches(env);
  return json({ ok: true, contact_id: contactId, commitments_logged: commitments.length });
}

// =========================================================================
// /amendment5-signup — public post-meeting commitment form.
// Dedupes by email/phone. Routes to LaNeé (KC-metro cities) or Stephanie.
// Date-aware: before 5/27 → counts as 5/26 attendance, after → 6/9.
// Each commitment becomes its own contact_log row (method=Commitment).
// =========================================================================
async function amendment5Signup(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rlKey = `rl:am5signup:${ip}`;
  const count = parseInt(await env.KV_BINDING.get(rlKey) || '0');
  if (count >= 30) return json({ error: 'too many requests, try again later' }, 429, { 'Retry-After': '300' });
  await env.KV_BINDING.put(rlKey, String(count + 1), { expirationTtl: 300 });

  const body = await request.json();
  if (honeypotBot(body)) return json({ error: 'bot detected' }, 400);
  const { first, last, phone, email, street_address, city, state, zip, district, school, commitments = [], other_text, recruited_by, recruited_by_id, source } = body;
  if (!first || !last || (!email && !phone)) {
    return json({ error: 'first and last name, plus an email or phone, are required' }, 400);   // never drop a commit-form signup
  }
  const cRecruiter = recruited_by ? String(recruited_by).trim() : '';

  const clean = (s) => String(s || '').replace(/^[^\w\s]+/, '').trim();
  const cFirst = clean(first);
  const cLast = clean(last);
  const cEmail = email ? String(email).toLowerCase().trim() : '';
  const cPhone = phone ? String(phone).trim() : '';

  // Dedupe by email then phone
  let existingId = null;
  if (cEmail) {
    const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`LOWER({email})='${cEmail}'`)}&maxRecords=1`);
    if (r.records.length > 0) existingId = r.records[0].id;
  }
  if (!existingId && cPhone) {
    const digits = cPhone.replace(/\D/g, '').slice(-10);
    if (digits.length === 10) {
      const r2 = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`REGEX_REPLACE({phone},'\\\\D','')='${digits}'`)}&maxRecords=1`);
      if (r2.records.length > 0) existingId = r2.records[0].id;
    }
  }

  // Organizer assignment via county → city → zip cascade.
  // Override: commitment-form completers in Ellen Glover's counties are hers
  // (Clay, Platte, Buchanan, Clinton — her ask 6/22). Applies to new + existing.
  const derivedCounty = zipToCounty(String(zip || '').trim().slice(0, 5)) || districtToCounty(district) || '';
  const cmtCounty = derivedCounty.toLowerCase();
  const isElleng = !!cmtCounty && ELLENG_COUNTIES.some(x => cmtCounty.includes(x));
  const organizerId = isElleng ? ELLENG_ID : deriveOrganizerId({ city, zip, district });

  // Attribute to the NEXT upcoming onboarding (was hardcoded to the now-past 6/9).
  const today = todayCT();
  const eventKey = nextOnboardingKey(today);
  const eventName = EVENT_META[eventKey].attendEvent;

  // Build contact field updates
  const baseFields = {
    first: cFirst,
    last: cLast,
    source: source || 'amendment 5 commitment form',
  };
  if (cEmail) baseFields.email = cEmail;
  if (cPhone) baseFields.phone = cPhone;
  if (street_address) baseFields.street_address = String(street_address).trim();
  if (city) baseFields.city = String(city).trim();
  if (zip) baseFields.zip = String(zip).trim();
  if (derivedCounty) baseFields.county = derivedCounty;   // store county so turf routing works
  if (district) baseFields.district = String(district).trim();
  if (school) baseFields.school = String(school).trim();
  if (cRecruiter) baseFields.recruited_by = cRecruiter;
  // Amplifier attribution: if the user arrived via ?ref=<contactId>, link them to
  // that amplifier's contact record on `recruited_by` (linked-record field) so
  // recruiter dashboards attribute the signup back to the amplifier.
  if (recruited_by_id && /^rec[A-Za-z0-9]+$/.test(String(recruited_by_id))) {
    baseFields.recruited_by = [String(recruited_by_id)];
    baseFields.source = (baseFields.source || '') + ' · via amplifier link';
  }
  // Mark as signed-up for the appropriate event
  baseFields.last_attempt_date = today;
  if (EVENT_META[eventKey].signupField) baseFields[EVENT_META[eventKey].signupField] = 'Signed up';
  // Denormalize commitments onto the contact so Ellen's call-through view is self-contained
  const commitmentList = (commitments || []).filter(c => c && c !== 'Other');
  if (commitmentList.length > 0 || (other_text && commitments.includes('Other'))) {
    const parts = commitmentList.slice();
    if (other_text && commitments.includes('Other')) parts.push(`Other: ${other_text}`);
    baseFields.amendment5_commitments = parts.join(' · ');
  }
  // Ellen G owns commitment follow-up in her counties — reassign even existing contacts.
  if (isElleng) baseFields.assigned_organizer = [ELLENG_ID];

  let contactId;
  if (existingId) {
    contactId = existingId;
    try {
      await at(env, `/${BASE}/${CONTACTS_TBL}/${contactId}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: baseFields, typecast: true })
      });
    } catch (e) { /* non-fatal — continue with log creation */ }
  } else {
    const fields = { ...baseFields, leader_ladder: 'Prospect', assigned_organizer: [organizerId] };
    const created = await at(env, `/${BASE}/${CONTACTS_TBL}`, {
      method: 'POST',
      body: JSON.stringify({ records: [{ fields }], typecast: true })
    });
    contactId = created.records[0].id;
  }

  // Create the meeting-attendance log
  const logRecords = [{
    fields: {
      Summary: `${today} — Amendment 5 commitment (${eventName})`,
      date: today,
      method: 'Event attendance',
      result: 'Signed up',
      event: eventName,
      contact: [contactId],
      notes: `Amendment 5 commitment form${commitments.length ? ` · Commitments: ${commitments.join(', ')}` : ''}${other_text ? ` · Other: ${other_text}` : ''}`,
    }
  }];

  // One commitment-log row per checked commitment
  for (const c of commitments) {
    if (c === 'Other') continue;
    logRecords.push({
      fields: {
        Summary: `${today} — commitment: ${c}`,
        date: today,
        method: 'Commitment',
        result: 'Committed',
        event: c,
        contact: [contactId],
        notes: `From Amendment 5 commitment form (${eventName})`,
      }
    });
  }

  // Batch in 10s for Airtable
  for (let i = 0; i < logRecords.length; i += 10) {
    const batch = logRecords.slice(i, i + 10);
    await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, {
      method: 'POST',
      body: JSON.stringify({ records: batch, typecast: true })
    });
  }

  // Commit-form completers are marked signed up for the onboarding, so they must
  // get the Zoom-link confirmation too (audit fix 6/23 — was sending nothing).
  let confirmation_email_sent = false;
  if (cEmail && AUTO_CONFIRM_EMAIL) {
    try { await sendConfirmationEmail(env, cEmail, cFirst, contactId, isElleng ? 'ellen glover' : null, eventKey); confirmation_email_sent = true; } catch (e) {}
  }
  await invalidateReadCaches(env);
  await mirrorWriteThrough(env, contactId, eventName, 'Registered');
  return json({ ok: true, contact_id: contactId, commitments_logged: commitments.length, event: eventName, confirmation_email_sent });
}

// =========================================================================
// /training-signup — public training-signup form (parents4mopublicschools.org/trainings/).
// Accepts: first, last, email, phone, zip, events[] (array of event labels like
// "Amplifier Training 6/11"), source.
// Dedupes by email then phone. Routes via existing county→city→zip cascade.
// Writes one contact_log row per training (method=Event attendance, result=Signed up)
// plus updates a multi-select `events_signed_up` on the contact (auto-creates options
// via typecast=true).
// =========================================================================
async function trainingSignup(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rlKey = `rl:trainsignup:${ip}`;
  let count = 0;
  try { count = parseInt(await env.KV_BINDING.get(rlKey) || '0'); } catch {}
  if (count >= 30) return json({ error: 'too many requests, try again later' }, 429, { 'Retry-After': '300' });
  try { await env.KV_BINDING.put(rlKey, String(count + 1), { expirationTtl: 300 }); } catch {}

  const body = await request.json();
  if (honeypotBot(body)) return json({ error: 'bot detected' }, 400);
  const { first, last, phone, email, zip, events = [], recruited_by, source } = body;
  // Never drop a signup over a missing zip or phone (incident 6/23): require only a
  // name and one way to reach them. zip just sharpens organizer routing.
  if (!first || !last || (!email && !phone)) {
    return json({ error: 'first and last name, plus an email or phone, are required' }, 400);
  }
  const cRecruiter = recruited_by ? String(recruited_by).trim() : '';
  if (!Array.isArray(events) || events.length === 0) {
    return json({ error: 'pick at least one training' }, 400);
  }

  const clean = (s) => String(s || '').replace(/^[^\w\s]+/, '').trim();
  const cFirst = clean(first);
  const cLast = clean(last);
  const cEmail = email ? String(email).toLowerCase().trim() : '';
  const cPhone = phone ? String(phone).trim() : '';
  const cZip = zip ? String(zip).trim() : '';

  // Dedupe by email then phone
  let existingId = null;
  if (cEmail) {
    const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`LOWER({email})='${cEmail}'`)}&maxRecords=1`);
    if (r.records.length > 0) existingId = r.records[0].id;
  }
  if (!existingId && cPhone) {
    const digits = cPhone.replace(/\D/g, '').slice(-10);
    if (digits.length === 10) {
      const r2 = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`REGEX_REPLACE({phone},'\\\\D','')='${digits}'`)}&maxRecords=1`);
      if (r2.records.length > 0) existingId = r2.records[0].id;
    }
  }

  // Organizer assignment via existing cascade
  const organizerId = deriveOrganizerId({ zip: cZip, district: body.district });

  const today = todayCT();

  // Pull existing events_signed_up so we can merge (multi-select on Airtable)
  let existingEvents = [];
  if (existingId) {
    try {
      const cur = await at(env, `/${BASE}/${CONTACTS_TBL}/${existingId}`);
      const v = cur.fields && cur.fields.events_signed_up;
      if (Array.isArray(v)) existingEvents = v;
      else if (typeof v === 'string' && v) existingEvents = v.split(',').map(s => s.trim()).filter(Boolean);
    } catch {}
  }
  const mergedEvents = Array.from(new Set([...existingEvents, ...events]));

  // Build contact field updates
  const baseFields = {
    first: cFirst,
    last: cLast,
    source: source || 'training signup',
    last_attempt_date: today,
    events_signed_up: mergedEvents,
  };
  if (cEmail) baseFields.email = cEmail;
  if (cPhone) baseFields.phone = cPhone;
  if (cZip) { baseFields.zip = cZip; const _c = zipToCounty(String(cZip).slice(0, 5)); if (_c) baseFields.county = _c; }   // derive county so turf routing works (was missing on this path)
  if (!baseFields.county) { const _dc = districtToCounty(body.district); if (_dc) baseFields.county = _dc; }   // no zip? district still places them in a county
  if (body.district) baseFields.district = String(body.district).trim();   // persist the district/town the form collected (was only used for routing) so per-event rosters show it
  if (body.school) baseFields.school = String(body.school).trim();   // per-event roster shows school alongside district
  // NB: recruited_by is a linked-record field on contacts (the recruitment-substrate
  // graph). Writing a plain name string makes the create 422 and loses the whole
  // signup, so we keep "Recruited by: …" in the log notes only (same as /launch-rsvp).
  // If the user signed up for the 6/9 Emergency Meeting through this form,
  // also flip signup_6_9_status so they appear in the 6/9 Event Tracking tab
  // (mirrors the homepage /signup flow).
  if (events.some(e => /6\/9 Emergency Meeting/i.test(e))) {
    baseFields.signup_6_9_status = 'Signed up';
  }
  // Map every selected training to its per-event signup field so it shows in
  // Event tracking + stats (the log row alone is invisible to those).
  for (const evName of events) {
    const metaKey = Object.keys(EVENT_META).find(k =>
      EVENT_META[k].attendEvent.toLowerCase() === String(evName).toLowerCase() ||   // case-insensitive: form sends "...onboarding", meta has "...Onboarding"
      (k === 'kyn_7_25' && /neighbor.*7\/25/i.test(evName)));
    if (metaKey && EVENT_META[metaKey].signupField) {
      baseFields[EVENT_META[metaKey].signupField] = 'Signed up';
    }
  }

  let contactId;
  if (existingId) {
    contactId = existingId;
    try {
      await at(env, `/${BASE}/${CONTACTS_TBL}/${contactId}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: baseFields, typecast: true })
      });
    } catch (e) { /* non-fatal — continue with log creation */ }
  } else {
    try {
      const fields = { ...baseFields, leader_ladder: 'Prospect', assigned_organizer: [organizerId] };
      const created = await at(env, `/${BASE}/${CONTACTS_TBL}`, {
        method: 'POST',
        body: JSON.stringify({ records: [{ fields }], typecast: true })
      });
      contactId = created.records[0].id;
    } catch (e) {
      // Last-resort retry with only essential fields so a bad optional value can
      // never lose the signup (mirrors /launch-rsvp).
      const minFields = { first: cFirst, last: cLast, source: baseFields.source, events_signed_up: mergedEvents, leader_ladder: 'Prospect' };
      if (cEmail) minFields.email = cEmail;
      if (cPhone) minFields.phone = cPhone;
      const created = await at(env, `/${BASE}/${CONTACTS_TBL}`, {
        method: 'POST',
        body: JSON.stringify({ records: [{ fields: minFields }], typecast: true })
      });
      contactId = created.records[0].id;
    }
  }

  // One contact_log row per training selected. Recruiter name lives here (not in
  // the linked recruited_by field) so a free-text name can't fail the signup.
  const logRecords = events.map(evName => ({
    fields: {
      Summary: `${today} — training signup: ${evName}`,
      date: today,
      method: 'Event attendance',
      result: 'Signed up',
      event: evName,
      contact: [contactId],
      notes: [source ? `Source: ${source}` : 'Training signup form', cRecruiter ? `Recruited by: ${cRecruiter}` : ''].filter(Boolean).join(' | '),
    }
  }));

  // Airtable allows max 10 records per POST
  for (let i = 0; i < logRecords.length; i += 10) {
    const chunk = logRecords.slice(i, i + 10);
    try {
      await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, {
        method: 'POST',
        body: JSON.stringify({ records: chunk, typecast: true })
      });
    } catch (e) { /* non-fatal — contact is still created */ }
  }

  // Send the Zoom-link confirmation for each event signed up for. This was missing
  // entirely, so onboarding RSVPs were created but never got a link (incident 6/23).
  let confirmation_email_sent = false;
  if (cEmail && AUTO_CONFIRM_EMAIL) {
    const keys = new Set();
    for (const evName of events) {
      const k = Object.keys(EVENT_META).find(kk => EVENT_META[kk].attendEvent.toLowerCase() === String(evName).toLowerCase() || (kk === 'kyn_7_25' && /neighbor.*7\/25/i.test(evName)));
      if (k) keys.add(k);
    }
    for (const k of keys) { try { await sendConfirmationEmail(env, cEmail, cFirst, contactId, null, k); confirmation_email_sent = true; } catch (e) {} }
  }
  await invalidateReadCaches(env);
  for (const evName of events) { await mirrorWriteThrough(env, contactId, String(evName), 'Registered'); }
  return json({ ok: true, contact_id: contactId, events_logged: events.length, events, confirmation_email_sent });
}

// =========================================================================
// /launch-rsvp — public regional-launch RSVP (parents4mopublicschools.org/launches/...).
// Built to NEVER drop a signup: requires only a name + one way to reach them
// (email OR phone). New people are created, not rejected. A possible duplicate
// is preferable to a lost RSVP. All logistics (childcare, pizza, connection,
// accessibility, free-text) are written into the contact_log notes so they show
// in the launch's grid view immediately.
// Body: { first, last, phone, email, zip, street_address, city, district, school,
//   connection[], childcare(bool), childcare_kids, pizza(bool), accessibility,
//   anything_else, recruited_by, launch, source, website(honeypot) }
// =========================================================================
// Clean, groupable label for any regional launch RSVP, derived from whatever
// the form posts. "Northland Emergency Meeting on Public School Funding 6/18"
// -> "Northland Emergency Meeting 6/18". Region (before "Emergency Meeting")
// + the trailing M/D. Keeps "Emergency Meeting" in the name (Ellen's rename).
function normalizeLaunch(launch) {
  const s = String(launch || '').trim();
  const m = s.match(/^(.*?)\s+Emergency Meeting\b.*?(\d{1,2}\/\d{1,2})?\s*$/i);
  if (m && m[1]) {
    const region = m[1].trim();
    const date = m[2] ? ' ' + m[2] : '';
    return `${region} Emergency Meeting${date}`;
  }
  return s;
}

// Public self check-in at the door (parents4mopublicschools.org/checkin/...).
// One QR for everyone: registered folks check themselves off, walk-ins get
// created on the spot, and attendance flows straight to the events dashboard.
async function eventCheckin(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rlKey = `rl:checkin:${ip}`;
  let count = 0;
  try { count = parseInt(await env.KV_BINDING.get(rlKey) || '0'); } catch {}
  if (count >= 80) return json({ error: 'too many requests, try again later' }, 429, { 'Retry-After': '300' });
  try { await env.KV_BINDING.put(rlKey, String(count + 1), { expirationTtl: 300 }); } catch {}

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'bad request' }, 400);
  if (honeypotBot(body)) return json({ error: 'bot detected' }, 400);

  const clean = (s) => String(s || '').replace(/^[^\w\s]+/, '').trim();
  const cFirst = clean(body.first);
  const cLast = clean(body.last);
  const cEmail = body.email ? String(body.email).toLowerCase().trim() : '';
  const cPhone = body.phone ? String(body.phone).trim() : '';
  const cSchool = clean(body.school);
  const cDistrict = clean(body.district);
  const cRecruiter = body.recruited_by ? String(body.recruited_by).trim() : '';   // free-text "who invited you" — stored in the log notes, never the linked recruited_by field (a plain name 422s the create)
  const event = clean(body.event);
  const pickedId = /^rec[A-Za-z0-9]{14,}$/.test(clean(body.contact_id)) ? clean(body.contact_id) : null;
  if (!event) return json({ error: 'missing event' }, 400);
  if (!pickedId) {
    if (!cFirst || !cLast) return json({ error: 'first and last name are required' }, 400);
    if (!cEmail && !cPhone) return json({ error: 'please give an email or a phone number' }, 400);
  }
  const today = todayCT();

  // Resolve the contact: a registrant picked from the name search, else match by
  // email/phone, else create a walk-in.
  let cid = pickedId;
  let walkIn = false;
  if (!cid) {
    try {
      if (cEmail) {
        const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`LOWER({email})='${cEmail}'`)}&maxRecords=1`);
        if (r.records.length) cid = r.records[0].id;
      }
      if (!cid && cPhone) {
        const digits = cPhone.replace(/\D/g, '').slice(-10);
        if (digits.length === 10) {
          const r2 = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`REGEX_REPLACE({phone},'\\\\D','')='${digits}'`)}&maxRecords=1`);
          if (r2.records.length) cid = r2.records[0].id;
        }
      }
    } catch (e) { /* fall through and create */ }
    walkIn = !cid;
    if (!cid) {
      try {
        const fields = { first: cFirst, last: cLast, leader_ladder: 'Prospect', source: `checked in at ${event}`, events_signed_up: [event] };
        if (cEmail) fields.email = cEmail;
        if (cPhone) fields.phone = cPhone;
        if (cSchool) fields.school = cSchool;
        if (cDistrict) fields.district = cDistrict;
        const created = await at(env, `/${BASE}/${CONTACTS_TBL}`, { method: 'POST', body: JSON.stringify({ records: [{ fields }], typecast: true }) });
        cid = created.records[0].id;
      } catch (e) {
        return json({ error: 'could not check you in, please see a volunteer' }, 500);
      }
    }
  }

  // Idempotent: one attendance row per person per event (handles double-scans).
  let already = false;
  try {
    const evEsc = event.replace(/'/g, "\\'");
    const q = `?filterByFormula=${encodeURIComponent(`AND({method}='Event attendance',OR({rsvp_launch}='${evEsc}',{event}='${evEsc}'))`)}&pageSize=100&fields%5B%5D=contact`;
    const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
    already = (d.records || []).some(r => (r.fields.contact || []).includes(cid));
  } catch (e) {}

  if (!already) {
    try {
      await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, { method: 'POST', body: JSON.stringify({ records: [{ fields: {
        Summary: `${today} — Checked in: ${event} (${cFirst} ${cLast})`,
        date: today, method: 'Event attendance', result: 'Attended', rsvp_launch: event, contact: [cid],
        notes: [walkIn ? 'Self check-in at the door (walk-in)' : 'Self check-in at the door', cRecruiter ? `Recruited by: ${cRecruiter}` : ''].filter(Boolean).join(' | '),
      }}], typecast: true }) });
    } catch (e) {
      return json({ error: 'could not check you in, please see a volunteer' }, 500);
    }
  }
  await env.KV_BINDING.delete('cache:events-overview:v8').catch(() => null);
  await mirrorWriteThrough(env, cid, event, 'Showed up');
  return json({ ok: true, checked_in: true, already, walk_in: walkIn, name: cFirst });
}

// Public name search for the check-in page: type a couple letters, get matching
// registrants to pick from. Returns names + record ids only (no emails/phones) —
// a paper sign-in sheet made digital. Cached per event so keystrokes are cheap.
async function eventRosterPublic(env, urlObj) {
  const event = (urlObj.searchParams.get('event') || '').trim();
  const q = (urlObj.searchParams.get('q') || '').trim().toLowerCase();
  if (!event || q.length < 2) return json({ matches: [] });
  const ckey = 'cache:roster:' + event;
  let roster = await cacheGet(env, ckey);
  if (!roster) { roster = await buildEventRoster(env, event); await cachePut(env, ckey, roster, 120); }
  const matches = roster.filter(p => p.name.toLowerCase().includes(q)).slice(0, 25);
  return json({ matches });
}

async function buildEventRoster(env, event) {
  const evEsc = event.replace(/'/g, "\\'");
  const ids = []; const seen = new Set(); let off = null;
  do {
    let q = `?filterByFormula=${encodeURIComponent(`AND({method}='Event RSVP',OR({rsvp_launch}='${evEsc}',{event}='${evEsc}'))`)}&pageSize=100&fields%5B%5D=contact`;
    if (off) q += `&offset=${encodeURIComponent(off)}`;
    const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
    for (const r of d.records) { const c = (r.fields.contact || [])[0]; if (c && !seen.has(c)) { seen.add(c); ids.push(c); } }
    off = d.offset;
  } while (off);
  const out = [];
  for (let i = 0; i < ids.length; i += 40) {
    const chunk = ids.slice(i, i + 40);
    const f = `OR(${chunk.map(id => `RECORD_ID()='${id}'`).join(',')})`;
    const d = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(f)}&pageSize=100&fields%5B%5D=first&fields%5B%5D=last`);
    for (const r of d.records) { const nm = `${r.fields.first || ''} ${r.fields.last || ''}`.trim(); if (nm) out.push({ id: r.id, name: nm }); }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}


// =========================================================================
// /ingest/s2w — Scale to Win daily import (TMC posts yesterday's leads from
// the Organizing Lab BQ export). Token-gated (S2W_INGEST_KEY secret). Accepts
// {leads:[...]} or a single lead object; tolerant of extra fields. Dedupe by
// email then phone (same rules as every intake); geo-routes new contacts via
// zip/city; logs one contact_log row per lead with outcome + transcript link.
// Idempotent: re-posting the same batch matches existing contacts and skips
// duplicate log rows via s2w de-dupe note key.
// =========================================================================
async function ingestS2W(request, env) {
  const key = request.headers.get('X-Ingest-Key') || '';
  if (!env.S2W_INGEST_KEY || key !== env.S2W_INGEST_KEY) return json({ error: 'forbidden' }, 403);
  let body = null;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const leads = Array.isArray(body) ? body : Array.isArray(body.leads) ? body.leads : [body];
  if (!leads.length) return json({ ok: true, created: 0, matched: 0, skipped: 0 });
  if (leads.length > 500) return json({ error: 'max 500 leads per request' }, 400);
  const clean = s => String(s == null ? '' : s).trim();
  let created = 0, matched = 0, skipped = 0; const errors = [];
  for (const lead of leads) {
    try {
      const first = clean(lead.first || lead.first_name), last = clean(lead.last || lead.last_name);
      const email = clean(lead.email).toLowerCase();
      const phone = clean(lead.phone || lead.phone_number).replace(/\D/g, '').slice(-10);
      if (!first && !last && !email && !phone) { skipped++; continue; }
      if (!email && !phone) { skipped++; errors.push(`no email/phone: ${first} ${last}`); continue; }
      // dedupe: email, then phone
      let cid = null;
      if (email) {
        const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`LOWER({email})='${email.replace(/'/g, "\\'")}'`)}&maxRecords=1`);
        if (r.records.length) cid = r.records[0].id;
      }
      if (!cid && phone.length === 10) {
        const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`REGEX_REPLACE({phone},'\\\\D','')='${phone}'`)}&maxRecords=1`);
        if (r.records.length) cid = r.records[0].id;
      }
      const s2wId = clean(lead.s2w_id || lead.s2w_contact_id || lead.contact_id);
      const srcBits = ['scale to win'];
      if (clean(lead.source || lead.campaign)) srcBits.push(clean(lead.source || lead.campaign));
      if (s2wId) srcBits.push(`s2w:${s2wId}`);
      const outcome = clean(lead.outcome || lead.result || lead.disposition);
      const transcript = clean(lead.transcript_url || lead.transcript);
      const tags = (Array.isArray(lead.tags) ? lead.tags : String(lead.tags || '').split(','))
        .map(x => String(x || '').trim()).filter(Boolean);
      if (cid) {
        matched++;
        // keep the latest S2W outcome/transcript visible on the contact row
        const stamp = {};
        if (outcome) stamp.s2w_outcome = outcome;
        if (transcript) stamp.s2w_transcript = transcript;
        if (clean(lead.transcript_text || lead.conversation)) stamp.s2w_conversation = clean(lead.transcript_text || lead.conversation).slice(0, 90000);
        if (Object.keys(stamp).length) {
          try { await at(env, `/${BASE}/${CONTACTS_TBL}/${cid}`, { method: 'PATCH', body: JSON.stringify({ fields: stamp, typecast: true }) }); } catch (e) {}
        }
      } else {
        const zip = clean(lead.zip).slice(0, 5);
        const city = clean(lead.city);
        const county = zipToCounty(zip) || '';
        const fields = { first, last, leader_ladder: 'Prospect', source: srcBits.join(' · ') };
        if (email) fields.email = email;
        if (phone) fields.phone = phone;
        if (clean(lead.street || lead.street_address)) fields.street_address = clean(lead.street || lead.street_address);
        if (city) fields.city = city;
        if (zip) fields.zip = zip;
        if (county) fields.county = county;
        const orgId = deriveOrganizerId({ county, city, zip }) || LANEE_ID;   // S2W O2O is LaNee's program; default un-geocodable leads to her
        fields.assigned_organizer = [orgId];
        if (outcome) fields.s2w_outcome = outcome;
        if (transcript) fields.s2w_transcript = transcript;
        if (clean(lead.transcript_text || lead.conversation)) fields.s2w_conversation = clean(lead.transcript_text || lead.conversation).slice(0, 90000);
        const c = await at(env, `/${BASE}/${CONTACTS_TBL}`, { method: 'POST', body: JSON.stringify({ records: [{ fields }], typecast: true }) });
        cid = c.records[0].id; created++;
      }
      // one log row per (contact, s2w batch item) — skip if an identical S2W note already exists
      const transcriptText = clean(lead.transcript_text || lead.conversation);
      const noteKey = `S2W import${s2wId ? ` ${s2wId}` : ''}${outcome ? ` · ${outcome}` : ''}`;
      // NB: linked-record fields render as NAMES in formulas, so the contact-id
      // check must happen in code (API field values are record ids).
      const dupQ = await at(env, `/${BASE}/${CONTACT_LOG_TBL}?filterByFormula=${encodeURIComponent(`FIND('${noteKey.replace(/'/g, "\\'")}',{notes}&'')>0`)}&pageSize=100&fields%5B%5D=contact`);
      const dupHit = (dupQ.records || []).some(r => (r.fields.contact || []).includes(cid));
      if (!dupHit) {
        await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, { method: 'POST', body: JSON.stringify({ records: [{ fields: {
          Summary: `${todayCT()} — S2W: ${first} ${last}${outcome ? ` (${outcome})` : ''}`,
          date: todayCT(), method: 'Text', result: outcome || 'S2W lead',
          notes: noteKey + (tags.length ? ` | tags: ${tags.join(', ')}` : '') + (transcript ? ` | transcript: ${transcript}` : '') + (transcriptText ? `\n\n--- conversation ---\n${transcriptText.slice(0, 90000)}` : ''),
          contact: [cid],
        } }], typecast: true }) });
      }
      // Tag -> action mapping (kept on OUR side so STW/TMC never change).
      // 'wants-onboarding' = auto-register for the next Tuesday onboarding:
      // signup field + events list + confirmation email w/ Zoom link + mirror row.
      // Add more tags here as the team defines them.
      for (const tag of tags) {
        if (tag.toLowerCase() !== 'wants-onboarding') continue;
        try {
          const evKey = nextOnboardingKey(todayCT());
          const meta = EVENT_META[evKey];
          if (!meta || !meta.signupField) break;
          const cur = await at(env, `/${BASE}/${CONTACTS_TBL}/${cid}`);
          if (cur.fields[meta.signupField] === 'Signed up') break;   // already registered — don't re-email
          let evs = cur.fields.events_signed_up || [];
          if (!evs.includes(meta.attendEvent)) evs = evs.concat([meta.attendEvent]);
          await at(env, `/${BASE}/${CONTACTS_TBL}/${cid}`, { method: 'PATCH', body: JSON.stringify({ fields: { [meta.signupField]: 'Signed up', events_signed_up: evs }, typecast: true }) });
          await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, { method: 'POST', body: JSON.stringify({ records: [{ fields: {
            Summary: `${todayCT()} — S2W tag signup: ${meta.attendEvent} (${first} ${last})`,
            date: todayCT(), method: 'Event attendance', result: 'Signed up', event: meta.attendEvent,
            notes: `registered via S2W tag wants-onboarding`, contact: [cid],
          } }], typecast: true }) });
          if (email) { try { await sendConfirmationEmail(env, email, first, cid, null, evKey); } catch (e) {} }
          await mirrorWriteThrough(env, cid, meta.attendEvent, 'Registered');
        } catch (e) { errors.push('tag action: ' + String(e.message || e).slice(0, 100)); }
      }
    } catch (e) { errors.push(String(e.message || e).slice(0, 120)); }
  }
  await invalidateReadCaches(env);
  return json({ ok: true, received: leads.length, created, matched, skipped, errors: errors.slice(0, 10) });
}

async function launchRsvp(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rlKey = `rl:launchrsvp:${ip}`;
  let count = 0;
  try { count = parseInt(await env.KV_BINDING.get(rlKey) || '0'); } catch {}
  if (count >= 30) return json({ error: 'too many requests, try again later' }, 429, { 'Retry-After': '300' });
  try { await env.KV_BINDING.put(rlKey, String(count + 1), { expirationTtl: 300 }); } catch {}

  const body = await request.json();
  if (honeypotBot(body)) return json({ error: 'bot detected' }, 400);

  const clean = (s) => String(s || '').replace(/^[^\w\s]+/, '').trim();
  const cFirst = clean(body.first);
  const cLast = clean(body.last);
  const cEmail = body.email ? String(body.email).toLowerCase().trim() : '';
  const cPhone = body.phone ? String(body.phone).trim() : '';
  // Minimal gate only: a name + at least one way to reach them. Everything else optional
  // so we never reject (and never lose) a real signup.
  if (!cFirst || !cLast) return json({ error: 'first and last name are required' }, 400);
  if (!cEmail && !cPhone) return json({ error: 'please give an email or a phone number' }, 400);

  const launch = clean(body.launch) || 'Northland Emergency Meeting 6/18';
  const cZip = body.zip ? String(body.zip).trim() : '';
  const connection = Array.isArray(body.connection) ? body.connection.filter(Boolean) : (body.connection ? [String(body.connection)] : []);
  const today = todayCT();

  // Dedupe by email then phone — but ALWAYS proceed (create) if no match.
  let existingId = null;
  try {
    if (cEmail) {
      const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`LOWER({email})='${cEmail}'`)}&maxRecords=1`);
      if (r.records.length > 0) existingId = r.records[0].id;
    }
    if (!existingId && cPhone) {
      const digits = cPhone.replace(/\D/g, '').slice(-10);
      if (digits.length === 10) {
        const r2 = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`REGEX_REPLACE({phone},'\\\\D','')='${digits}'`)}&maxRecords=1`);
        if (r2.records.length > 0) existingId = r2.records[0].id;
      }
    }
  } catch (e) { /* lookup failed — fall through and create, never block the signup */ }

  // Merge events_signed_up so the launch shows in the contact grid view too.
  let existingEvents = [];
  if (existingId) {
    try {
      const cur = await at(env, `/${BASE}/${CONTACTS_TBL}/${existingId}`);
      const v = cur.fields && cur.fields.events_signed_up;
      if (Array.isArray(v)) existingEvents = v;
      else if (typeof v === 'string' && v) existingEvents = v.split(',').map(s => s.trim()).filter(Boolean);
    } catch {}
  }
  const mergedEvents = Array.from(new Set([...existingEvents, launch]));

  const baseFields = {
    first: cFirst, last: cLast,
    source: body.source || `launch rsvp · ${launch}`,
    last_attempt_date: today,
    events_signed_up: mergedEvents,
  };
  if (cEmail) baseFields.email = cEmail;
  if (cPhone) baseFields.phone = cPhone;
  if (cZip) baseFields.zip = cZip;
  { const _c = zipToCounty(String(cZip||'').slice(0,5)) || districtToCounty(body.district); if (_c) baseFields.county = _c; }
  if (clean(body.street_address)) baseFields.street_address = clean(body.street_address);
  if (clean(body.city)) baseFields.city = clean(body.city);
  if (clean(body.district)) baseFields.district = clean(body.district);
  if (clean(body.school)) baseFields.school = clean(body.school);
  // NB: recruited_by is a linked-record field on contacts — writing a plain name
  // string makes the create fail, so we keep "Recruited by: …" in the log notes only.
  if (connection.length) baseFields.role = connection.join(', ');

  const organizerId = deriveOrganizerId({ city: clean(body.city), zip: cZip, district: clean(body.district) });

  let contactId = null;
  let createdNew = false;
  if (existingId) {
    contactId = existingId;
    try {
      await at(env, `/${BASE}/${CONTACTS_TBL}/${contactId}`, {
        method: 'PATCH', body: JSON.stringify({ fields: baseFields, typecast: true }),
      });
    } catch (e) { /* non-fatal — still log the RSVP below */ }
  } else {
    try {
      const fields = { ...baseFields, leader_ladder: 'Prospect', assigned_organizer: [organizerId] };
      const created = await at(env, `/${BASE}/${CONTACTS_TBL}`, {
        method: 'POST', body: JSON.stringify({ records: [{ fields }], typecast: true }),
      });
      contactId = created.records[0].id;
      createdNew = true;
    } catch (e) {
      // Last-resort retry with only the essential fields, so a bad optional value
      // (e.g. a select option that doesn't exist) can never lose the signup.
      try {
        const minFields = { first: cFirst, last: cLast, source: baseFields.source, events_signed_up: mergedEvents };
        if (cEmail) minFields.email = cEmail;
        if (cPhone) minFields.phone = cPhone;
        const created = await at(env, `/${BASE}/${CONTACTS_TBL}`, {
          method: 'POST', body: JSON.stringify({ records: [{ fields: minFields }], typecast: true }),
        });
        contactId = created.records[0].id;
        createdNew = true;
      } catch (e2) {
        return json({ error: 'could not save — please try again or email info@parents4mopublicschools.org' }, 500);
      }
    }
  }

  // Build a readable logistics blob for the grid's notes column.
  const yn = (v) => v === true || v === 'true' || v === 'yes' || v === 'Yes' ? 'Yes' : (v === false || v === 'false' || v === 'no' || v === 'No' ? 'No' : '');
  const parts = [];
  if (connection.length) parts.push(`Connection: ${connection.join(', ')}`);
  const cc = yn(body.childcare);
  if (cc) parts.push(`Childcare: ${cc}${clean(body.childcare_kids) ? ` (${clean(body.childcare_kids)})` : ''}`);
  const pz = yn(body.pizza);
  if (pz) parts.push(`Pizza 5:30: ${pz}`);
  if (clean(body.accessibility)) parts.push(`Accessibility: ${clean(body.accessibility)}`);
  if (clean(body.recruited_by)) parts.push(`Recruited by: ${clean(body.recruited_by)}`);
  if (clean(body.anything_else)) parts.push(`Notes: ${clean(body.anything_else)}`);
  const notes = parts.join(' | ') || 'Launch RSVP';

  // Structured RSVP fields so Airtable can COUNT them (radio answers arrive
  // structured; storing them only in `notes` made them uncountable).
  // rsvp_launch is normalized so all variants of a launch group as one.
  const rsvpLaunch = normalizeLaunch(launch);
  // Dedupe: if this person already RSVP'd to this launch, UPDATE that row
  // instead of adding a second (keeps catering counts accurate).
  let existingRsvpId = null;
  try {
    const dq = `?filterByFormula=${encodeURIComponent(`AND({rsvp_launch}='${rsvpLaunch}',{method}='Event RSVP')`)}&pageSize=100&fields%5B%5D=contact`;
    const dres = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${dq}`);
    const m = (dres.records || []).find(r => (r.fields.contact || []).includes(contactId));
    if (m) existingRsvpId = m.id;
  } catch (e) {}
  try {
    const rsvpFields = {
        Summary: `${today} — RSVP: ${launch} (${cFirst} ${cLast})`,
        date: today,
        method: 'Event RSVP',
        result: 'Signed up',
        event: launch,
        contact: [contactId],
        notes,
        rsvp_launch: rsvpLaunch,
        rsvp_pizza: pz || 'No',
        rsvp_childcare: cc || 'No',
        ...(clean(body.childcare_kids) ? { rsvp_childcare_kids: clean(body.childcare_kids) } : {}),
        ...(clean(body.accessibility) ? { rsvp_accessibility: clean(body.accessibility) } : {}),
        ...(clean(body.anything_else) ? { rsvp_other_needs: clean(body.anything_else) } : {}),
    };
    if (existingRsvpId) {
      await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, {
        method: 'PATCH',
        body: JSON.stringify({ records: [{ id: existingRsvpId, fields: rsvpFields }], typecast: true }),
      });
    } else {
      await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, {
        method: 'POST',
        body: JSON.stringify({ records: [{ fields: rsvpFields }], typecast: true }),
      });
    }
  } catch (e) { /* non-fatal — contact + events_signed_up already capture the RSVP */ }

  let confirmation_email_sent = false;
  try { if (cEmail) confirmation_email_sent = await sendLaunchConfirmation(env, cEmail, cFirst, launch); } catch (e) {}
  await invalidateReadCaches(env);

  // Fire webhooks (fanout to registered tracker sheets) so they update in real
  // time instead of polling. Any failure is logged and swallowed — the RSVP is
  // already durably stored in Airtable, and the safety-net poll will backfill.
  try {
    await fireWebhooks(env, rsvpLaunch, {
      event: rsvpLaunch,
      first: cFirst, last: cLast, email: cEmail, phone: cPhone,
      role: (clean(body.role) || ''),
      school: (clean(body.school) || ''),
      district: (clean(body.district) || ''),
      notes: (typeof notes === 'string' ? notes : ''),
      rsvp_pizza: pz || 'No', rsvp_childcare: cc || 'No',
      childcare_kids: clean(body.childcare_kids) || '',
      accessibility: clean(body.accessibility) || '',
      created_new: !!createdNew,
      ts: Date.now(),
    });
  } catch (e) { /* non-fatal */ }

  await mirrorWriteThrough(env, contactId, rsvpLaunch, 'Registered');
  return json({ ok: true, contact_id: contactId, created_new: createdNew, launch, confirmation_email_sent });
}

// =========================================================================
// Webhook fanout — tracker sheets register their Apps-Script Web App URL and
// get a POST for every new/updated RSVP for their event. Zero-polling → no
// UrlFetch quota, near-real-time updates, robust to Google Sheets rate limits.
// KV layout: `webhook:{event}` → JSON array of URLs (strings).
// =========================================================================
async function loadWebhooks(env, event) {
  try {
    const s = await env.KV_BINDING.get(`webhook:${event}`);
    if (!s) return [];
    const arr = JSON.parse(s);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
async function saveWebhooks(env, event, urls) {
  const dedup = Array.from(new Set(urls.filter(u => typeof u === 'string' && u.startsWith('http'))));
  if (dedup.length === 0) await env.KV_BINDING.delete(`webhook:${event}`);
  else await env.KV_BINDING.put(`webhook:${event}`, JSON.stringify(dedup));
  return dedup;
}
async function fireWebhooks(env, event, payload) {
  const urls = await loadWebhooks(env, event);
  if (!urls.length) return;
  const body = JSON.stringify(payload);
  await Promise.all(urls.map(async (u) => {
    try {
      await fetch(u, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(8000),
      });
    } catch (e) { /* non-fatal — safety-net poll will pick it up */ }
  }));
}

// =========================================================================
// /remind-signup — public "remind me to vote" form (QR / dismissal-line flier).
// Single-purpose: first, phone, zip. Optional email. Adds to vote-reminder list.
// Sets wants_vote_reminders=true on the contact + logs the signup event.
// =========================================================================
async function remindSignup(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rlKey = `rl:remindsignup:${ip}`;
  let count = 0;
  try { count = parseInt(await env.KV_BINDING.get(rlKey) || '0'); } catch {}
  if (count >= 30) return json({ error: 'too many requests, try again later' }, 429, { 'Retry-After': '300' });
  try { await env.KV_BINDING.put(rlKey, String(count + 1), { expirationTtl: 300 }); } catch {}

  const body = await request.json();
  if (honeypotBot(body)) return json({ error: 'bot detected' }, 400);
  const { first, last, phone, email, zip, school, district, wants_updates, wants_help, recruited_by, recruited_by_id, source } = body;
  if (!first || !last || !phone) {
    return json({ error: 'first name, last name, and phone are required' }, 400);
  }
  const cRecruiter = recruited_by ? String(recruited_by).trim() : '';

  const clean = (s) => String(s || '').replace(/^[^\w\s]+/, '').trim();
  const cFirst = clean(first);
  const cLast = clean(last);
  const cPhone = String(phone).trim();
  const cEmail = email ? String(email).toLowerCase().trim() : '';
  const cZip = zip ? String(zip).trim() : '';
  const cSchool = school ? String(school).trim() : '';
  const cDistrict = district ? String(district).trim() : '';

  // Dedupe by phone then email
  let existingId = null;
  const digits = cPhone.replace(/\D/g, '').slice(-10);
  if (digits.length === 10) {
    const r2 = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`REGEX_REPLACE({phone},'\\\\D','')='${digits}'`)}&maxRecords=1`);
    if (r2.records.length > 0) existingId = r2.records[0].id;
  }
  if (!existingId && cEmail) {
    const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`LOWER({email})='${cEmail}'`)}&maxRecords=1`);
    if (r.records.length > 0) existingId = r.records[0].id;
  }

  const today = todayCT();

  const baseFields = {
    first: cFirst,
    last: cLast,
    phone: cPhone,
    source: source || 'remind me to vote',
    last_attempt_date: today,
  };
  if (cEmail) baseFields.email = cEmail;
  if (cZip) baseFields.zip = cZip;
  if (cSchool) baseFields.school = cSchool;
  if (cDistrict) baseFields.district = cDistrict;
  if (cRecruiter) baseFields.recruited_by = cRecruiter;
  // Amplifier attribution: ?ref=<amplifier_contact_id> writes the recruited_by
  // link directly (overrides free-text if both present) and tags source.
  if (recruited_by_id && /^rec[A-Za-z0-9]+$/.test(String(recruited_by_id))) {
    baseFields.recruited_by = [String(recruited_by_id)];
    baseFields.source = (baseFields.source || '') + ' · via amplifier link';
  }
  if (wants_updates) baseFields.wants_amendment5_updates = true;
  if (wants_help) baseFields.wants_to_volunteer = true;
  // Flag vote-reminder intent durably + visibly (no dedicated field exists).
  const VR_TAG = `${today} · Wants vote reminder`;
  if (existingId) {
    try {
      const cur = await at(env, `/${BASE}/${CONTACTS_TBL}/${existingId}`);
      const prev = String(cur.fields.commitments_added || '').trim();
      if (!/wants vote reminder/i.test(prev)) baseFields.commitments_added = prev ? `${prev}\n${VR_TAG}` : VR_TAG;
    } catch (e) { /* non-fatal */ }
  } else {
    baseFields.commitments_added = VR_TAG;
  }

  let contactId;
  if (existingId) {
    contactId = existingId;
    try {
      await at(env, `/${BASE}/${CONTACTS_TBL}/${contactId}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: baseFields, typecast: true })
      });
    } catch (e) { /* non-fatal */ }
  } else {
    const fields = { ...baseFields, leader_ladder: 'Prospect' };
    // Only assign organizer if we have a zip to route on; otherwise leave unassigned
    if (cZip) {
      const organizerId = deriveOrganizerId({ zip: cZip });
      if (organizerId) fields.assigned_organizer = [organizerId];
    }
    const created = await at(env, `/${BASE}/${CONTACTS_TBL}`, {
      method: 'POST',
      body: JSON.stringify({ records: [{ fields }], typecast: true })
    });
    contactId = created.records[0].id;
  }

  // Log the signup
  try {
    await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, {
      method: 'POST',
      body: JSON.stringify({ records: [{
        fields: {
          Summary: `${today} — vote reminder signup`,
          date: today,
          method: 'Other',
          result: 'Signed up',
          event: 'Vote reminder list',
          contact: [contactId],
          notes: [
            source ? `Source: ${source}` : 'Remind me to vote form',
            wants_updates ? 'Wants Amendment 5 updates' : null,
            wants_help ? 'Wants to help us win (volunteer follow-up)' : null,
          ].filter(Boolean).join(' · '),
        }
      }], typecast: true })
    });
  } catch (e) { /* non-fatal */ }

  await invalidateReadCaches(env);
  return json({ ok: true, contact_id: contactId });
}

// Pages the magic link is allowed to land on (open-redirect protection).
const TRUSTED_REDIRECT_HOSTS = [
  'https://lizmckenna.github.io/groundwork/',
  'https://parents4mopublicschools.org/',
];
function safeRedirect(url) {
  if (!url || typeof url !== 'string') return null;
  for (const h of TRUSTED_REDIRECT_HOSTS) {
    if (url.startsWith(h)) return url;
  }
  return null;
}

// =========================================================================
// Amplifier stopgap endpoints — owned by the parallel amplifier session,
// merged 6/11 (second sync). THE REPO IS THE SINGLE SOURCE OF TRUTH:
// git pull before every deploy.
// =========================================================================
async function amplifierLog(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const rlKey = `rl:amplog:${ip}`;
  let count = 0;
  try {
    count = parseInt(await env.KV_BINDING.get(rlKey) || "0");
  } catch {
  }
  if (count >= 60) return json({ error: "too many requests, try again later" }, 429, { "Retry-After": "300" });
  try {
    await env.KV_BINDING.put(rlKey, String(count + 1), { expirationTtl: 300 });
  } catch {
  }
  const body = await request.json();
  if (honeypotBot(body)) return json({ error: 'bot detected' }, 400);
  const {
    amplifier_email,
    amplifier_name,
    followup_voter_id,
    voter_first,
    voter_last,
    voter_phone,
    voter_email,
    voter_street,
    voter_zip,
    voter_city,
    conversation_number,
    outcome,
    notes,
    interests
  } = body;
  const cInterests = Array.isArray(interests) ? interests.filter(Boolean) : [];
  if (!amplifier_email) return json({ error: "amplifier email required (tell us who you are)" }, 400);
  if (!voter_first || !voter_last) return json({ error: "voter first + last name are required" }, 400);
  if (!conversation_number) return json({ error: "pick which conversation (1, 2, or election day)" }, 400);
  const clean = (s) => String(s || '').replace(/^[^\w\s'.-]+/, '').trim();
  const ampEmail = String(amplifier_email).toLowerCase().trim();
  const cFirst = clean(voter_first);
  const cLast = clean(voter_last);
  const cPhone = voter_phone ? String(voter_phone).trim() : "";
  const cEmail = voter_email ? String(voter_email).toLowerCase().trim() : "";
  const cStreet = voter_street ? String(voter_street).trim() : "";
  const cZip = voter_zip ? String(voter_zip).trim() : "";
  const cCity = voter_city ? String(voter_city).trim() : "";
  let ampId = null;
  let ampDisplayName = amplifier_name || "";
  try {
    const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`LOWER({email})='${ampEmail}'`)}&maxRecords=1`);
    if (r.records.length > 0) {
      ampId = r.records[0].id;
      if (!ampDisplayName) ampDisplayName = r.records[0].fields.Name || ampEmail;
    }
  } catch {
  }
  if (!ampId) {
    const ampFields = {
      first: amplifier_name ? clean(amplifier_name).split(" ").slice(0, -1).join(" ") || amplifier_name : ampEmail.split("@")[0],
      last: amplifier_name ? clean(amplifier_name).split(" ").slice(-1)[0] : "(amplifier)",
      email: ampEmail,
      leader_ladder: "Leader",
      source: "self-registered amplifier"
    };
    try {
      const created = await at(env, `/${BASE}/${CONTACTS_TBL}`, {
        method: "POST",
        body: JSON.stringify({ records: [{ fields: ampFields }], typecast: true })
      });
      ampId = created.records[0].id;
      ampDisplayName = `${ampFields.first} ${ampFields.last}`;
    } catch (e) {
    }
  }
  let voterId = null;
  if (followup_voter_id && /^rec[A-Za-z0-9]{14,}$/.test(String(followup_voter_id))) {
    try {
      const filter = `AND({method}='Amplifier conversation',FIND('Amplifier: ${ampDisplayName || ampEmail}',{notes})>0)`;
      const data = await at(env, `/${BASE}/${CONTACT_LOG_TBL}?filterByFormula=${encodeURIComponent(filter)}&pageSize=100`);
      for (const log of data.records) {
        if ((log.fields.contact || []).includes(followup_voter_id)) {
          voterId = followup_voter_id;
          break;
        }
      }
    } catch {
    }
    if (!voterId) {
      return json({ error: "follow-up voter not in your list" }, 403);
    }
  }
  if (!voterId && cPhone) {
    const digits = cPhone.replace(/\D/g, "").slice(-10);
    if (digits.length === 10) {
      const r2 = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`REGEX_REPLACE({phone},'\\\\D','')='${digits}'`)}&maxRecords=1`);
      if (r2.records.length > 0) voterId = r2.records[0].id;
    }
  }
  if (!voterId && cEmail) {
    const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`LOWER({email})='${cEmail}'`)}&maxRecords=1`);
    if (r.records.length > 0) voterId = r.records[0].id;
  }
  const today = todayCT();
  const voterFields = {
    first: cFirst,
    last: cLast,
    last_attempt_date: today
  };
  if (cPhone) voterFields.phone = cPhone;
  if (cEmail) voterFields.email = cEmail;
  if (cStreet) voterFields.street_address = cStreet;
  if (cZip) voterFields.zip = cZip;
  if (cCity) voterFields.city = cCity;
  // Routing rule (Liz 6/11): amplifier voters stay with their amplifier UNLESS
  // they asked for an onboarding call — only those route to staff by zip and
  // enter the fresh lists (no last_attempt stamp: the amplifier touch is a
  // referral, not a staff attempt).
  const wantsCall = cInterests.some(i => /onboarding/i.test(i));
  if (wantsCall) delete voterFields.last_attempt_date;
  // Interests are commitments — surface them on staff dashboards' ✦ pill
  if (cInterests.length) {
    try {
      let prevC = '';
      if (voterId) {
        const curV = await at(env, `/${BASE}/${CONTACTS_TBL}/${voterId}`);
        prevC = String(curV.fields.commitments_added || '').trim();
      }
      const lines = cInterests.map(i => `${today} · ${i} (via amplifier)`).join('\n');
      voterFields.commitments_added = prevC ? `${prevC}\n${lines}` : lines;
    } catch (e) { /* non-fatal */ }
  }
  if (voterId) {
    try {
      await at(env, `/${BASE}/${CONTACTS_TBL}/${voterId}`, {
        method: "PATCH",
        body: JSON.stringify({ fields: voterFields, typecast: true })
      });
    } catch {
    }
  } else {
    const fields = {
      ...voterFields,
      leader_ladder: "Prospect",
      source: `amplifier outreach \xB7 ${ampDisplayName || ampEmail}`
    };
    if (wantsCall && cZip) {
      const orgId = deriveOrganizerId({ zip: cZip });
      if (orgId) fields.assigned_organizer = [orgId];
    }
    const created = await at(env, `/${BASE}/${CONTACTS_TBL}`, {
      method: "POST",
      body: JSON.stringify({ records: [{ fields }], typecast: true })
    });
    voterId = created.records[0].id;
  }
  const convLabel = String(conversation_number) === "1" ? "Amp Conv 1 \u2014 Stakes" : String(conversation_number) === "2" ? "Amp Conv 2 \u2014 Vote plan" : String(conversation_number) === "3" ? "Amp Conv 3 \u2014 Election day" : `Amp Conv ${conversation_number}`;
  const logFields = {
    Summary: `${today} \u2014 ${convLabel} (amp: ${ampDisplayName || ampEmail})`,
    date: today,
    method: "Amplifier conversation",
    result: outcome || "Conversation",
    event: convLabel,
    contact: [voterId],
    notes: [
      `Amplifier: ${ampDisplayName || ampEmail}`,
      cInterests.length ? `Interests: ${cInterests.join(", ")}` : null,
      notes ? `Notes: ${notes}` : null
    ].filter(Boolean).join(" \xB7 ")
  };
  try {
    await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, {
      method: "POST",
      body: JSON.stringify({ records: [{ fields: logFields }], typecast: true })
    });
  } catch {
  }
  let unique_voters = 0, total_conversations = 0;
  try {
    const search = await at(env, `/${BASE}/${CONTACT_LOG_TBL}?filterByFormula=${encodeURIComponent(`AND({method}='Amplifier conversation',FIND('Amplifier: ${ampDisplayName || ampEmail}',{notes})>0)`)}&pageSize=100`);
    total_conversations = search.records.length;
    const voterSet = /* @__PURE__ */ new Set();
    for (const rec of search.records) {
      const cs = rec.fields.contact || [];
      cs.forEach((id) => voterSet.add(id));
    }
    unique_voters = voterSet.size;
  } catch {
  }
  await invalidateReadCaches(env);
  return json({
    ok: true,
    voter_id: voterId,
    amplifier_id: ampId,
    unique_voters,
    total_conversations,
    voter_name: `${cFirst} ${cLast}`,
    conversation: convLabel
  });
}

// Resolve an amplifier's display Name — the string frozen into each conversation
// log's notes as "Amplifier: <Name>" at write time. An amplifier's whole voter
// list/progress is reconstructed by string-matching that name, so resolving it
// is load-bearing. Returns the trimmed Name, or null if no contact matches this
// email. THROWS on a database/transport error — callers MUST treat that as
// "try again", never as an empty result. Never fall back to using the raw email
// as the name: log notes never contain the email, so that always matches zero —
// that silent-zero was the bug that made amplifier trackers appear wiped.
async function resolveAmpName(env, email) {
  const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`LOWER({email})='${email}'`)}&pageSize=10`);
  const recs = r.records || [];
  const named = recs.filter((x) => (x.fields.Name || "").trim());
  const pick = named[0] || recs[0];
  const nm = pick && (pick.fields.Name || "").trim();
  return nm || null;
}

async function amplifierProgress(request, env, urlObj) {
  const email = (urlObj.searchParams.get("email") || "").toLowerCase().trim();
  if (!email) return json({ error: "email required" }, 400);
  let ampName;
  try {
    ampName = await resolveAmpName(env, email);
  } catch {
    return json({ error: "database unavailable, please try again", retry: true }, 503);
  }
  if (!ampName) return json({ error: "no amplifier profile found for " + email, not_found: true }, 404);
  let unique_voters = 0, total_conversations = 0;
  try {
    const search = await at(env, `/${BASE}/${CONTACT_LOG_TBL}?filterByFormula=${encodeURIComponent(`AND({method}='Amplifier conversation',FIND('Amplifier: ${ampName}',{notes})>0)`)}&pageSize=100`);
    total_conversations = search.records.length;
    const voterSet = /* @__PURE__ */ new Set();
    for (const rec of search.records) {
      (rec.fields.contact || []).forEach((id) => voterSet.add(id));
    }
    unique_voters = voterSet.size;
  } catch {
    return json({ error: "database unavailable, please try again", retry: true }, 503);
  }
  return json({ ok: true, email, amplifier_name: ampName, unique_voters, total_conversations });
}

async function amplifierVoters(request, env, urlObj) {
  const email = (urlObj.searchParams.get("email") || "").toLowerCase().trim();
  if (!email) return json({ error: "email required" }, 400);
  let ampName;
  try {
    ampName = await resolveAmpName(env, email);
  } catch {
    return json({ error: "database unavailable, please try again", retry: true }, 503);
  }
  if (!ampName) return json({ error: "no amplifier profile found for " + email, not_found: true }, 404);
  const logs = [];
  let offset = null;
  const filter = `AND({method}='Amplifier conversation',FIND('Amplifier: ${ampName}',{notes})>0)`;
  do {
    const q = `?filterByFormula=${encodeURIComponent(filter)}&pageSize=100&sort%5B0%5D%5Bfield%5D=date&sort%5B0%5D%5Bdirection%5D=desc${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`;
    const data = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
    logs.push(...data.records);
    offset = data.offset || null;
  } while (offset);
  const byContact = {};
  for (const log of logs) {
    const cs = log.fields.contact || [];
    for (const cid of cs) {
      if (!byContact[cid]) byContact[cid] = [];
      byContact[cid].push({
        date: log.fields.date || "",
        event: log.fields.event || "",
        result: log.fields.result || "",
        notes: log.fields.notes || ""
      });
    }
  }
  const voterIds = Object.keys(byContact);
  const voters = [];
  for (let i = 0; i < voterIds.length; i += 10) {
    const chunk = voterIds.slice(i, i + 10);
    const formula = `OR(${chunk.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
    const u = `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`;
    try {
      const data = await at(env, u);
      for (const rec of data.records) {
        voters.push({
          id: rec.id,
          name: rec.fields.Name || `${rec.fields.first || ""} ${rec.fields.last || ""}`.trim(),
          phone: rec.fields.phone || "",
          email: rec.fields.email || "",
          zip: rec.fields.zip || "",
          city: rec.fields.city || "",
          conversations: byContact[rec.id] || []
        });
      }
    } catch {
    }
  }
  voters.sort((a, b) => {
    const ad = a.conversations[0] && a.conversations[0].date || "";
    const bd = b.conversations[0] && b.conversations[0].date || "";
    return bd.localeCompare(ad);
  });
  return json({ ok: true, amplifier_name: ampName, voters });
}

async function amplifierVoterUpdate(request, env) {
  const body = await request.json();
  const { amplifier_email, voter_id, voter_first, voter_last, voter_phone, voter_email, voter_zip, voter_city, voter_street } = body;
  if (!amplifier_email || !voter_id) return json({ error: "amplifier_email and voter_id required" }, 400);
  let ampName = amplifier_email.toLowerCase().trim();
  try {
    const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`LOWER({email})='${ampName}'`)}&maxRecords=1`);
    if (r.records.length > 0) ampName = r.records[0].fields.Name || ampName;
  } catch {
  }
  const filter = `AND({method}='Amplifier conversation',FIND('Amplifier: ${ampName}',{notes})>0)`;
  let owns = false;
  try {
    const data = await at(env, `/${BASE}/${CONTACT_LOG_TBL}?filterByFormula=${encodeURIComponent(filter)}&pageSize=100`);
    for (const log of data.records) {
      if ((log.fields.contact || []).includes(voter_id)) {
        owns = true;
        break;
      }
    }
  } catch {
  }
  if (!owns) return json({ error: "voter not in your list" }, 403);
  const patch = {};
  if (voter_first) patch.first = String(voter_first).trim();
  if (voter_last) patch.last = String(voter_last).trim();
  if (voter_phone) patch.phone = String(voter_phone).trim();
  if (voter_email) patch.email = String(voter_email).toLowerCase().trim();
  if (voter_zip) patch.zip = String(voter_zip).trim();
  if (voter_city) patch.city = String(voter_city).trim();
  if (voter_street) patch.street_address = String(voter_street).trim();
  if (Object.keys(patch).length === 0) return json({ error: "nothing to update" }, 400);
  try {
    await at(env, `/${BASE}/${CONTACTS_TBL}/${voter_id}`, {
      method: "PATCH",
      body: JSON.stringify({ fields: patch, typecast: true })
    });
  } catch (e) {
    return json({ error: "update failed: " + e.message }, 500);
  }
  return json({ ok: true });
}

async function authStart(request, env) {
  const body = await request.json();
  const email = (body.email || '').toLowerCase().trim();
  if (!email) return json({ error: 'email required' }, 400);
  if (!ALLOWLIST.includes(email)) return json({ ok: true, message: 'check your email' });
  const code = genToken(32);
  await env.KV_BINDING.put(`code:${code}`, email, { expirationTtl: CODE_TTL });
  // Use caller's page as redirect target if it's a trusted host; otherwise fall back to LaNeé's dashboard.
  const target = safeRedirect(body.redirect_url) || LOGIN_URL;
  const link = `${target}?token=${code}`;
  const emailBody = {
    from: FROM_AUTH,
    to: [email],
    subject: 'Sign in to Groundwork',
    html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Inter',Helvetica,Arial,sans-serif;color:#18181b;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f4f4f5;padding:40px 20px;">
    <tr><td align="center">
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid rgba(0,0,0,0.08);overflow:hidden;">
        <tr><td style="padding:32px 40px 8px;">
          <img src="${LOGO_URL}" width="48" height="48" alt="Groundwork" style="display:block;border:0;margin-bottom:10px;">
          <div style="font-size:18px;font-weight:700;letter-spacing:-0.01em;color:#18181b;line-height:1;">Groundwork</div>
          <div style="font-family:monospace;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#71717a;margin-top:6px;">MOI Pilot &middot; Missouri</div>
        </td></tr>
        <tr><td style="padding:24px 40px 8px;">
          <h1 style="font-size:24px;font-weight:600;letter-spacing:-0.015em;margin:0 0 12px;color:#18181b;line-height:1.2;">Sign in to Groundwork</h1>
          <p style="font-size:15px;line-height:1.6;color:#3f3f46;margin:0 0 24px;">Tap the button to open your dashboard. The link is good for 10 minutes.</p>
          <table cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:8px;background:#5371ff;">
            <a href="${link}" style="display:inline-block;padding:14px 30px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:-0.005em;">Sign in &rarr;</a>
          </td></tr></table>
        </td></tr>
        <tr><td style="padding:24px 40px 32px;">
          <p style="font-size:12px;line-height:1.6;color:#71717a;margin:0;">Button not working? Paste this link in your browser:</p>
          <p style="font-size:12px;line-height:1.5;color:#5371ff;margin:6px 0 0;word-break:break-all;">${link}</p>
        </td></tr>
        <tr><td style="padding:20px 40px;background:#fafafa;border-top:1px solid rgba(0,0,0,0.06);">
          <p style="font-size:11px;line-height:1.6;color:#71717a;margin:0;">Didn't request this? Ignore the email &mdash; the link expires on its own.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`,
  };
  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(emailBody),
  });
  if (!emailRes.ok) {
    const t = await emailRes.text();
    return json({ error: `email send failed: ${t}` }, 500);
  }
  return json({ ok: true, message: 'check your email' });
}

async function authVerify(request, env) {
  const body = await request.json();
  const code = body.code;
  if (!code) return json({ error: 'code required' }, 400);
  let email = null;
  try { email = await env.KV_BINDING.get(`code:${code}`); } catch (e) {
    return json({ error: `kv get failed: ${e.message}` }, 500);
  }
  if (!email) return json({ error: 'invalid or expired link' }, 401);
  // Non-fatal: if delete fails (daily limit), code still auto-expires after CODE_TTL
  try { await env.KV_BINDING.delete(`code:${code}`); } catch {}
  const sessionToken = genToken(48);
  try {
    await env.KV_BINDING.put(`session:${sessionToken}`, email, { expirationTtl: SESSION_TTL });
  } catch (e) {
    return json({ error: `session put failed: ${e.message}` }, 500);
  }
  return json({ ok: true, session_token: sessionToken, email });
}

// Schools whose parents are organized by their own school teams — exclude from
// any organizer's call queue. Matches via case-insensitive "contains" so all
// spelling variants get caught (e.g. "Hale Cook Elementary", "FLA/Holliday").
const EXCLUDED_SCHOOL_PATTERNS = ['hale cook', 'fla', 'foreign language academy', 'border star', 'bsm'];
const EXCLUDED_ROLES = ['Fellow organizer'];
// Note: no state-based exclusion. KC-metro includes KS counties (Johnson, Wyandotte) — those are LaNeé's.
// Stephanie's queue is just whatever's assigned to her; we manage assignments rather than filter geography.

// Organizer NAMES (matches what {assigned_organizer} stringifies to — primary field of Contacts table).
// Multi-select stringifies as comma-joined names, so name-based FIND is the reliable filter.
// Try both with/without accent — Airtable's primary field may be either.
// The filter uses FIND('Bridewell',...) which catches BOTH variants safely.
const ORGANIZER_NAMES_LC = {
  'lanee':     'Bridewell',         // partial match — catches "LaNeé Bridewell" or "LaNee Bridewell"
  'laneé':     'Bridewell',
  'stephanie': 'Stephanie Rittgers',
  'kathryn':   'Kathryn',           // partial match on first name — her queue is whoever's assigned to her
  'elleng':    'Ellen Glover',
};
function organizerName(name) {
  if (!name) return null;
  return ORGANIZER_NAMES_LC[String(name).toLowerCase().trim()] || null;
}

// SINGLE SOURCE OF TRUTH for "is this person callable at all". Every list
// (fresh, unreached, unconverted, training_followup) AND the Airtable
// in_call_queue formula must reflect these. Add a disqualifier here once and
// all four worker lists inherit it — this is what stops the "X list excludes
// it but Y doesn't" drift bug. Returns an array of Airtable formula clauses.
function callableExclusions(organizerName_) {
  const orgFullName = organizerName(organizerName_);
  const c = [
    `NOT({leader_ladder}='Core Leader')`,
    `NOT({leader_ladder}='Not a prospect')`,
    `NOT({last_attempt_result}='Do not contact')`,
    `NOT({last_attempt_result}='Removed from list')`,
    ...EXCLUDED_SCHOOL_PATTERNS.map(p => `FIND('${p}',LOWER({school}&''))=0`),
    ...EXCLUDED_ROLES.map(r => `FIND('${r}',{role}&'')=0`),
    `FIND('county, ks',LOWER({county}&''))=0`,   // MO only — never call Kansas-side (KS) contacts (Liz 6/23)
  ];
  if (orgFullName) c.push(`FIND('${orgFullName}',{assigned_organizer}&'')>0`);
  return c;
}

// Onboarding-signup exclusions — people already signed up for an upcoming
// onboarding leave the cold-call lists. Shared by fresh + unreached.
function onboardingSignupExclusions() {
  return Object.values(EVENT_META)
    .filter(m => m.type === 'onboarding' && m.signupField)
    .map(m => `NOT({${m.signupField}}='Signed up')`);
}

function prospectsFilter(organizerName_) {
  // FRESH list = "the first time you've seen that person" (Ellen, 6/11 call):
  // never attempted, not signed up for an upcoming onboarding.
  return `AND(${[
    `{last_attempt_date}=BLANK()`,
    `NOT({last_attempt_result}='Signed up')`,
    ...onboardingSignupExclusions(),
    `NOT({last_attempt_result}='Skipped')`,
    `NOT({last_attempt_result}='Wrong number')`,
    ...callableExclusions(organizerName_),
  ].join(',')})`;
}
const PROSPECTS_FILTER = prospectsFilter();  // legacy default — no organizer filter

async function getProspects(env, url) {
  const n = parseInt(url.searchParams.get('n') || '5');
  const organizer = url.searchParams.get('organizer');
  const filter = prospectsFilter(organizer);
  const fields = PROSPECT_FIELDS;
  let q = `?filterByFormula=${encodeURIComponent(filter)}&maxRecords=${n}`;
  q += `&sort%5B0%5D%5Bfield%5D=log_count&sort%5B0%5D%5Bdirection%5D=desc`;
  for (const f of fields) q += `&fields%5B%5D=${encodeURIComponent(f)}`;
  const data = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
  return json(data.records.map(rowFromRecord));
}

// =========================================================================
// /call-list?list=fresh|unreached|unconverted&organizer=X&n=25
// Toggleable call lists — each list is a different slice of the base:
//   fresh       — never reached / cooled off (the classic onramp queue)
//   unreached   — attempted in the last 7 days, no answer yet. THE cadence
//                 list: sorted oldest-attempt-first with a suggested next
//                 channel (alternate from whatever was tried last).
//   unconverted — came to an onboarding but hasn't taken a next step
//                 (no 1-1 booked, no commitment, no future-event signup).
//                 Primary goal on this list per Ellen: book the 1-1.
// All lists return the same row shape as /prospects so the dashboard renders
// them with one code path.
// =========================================================================
const PROSPECT_FIELDS = ['Name','first','last','phone','email','school','district','log_count','organized_by','leader_ladder',
  'last_attempt_date','last_attempt_method','last_attempt_result','next_step','last_attempt_by','last_attempt_note',
  'attempt_count','one_on_one_booked','amendment5_commitments','house_meeting_commitments','commitments_added','house_meeting_date','dnc_flag_date',
  ...Object.values(EVENT_META).filter(m => m.signupField).map(m => m.signupField),
  ...Object.values(EVENT_META).filter(m => m.attendField).map(m => m.attendField)];

function rowFromRecord(r) {
  return {
    id: r.id,
    name: r.fields.Name || `${r.fields.first || ''} ${r.fields.last || ''}`.trim(),
    phone: r.fields.phone || '',
    email: r.fields.email || '',
    school: r.fields.school || '',
    district: r.fields.district || '',
    log_count: r.fields.log_count || 0,
    organized_by_count: (r.fields.organized_by || []).length,
    leader_ladder: r.fields.leader_ladder || '',
    last_attempt_date: r.fields.last_attempt_date || null,
    last_attempt_method: r.fields.last_attempt_method || null,
    last_attempt_result: r.fields.last_attempt_result || null,
    next_step: r.fields.next_step || null,
    last_attempt_by: r.fields.last_attempt_by || null,
    last_attempt_note: r.fields.last_attempt_note || null,
    attempt_count: r.fields.attempt_count || 0,
    one_on_one_booked: !!r.fields.one_on_one_booked,
    commitments: r.fields.amendment5_commitments || '',
    hm_commitments: r.fields.house_meeting_commitments || '',
    commitments_added: r.fields.commitments_added || '',
    house_meeting_date: r.fields.house_meeting_date || null,
    dnc_flag_date: r.fields.dnc_flag_date || null,
    // Upcoming signups (for the Commitments pill): { '6_23': 'Signed up', ... }
    signups: Object.fromEntries(Object.entries(EVENT_META)
      .filter(([, m]) => m.signupField && r.fields[m.signupField])
      .map(([k, m]) => [k, r.fields[m.signupField]])),
    // New-era events attended (per-event fields) — log_count only covers the
    // historical event_attendance table, so the Events pill adds these.
    recent_events: Object.values(EVENT_META)
      .filter(m => ['Attended', 'Walk-in'].includes(r.fields[m.attendField])).length,
  };
}

async function countMatching(env, filter) {
  let count = 0, offset = null;
  do {
    let q = `?filterByFormula=${encodeURIComponent(filter)}&pageSize=100&fields%5B%5D=Name`;
    if (offset) q += `&offset=${offset}`;
    const data = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
    count += data.records.length;
    offset = data.offset;
  } while (offset);
  return count;
}
async function getCallList(env, urlObj) {
  const list = urlObj.searchParams.get('list') || 'fresh';
  const organizer = urlObj.searchParams.get('organizer');
  const n = parseInt(urlObj.searchParams.get('n') || '25');
  const countOnly = urlObj.searchParams.get('count');   // count=1 → return {count} for this list

  if (list === 'fresh') {
    if (countOnly) return await getQueueCount(env, urlObj);
    // Same as /prospects
    return await getProspects(env, urlObj);
  }

  if (list === 'unreached') {
    // Attempted, no answer, due again after 4 days (was 7 — Ellen call 6/11).
    // Drop off permanently at 5 attempts (a call + a text = 2 attempts).
    const filter = `AND(${[
      `{last_attempt_result}='No answer'`,
      `{last_attempt_date}!=BLANK()`,
      `DATETIME_DIFF(TODAY(),{last_attempt_date},'days')>=4`,
      `OR({attempt_count}=BLANK(),{attempt_count}<5)`,
      ...onboardingSignupExclusions(),
      ...callableExclusions(organizer),
    ].join(',')})`;
    if (countOnly) return json({ count: await countMatching(env, filter) });
    let q = `?filterByFormula=${encodeURIComponent(filter)}&maxRecords=${n}`;
    q += `&sort%5B0%5D%5Bfield%5D=last_attempt_date&sort%5B0%5D%5Bdirection%5D=asc`;
    for (const f of PROSPECT_FIELDS) q += `&fields%5B%5D=${encodeURIComponent(f)}`;
    const data = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
    const today = todayCT();
    return json(data.records.map(r => {
      const row = rowFromRecord(r);
      const daysSince = row.last_attempt_date
        ? Math.floor((new Date(today) - new Date(row.last_attempt_date)) / 86400000)
        : null;
      const lastM = String(row.last_attempt_method || '').toLowerCase();
      row.cadence = {
        days_since: daysSince,
        due: daysSince != null && daysSince >= 4,
        try_next: lastM === 'email' ? 'call or text' : 'email',
        attempts: r.fields.attempt_count || 0,
      };
      return row;
    }));
  }

  if (list === 'unconverted') {
    // Attended ANY tracked event, no next step taken yet.
    const attendClauses = Object.values(EVENT_META)
      .filter(m => m.type === 'onboarding' || m.type === 'legacy')
      .map(m => `OR({${m.attendField}}='Attended',{${m.attendField}}='Walk-in')`)
      .join(',');
    // Drop off this list once they sign up for ANY training or book a 1-1
    // (Ellen call 6/11), or were tried in the last 4 days.
    const trainingExcl = Object.values(EVENT_META)
      .filter(m => ['hm','amp','kyn'].includes(m.type) && m.signupField)
      .map(m => `NOT({${m.signupField}}='Signed up')`);
    // "Follow-ups to commitments" — county/commitment-scoped per Ellen G's spec
    // (6/22, confirmed). The split is by county + commitment content, NOT by
    // assigned_organizer, so it's robust to legacy assignments.
    const oid = organizerId(organizer);
    const C = `LOWER({county}&'')`;
    const A5 = `LOWER({amendment5_commitments}&'')`;
    const countyOr = (cs) => `OR(${cs.map(c => `FIND('${c}',${C})>0`).join(',')})`;
    const hasCommit = `TRIM({amendment5_commitments}&'')!=''`;
    const attendedOnboarding = `OR(${attendClauses})`;
    // KCPS / Kansas City by district or school, so KC folks route to LaNee even when
    // the zip (and derived county) is missing (Liz 6/23).
    const isKC = `OR(FIND('kcps',LOWER({district}&'')),FIND('kansas city',LOWER({district}&'')),FIND('kcps',LOWER({school}&'')),FIND('kansas city',LOWER({school}&'')))`;
    // "only amplifier and/or house meeting": has amp or hm, and no other commitment type.
    const ampHmOnly = `AND(OR(FIND('amplifier',${A5}),FIND('house meeting',${A5}),FIND('host a house',${A5})),`
      + `NOT(FIND('power camp',${A5})),NOT(FIND('regional',${A5})),NOT(FIND('school board',${A5})),`
      + `NOT(FIND('parent team',${A5})),NOT(FIND('canvass',${A5})),NOT(FIND('testimony',${A5})),`
      + `NOT(FIND('talk to 5',${A5})),NOT(FIND('other:',${A5})))`;
    const holdOr = STEPHANIE_HOLD.length ? `OR(${STEPHANIE_HOLD.map(id => `RECORD_ID()='${id}'`).join(',')})` : `FALSE()`;
    let followupCore, orgScope = null;
    // Kathryn's amp/hm-only people are statewide — they shouldn't double-appear
    // on LaNee, Ellen G, or Stephanie's geographic queues (Stephanie 6/23 bug report).
    if (oid === LANEE_ID) {
      followupCore = [ hasCommit, `OR(${countyOr(LANEE_FOLLOWUP_COUNTIES)},${isKC})`, `NOT(${ampHmOnly})` ];
    } else if (oid === ELLENG_ID) {
      followupCore = [ hasCommit, countyOr(ELLENG_COUNTIES), `NOT(${ampHmOnly})` ];
    } else if (oid === STEPHANIE_ID) {
      // commitment anywhere except the 9, OR onboarding attendee in a no-team county.
      // Exclude amp/hm-only commits (those route to Kathryn statewide).
      followupCore = [
        `OR(AND(${hasCommit},NOT(${countyOr(STEPHANIE_EXCLUDE_COUNTIES)}),NOT(${isKC}),NOT(${ampHmOnly})),`
        + `AND(${attendedOnboarding},NOT(${countyOr(STEPHANIE_TEAM_COUNTIES)}),NOT(${isKC})),`
        + `${holdOr})`,   // + her Francis Howell hold, kept even when amp-only (Stephanie 6/23)
      ];
    } else if (oid === organizerId('kathryn')) {
      followupCore = [ `AND(${ampHmOnly},NOT(${holdOr}))` ];   // amp/hm-only statewide, minus Stephanie's held Francis Howell folks
    } else {
      followupCore = [ `OR(${attendClauses},${hasCommit})` ];
      orgScope = organizer;   // any other caller stays on the assigned_organizer split
    }
    const filter = `AND(${[
      ...followupCore,
      ...trainingExcl,
      `NOT({one_on_one_booked})`,
      `OR({last_attempt_date}=BLANK(),DATETIME_DIFF(TODAY(),{last_attempt_date},'days')>=4)`,
      ...callableExclusions(orgScope),
    ].join(',')})`;
    if (countOnly) return json({ count: await countMatching(env, filter) });
    const fields = [...PROSPECT_FIELDS, ...Object.values(EVENT_META).filter(m => m.attendField).map(m => m.attendField)];
    const candidates = [];
    let offset = null;
    do {
      let q = `?filterByFormula=${encodeURIComponent(filter)}&pageSize=100`;
      for (const f of fields) q += `&fields%5B%5D=${encodeURIComponent(f)}`;
      if (offset) q += `&offset=${encodeURIComponent(offset)}`;
      const page = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
      candidates.push(...page.records);
      offset = page.offset;
    } while (offset);

    // (Legacy log-based 'converted' exclusion removed 6/11: A5 form signups
    // write Commitment logs, so it wrongly hid everyone whose commitments
    // went beyond HM/Amplifier — exactly the follow-up population. Drop-off
    // is now purely field-based: training signups + one_on_one_booked,
    // already in the formula above.)
    const rows = candidates
      .slice(0, n)
      .map(r => {
        const row = rowFromRecord(r);
        // Which onboarding did they come to? (latest tracked event wins)
        const attended = Object.entries(EVENT_META)
          .filter(([, m]) => ['Attended', 'Walk-in'].includes(r.fields[m.attendField]))
          .map(([k, m]) => ({ key: k, label: m.label, date: m.date }))
          .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        row.attended_event = attended[0]?.label || null;
        row.attended_event_date = attended[0]?.date || null;
        return row;
      });
    return json(rows);
  }

  if (list === 'training_followup') {
    // Kathryn's second list: came to an HM/Amplifier training, no next action
    // yet. Outcomes there: scheduled a house meeting / filled out the
    // amplifier tracker (logged via hm-scheduled / amp-tracker).
    const attendClauses = Object.values(EVENT_META)
      .filter(m => m.type === 'hm' || m.type === 'amp')
      .map(m => `OR({${m.attendField}}='Attended',{${m.attendField}}='Walk-in')`)
      .join(',');
    const filter = `AND(${[
      `OR(${attendClauses})`,
      `OR({last_attempt_date}=BLANK(),DATETIME_DIFF(TODAY(),{last_attempt_date},'days')>=4)`,
      ...callableExclusions(organizer),
    ].join(',')})`;
    if (countOnly) return json({ count: await countMatching(env, filter) });
    const fields = [...PROSPECT_FIELDS, ...Object.values(EVENT_META).filter(m => m.type === 'hm' || m.type === 'amp').map(m => m.attendField)];
    const candidates = [];
    let offset = null;
    do {
      let q = `?filterByFormula=${encodeURIComponent(filter)}&pageSize=100`;
      for (const f of fields) q += `&fields%5B%5D=${encodeURIComponent(f)}`;
      if (offset) q += `&offset=${encodeURIComponent(offset)}`;
      const page = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
      candidates.push(...page.records);
      offset = page.offset;
    } while (offset);
    const rows = candidates.slice(0, n).map(r => {
      const row = rowFromRecord(r);
      const attended = Object.entries(EVENT_META)
        .filter(([, m]) => (m.type === 'hm' || m.type === 'amp') && ['Attended', 'Walk-in'].includes(r.fields[m.attendField]))
        .map(([k, m]) => ({ key: k, label: m.label, date: m.date }))
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      row.attended_event = attended[0]?.label || null;
      row.attended_event_date = attended[0]?.date || null;
      return row;
    });
    return json(rows);
  }

  return json({ error: `unknown list '${list}' — use fresh, unreached, unconverted, or training_followup` }, 400);
}

// =========================================================================
// /contact-history?id=recXXX — full touch + event history for one contact.
// Powers the hover popover on the call sheet ("what events did they actually
// attend, and when? what did the last caller note?").
// =========================================================================
async function getContactHistory(env, urlObj) {
  const cid = urlObj.searchParams.get('id');
  if (!cid) return json({ error: 'id required' }, 400);
  // KV cache — repeat opens are instant; writes are rare enough that 10 min
  // staleness is fine for a history view.
  const cacheKey = `cache:history:v5:${cid}`;
  const cached = await cacheGet(env, cacheKey);
  if (cached) return json(cached);

  const contact = await at(env, `/${BASE}/${CONTACTS_TBL}/${cid}`);
  const logIds = Array.isArray(contact.fields.contact_log) ? contact.fields.contact_log : [];
  const evIds = Array.isArray(contact.fields.event_attendance) ? contact.fields.event_attendance : [];

  const chunkFetch = (ids, tbl, fields) => {
    const jobs = [];
    for (let i = 0; i < ids.length && i < 60; i += 10) {
      const chunk = ids.slice(i, i + 10);
      const f = `OR(${chunk.map(id => `RECORD_ID()='${id}'`).join(',')})`;
      let q = `?filterByFormula=${encodeURIComponent(f)}&pageSize=10`;
      for (const fl of fields) q += `&fields%5B%5D=${encodeURIComponent(fl)}`;
      jobs.push(at(env, `/${BASE}/${tbl}${q}`));
    }
    return jobs;
  };
  // All chunks in parallel — the old sequential version took seconds on
  // history-heavy contacts.
  const [logPages, evPages] = await Promise.all([
    Promise.all(chunkFetch(logIds, CONTACT_LOG_TBL, ['date','method','result','event','notes','organizer'])),
    Promise.all(chunkFetch(evIds, EVENT_ATTENDANCE_TBL, ['date','event','attended','notes'])),
  ]);

  const entries = [];
  for (const d of logPages) for (const r of d.records) {
    const orgRaw = r.fields.organizer;
    const orgIds = Array.isArray(orgRaw) ? orgRaw : (orgRaw ? [orgRaw] : []);
    // Attempts = direct outreach only (Call/Text/Email). Admin actions
    // (Skip/DNC, method 'Other'), commitments, and system rows are
    // classified separately so the Attempts pill stays clean.
    const m = r.fields.method;
    // Attempts = calls/texts/emails AND admin outcomes (Skip/Wrong number/
    // Do not contact, method 'Other') — a DNC on a date, attributed to the
    // caller, belongs in the attempt history (Liz 6/11). Commitments and
    // event rows stay out.
    const kind = ['Call', 'Text', 'Email', 'Other'].includes(m) ? 'touch'
      : (m === 'Commitment' || m === 'House meeting') ? 'commitment'
      : 'system';
    entries.push({
      kind,
      date: r.fields.date || null,
      method: r.fields.method || null,
      result: r.fields.result || null,
      event: r.fields.event || null,
      notes: r.fields.notes || null,
      organizer: orgIds.map(id => ORGANIZER_NAME_BY_ID[id] || id).join(', ') || null,
      // Attribution before 2026-06-11 was inferred from list assignment
      // (lists do not overlap) — the dashboard renders it as "likely X".
      inferred: !!(orgIds.length && r.fields.date && r.fields.date < '2026-06-11'),
    });
  }
  for (const d of evPages) for (const r of d.records) {
    entries.push({
      kind: 'event',
      date: r.fields.date || null,
      method: 'Event',
      result: r.fields.attended === false ? 'No-show' : 'Attended',
      event: r.fields.event || null,
      notes: r.fields.notes || null,
      organizer: null,
    });
  }

  // New-era events (5/26 onward) live in per-event attendance fields, not the
  // event_attendance table — without this, "came to an onboarding" rows showed
  // no onboarding in their Events popover.
  for (const meta of Object.values(EVENT_META)) {
    const v = contact.fields[meta.attendField];
    if (v) {
      entries.push({
        kind: 'event',
        date: meta.date,
        method: 'Event',
        result: v,
        event: meta.label,
        notes: null,
        organizer: null,
      });
    }
  }

  entries.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const payload = { contact_id: cid, name: contact.fields.Name || '', entries: entries.slice(0, 40) };
  await cachePut(env, cacheKey, payload, 600);
  return json(payload);
}

// =========================================================================
// /add-contact — fresh prospect intake from the dashboard (e.g. Stephanie's
// FB leads). Same dedupe as walk-ins but NO attendance/signup side effects.
// =========================================================================
async function addContact(request, env) {
  const body = await request.json();
  const { first, last, email, phone, school, district, city, zip, role, source, organizer } = body;
  if (!first || !last) return json({ error: 'first and last name required' }, 400);
  if (!email && !phone) return json({ error: 'email or phone required (dedupe + outreach both need one)' }, 400);
  const orgId = organizerId(organizer);

  // Dedupe: email first, then phone — never create a second record
  let existingId = null, existingName = null;
  if (email) {
    const e = String(email).toLowerCase().trim();
    const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`LOWER({email})='${e}'`)}&maxRecords=1`);
    if (r.records.length > 0) { existingId = r.records[0].id; existingName = r.records[0].fields.Name; }
  }
  if (!existingId && phone) {
    const digits = String(phone).replace(/\D/g, '').slice(-10);
    if (digits.length === 10) {
      const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`REGEX_REPLACE({phone},'\\\\D','')='${digits}'`)}&maxRecords=1`);
      if (r.records.length > 0) { existingId = r.records[0].id; existingName = r.records[0].fields.Name; }
    }
  }
  if (existingId) {
    return json({ ok: true, matched_existing: true, contact_id: existingId, existing_name: existingName });
  }

  const fields = {
    first: String(first).trim(),
    last: String(last).trim(),
    leader_ladder: 'Prospect',
    source: String(source || 'dashboard add').trim(),
  };
  if (orgId) fields.assigned_organizer = [orgId];
  if (email) fields.email = String(email).toLowerCase().trim();
  if (phone) fields.phone = String(phone).trim();
  if (school) fields.school = String(school).trim();
  if (district) fields.district = String(district).trim();
  if (city) fields.city = String(city).trim();
  if (zip) { fields.zip = String(zip).trim(); const cty = zipToCounty(String(zip).trim().slice(0,5)); if (cty) fields.county = cty; }
  if (role) fields.role = Array.isArray(role) ? role : [role];
  const c = await at(env, `/${BASE}/${CONTACTS_TBL}`, {
    method: 'POST',
    body: JSON.stringify({ records: [{ fields }], typecast: true }),
  });
  await invalidateReadCaches(env);
  return json({ ok: true, created: true, contact_id: c.records[0].id });
}

async function getQueueCount(env, urlObj) {
  const organizer = urlObj ? urlObj.searchParams.get('organizer') : null;
  const cacheKey = organizer ? `queue:count:${organizer}` : 'queue:count';
  const cached = await env.KV_BINDING.get(cacheKey);
  if (cached) return json({ count: parseInt(cached), cached: true });
  const filter = prospectsFilter(organizer);
  let count = 0;
  let offset = null;
  do {
    let q = `?filterByFormula=${encodeURIComponent(filter)}&pageSize=100&fields%5B%5D=Name`;
    if (offset) q += `&offset=${offset}`;
    const data = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
    count += data.records.length;
    offset = data.offset;
  } while (offset);
  await env.KV_BINDING.put(cacheKey, String(count), { expirationTtl: 300 });
  return json({ count });
}

async function sendZoomEmailNow(request, env) {
  const body = await request.json();
  const { contact_id, organizer, event } = body;
  if (!contact_id) return json({ error: 'contact_id required' }, 400);
  const contact = await at(env, `/${BASE}/${CONTACTS_TBL}/${contact_id}`);
  const cEmail = contact.fields.email;
  const cFirst = contact.fields.first || '';
  if (!cEmail) return json({ error: 'contact has no email on file' }, 400);
  await sendConfirmationEmail(env, cEmail, cFirst, contact_id, organizer, event);
  return json({ ok: true, sent_to: cEmail, event: event || '5_26' });
}

// =========================================================================
// Signup-pipeline canary. The cron runs this daily; for any event ~36h out it
// signs a synthetic user up through the REAL public endpoint and checks that
// (1) a Zoom link is set, (2) the signup created a record, and (3) the
// confirmation email actually sent. Any failure emails CANARY_ALERT_TO. The
// synthetic contact is deleted immediately so it never pollutes the data.
//   GET /admin/run-canary?key=...        -> test events in the next ~36h
//   GET /admin/run-canary?key=...&force=1 -> test EVERY signup event now
//   GET /admin/run-canary?key=...&dry=1   -> link checks only, sends nothing
// =========================================================================
async function runSignupCanary(env, opts = {}) {
  const force = !!opts.force, dry = !!opts.dry;
  const WORKER = 'https://groundwork-pilot.elizabethmck.workers.dev';
  const monitor = CANARY_MONITOR_EMAIL.toLowerCase();
  const now = Date.now();
  const results = [];
  for (const [key, meta] of Object.entries(EVENT_META)) {
    if (!meta.signupField && meta.type !== 'makeup') continue;        // events people can sign up for (incl. makeup, which signs up via events_signed_up)
    const evTime = Date.parse(`${meta.date}T19:30:00-05:00`);
    const hrs = isNaN(evTime) ? null : (evTime - now) / 3.6e6;
    if (evTime && evTime < now - 12 * 3.6e6) continue;               // never test an event that already happened — no signups, no alerts, even with force
    if (!force && !(hrs !== null && hrs > 12 && hrs < 48)) continue;  // ~36h window
    const failures = [];
    if (!meta.inPerson) {   // in-person events (KYN) have no Zoom link by design
      let link = null;
      try { link = await env.KV_BINDING.get(`zoomlink:${key}`); } catch (e) {}
      if (!link) failures.push('No Zoom link is set for this event, so confirmation emails would go out without a join link.');
    }
    if (!dry) {
      let body = null, httpok = false;
      try {
        // Call the handler directly (in-process) — a worker fetching its OWN workers.dev URL
        // is blocked/loops on Cloudflare, which made the canary false-fail even though signups work.
        const req = new Request(`${WORKER}/training-signup`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ first: 'Pipeline', last: 'Canary', email: CANARY_MONITOR_EMAIL, events: [meta.attendEvent], source: 'pipeline canary' }),
        });
        const resp = await trainingSignup(req, env);
        httpok = resp.ok; body = await resp.json().catch(() => null);
      } catch (e) { failures.push('The signup request failed outright: ' + e.message); }
      if (!httpok || !body || !body.ok) {
        failures.push('The signup did not succeed — no contact was created.');
      } else {
        if (!body.confirmation_email_sent) failures.push('The signup succeeded but NO confirmation email was sent.');
        try {
          const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`LOWER({email})='${monitor}'`)}&maxRecords=1&fields%5B%5D=source`);
          if (!r.records.length) failures.push('The signup succeeded but the contact did NOT land in Airtable.');
          else if (r.records[0].fields.source === 'pipeline canary') { try { await at(env, `/${BASE}/${CONTACTS_TBL}/${r.records[0].id}`, { method: 'DELETE' }); } catch (e) {} }  // only ever delete our own synthetic row
        } catch (e) { failures.push('Could not verify the Airtable record landed.'); }
      }
    }
    const result = { key, label: meta.label, date: meta.date, hours_out: hrs === null ? null : Math.round(hrs), status: failures.length ? 'FAIL' : 'PASS', failures };
    results.push(result);
    if (failures.length && !dry) await sendCanaryAlert(env, meta, failures);
  }
  return results;
}

async function sendCanaryAlert(env, meta, failures) {
  if (!env.RESEND_KEY) return;
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1A2418">
    <h2 style="color:#B25048;margin:0 0 10px">Signup pipeline check FAILED</h2>
    <p><strong>Event:</strong> ${escapeHtml(meta.label)} &middot; ${escapeHtml(meta.date)}</p>
    <p>The automated pre-event self-test found problems. People signing up may not be recorded, or may not get their Zoom link:</p>
    <ul>${failures.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
    <p>Please fix before the event. This alert comes from the canary that signs itself up about 36 hours out.</p></div>`;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_CONFIRM, to: CANARY_ALERT_TO, subject: `ALERT: signup pipeline failed for ${meta.label}`, html }),
    });
  } catch (e) {}
}

async function adminRunCanary(env, urlObj) {
  if (!env.EXPORT_KEY || urlObj.searchParams.get('key') !== env.EXPORT_KEY) return new Response('forbidden', { status: 403 });
  const results = await runSignupCanary(env, { force: urlObj.searchParams.get('force') === '1', dry: urlObj.searchParams.get('dry') === '1' });
  return json({ ran: true, results });
}

// =========================================================================
// Tracker-READ canary. The turnout-tracker Sheets refresh by GET-ing
// /export/*.csv with a fixed key baked into their Apps Script (SHEET_EXPORT_KEY).
// On 2026-07-08 the worker's EXPORT_KEY secret drifted from that key, so every
// Sheet's refresh got a silent 403 and froze at a stale count with no alarm.
// This runs daily (and on demand) to assert the two still match, and emails
// CANARY_ALERT_TO the moment they don't. Deterministic, no Airtable calls.
//   GET /admin/run-export-canary?key=...  -> run now, returns pass/fail
// =========================================================================
async function runExportCanary(env) {
  const failures = [];
  if (!env.EXPORT_KEY) {
    failures.push('The worker has no EXPORT_KEY secret set, so every turnout-tracker Sheet refresh returns 403 (forbidden) and shows stale data.');
  } else if (env.EXPORT_KEY !== SHEET_EXPORT_KEY) {
    failures.push('The worker EXPORT_KEY secret no longer matches the key the tracker Sheets send, so every tracker refresh returns 403 and silently keeps stale counts. Reset the worker secret to the Sheets’ key.');
  }
  if (failures.length) await sendExportCanaryAlert(env, failures);
  return { status: failures.length ? 'FAIL' : 'PASS', failures };
}

async function sendExportCanaryAlert(env, failures) {
  if (!env.RESEND_KEY) return;
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1A2418">
    <h2 style="color:#B25048;margin:0 0 10px">Turnout-tracker feed check FAILED</h2>
    <p>The automated self-test found the live turnout-tracker feed is broken. The tracker Sheets may be silently showing stale counts right now:</p>
    <ul>${failures.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
    <p>Fix: confirm the worker’s EXPORT_KEY secret matches the key in the tracker Sheets’ Apps Script. This alert comes from the hourly export canary.</p></div>`;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_CONFIRM, to: CANARY_ALERT_TO, subject: 'ALERT: turnout tracker feed is failing (EXPORT_KEY mismatch)', html }),
    });
  } catch (e) {}
}

async function adminRunExportCanary(env, urlObj) {
  if (!env.EXPORT_KEY || urlObj.searchParams.get('key') !== env.EXPORT_KEY) return new Response('forbidden', { status: 403 });
  const result = await runExportCanary(env);
  return json({ ran: true, result });
}

function resolveOutcome(outcome, methodCount) {
  // Event signups resolve via SIGNUP_OUTCOME_EVENTS so adding a future event
  // only requires an EVENT_META entry + one line in that map.
  if (SIGNUP_OUTCOME_EVENTS[outcome]) {
    return { result: 'Signed up', event: eventMeta(SIGNUP_OUTCOME_EVENTS[outcome]).attendEvent };
  }
  switch (outcome) {
    case 'oneonone':         return { result: 'Signed up',  event: '1-1 meeting' };
    case 'hm-scheduled':     return { result: 'Signed up',  event: 'House meeting scheduled' };
    case 'amp-tracker':      return { result: 'Signed up',  event: 'Amplifier tracker' };
    case 'signed-up':        // backwards compat — treat as 5/26
    case 'signed-up-5-26':   return { result: 'Signed up',  event: 'Orientation 5/26' };
    case 'connected':        return { result: 'Conversation', event: null };
    case 'skipped':          return { result: 'Skipped',     event: null };
    case 'wrong-number':     return { result: 'Wrong number', event: null };
    case 'do-not-contact':   return { result: 'Do not contact', event: null };
    case 'remove-from-list': return { result: 'Removed from list', event: null };
    default:                 return { result: methodCount > 0 ? 'No answer' : null, event: null };
  }
}

async function logOutcome(request, env) {
  const body = await request.json();
  const { contact_id, methods = [], outcome, next_step, notes, organizer = null } = body;
  if (!contact_id) return json({ error: 'contact_id required' }, 400);
  const date = todayCT();
  const { result, event } = resolveOutcome(outcome, methods.length);
  const organizerLabel = (ORGANIZER_PROFILE[String(organizer || '').toLowerCase()] || {}).name || organizer || null;

  const ADMIN_OUTCOMES = ['skipped','wrong-number','do-not-contact','remove-from-list'];
  const isAdmin = ADMIN_OUTCOMES.includes(outcome);
  if (!isAdmin && methods.length === 0) {
    return json({ error: 'no methods checked' }, 400);
  }

  const combinedNotes = [next_step, notes].filter(s => s && String(s).trim()).join(' · ');

  let records;
  if (isAdmin) {
    records = [{
      fields: {
        Summary: `${date} — ${result}`,
        date,
        method: 'Other',
        result,
        contact: [contact_id],
        ...(combinedNotes ? { notes: combinedNotes } : {}),
        ...(organizer && ORGANIZER_IDS_LC[String(organizer).toLowerCase()] ? { organizer: [ORGANIZER_IDS_LC[String(organizer).toLowerCase()]] } : {}),
      }
    }];
  } else {
    records = methods.map(m => {
      const method = METHOD_MAP[m] || m;
      const f = { Summary: `${date} — ${method}`, date, method, contact: [contact_id] };
      if (result) f.result = result;
      if (event) f.event = event;
      if (combinedNotes) f.notes = combinedNotes;
      if (organizer && ORGANIZER_IDS_LC[String(organizer).toLowerCase()]) f.organizer = [ORGANIZER_IDS_LC[String(organizer).toLowerCase()]];
      return { fields: f };
    });
  }

  const created = await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, {
    method: 'POST',
    body: JSON.stringify({ records, typecast: true })
  });

  // last_attempt_result on the CONTACT gates the Today queue (signups skip the
  // 7-day re-call cycle) and the 5/26 confirm queue (last_attempt_result='Signed up').
  // For event-specific signups we DON'T want them in the 5/26 legacy confirm
  // queue, so override to 'Conversation' — still keeps them out of the Today
  // re-call rotation.
  const signupEventKey = SIGNUP_OUTCOME_EVENTS[outcome] || null;
  const contactLastResult = signupEventKey ? 'Conversation' : result;
  // Attempt counter: every method used = one attempt (call + text = 2).
  // 5 attempts drops them off the attempted-not-reached list for good.
  let attemptCount = null;
  if (!isAdmin && methods.length > 0) {
    try {
      const cur = await at(env, `/${BASE}/${CONTACTS_TBL}/${contact_id}`);
      attemptCount = (cur.fields.attempt_count || 0) + methods.length;
    } catch (e) { /* field may not exist yet */ }
  }
  const contactFields = {
    last_attempt_date: date,
    last_attempt_method: isAdmin ? 'Other' : (METHOD_MAP[methods[0]] || methods[0]),
    last_attempt_result: contactLastResult,
    // Denormalized so the call sheet can show WHO tried last and what they
    // noted, without a per-row log query.
    last_attempt_by: organizerLabel || '',
    last_attempt_note: combinedNotes || '',
  };
  // Event-specific denormalized status field — so each event has its own
  // confirm queue without colliding on last_attempt_result.
  if (signupEventKey && eventMeta(signupEventKey).signupField) {
    contactFields[eventMeta(signupEventKey).signupField] = 'Signed up';
  }
  if (attemptCount != null) contactFields.attempt_count = attemptCount;
  if (outcome === 'oneonone') contactFields.one_on_one_booked = true;
  if (outcome === 'do-not-contact') contactFields.dnc_flag_date = date;
  // Commitments made on calls (not just the A5 form): append a dated line to
  // commitments_added so the Commitments pill shows the full arc. A separate
  // method='Commitment' log row feeds conversion stats + history.
  if (outcome === 'hm-scheduled' || outcome === 'amp-tracker') {
    const what = outcome === 'hm-scheduled'
      ? `Hosting a house meeting${body.commitment_date ? ' · ' + body.commitment_date : ''}`
      : 'Amplifier tracker started';
    try {
      const cur = await at(env, `/${BASE}/${CONTACTS_TBL}/${contact_id}`);
      const prev = String(cur.fields.commitments_added || '').trim();
      contactFields.commitments_added = prev ? `${prev}\n${date} · ${what}` : `${date} · ${what}`;
    } catch (e) { contactFields.commitments_added = `${date} · ${what}`; }
    if (outcome === 'hm-scheduled' && body.commitment_date) contactFields.house_meeting_date = body.commitment_date;
    try {
      await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, {
        method: 'POST',
        body: JSON.stringify({ records: [{ fields: {
          Summary: `${date} — Commitment: ${what}`,
          date, method: 'Commitment', result: 'Signed up',
          event: outcome === 'hm-scheduled' ? 'House meeting scheduled' : 'Amplifier tracker',
          contact: [contact_id],
          ...(organizer && ORGANIZER_IDS_LC[String(organizer).toLowerCase()] ? { organizer: [ORGANIZER_IDS_LC[String(organizer).toLowerCase()]] } : {}),
        }}], typecast: true }),
      });
    } catch (e) { /* non-fatal */ }
  }
  if (next_step) contactFields.next_step = next_step;
  await at(env, `/${BASE}/${CONTACTS_TBL}/${contact_id}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: contactFields, typecast: true })
  });

  let confirmation_email_sent = false;
  if (AUTO_CONFIRM_EMAIL && (outcome === 'signed-up' || outcome === 'signed-up-5-26' || signupEventKey)) {
    const eventKey = signupEventKey || '5_26';
    try {
      const contact = await at(env, `/${BASE}/${CONTACTS_TBL}/${contact_id}`);
      const cEmail = contact.fields.email;
      const cFirst = contact.fields.first || '';
      if (cEmail) {
        await sendConfirmationEmail(env, cEmail, cFirst, contact_id, null, eventKey);
        confirmation_email_sent = true;
      }
    } catch (e) {
      await invalidateReadCaches(env);
      return json({ ok: true, created_count: created.records.length, confirmation_email_sent: false, email_warning: e.message });
    }
  }

  await invalidateReadCaches(env);
  return json({ ok: true, created_count: created.records.length, confirmation_email_sent });
}

// Event-specific copy used by sendConfirmationEmail. To add a future event
// just add an entry here and surface it in the dashboard.
const EMAIL_EVENTS = {
  '5_26': {
    subject: `You're in — Emergency Meeting on Public School Funding · Tue 5/26 7:30 PM CT`,
    preview: 'Emergency Meeting on Public School Funding · Tue May 26 · 7:30 PM CT · Zoom',
    eyebrow: 'Emergency Meeting · Public School Funding',
    intro_event: '<strong>Emergency Meeting on Public School Funding in Missouri</strong>',
    big_date_html: 'Tue, May 26<br/>7:30 PM CT',
    sign_off_date: 'May 26th',
    zoom_link: 'https://us02web.zoom.us/j/6284644152?pwd=kweXnAjyLKIcGqxY3uxQSKeMKYfqMv.1',
  },
  '6_9': {
    subject: `You're in — Emergency Meeting on Public School Funding · Tue 6/9 7:30 PM CT`,
    preview: 'Emergency Meeting on Public School Funding · Tue June 9 · 7:30 PM CT · Zoom',
    eyebrow: 'Emergency Meeting · Public School Funding',
    intro_event: '<strong>Emergency Meeting on Public School Funding in Missouri</strong>',
    big_date_html: 'Tue, June 9<br/>7:30 PM CT',
    sign_off_date: 'June 9th',
    zoom_link: 'https://us02web.zoom.us/j/6284644152?pwd=kweXnAjyLKIcGqxY3uxQSKeMKYfqMv.1',
  },
  '6_23': {
    subject: `You're in — No on 5 Onboarding · Tue 6/23 7:30 PM CT`,
    preview: 'No on 5 Onboarding · Tue June 23 · 7:30 PM CT · Zoom',
    eyebrow: 'No on 5 Onboarding · Public School Funding',
    intro_event: '<strong>No on 5 Onboarding — protecting Missouri public school funding</strong>',
    big_date_html: 'Tue, June 23<br/>7:30 PM CT',
    sign_off_date: 'June 23rd',
    zoom_link: null, // registration now required — set via /admin/set-zoom-link when Ellen provides the registration URL
  },
  '7_7': {
    subject: `You're in — No on 5 Onboarding · Tue 7/7 7:30 PM CT`,
    preview: 'No on 5 Onboarding · Tue July 7 · 7:30 PM CT · Zoom',
    eyebrow: 'No on 5 Onboarding · Public School Funding',
    intro_event: '<strong>No on 5 Onboarding — protecting Missouri public school funding</strong>',
    big_date_html: 'Tue, July 7<br/>7:30 PM CT',
    sign_off_date: 'July 7th',
    zoom_link: null, // same
  },
  '7_21': {
    subject: `You're in — No on 5 Onboarding · Tue 7/21 7:30 PM CT`,
    preview: 'No on 5 Onboarding · Tue July 21 · 7:30 PM CT · Zoom',
    eyebrow: 'No on 5 Onboarding · Public School Funding',
    intro_event: '<strong>No on 5 Onboarding — protecting Missouri public school funding</strong>',
    big_date_html: 'Tue, July 21<br/>7:30 PM CT',
    sign_off_date: 'July 21st',
    zoom_link: null, // same
  },
  '6_30': {
    subject: `You're in — No on 5 Onboarding · Tue 6/30 7:30 PM CT`,
    preview: 'No on 5 Onboarding · Tue June 30 · 7:30 PM CT · Zoom',
    eyebrow: 'No on 5 Onboarding · Public School Funding',
    intro_event: '<strong>No on 5 Onboarding — protecting Missouri public school funding</strong>',
    big_date_html: 'Tue, June 30<br/>7:30-8:30 PM CT',
    sign_off_date: 'June 30th',
    signoff_name: 'Ellen Schwartze', // Ellen leads the 6/30 makeup, so she signs its confirmation
    zoom_link: null, // live link is in KV (zoomlink:6_30); this stays null so KV is the single source
  },
  'online_7_14': {
    subject: `You're in — How to Amplify No on 5 in Online Spaces · Tue 7/14 7 PM CT`,
    preview: 'How to Amplify No on 5 in Online Spaces · Tue July 14 · 7:00 PM CT · Zoom',
    eyebrow: 'Online Spaces Training · No on 5',
    intro_event: '<strong>How to Amplify No on 5 in Online Spaces</strong> training',
    big_date_html: 'Tue, July 14<br/>7:00-8:00 PM CT',
    sign_off_date: 'July 14th',
    signoff_name: 'Jamie Martin', // Jamie leads the online spaces training, so she signs its confirmation
    signoff_reply_to: 'docjamieb@gmail.com',
    zoom_link: null, // live link is in KV (zoomlink:online_7_14); stays null so KV is the single source
  },
  'amp_7_19': {
    subject: `You're in — Voices for Small Schools Amplifier Training · Sun 7/19 7 PM CT`,
    preview: 'Voices for Small Schools of Missouri Amplifier Training · Sun July 19 · 7:00 PM CT · Zoom',
    eyebrow: 'Amplifier Training · Small & Rural Schools',
    intro_event: '<strong>Voices for Small Schools of Missouri Amplifier Training</strong>',
    big_date_html: 'Sun, July 19<br/>7:00-8:00 PM CT',
    sign_off_date: 'July 19th',
    signoff_name: 'Laci Horn', // Laci leads the Voices for Small Schools training, so she signs its confirmation
    signoff_reply_to: 'lacihorn8@gmail.com',
    zoom_link: null, // live link is in KV (zoomlink:amp_7_19); stays null so KV is the single source
  },
};

// Generated confirmation-email copy for events (trainings) without a
// hand-written EMAIL_EVENTS entry. Assumes the org's shared Zoom room —
// confirm with Ellen if trainings ever get their own links.
function autoEmailEvent(key) {
  const meta = EVENT_META[key];
  if (!meta) return null;
  const d = new Date(meta.date + 'T12:00:00');
  const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
  const monthName = ['January','February','March','April','May','June','July','August','September','October','November','December'][d.getMonth()];
  const mdy = `${d.getMonth()+1}/${d.getDate()}`;
  const time = meta.time || '7:30pm CT';
  const fullTitle = meta.type === 'hm' ? 'House Meeting Training'
    : meta.type === 'amp' ? 'Amplifier Training'
    : meta.label;
  return {
    subject: `You're in — ${fullTitle} · ${dayName} ${mdy} ${time}`,
    preview: `${fullTitle} · ${dayName} ${monthName} ${d.getDate()} · ${time} · ${meta.inPerson ? 'In person' : 'Zoom'}`,
    eyebrow: `${fullTitle} · Parents for Missouri Public Schools`,
    intro_event: `<strong>${fullTitle}</strong>`,
    big_date_html: `${dayName}, ${monthName} ${d.getDate()}<br/>${time}`,
    sign_off_date: `${monthName} ${d.getDate()}`,
    zoom_link: null, // trainings: link set via /admin/set-zoom-link per event
  };
}

// --- Calendar invite (.ics) attached to confirmation emails. The signup pages
// promise "the Zoom link and a calendar invite," so every confirmation carries a
// VEVENT (America/Chicago, with the Zoom link as location/URL once it is set).
const ICS_TZ = [
  'BEGIN:VTIMEZONE', 'TZID:America/Chicago',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0600', 'TZOFFSETTO:-0500', 'TZNAME:CDT', 'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0600', 'TZNAME:CST', 'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD',
  'END:VTIMEZONE',
].join('\r\n');
const ICS_TYPE_DURATION = { makeup: 60, onboarding: 60, legacy: 60, hm: 75, amp: 90, kyn: 180 };
function parseEventTime(t) {
  const m = String(t || '').match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!m) return { h: 19, m: 0 };
  let h = parseInt(m[1], 10); const mi = m[2] ? parseInt(m[2], 10) : 0; const ap = m[3].toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return { h, m: mi };
}
function icsEscape(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
function buildEventIcs(eventKey, ev, attendeeEmail, attendeeName, method) {
  method = method === 'PUBLISH' ? 'PUBLISH' : 'REQUEST';
  const meta = EVENT_META[eventKey];
  if (!meta || !meta.date) return null;
  const [Y, Mo, D] = meta.date.split('-').map(n => parseInt(n, 10));
  if (!Y || !Mo || !D) return null;
  const { h, m } = parseEventTime(meta.time);
  const dur = ICS_TYPE_DURATION[meta.type] || 60;
  const pad = n => String(n).padStart(2, '0');
  let eh = h, em = m + dur; eh += Math.floor(em / 60); em = em % 60;
  const start = `${Y}${pad(Mo)}${pad(D)}T${pad(h)}${pad(m)}00`;
  const end = `${Y}${pad(Mo)}${pad(D)}T${pad(eh)}${pad(em)}00`;
  const link = (ev && ev.zoom_link) || '';
  const summary = meta.icsTitle
    ? meta.icsTitle
    : ['onboarding', 'legacy', 'makeup'].includes(meta.type)
    ? 'No on 5 Onboarding (Parents for Missouri Public Schools)'
    : `${meta.label} (Parents for Missouri Public Schools)`;
  const loc = meta.inPerson ? (link || 'In person (details by email)') : (link ? 'Zoom' : 'Zoom (link by email)');
  const desc = (meta.inPerson ? '' : (link ? `Join on Zoom: ${link}\n\n` : 'Your Zoom link arrives by email before the event.\n\n'))
    + 'Parents for Missouri Public Schools. Vote NO on Amendment 5 to protect Missouri public school funding. Aug 4.';
  let stamp = '20260101T000000Z';
  try { stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); } catch (e) {}
  // Stable UID per person+event so a re-send UPDATES the same calendar entry (no duplicates).
  const uid = `${eventKey}-${String(attendeeEmail || 'invite').toLowerCase().replace(/[^a-z0-9]/g, '')}@parents4mopublicschools.org`;
  // METHOD:REQUEST + ORGANIZER + ATTENDEE is what makes Gmail/Outlook render the inline
  // RSVP card and auto-add to the calendar, instead of showing a plain .ics attachment.
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//P4MPS//Groundwork//EN', 'CALSCALE:GREGORIAN', `METHOD:${method}`, ICS_TZ,
    'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${stamp}`, 'SEQUENCE:0', 'STATUS:CONFIRMED', 'TRANSP:OPAQUE',
    `DTSTART;TZID=America/Chicago:${start}`, `DTEND;TZID=America/Chicago:${end}`,
    `SUMMARY:${icsEscape(summary)}`, `LOCATION:${icsEscape(loc)}`, `DESCRIPTION:${icsEscape(desc)}`,
    (link && !meta.inPerson) ? `URL:${icsEscape(link)}` : '',
    'ORGANIZER;CN=Parents for Missouri Public Schools:mailto:groundwork@civicpowerlab.us',
    (method === 'REQUEST' && attendeeEmail) ? `ATTENDEE;CN=${icsEscape(attendeeName || attendeeEmail)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${attendeeEmail}` : '',
    'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean);
  return lines.join('\r\n');
}

// nth Sunday (1-indexed) of a month, as a day-of-month. Used for US DST bounds.
function nthSundayOfMonth(year, month1, n) {
  const firstDow = new Date(Date.UTC(year, month1 - 1, 1)).getUTCDay(); // 0=Sun
  const firstSun = 1 + ((7 - firstDow) % 7);
  return firstSun + (n - 1) * 7;
}
// Is this date inside US Central daylight time (CDT)? DST = 2nd Sun March .. 1st Sun Nov.
function chicagoIsDST(Y, Mo, D) {
  if (Mo < 3 || Mo > 11) return false;
  if (Mo > 3 && Mo < 11) return true;
  if (Mo === 3) return D >= nthSundayOfMonth(Y, 3, 2);
  return D < nthSundayOfMonth(Y, 11, 1); // November
}
// "Add to calendar" deep links for Google + Outlook web, generated from EVENT_META so
// they always match the displayed time. Apple/Outlook-desktop use the /event.ics download.
function calendarLinks(eventKey, ev) {
  const meta = EVENT_META[eventKey];
  if (!meta || !meta.date) return null;
  const [Y, Mo, D] = meta.date.split('-').map(n => parseInt(n, 10));
  if (!Y || !Mo || !D) return null;
  const { h, m } = parseEventTime(meta.time);
  const dur = ICS_TYPE_DURATION[meta.type] || 60;
  const pad = n => String(n).padStart(2, '0');
  let eh = h, em = m + dur; eh += Math.floor(em / 60); em = em % 60;
  const localStart = `${Y}${pad(Mo)}${pad(D)}T${pad(h)}${pad(m)}00`;
  const localEnd = `${Y}${pad(Mo)}${pad(D)}T${pad(eh)}${pad(em)}00`;
  const off = chicagoIsDST(Y, Mo, D) ? 5 : 6;            // hours to add to CT to get UTC
  const su = new Date(Date.UTC(Y, Mo - 1, D, h + off, m));
  const eu = new Date(Date.UTC(Y, Mo - 1, D, h + off, m + dur));
  const isoZ = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00Z`;
  const title = meta.icsTitle
    ? meta.icsTitle
    : ['onboarding', 'legacy', 'makeup'].includes(meta.type)
    ? 'No on 5 Onboarding (Parents for Missouri Public Schools)'
    : `${meta.label} (Parents for Missouri Public Schools)`;
  const link = (ev && ev.zoom_link) || '';
  const loc = meta.inPerson ? 'In person (details by email)' : 'Zoom';
  const details = (link ? `Join on Zoom: ${link}\n\n` : '') + 'Parents for Missouri Public Schools.';
  const enc = encodeURIComponent;
  return {
    google: `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${enc(title)}&dates=${localStart}/${localEnd}&ctz=America/Chicago&details=${enc(details)}&location=${enc(loc)}`,
    outlook: `https://outlook.office.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=${enc(title)}&startdt=${enc(isoZ(su))}&enddt=${enc(isoZ(eu))}&body=${enc(details)}&location=${enc(loc)}`,
  };
}

// In-person regional launches. The RSVP form posts the launch name; we match on a substring.
const LAUNCH_EVENTS = {
  ejack: {
    name: 'Eastern Jackson County Emergency Meeting on Public School Funding',
    date: '2026-07-01', start: '18:00', end: '19:30', dateLabel: 'Wednesday, July 1 · 6:00 PM CT',
    location: 'The Table, 3609 SW State Rte 7, Blue Springs, MO 64014',
    logistics: 'Pizza at 6:00 PM, program 6:30–7:30 PM. Childcare available with RSVP.',
  },
  stl: {
    name: 'St. Louis County Parent Action Meeting',
    date: '2026-07-06', start: '18:00', end: '19:30', dateLabel: 'Monday, July 6 · 6:00 PM CT',
    location: 'Oak Bend Branch, St. Louis County Library, 842 S Holmes Ave, St. Louis, MO 63122',
    logistics: 'Pizza and community 6:00–6:30 PM, program 6:30–7:30 PM.',
  },
  stc: {
    name: 'St. Charles County Parent Action Meeting',
    date: '2026-07-15', start: '18:00', end: '19:30', dateLabel: 'Wednesday, July 15 · 6:00 PM CT',
    location: 'Middendorf-Kredell Library, 2750 Hwy K, O\'Fallon, MO 63368',
    logistics: 'Pizza and community from 6:00 PM. Childcare available with RSVP.',
  },
  kc: {
    name: 'Kansas City No on 5 Regional Campaign Launch',
    date: '2026-07-09', start: '17:30', end: '19:30', dateLabel: 'Thursday, July 9 · 5:30 PM CT',
    location: 'Trinity United Methodist Church, 620 E Armour Blvd, Kansas City, MO 64109',
    logistics: 'Program 5:30–7:30 PM. Pizza and childcare available with RSVP.',
  },
  teacher: {
    name: 'Teacher Meeting on Public School Funding',
    date: '2026-07-21', start: '19:00', end: '20:00', dateLabel: 'Tuesday, July 21 · 7:00 PM CT',
    location: 'The Combine, 2999 Troost Ave, Kansas City, MO',
    logistics: 'Appetizers provided. Drinks available for purchase.',
  },
};
function launchConfig(launchName) {
  const s = String(launchName || '').toLowerCase();
  if (s.includes('teacher meeting')) return LAUNCH_EVENTS.teacher;
  if (s.includes('st. charles') || s.includes('st charles')) return LAUNCH_EVENTS.stc;
  if (s.includes('st. louis') || s.includes('st louis')) return LAUNCH_EVENTS.stl;
  if (s.includes('eastern jackson')) return LAUNCH_EVENTS.ejack;
  if (s.includes('kansas city')) return LAUNCH_EVENTS.kc;
  return null;
}
function buildLaunchIcs(cfg, email, name) {
  const [Y, Mo, D] = cfg.date.split('-').map(n => parseInt(n, 10));
  const [sh, sm] = cfg.start.split(':').map(n => parseInt(n, 10));
  const [eh, em] = cfg.end.split(':').map(n => parseInt(n, 10));
  const pad = n => String(n).padStart(2, '0');
  const start = `${Y}${pad(Mo)}${pad(D)}T${pad(sh)}${pad(sm)}00`, end = `${Y}${pad(Mo)}${pad(D)}T${pad(eh)}${pad(em)}00`;
  let stamp = '20260101T000000Z'; try { stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); } catch (e) {}
  const uid = `launch-${cfg.date}-${String(email || 'invite').toLowerCase().replace(/[^a-z0-9]/g, '')}@parents4mopublicschools.org`;
  const summary = `${cfg.name} (Parents for Missouri Public Schools)`;
  const desc = `${cfg.logistics}\n\nLocation: ${cfg.location}\n\nParents for Missouri Public Schools. Vote NO on Amendment 5 to protect Missouri public school funding. Tuesday, August 4.`;
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//P4MPS//Groundwork//EN', 'CALSCALE:GREGORIAN', 'METHOD:REQUEST', ICS_TZ,
    'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${stamp}`, 'SEQUENCE:0', 'STATUS:CONFIRMED', 'TRANSP:OPAQUE',
    `DTSTART;TZID=America/Chicago:${start}`, `DTEND;TZID=America/Chicago:${end}`,
    `SUMMARY:${icsEscape(summary)}`, `LOCATION:${icsEscape(cfg.location)}`, `DESCRIPTION:${icsEscape(desc)}`,
    'ORGANIZER;CN=Parents for Missouri Public Schools:mailto:groundwork@civicpowerlab.us',
    email ? `ATTENDEE;CN=${icsEscape(name || email)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${email}` : '',
    'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
}
async function sendLaunchConfirmation(env, toEmail, firstName, launchName) {
  if (!env.RESEND_KEY || !toEmail) return false;
  const cfg = launchConfig(launchName);
  if (!cfg) return false;
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi there,';
  const pad = n => String(n).padStart(2, '0');
  const [Y, Mo, D] = cfg.date.split('-').map(n => parseInt(n, 10));
  const [sh, sm] = cfg.start.split(':').map(n => parseInt(n, 10));
  const [eh, em] = cfg.end.split(':').map(n => parseInt(n, 10));
  const gdates = `${Y}${pad(Mo)}${pad(D)}T${pad(sh)}${pad(sm)}00/${Y}${pad(Mo)}${pad(D)}T${pad(eh)}${pad(em)}00`;
  const gcal = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(cfg.name)}&dates=${gdates}&location=${encodeURIComponent(cfg.location)}&details=${encodeURIComponent(cfg.logistics)}&ctz=America/Chicago`;
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1A2418">`
    + `<div style="background:#3e4f6e;padding:16px 22px;border-radius:8px 8px 0 0"><div style="color:#d5b069;font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.14em">Parents for Missouri Public Schools</div></div>`
    + `<div style="border:1px solid #e5e5e5;border-top:none;border-radius:0 0 8px 8px;padding:22px">`
    + `<p style="font-size:16px;margin:0 0 14px">${greeting}</p>`
    + `<p style="font-size:15px;line-height:1.6;margin:0 0 16px">You're RSVP'd for the <strong>${escapeHtml(cfg.name)}</strong>. Thank you for showing up for Missouri's public schools.</p>`
    + `<div style="background:#f3f4f6;border-radius:8px;padding:16px 18px;margin:0 0 16px">`
    + `<div style="font-size:15px;margin:0 0 6px">📅 <strong>${escapeHtml(cfg.dateLabel)}</strong></div>`
    + `<div style="font-size:15px;margin:0 0 8px">📍 <strong>${escapeHtml(cfg.location)}</strong></div>`
    + `<div style="font-size:14px;color:#555;line-height:1.5">${escapeHtml(cfg.logistics)}</div></div>`
    + `<p style="font-size:14px;line-height:1.6;margin:0 0 12px">A calendar invite is attached — tap it to add this to your calendar, or:</p>`
    + `<div style="margin:0 0 16px"><a href="${gcal}" style="display:inline-block;background:#d5b069;color:#1A2418;font-weight:700;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px">Add to Google Calendar</a></div>`
    + `<p style="font-size:13px;color:#888;line-height:1.5;margin:14px 0 0">Questions? Just reply to this email. Vote NO on Amendment 5 to protect Missouri public school funding. Vote Tuesday, August 4.</p>`
    + `<p style="font-size:11px;color:#aaa;line-height:1.4;margin:16px 0 0;font-family:Helvetica,Arial,sans-serif">Paid for by Parents for Missouri Public Schools, Ellen Glover, Treasurer</p>`
    + `</div></div>`;
  const ics = buildLaunchIcs(cfg, toEmail, firstName);
  const payload = { from: FROM_CONFIRM, to: [toEmail], reply_to: 'groundwork@civicpowerlab.us', subject: `You're RSVP'd — ${cfg.name}`, html,
    attachments: [{ filename: 'invite.ics', content: btoa(unescape(encodeURIComponent(ics))), content_type: 'text/calendar; charset=utf-8; method=REQUEST' }] };
  try {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Authorization': `Bearer ${env.RESEND_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return r.ok;
  } catch (e) { return false; }
}

// "Location confirmed" announcement to people who RSVP'd while the venue was
// TBD. Same branding/ICS as the RSVP confirmation, but the copy leads with the
// venue, and the calendar invite carries SEQUENCE:1 with the SAME UID so
// calendar apps UPDATE the existing event's location instead of ignoring a
// duplicate. Triggered once per launch via /admin/send-venue-update.
async function sendVenueUpdate(env, toEmail, firstName, launchName) {
  if (!env.RESEND_KEY || !toEmail) return false;
  const cfg = launchConfig(launchName);
  if (!cfg) return false;
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi there,';
  const pad = n => String(n).padStart(2, '0');
  const [Y, Mo, D] = cfg.date.split('-').map(n => parseInt(n, 10));
  const [sh, sm] = cfg.start.split(':').map(n => parseInt(n, 10));
  const [eh, em] = cfg.end.split(':').map(n => parseInt(n, 10));
  const gdates = `${Y}${pad(Mo)}${pad(D)}T${pad(sh)}${pad(sm)}00/${Y}${pad(Mo)}${pad(D)}T${pad(eh)}${pad(em)}00`;
  const gcal = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(cfg.name)}&dates=${gdates}&location=${encodeURIComponent(cfg.location)}&details=${encodeURIComponent(cfg.logistics)}&ctz=America/Chicago`;
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1A2418">`
    + `<div style="background:#3e4f6e;padding:16px 22px;border-radius:8px 8px 0 0"><div style="color:#d5b069;font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.14em">Parents for Missouri Public Schools</div></div>`
    + `<div style="border:1px solid #e5e5e5;border-top:none;border-radius:0 0 8px 8px;padding:22px">`
    + `<p style="font-size:16px;margin:0 0 14px">${greeting}</p>`
    + `<p style="font-size:15px;line-height:1.6;margin:0 0 16px">When you RSVP'd for the <strong>${escapeHtml(cfg.name)}</strong>, we promised to email you as soon as the location was confirmed. It is:</p>`
    + `<div style="background:#f3f4f6;border-radius:8px;padding:16px 18px;margin:0 0 16px">`
    + `<div style="font-size:16px;margin:0 0 8px">📍 <strong>${escapeHtml(cfg.location)}</strong></div>`
    + `<div style="font-size:15px;margin:0 0 8px">📅 <strong>${escapeHtml(cfg.dateLabel)}</strong></div>`
    + `<div style="font-size:14px;color:#555;line-height:1.5">${escapeHtml(cfg.logistics)}</div></div>`
    + `<p style="font-size:14px;line-height:1.6;margin:0 0 12px">An updated calendar invite is attached — open it and your calendar will correct itself. Or:</p>`
    + `<div style="margin:0 0 16px"><a href="${gcal}" style="display:inline-block;background:#d5b069;color:#1A2418;font-weight:700;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px">Add to Google Calendar</a></div>`
    + `<p style="font-size:14px;line-height:1.6;margin:0 0 12px">We can't wait to see you there.</p>`
    + `<p style="font-size:13px;color:#888;line-height:1.5;margin:14px 0 0">Questions? Just reply to this email. Vote NO on Amendment 5 to protect Missouri public school funding. Vote Tuesday, August 4.</p>`
    + `<p style="font-size:11px;color:#aaa;line-height:1.4;margin:16px 0 0;font-family:Helvetica,Arial,sans-serif">Paid for by Parents for Missouri Public Schools, Ellen Glover, Treasurer</p>`
    + `</div></div>`;
  // SEQUENCE:1 + same UID = calendar clients treat this as an update to the original invite.
  const ics = buildLaunchIcs(cfg, toEmail, firstName).replace('SEQUENCE:0', 'SEQUENCE:1');
  const payload = { from: FROM_CONFIRM, to: [toEmail], reply_to: 'groundwork@civicpowerlab.us', subject: `Location confirmed — ${cfg.name}`, html,
    attachments: [{ filename: 'invite.ics', content: btoa(unescape(encodeURIComponent(ics))), content_type: 'text/calendar; charset=utf-8; method=REQUEST' }] };
  try {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Authorization': `Bearer ${env.RESEND_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return r.ok;
  } catch (e) { return false; }
}

// One-shot venue-announcement blast for a launch's existing RSVPs.
// GET  /admin/send-venue-update?key=EXPORT_KEY&launch=<rsvp_launch value>&dry=1  → preview list
// POST /admin/send-venue-update?key=EXPORT_KEY&launch=...                        → send for real
async function adminSendVenueUpdate(request, env, urlObj) {
  if (urlObj.searchParams.get('key') !== env.EXPORT_KEY) return json({ error: 'forbidden' }, 403);
  const launch = urlObj.searchParams.get('launch') || '';
  if (!launchConfig(launch)) return json({ error: 'unknown launch (no launchConfig match)' }, 400);
  const dry = urlObj.searchParams.get('dry') === '1' || request.method === 'GET';
  const evEsc = launch.replace(/'/g, "\\'");
  const q = `?filterByFormula=${encodeURIComponent(`AND({method}='Event RSVP',{rsvp_launch}='${evEsc}')`)}&pageSize=100&fields%5B%5D=contact`;
  const res = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
  const seen = new Set(); const recipients = [];
  for (const r of (res.records || [])) {
    const cid = (r.fields.contact || [])[0];
    if (!cid) continue;
    const c = await at(env, `/${BASE}/${CONTACTS_TBL}/${cid}`);
    const email = String(c.fields.email || '').trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    recipients.push({ email, first: c.fields.first || '' });
  }
  if (dry) return json({ dry_run: true, launch, count: recipients.length, recipients });
  let sent = 0; const failed = [];
  for (const p of recipients) {
    const ok = await sendVenueUpdate(env, p.email, p.first, launch);
    if (ok) sent++; else failed.push(p.email);
  }
  return json({ ok: true, launch, sent, failed });
}

async function sendConfirmationEmail(env, toEmail, firstName, contactId, organizer, eventKey) {
  const date = todayCT();
  const safeName = firstName ? firstName : '';
  const greetingComma = safeName ? `, ${escapeHtml(safeName)}` : '';
  const profile = ORGANIZER_PROFILE[String(organizer || '').toLowerCase()] || ORGANIZER_PROFILE['lanee'];
  let replyTo = profile.reply_to;
  let signoffName = profile.name;
  const signoffGroup = profile.group;
  const ev = { ...(EMAIL_EVENTS[String(eventKey || '5_26')] || autoEmailEvent(String(eventKey || '5_26')) || EMAIL_EVENTS['5_26']) };
  if (ev.signoff_name) signoffName = ev.signoff_name;   // per-event signer (e.g., Ellen leads 6/30)
  if (ev.signoff_reply_to) replyTo = ev.signoff_reply_to;   // per-event reply-to (e.g., Jamie leads online_7_14)
  // Per-event link override (set by /admin/set-zoom-link, no redeploy needed).
  try {
    const kvLink = await env.KV_BINDING.get(`zoomlink:${String(eventKey || '5_26')}`);
    if (kvLink) ev.zoom_link = kvLink;
  } catch (e) {}
  const evMeta = EVENT_META[String(eventKey || '5_26')] || {};
  const isInPerson = !!evMeta.inPerson;   // in-person events (e.g. Know Your Neighbor) never mention Zoom
  // "Add to calendar" buttons — reliable one-click across clients, unlike the inline
  // rendering of the attached invite. Generated from EVENT_META so they track the time.
  let calButtonsHtml = '';
  const cal = calendarLinks(String(eventKey || '5_26'), ev);
  if (cal) {
    const icsUrl = `https://groundwork-pilot.elizabethmck.workers.dev/event.ics?event=${encodeURIComponent(String(eventKey || '5_26'))}`;
    const btn = 'display:inline-block;border:1.5px solid #1A2418;color:#1A2418;text-decoration:none;font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:12px;letter-spacing:.03em;padding:9px 14px;border-radius:7px;margin:0 6px 6px 0';
    calButtonsHtml = `
        <tr><td style="padding:0 0 20px">
          <div style="font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:#1A2418;opacity:.55;margin:0 0 9px">Add to your calendar</div>
          <a href="${cal.google}" style="${btn}">Google Calendar</a>
          <a href="${cal.outlook}" style="${btn}">Outlook</a>
          <a href="${icsUrl}" style="${btn}">Apple / .ics</a>
        </td></tr>`;
  }
  const subject = ev.subject;
  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>You're in — Parents for Missouri Public Schools</title>
</head>
<body style="margin:0;padding:0;background:#E9E5CE;font-family:Helvetica,Arial,sans-serif;color:#1A2418">

<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#E9E5CE">
${ev.preview}
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#E9E5CE" style="background:#E9E5CE">
  <tr>
    <td align="center" style="padding:32px 16px">

      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%">

        <tr><td align="center" style="padding:0 0 26px">
          <img src="https://parents4mopublicschools.org/brand/logo-circle-512.png" width="120" height="120" alt="Parents for Missouri Public Schools" style="display:block;border:0;border-radius:50%;margin:0 auto 10px">
          <div style="font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:13px;line-height:1.2;text-transform:uppercase;letter-spacing:.04em;color:#1A2418;white-space:nowrap">Parents for Missouri Public Schools</div>
        </td></tr>

        <tr><td style="padding:0 0 20px">
          <h1 style="margin:0;font-family:Helvetica,Arial,sans-serif;font-weight:800;font-size:44px;line-height:.95;letter-spacing:.005em;text-transform:uppercase;color:#1A2418">
            You're in.
          </h1>
        </td></tr>

        <tr><td style="padding:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A2418">
          Hi${greetingComma}, thank you for committing to join our ${ev.intro_event}. We are mobilizing parents, community members, educators, and advocates to respond quickly and strategically to current threats to public school funding in our state.
        </td></tr>

        <tr><td style="padding:6px 0 22px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#D9D5C0" style="background:#D9D5C0;border:2px solid #1A2418;border-radius:14px">
            <tr><td style="padding:20px 22px">
              <div style="font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.14em;color:#2F5E3D;margin:0 0 8px">
                ${ev.eyebrow}
              </div>
              <div style="font-family:Helvetica,Arial,sans-serif;font-weight:800;font-size:22px;line-height:1.15;text-transform:uppercase;letter-spacing:.01em;color:#1A2418;margin:0 0 6px">
                ${ev.big_date_html}
              </div>
              <div style="font-family:Helvetica,Arial,sans-serif;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#1A2418;opacity:.65">
                ${isInPerson ? 'In person' : 'On Zoom'}
              </div>
              <div style="margin:18px 0 0">
                ${isInPerson
                  ? `<div style="font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:14px;color:#1A2418">You're confirmed. Location details arrive by email before the event.</div>`
                  : (ev.zoom_link
                    ? `<a href="${ev.zoom_link}" style="display:inline-block;background:#1A2418;color:#E9E5CE;text-decoration:none;font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:15px;text-transform:uppercase;letter-spacing:.06em;padding:14px 26px;border-radius:8px">Join the Zoom →</a>`
                    : `<div style="font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:14px;color:#1A2418">You're confirmed. The Zoom link arrives by email before the event.</div>`)}
              </div>
              <div style="margin:12px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;word-break:break-all">
                ${(!isInPerson && ev.zoom_link) ? `<a href="${ev.zoom_link}" style="color:#3e4f6e;text-decoration:underline">${ev.zoom_link}</a>` : ''}
              </div>
            </td></tr>
          </table>
        </td></tr>
${calButtonsHtml}
        <tr><td style="padding:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1A2418">
          Your presence matters. The decisions being made right now could have long-term consequences for Missouri families and public education. We need informed, connected, and prepared people ready to take action together.
        </td></tr>

        <tr><td style="padding:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1A2418">
          If something changes and you are unable to attend live, please reply to this email so we can schedule a 1:1 conversation to review the information and help get you plugged into next steps.
        </td></tr>

        <tr><td style="padding:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1A2418">
          <strong>Help us reach more parents.</strong> Please forward this email to <strong>three other parents</strong>, educators, or neighbors who care about public schools, and ask them to sign up at <a href="https://parents4mopublicschools.org/" style="color:#1A2418;text-decoration:underline"><strong>parents4mopublicschools.org</strong></a>. Every parent we bring in makes our movement for Missouri's kids stronger.
        </td></tr>

        <tr><td style="padding:0 0 28px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1A2418">
          We look forward to seeing you on ${ev.sign_off_date}.
        </td></tr>

        <tr><td style="padding:0 0 36px">
          <div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1A2418">In solidarity,</div>
          <div style="font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:15px;line-height:1.35;color:#1A2418;margin-top:6px">${signoffName}</div>
          <div style="font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.16em;color:#B25048;margin-top:4px">${signoffGroup}</div>
        </td></tr>

        <tr><td style="padding-top:18px;border-top:1px dashed rgba(26,36,24,.25);font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.55;color:#1A2418">
          Parents for Missouri Public Schools<br/>
          <a href="mailto:${replyTo}" style="color:#1A2418;text-decoration:underline">${replyTo}</a>
        </td></tr>

        <tr><td style="padding:14px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:10px;line-height:1.55;letter-spacing:.12em;text-transform:uppercase;color:#1A2418;opacity:.55">
          You're receiving this because you committed to the Emergency Meeting on Public School Funding. Reply to this email if you'd like to be removed.
        </td></tr>

      </table>

    </td>
  </tr>
</table>

</body>
</html>`;
  const payload = { from: FROM_CONFIRM, to: [toEmail], reply_to: replyTo, subject, html };
  // Attach the calendar invite (.ics) the signup pages promise.
  try {
    const ics = buildEventIcs(String(eventKey || '5_26'), ev, toEmail, firstName);
    if (ics) {
      payload.attachments = [{
        filename: 'invite.ics',
        content: btoa(unescape(encodeURIComponent(ics))),
        content_type: 'text/calendar; charset=utf-8; method=REQUEST',
      }];
    }
  } catch (e) { /* invite is best-effort; never block the confirmation email */ }
  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!emailRes.ok) throw new Error(`email send failed: ${await emailRes.text()}`);

  // Log against the EVENT'S confirm tag (was hardcoded to 'Confirm 5/26',
  // which meant 6/9+ zoom sends never showed as email_sent on their tabs).
  // Result is 'Zoom link sent' — a distinct value from the manual confirmation funnel
  // (Reminder sent / Confirmed / Cancelled) so the attendance-mirror sync doesn't
  // conflate an automated Zoom send with a hand-sent reminder LaNeé actually made.
  await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, {
    method: 'POST',
    body: JSON.stringify({
      records: [{
        fields: {
          Summary: `${date} — Email (auto Zoom confirm)`,
          date,
          method: 'Email',
          result: 'Zoom link sent',
          event: eventMeta(String(eventKey || '5_26')).confirmEvent,
          contact: [contactId],
          notes: 'Auto-sent Zoom confirmation on signup',
        }
      }],
      typecast: true
    })
  });
}

async function undoSave(request, env) {
  const body = await request.json();
  const { contact_id } = body;
  if (!contact_id) return json({ error: 'contact_id required' }, 400);
  const date = todayCT();
  const filter = `{date}=DATETIME_PARSE('${date}')`;
  const allToday = [];
  let offset = null;
  do {
    let q = `?filterByFormula=${encodeURIComponent(filter)}&pageSize=100&fields%5B%5D=contact`;
    if (offset) q += `&offset=${offset}`;
    const data = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
    allToday.push(...data.records);
    offset = data.offset;
  } while (offset);
  const ids = allToday.filter(r => (r.fields.contact || []).includes(contact_id)).map(r => r.id);
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i+10);
    const url = new URL(`https://api.airtable.com/v0/${BASE}/${CONTACT_LOG_TBL}`);
    for (const id of batch) url.searchParams.append('records[]', id);
    const r = await fetch(url, { method: 'DELETE', headers: { 'Authorization': `Bearer ${env.AIRTABLE_TOKEN}` } });
    if (r.ok) deleted += batch.length;
  }
  // Recompute attempt counter + 1-1 flag from the logs that survived the undo
  let remainingAttempts = 0, stillOneOnOne = false;
  try {
    const c = await at(env, `/${BASE}/${CONTACTS_TBL}/${contact_id}`);
    const ids2 = Array.isArray(c.fields.contact_log) ? c.fields.contact_log : [];
    for (let i = 0; i < ids2.length; i += 10) {
      const chunk = ids2.slice(i, i + 10);
      const f2 = `OR(${chunk.map(id => `RECORD_ID()='${id}'`).join(',')})`;
      const d2 = await at(env, `/${BASE}/${CONTACT_LOG_TBL}?filterByFormula=${encodeURIComponent(f2)}&pageSize=10&fields%5B%5D=method&fields%5B%5D=event`);
      for (const r2 of d2.records) {
        if (['Call', 'Text', 'Email'].includes(r2.fields.method)) remainingAttempts++;
        if (r2.fields.event === '1-1 meeting') stillOneOnOne = true;
      }
    }
  } catch (e) { remainingAttempts = null; }
  await at(env, `/${BASE}/${CONTACTS_TBL}/${contact_id}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: {
      last_attempt_date: null, last_attempt_method: null,
      last_attempt_result: null, next_step: '',
      last_attempt_by: '', last_attempt_note: '',
      ...(remainingAttempts != null ? { attempt_count: remainingAttempts, one_on_one_booked: stillOneOnOne } : {}),
    }, typecast: true })
  });
  await invalidateReadCaches(env);
  return json({ ok: true, deleted });
}

async function getConfirmees(env, urlObj) {
  const organizer = urlObj ? urlObj.searchParams.get('organizer') : null;
  const eventParam = urlObj ? (urlObj.searchParams.get('event') || '5_26') : '5_26';
  const cacheKey = `cache:confirmees:${eventParam}:${organizer || 'all'}`;
  const cached = await cacheGet(env, cacheKey);
  if (cached) return json(cached);

  // Pick which "signed up" field gates the queue. Default is 5/26 for back-compat.
  // 5/26 still uses {last_attempt_result}='Signed up' because that's the
  // historical source of truth before we introduced denormalized status fields.
  const meta = eventMeta(eventParam);
  const signupClause = meta.signupField
    ? `{${meta.signupField}}='Signed up'`
    : `{last_attempt_result}='Signed up'`;
  const orgFullName = organizerName(organizer);
  const filter = orgFullName
    ? `AND(${signupClause},FIND('${orgFullName}',{assigned_organizer}&'')>0)`
    : signupClause;
  const fields = ['Name','first','last','phone','email','school','district','last_attempt_date','source','signup_6_9_status'];
  if (meta.signupField && !fields.includes(meta.signupField)) fields.push(meta.signupField);
  if (!fields.includes(meta.attendField)) fields.push(meta.attendField);
  // Paginate fully — no hard cap. Each page = 100 records.
  const allContacts = [];
  {
    let coffset = null;
    do {
      let q = `?filterByFormula=${encodeURIComponent(filter)}&pageSize=100`;
      for (const f of fields) q += `&fields%5B%5D=${encodeURIComponent(f)}`;
      if (coffset) q += `&offset=${encodeURIComponent(coffset)}`;
      const page = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
      allContacts.push(...page.records);
      coffset = page.offset;
    } while (coffset);
  }
  const contactsData = { records: allContacts };

  const confirmLogs = [];
  let offset = null;
  const lf = `{event}='${eventMeta(eventParam).confirmEvent}'`;
  do {
    let lq = `?filterByFormula=${encodeURIComponent(lf)}&pageSize=100&fields%5B%5D=contact&fields%5B%5D=method&fields%5B%5D=result&fields%5B%5D=date`;
    if (offset) lq += `&offset=${offset}`;
    const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${lq}`);
    confirmLogs.push(...d.records);
    offset = d.offset;
  } while (offset);

  // Attendance logs (Orientation 5/26 + method='Event attendance' + result='Attended' or 'No-show')
  const attendanceByContact = {};
  const af = `AND({event}='${eventMeta(eventParam).attendEvent}',{method}='Event attendance',OR({result}='Attended',{result}='No-show',{result}='Walk-in'))`;
  offset = null;
  do {
    let aq = `?filterByFormula=${encodeURIComponent(af)}&pageSize=100&fields%5B%5D=contact&fields%5B%5D=result&fields%5B%5D=date`;
    if (offset) aq += `&offset=${offset}`;
    const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${aq}`);
    for (const r of d.records) {
      const cid = (r.fields.contact || [])[0];
      if (!cid) continue;
      // Keep most-recent attendance result
      const prev = attendanceByContact[cid];
      if (!prev || (r.fields.date && r.fields.date > prev.date)) {
        attendanceByContact[cid] = { result: r.fields.result, date: r.fields.date };
      }
    }
    offset = d.offset;
  } while (offset);

  const stateByContact = {};
  const rank = { 'Confirmed': 5, 'Cancelled': 4, 'Declined': 3, 'No answer': 2, 'Reminder sent': 1 };
  for (const r of confirmLogs) {
    const cid = (r.fields.contact || [])[0];
    if (!cid) continue;
    if (!stateByContact[cid]) {
      stateByContact[cid] = { email_sent: false, text_sent: false, call_made: false, status: null, last_date: null };
    }
    const s = stateByContact[cid];
    const m = r.fields.method;
    if (m === 'Email') s.email_sent = true;
    if (m === 'Text') s.text_sent = true;
    if (m === 'Call') s.call_made = true;
    const res = r.fields.result;
    if (res && (rank[res] || 0) > (rank[s.status] || 0)) s.status = res;
    if (r.fields.date && (!s.last_date || r.fields.date > s.last_date)) s.last_date = r.fields.date;
  }

  const payload = contactsData.records.map(r => ({
    id: r.id,
    name: r.fields.Name || `${r.fields.first || ''} ${r.fields.last || ''}`.trim(),
    phone: r.fields.phone || '',
    email: r.fields.email || '',
    school: r.fields.school || '',
    district: r.fields.district || '',
    last_attempt_date: r.fields.last_attempt_date || '',
    source: r.fields.source || '',
    confirm: stateByContact[r.id] || { email_sent: false, text_sent: false, call_made: false, status: null, last_date: null },
    attendance: r.fields[meta.attendField] || attendanceByContact[r.id]?.result || null,
    signup_6_9: r.fields.signup_6_9_status || null,
    signup_status: meta.signupField ? (r.fields[meta.signupField] || null) : (r.fields.last_attempt_result === 'Signed up' ? 'Signed up' : null),
  }));
  await cachePut(env, cacheKey, payload);
  return json(payload);
}

async function confirmLog(request, env) {
  const body = await request.json();
  const { contact_id, methods = [], status = null, notes = '', signup_6_9 = null, event = '5_26' } = body;
  const meta = eventMeta(event);
  if (!contact_id) return json({ error: 'contact_id required' }, 400);
  const ALLOWED_STATUSES = [null, '', 'Confirmed', 'No answer', 'Declined', 'Cancelled', 'Reminder sent'];
  if (!ALLOWED_STATUSES.includes(status)) return json({ error: 'invalid status' }, 400);
  const ALLOWED_6_9 = [null, '', 'Signed up', 'Maybe', 'Not interested'];
  if (!ALLOWED_6_9.includes(signup_6_9)) return json({ error: 'invalid signup_6_9' }, 400);
  if (!methods.length && !status && !signup_6_9) return json({ error: 'no methods or status' }, 400);
  const date = todayCT();
  const result = status || 'Reminder sent';

  const dupFilter = `AND({date}=DATETIME_PARSE('${date}'),{event}='${meta.confirmEvent}')`;
  const dupes = [];
  let offset = null;
  do {
    let q = `?filterByFormula=${encodeURIComponent(dupFilter)}&pageSize=100&fields%5B%5D=contact`;
    if (offset) q += `&offset=${offset}`;
    const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
    dupes.push(...d.records);
    offset = d.offset;
  } while (offset);
  const dupIds = dupes.filter(r => (r.fields.contact || []).includes(contact_id)).map(r => r.id);
  for (let i = 0; i < dupIds.length; i += 10) {
    const batch = dupIds.slice(i, i+10);
    const u = new URL(`https://api.airtable.com/v0/${BASE}/${CONTACT_LOG_TBL}`);
    for (const id of batch) u.searchParams.append('records[]', id);
    await fetch(u, { method: 'DELETE', headers: { 'Authorization': `Bearer ${env.AIRTABLE_TOKEN}` } });
  }

  const effectiveMethods = methods.length ? methods : ['called'];
  const records = effectiveMethods.map(m => {
    const method = METHOD_MAP[m] || m;
    const f = {
      Summary: `${date} — ${method} (${meta.confirmTag})`,
      date, method, result,
      event: meta.confirmEvent,
      contact: [contact_id],
    };
    if (notes) f.notes = notes;
    return { fields: f };
  });
  const created = await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, {
    method: 'POST',
    body: JSON.stringify({ records, typecast: true })
  });
  // Also patch the contact's denormalized status field so views show it
  if (status) {
    try {
      await at(env, `/${BASE}/${CONTACTS_TBL}/${contact_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: { [meta.confirmField]: status }, typecast: true }),
      });
    } catch (e) { /* field may not exist yet — non-fatal */ }
    // Mirror the funnel status to the event_attendance mirror row's `reminder_status`
    // column so Airtable grid views (like Liz's per-event grids) show it immediately.
    // Rank-based upgrade means Confirmed won't clobber a later Cancelled, etc.
    if (REMIND_RANK[status]) {
      try { await mirrorSetReminderStatus(env, contact_id, mirrorEventName(meta), status); }
      catch (e) { /* non-fatal — hourly sync fills any gaps */ }
    }
  }
  // Cross-event invite from a confirm tab ("can't make this one → sign up for
  // the next onboarding"). Generic: next_signup = { event: '7_7', value: 'Signed up' }.
  // signup_6_9 kept as the legacy form of the same thing.
  const nextSignup = body.next_signup && body.next_signup.event && EVENT_META[body.next_signup.event]
    ? body.next_signup
    : (signup_6_9 ? { event: '6_9', value: signup_6_9 } : null);
  if (nextSignup) {
    const ALLOWED_NEXT = ['Signed up', 'Maybe', 'Not interested'];
    const nm = eventMeta(nextSignup.event);
    if (ALLOWED_NEXT.includes(nextSignup.value) && nm.signupField) {
      try {
        await at(env, `/${BASE}/${CONTACTS_TBL}/${contact_id}`, {
          method: 'PATCH',
          body: JSON.stringify({ fields: { [nm.signupField]: nextSignup.value }, typecast: true }),
        });
        // Log it as an outreach record so we have history
        await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, {
          method: 'POST',
          body: JSON.stringify({
            records: [{ fields: {
              Summary: `${date} — ${nm.label} invite: ${nextSignup.value}`,
              date,
              method: 'Other',
              result: nextSignup.value,
              event: nm.attendEvent,
              contact: [contact_id],
            }}],
            typecast: true,
          }),
        });
      } catch (e) { /* non-fatal */ }
    }
  }
  await invalidateReadCaches(env);
  return json({ ok: true, created_count: created.records.length, status: result, signup_6_9, next_signup: nextSignup });
}

// PUBLIC autocomplete for the 1-on-1 form: rate-limited (60/hr per IP),
// returns minimal contact info so fellows can pick an existing person to
// dedupe against. Deliberately narrow — never returns phones or notes.
async function searchContactPublic(request, env, url) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rlKey = `rl:search1on1:${ip}`;
  let count = 0;
  try { count = parseInt(await env.KV_BINDING.get(rlKey) || '0'); } catch {}
  if (count >= 120) return json({ error: 'too many requests' }, 429);
  try { await env.KV_BINDING.put(rlKey, String(count + 1), { expirationTtl: 3600 }); } catch {}
  const q = (url.searchParams.get('q') || '').trim();
  if (q.length < 2) return json([]);
  const qLower = q.toLowerCase().replace(/'/g, '');
  const digits = q.replace(/\D/g, '');
  const ors = [
    `FIND('${qLower}',LOWER({Name}&''))>0`,
    `FIND('${qLower}',LOWER({email}&''))>0`,
  ];
  if (digits.length >= 4) ors.push(`FIND('${digits}',REGEX_REPLACE({phone}&'','\\\\D',''))>0`);
  const filter = `OR(${ors.join(',')})`;
  const fields = ['Name', 'first', 'last', 'email', 'school', 'district', 'leader_ladder'];
  let p = `?filterByFormula=${encodeURIComponent(filter)}&maxRecords=15`;
  for (const f of fields) p += `&fields%5B%5D=${encodeURIComponent(f)}`;
  const data = await at(env, `/${BASE}/${CONTACTS_TBL}${p}`);
  return json(data.records.map(r => ({
    id: r.id,
    name: r.fields.Name || `${r.fields.first || ''} ${r.fields.last || ''}`.trim(),
    email: r.fields.email || '',
    school: r.fields.school || '',
    district: r.fields.district || '',
    leader_ladder: r.fields.leader_ladder || '',
  })));
}

// Public: list active fellows for the "who had this 1-on-1?" dropdown. Pulls
// live from the organizers Airtable table (with a 60-second KV cache) so new
// fellows show up in the form within a minute of being added.
async function listFellowsPublic(env) {
  const cacheKey = 'cache:fellows-public';
  try {
    const cached = await env.KV_BINDING.get(cacheKey);
    if (cached) return new Response(cached, { headers: { 'content-type': 'application/json' } });
  } catch {}
  const rows = [];
  let off = null;
  do {
    let q = `?pageSize=100&fields%5B%5D=Name`;
    if (off) q += `&offset=${encodeURIComponent(off)}`;
    const p = await at(env, `/${BASE}/${ORGANIZERS_TBL}${q}`);
    rows.push(...p.records);
    off = p.offset;
  } while (off);
  const fellows = rows
    .filter(r => (r.fields.Name || '').trim())
    .map(r => ({ id: r.id, name: String(r.fields.Name).trim() }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const body = JSON.stringify(fellows);
  try { await env.KV_BINDING.put(cacheKey, body, { expirationTtl: 60 }); } catch {}
  return new Response(body, { headers: { 'content-type': 'application/json' } });
}

// Public: log a 1-on-1. Dedupes on email→phone→name, creates or links the
// contact, creates the one_on_ones record, and writes back the funnel commitments
// (house_meeting_date, amendment5_commitments, etc.) so dashboards stay honest.
// Public: an amplifier types their name (and optionally email/phone). We
// dedupe against contacts (email → phone → exact first+last), create if new,
// then return a personal share URL: /by-district/?ref=<recordId>. When
// someone later signs up after clicking that link, the ref carries into their
// `recruited_by` field so we can attribute the recruitment to the amplifier.
async function getMyShareLink(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rlKey = `rl:mylink:${ip}`;
  let count = 0;
  try { count = parseInt(await env.KV_BINDING.get(rlKey) || '0'); } catch {}
  if (count >= 20) return json({ error: 'too many requests' }, 429);
  try { await env.KV_BINDING.put(rlKey, String(count + 1), { expirationTtl: 3600 }); } catch {}
  const body = await request.json().catch(() => ({}));
  if (honeypotBot(body)) return json({ error: 'bot detected' }, 400);
  const clean = (s) => String(s || '').replace(/^[^\w\s@'.-]+/, '').trim();
  const first = clean(body.first);
  const last = clean(body.last);
  const email = body.email ? String(body.email).toLowerCase().trim() : '';
  const phone = body.phone ? String(body.phone).replace(/\D/g, '').slice(-10) : '';
  if (!first || !last) return json({ error: 'first and last name are required' }, 400);
  let cid = null, matchedBy = null;
  if (email) {
    const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`LOWER({email})='${email.replace(/'/g, "\\'")}'`)}&maxRecords=1`);
    if (r.records.length) { cid = r.records[0].id; matchedBy = 'email'; }
  }
  if (!cid && phone.length === 10) {
    const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`REGEX_REPLACE({phone}&'','\\\\D','')='${phone}'`)}&maxRecords=1`);
    if (r.records.length) { cid = r.records[0].id; matchedBy = 'phone'; }
  }
  if (!cid) {
    const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`AND(LOWER({first}&'')='${first.toLowerCase().replace(/'/g, "\\'")}',LOWER({last}&'')='${last.toLowerCase().replace(/'/g, "\\'")}')`)}&maxRecords=2`);
    if (r.records.length === 1) { cid = r.records[0].id; matchedBy = 'name'; }
  }
  if (!cid) {
    const fields = { first, last, leader_ladder: 'Supporter', source: 'amplifier training · personal share link' };
    if (email) fields.email = email;
    if (phone) fields.phone = phone;
    const c = await at(env, `/${BASE}/${CONTACTS_TBL}`, { method: 'POST', body: JSON.stringify({ records: [{ fields }], typecast: true }) });
    cid = c.records[0].id;
    matchedBy = 'created_new';
  }
  const shareUrl = `https://parents4mopublicschools.org/by-district/?ref=${cid}`;
  return json({ ok: true, contact_id: cid, matched_by: matchedBy, share_url: shareUrl, first_name: first });
}

async function log1on1(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rlKey = `rl:log1on1:${ip}`;
  let count = 0;
  try { count = parseInt(await env.KV_BINDING.get(rlKey) || '0'); } catch {}
  if (count >= 30) return json({ error: 'too many submissions, try again later' }, 429);
  try { await env.KV_BINDING.put(rlKey, String(count + 1), { expirationTtl: 3600 }); } catch {}
  const body = await request.json().catch(() => ({}));
  if (honeypotBot(body)) return json({ error: 'bot detected' }, 400);
  const clean = (s) => String(s || '').replace(/^[^\w\s@'.-]+/, '').trim();
  const {
    contact_id, first, last, email, phone, city, zip, school, district,
    fellow_id, fellow_name, date, self_interest, notes, next_step, next_step_by,
    relationship_stage, commitments,
  } = body;
  const cFirst = clean(first), cLast = clean(last);
  const cEmail = email ? String(email).toLowerCase().trim() : '';
  const cPhone = phone ? String(phone).replace(/\D/g, '').slice(-10) : '';
  if (!contact_id && !cFirst && !cLast && !cEmail && !cPhone) {
    return json({ error: 'pick an existing contact or fill out the new-person fields' }, 400);
  }
  // Resolve or create the contact
  let cid = contact_id || null;
  let matchedBy = null;
  if (!cid && cEmail) {
    const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`LOWER({email})='${cEmail.replace(/'/g, "\\'")}'`)}&maxRecords=1`);
    if (r.records.length) { cid = r.records[0].id; matchedBy = 'email'; }
  }
  if (!cid && cPhone.length === 10) {
    const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`REGEX_REPLACE({phone}&'','\\\\D','')='${cPhone}'`)}&maxRecords=1`);
    if (r.records.length) { cid = r.records[0].id; matchedBy = 'phone'; }
  }
  if (!cid && cFirst && cLast) {
    // Name fallback — only match if EXACTLY one hit to avoid false merges.
    const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`AND(LOWER({first}&'')='${cFirst.toLowerCase().replace(/'/g, "\\'")}',LOWER({last}&'')='${cLast.toLowerCase().replace(/'/g, "\\'")}')`)}&maxRecords=2`);
    if (r.records.length === 1) { cid = r.records[0].id; matchedBy = 'name'; }
  }
  const isNew = !cid;
  if (!cid) {
    const fields = { first: cFirst, last: cLast, leader_ladder: 'Prospect', source: `1-on-1 · ${fellow_name || 'unknown fellow'}` };
    if (cEmail) fields.email = cEmail;
    if (cPhone) fields.phone = cPhone;
    if (clean(city)) fields.city = clean(city);
    if (clean(zip)) fields.zip = clean(zip).slice(0, 5);
    if (clean(school)) fields.school = clean(school);
    if (clean(district)) fields.district = clean(district);
    const orgId = deriveOrganizerId({ county: '', city: fields.city, zip: fields.zip, district: fields.district });
    if (orgId) fields.assigned_organizer = [orgId];
    const c = await at(env, `/${BASE}/${CONTACTS_TBL}`, { method: 'POST', body: JSON.stringify({ records: [{ fields }], typecast: true }) });
    cid = c.records[0].id;
    matchedBy = 'created_new';
  }
  // Create the one_on_ones record
  const dateStr = clean(date) || todayCT();
  const summaryBits = [];
  if (dateStr) summaryBits.push(new Date(dateStr).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }));
  if (fellow_name) summaryBits.push(fellow_name);
  if (cFirst || cLast) summaryBits.push(`${cFirst} ${cLast}`.trim());
  const fields1on1 = {
    Summary: summaryBits.join(' × ') || '(new 1-on-1)',
    contact: [cid],
    date: dateStr,
  };
  if (fellow_id) fields1on1.person = [fellow_id];
  if (clean(self_interest)) fields1on1.self_interest = clean(self_interest);
  if (clean(notes)) fields1on1.notes = clean(notes);
  if (clean(next_step)) fields1on1.next_step = clean(next_step);
  if (clean(next_step_by)) fields1on1.next_step_by = clean(next_step_by);
  if (clean(relationship_stage)) fields1on1.relationship_stage = clean(relationship_stage);
  const commitList = (Array.isArray(commitments) ? commitments : String(commitments || '').split(','))
    .map(x => String(x || '').trim()).filter(Boolean);
  if (commitList.length) fields1on1.commitments = commitList;
  fields1on1.source = fellow_name ? `1-on-1 form · ${fellow_name}` : '1-on-1 form';
  const created = await at(env, `/${BASE}/${ONE_ON_ONES_TBL}`, { method: 'POST', body: JSON.stringify({ records: [{ fields: fields1on1 }], typecast: true }) });
  // Write back commitments to the contact + log a contact_log row so history is continuous
  const patch = {};
  if (clean(self_interest) && !isNew) {
    // Non-destructive: only stamp self_interest if we're populating a fresh field?
    // For now, always overwrite — the most recent 1-on-1 usually has the best read.
  }
  if (commitList.includes('Host house meeting') && !clean(body.house_meeting_date)) {
    patch.house_meeting_date = dateStr;
    if (fellow_name) patch.house_meeting_host = fellow_name;
  }
  if (commitList.includes('Recruit others')) {
    patch.wants_to_volunteer = 'Yes';
  }
  if (commitList.includes('Amplifier training')) {
    patch.amplifier_status = 'signed up interested';
  }
  if (commitList.length && !patch.amendment5_commitments) {
    patch.amendment5_commitments = commitList.join(', ');
  }
  if (Object.keys(patch).length) {
    try { await at(env, `/${BASE}/${CONTACTS_TBL}/${cid}`, { method: 'PATCH', body: JSON.stringify({ fields: patch, typecast: true }) }); } catch (e) {}
  }
  // Log to contact_log so the contact's history reads chronologically
  try {
    await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, {
      method: 'POST',
      body: JSON.stringify({
        records: [{ fields: {
          Summary: `${dateStr} — 1-on-1 (${fellow_name || 'fellow'})`,
          date: dateStr, method: 'In person', result: 'Conversation',
          notes: [
            clean(self_interest) ? `Self-interest: ${clean(self_interest)}` : '',
            commitList.length ? `Commitments: ${commitList.join(', ')}` : '',
            clean(next_step) ? `Next step: ${clean(next_step)}` : '',
            clean(notes) ? `Notes: ${clean(notes)}` : '',
          ].filter(Boolean).join('\n\n'),
          contact: [cid],
        } }],
        typecast: true,
      }),
    });
  } catch (e) { /* log row is non-fatal */ }
  await invalidateReadCaches(env);
  return json({
    ok: true,
    one_on_one_id: created.records[0].id,
    contact_id: cid,
    matched_by: matchedBy,
    created_new_contact: isNew,
  });
}

async function searchContacts(env, url) {
  const q = (url.searchParams.get('q') || '').trim();
  if (!q) return json([]);
  const n = parseInt(url.searchParams.get('n') || '25');
  const qLower = q.toLowerCase().replace(/'/g, '');
  const digits = q.replace(/\D/g, '');
  const ors = [
    `FIND('${qLower}',LOWER({Name}&''))>0`,
    `FIND('${qLower}',LOWER({email}&''))>0`,
  ];
  if (digits.length >= 4) ors.push(`FIND('${digits}',REGEX_REPLACE({phone}&'','\\\\D',''))>0`);
  const filter = `OR(${ors.join(',')})`;
  const fields = ['Name','first','last','phone','email','school','district','last_attempt_date','last_attempt_result','leader_ladder','log_count'];
  let p = `?filterByFormula=${encodeURIComponent(filter)}&maxRecords=${n}`;
  for (const f of fields) p += `&fields%5B%5D=${encodeURIComponent(f)}`;
  const data = await at(env, `/${BASE}/${CONTACTS_TBL}${p}`);
  return json(data.records.map(r => ({
    id: r.id,
    name: r.fields.Name || `${r.fields.first || ''} ${r.fields.last || ''}`.trim(),
    phone: r.fields.phone || '',
    email: r.fields.email || '',
    school: r.fields.school || '',
    district: r.fields.district || '',
    log_count: r.fields.log_count || 0,
    leader_ladder: r.fields.leader_ladder || '',
    last_attempt_date: r.fields.last_attempt_date || '',
    last_attempt_result: r.fields.last_attempt_result || '',
    organized_by_count: 0,
  })));
}

// Returns the set of contact IDs assigned to the given organizer. Cached 5 min.
async function organizerContactIds(env, organizerName_) {
  const orgFullName = organizerName(organizerName_);
  if (!orgFullName) return null;
  const cacheKey = `cache:org-contacts:${String(organizerName_).toLowerCase()}`;
  const cached = await cacheGet(env, cacheKey);
  if (cached) return new Set(cached);
  const filter = `FIND('${orgFullName}',{assigned_organizer}&'')>0`;
  const ids = [];
  let offset = null;
  do {
    let q = `?filterByFormula=${encodeURIComponent(filter)}&pageSize=100&fields%5B%5D=Name`;
    if (offset) q += `&offset=${offset}`;
    const data = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
    for (const r of data.records) ids.push(r.id);
    offset = data.offset;
  } while (offset);
  await cachePut(env, cacheKey, ids, 300);
  return new Set(ids);
}

async function getTodayStats(env, urlObj) {
  const organizer = urlObj ? urlObj.searchParams.get('organizer') : null;
  const cacheKey = organizer ? `cache:today-stats:${organizer}` : 'cache:today-stats';
  const cached = await cacheGet(env, cacheKey);
  if (cached) return json(cached);

  const date = todayCT();
  const filter = `{date}=DATETIME_PARSE('${date}')`;
  const fields = ['contact','method','result','event','date'];
  let q = `?filterByFormula=${encodeURIComponent(filter)}&pageSize=100`;
  for (const f of fields) q += `&fields%5B%5D=${encodeURIComponent(f)}`;
  const records = [];
  let offset = null;
  do {
    const url = `/${BASE}/${CONTACT_LOG_TBL}${q}${offset ? `&offset=${offset}` : ''}`;
    const data = await at(env, url);
    records.push(...data.records);
    offset = data.offset;
  } while (offset);

  // Filter to only this organizer's assigned contacts when organizer param is set
  const allowedIds = organizer ? await organizerContactIds(env, organizer) : null;

  const byContact = {};
  const order = [];
  for (const r of records) {
    const cid = (r.fields.contact || [])[0];
    if (!cid) continue;
    if (allowedIds && !allowedIds.has(cid)) continue;
    if (r.fields.event === CONFIRM_EVENT) continue;
    if (!byContact[cid]) { byContact[cid] = { contact_id: cid, methods: new Set(), result: null, event: null }; order.push(cid); }
    if (r.fields.method) byContact[cid].methods.add(r.fields.method);
    if (r.fields.result) byContact[cid].result = r.fields.result;
    if (r.fields.event) byContact[cid].event = r.fields.event;
  }
  const actions = order.map(cid => {
    const c = byContact[cid];
    let outcome = null;
    if (c.event === '1-1 meeting') outcome = 'oneonone';
    else if (c.event === 'Orientation 5/26') outcome = 'signed-up';
    else if (c.result === 'Signed up') outcome = 'signed-up';
    else if (c.result === 'Conversation') outcome = 'connected';
    else if (c.result === 'Skipped') outcome = 'skipped';
    else if (c.result === 'Wrong number') outcome = 'wrong-number';
    else if (c.result === 'Do not contact') outcome = 'do-not-contact';
    return {
      contact_id: c.contact_id,
      methods: Array.from(c.methods).map(m => METHOD_REVERSE[m] || m.toLowerCase()),
      outcome,
    };
  });
  const payload = { actions };
  await cachePut(env, cacheKey, payload);
  return json(payload);
}

// =========================================================================
// /event-stats?event=6_9 — per-event report card.
// Returns the turnout funnel (signups → confirmed → attended), flake +
// turnout rates, the came-vs-confirmed-by-method matrix ("of the people who
// came, how were they confirmed?"), and onboarding→action conversion
// (attendees who took ANY next action after the event date).
// =========================================================================
// Org-wide training totals for Kathryn's cards. Trained = unique people with
// a new-style attendance mark OR a historical event_attendance row matching
// amplifier / house-meeting training names.
async function getTrainingTotals(env) {
  const cached = await cacheGet(env, 'cache:training-totals');
  if (cached) return json(cached);
  const metas = Object.values(EVENT_META).filter(m => m.type === 'hm' || m.type === 'amp');
  const signupClause = 'OR(' + metas.map(m => `{${m.signupField}}='Signed up'`).join(',') + ')';
  const attendClause = 'OR(' + metas.map(m => `OR({${m.attendField}}='Attended',{${m.attendField}}='Walk-in')`).join(',') + ')';
  const count = async (formula) => {
    let n = 0, offset = null;
    do {
      let q = `?filterByFormula=${encodeURIComponent(formula)}&pageSize=100&fields%5B%5D=record_id`;
      if (offset) q += `&offset=${offset}`;
      const d = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
      n += d.records.length;
      for (const r of d.records) {} // ids not needed for signups
      offset = d.offset;
    } while (offset);
    return n;
  };
  const signed = await count(signupClause);
  // trained: unique contact ids from both sources
  const trainedIds = new Set();
  {
    let offset = null;
    do {
      let q = `?filterByFormula=${encodeURIComponent(attendClause)}&pageSize=100&fields%5B%5D=record_id`;
      if (offset) q += `&offset=${offset}`;
      const d = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
      for (const r of d.records) trainedIds.add(r.id);
      offset = d.offset;
    } while (offset);
  }
  {
    const f = `AND(OR(FIND('amplifier',LOWER({event}&''))>0,FIND('house m',LOWER({event}&''))>0,FIND('hm training',LOWER({event}&''))>0),OR({attended}='Yes',{attended}='Attended',{attended}='Walk-in',{attended}=TRUE()),{date}!=BLANK(),IS_AFTER({date},'2026-04-30'))`;
    let offset = null;
    do {
      let q = `?filterByFormula=${encodeURIComponent(f)}&pageSize=100&fields%5B%5D=contact`;
      if (offset) q += `&offset=${offset}`;
      const d = await at(env, `/${BASE}/${EVENT_ATTENDANCE_TBL}${q}`);
      for (const r of d.records) {
        const cid = (r.fields.contact || [])[0];
        if (cid) trainedIds.add(cid);
      }
      offset = d.offset;
    } while (offset);
  }
  const payload = { signed_up: signed, trained: trainedIds.size };
  await cachePut(env, 'cache:training-totals', payload, 300);
  return json(payload);
}

// ── Ellen's events command center ─────────────────────────────────────────
// One overview of every UPCOMING event (onboardings + HM/Amp/KYN trainings +
// regional emergency-meeting launches) with live counts. Two scans total
// (contacts once, contact_log once), cached 60s.

// Trailing "M/D" in a launch name → ISO date (campaign is all 2026).
function parseLaunchDate(name) {
  const m = String(name || '').match(/(\d{1,2})\/(\d{1,2})\s*$/);
  if (!m) return null;
  return `2026-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
}
// "2 kids, 3 & 6" -> 2 ; "18mo and 4 years" -> 2 ; "I kid, age 5" -> 1.
// childcare=Yes with a blank detail still counts as at least 1 child.
// Childcare staffing is safety-critical, so read the free-text note defensively
// and, when ambiguous, err toward MORE kids, not fewer. Returns {count, ages}.
// "2 kods aged 7" (typo) -> {2,[7,7]} ; "twins, 5" -> {2,[5,5]} ; "two kids 3 & 6" -> {2,[3,6]}
// "1 kid age 5" -> {1,[5]} ; "4 year old" -> {1,[4]} ; "18mo and 4 years" -> {2,[1,4]}
const CC_AGE_UNITS = new Set(['year', 'years', 'yr', 'yrs', 'yo', 'mo', 'month', 'months', 'old', 'y']);
const CC_WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
function parseChildcare(s) {
  if (!s || !String(s).trim()) return { count: 1, ages: [] };   // childcare=Yes, no detail -> at least 1
  const t = String(s).toLowerCase().replace(/\bi\s+kid/g, '1 kid');
  let count = null, rest = t;
  if (/\btriplets?\b/.test(t)) count = 3;
  else if (/\btwins?\b/.test(t)) count = 2;
  if (count === null) {
    const m = t.match(/^\s*(\d+)\s*(,|[a-z]+)/);                 // leading digit + a word/comma
    const w = t.match(/^\s*(one|two|three|four|five|six|seven|eight)\b/);
    if (m && (m[2] === ',' || !CC_AGE_UNITS.has(m[2]))) { count = parseInt(m[1], 10); rest = t.slice(m[0].length); }
    else if (w) { count = CC_WORD_NUM[w[1]]; rest = t.slice(w[0].length); }
  }
  const ages = [];
  rest = rest.replace(/(\d+)\s*(?:mo\b|months?)/g, () => { ages.push(1); return ' '; });   // months -> toddler
  for (const n of (rest.match(/\d+/g) || [])) { const v = parseInt(n, 10); if (v >= 0 && v <= 18) ages.push(v); }
  if (count === null) count = Math.max(1, ages.length);
  // one age given for several kids ("2 kods aged 7") -> replicate so the age chart is right too
  if (ages.length && ages.length < count && new Set(ages).size === 1) {
    while (ages.length < count) ages.push(ages[0]);
  }
  count = Math.max(count, ages.length);
  return { count, ages };
}
function countKids(s) { return parseChildcare(s).count; }
function parseAges(s) { return parseChildcare(s).ages; }
function ageBand(a) { return a <= 2 ? '0–2' : a <= 5 ? '3–5' : a <= 9 ? '6–9' : '10+'; }
const AGE_BANDS = ['0–2', '3–5', '6–9', '10+'];
function allMetaEvents() {
  return Object.entries(EVENT_META)
    // 'legacy' = the 5/26 orientation (the first onboarding) — keep it so it shows in Past events.
    .filter(([, m]) => ['legacy', 'onboarding', 'makeup', 'hm', 'amp', 'kyn'].includes(m.type))
    .map(([key, m]) => ({ key, ...m, type: (m.type === 'legacy' || m.type === 'makeup') ? 'onboarding' : m.type }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
const TYPE_LABEL = { onboarding: 'Onboardings', hm: 'House Meeting trainings', amp: 'Amplifier trainings', kyn: 'Know Your Neighbor', camp: 'Power Camps', launch: 'Emergency meetings' };

// Amendment 5 commitments, normalized across every form version's label variants.
// `owner` = who follows up (shown on the card so each commitment routes somewhere).
const COMMIT_BUCKETS = [
  { key: 'amplifier',    label: 'Be an Amplifier',          owner: 'Amplifier program',     m: ['amplifier'] },
  { key: 'house_meeting',label: 'Host a house meeting',     owner: 'House-meeting follow-up',m: ['host house meeting', 'host a house meeting', 'house meeting'] },
  { key: 'canvass',      label: 'Canvass & outreach',       owner: '',                      m: ['canvass', 'outreach'] },
  { key: 'school_board', label: 'School board resolution',  owner: '',                      m: ['school board'] },
  { key: 'regional_team',label: 'Join regional team',       owner: 'Regional leads',        m: ['regional launch team', 'regional mo launch', 'regional team'] },
  { key: 'parent_team',  label: 'Parent team at school',    owner: '',                      m: ['parent team'] },
  { key: 'testimony',    label: 'Write testimony',          owner: '',                      m: ['testimony'] },
  { key: 'talk5',        label: 'Talk to 5 neighbors',      owner: '',                      m: ['talk to 5'] },
  { key: 'power_camp',   label: 'Parent Power Camp',        owner: 'Done (camps complete)', m: ['power camp'] },
];
function commitBucket(raw) {
  const s = String(raw || '').toLowerCase();
  for (const b of COMMIT_BUCKETS) if (b.m.some(x => s.includes(x))) return b.key;
  return null;
}
// Every contact who committed to each bucket, from BOTH sources (log rows are the
// complete record; the denormalized field is partial) -> union, deduped by contact.
async function commitmentSets(env) {
  const sets = {}; for (const b of COMMIT_BUCKETS) sets[b.key] = new Set();
  let off = null;
  do {
    let q = `?filterByFormula=${encodeURIComponent("{method}='Commitment'")}&pageSize=100&fields%5B%5D=event&fields%5B%5D=contact`;
    if (off) q += `&offset=${encodeURIComponent(off)}`;
    const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
    for (const r of d.records) { const k = commitBucket(r.fields.event); const cid = (r.fields.contact || [])[0]; if (k && cid) sets[k].add(cid); }
    off = d.offset;
  } while (off);
  off = null;
  do {
    let q = `?filterByFormula=${encodeURIComponent("{amendment5_commitments}!=BLANK()")}&pageSize=100&fields%5B%5D=amendment5_commitments`;
    if (off) q += `&offset=${encodeURIComponent(off)}`;
    const d = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
    for (const r of d.records) { const v = r.fields.amendment5_commitments; if (!v) continue; for (const part of String(v).split(/ · |\n/)) { const k = commitBucket(part); if (k) sets[k].add(r.id); } }
    off = d.offset;
  } while (off);
  return sets;
}
async function getCommitmentsOverview(env) {
  const cached = await cacheGet(env, 'cache:commitments:v1');
  if (cached) return json(cached);
  const sets = await commitmentSets(env);
  const buckets = COMMIT_BUCKETS.map(b => ({ key: b.key, label: b.label, owner: b.owner, count: sets[b.key].size })).filter(b => b.count > 0);
  const payload = { generated: new Date().toISOString(), buckets };
  await cachePut(env, 'cache:commitments:v1', payload, 120);
  return json(payload);
}

const ATT_STATES = ['Attended', 'Walk-in', 'Partial'];
// Which commitment buckets convert into which training TYPE (attendance counts as showing up).
const CONVERSION_MAP = [
  { key: 'amplifier',     label: 'Be an Amplifier',           training: 'an Amplifier training',    type: 'amp' },
  { key: 'house_meeting', label: 'Host a house meeting',      training: 'a House Meeting training', type: 'hm' },
  { key: 'power_camp',    label: 'Attend Parent Power Camp',  training: 'a Power Camp',            type: 'camp' },
];
// Contacts who attended each type. amp/hm live in per-event contact fields; camps
// live in Event-attendance log rows, so they need a separate scan.
async function attendedByType(env) {
  const byType = {}; for (const c of CONVERSION_MAP) byType[c.type] = new Set();
  const metas = allMetaEvents().filter(m => byType[m.type]);
  if (metas.length) {
    const fields = metas.map(m => m.attendField);
    const formula = `OR(${fields.map(f => `{${f}}!=BLANK()`).join(',')})`;
    let off = null;
    do {
      let q = `?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`;
      for (const f of fields) q += `&fields%5B%5D=${encodeURIComponent(f)}`;
      if (off) q += `&offset=${encodeURIComponent(off)}`;
      const d = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
      for (const r of d.records) for (const m of metas) if (ATT_STATES.includes(r.fields[m.attendField])) byType[m.type].add(r.id);
      off = d.offset;
    } while (off);
  }
  if (byType.camp) {
    let off = null;
    do {
      let q = `?filterByFormula=${encodeURIComponent("AND({method}='Event attendance',FIND('Power Camp',{event}&'')>0)")}&pageSize=100&fields%5B%5D=contact`;
      if (off) q += `&offset=${encodeURIComponent(off)}`;
      const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
      for (const r of d.records) { const cid = (r.fields.contact || [])[0]; if (cid) byType.camp.add(cid); }
      off = d.offset;
    } while (off);
  }
  return byType;
}
async function getCommitmentConversion(env) {
  const cached = await cacheGet(env, 'cache:conversion:v2');
  if (cached) return json(cached);
  const sets = await commitmentSets(env);
  const att = await attendedByType(env);
  const flows = CONVERSION_MAP.map(c => {
    const committed = [...(sets[c.key] || [])];
    const converted = committed.filter(id => att[c.type].has(id)).length;
    return { key: c.key, label: c.label, training: c.training, committed: committed.length, converted, rate: committed.length ? Math.round(converted / committed.length * 100) : 0 };
  }).filter(f => f.committed > 0);
  const payload = { generated: new Date().toISOString(), flows };
  await cachePut(env, 'cache:conversion:v2', payload, 120);
  return json(payload);
}

// Canonical deduped RSVP list as CSV, for Google Sheets =IMPORTDATA(). Token-gated.
// Live feed of house-meeting attendees + their commitments, for the HM follow-up
// Sheet. Append-ordered (date, host, last name) so the Sheet's manual columns
// stay aligned as new attendees come in.
async function houseMeetingsExportCsv(env, urlObj) {
  if (!env.EXPORT_KEY || urlObj.searchParams.get('key') !== env.EXPORT_KEY) return new Response('forbidden', { status: 403 });
  const flds = ['first','last','email','phone','house_meeting_host','house_meeting_date','house_meeting_commitments','school','district','county','one_on_one_booked'];
  const recs = []; let off = null;
  do {
    let q = `?filterByFormula=${encodeURIComponent(`TRIM({house_meeting_date}&'')!=''`)}&pageSize=100`
      + flds.map(f => `&fields%5B%5D=${encodeURIComponent(f)}`).join('');
    if (off) q += `&offset=${encodeURIComponent(off)}`;
    const d = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
    recs.push(...d.records);
    off = d.offset;
  } while (off);
  recs.sort((a, b) => {
    const k = r => `${r.fields.house_meeting_date || ''}|${(r.fields.house_meeting_host || '').toLowerCase()}|${r.fields.last || ''}`;
    return k(a).localeCompare(k(b));
  });
  if (urlObj.searchParams.get('stats')) {
    const hosts = new Set(); let commits = 0;
    for (const r of recs) { const h = (r.fields.house_meeting_host || '').toLowerCase().trim(); if (h) hosts.add(h); if ((r.fields.house_meeting_commitments || '').trim()) commits++; }
    const out = [['metric', 'value'].join(','), ['attendees', recs.length].join(','), ['hosts', hosts.size].join(','), ['made_commitments', commits].join(',')].join('\n');
    return new Response(out, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'max-age=60', 'Access-Control-Allow-Origin': '*' } });
  }
  const e = s => { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [['First Name', 'Last Name', 'Host', 'HM Date', 'Phone', 'Email', 'Commitments', 'School', 'District', 'County', 'Contact ID', '1-1 booked'].join(',')];
  for (const r of recs) {
    const f = r.fields;
    lines.push([f.first || '', f.last || '', f.house_meeting_host || '', f.house_meeting_date || '', f.phone || '', f.email || '', f.house_meeting_commitments || '', f.school || '', f.district || '', f.county || '', r.id, f.one_on_one_booked ? 'Yes' : ''].map(e).join(','));
  }
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'max-age=60', 'Access-Control-Allow-Origin': '*' } });
}

// Sheet → Airtable write-back for the HM follow-up Sheet. Only one_on_one_booked
// rounds back to Airtable for now (the conversion signal that drops people off
// other follow-up lists); status/claimed/notes live in the Sheet until we add
// dedicated fields. rows: [{ contact_id, one_on_one }].
async function sheetHmFollowup(request, env) {
  if (!env.EXPORT_KEY) return json({ error: 'not configured' }, 500);
  const body = await request.json().catch(() => ({}));
  if (body.key !== env.EXPORT_KEY) return json({ error: 'forbidden' }, 403);
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const records = [];
  for (const r of rows) {
    if (!r.contact_id || r.one_on_one === undefined) continue;
    records.push({ id: r.contact_id, fields: { one_on_one_booked: !!r.one_on_one } });
  }
  let updated = 0;
  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10);
    await at(env, `/${BASE}/${CONTACTS_TBL}`, { method: 'PATCH', body: JSON.stringify({ records: batch, typecast: true }) });
    updated += batch.length;
  }
  return json({ ok: true, updated });
}

// Per-amplifier rollup for the amplifier activity tracker: who's making calls,
// how many conversations, unique voters reached, broken out by conversation round.
// Amplifier identity is parsed from the log notes ("Amplifier: <name>").
async function amplifiersExportCsv(env, urlObj) {
  if (!env.EXPORT_KEY || urlObj.searchParams.get('key') !== env.EXPORT_KEY) return new Response('forbidden', { status: 403 });
  const recs = []; let off = null;
  do {
    let q = `?filterByFormula=${encodeURIComponent(`{method}='Amplifier conversation'`)}&pageSize=100`
      + ['notes', 'contact', 'event', 'date'].map(f => `&fields%5B%5D=${encodeURIComponent(f)}`).join('');
    if (off) q += `&offset=${encodeURIComponent(off)}`;
    const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
    recs.push(...d.records);
    off = d.offset;
  } while (off);
  const amp = {};   // name -> { total, voters:Set, c1, c2, c3, last }
  for (const r of recs) {
    const f = r.fields;
    const m = String(f.notes || '').match(/Amplifier:\s*([^·\n]+?)(?:\s*·|$)/);
    const name = m && m[1] ? m[1].trim() : '(unknown)';
    // Skip test/smoke entries (and Liz's own test runs) so the leaderboard is real amplifiers only.
    if (/test|smoke/i.test(name) || name.toLowerCase() === 'liz mckenna') continue;
    const a = amp[name] || (amp[name] = { total: 0, voters: new Set(), c1: 0, c2: 0, c3: 0, last: '' });
    a.total++;
    (f.contact || []).forEach(id => a.voters.add(id));
    const ev = String(f.event || '');
    if (/Conv 1/.test(ev)) a.c1++;
    else if (/Conv 2/.test(ev)) a.c2++;
    else if (/Conv 3|Election/i.test(ev)) a.c3++;
    const dt = String(f.date || '');
    if (dt > a.last) a.last = dt;
  }
  const names = Object.keys(amp).sort((x, y) => amp[y].total - amp[x].total || x.localeCompare(y));
  if (urlObj.searchParams.get('stats')) {
    const allVoters = new Set(); let totalConv = 0;
    for (const n of names) { totalConv += amp[n].total; amp[n].voters.forEach(v => allVoters.add(v)); }
    const out = [['metric', 'value'].join(','), ['amplifiers', names.length].join(','), ['conversations', totalConv].join(','), ['unique_voters', allVoters.size].join(',')].join('\n');
    return new Response(out, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'max-age=60', 'Access-Control-Allow-Origin': '*' } });
  }
  const e = s => { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [['Amplifier', 'Total conversations', 'Unique voters', 'Conv 1 (Stakes)', 'Conv 2 (Vote plan)', 'Conv 3 / Election day', 'Last activity'].join(',')];
  for (const n of names) {
    const a = amp[n];
    lines.push([n, a.total, a.voters.size, a.c1, a.c2, a.c3, a.last].map(e).join(','));
  }
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'max-age=60', 'Access-Control-Allow-Origin': '*' } });
}

// Voters who said yes to something during an amplifier conversation — the
// amplifier-commitments follow-up feed (same shape as house-meetings.csv so it
// reuses the HM follow-up Sheet). Commitments are parsed from commitments_added,
// the amplifier from the contact source. Write-back uses /sheet-hm-followup.
async function amplifierCommitsExportCsv(env, urlObj) {
  if (!env.EXPORT_KEY || urlObj.searchParams.get('key') !== env.EXPORT_KEY) return new Response('forbidden', { status: 403 });
  const flds = ['first', 'last', 'phone', 'email', 'commitments_added', 'school', 'district', 'county', 'source', 'one_on_one_booked'];
  const recs = []; let off = null;
  do {
    let q = `?filterByFormula=${encodeURIComponent(`FIND('via amplifier',LOWER({commitments_added}&''))>0`)}&pageSize=100`
      + flds.map(f => `&fields%5B%5D=${encodeURIComponent(f)}`).join('');
    if (off) q += `&offset=${encodeURIComponent(off)}`;
    const d = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
    recs.push(...d.records);
    off = d.offset;
  } while (off);
  const out = [];
  for (const r of recs) {
    const f = r.fields;
    const first = f.first || '', last = f.last || '';
    const src = String(f.source || '');
    const amp = src.includes('·') ? src.split('·').pop().trim() : '(unknown)';
    if (/test|smoke|delete me/i.test(`${first} ${last} ${amp}`)) continue;   // drop test rows
    const interests = []; let maxDate = '';
    for (const ln of String(f.commitments_added || '').split('\n')) {
      if (!/via amplifier/i.test(ln)) continue;
      const dm = ln.match(/^\s*(\d{4}-\d{2}-\d{2})/); if (dm && dm[1] > maxDate) maxDate = dm[1];
      const im = ln.match(/·\s*(.+?)\s*\(via amplifier\)/i); if (im && im[1]) interests.push(im[1].trim());
    }
    out.push({ id: r.id, first, last, amp, date: maxDate, phone: f.phone || '', email: f.email || '', commit: interests.join(' · '), school: f.school || '', district: f.district || '', county: f.county || '', oo: f.one_on_one_booked });
  }
  out.sort((a, b) => `${a.amp.toLowerCase()}|${a.last}`.localeCompare(`${b.amp.toLowerCase()}|${b.last}`));
  if (urlObj.searchParams.get('stats')) {
    const amps = new Set(out.map(r => r.amp.toLowerCase()));
    const s = [['metric', 'value'].join(','), ['voters', out.length].join(','), ['amplifiers', amps.size].join(',')].join('\n');
    return new Response(s, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'max-age=60', 'Access-Control-Allow-Origin': '*' } });
  }
  const e = s => { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [['First Name', 'Last Name', 'Amplifier', 'Date', 'Phone', 'Email', 'Commitments', 'School', 'District', 'County', 'Contact ID', '1-1 booked'].join(',')];
  for (const r of out) lines.push([r.first, r.last, r.amp, r.date, r.phone, r.email, r.commit, r.school, r.district, r.county, r.id, r.oo ? 'Yes' : ''].map(e).join(','));
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'max-age=60', 'Access-Control-Allow-Origin': '*' } });
}

// Master rollup for Molly + Ellen's dashboard: every headline metric, computed
// server-side from Airtable (one contacts pass + one contact_log pass). Returns
// key,Metric,Count; the Sheet holds the editable Goal column and draws the bars.
async function computeRollupMetrics(env) {
  const cached = await cacheGet(env, 'cache:rollup:v2');
  if (cached) return cached;
  const att = v => v === 'Attended' || v === 'Walk-in';
  const onbAttend = Object.values(EVENT_META).filter(m => m.type === 'onboarding' || m.type === 'legacy').map(m => m.attendField);
  const hmAttend = Object.values(EVENT_META).filter(m => m.type === 'hm').map(m => m.attendField);
  const ampAttend = Object.values(EVENT_META).filter(m => m.type === 'amp').map(m => m.attendField);
  const trainSignup = Object.values(EVENT_META).filter(m => ['hm', 'amp', 'kyn'].includes(m.type) && m.signupField).map(m => m.signupField);
  const scalar = ['amendment5_commitments', 'house_meeting_commitments', 'house_meeting_date', 'one_on_one_booked', 'attempt_count', 'last_attempt_result'];
  const fields = [...new Set([...onbAttend, ...hmAttend, ...ampAttend, ...trainSignup, ...scalar])];
  const m = { attempts: 0, onb: 0, hm: 0, amp: 0, a5: 0, hmc: 0, oo: 0, remind: 0, a5fu: 0, hmfu: 0 };
  let off = null;
  do {
    let q = `?pageSize=100` + fields.map(f => `&fields%5B%5D=${encodeURIComponent(f)}`).join('');
    if (off) q += `&offset=${off}`;
    const d = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
    for (const r of d.records) {
      const f = r.fields;
      if (onbAttend.some(k => att(f[k]))) m.onb++;
      if (hmAttend.some(k => att(f[k]))) m.hm++;
      if (ampAttend.some(k => att(f[k]))) m.amp++;
      const a5 = String(f.amendment5_commitments || '').trim() !== '';
      const hmc = String(f.house_meeting_commitments || '').trim() !== '' || String(f.house_meeting_date || '').trim() !== '';
      if (a5) m.a5++;
      if (hmc) m.hmc++;
      if (f.one_on_one_booked) m.oo++;
      m.attempts += Number(f.attempt_count) || 0;
      // "Followed up on" = a real next step, NOT just an attempt: 1-1 booked,
      // a logged conversation, or signed up for a training.
      const trained = trainSignup.some(k => f[k] === 'Signed up');
      const nextStep = !!f.one_on_one_booked || f.last_attempt_result === 'Conversation' || trained;
      if (a5 && nextStep) m.a5fu++;
      if (hmc && (!!f.one_on_one_booked || f.last_attempt_result === 'Conversation')) m.hmfu++;
    }
    off = d.offset;
  } while (off);
  let ampConvos = 0; const launchSet = new Set();
  off = null;
  do {
    let q = `?filterByFormula=${encodeURIComponent(`OR({method}='Amplifier conversation',{method}='Event attendance')`)}&pageSize=100&fields%5B%5D=method&fields%5B%5D=result&fields%5B%5D=contact&fields%5B%5D=rsvp_launch`;
    if (off) q += `&offset=${off}`;
    const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
    for (const r of d.records) {
      if (r.fields.method === 'Amplifier conversation') { ampConvos++; continue; }
      // Regional launches only: an in-person launch RSVP/check-in carries rsvp_launch
      // (onboardings + trainings do not). Exclude Parent Power Camps, which also use it.
      const rl = String(r.fields.rsvp_launch || '');
      if (att(r.fields.result) && rl && !/parent power camp/i.test(rl)) (r.fields.contact || []).forEach(id => launchSet.add(id));
    }
    off = d.offset;
  } while (off);
  // "Reminded to vote" — contacts flagged "Wants vote reminder" in commitments_added
  // (no dedicated field exists; remind-to-vote signups write this tag).
  m.remind = await countMatching(env, `FIND('wants vote reminder',LOWER({commitments_added}&''))>0`);
  const rows = [
    ['outreach_attempts', 'Outreach attempts logged (calls + texts)', m.attempts],
    ['onboarding_attended', 'Attended an onboarding call', m.onb],
    ['launch_attended', 'Attended a regional launch', launchSet.size],
    ['hm_trained', 'Attended a House Meeting training', m.hm],
    ['amp_trained', 'Attended an Amplifier training', m.amp],
    ['amp_convos', 'Amplifier conversations logged', ampConvos],
    ['a5_commitments', 'Amendment 5 commitments made', m.a5],
    ['hm_commitments', 'House meeting commitments made', m.hmc],
    ['one_on_ones', '1-1s booked', m.oo],
    ['a5_followed_up', 'A5 commitments followed up on', m.a5fu],
    ['hm_followed_up', 'HM commitments followed up on', m.hmfu],
    ['vote_reminders', 'Want to be reminded to vote', m.remind],
  ];
  const metrics = rows.map(r => ({ key: r[0], label: r[1], count: r[2] }));
  await cachePut(env, 'cache:rollup:v2', metrics, 120);
  return metrics;
}

async function rollupExportCsv(env, urlObj) {
  if (!env.EXPORT_KEY || urlObj.searchParams.get('key') !== env.EXPORT_KEY) return new Response('forbidden', { status: 403 });
  const metrics = await computeRollupMetrics(env);
  const e = s => { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const out = [['key', 'Metric', 'Count'].join(',')];
  for (const r of metrics) out.push([r.key, r.label, r.count].map(e).join(','));
  return new Response(out.join('\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'max-age=120', 'Access-Control-Allow-Origin': '*' } });
}

// =========================================================================
// /board — the P4MPS master tracker as a live, on-brand web page. Unguessable
// URL (bookmark it). Thermometer bars vs. editable goals, a commitments
// pipeline (Committed -> Followed up -> Trained), donations, and a
// week-over-week trend built from daily snapshots. Read-only aggregate counts
// (no PII), gated by BOARD_TOKEN in the path.
// =========================================================================
const BOARD_TOKEN = 'f446d6e97fdc9d17b8666ece';
const BOARD_GOALS_DEFAULT = {
  outreach_attempts: 5000, onboarding_attended: 350, launch_attended: 400,
  hm_trained: 100, amp_trained: 150, amp_convos: 2000, a5_commitments: 500,
  hm_commitments: 150, one_on_ones: 200, a5_followed_up: 300, hm_followed_up: 100,
  vote_reminders: 2000,
};
// The three headline metrics people watch closely -> big thermometers up top.
const BOARD_HEADLINE = ['a5_commitments', 'launch_attended', 'onboarding_attended'];
// Commitment pipeline: made a commitment -> has a real next step -> showed up.
const BOARD_PIPELINE = [
  { key: 'a5_commitments', label: 'Committed' },
  { key: 'a5_followed_up', label: 'Followed up' },
  { key: 'amp_trained',    label: 'Trained / showed up' },
];

async function boardGoals(env) {
  let g = {}; try { g = JSON.parse(await env.KV_BINDING.get('board:goals') || '{}'); } catch {}
  return { ...BOARD_GOALS_DEFAULT, ...g };
}
// Donations are the live ActBlue import (donations table), not a manual number.
async function boardDonations(env) {
  const cached = await cacheGet(env, 'cache:donations:v2');
  if (cached) return cached;
  let total = 0, count = 0, asOf = '', off = null;
  do {
    let q = `?pageSize=100&fields%5B%5D=amount`;
    if (off) q += `&offset=${off}`;
    const d = await at(env, `/${BASE}/${DONATIONS_TBL}${q}`);
    for (const r of d.records) {
      const a = Number(r.fields.amount); if (Number.isFinite(a) && a > 0) { total += a; count++; }
      // Records are created at import time, so the newest createdTime = the last upload.
      if (r.createdTime && (!asOf || r.createdTime > asOf)) asOf = r.createdTime;
    }
    off = d.offset;
  } while (off);
  const payload = { total: Math.round(total), count, asOf };
  await cachePut(env, 'cache:donations:v2', payload, 300);
  return payload;
}
// Stacked-bar timeline: commitments by the day they were made (log's own date),
// split by commitment type, from the first commitment to today, with the events
// that drove the surges. Colors + order come back with the data.
const COMMIT_LABELS = { amplifier: 'Be an Amplifier', house_meeting: 'Host a house meeting', canvass: 'Canvass & outreach', school_board: 'School board resolution', regional_team: 'Join regional team', parent_team: 'Parent team at school', testimony: 'Write testimony', talk5: 'Talk to 5 neighbors', power_camp: 'Parent Power Camp', other: 'Other commitment' };
async function boardCommitTimeline(env) {
  const cached = await cacheGet(env, 'cache:commit-timeline:v2');
  if (cached) return cached;
  const byDay = {}; let minDate = null; const today = todayCT();
  let off = null;
  do {
    let q = `?filterByFormula=${encodeURIComponent("{method}='Commitment'")}&pageSize=100&fields%5B%5D=date&fields%5B%5D=event`;
    if (off) q += `&offset=${off}`;
    const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
    for (const r of d.records) {
      let dt = String(r.fields.date || '').slice(0, 10);
      if (!dt) dt = String(r.createdTime || '').slice(0, 10);
      if (!dt || dt > today) continue;
      const key = commitBucket(r.fields.event) || 'other';
      byDay[dt] = byDay[dt] || {}; byDay[dt][key] = (byDay[dt][key] || 0) + 1;
      if (!minDate || dt < minDate) minDate = dt;
    }
    off = d.offset;
  } while (off);
  if (!minDate) minDate = today;
  const totals = {};
  for (const dt in byDay) for (const k in byDay[dt]) totals[k] = (totals[k] || 0) + byDay[dt][k];
  const types = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
  const days = [];
  for (let t = Date.parse(minDate + 'T00:00:00Z'), e = Date.parse(today + 'T00:00:00Z'); t <= e; t += 86400000) {
    const iso = new Date(t).toISOString().slice(0, 10);
    days.push({ date: iso, byType: byDay[iso] || {} });
  }
  let events = [];
  try {
    const ov = await (await getEventsOverview(env)).json();
    events = (ov.events || []).filter(e => e.date && e.date >= minDate && e.date <= today).map(e => ({ date: e.date, label: e.label }));
  } catch {}
  const payload = { generated: new Date().toISOString(), minDate, today, days, types, labels: COMMIT_LABELS, totals, events };
  await cachePut(env, 'cache:commit-timeline:v2', payload, 300);
  return payload;
}
// One snapshot per day of every headline count -> the trend line. Idempotent:
// re-running on the same day overwrites that day. Index capped at 120 days.
async function snapshotBoard(env, metrics, donations, force) {
  const date = todayCT();
  // From page loads, only seed the day once (bounds KV writes). The daily cron
  // passes force=true to refresh the day's value.
  if (!force) { try { if (await env.KV_BINDING.get('board:snap:' + date)) return; } catch {} }
  const row = {}; for (const m of metrics) row[m.key] = m.count;
  const snap = { date, metrics: row, donations: { total: donations.total || 0, count: donations.count || 0 } };
  try {
    await env.KV_BINDING.put('board:snap:' + date, JSON.stringify(snap));
    let idx = []; try { idx = JSON.parse(await env.KV_BINDING.get('board:snap:index') || '[]'); } catch {}
    if (!idx.includes(date)) { idx.push(date); idx.sort(); if (idx.length > 120) idx = idx.slice(-120); }
    await env.KV_BINDING.put('board:snap:index', JSON.stringify(idx));
  } catch {}
}
async function boardHistory(env) {
  let idx = []; try { idx = JSON.parse(await env.KV_BINDING.get('board:snap:index') || '[]'); } catch {}
  const recent = idx.slice(-60);
  const out = [];
  for (const date of recent) {
    try { const raw = await env.KV_BINDING.get('board:snap:' + date); if (raw) out.push(JSON.parse(raw)); } catch {}
  }
  return out;
}
async function boardData(env, urlObj) {
  if (urlObj.searchParams.get('k') !== BOARD_TOKEN) return json({ error: 'forbidden' }, 403);
  const metrics = await computeRollupMetrics(env);
  const goals = await boardGoals(env);
  const donations = await boardDonations(env);
  // Seed today's snapshot on first view so the WoW deltas aren't empty before the cron runs.
  await snapshotBoard(env, metrics, donations);
  const history = await boardHistory(env);
  const commits = await boardCommitTimeline(env);
  return json({ generated: new Date().toISOString(), metrics, goals, donations, history, commits });
}
// A5-action map — everyone who has done anything for Amendment 5, aggregated
// by zip centroid (ZIP_LATLON). Only counts leave the worker: no names, no
// street addresses. A contact "did something" when they attended an event,
// made a commitment / booked a 1-1, or signed up for anything. One level per
// person (deepest engagement wins) so the map totals match human intuition.
async function boardMapData(env, urlObj) {
  if (urlObj.searchParams.get('k') !== BOARD_TOKEN) return json({ error: 'forbidden' }, 403);
  const cached = await cacheGet(env, 'cache:board:map');
  if (cached) return json(cached);
  const fields = ['zip', 'events_attended_count', 'events_signed_up', 'amendment5_commitments',
                  'house_meeting_commitments', 'one_on_one_booked', 'wants_amendment5_updates'];
  const byZip = {};
  let total = 0, outside = 0, noZip = 0;
  let offset = null;
  do {
    let q = `?pageSize=100${fields.map(f => `&fields%5B%5D=${encodeURIComponent(f)}`).join('')}`;
    if (offset) q += `&offset=${encodeURIComponent(offset)}`;
    const d = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
    for (const r of d.records) {
      const f = r.fields;
      const attended = (f.events_attended_count || 0) > 0;
      const committed = !!(String(f.amendment5_commitments || '').trim()
        || String(f.house_meeting_commitments || '').trim() || f.one_on_one_booked);
      const signed = (Array.isArray(f.events_signed_up) && f.events_signed_up.length > 0)
        || !!f.wants_amendment5_updates;
      if (!attended && !committed && !signed) continue;
      total++;
      const zip = String(f.zip || '').trim().slice(0, 5);
      if (!/^\d{5}$/.test(zip)) { noZip++; continue; }
      if (!ZIP_LATLON[zip]) { outside++; continue; }
      const b = byZip[zip] || (byZip[zip] = { attended: 0, committed: 0, signed: 0 });
      if (attended) b.attended++;
      else if (committed) b.committed++;
      else b.signed++;
    }
    offset = d.offset;
  } while (offset);
  const points = Object.entries(byZip).map(([zip, b]) => {
    const ll = ZIP_LATLON[zip];
    return { zip, lat: ll[0], lng: ll[1], place: ll[2] || '', ...b, total: b.attended + b.committed + b.signed };
  }).sort((a, b) => b.total - a.total);
  const payload = { generated: new Date().toISOString(), total, no_zip: noZip, outside, points };
  await cachePut(env, 'cache:board:map', payload, 300);
  return json(payload);
}
async function boardSave(request, env, urlObj) {
  if (urlObj.searchParams.get('k') !== BOARD_TOKEN) return json({ error: 'forbidden' }, 403);
  let body = {}; try { body = await request.json(); } catch {}
  if (body.goals && typeof body.goals === 'object') {
    const cur = await boardGoals(env); const next = { ...cur };
    for (const k of Object.keys(body.goals)) { const v = Number(body.goals[k]); if (Number.isFinite(v) && v >= 0) next[k] = Math.round(v); }
    await env.KV_BINDING.put('board:goals', JSON.stringify(next));
  }
  // Donations are read-only (synced from the ActBlue import), so they are not editable here.
  return json({ ok: true });
}
function boardPage(env, urlObj) {
  const token = urlObj.pathname.slice('/board/'.length);
  if (token !== BOARD_TOKEN) return new Response('Not found', { status: 404 });
  return new Response(BOARD_HTML.replace(/__TOKEN__/g, BOARD_TOKEN), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

const BOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>P4MPS — Overall Tracker</title>
<link rel="icon" href="https://parents4mopublicschools.org/brand/logo-circle-96.png" />
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo+Narrow:wght@500;600;700&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap" rel="stylesheet">
<style>
  :root{
    --ink:#1A2418; --paper:#E9E5CE; --rose:#B25048; --sky:#335A78; --teal:#2F5E3D; --gold:#C08A2D;
    --card:#F4F1E1; --line:rgba(26,36,24,.14); --muted:#5C6356;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);font-family:"DM Sans",system-ui,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.4}
  .wrap{max-width:1120px;margin:0 auto;padding:0 20px 64px}
  a{color:var(--sky)}
  h1,h2,h3,.disp{font-family:"Archivo Narrow",sans-serif;letter-spacing:.2px}
  header.top{position:sticky;top:0;z-index:20;background:rgba(233,229,206,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
  .top-in{max-width:1120px;margin:0 auto;padding:12px 20px;display:flex;align-items:center;gap:14px}
  .top-in img{width:40px;height:40px;border-radius:50%}
  .brandname{font-family:"Archivo Narrow",sans-serif;font-weight:700;font-size:19px;line-height:1.05}
  .brandname small{display:block;font-family:"DM Sans";font-weight:500;font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
  .top-right{margin-left:auto;display:flex;align-items:center;gap:10px}
  .chip{font-size:12.5px;font-weight:600;padding:6px 12px;border-radius:999px;border:1px solid var(--line);background:var(--card);white-space:nowrap}
  .chip.live{color:var(--teal)} .chip.live b{color:var(--teal)}
  .count-chip{background:var(--ink);color:var(--paper);border-color:var(--ink)}
  .hero{padding:34px 0 8px}
  .hero h1{font-size:40px;margin:0;font-weight:700}
  .hero p{margin:6px 0 0;color:var(--muted);max-width:640px;font-size:15px}
  .btn{font-family:"DM Sans";font-weight:600;font-size:13.5px;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:9px;padding:8px 14px;cursor:pointer}
  .btn:hover{border-color:var(--ink)}
  .btn.primary{background:var(--rose);color:#fff;border-color:var(--rose)}
  .btn.ghost{background:transparent}
  .sec-title{font-size:13px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin:34px 0 14px}
  .headline{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
  .hcard{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px 20px 22px;position:relative;overflow:hidden}
  .hcard .lab{font-size:14px;font-weight:600;color:var(--muted)}
  .hcard .big{font-family:"Archivo Narrow";font-weight:700;font-size:46px;line-height:1;margin:8px 0 2px}
  .hcard .of{font-size:14px;color:var(--muted);font-weight:500}
  .therm{height:14px;border-radius:999px;background:rgba(26,36,24,.10);margin-top:16px;overflow:hidden}
  .therm > span{display:block;height:100%;border-radius:999px;transition:width .8s cubic-bezier(.2,.7,.2,1)}
  .hcard .pct{position:absolute;top:18px;right:20px;font-family:"Archivo Narrow";font-weight:700;font-size:22px}
  .wow{font-size:12.5px;font-weight:600;margin-top:10px;color:var(--muted)}
  .wow b{color:var(--teal)}
  .mid{display:grid;grid-template-columns:1.55fr 1fr;gap:16px;margin-top:16px}
  .panel{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px}
  .panel h3{margin:0 0 4px;font-size:19px;font-weight:700}
  .panel .sub{color:var(--muted);font-size:13px;margin:0 0 16px}
  .pipe{display:flex;align-items:stretch;gap:0}
  .stage{flex:1;text-align:center;padding:14px 8px;border-radius:12px;background:rgba(26,36,24,.04)}
  .stage .n{font-family:"Archivo Narrow";font-weight:700;font-size:34px;line-height:1}
  .stage .l{font-size:12.5px;font-weight:600;color:var(--muted);margin-top:4px}
  .arrow{display:flex;flex-direction:column;justify-content:center;align-items:center;padding:0 6px;min-width:56px}
  .arrow .r{font-size:12px;font-weight:700}
  .arrow .a{color:var(--line);font-size:20px;line-height:1}
  .don .amt{font-family:"Archivo Narrow";font-weight:700;font-size:44px;line-height:1;color:var(--rose)}
  .don .meta{color:var(--muted);font-size:13.5px;margin-top:6px}
  .don .note{margin-top:12px;font-size:13px;color:var(--muted);font-style:italic}
  .don .give{display:inline-block;margin-top:16px}
  .trend-wrap{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;margin-top:16px}
  .legend{display:flex;gap:18px;flex-wrap:wrap;margin:2px 0 10px}
  .legend span{font-size:12.5px;font-weight:600;color:var(--muted);display:inline-flex;align-items:center;gap:6px}
  .legend i{width:11px;height:11px;border-radius:3px;display:inline-block}
  .grid{background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden;margin-top:16px}
  .grow{display:grid;grid-template-columns:minmax(220px,1fr) 92px 1fr 92px 56px;gap:14px;align-items:center;padding:13px 20px;border-top:1px solid var(--line)}
  .grow:first-child{border-top:none;background:rgba(26,36,24,.04);font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:600;padding-top:11px;padding-bottom:11px}
  .grow .m{font-weight:600;font-size:14.5px}
  .grow .c{font-family:"Archivo Narrow";font-weight:700;font-size:20px;text-align:right}
  .grow .g{text-align:right;color:var(--muted);font-size:14px}
  .grow .p{text-align:right;font-weight:700;font-size:14px}
  .bar{height:11px;border-radius:999px;background:rgba(26,36,24,.10);overflow:hidden}
  .bar > span{display:block;height:100%;border-radius:999px;transition:width .8s cubic-bezier(.2,.7,.2,1)}
  .gin{width:82px;text-align:right;font-family:"DM Sans";font-size:14px;padding:5px 8px;border:1px solid var(--line);border-radius:7px;background:var(--paper);color:var(--ink)}
  .foot{color:var(--muted);font-size:12.5px;margin-top:24px;text-align:center}
  .toolbar{display:flex;gap:10px;align-items:center;margin:0 0 0 auto}
  .savebar{display:none;gap:10px;align-items:center}
  .savebar.on{display:flex}
  #loading{padding:80px 0;text-align:center;color:var(--muted)}
  @media(max-width:820px){
    .headline{grid-template-columns:1fr}
    .mid{grid-template-columns:1fr}
    .hero h1{font-size:32px}
    .grow{grid-template-columns:minmax(150px,1fr) 66px 56px;gap:10px}
    .grow .barcell,.grow .g{display:none}
  }
</style>
</head>
<body>
<header class="top">
  <div class="top-in">
    <img src="https://parents4mopublicschools.org/brand/logo-circle-256.png" alt="P4MPS" />
    <div class="brandname">Parents for Missouri Public Schools<small>Overall Tracker</small></div>
    <div class="top-right">
      <span class="chip count-chip" id="countdown">&nbsp;</span>
      <span class="chip live" id="updated">Loading…</span>
    </div>
  </div>
</header>
<div class="wrap">
  <section class="hero">
    <h1>Where the work stands</h1>
    <p>Live from Airtable. Every count updates as organizers log calls, RSVPs, attendance, and commitments across Missouri. Bars show progress toward goal.</p>
  </section>

  <div id="loading">Loading the numbers…</div>
  <div id="app" style="display:none">
    <div class="sec-title" style="display:flex;align-items:center;margin-bottom:14px">Headline
      <div class="toolbar">
        <div class="savebar" id="savebar"><button class="btn ghost" id="cancelBtn">Cancel</button><button class="btn primary" id="saveBtn">Save</button></div>
        <button class="btn" id="editBtn">Edit goals</button>
      </div>
    </div>
    <div class="headline" id="headline"></div>

    <div class="mid">
      <div class="panel">
        <h3>Commitment pipeline</h3>
        <p class="sub">How people move from a commitment to showing up. Ellen's question: are commitments turning into action?</p>
        <div class="pipe" id="pipe"></div>
      </div>
      <div class="panel don">
        <h3>Donations</h3>
        <div class="amt" id="donAmt">$0</div>
        <div class="meta" id="donMeta">No gifts logged yet</div>
        <div class="note" id="donNote">From ActBlue</div>
        <a class="btn primary give" id="giveBtn" href="https://secure.actblue.com/donate/parents-for-missouri-public-schools-1" target="_blank" rel="noopener">Donate</a>
      </div>
    </div>

    <div class="trend-wrap">
      <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap">
        <h3 style="margin:0;font-size:19px;font-weight:700;font-family:'Archivo Narrow'">Commitments over time</h3>
        <span class="sub" style="margin:0;color:var(--muted);font-size:13px" id="trendNote"></span>
      </div>
      <div class="legend" id="legend"></div>
      <div id="chart"></div>
    </div>

    <div class="trend-wrap">
      <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap">
        <h3 style="margin:0;font-size:19px;font-weight:700;font-family:'Archivo Narrow'">Where the movement is</h3>
        <span class="sub" style="margin:0;color:var(--muted);font-size:13px" id="mapNote">Loading the map…</span>
      </div>
      <div class="legend" id="mapLegend"></div>
      <div id="a5map" style="height:460px;border-radius:12px;margin-top:8px;border:1px solid var(--line);background:#f4f2e8"></div>
    </div>

    <div class="sec-title">All metrics</div>
    <div class="grid" id="grid"></div>

    <div class="foot" id="foot"></div>
  </div>
</div>
<script>
var TOKEN = "__TOKEN__";
var VOTE_DAY = "2026-08-04";
var COLORS = {
  outreach_attempts:"#335A78", onboarding_attended:"#2F5E3D", launch_attended:"#B25048",
  hm_trained:"#2F5E3D", amp_trained:"#335A78", amp_convos:"#335A78", a5_commitments:"#B25048",
  hm_commitments:"#2F5E3D", one_on_ones:"#C08A2D", a5_followed_up:"#B25048", hm_followed_up:"#2F5E3D",
  vote_reminders:"#335A78"
};
var PIPE = [
  {key:"a5_commitments", label:"Committed", color:"#B25048"},
  {key:"a5_followed_up", label:"Followed up", color:"#C08A2D"},
  {key:"amp_trained", label:"Trained / showed up", color:"#2F5E3D"}
];
var HEADLINE = ["a5_commitments","launch_attended","onboarding_attended"];
var DATA = null, EDIT = false;

function nf(n){ return Number(n||0).toLocaleString("en-US"); }
function byKey(arr){ var o={}; for(var i=0;i<arr.length;i++) o[arr[i].key]=arr[i]; return o; }
function pct(c,g){ if(!g||g<=0) return 0; return Math.min(100, Math.round(c/g*100)); }
// Bars are colored by progress to goal so color tracks the number: red behind, amber on the way, green on track.
function barColor(p){ p=Number(p)||0; if(p>=67) return "#2F5E3D"; if(p>=34) return "#C08A2D"; return "#B25048"; }
function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g,function(x){return{"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[x];}); }

function mdLabel(d){ var p=String(d).split("-"); return p.length===3 ? (Number(p[1])+"/"+Number(p[2])) : d; }

function wow(key){
  var h=DATA.history||[]; if(h.length<2) return null;
  var last=h[h.length-1]; var cur=(last.metrics||{})[key]||0;
  var target=h.length>7?h[h.length-8]:h[0];
  var prev=(target.metrics||{})[key]||0;
  return cur-prev;
}
function wowStr(key){
  var d=wow(key); if(d===null) return "";
  if(d>0) return "<b>+"+nf(d)+"</b> this week";
  if(d<0) return nf(d)+" this week";
  return "no change this week";
}

function render(){
  var m=byKey(DATA.metrics), g=DATA.goals;

  // headline thermometers
  var hh="";
  for(var i=0;i<HEADLINE.length;i++){
    var k=HEADLINE[i], row=m[k]; if(!row) continue;
    var goal=g[k]||0, p=pct(row.count,goal), col=barColor(p);
    hh+='<div class="hcard">'
      +'<div class="pct" style="color:'+col+'">'+p+'%</div>'
      +'<div class="lab">'+esc(row.label)+'</div>'
      +'<div class="big">'+nf(row.count)+'</div>'
      +'<div class="of">of '+nf(goal)+' goal</div>'
      +'<div class="therm"><span style="width:'+p+'%;background:'+col+'"></span></div>'
      +'<div class="wow">'+(wowStr(k)||"&nbsp;")+'</div>'
      +'</div>';
  }
  document.getElementById("headline").innerHTML=hh;

  // pipeline
  var pp="";
  for(var j=0;j<PIPE.length;j++){
    var pk=PIPE[j], r=m[pk.key], n=r?r.count:0;
    pp+='<div class="stage"><div class="n" style="color:'+pk.color+'">'+nf(n)+'</div><div class="l">'+pk.label+'</div></div>';
    if(j<PIPE.length-1){
      var nextR=m[PIPE[j+1].key], nextN=nextR?nextR.count:0;
      var rate=n>0?Math.round(nextN/n*100):0;
      pp+='<div class="arrow"><div class="a">&rarr;</div><div class="r" style="color:var(--muted)">'+rate+'%</div></div>';
    }
  }
  document.getElementById("pipe").innerHTML=pp;

  // donations — from the manual ActBlue export, dated by the last import
  var d=DATA.donations||{total:0,count:0,asOf:""};
  document.getElementById("donAmt").textContent="$"+nf(d.total);
  document.getElementById("donMeta").textContent=(d.count>0? nf(d.count)+" gift"+(d.count===1?"":"s") : "No gifts yet");
  var asof="";
  if(d.asOf){ try{ asof=new Date(d.asOf).toLocaleDateString("en-US",{timeZone:"America/Chicago",month:"short",day:"numeric"}); }catch(e){} }
  document.getElementById("donNote").textContent="From ActBlue export"+(asof? " · as of "+asof : "");

  // commitments-over-time stacked bars
  renderCommits();

  // full grid
  var gh='<div class="grow"><div>Metric</div><div style="text-align:right">Count</div><div class="barcell">Progress</div><div style="text-align:right">Goal</div><div style="text-align:right">%</div></div>';
  for(var x=0;x<DATA.metrics.length;x++){
    var mm=DATA.metrics[x], gg=g[mm.key]||0, pp2=pct(mm.count,gg), cc=barColor(pp2);
    var goalCell = EDIT
      ? '<input class="gin" type="number" min="0" data-key="'+mm.key+'" value="'+gg+'">'
      : nf(gg);
    gh+='<div class="grow">'
      +'<div class="m">'+esc(mm.label)+'</div>'
      +'<div class="c">'+nf(mm.count)+'</div>'
      +'<div class="barcell"><div class="bar"><span style="width:'+pp2+'%;background:'+cc+'"></span></div></div>'
      +'<div class="g">'+goalCell+'</div>'
      +'<div class="p" style="color:'+cc+'">'+pp2+'%</div>'
      +'</div>';
  }
  document.getElementById("grid").innerHTML=gh;

  var upd=DATA.generated?new Date(DATA.generated):new Date();
  document.getElementById("foot").innerHTML="Live from Airtable. Auto-refreshes every few minutes. Goals are editable with the button up top; donations sync from ActBlue. Private link — please do not share publicly.";
}

// Colors for the commitment-type stacks (brand + a few harmonious extras).
var COMMIT_COLORS={ amplifier:"#B25048", house_meeting:"#2F5E3D", canvass:"#335A78", school_board:"#C08A2D", regional_team:"#7A5C8E", parent_team:"#4E8C7E", testimony:"#A0642F", talk5:"#5C6356", power_camp:"#88304E", other:"#9AA091" };
function commitColor(k){ return COMMIT_COLORS[k]||"#9AA091"; }

function renderCommits(){
  var C=DATA.commits||{days:[],types:[],labels:{},events:[]};
  var days=C.days||[], types=C.types||[], labels=C.labels||{}, events=C.events||[];
  var note=document.getElementById("trendNote");
  if(!days.length){ document.getElementById("chart").innerHTML=""; document.getElementById("legend").innerHTML=""; note.textContent="No commitments logged yet."; return; }
  var evByDate={}; for(var i=0;i<events.length;i++){ (evByDate[events[i].date]=evByDate[events[i].date]||[]).push(events[i].label); }
  // day totals + max
  var maxV=1, tot=0;
  for(var a=0;a<days.length;a++){ var s=0; for(var k in days[a].byType) s+=days[a].byType[k]; days[a]._t=s; tot+=s; if(s>maxV)maxV=s; }
  var yTop=Math.ceil(maxV/5)*5||5;
  var W=980,H=300,padL=34,padR=14,padT=44,padB=54;
  var n=days.length, gap=n>60?0.5:1.5, bw=(W-padL-padR)/n;
  function X(idx){ return padL+idx*bw; }
  function Y(v){ return (H-padB) - v/yTop*(H-padT-padB); }
  var svg='<svg viewBox="0 0 '+W+' '+H+'" width="100%" preserveAspectRatio="xMidYMid meet" style="display:block;overflow:visible">';
  // y gridlines
  var ticks=[0,yTop/2,yTop];
  for(var t=0;t<ticks.length;t++){ var yy=Y(ticks[t]); svg+='<line x1="'+padL+'" y1="'+yy+'" x2="'+(W-padR)+'" y2="'+yy+'" stroke="rgba(26,36,24,.10)"/>'; svg+='<text x="'+(padL-6)+'" y="'+(yy+4)+'" text-anchor="end" font-size="11" fill="#5C6356" font-family="DM Sans">'+Math.round(ticks[t])+'</text>'; }
  // annotate the biggest surge days that have an event; drop any that would crowd
  // a bigger neighbor, so labels never overlap. Then order left-to-right + stagger.
  var surge=[]; for(var si=0;si<days.length;si++){ if(evByDate[days[si].date] && days[si]._t>0) surge.push(si); }
  surge.sort(function(p,q){ return days[q]._t-days[p]._t; });   // biggest first
  var keptIdx=[], MINGAP=94;
  for(var kc=0;kc<surge.length && keptIdx.length<6;kc++){
    var cx=X(surge[kc])+bw/2, ok=true;
    for(var kk=0;kk<keptIdx.length;kk++){ if(Math.abs(cx-(X(keptIdx[kk])+bw/2))<MINGAP){ ok=false; break; } }
    if(ok) keptIdx.push(surge[kc]);
  }
  keptIdx.sort(function(a,b){ return a-b; });
  var labelRank={}; keptIdx.forEach(function(idx,i){ labelRank[idx]=i; });
  // bars (stacked) + surge markers
  for(var b=0;b<days.length;b++){
    var day=days[b], y0=H-padB, x=X(b)+gap/2, w=Math.max(1,bw-gap);
    for(var ti=0;ti<types.length;ti++){ var key=types[ti], v=day.byType[key]||0; if(!v) continue; var hgt=(v/yTop)*(H-padT-padB); y0-=hgt; svg+='<rect x="'+x.toFixed(1)+'" y="'+y0.toFixed(1)+'" width="'+w.toFixed(1)+'" height="'+hgt.toFixed(1)+'" fill="'+commitColor(key)+'" rx="1"/>'; }
    // event surge label (top days only, staggered so neighbors don't collide)
    if(labelRank[b]!==undefined){
      var lx=X(b)+bw/2, topY=Y(day._t), ly=padT-12-((labelRank[b]%2)*15);
      svg+='<line x1="'+lx.toFixed(1)+'" y1="'+(topY-4).toFixed(1)+'" x2="'+lx.toFixed(1)+'" y2="'+(ly+3)+'" stroke="#1A2418" stroke-width="1" stroke-dasharray="2,2" opacity="0.4"/>';
      svg+='<circle cx="'+lx.toFixed(1)+'" cy="'+(topY-6).toFixed(1)+'" r="2.5" fill="#1A2418"/>';
      var anchor=lx<90?"start":(lx>W-90?"end":"middle");
      svg+='<text x="'+lx.toFixed(1)+'" y="'+ly+'" text-anchor="'+anchor+'" font-size="11" font-weight="600" fill="#1A2418" font-family="DM Sans">'+esc(shortEv(evByDate[day.date][0]))+'</text>';
    }
  }
  // x axis: month/day ticks spaced out
  var step=Math.ceil(n/10);
  for(var xi=0;xi<n;xi+=step){ svg+='<text x="'+(X(xi)+bw/2).toFixed(1)+'" y="'+(H-padB+18)+'" text-anchor="middle" font-size="10" fill="#5C6356" font-family="DM Sans">'+mdLabel(days[xi].date)+'</text>'; }
  svg+='</svg>';
  document.getElementById("chart").innerHTML=svg;
  // legend (types present, by volume)
  var lg="";
  for(var L=0;L<types.length;L++){ var kk=types[L]; lg+='<span><i style="background:'+commitColor(kk)+'"></i>'+esc(labels[kk]||kk)+'</span>'; }
  document.getElementById("legend").innerHTML=lg;
  note.textContent = nf(tot)+" individual commitments logged since "+mdLabel(C.minDate)+" (a person often makes several). Labeled spikes mark the meeting that drove them.";
}
function shortEv(s){ s=String(s||""); s=s.replace(/ ?(Onboarding|Emergency Meeting|Parent Action Meeting|Training)/gi,""); s=s.replace(/  +/g," ").replace(/^ +| +$/g,""); return s.length>24?s.slice(0,23)+"…":s; }

function setEdit(on){
  EDIT=on;
  document.getElementById("savebar").className="savebar"+(on?" on":"");
  document.getElementById("editBtn").style.display=on?"none":"inline-block";
  render();
}
function save(){
  var goals={}; var ins=document.querySelectorAll(".gin[data-key]");
  for(var i=0;i<ins.length;i++){ var v=Number(ins[i].value); if(isFinite(v)&&v>=0) goals[ins[i].getAttribute("data-key")]=v; }
  var btn=document.getElementById("saveBtn"); btn.textContent="Saving…"; btn.disabled=true;
  fetch("/board/save?k="+encodeURIComponent(TOKEN),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({goals:goals})})
    .then(function(r){return r.json();})
    .then(function(){ btn.textContent="Save"; btn.disabled=false; DATA.goals=Object.assign({},DATA.goals,goals); setEdit(false); })
    .catch(function(){ btn.textContent="Save"; btn.disabled=false; alert("Save failed — try again."); });
}

function countdown(){
  var el=document.getElementById("countdown");
  var days=Math.ceil((Date.parse(VOTE_DAY+"T00:00:00")-Date.now())/86400000);
  el.textContent = days>0 ? (days+" days to Aug 4 vote") : (days===0?"Vote today — Aug 4":"Election passed");
}
function stamp(){
  var upd=DATA&&DATA.generated?new Date(DATA.generated):new Date();
  var hh=upd.getHours(), mm=upd.getMinutes(); var ap=hh>=12?"PM":"AM"; hh=hh%12||12; if(mm<10)mm="0"+mm;
  document.getElementById("updated").innerHTML="Updated "+hh+":"+mm+" "+ap;
}
function load(){
  fetch("/board/data.json?k="+encodeURIComponent(TOKEN)+"&t="+Date.now())
    .then(function(r){ if(!r.ok) throw new Error("auth"); return r.json(); })
    .then(function(j){ DATA=j; document.getElementById("loading").style.display="none"; document.getElementById("app").style.display="block"; render(); stamp(); loadMap(); })
    .catch(function(){ document.getElementById("loading").innerHTML="Could not load — check the link, or refresh in a minute."; });
}
document.getElementById("editBtn").addEventListener("click",function(){setEdit(true);});
document.getElementById("cancelBtn").addEventListener("click",function(){setEdit(false);});
document.getElementById("saveBtn").addEventListener("click",save);
countdown(); load();
setInterval(function(){ if(!EDIT) load(); }, 240000);

// ---- A5 action map: everyone who has done anything, dot per zip ----
var MAP_DRAWN=false;
function loadMap(){
  if(MAP_DRAWN) return; MAP_DRAWN=true;
  var css=document.createElement("link"); css.rel="stylesheet";
  css.href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"; document.head.appendChild(css);
  var s=document.createElement("script"); s.src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
  s.onload=drawMap; s.onerror=function(){ mapFail(); };
  document.head.appendChild(s);
}
function mapFail(){ document.getElementById("mapNote").textContent="Map could not load — refresh to retry."; MAP_DRAWN=false; }
function drawMap(){
  fetch("/board/map.json?k="+encodeURIComponent(TOKEN)+"&t="+Date.now())
    .then(function(r){ if(!r.ok) throw new Error("auth"); return r.json(); })
    .then(function(d){
      var map=L.map("a5map",{scrollWheelZoom:false}).setView([38.45,-92.6],7);
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        {attribution:"&copy; OpenStreetMap &copy; CARTO",maxZoom:17}).addTo(map);
      var C={attended:"#2F5E3D",committed:"#C99633",signed:"#B25048"};
      var bounds=[];
      d.points.forEach(function(p){
        var lvl=p.attended>0?"attended":(p.committed>0?"committed":"signed");
        var rad=5+Math.sqrt(p.total)*3.4;
        bounds.push([p.lat,p.lng]);
        L.circleMarker([p.lat,p.lng],{radius:rad,color:"#1A2418",weight:1,fillColor:C[lvl],fillOpacity:.72}).addTo(map)
          .bindPopup("<b>"+(p.place||p.zip)+"</b> &middot; "+p.zip+"<br>"+
            "<b>"+p.total+"</b> taking action<br>"+
            p.attended+" attended &middot; "+p.committed+" committed &middot; "+p.signed+" signed up");
      });
      if(bounds.length>1) map.fitBounds(bounds,{padding:[28,28],maxZoom:10});
      var extras=[];
      if(d.outside) extras.push(d.outside+" outside the MO/KC map area");
      if(d.no_zip) extras.push(d.no_zip+" without a zip on file");
      document.getElementById("mapNote").textContent=
        d.total+" people have taken action for A5"+(extras.length?" ("+extras.join(", ")+")":"");
      document.getElementById("mapLegend").innerHTML=
        "<span><i style='background:"+C.attended+"'></i>Attended an event</span>"+
        "<span><i style='background:"+C.committed+"'></i>Made a commitment</span>"+
        "<span><i style='background:"+C.signed+"'></i>Signed up</span>"+
        "<span style='opacity:.65'>Bigger dot = more people &middot; click a dot for the breakdown</span>";
    })
    .catch(function(){ mapFail(); });
}
</script>
</body>
</html>`;

// =========================================================================
// Organizer scoreboard — who converts leads best, and (weighted highest) who
// develops recruiters. Credits each contact's ASSIGNED organizer for their
// book moving up the funnel: lead -> worked -> signed up -> took action ->
// their contacts recruit others -> their contacts recruit a recruiter (depth).
// Feeds two CSVs the coaching-tab Apps Script consumes. One contacts pass.
// =========================================================================
async function computeScoreboard(env) {
  const cached = await cacheGet(env, 'cache:scoreboard:v3');
  if (cached) return cached;
  const orgName = await orgNameById(env);
  const flds = ['first', 'last', 'assigned_organizer', 'organized_by', 'events_signed_up', 'amendment5_commitments', 'house_meeting_date', 'one_on_one_booked', 'attempt_count', 'last_attempt_result'];
  const C = {}; // contact id -> {name, orgs, recr:[recruiter ids], signed, acted, worked}
  let off = null;
  do {
    let q = `?pageSize=100` + flds.map(f => `&fields%5B%5D=${encodeURIComponent(f)}`).join('');
    if (off) q += `&offset=${off}`;
    const d = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
    for (const r of d.records) {
      const f = r.fields;
      const signed = Array.isArray(f.events_signed_up) && f.events_signed_up.length > 0;
      const acted = !!(String(f.amendment5_commitments || '').trim() || String(f.house_meeting_date || '').trim() || f.one_on_one_booked);
      const worked = (Number(f.attempt_count) || 0) > 0 || !!String(f.last_attempt_result || '').trim();
      C[r.id] = { name: ((f.first || '') + ' ' + (f.last || '')).trim(), orgs: (f.assigned_organizer || []), recr: (f.organized_by || []), signed, acted, worked };
    }
    off = d.offset;
  } while (off);
  // Peer-recruitment network from organized_by (child -> the contact who recruited them).
  const recruitedCount = {}, childrenOf = {};
  for (const [cid, c] of Object.entries(C)) for (const pid of c.recr) { recruitedCount[pid] = (recruitedCount[pid] || 0) + 1; (childrenOf[pid] = childrenOf[pid] || []).push(cid); }
  const recruiters = new Set(Object.keys(recruitedCount));
  const isDeveloper = pid => (childrenOf[pid] || []).some(cid => recruiters.has(cid)); // recruited a recruiter (depth-2)
  // Aggregate to each contact's assigned organizer.
  const O = {};
  const ensure = id => O[id] || (O[id] = { org: orgName[id] || id, leads: 0, worked: 0, signed: 0, acted: 0, recr: 0, leaders: 0, personal: 0, ws: 0, wa: 0, wr: 0 });
  for (const [cid, c] of Object.entries(C)) {
    const isR = recruiters.has(cid), isD = isDeveloper(cid);
    for (const oid of c.orgs) {
      const a = ensure(oid);
      a.leads++;
      if (c.worked) a.worked++;
      if (c.signed) a.signed++;
      if (c.acted) a.acted++;
      if (isR) a.recr++;
      if (isD) a.leaders++;
      // worked-book intersections -> rates that stay <=100% despite self-signups
      if (c.worked && c.signed) a.ws++;
      if (c.worked && c.acted) a.wa++;
      if (c.worked && isR) a.wr++;
    }
  }
  // Personal recruiting: match an organizer's name to their own contact record's recruits.
  const nameToRecruited = {};
  for (const pid of recruiters) { const nm = (C[pid] && C[pid].name || '').toLowerCase(); if (nm) nameToRecruited[nm] = (nameToRecruited[nm] || 0) + recruitedCount[pid]; }
  for (const id of Object.keys(O)) { O[id].personal = nameToRecruited[(orgName[id] || '').toLowerCase()] || 0; }
  const orgs = Object.values(O).filter(o => o.leads > 0 || o.personal > 0)
    .sort((a, b) => (b.recr - a.recr) || (b.acted - a.acted) || (b.signed - a.signed));
  // Recruitment chains for the recognition tab: one row per recruiter.
  const chains = [];
  for (const pid of recruiters) {
    const kids = childrenOf[pid] || [];
    const bringers = kids.filter(cid => recruiters.has(cid));
    const rc = C[pid];
    chains.push({
      recruiter: rc ? rc.name : pid,
      org: rc && rc.orgs.length ? (orgName[rc.orgs[0]] || '') : '',
      brought: kids.length,
      bringers: bringers.length,
      names: kids.map(cid => (C[cid] && C[cid].name) || '').filter(Boolean).join('; '),
    });
  }
  chains.sort((a, b) => (b.bringers - a.bringers) || (b.brought - a.brought));
  const payload = { generated: new Date().toISOString(), orgs, chains };
  await cachePut(env, 'cache:scoreboard:v3', payload, 300);
  return payload;
}
function csvEsc(s) { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
async function scoreboardExportCsv(env, urlObj) {
  if (!env.EXPORT_KEY || urlObj.searchParams.get('key') !== env.EXPORT_KEY) return new Response('forbidden', { status: 403 });
  const { orgs } = await computeScoreboard(env);
  const out = [['Organizer', 'Leads assigned', 'Leads worked', 'Signed up', 'Took action', 'Recruiters developed', 'Leaders developed', 'Personally recruited', 'Signed (worked)', 'Acted (worked)', 'Recruiters (worked)'].join(',')];
  for (const o of orgs) out.push([o.org, o.leads, o.worked, o.signed, o.acted, o.recr, o.leaders, o.personal, o.ws, o.wa, o.wr].map(csvEsc).join(','));
  return new Response(out.join('\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'max-age=300', 'Access-Control-Allow-Origin': '*' } });
}
async function recruitChainsExportCsv(env, urlObj) {
  if (!env.EXPORT_KEY || urlObj.searchParams.get('key') !== env.EXPORT_KEY) return new Response('forbidden', { status: 403 });
  const { chains } = await computeScoreboard(env);
  const out = [['Recruiter', 'Their organizer', 'Brought in', 'Of those who recruit others', 'People they brought in'].join(',')];
  for (const c of chains) out.push([c.recruiter, c.org, c.brought, c.bringers, c.names].map(csvEsc).join(','));
  return new Response(out.join('\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'max-age=300', 'Access-Control-Allow-Origin': '*' } });
}

// =========================================================================
// Nightly sync: mirror campaign signups/attendance (contact fields + launch
// log rows) into the linked attendance table (ATTENDANCE_MIRROR_TBL), so the
// events<->attendance structure stays current without changing the live
// pipeline. Creates missing event records, adds missing rows, and upgrades
// statuses (Registered -> Showed up / No show). Never deletes or downgrades,
// so manual team rows (Border Star etc.) are untouched.
// =========================================================================
const MIRROR_RANK = { 'Registered': 1, 'No show': 2, 'Showed up': 3 };
// reminder_status funnel ranks — Cancelled > Confirmed > Reminder sent. Higher wins.
const REMIND_RANK = { 'Reminder sent': 1, 'Confirmed': 2, 'Cancelled': 3 };
function mirrorEventName(meta) {
  return meta.type === 'amp' ? meta.label.replace(/^Amplifier /, 'Amplifier Training ') : meta.label;
}
function mirrorLaunchDef(name) {
  const m = String(name).match(/(\d{1,2})\/(\d{1,2})/);
  const date = m ? `2026-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}` : null;
  const typ = /power camp/i.test(name) ? 'Power Camp' : /teacher/i.test(name) ? 'Team meeting' : 'Regional launch';
  return { date, typ };
}
async function syncAttendanceMirror(env) {
  // 1. events table: name -> record id
  const evByName = {};
  let off = null;
  do {
    let q = `?pageSize=100&fields%5B%5D=Name`;
    if (off) q += `&offset=${off}`;
    const d = await at(env, `/${BASE}/${EVENTS_TBL}${q}`);
    for (const r of d.records) { const nm = String(r.fields.Name || '').trim(); if (nm) evByName[nm] = r.id; }
    off = d.offset;
  } while (off);

  // 2. desired status per (contact, event name) from the per-event contact fields
  const metas = Object.values(EVENT_META).filter(m => m.signupField || m.attendField);
  const fields = [];
  for (const m of metas) { if (m.signupField) fields.push(m.signupField); if (m.attendField) fields.push(m.attendField); }
  const best = {}; // 'cid|eventName' -> status
  const put = (cid, ev, status) => { const k = cid + '|' + ev; if (!best[k] || MIRROR_RANK[status] > MIRROR_RANK[best[k]]) best[k] = status; };
  off = null;
  do {
    let q = `?pageSize=100` + fields.map(f => `&fields%5B%5D=${encodeURIComponent(f)}`).join('');
    if (off) q += `&offset=${off}`;
    const d = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
    for (const r of d.records) {
      for (const m of metas) {
        const nm = mirrorEventName(m);
        const av = m.attendField ? r.fields[m.attendField] : null;
        const sv = m.signupField ? r.fields[m.signupField] : null;
        if (av === 'Attended' || av === 'Walk-in' || av === 'Partial') put(r.id, nm, 'Showed up');
        else if (av === 'No-show') put(r.id, nm, 'No show');
        else if (sv === 'Signed up') put(r.id, nm, 'Registered');
      }
    }
    off = d.offset;
  } while (off);

  // 3. launches/camps from contact_log (rsvp_launch rows)
  const launchNames = new Set();
  off = null;
  do {
    let q = `?filterByFormula=${encodeURIComponent(`AND(OR({method}='Event RSVP',{method}='Event attendance'),{rsvp_launch}!=BLANK())`)}&pageSize=100&fields%5B%5D=method&fields%5B%5D=rsvp_launch&fields%5B%5D=contact`;
    if (off) q += `&offset=${off}`;
    const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
    for (const r of d.records) {
      const nm = String(r.fields.rsvp_launch || '').trim();
      if (!nm) continue;
      launchNames.add(nm);
      for (const cid of (r.fields.contact || [])) put(cid, nm, r.fields.method === 'Event attendance' ? 'Showed up' : 'Registered');
    }
    off = d.offset;
  } while (off);

  // 4. create any missing event records (launch names only; meta events were backfilled)
  const missingEvents = [];
  const wanted = new Set(Object.keys(best).map(k => k.split('|')[1]));
  for (const nm of wanted) {
    if (!evByName[nm]) {
      const { date, typ } = mirrorLaunchDef(nm);
      const f = { Name: nm, type: typ };
      if (date) f.date = date;
      missingEvents.push({ fields: f });
    }
  }
  for (let i = 0; i < missingEvents.length; i += 10) {
    const d = await at(env, `/${BASE}/${EVENTS_TBL}`, { method: 'POST', body: JSON.stringify({ records: missingEvents.slice(i, i + 10), typecast: true }) });
    for (const r of d.records) evByName[r.fields.Name] = r.id;
  }

  // 4b. Confirmation-flow signals -> attendance-mirror columns:
  //   - reminder_status: manual funnel value (Reminder sent / Confirmed / Cancelled).
  //     Rank: Cancelled > Confirmed > Reminder sent. Auto-Zoom-sent rows are excluded
  //     (their result is 'Zoom link sent', so they don't hit this branch anyway; the
  //     `notes` filter is a belt-and-suspenders check for the old auto-log rows that
  //     stored 'Reminder sent' before the July fix).
  //   - zoom_link_sent: 'Yes' if the auto-Zoom confirmation email fired for this
  //     (contact, event) — helps distinguish "we sent the link" from "LaNeé texted".
  const remind = {};      // 'cid|evid' -> 'Reminder sent'|'Confirmed'|'Cancelled'
  const zoomSent = {};    // 'cid|evid' -> true if the auto-Zoom email has fired
  off = null;
  do {
    let q = `?filterByFormula=${encodeURIComponent(`OR({result}='Reminder sent',{result}='Confirmed',{result}='Cancelled',{result}='Zoom link sent')`)}&pageSize=100&fields%5B%5D=result&fields%5B%5D=event&fields%5B%5D=rsvp_launch&fields%5B%5D=contact&fields%5B%5D=notes`;
    if (off) q += `&offset=${off}`;
    const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
    for (const r of d.records) {
      const f = r.fields;
      const evLabel = String(f.event || '').trim(), rl = String(f.rsvp_launch || '').trim();
      let name = null;
      const cm = metas.find(m => m.confirmEvent === evLabel);
      if (cm) name = mirrorEventName(cm);
      else if (rl && evByName[rl]) name = rl;
      else if (evByName[evLabel]) name = evLabel;
      else { const ln = (rl || evLabel).replace(/^confirm\s+/i, '').trim(); if (evByName[ln]) name = ln; }
      if (!name) continue;
      const evid = evByName[name];
      const isAuto = String(f.notes || '').includes('Auto-sent');
      for (const cid of (f.contact || [])) {
        const k = cid + '|' + evid;
        // Auto-sent rows (or explicitly 'Zoom link sent') feed only zoom_link_sent.
        if (isAuto || f.result === 'Zoom link sent') { zoomSent[k] = true; continue; }
        if ((REMIND_RANK[f.result] || 0) > (REMIND_RANK[remind[k]] || 0)) remind[k] = f.result;
      }
    }
    off = d.offset;
  } while (off);

  // 5. existing mirror rows -> create missing / upgrade status / fill reminder_status / fill zoom_link_sent
  const have = {}; // 'cid|evid' -> {id, status, remind, zoom}
  off = null;
  do {
    let q = `?pageSize=100&fields%5B%5D=contact&fields%5B%5D=event&fields%5B%5D=attended&fields%5B%5D=reminder_status&fields%5B%5D=zoom_link_sent`;
    if (off) q += `&offset=${off}`;
    const d = await at(env, `/${BASE}/${ATTENDANCE_MIRROR_TBL}${q}`);
    for (const r of d.records) {
      const c = (r.fields.contact || [])[0], e = (r.fields.event || [])[0];
      if (c && e) have[c + '|' + e] = {
        id: r.id,
        status: r.fields.attended || '',
        remind: r.fields.reminder_status || '',
        zoom: r.fields.zoom_link_sent || '',
      };
    }
    off = d.offset;
  } while (off);

  const creates = [], updates = {};
  for (const [k, status] of Object.entries(best)) {
    const [cid, evName] = k.split('|');
    const evid = evByName[evName];
    if (!evid) continue;
    const mk = cid + '|' + evid;
    const cur = have[mk];
    if (!cur) {
      const f = { contact: [cid], event: [evid], attended: status };
      if (remind[mk]) f.reminder_status = remind[mk];
      if (zoomSent[mk]) f.zoom_link_sent = 'Yes';
      creates.push({ fields: f });
    } else if ((MIRROR_RANK[status] || 0) > (MIRROR_RANK[cur.status] || 0)) {
      (updates[cur.id] = updates[cur.id] || {}).attended = status;
    }
  }
  // reminder_status: rank-based upgrade (Cancelled > Confirmed > Reminder sent).
  // Also CLEAR reminder_status when the mirror cell holds a funnel value but no manual
  // signal remains in contact_log — this scrubs rows the pre-fix auto-log had populated.
  for (const mk of Object.keys(have)) {
    const cur = have[mk];
    const newVal = remind[mk] || null;
    const curInFunnel = !!REMIND_RANK[cur.remind];
    if (newVal) {
      const curRank = REMIND_RANK[cur.remind] || 0;
      const newRank = REMIND_RANK[newVal] || 0;
      if (!cur.remind || newRank > curRank) (updates[cur.id] = updates[cur.id] || {}).reminder_status = newVal;
    } else if (curInFunnel) {
      // Pre-fix rows had auto-Zoom sends logged as 'Reminder sent'. Clear those so the
      // column reflects only manual work going forward.
      (updates[cur.id] = updates[cur.id] || {}).reminder_status = '';
    }
  }
  // zoom_link_sent: 'Yes' if the auto-Zoom email fired. Never downgrades.
  for (const [mk, sent] of Object.entries(zoomSent)) {
    const cur = have[mk];
    if (cur && sent && cur.zoom !== 'Yes') (updates[cur.id] = updates[cur.id] || {}).zoom_link_sent = 'Yes';
  }
  const updList = Object.entries(updates).map(([id, fields]) => ({ id, fields }));
  for (let i = 0; i < creates.length; i += 10) await at(env, `/${BASE}/${ATTENDANCE_MIRROR_TBL}`, { method: 'POST', body: JSON.stringify({ records: creates.slice(i, i + 10), typecast: true }) });
  for (let i = 0; i < updList.length; i += 10) await at(env, `/${BASE}/${ATTENDANCE_MIRROR_TBL}`, { method: 'PATCH', body: JSON.stringify({ records: updList.slice(i, i + 10), typecast: true }) });
  return { events_created: missingEvents.length, rows_created: creates.length, rows_updated: updList.length };
}

// Instrumented variant of mirrorWriteThrough — returns 'created' | 'upgraded' |
// 'unchanged' so admin endpoints can surface why a write did or didn't happen.
async function mirrorWriteThroughInstrumented(env, contactId, eventName, status) {
  if (!contactId || !eventName) return 'unchanged';
  // Case-insensitive: forms send lowercase ("7/7 No on 5 onboarding"), meta has
  // "Onboarding". A === miss here mints a dup "Regional launch" event per signup.
  const _en = String(eventName).toLowerCase().trim();
  const metaMatch = Object.values(EVENT_META).find(m => m.attendEvent.toLowerCase() === _en || mirrorEventName(m).toLowerCase() === _en);
  const name = metaMatch ? mirrorEventName(metaMatch) : String(eventName).trim();
  const esc = name.replace(/'/g, "\\'");
  let evId = null;
  const q = await at(env, `/${BASE}/${EVENTS_TBL}?filterByFormula=${encodeURIComponent(`{Name}='${esc}'`)}&maxRecords=1`);
  if (q.records.length) evId = q.records[0].id;
  else {
    const { date, typ } = mirrorLaunchDef(name);
    const f = { Name: name, type: typ };
    if (date) f.date = date;
    const c = await at(env, `/${BASE}/${EVENTS_TBL}`, { method: 'POST', body: JSON.stringify({ records: [{ fields: f }], typecast: true }) });
    evId = c.records[0].id;
  }
  // Linked-record fields in Airtable formulas render as their primary-field
  // strings, not record IDs — so we can't filter by record ID server-side.
  // Filter server-side by the event name (matches its formula lookup field
  // "Attendance Record") to narrow the result set, then match contact ID in JS.
  let hit = null, off = null;
  do {
    let qq = `?filterByFormula=${encodeURIComponent(`FIND('${esc}',{Attendance Record}&'')>0`)}&pageSize=100&fields%5B%5D=contact&fields%5B%5D=event&fields%5B%5D=attended`;
    if (off) qq += `&offset=${off}`;
    const d = await at(env, `/${BASE}/${ATTENDANCE_MIRROR_TBL}${qq}`);
    hit = (d.records || []).find(r => (r.fields.contact || []).includes(contactId)) || hit;
    off = hit ? null : d.offset;
  } while (off);
  if (!hit) {
    await at(env, `/${BASE}/${ATTENDANCE_MIRROR_TBL}`, { method: 'POST', body: JSON.stringify({ records: [{ fields: { contact: [contactId], event: [evId], attended: status } }], typecast: true }) });
    return 'created';
  }
  const cur = hit.fields.attended || '';
  if ((MIRROR_RANK[status] || 0) > (MIRROR_RANK[cur] || 0)) {
    await at(env, `/${BASE}/${ATTENDANCE_MIRROR_TBL}/${hit.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { attended: status }, typecast: true }) });
    return 'upgraded';
  }
  return 'unchanged';
}

// Write-through: create/upgrade the event_attendance mirror row the moment a
// signup or check-in happens, so the Airtable grids are instant for new
// activity. Fully non-fatal — the hourly sweep is the safety net, and both
// paths are idempotent against each other (same contact+event = same row).
async function mirrorWriteThrough(env, contactId, eventName, status) {
  try {
    if (!contactId || !eventName) return;
    // Map training attendEvent labels ("House Meeting Training 7/16") to the
    // mirror's event names ("HM Training 7/16"); launches pass through as-is.
    // Case-insensitive: forms send lowercase ("7/7 No on 5 onboarding"), meta has
    // "Onboarding". A === miss here mints a dup "Regional launch" event per signup.
    const _en = String(eventName).toLowerCase().trim();
    const metaMatch = Object.values(EVENT_META).find(m => m.attendEvent.toLowerCase() === _en || mirrorEventName(m).toLowerCase() === _en);
    const name = metaMatch ? mirrorEventName(metaMatch) : String(eventName).trim();
    const esc = name.replace(/'/g, "\\'");
    // resolve (or create) the event record
    let evId = null;
    const q = await at(env, `/${BASE}/${EVENTS_TBL}?filterByFormula=${encodeURIComponent(`{Name}='${esc}'`)}&maxRecords=1`);
    if (q.records.length) evId = q.records[0].id;
    else {
      const { date, typ } = mirrorLaunchDef(name);
      const f = { Name: name, type: typ };
      if (date) f.date = date;
      const c = await at(env, `/${BASE}/${EVENTS_TBL}`, { method: 'POST', body: JSON.stringify({ records: [{ fields: f }], typecast: true }) });
      evId = c.records[0].id;
    }
    // existing mirror row for this contact+event? (paginate — big events exceed one page)
    let hit = null, off = null;
    do {
      let qq = `?filterByFormula=${encodeURIComponent(`FIND('${esc}',{Attendance Record}&'')>0`)}&pageSize=100&fields%5B%5D=contact&fields%5B%5D=attended`;
      if (off) qq += `&offset=${off}`;
      const d = await at(env, `/${BASE}/${ATTENDANCE_MIRROR_TBL}${qq}`);
      hit = (d.records || []).find(r => (r.fields.contact || []).includes(contactId)) || hit;
      off = hit ? null : d.offset;
    } while (off);
    if (!hit) {
      await at(env, `/${BASE}/${ATTENDANCE_MIRROR_TBL}`, { method: 'POST', body: JSON.stringify({ records: [{ fields: { contact: [contactId], event: [evId], attended: status } }], typecast: true }) });
    } else if ((MIRROR_RANK[status] || 0) > (MIRROR_RANK[hit.fields.attended] || 0)) {
      await at(env, `/${BASE}/${ATTENDANCE_MIRROR_TBL}/${hit.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { attended: status }, typecast: true }) });
    }
  } catch (e) { /* non-fatal — hourly syncAttendanceMirror reconciles */ }
}

// Write-through: set `reminder_status` on the event_attendance mirror row for
// (contact, event) — creates the row if missing so Liz's per-event grid views
// show LaNee's "Reminder sent" / "Confirmed" / "Cancelled" the moment she saves.
// Rank-based (Cancelled > Confirmed > Reminder sent) — a later stronger status
// upgrades the cell but a stronger status already in place isn't downgraded.
// Fully non-fatal; the hourly sync is the safety net.
async function mirrorSetReminderStatus(env, contactId, eventName, newStatus) {
  try {
    if (!contactId || !eventName || !REMIND_RANK[newStatus]) return;
    // Case-insensitive canonicalization (same as mirrorWriteThrough) so a
    // lowercase form name doesn't mint a dup "Regional launch" event here either.
    const _en = String(eventName).toLowerCase().trim();
    const metaMatch = Object.values(EVENT_META).find(m => m.attendEvent.toLowerCase() === _en || mirrorEventName(m).toLowerCase() === _en);
    const name = metaMatch ? mirrorEventName(metaMatch) : String(eventName).trim();
    const esc = name.replace(/'/g, "\\'");
    // resolve (or create) the event record
    let evId = null;
    const q = await at(env, `/${BASE}/${EVENTS_TBL}?filterByFormula=${encodeURIComponent(`{Name}='${esc}'`)}&maxRecords=1`);
    if (q.records.length) evId = q.records[0].id;
    else {
      const { date, typ } = mirrorLaunchDef(name);
      const f = { Name: name, type: typ };
      if (date) f.date = date;
      const c = await at(env, `/${BASE}/${EVENTS_TBL}`, { method: 'POST', body: JSON.stringify({ records: [{ fields: f }], typecast: true }) });
      evId = c.records[0].id;
    }
    // Find the existing mirror row for this (contact, event) — paginate for big events.
    let hit = null, off = null;
    do {
      let qq = `?filterByFormula=${encodeURIComponent(`FIND('${esc}',{Attendance Record}&'')>0`)}&pageSize=100&fields%5B%5D=contact&fields%5B%5D=reminder_status`;
      if (off) qq += `&offset=${off}`;
      const d = await at(env, `/${BASE}/${ATTENDANCE_MIRROR_TBL}${qq}`);
      hit = (d.records || []).find(r => (r.fields.contact || []).includes(contactId)) || hit;
      off = hit ? null : d.offset;
    } while (off);
    if (!hit) {
      await at(env, `/${BASE}/${ATTENDANCE_MIRROR_TBL}`, {
        method: 'POST',
        body: JSON.stringify({ records: [{ fields: { contact: [contactId], event: [evId], reminder_status: newStatus } }], typecast: true })
      });
      return;
    }
    const curStatus = hit.fields.reminder_status || '';
    const curRank = REMIND_RANK[curStatus] || 0;
    const newRank = REMIND_RANK[newStatus] || 0;
    if (!curStatus || newRank > curRank) {
      await at(env, `/${BASE}/${ATTENDANCE_MIRROR_TBL}/${hit.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: { reminder_status: newStatus }, typecast: true })
      });
    }
  } catch (e) { /* non-fatal — hourly syncAttendanceMirror reconciles */ }
}

// =========================================================================
// Regional team trackers. region.csv shapes Airtable into Ellen's ideal
// columns for one region (geo-filtered), seeding commitment statuses from
// the commitment text. sheet-region-update writes contact data-quality
// edits (the cleanup tier) back to Airtable. Add a region by adding a
// REGIONS entry; the Apps Script and column shape stay identical.
// =========================================================================
const REGIONS = {
  northland: {
    label: 'Northland',
    launchEvent: 'Northland Emergency Meeting 6/18',
    match: {
      county:   ['clay', 'platte'],
      city:     ['north kansas city', 'gladstone', 'excelsior springs', 'kearney', 'parkville', 'liberty'],
      district: ['nkc', 'north kansas city', 'liberty', 'park hill', 'smithville', 'kearney', 'excelsior', 'platte city'],
    },
  },
  ejackson: {
    label: 'Eastern Jackson County',
    // Attendance is credited to Ejack for BOTH the region's own 7/1 launch AND
    // the KC 7/9 launch (Ejack folks like Moriah Parham from Raytown often cross
    // over to KC's launch — we still want them flagged "Attended Launch" here).
    launchEvent: [
      'Eastern Jackson County Emergency Meeting on Public School Funding',
      'Kansas City No on 5 Regional Campaign Launch',
    ],
    // No broad county match: Jackson is split east/west (KCPS is its own region). Route by the EJ cities + districts.
    match: {
      county:   [],
      city:     ['blue springs', 'independence', "lee's summit", 'lees summit', 'raytown', 'grandview', 'grain valley', 'oak grove', 'fort osage', 'peculiar', 'raymore'],
      district: ['blue springs', 'independence', "lee's summit", 'lees summit', 'raytown', 'grandview', 'grain valley', 'oak grove', 'fort osage', 'raypec', 'raymore-peculiar', 'raymore'],
    },
  },
  stl_stc: {
    label: 'St. Charles / St. Louis',
    // Two launches in this region: St. Louis 7/6 (done) + St. Charles 7/15. Both
    // flag "Attended Launch". launchEvent accepts a string OR an array; the exact
    // strings match the check-in webhooks' EVENT (written to rsvp_launch on attendance).
    launchEvent: ['St. Louis County Parent Action Meeting 7/6', 'St. Charles County Parent Action Meeting 7/15'],
    match: {
      county:   ['st. louis', 'st louis', 'st. charles', 'st charles', 'warren count', 'lincoln count', 'jefferson count', 'franklin count', 'gasconade'],
      city:     ['st. louis', 'st louis', 'st charles', 'st. charles', 'wentzville', "o'fallon", 'ofallon', 'florissant', 'ferguson', 'hazelwood', 'kirkwood', 'chesterfield', 'ballwin', 'wildwood'],
      district: ['slps', 'st. louis public', 'stc city', 'riverview gardens', 'jennings', 'normandy', 'ferg flor', 'ferguson', 'florissant', 'hazelwood', 'pattonville', 'ritenour', 'university city', 'francis howell', 'wentzville', 'zumwalt', 'orchard farm', 'rockwood', 'parkway', 'kirkwood', 'webster groves', 'ladue', 'clayton', 'lindbergh', 'mehlville', 'fox c-6', 'bayless', 'hancock place', 'maplewood', 'brentwood', 'crystal city', 'hillsboro', 'meramec', 'valley park', 'vally park', 'wright city', 'warren county', 'lincoln county'],
    },
  },
  swmo: {
    label: 'Southwest MO',
    launchEvent: '',
    // Match by county (the SWMO breakdown is county-based per the roster).
    match: {
      county:   ['barton', 'bates', 'cedar', 'christian', 'dade', 'dallas', 'greene', 'hickory', 'jasper', 'lawrence', 'mcdonald', 'newton', 'polk', 'st. clair', 'st clair', 'stone', 'taney', 'vernon', 'webster'],
      city:     [],
      district: [],
    },
  },
  columbia: {
    label: 'Columbia',
    launchEvent: '',
    match: { county: ['boone'], city: ['columbia'], district: ['columbia'] },
  },
  stjoseph: {
    label: 'St. Joseph',
    launchEvent: '',
    match: {
      county:   ['clinton', 'buchanan', 'andrew', 'holt', 'dekalb', 'de kalb', 'nodaway'],
      city:     ['st. joseph', 'st joseph', 'st joe', 'maryville', 'faucett', 'plattsburg'],
      district: ['mid-buchanan', 'st. joseph', 'st joseph', 'savannah', 'maryville'],
    },
  },
  kc: {
    label: 'Kansas City',
    launchEvent: 'Kansas City No on 5 Regional Campaign Launch',
    // KCPS urban core: match the district (KCPS/Center/Hickman Mills) OR a known KC school (charters + KCPS buildings).
    match: {
      county:   [],
      city:     [],
      district: ['kcps', 'kansas city public', 'kansas city 33', 'center', 'hickman mills'],
      school:   ['border star', 'hale cook', 'lincoln prep', 'lincoln middle', 'lincoln college', 'foreign language', 'fla', 'lafayette', 'lcpa', 'paseo', 'holliday', 'hogan', 'crossroads', 'primitivo', 'wendell phillips', 'hartman', 'melcher', 'wheatley', 'carver', 'silver city', 'garfield', 'garcia', 'woodland', 'faxon', 'trailwoods', 'troost', 'banneker', 'longfellow', 'pitcher', 'whittier', 'della lamb', 'guadalupe', 'gordon parks', 'allen village', 'frontier school', 'genesis school', 'university academy', 'scuola vita nuova', 'brookside', 'kauffman', 'james', 'northeast', 'north east'],
    },
  },
};

async function regionExportCsv(env, urlObj) {
  if (!env.EXPORT_KEY || urlObj.searchParams.get('key') !== env.EXPORT_KEY) return new Response('forbidden', { status: 403 });
  const region = REGIONS[(urlObj.searchParams.get('region') || 'northland').toLowerCase()];
  if (!region) return new Response('unknown region', { status: 404 });
  const isAtt = v => { v = String(v || '').toLowerCase(); return v === 'attended' || v === 'walk-in' || v === 'walk in'; };
  const escF = s => String(s).replace(/'/g, "\\'");   // escape apostrophes so "lee's summit" can't break the formula
  const clauses = [];
  for (const c of region.match.county)   clauses.push(`FIND('${escF(c)}',LOWER({county}&''))`);
  for (const c of region.match.city)     clauses.push(`FIND('${escF(c)}',LOWER({city}&''))`);
  for (const c of region.match.district) clauses.push(`FIND('${escF(c)}',LOWER({district}&''))`);
  for (const c of (region.match.school || [])) clauses.push(`FIND('${escF(c)}',LOWER({school}&''))`);   // KC routes by school too (charters + KCPS buildings)
  const formula = `AND({dnc_flag_date}='',OR(${clauses.join(',')}))`;
  const ampFields = Object.values(EVENT_META).filter(e => e.type === 'amp').map(e => e.attendField);
  const hmFields  = Object.values(EVENT_META).filter(e => e.type === 'hm').map(e => e.attendField);
  const baseFields = ['first', 'last', 'role', 'email', 'phone', 'street_address', 'city', 'zip', 'school', 'district', 'county',
    'assigned_organizer', 'amendment5_commitments', 'house_meeting_commitments', 'commitments_added'];
  const allFields = baseFields.concat(ampFields, hmFields);
  // launch attendance set (skip entirely if the region has no launch event — avoids matching blank rsvp_launch)
  const launchSet = new Set();
  let off = null;
  const launchEvents = region.launchEvent ? (Array.isArray(region.launchEvent) ? region.launchEvent : [region.launchEvent]) : [];
  if (launchEvents.length) {
    const orLaunch = 'OR(' + launchEvents.map(n => `{rsvp_launch}='${String(n).replace(/'/g, "\\'")}'`).join(',') + ')';
    do {
      let q = `?filterByFormula=${encodeURIComponent(`AND({method}='Event attendance',${orLaunch})`)}&pageSize=100&fields%5B%5D=contact&fields%5B%5D=result`;
      if (off) q += `&offset=${encodeURIComponent(off)}`;
      const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
      for (const r of d.records) if (isAtt(r.fields.result)) (r.fields.contact || []).forEach(id => launchSet.add(id));
      off = d.offset;
    } while (off);
  }
  // Parent Power Camp attendance (both 6/13 camps) — warmest leads flag for the call sheets
  const ppcSet = new Set();
  off = null;
  do {
    let q = `?filterByFormula=${encodeURIComponent(`AND({method}='Event attendance',FIND('Parent Power Camp',{rsvp_launch}&'')>0)`)}&pageSize=100&fields%5B%5D=contact&fields%5B%5D=result`;
    if (off) q += `&offset=${encodeURIComponent(off)}`;
    const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
    for (const r of d.records) if (isAtt(r.fields.result)) (r.fields.contact || []).forEach(id => ppcSet.add(id));
    off = d.offset;
  } while (off);
  // bucket=needs-data → launch attendees who can't be routed (no usable county/city/district)
  const bucket = (urlObj.searchParams.get('bucket') || '').toLowerCase();
  const junkDist = d => { const s = String(d || '').toLowerCase().replace(/[’']/g, '').trim(); return !s || /^(i\s*dont\s*know|dont\s*know|unknown|n\/?a|none|tbd|\?+)$/.test(s); };
  const isUnrouted = f => !String(f.county || '').trim() && !String(f.city || '').trim() && junkDist(f.district);
  const orgIdName = await orgNameById(env);
  const buildRow = r => {
    const f = r.fields;
    const fn = String(f.first || ''), ln = String(f.last || '');
    if (/^(test|smoke|sample|audit|final|demo)\b/i.test(fn) || /^(test|smoke|sample|audit|final|demo)\b/i.test(ln)) return null;
    if (/test|smoke|example/i.test(String(f.email || ''))) return null;
    const txt = `${f.amendment5_commitments || ''} ${f.house_meeting_commitments || ''} ${f.commitments_added || ''}`.toLowerCase();
    const seed = re => re.test(txt) ? 'Committed' : '';
    return {
      id: r.id,
      first: f.first || '', last: f.last || '',
      organized_by: (f.assigned_organizer || []).map(id => ORGANIZER_NAME_BY_ID[id] || orgIdName[id] || '').filter(Boolean).join('; '),
      role: Array.isArray(f.role) ? f.role.join(', ') : (f.role || ''),
      email: f.email || '', phone: f.phone || '', address: f.street_address || '', city: f.city || '', zip: f.zip || '',
      school: f.school || '', district: f.district || '', county: f.county || '',
      amplifier: seed(/amplif/), house_mtg: seed(/house meeting|host/), school_board: seed(/school board/),
      canvass: seed(/canvass/), regional_team: seed(/regional team/),
      attended_launch: launchSet.has(r.id) ? 'Yes' : '',
      ppc: ppcSet.has(r.id) ? 'Yes' : '',
      amp_training: ampFields.some(ff => isAtt(f[ff])) ? 'Yes' : '',
      hm_training: hmFields.some(ff => isAtt(f[ff])) ? 'Yes' : '',
      gotv_rsvp: '',
    };
  };
  const rows = [];
  if (bucket === 'needs-data') {
    const ids = [...launchSet];
    for (let i = 0; i < ids.length; i += 12) {
      const f2 = 'OR(' + ids.slice(i, i + 12).map(id => `RECORD_ID()='${id}'`).join(',') + ')';
      let q = `?filterByFormula=${encodeURIComponent(f2)}&pageSize=100`;
      for (const fl of allFields) q += `&fields%5B%5D=${encodeURIComponent(fl)}`;
      const d = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
      for (const r of d.records) { if (!isUnrouted(r.fields)) continue; const row = buildRow(r); if (row) rows.push(row); }
    }
  } else {
    off = null;
    do {
      let q = `?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`;
      for (const fl of allFields) q += `&fields%5B%5D=${encodeURIComponent(fl)}`;
      if (off) q += `&offset=${encodeURIComponent(off)}`;
      const d = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
      for (const r of d.records) {
        if (region.label !== 'Kansas City' && /kcps|kansas city public|kansas city 33/i.test(String(r.fields.district || ''))) continue;  // KCPS excluded from other regions, but IS the KC region
        const row = buildRow(r); if (row) rows.push(row);
      }
      off = d.offset;
    } while (off);
  }
  rows.sort((a, b) => (a.last + a.first).toLowerCase().localeCompare((b.last + b.first).toLowerCase()));
  const cols = [['contact_id', 'id'], ['First', 'first'], ['Last', 'last'], ['Organized By', 'organized_by'], ['Role', 'role'],
    ['Email', 'email'], ['Phone', 'phone'], ['Address', 'address'], ['City', 'city'], ['Zip', 'zip'], ['School', 'school'],
    ['District', 'district'], ['County', 'county'], ['Amplifier', 'amplifier'], ['House Mtg', 'house_mtg'],
    ['School Board', 'school_board'], ['Canvass', 'canvass'], ['Regional Team', 'regional_team'],
    ['Attended Launch', 'attended_launch'], ['Amp Training', 'amp_training'], ['HM Training', 'hm_training'], ['GOTV RSVP', 'gotv_rsvp'],
    ['Attended Power Camp', 'ppc']];   // appended LAST — sheet scripts map feed columns by position
  const esc = s => { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const out = [cols.map(c => c[0]).join(',')];
  for (const r of rows) out.push(cols.map(c => esc(r[c[1]])).join(','));
  return new Response(out.join('\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'max-age=120', 'Access-Control-Allow-Origin': '*' } });
}

// Write the data-quality (cleanup) tier back to Airtable. Only existing text
// fields are whitelisted; role and the organizing-work columns are not pushed
// (role is a select, and commitment-status / Team / Flag have no Airtable field).
// Which regional tracker a contact routes to (by county/city/district), or '' if it can't be routed.
function regionFor(f) {
  const county = String(f.county || '').toLowerCase(), city = String(f.city || '').toLowerCase(), district = String(f.district || '').toLowerCase(), school = String(f.school || '').toLowerCase();
  if (String(f.state || '').toUpperCase() === 'KS' || /,\s*ks\b/.test(county) || /^6[67]/.test(String(f.zip || ''))) return 'Kansas (out of state)';  // KS = no MO region
  if (/kcps|kansas city public|kansas city 33|hickman mills|center 58|center school/.test(district)) return 'Kansas City';
  for (const r of Object.values(REGIONS)) {
    const hit = r.match.county.some(c => county.includes(c)) || r.match.city.some(c => city.includes(c)) || r.match.district.some(c => district.includes(c));
    if (hit) return r.label;
  }
  for (const [re, region] of SCHOOL_REGION) if (school && re.test(school)) return region;   // school -> region fallback for the geo-blank
  return '';
}

// Whole-database cleaning feed: every contact + which region they route to + a duplicate hint.
// Powers the all-contacts cleaning sheet. Stranded contacts (no region) sort to the top.
async function allContactsExportCsv(env, urlObj) {
  if (!env.EXPORT_KEY || urlObj.searchParams.get('key') !== env.EXPORT_KEY) return new Response('forbidden', { status: 403 });
  const fields = ['first', 'last', 'email', 'phone', 'street_address', 'city', 'zip', 'school', 'district', 'county', 'assigned_organizer', 'organized_by', 'leader_ladder', 'source', 'state', 'last_attempt_date', 'dnc_flag_date'];
  const recs = [];
  let off = null;
  do {
    let q = `?pageSize=100`;
    for (const fl of fields) q += `&fields%5B%5D=${encodeURIComponent(fl)}`;
    if (off) q += `&offset=${encodeURIComponent(off)}`;
    const d = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
    for (const r of d.records) recs.push(r);
    off = d.offset;
  } while (off);
  // name lookup (for resolving the peer recruiter) + every contact's event history (the best thread for a blank record)
  const nameById = {};
  for (const r of recs) nameById[r.id] = `${r.fields.first || ''} ${r.fields.last || ''}`.trim();
  const orgIdName = await orgNameById(env);
  // full event history: historical/2025 attendance lives in event_attendance; 2026 campaign signups in contact_log. Merge both.
  const eventsBy = {};   // contact_id -> { dates:{event->latestDate}, last:'' }
  const addEv = (cid, ev, dt) => {
    const e = eventsBy[cid] = eventsBy[cid] || { dates: {}, last: '' };
    if (ev) { if (!e.dates[ev] || dt > e.dates[ev]) e.dates[ev] = dt; }
    if (dt && dt > e.last) e.last = dt;
  };
  for (const src of [{ tbl: EVENT_ATTENDANCE_TBL, f: '' }, { tbl: CONTACT_LOG_TBL, f: `&filterByFormula=${encodeURIComponent(`{method}='Event attendance'`)}` }]) {
    let o = null;
    do {
      let q = `?pageSize=100&fields%5B%5D=contact&fields%5B%5D=event&fields%5B%5D=date${src.f}`;
      if (o) q += `&offset=${encodeURIComponent(o)}`;
      const d = await at(env, `/${BASE}/${src.tbl}${q}`);
      for (const lr of d.records) {
        const ev = String(lr.fields.event || '').trim(), dt = String(lr.fields.date || '');
        for (const cid of (lr.fields.contact || [])) addEv(cid, ev, dt);
      }
      o = d.offset;
    } while (o);
  }
  // duplicate detection: contacts sharing an email or a 10-digit phone
  const norm10 = p => String(p || '').replace(/\D/g, '').slice(-10);
  const byEmail = {}, byPhone = {};
  for (const r of recs) {
    const e = String(r.fields.email || '').toLowerCase().trim(); const p = norm10(r.fields.phone);
    if (e) (byEmail[e] = byEmail[e] || []).push(r.id);
    if (p.length === 10) (byPhone[p] = byPhone[p] || []).push(r.id);
  }
  const rows = [];
  for (const r of recs) {
    const f = r.fields;
    const fn = String(f.first || ''), ln = String(f.last || '');
    if (/^(test|smoke|sample|audit|final|demo)\b/i.test(fn) || /^(test|smoke|sample|audit|final|demo)\b/i.test(ln)) continue;
    if (/test|smoke|example/i.test(String(f.email || ''))) continue;
    if (String(f.dnc_flag_date || '').trim()) continue;
    const e = String(f.email || '').toLowerCase().trim(), p = norm10(f.phone);
    const dupe = ((e && (byEmail[e] || []).length > 1) || (p.length === 10 && (byPhone[p] || []).length > 1)) ? 'Possible dupe' : '';
    const evh = eventsBy[r.id] || { dates: {}, last: '' };
    rows.push({
      id: r.id, first: f.first || '', last: f.last || '', email: f.email || '', phone: f.phone || '',
      address: f.street_address || '', city: f.city || '', zip: f.zip || '', school: f.school || '',
      district: f.district || '', county: f.county || '', routes_to: regionFor(f),
      state: f.state || '', events: Object.entries(evh.dates).sort((a, b) => String(b[1] || '').localeCompare(String(a[1] || ''))).slice(0, 8).map(e => e[0]).join('; '),
      recruiter: (f.organized_by || []).map(id => nameById[id] || '').filter(Boolean).join('; '),
      last_touch: String(f.last_attempt_date || '') || evh.last || '',
      organized_by: (f.assigned_organizer || []).map(id => ORGANIZER_NAME_BY_ID[id] || orgIdName[id] || '').filter(Boolean).join('; '),
      leader: f.leader_ladder || '', source: f.source || '', dupe,
    });
  }
  rows.sort((a, b) => {
    const aks = a.routes_to === 'Kansas (out of state)' ? 1 : 0, bks = b.routes_to === 'Kansas (out of state)' ? 1 : 0;
    if (aks !== bks) return aks - bks;                                  // Kansas to the very bottom
    const ar = a.routes_to ? 1 : 0, br = b.routes_to ? 1 : 0;          // then stranded (no region) first
    if (ar !== br) return ar - br;
    if (a.routes_to !== b.routes_to) return a.routes_to.localeCompare(b.routes_to);
    return (a.last + a.first).toLowerCase().localeCompare((b.last + b.first).toLowerCase());
  });
  const cols = [['contact_id', 'id'], ['First', 'first'], ['Last', 'last'], ['Email', 'email'], ['Phone', 'phone'],
    ['Address', 'address'], ['City', 'city'], ['Zip', 'zip'], ['School', 'school'], ['District', 'district'],
    ['County', 'county'], ['Routes to', 'routes_to'], ['State', 'state'], ['Events attended', 'events'],
    ['Recruiter', 'recruiter'], ['Last touch', 'last_touch'], ['Possible dupe', 'dupe'], ['Organized By', 'organized_by'],
    ['Leader', 'leader'], ['Source', 'source']];
  const esc = s => { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const out = [cols.map(c => c[0]).join(',')];
  for (const r of rows) out.push(cols.map(c => esc(r[c[1]])).join(','));
  return new Response(out.join('\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'max-age=120', 'Access-Control-Allow-Origin': '*' } });
}

// Live name -> organizer id map (cached 5 min). Lets newly-added organizers write back
// without a redeploy. The hardcoded ORGANIZER_ID_BY_NAME stays as a fast-path / fallback.
async function orgMap(env) {
  const cached = await cacheGet(env, 'cache:orgmap:v1');
  if (cached) return cached;
  const map = {}; let off = null;
  do {
    let q = `?pageSize=100&fields%5B%5D=name`;
    if (off) q += `&offset=${encodeURIComponent(off)}`;
    const d = await at(env, `/${BASE}/${ORGANIZERS_TBL}${q}`);
    for (const r of d.records) { const nm = String(r.fields.name || '').trim(); if (nm) map[nm.toLowerCase()] = r.id; }
    off = d.offset;
  } while (off);
  await cachePut(env, 'cache:orgmap:v1', map, 300);
  return map;
}
// id -> organizer name, live from the organizers table (so newly-added organizers display in
// the Organized By column + get color-coded, instead of resolving to blank via the fixed map).
async function orgNameById(env) {
  const cached = await cacheGet(env, 'cache:orgnamebyid:v1');
  if (cached) return cached;
  const map = {}; let off = null;
  do {
    let q = `?pageSize=100&fields%5B%5D=name`;
    if (off) q += `&offset=${encodeURIComponent(off)}`;
    const d = await at(env, `/${BASE}/${ORGANIZERS_TBL}${q}`);
    for (const r of d.records) { const nm = String(r.fields.name || '').trim(); if (nm) map[r.id] = nm; }
    off = d.offset;
  } while (off);
  await cachePut(env, 'cache:orgnamebyid:v1', map, 300);
  return map;
}
async function resolveOrganizerId(env, name) {
  const k = String(name || '').toLowerCase().trim();
  if (!k) return null;
  return ORGANIZER_ID_BY_NAME[k] || (await orgMap(env))[k] || null;
}

// Self-serve "add an organizer" from a sheet menu. Creates the organizer (dedupes by name),
// busts the cache so they resolve immediately + show in the dropdown on next refresh.
async function sheetAddOrganizer(request, env) {
  let body; try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  if (!env.EXPORT_KEY || body.key !== env.EXPORT_KEY) return json({ error: 'forbidden' }, 403);
  const name = String(body.name || '').trim();
  if (!name) return json({ error: 'name required' }, 400);
  if (/^(test|smoke|sample|demo)\b/i.test(name)) return json({ error: 'looks like a test name' }, 400);
  const rk = String(body.region || '').toLowerCase();
  const label = (rk && REGIONS[rk]) ? REGIONS[rk].label : '';
  const existing = await at(env, `/${BASE}/${ORGANIZERS_TBL}?filterByFormula=${encodeURIComponent(`LOWER({name})='${name.toLowerCase().replace(/'/g, "\\'")}'`)}&maxRecords=1`);
  if (existing.records.length) {
    const ex = existing.records[0];
    if (label) {   // tag this region onto an existing organizer (separate try so a missing `regions` field never errors the add)
      const cur = String((ex.fields || {}).regions || '');
      if (!cur.toLowerCase().includes(label.toLowerCase())) {
        try { await at(env, `/${BASE}/${ORGANIZERS_TBL}/${ex.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { regions: cur ? cur + ', ' + label : label } }) }); } catch (e) {}
        await env.KV_BINDING.delete('cache:orgmap:v1').catch(() => null);
      }
    }
    return json({ status: 'exists', id: ex.id, name });
  }
  const fields = { name, active: true };
  if (body.email) fields.email = String(body.email).trim();
  if (body.role) fields.role = String(body.role).trim();
  const created = await at(env, `/${BASE}/${ORGANIZERS_TBL}`, { method: 'POST', body: JSON.stringify({ records: [{ fields }], typecast: true }) });
  const id = created.records[0].id;
  if (label) { try { await at(env, `/${BASE}/${ORGANIZERS_TBL}/${id}`, { method: 'PATCH', body: JSON.stringify({ fields: { regions: label } }) }); } catch (e) {} }   // tag region separately so it's a no-op until the field exists
  await env.KV_BINDING.delete('cache:orgmap:v1').catch(() => null);
  return json({ status: 'created', id, name });
}

// Live organizer list for the sheet dropdowns. Active organizers, alphabetical, test names dropped.
async function organizersExportCsv(env, urlObj) {
  if (!env.EXPORT_KEY || urlObj.searchParams.get('key') !== env.EXPORT_KEY) return new Response('forbidden', { status: 403 });
  const rk = (urlObj.searchParams.get('region') || '').toLowerCase();
  const label = (rk && REGIONS[rk]) ? REGIONS[rk].label.toLowerCase() : '';
  const all = []; let off = null;
  do {
    let q = `?pageSize=100&fields%5B%5D=name&fields%5B%5D=active&fields%5B%5D=regions`;
    if (off) q += `&offset=${encodeURIComponent(off)}`;
    const d = await at(env, `/${BASE}/${ORGANIZERS_TBL}${q}`);
    for (const r of d.records) { const nm = String(r.fields.name || '').trim(); if (nm && r.fields.active !== false && !/^(test|smoke|sample|demo)\b/i.test(nm)) all.push({ nm, regions: String(r.fields.regions || '').toLowerCase() }); }
    off = d.offset;
  } while (off);
  let names = all.map(o => o.nm);
  if (label) { const lab2 = label.replace(/ county$/, ''); const f = all.filter(o => o.regions.includes(label) || o.regions.includes(lab2)); if (f.length) names = f.map(o => o.nm); }   // region-specific ("Eastern Jackson" or "...County" both match); falls back to ALL until orgs are tagged
  names.sort((a, b) => a.localeCompare(b));
  const esc = s => /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  return new Response('name\n' + names.map(esc).join('\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'max-age=60', 'Access-Control-Allow-Origin': '*' } });
}

// Create a contact straight from a region sheet's "Add people" tab. Dedupes by email/phone
// (links instead of doubling), derives county from zip, and assigns an organizer. The new
// person then appears in their district tab on the next refresh.
async function sheetAddContact(request, env) {
  let body; try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  if (!env.EXPORT_KEY || body.key !== env.EXPORT_KEY) return json({ error: 'forbidden' }, 403);
  const first = String(body.first || '').trim(), last = String(body.last || '').trim();
  const email = body.email ? String(body.email).toLowerCase().trim() : '';
  const phone = body.phone ? String(body.phone).trim() : '';
  if (!first || !last || (!email && !phone)) return json({ error: 'need first, last, and an email or phone' }, 400);
  const zip = body.zip ? String(body.zip).trim() : '';
  const district = body.district ? String(body.district).trim() : '';
  const school = body.school ? String(body.school).trim() : '';
  // dedupe by email then phone — never create a double
  let existingId = null;
  if (email) {
    const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`LOWER({email})='${email.replace(/'/g, "\\'")}'`)}&maxRecords=1`);
    if (r.records.length) existingId = r.records[0].id;
  }
  if (!existingId && phone) {
    const digits = phone.replace(/\D/g, '').slice(-10);
    if (digits.length === 10) {
      const r2 = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`REGEX_REPLACE({phone},'\\\\D','')='${digits}'`)}&maxRecords=1`);
      if (r2.records.length) existingId = r2.records[0].id;
    }
  }
  if (existingId) {
    // already in the system: apply the location data they typed (so it routes), but don't touch name/contact
    const patch = {};
    if (district) patch.district = district;
    if (school) patch.school = school;
    if (zip) { patch.zip = zip; const c = zipToCounty(zip.slice(0, 5)); if (c) patch.county = c; if (!school && !patch.district) { const d = zipToDistrict(zip); if (d) patch.district = d; } }
    let rec;
    try {
      rec = Object.keys(patch).length
        ? await at(env, `/${BASE}/${CONTACTS_TBL}/${existingId}`, { method: 'PATCH', body: JSON.stringify({ fields: patch, typecast: true }) })
        : await at(env, `/${BASE}/${CONTACTS_TBL}/${existingId}`);
    } catch (e) {}
    const ef = (rec && rec.fields) || {};
    await invalidateReadCaches(env);
    return json({ contact_id: existingId, status: 'matched', name: `${ef.first || first} ${ef.last || last}`.trim(), district: ef.district || district || '' });
  }
  const fields = { first, last, source: 'sheet add', last_attempt_date: todayCT(), leader_ladder: 'Prospect' };
  if (email) fields.email = email;
  if (phone) fields.phone = phone;
  if (zip) { fields.zip = zip; const c = zipToCounty(zip.slice(0, 5)); if (c) fields.county = c; if (!fields.district) { const d = zipToDistrict(zip); if (d) fields.district = d; } }
  if (district) fields.district = district;
  if (school) fields.school = school;
  const orgName = String(body.organized_by || '').toLowerCase().trim();
  const oid = (orgName && ORGANIZER_ID_BY_NAME[orgName]) ? ORGANIZER_ID_BY_NAME[orgName] : deriveOrganizerId({ zip });
  if (oid) fields.assigned_organizer = [oid];
  const created = await at(env, `/${BASE}/${CONTACTS_TBL}`, { method: 'POST', body: JSON.stringify({ records: [{ fields }], typecast: true }) });
  await invalidateReadCaches(env);
  return json({ contact_id: created.records[0].id, status: 'created', name: `${first} ${last}`.trim(), district: district || '' });
}

async function sheetRegionUpdate(request, env) {
  let body; try { body = await request.json(); } catch (e) { return new Response('bad json', { status: 400 }); }
  if (!env.EXPORT_KEY || body.key !== env.EXPORT_KEY) return new Response('forbidden', { status: 403 });
  const ALLOWED = { first: 'first', last: 'last', email: 'email', phone: 'phone', school: 'school',
    district: 'district', city: 'city', zip: 'zip', address: 'street_address', county: 'county' };
  let n = 0;
  for (const u of (body.updates || [])) {
    if (!u.contact_id) continue;
    if (u.field === 'organized_by') {   // Organized By -> assigned_organizer. Match-only: a known organizer writes; an unknown/typo name stays sheet-only (no junk organizer created).
      const v = String(u.value || '').trim();
      if (!v) { try { await at(env, `/${BASE}/${CONTACTS_TBL}/${u.contact_id}`, { method: 'PATCH', body: JSON.stringify({ fields: { assigned_organizer: [] } }) }); n++; } catch (e) {} continue; }
      const oid = await resolveOrganizerId(env, v);   // hardcoded fast-path, then the live org table (so newly-added organizers write back)
      if (oid) { try { await at(env, `/${BASE}/${CONTACTS_TBL}/${u.contact_id}`, { method: 'PATCH', body: JSON.stringify({ fields: { assigned_organizer: [oid] } }) }); n++; } catch (e) {} }
      continue;
    }
    if (!ALLOWED[u.field]) continue;
    const fields = {}; fields[ALLOWED[u.field]] = u.value == null ? '' : String(u.value);
    if (u.field === 'zip') {
      const c = zipToCounty(String(u.value || '').slice(0, 5)); if (c) fields.county = c;
      const dz = zipToDistrict(u.value);
      // only fill district from zip when it is currently blank — never overwrite a real one (their kid may attend elsewhere: charter, magnet, open enrollment)
      if (dz) { try { const cur = await at(env, `/${BASE}/${CONTACTS_TBL}/${u.contact_id}`); if (!String((cur.fields || {}).district || '').trim()) fields.district = dz; } catch (e) {} }
    }
    try { await at(env, `/${BASE}/${CONTACTS_TBL}/${u.contact_id}`, { method: 'PATCH', body: JSON.stringify({ fields }) }); n++; } catch (e) {}
  }
  return new Response(JSON.stringify({ updated: n }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
}

// Live signups across every training/onboarding, one row per person per event,
// with the channel in Source: a website source (homepage, facebook) if we have
// one, otherwise the organizer who signed them up ("LaNeé call", etc.). Launches
// are excluded (they have their own turnout trackers).
async function signupsExportCsv(env, urlObj) {
  if (!env.EXPORT_KEY || urlObj.searchParams.get('key') !== env.EXPORT_KEY) return new Response('forbidden', { status: 403 });
  const metas = Object.entries(EVENT_META).filter(([k, m]) => m.signupField);
  const sigFields = metas.map(([k, m]) => m.signupField);
  // Public events with no dedicated signup_*_status field (e.g. the 6/30 makeup,
  // type 'makeup') are tracked only in events_signed_up — surface them too, so the
  // live feed never silently drops a signup just because it lacks a status column.
  const extraMetas = Object.entries(EVENT_META).filter(([k, m]) => !m.signupField && m.type === 'makeup' && m.attendEvent);
  const sigClause = sigFields.map(f => `{${f}}='Signed up'`);
  const extraClause = extraMetas.map(([k, m]) => `FIND('${m.attendEvent.replace(/'/g, "\\'")}',{events_signed_up}&'')`);
  const orClause = 'OR(' + sigClause.concat(extraClause).join(',') + ')';
  const fields = ['first', 'last', 'email', 'phone', 'zip', 'source', 'assigned_organizer', 'last_attempt_date', 'events_signed_up'].concat(sigFields);
  const rows = [];
  let off = null;
  do {
    let q = `?filterByFormula=${encodeURIComponent(orClause)}&pageSize=100`;
    for (const f of fields) q += `&fields%5B%5D=${encodeURIComponent(f)}`;
    if (off) q += `&offset=${encodeURIComponent(off)}`;
    const d = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
    for (const r of d.records) {
      const f = r.fields;
      const fn = String(f.first || ''), ln = String(f.last || '');
      if (/^(test|smoke|sample|audit|final|demo|pipeline|canary)\b/i.test(fn) || /^(test|smoke|sample|audit|final|demo)\b/i.test(ln)) continue;
      if (/test|smoke|example|gwcanary/i.test(String(f.email || ''))) continue;
      const src = String(f.source || '').trim();
      const orgFull = (f.assigned_organizer || []).map(id => ORGANIZER_NAME_BY_ID[id] || '').filter(Boolean)[0] || '';
      const orgFirst = orgFull.split(' ')[0];
      const source = src ? src : (orgFirst ? `${orgFirst} call` : 'Unknown');
      for (const [k, m] of metas) {
        if (String(f[m.signupField] || '') === 'Signed up') {
          rows.push({ first: f.first || '', last: f.last || '', email: f.email || '', phone: f.phone || '', zip: f.zip || '', event: m.label, source, date: f.last_attempt_date || '' });
        }
      }
      // field-less events (makeup) — detect via events_signed_up
      const esu = Array.isArray(f.events_signed_up) ? f.events_signed_up
        : (typeof f.events_signed_up === 'string' && f.events_signed_up ? f.events_signed_up.split(',').map(s => s.trim()) : []);
      for (const [k, m] of extraMetas) {
        if (esu.some(x => String(x).toLowerCase() === m.attendEvent.toLowerCase())) {
          rows.push({ first: f.first || '', last: f.last || '', email: f.email || '', phone: f.phone || '', zip: f.zip || '', event: m.label, source, date: f.last_attempt_date || '' });
        }
      }
    }
    off = d.offset;
  } while (off);
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const cols = ['First', 'Last', 'Email', 'Phone', 'Zip', 'Event', 'Source', 'Date'];
  const esc = s => { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const out = [cols.join(',')];
  for (const r of rows) out.push([r.first, r.last, r.email, r.phone, r.zip, r.event, r.source, r.date].map(esc).join(','));
  return new Response(out.join('\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'max-age=60', 'Access-Control-Allow-Origin': '*' } });
}

// Per-event training roster (First, Last, Email, Phone, District, Registered),
// append-only by signup date so each person keeps the same row and a volunteer's
// manual Reminder/Confirmed/Attended columns in the Sheet stay aligned as new
// RSVPs land at the bottom. Training signups log method='Event attendance',
// result='Signed up' (not 'Event RSVP'), so this matches that shape. Auth is
// the master EXPORT_KEY or a per-event scoped token (KV roster-token:<event>).
async function trainingRosterCsv(env, urlObj) {
  const event = (urlObj.searchParams.get('event') || '').trim();
  if (!event) return new Response('event required', { status: 400 });
  const t = urlObj.searchParams.get('t') || '';
  const key = urlObj.searchParams.get('key') || '';
  let ok = env.EXPORT_KEY && key === env.EXPORT_KEY;
  if (!ok && t) { const scoped = await env.KV_BINDING.get(`roster-token:${event}`); ok = scoped && t === scoped; }
  if (!ok) return new Response('forbidden', { status: 403 });
  const evEsc = event.replace(/'/g, "\\'");
  const order = []; const seen = new Set(); const rdate = {}; const recruited = {};
  let off = null;
  do {
    let q = `?filterByFormula=${encodeURIComponent(`AND({method}='Event attendance',{result}='Signed up',{event}='${evEsc}')`)}&pageSize=100&fields%5B%5D=contact&fields%5B%5D=date&fields%5B%5D=notes`;
    if (off) q += `&offset=${encodeURIComponent(off)}`;
    const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
    for (const r of d.records) {
      const cid = (r.fields.contact || [])[0];
      if (!cid || seen.has(cid)) continue;
      seen.add(cid); order.push(cid); rdate[cid] = r.fields.date || '';
      const m = String(r.fields.notes || '').match(/Recruited by:\s*([^|]+)/);   // self-reported "who told you" — stored in the signup log notes
      recruited[cid] = m ? m[1].trim() : '';
    }
    off = d.offset;
  } while (off);
  order.sort((a, b) => String(rdate[a]).localeCompare(String(rdate[b])));   // append-only: rows never reorder
  const det = {};
  for (let i = 0; i < order.length; i += 40) {
    const chunk = order.slice(i, i + 40);
    const formula = `OR(${chunk.map(id => `RECORD_ID()='${id}'`).join(',')})`;
    const q = `?filterByFormula=${encodeURIComponent(formula)}&pageSize=100&fields%5B%5D=first&fields%5B%5D=last&fields%5B%5D=email&fields%5B%5D=phone&fields%5B%5D=district&fields%5B%5D=school`;
    const d = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
    for (const r of d.records) det[r.id] = r.fields;
  }
  const esc = s => { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [['First', 'Last', 'Email', 'Phone', 'District', 'School', 'Registered', 'Who told you about this training?'].join(',')];
  for (const cid of order) {
    const f = det[cid] || {};
    const fn = String(f.first || ''), ln = String(f.last || '');
    if (/^(test|smoke|sample|audit|final|demo|pipeline|canary)\b/i.test(fn) || /test|smoke|example|gwcanary/i.test(String(f.email || ''))) continue;   // hide QA rows from the organizer's Sheet
    lines.push([f.first, f.last, f.email, f.phone, f.district, f.school, rdate[cid], recruited[cid]].map(esc).join(','));
  }
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'max-age=120', 'Access-Control-Allow-Origin': '*' } });
}

async function rsvpExportCsv(env, urlObj) {
  if (!env.EXPORT_KEY || urlObj.searchParams.get('key') !== env.EXPORT_KEY) return new Response('forbidden', { status: 403 });
  const event = urlObj.searchParams.get('event') || 'Northland Emergency Meeting 6/18';
  const evEsc = event.replace(/'/g, "\\'");
  let order = []; const recruited = {}; const seen = new Set(); const rdate = {};
  const access = {}, oneeds = {};   // rsvp_accessibility (interpretation folds in here) + rsvp_other_needs
  let pizza = 0, ccFam = 0, ccKids = 0;   // logistics totals for the stats feed
  let off = null;
  do {
    let q = `?filterByFormula=${encodeURIComponent(`AND({method}='Event RSVP',OR({rsvp_launch}='${evEsc}',{event}='${evEsc}'))`)}&pageSize=100&fields%5B%5D=contact&fields%5B%5D=notes&fields%5B%5D=date&fields%5B%5D=rsvp_pizza&fields%5B%5D=rsvp_childcare&fields%5B%5D=rsvp_childcare_kids&fields%5B%5D=rsvp_accessibility&fields%5B%5D=rsvp_other_needs`;
    if (off) q += `&offset=${encodeURIComponent(off)}`;
    const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
    for (const r of d.records) {
      const cid = (r.fields.contact || [])[0];
      if (!cid || seen.has(cid)) continue;
      seen.add(cid); order.push(cid);
      rdate[cid] = r.fields.date || '';
      const m = String(r.fields.notes || '').match(/Recruited by:\s*([^|]+)/);
      recruited[cid] = m ? m[1].trim() : '';
      access[cid] = r.fields.rsvp_accessibility || '';
      oneeds[cid] = r.fields.rsvp_other_needs || '';
      if (r.fields.rsvp_pizza === 'Yes') pizza++;
      if (r.fields.rsvp_childcare === 'Yes') { ccFam++; ccKids += countKids(r.fields.rsvp_childcare_kids); }
    }
    off = d.offset;
  } while (off);
  // Append-only order: sort by RSVP date so existing rows never move and new
  // RSVPs land at the bottom — keeps the Sheet's manual "Claimed by" column aligned.
  order = order.sort((a, b) => String(rdate[a]).localeCompare(String(rdate[b])));
  // stats=1 → just the logistics rollup (registered / pizza / childcare), so the
  // Goals tab can show the same counts the events dashboard does. Computed above,
  // so we skip the per-contact detail fetch.
  if (urlObj.searchParams.get('stats')) {
    const out = [
      ['metric', 'value'].join(','),
      ['registered', order.length].join(','),
      ['pizza', pizza].join(','),
      ['childcare_families', ccFam].join(','),
      ['childcare_kids', ccKids].join(','),
    ].join('\n');
    return new Response(out, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'max-age=60', 'Access-Control-Allow-Origin': '*' } });
  }
  const det = {};
  for (let i = 0; i < order.length; i += 40) {
    const chunk = order.slice(i, i + 40);
    const formula = `OR(${chunk.map(id => `RECORD_ID()='${id}'`).join(',')})`;
    let q = `?filterByFormula=${encodeURIComponent(formula)}&pageSize=100&fields%5B%5D=first&fields%5B%5D=last&fields%5B%5D=email&fields%5B%5D=phone&fields%5B%5D=role&fields%5B%5D=school&fields%5B%5D=district`;
    const d = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
    for (const r of d.records) det[r.id] = r.fields;
  }
  const csvEsc = s => { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  // needs=1 → accessibility/interpretation report (interpretation folds into rsvp_accessibility
  // as "Interpretation: <lang>"). Read-only, additive; the tracker sheets don't pass needs=1
  // so the default roster shape below is untouched. needs=interp filters to interpretation only.
  if (urlObj.searchParams.get('needs')) {
    const interpOnly = urlObj.searchParams.get('needs') === 'interp';
    const nl = [['First Name', 'Last Name', 'Phone', 'Interpretation', 'Language', 'Accessibility / needs', 'Anything else'].join(',')];
    for (const cid of order) {
      const a = String(access[cid] || ''), o = String(oneeds[cid] || '');
      const im = a.match(/Interpretation:\s*([^·|]+)/i);
      const needsInterp = !!im;
      if (interpOnly && !needsInterp) continue;
      const lang = im ? im[1].trim() : '';
      const f = det[cid] || {};
      nl.push([f.first, f.last, f.phone, needsInterp ? 'Yes' : '', lang, a, o].map(csvEsc).join(','));
    }
    return new Response(nl.join('\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
  }
  const lines = [['First Name', 'Last Name', 'Email', 'Phone', 'Role', 'School', 'District', 'Who Recruited'].join(',')];
  for (const cid of order) {
    const f = det[cid] || {};
    const role = Array.isArray(f.role) ? f.role.join(', ') : (f.role || '');
    lines.push([f.first, f.last, f.email, f.phone, role, f.school, f.district, recruited[cid]].map(csvEsc).join(','));
  }
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'max-age=120', 'Access-Control-Allow-Origin': '*' } });
}

// Full deduped mailable contact list for the newsletter. Excludes do-not-contact
// flags and rows without an email, dedupes by email (keeping the most engaged
// record), ranks warmest-first, and stamps a warm-up batch (1 = first 50, 2 =
// next 200, 3 = next 500, 4 = the rest) so comms can send in waves.
// Emails of everyone with an 'Event attendance' row for the event (check-ins +
// dashboard marks). One email per line. The turnout Sheet pulls this to fill its
// Attendance column live, while still keeping manual No-show / Canceled marks.
async function attendanceExportCsv(env, urlObj) {
  if (!env.EXPORT_KEY || urlObj.searchParams.get('key') !== env.EXPORT_KEY) return new Response('forbidden', { status: 403 });
  const event = urlObj.searchParams.get('event') || '';
  const evEsc = event.replace(/'/g, "\\'");
  const cidSelf = {};  // contact id -> true if any of their attendance rows is a self check-in
  const cidWalk = {};  // contact id -> true if any attendance row's notes flag it a walk-in
  const cidRecruit = {};  // contact id -> "Recruited by: X" name parsed from the check-in note
  let off = null;
  do {
    let q = `?filterByFormula=${encodeURIComponent(`AND({method}='Event attendance',OR({rsvp_launch}='${evEsc}',{event}='${evEsc}'))`)}&pageSize=100&fields%5B%5D=contact&fields%5B%5D=notes`;
    if (off) q += `&offset=${encodeURIComponent(off)}`;
    const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
    for (const r of d.records) {
      const c = (r.fields.contact || [])[0]; if (!c) continue;
      const note = String(r.fields.notes || '');
      cidSelf[c] = cidSelf[c] || /self check-in/i.test(note);
      cidWalk[c] = cidWalk[c] || /walk-?in/i.test(note);
      if (!cidRecruit[c]) { const mr = note.match(/recruited by:\s*([^|]+)/i); if (mr) cidRecruit[c] = mr[1].trim(); }
    }
    off = d.offset;
  } while (off);
  const cids = Object.keys(cidSelf);

  // details=1 → full walk-in report: name / phone + a Walk-in flag, so the turnout
  // Sheet can add door registrants it never saw (walk-ins live only in Airtable,
  // never in the RSVP export). Additive — the default email,status shape below is
  // unchanged when `details` is absent. "Walk-in" = attended but never RSVP'd
  // (set-difference against the RSVP set), which also catches rows lacking the note.
  if (urlObj.searchParams.get('details')) {
    const rsvpCids = new Set();
    let ro = null;
    do {
      let q = `?filterByFormula=${encodeURIComponent(`AND({method}='Event RSVP',OR({rsvp_launch}='${evEsc}',{event}='${evEsc}'))`)}&pageSize=100&fields%5B%5D=contact`;
      if (ro) q += `&offset=${encodeURIComponent(ro)}`;
      const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
      for (const r of d.records) { const c = (r.fields.contact || [])[0]; if (c) rsvpCids.add(c); }
      ro = d.offset;
    } while (ro);
    const det = {};
    for (let i = 0; i < cids.length; i += 40) {
      const chunk = cids.slice(i, i + 40);
      const f = `OR(${chunk.map(id => `RECORD_ID()='${id}'`).join(',')})`;
      const d = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(f)}&pageSize=100&fields%5B%5D=first&fields%5B%5D=last&fields%5B%5D=email&fields%5B%5D=phone&fields%5B%5D=school&fields%5B%5D=district`);
      for (const r of d.records) det[r.id] = r.fields;
    }
    const csvEsc = s => { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const out = [['First Name', 'Last Name', 'Email', 'Phone', 'Role', 'School', 'District', 'Recruited By', 'Status', 'Walk-in'].join(',')];
    for (const cid of cids) {
      const f = det[cid] || {};
      const isWalk = !rsvpCids.has(cid) || cidWalk[cid];
      const status = isWalk ? 'Walk-in' : (cidSelf[cid] ? 'Self check-in' : 'Attended');
      out.push([f.first, f.last, f.email, f.phone, '', f.school, f.district, cidRecruit[cid] || '', status, isWalk ? 'Yes' : 'No'].map(csvEsc).join(','));
    }
    return new Response(out.join('\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
  }

  const lines = [];   // email,status  (status = "Self check-in" or "Attended")
  for (let i = 0; i < cids.length; i += 40) {
    const chunk = cids.slice(i, i + 40);
    const f = `OR(${chunk.map(id => `RECORD_ID()='${id}'`).join(',')})`;
    const d = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(f)}&pageSize=100&fields%5B%5D=email`);
    for (const r of d.records) { const e = String(r.fields.email || '').trim().toLowerCase(); if (e) lines.push(e + ',' + (cidSelf[r.id] ? 'Self check-in' : 'Attended')); }
  }
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'max-age=30', 'Access-Control-Allow-Origin': '*' } });
}

// Commitments made by the people who attended a given event, bucketed
// (Amplifier / Canvass / Regional team / …). "count" is all-time commitments by
// those attendees; "count_night" is only those logged on/after `since` (the event
// date) — i.e. commitments made that night. The Sheet uses count_night for the
// STL-format "Commitments made that night" block.
async function eventCommitmentsCsv(env, urlObj) {
  if (!env.EXPORT_KEY || urlObj.searchParams.get('key') !== env.EXPORT_KEY) return new Response('forbidden', { status: 403 });
  const event = urlObj.searchParams.get('event') || '';
  const evEsc = event.replace(/'/g, "\\'");
  const since = String(urlObj.searchParams.get('since') || '').slice(0, 10);   // YYYY-MM-DD; commitments on/after this date count as "that night"
  // 1. Attendee contact ids for this event.
  const attendees = new Set();
  let off = null;
  do {
    let q = `?filterByFormula=${encodeURIComponent(`AND({method}='Event attendance',OR({rsvp_launch}='${evEsc}',{event}='${evEsc}'))`)}&pageSize=100&fields%5B%5D=contact`;
    if (off) q += `&offset=${encodeURIComponent(off)}`;
    const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
    for (const r of d.records) { const c = (r.fields.contact || [])[0]; if (c) attendees.add(c); }
    off = d.offset;
  } while (off);
  // 2. Every commitment log row; keep only those by an attendee. Tally all-time and
  //    "that night" (date on/after `since`). Dedupe per contact per bucket so one
  //    person picking Amplifier twice counts once.
  const seen = {};   // bucket -> Set(cid)  (all-time)
  const seenNight = {};   // bucket -> Set(cid)  (on/after since)
  for (const b of COMMIT_BUCKETS) { seen[b.key] = new Set(); seenNight[b.key] = new Set(); }
  seen.other = new Set(); seenNight.other = new Set();
  off = null;
  do {
    let q = `?filterByFormula=${encodeURIComponent("{method}='Commitment'")}&pageSize=100&fields%5B%5D=event&fields%5B%5D=contact&fields%5B%5D=date`;
    if (off) q += `&offset=${encodeURIComponent(off)}`;
    const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
    for (const r of d.records) {
      const cid = (r.fields.contact || [])[0];
      if (!cid || !attendees.has(cid)) continue;
      const key = commitBucket(r.fields.event) || 'other';
      seen[key].add(cid);
      const dt = String(r.fields.date || r.createdTime || '').slice(0, 10);
      if (since && dt && dt >= since) seenNight[key].add(cid);
      else if (!since) seenNight[key].add(cid);
    }
    off = d.offset;
  } while (off);
  const LABELS = {}; for (const b of COMMIT_BUCKETS) LABELS[b.key] = b.label; LABELS.other = 'Other commitment';
  const csvEsc = s => { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const out = [['key', 'label', 'count', 'count_night'].join(',')];
  const order = [...COMMIT_BUCKETS.map(b => b.key), 'other'];
  for (const k of order) {
    const all = seen[k].size, night = seenNight[k].size;
    if (!all && !night) continue;
    out.push([k, LABELS[k], all, night].map(csvEsc).join(','));
  }
  return new Response(out.join('\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
}

// Import paper commitment cards. Body: { date:'YYYY-MM-DD', event:'…' (optional,
// for the note), people:[ {email, commitments:['amplifier','house_meeting',…]} ] }.
// For each person: find the contact by email, then create one method='Commitment'
// log row per bucket they don't already have. Idempotent — safe to re-run, and the
// count dedupes per contact per bucket anyway. Returns a per-person report.
async function importCommitments(request, env) {
  const url = new URL(request.url);
  if (!env.EXPORT_KEY || url.searchParams.get('key') !== env.EXPORT_KEY) return json({ error: 'forbidden' }, 403);
  let body; try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const date = String(body.date || '').slice(0, 10) || todayCT();
  const eventNote = String(body.event || '');
  const people = Array.isArray(body.people) ? body.people : [];
  const labelFor = k => { const b = COMMIT_BUCKETS.find(x => x.key === k); return b ? b.label : null; };
  // Existing commitments per contact, from the proven scan (a linked {contact}
  // field can't be filtered by record id in an Airtable formula, so we build the
  // contact→buckets map in JS instead — this is what makes the import idempotent).
  const sets = await commitmentSets(env);
  const report = [];
  for (const p of people) {
    const email = String(p.email || '').trim().toLowerCase().replace(/'/g, "\\'");
    // Accept either a bucket key ('house_meeting') or a raw label/phrase ('Host a
    // house meeting'). Match keys directly first, then fall back to the text matcher.
    const want = [...new Set((Array.isArray(p.commitments) ? p.commitments : []).map(c => {
      const s = String(c || '').trim().toLowerCase();
      const byKey = COMMIT_BUCKETS.find(b => b.key === s);
      return byKey ? byKey.key : commitBucket(s);
    }).filter(Boolean))];
    if (!email) { report.push({ email: p.email || '', status: 'skipped: no email' }); continue; }
    const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`LOWER({email})='${email}'`)}&maxRecords=1&fields%5B%5D=first&fields%5B%5D=last`);
    const rec = (r.records || [])[0];
    if (!rec) { report.push({ email: p.email, status: 'skipped: contact not found' }); continue; }
    const cid = rec.id;
    // Existing commitment buckets for this contact, from the proven contact→buckets
    // map. (A per-contact Airtable formula on the linked {contact} field never
    // matches by record id, so the old query always returned empty and this import
    // double-created rows. commitmentSets scans every Commitment row in JS.)
    const have = new Set();
    for (const b of COMMIT_BUCKETS) if (sets[b.key] && sets[b.key].has(cid)) have.add(b.key);
    const toAdd = want.filter(k => !have.has(k));
    const records = toAdd.map(k => ({
      fields: {
        Summary: `${date} — commitment: ${labelFor(k)}`,
        date,
        method: 'Commitment',
        result: 'Committed',
        event: labelFor(k),
        contact: [cid],
        notes: `Paper commitment card${eventNote ? ` at ${eventNote}` : ''} on ${date}`,
      }
    }));
    for (let i = 0; i < records.length; i += 10) {
      await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, { method: 'POST', body: JSON.stringify({ records: records.slice(i, i + 10), typecast: true }) });
    }
    report.push({ email: p.email, name: `${rec.fields.first || ''} ${rec.fields.last || ''}`.trim(), added: toAdd, already_had: [...have].filter(k => want.includes(k)) });
  }
  await invalidateReadCaches(env);
  return json({ ok: true, date, report });
}

// Remove duplicate paper-commitment rows created by an earlier broken-idempotency
// import. Only ever deletes rows whose notes contain "Paper commitment card" and
// whose date is PAPER_DUPE_DATE; keeps exactly one such row per contact+bucket, and
// keeps ZERO paper rows if a non-paper Commitment already covers that contact+bucket.
// Dry-run unless ?confirm=1. Key-gated.
async function cleanupCommitmentDupes(env, urlObj) {
  if (!env.EXPORT_KEY || urlObj.searchParams.get('key') !== env.EXPORT_KEY) return json({ error: 'forbidden' }, 403);
  const PAPER_DUPE_DATE = urlObj.searchParams.get('date') || '2026-07-09';
  const confirm = urlObj.searchParams.get('confirm') === '1';
  const isPaper = f => /Paper commitment card/i.test(String(f.notes || '')) && String(f.date || '').slice(0, 10) === PAPER_DUPE_DATE;
  // Pull every Commitment row (id, event, contact, notes, date).
  const groups = {};  // 'cid|bucket' -> { paper:[ids...], nonPaper:0 }
  let off = null;
  do {
    let q = `?filterByFormula=${encodeURIComponent("{method}='Commitment'")}&pageSize=100`;
    for (const fld of ['event', 'contact', 'notes', 'date']) q += `&fields%5B%5D=${fld}`;
    if (off) q += `&offset=${encodeURIComponent(off)}`;
    const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
    for (const r of d.records) {
      const k = commitBucket(r.fields.event); const cid = (r.fields.contact || [])[0];
      if (!k || !cid) continue;
      const g = groups[`${cid}|${k}`] || (groups[`${cid}|${k}`] = { paper: [], nonPaper: 0 });
      if (isPaper(r.fields)) g.paper.push(r.id); else g.nonPaper++;
    }
    off = d.offset;
  } while (off);
  // Decide deletions: keep one paper row only when nothing else covers the bucket.
  const toDelete = [];
  const kept = [];
  for (const [key, g] of Object.entries(groups)) {
    if (!g.paper.length) continue;
    const keepOne = g.nonPaper === 0;
    const keepIds = keepOne ? g.paper.slice(0, 1) : [];
    const dropIds = g.paper.slice(keepIds.length);
    keepIds.forEach(id => kept.push({ key, id }));
    dropIds.forEach(id => toDelete.push(id));
  }
  let deleted = 0;
  if (confirm) {
    for (let i = 0; i < toDelete.length; i += 10) {
      const batch = toDelete.slice(i, i + 10);
      const qs = batch.map(id => `records%5B%5D=${encodeURIComponent(id)}`).join('&');
      await at(env, `/${BASE}/${CONTACT_LOG_TBL}?${qs}`, { method: 'DELETE' });
      deleted += batch.length;
    }
    await invalidateReadCaches(env);
  }
  return json({ ok: true, date: PAPER_DUPE_DATE, dry_run: !confirm, paper_groups: kept.length, to_delete: toDelete.length, deleted, kept });
}

async function contactsExportCsv(env, urlObj) {
  if (!env.EXPORT_KEY || urlObj.searchParams.get('key') !== env.EXPORT_KEY) return new Response('forbidden', { status: 403 });
  const fields = ['first','last','email','dnc_flag_date','leader_ladder','events_attended_count','wants_amendment5_updates','wants_to_volunteer'];
  const LADDER = { 'Core Leader': 40, 'Leader': 30, 'Supporter': 15, 'Prospect': 5 };
  const byEmail = {};
  let off = null;
  do {
    let q = `?pageSize=100`;
    for (const f of fields) q += `&fields%5B%5D=${encodeURIComponent(f)}`;
    if (off) q += `&offset=${encodeURIComponent(off)}`;
    const d = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
    for (const r of d.records) {
      const f = r.fields;
      if (f.dnc_flag_date) continue;
      const em = String(f.email || '').trim().toLowerCase();
      if (!em || !em.includes('@')) continue;
      const attended = Number(f.events_attended_count) || 0;
      const score = attended * 100 + (LADDER[f.leader_ladder] || 0) + (f.wants_amendment5_updates ? 5 : 0) + (f.wants_to_volunteer ? 5 : 0);
      const tier = attended >= 1 ? `Attended ${attended} event${attended > 1 ? 's' : ''}` : (f.leader_ladder || 'On file');
      const cur = byEmail[em];
      if (!cur || score > cur.score) byEmail[em] = { first: f.first || '', last: f.last || '', email: f.email || em, score, tier };
    }
    off = d.offset;
  } while (off);
  const list = Object.values(byEmail).sort((a, b) => b.score - a.score);
  list.forEach((p, i) => { p.batch = i < 50 ? 1 : i < 250 ? 2 : i < 750 ? 3 : 4; });
  const csvEsc = s => { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [['Email', 'First Name', 'Last Name', 'Warm-up batch', 'Engagement'].join(',')];
  for (const p of list) lines.push([p.email, p.first, p.last, p.batch, p.tier].map(csvEsc).join(','));
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'max-age=300', 'Access-Control-Allow-Origin': '*' } });
}

// Sheet → Airtable launch attendance. Body: { event, marks: [{email, status}] }.
// Idempotent: Attended/Walk-in ensures one 'Event attendance' row exists for that
// person+launch; anything else removes it. The events dashboard counts these rows.
async function sheetAttendance(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.event || !Array.isArray(body.marks)) return json({ error: 'bad request' }, 400);
  // Auth: master EXPORT_KEY, OR the event's scoped roster token — so a volunteer's
  // tracker can write attendance back without ever holding the master key.
  const provided = new URL(request.url).searchParams.get('key') || '';
  let authed = env.EXPORT_KEY && provided === env.EXPORT_KEY;
  if (!authed && provided) { const scoped = await env.KV_BINDING.get(`roster-token:${body.event}`); authed = scoped && provided === scoped; }
  if (!authed) return new Response('forbidden', { status: 403 });
  const event = String(body.event);
  const evEsc = event.replace(/'/g, "\\'");

  // Resolve emails -> contact ids.
  const emails = [...new Set(body.marks.map(m => String(m.email || '').trim().toLowerCase()).filter(Boolean))];
  if (!emails.length) return json({ ok: true, created: 0, deleted: 0 });
  const emailToCid = {};
  for (let i = 0; i < emails.length; i += 40) {
    const chunk = emails.slice(i, i + 40);
    const f = `OR(${chunk.map(e => `LOWER({email})='${e.replace(/'/g, "\\'")}'`).join(',')})`;
    const d = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(f)}&pageSize=100&fields%5B%5D=email`);
    for (const r of d.records) { const em = String(r.fields.email || '').trim().toLowerCase(); if (em && !emailToCid[em]) emailToCid[em] = r.id; }
  }

  // Existing attendance rows for this launch: contact id -> log row id.
  const existing = {};
  let off = null;
  do {
    // result='Attended' is essential: training signups ALSO use method='Event attendance'
    // (result='Signed up'). Without this, a No-show mark would delete the person's
    // signup row and drop them from the roster, and an Attended mark would no-op.
    let q = `?filterByFormula=${encodeURIComponent(`AND({method}='Event attendance',{result}='Attended',OR({rsvp_launch}='${evEsc}',{event}='${evEsc}'))`)}&pageSize=100&fields%5B%5D=contact`;
    if (off) q += `&offset=${encodeURIComponent(off)}`;
    const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
    for (const r of d.records) { const cid = (r.fields.contact || [])[0]; if (cid && !existing[cid]) existing[cid] = r.id; }
    off = d.offset;
  } while (off);

  const present = s => /^(attended|walk[\s-]?in|yes|present|self.?check.?in)$/i.test(String(s || '').trim());
  const toCreate = [], toDelete = [];
  const handled = new Set();
  for (const mk of body.marks) {
    const cid = emailToCid[String(mk.email || '').trim().toLowerCase()];
    if (!cid || handled.has(cid)) continue;
    handled.add(cid);
    if (present(mk.status)) { if (!existing[cid]) toCreate.push(cid); }
    else if (existing[cid]) { toDelete.push(existing[cid]); }
  }

  for (let i = 0; i < toCreate.length; i += 10) {
    const recs = toCreate.slice(i, i + 10).map(cid => ({ fields: {
      Summary: `${todayCT()} — Attended (${event})`,
      date: todayCT(), method: 'Event attendance', result: 'Attended', rsvp_launch: event, contact: [cid],
    }}));
    await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, { method: 'POST', body: JSON.stringify({ records: recs, typecast: true }) });
  }
  for (let i = 0; i < toDelete.length; i += 10) {
    const qs = toDelete.slice(i, i + 10).map(id => `records[]=${encodeURIComponent(id)}`).join('&');
    await at(env, `/${BASE}/${CONTACT_LOG_TBL}?${qs}`, { method: 'DELETE' });
  }
  await env.KV_BINDING.delete('cache:events-overview:v8').catch(() => null);
  return json({ ok: true, created: toCreate.length, deleted: toDelete.length });
}

async function getEventsOverview(env) {
  const cached = await cacheGet(env, 'cache:events-overview:v8');
  if (cached) return json(cached);
  const today = todayCT();
  const metas = allMetaEvents();
  const stat = {};
  for (const m of metas) stat[m.key] = { rsvp: 0, confirmed: 0, attended: 0, no_show: 0, onlist: 0 };

  // Scan 1 — contacts: signups + attendance for the upcoming meta events.
  if (metas.length) {
    const signupOr = metas.filter(m => m.signupField).map(m => `{${m.signupField}}='Signed up'`);
    const attendOr = metas.filter(m => m.attendField).map(m => `{${m.attendField}}!=BLANK()`);
    const listOr = metas.filter(m => !m.signupField && m.attendEvent).map(m => `FIND('${String(m.attendEvent).replace(/'/g, "\\'")}',ARRAYJOIN({events_signed_up}))`);   // makeup-style events (no signup field) live only in events_signed_up
    const formula = `OR(${[...signupOr, ...attendOr, ...listOr].join(',')})`;
    const fields = ['events_signed_up'];
    for (const m of metas) { if (m.signupField) fields.push(m.signupField); if (m.attendField) fields.push(m.attendField); }
    let offset = null;
    do {
      let q = `?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`;
      for (const f of fields) q += `&fields%5B%5D=${encodeURIComponent(f)}`;
      if (offset) q += `&offset=${encodeURIComponent(offset)}`;
      const d = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
      for (const r of d.records) {
        const esu = Array.isArray(r.fields.events_signed_up) ? r.fields.events_signed_up.map(x => String(x).toLowerCase()) : [];
        for (const m of metas) {
          if (m.signupField) { if (r.fields[m.signupField] === 'Signed up') stat[m.key].rsvp++; }
          else if (m.attendEvent && esu.includes(String(m.attendEvent).toLowerCase())) stat[m.key].rsvp++;   // makeup signups come from events_signed_up
          if (m.attendField) {
            const a = r.fields[m.attendField];
            if (a === 'Attended' || a === 'Walk-in' || a === 'Partial') stat[m.key].attended++;
            else if (a === 'No-show') stat[m.key].no_show++;
            // "on the list" = registered, inferable from the attendance field for legacy
            // events (5/26) that never had a signup field.
            if (a === 'Attended' || a === 'No-show' || a === 'Partial') stat[m.key].onlist++;
          }
        }
      }
      offset = d.offset;
    } while (offset);
  }

  // Scan 2 — contact_log: confirm logs (meta events) + launch RSVP/attendance.
  const confirmByEvent = {};
  for (const m of metas) confirmByEvent[m.confirmEvent] = new Set();
  const launches = {};            // name -> {rsvp,pizza,childcare,rsvpIds}
  const launchConfirm = {};       // name -> Set(confirmed contact ids)
  const launchAttendByName = {};  // name -> attended count (merged only if it's a known launch)
  {
    const orClauses = [
      `{method}='Event RSVP'`,
      `{method}='Event attendance'`,
      `{result}='Confirmed'`,
      ...metas.map(m => `{event}='${String(m.confirmEvent).replace(/'/g, "\\'")}'`),
    ];
    const formula = `OR(${orClauses.join(',')})`;
    let offset = null;
    do {
      let q = `?filterByFormula=${encodeURIComponent(formula)}&pageSize=100&fields%5B%5D=method&fields%5B%5D=event&fields%5B%5D=result&fields%5B%5D=contact&fields%5B%5D=rsvp_launch&fields%5B%5D=rsvp_pizza&fields%5B%5D=rsvp_childcare&fields%5B%5D=rsvp_childcare_kids`;
      if (offset) q += `&offset=${encodeURIComponent(offset)}`;
      const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
      for (const r of d.records) {
        const f = r.fields;
        if (f.method === 'Event RSVP') {
          const name = f.rsvp_launch || f.event;
          if (!name) continue;
          if (!launches[name]) launches[name] = { rsvp: 0, pizza: 0, childcare_families: 0, childcare_kids: 0, rsvpIds: new Set() };
          launches[name].rsvp++;
          const cid = (f.contact || [])[0]; if (cid) launches[name].rsvpIds.add(cid);
          if (f.rsvp_pizza === 'Yes') launches[name].pizza++;
          if (f.rsvp_childcare === 'Yes') { launches[name].childcare_families++; launches[name].childcare_kids += countKids(f.rsvp_childcare_kids); }
        } else if (f.method === 'Event attendance') {
          const name = f.rsvp_launch || f.event;
          if (name) launchAttendByName[name] = (launchAttendByName[name] || 0) + 1;
        } else if (f.result === 'Confirmed') {
          const cid = (f.contact || [])[0];
          if (f.event && confirmByEvent[f.event]) {
            if (cid) confirmByEvent[f.event].add(cid);
          } else {
            // a confirmation call logged against a launch (event or rsvp_launch = the launch name)
            const lname = String(f.rsvp_launch || f.event || '').replace(/^confirm\s+/i, '').trim();
            if (lname && cid) { (launchConfirm[lname] = launchConfirm[lname] || new Set()).add(cid); }
          }
        }
      }
      offset = d.offset;
    } while (offset);
  }

  const events = [];
  for (const m of metas) {
    const s = stat[m.key];
    const confirmed = confirmByEvent[m.confirmEvent].size;
    const reg = (m.signupField || !m.attendField) ? s.rsvp : s.onlist;   // legacy (5/26) uses onlist; makeup (no fields) uses events_signed_up count in rsvp
    events.push({
      kind: 'meta', key: m.key, type: m.type, label: m.label, date: m.date,
      time: m.time || null, past: m.date < today,
      rsvp: reg, confirmed, unconfirmed: Math.max(0, reg - confirmed),
      attended: s.attended, no_show: s.no_show,
    });
  }
  for (const [name, l] of Object.entries(launches)) {
    const date = parseLaunchDate(name);
    const isCamp = /power camp/i.test(name);
    const confSet = launchConfirm[name] || new Set();
    let confirmed = 0;
    for (const id of confSet) if (l.rsvpIds.has(id)) confirmed++;
    events.push({
      kind: 'launch', key: `launch:${name}`, type: isCamp ? 'camp' : 'launch', label: name,
      date: date || '', past: !!(date && date < today),
      time: null, rsvp: l.rsvp, confirmed, unconfirmed: Math.max(0, l.rsvp - confirmed),
      pizza: l.pizza, childcare: l.childcare_kids, childcare_families: l.childcare_families,
      attended: launchAttendByName[name] || 0,
    });
  }
  events.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  const payload = { generated: new Date().toISOString(), today, events, type_labels: TYPE_LABEL };
  await cachePut(env, 'cache:events-overview:v8', payload, 60);
  return json(payload);
}

async function fetchContactsByIds(env, ids) {
  const out = {};
  const uniq = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 40) {
    const chunk = uniq.slice(i, i + 40);
    const formula = `OR(${chunk.map(id => `RECORD_ID()='${id}'`).join(',')})`;
    let q = `?filterByFormula=${encodeURIComponent(formula)}&pageSize=100&fields%5B%5D=first&fields%5B%5D=last&fields%5B%5D=phone&fields%5B%5D=email&fields%5B%5D=school&fields%5B%5D=city`;
    const d = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
    for (const r of d.records) out[r.id] = r.fields;
  }
  return out;
}

// Names behind one number on a card (click-to-see-names drilldown).
async function getEventRoster(env, urlObj) {
  const key = urlObj.searchParams.get('key') || '';
  const segment = urlObj.searchParams.get('segment') || 'rsvp';
  const person = (f, extra = {}) => ({
    name: `${f.first || ''} ${f.last || ''}`.trim() || '(no name)',
    phone: f.phone || '', email: f.email || '', school: f.school || '', city: f.city || '', ...extra,
  });

  if (key.startsWith('commitment:')) {
    const bk = key.slice('commitment:'.length);
    if (!COMMIT_BUCKETS.find(b => b.key === bk)) return json({ error: 'unknown commitment' }, 400);
    const sets = await commitmentSets(env);
    const ids = [...(sets[bk] || [])];
    const contacts = await fetchContactsByIds(env, ids);
    const people = ids.map(id => person(contacts[id] || {}));
    return json({ key, segment: 'commitment', count: people.length, people });
  }

  // committed to an action but hasn't shown up to the matching training yet — the follow-up list
  if (key.startsWith('gap:')) {
    const bk = key.slice('gap:'.length);
    const conv = CONVERSION_MAP.find(c => c.key === bk);
    if (!conv) return json({ error: 'unknown' }, 400);
    const sets = await commitmentSets(env);
    const att = await attendedByType(env);
    const ids = [...(sets[bk] || [])].filter(id => !att[conv.type].has(id));
    const contacts = await fetchContactsByIds(env, ids);
    const people = ids.map(id => person(contacts[id] || {}));
    return json({ key, segment: 'gap', count: people.length, people });
  }

  if (key.startsWith('launch:')) {
    const name = key.slice(7);
    const esc1 = name.replace(/'/g, "\\'");
    // confirmed / unconfirmed: RSVPers split by whether a confirmation call was logged
    if (segment === 'confirmed' || segment === 'unconfirmed') {
      const rsvpIds = []; const rmeta = {};
      let o = null;
      do {
        let q = `?filterByFormula=${encodeURIComponent(`AND({method}='Event RSVP',OR({rsvp_launch}='${esc1}',{event}='${esc1}'))`)}&pageSize=100&fields%5B%5D=contact&fields%5B%5D=rsvp_pizza&fields%5B%5D=rsvp_childcare&fields%5B%5D=rsvp_childcare_kids`;
        if (o) q += `&offset=${encodeURIComponent(o)}`;
        const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
        for (const r of d.records) { const cid = (r.fields.contact || [])[0]; if (cid) { rsvpIds.push(cid); rmeta[cid] = { pizza: r.fields.rsvp_pizza === 'Yes', childcare: r.fields.rsvp_childcare === 'Yes', kids: r.fields.rsvp_childcare_kids || '' }; } }
        o = d.offset;
      } while (o);
      const confIds = new Set();
      let o2 = null;
      do {
        let q = `?filterByFormula=${encodeURIComponent(`AND({result}='Confirmed',OR({rsvp_launch}='${esc1}',{event}='${esc1}',{event}='Confirm ${esc1}'))`)}&pageSize=100&fields%5B%5D=contact`;
        if (o2) q += `&offset=${encodeURIComponent(o2)}`;
        const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
        for (const r of d.records) { const cid = (r.fields.contact || [])[0]; if (cid) confIds.add(cid); }
        o2 = d.offset;
      } while (o2);
      const want = [...new Set(rsvpIds)].filter(id => segment === 'confirmed' ? confIds.has(id) : !confIds.has(id));
      const contacts = await fetchContactsByIds(env, want);
      const people = want.map(id => person(contacts[id] || {}, { id, ...(rmeta[id] || {}) }));
      return json({ key, segment, count: people.length, people });
    }
    const wantAttend = segment === 'attended';
    const method = wantAttend ? 'Event attendance' : 'Event RSVP';
    const matchField = wantAttend ? 'event' : 'rsvp_launch';
    let extra = '';
    if (segment === 'pizza') extra = `,{rsvp_pizza}='Yes'`;
    if (segment === 'childcare') extra = `,{rsvp_childcare}='Yes'`;
    const formula = `AND({method}='${method}',OR({rsvp_launch}='${name.replace(/'/g, "\\'")}',{event}='${name.replace(/'/g, "\\'")}')${extra})`;
    const ids = []; let unlinked = 0; let offset = null; let kidsTotal = 0;
    const meta = {};
    const allAges = [];
    do {
      let q = `?filterByFormula=${encodeURIComponent(formula)}&pageSize=100&fields%5B%5D=contact&fields%5B%5D=rsvp_pizza&fields%5B%5D=rsvp_childcare&fields%5B%5D=rsvp_childcare_kids&fields%5B%5D=notes`;
      if (offset) q += `&offset=${encodeURIComponent(offset)}`;
      const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
      for (const r of d.records) {
        if (segment === 'childcare') { kidsTotal += countKids(r.fields.rsvp_childcare_kids); allAges.push(...parseAges(r.fields.rsvp_childcare_kids)); }
        const cid = (r.fields.contact || [])[0];
        if (!cid) { unlinked++; continue; }
        ids.push(cid);
        meta[cid] = { pizza: r.fields.rsvp_pizza === 'Yes', childcare: r.fields.rsvp_childcare === 'Yes', kids: r.fields.rsvp_childcare_kids || '', kid_count: countKids(r.fields.rsvp_childcare_kids) };
      }
      offset = d.offset;
    } while (offset);
    const contacts = await fetchContactsByIds(env, ids);
    const people = ids.map(id => person(contacts[id] || {}, { id, ...(meta[id] || {}) }));
    let kidsOut = {};
    if (segment === 'childcare') {
      const counts = Object.fromEntries(AGE_BANDS.map(b => [b, 0]));
      for (const a of allAges) counts[ageBand(a)]++;
      kidsOut = { kids: kidsTotal, age_dist: AGE_BANDS.map(b => ({ band: b, count: counts[b] })), ages_known: allAges.length };
    }
    return json({ key, segment, count: people.length, unlinked, people, ...kidsOut });
  }

  // Meta event (onboarding / training)
  const m = EVENT_META[key];
  if (!m) return json({ error: 'unknown event' }, 400);
  // Makeup-style events (no signup/attend status fields): the roster lives in events_signed_up,
  // and confirmed/unconfirmed split on the confirm logs the same way as a normal onboarding.
  if (!m.signupField && !m.attendField && m.attendEvent) {
    if (segment === 'attended') return json({ key, segment, count: 0, people: [] });
    const signed = {}; let offset = null;
    const sf = `FIND('${String(m.attendEvent).replace(/'/g, "\\'")}',ARRAYJOIN({events_signed_up}))`;
    do {
      let q = `?filterByFormula=${encodeURIComponent(sf)}&pageSize=100&fields%5B%5D=first&fields%5B%5D=last&fields%5B%5D=phone&fields%5B%5D=email&fields%5B%5D=school&fields%5B%5D=city`;
      if (offset) q += `&offset=${encodeURIComponent(offset)}`;
      const d = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
      for (const r of d.records) signed[r.id] = r.fields;
      offset = d.offset;
    } while (offset);
    const confirmedIds = new Set();
    { let o2 = null;
      const lf = `AND({event}='${String(m.confirmEvent).replace(/'/g, "\\'")}',{result}='Confirmed')`;
      do {
        let q = `?filterByFormula=${encodeURIComponent(lf)}&pageSize=100&fields%5B%5D=contact`;
        if (o2) q += `&offset=${encodeURIComponent(o2)}`;
        const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
        for (const r of d.records) { const cid = (r.fields.contact || [])[0]; if (cid) confirmedIds.add(cid); }
        o2 = d.offset;
      } while (o2);
    }
    let entries = Object.entries(signed);
    if (segment === 'confirmed') entries = entries.filter(([id]) => confirmedIds.has(id));
    if (segment === 'unconfirmed') entries = entries.filter(([id]) => !confirmedIds.has(id));
    const people = entries.map(([id, f]) => person(f, { id, confirmed: confirmedIds.has(id) }));
    return json({ key, segment, count: people.length, people });
  }
  // Legacy events (5/26, no signup field): registration + attendance both come
  // from the attendance field. on-list = Attended/No-show/Partial; came = Attended/Partial/Walk-in.
  if (segment === 'attended' || (!m.signupField && (segment === 'rsvp' || segment === 'registered'))) {
    const onList = !m.signupField && segment !== 'attended';
    const states = onList ? ['Attended', 'No-show', 'Partial'] : ['Attended', 'Walk-in', 'Partial'];
    const formula = `OR(${states.map(s => `{${m.attendField}}='${s}'`).join(',')})`;
    const people = []; let offset = null;
    do {
      let q = `?filterByFormula=${encodeURIComponent(formula)}&pageSize=100&fields%5B%5D=first&fields%5B%5D=last&fields%5B%5D=phone&fields%5B%5D=email&fields%5B%5D=school&fields%5B%5D=city&fields%5B%5D=${encodeURIComponent(m.attendField)}`;
      if (offset) q += `&offset=${encodeURIComponent(offset)}`;
      const d = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
      for (const r of d.records) people.push(person(r.fields, { id: r.id, status: r.fields[m.attendField] }));
      offset = d.offset;
    } while (offset);
    return json({ key, segment, count: people.length, people });
  }
  // rsvp / confirmed / unconfirmed all derive from signed-up ∩ confirm logs
  const signed = {}; let offset = null;
  const sf = `{${m.signupField}}='Signed up'`;
  do {
    let q = `?filterByFormula=${encodeURIComponent(sf)}&pageSize=100&fields%5B%5D=first&fields%5B%5D=last&fields%5B%5D=phone&fields%5B%5D=email&fields%5B%5D=school&fields%5B%5D=city`;
    if (offset) q += `&offset=${encodeURIComponent(offset)}`;
    const d = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
    for (const r of d.records) signed[r.id] = r.fields;
    offset = d.offset;
  } while (offset);
  const confirmedIds = new Set();
  {
    let o2 = null;
    const lf = `AND({event}='${String(m.confirmEvent).replace(/'/g, "\\'")}',{result}='Confirmed')`;
    do {
      let q = `?filterByFormula=${encodeURIComponent(lf)}&pageSize=100&fields%5B%5D=contact`;
      if (o2) q += `&offset=${encodeURIComponent(o2)}`;
      const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
      for (const r of d.records) { const cid = (r.fields.contact || [])[0]; if (cid) confirmedIds.add(cid); }
      o2 = d.offset;
    } while (o2);
  }
  let entries = Object.entries(signed);
  if (segment === 'confirmed') entries = entries.filter(([id]) => confirmedIds.has(id));
  if (segment === 'unconfirmed') entries = entries.filter(([id]) => !confirmedIds.has(id));
  const people = entries.map(([id, f]) => person(f, { id, confirmed: confirmedIds.has(id) }));
  return json({ key, segment, count: people.length, people });
}

async function getEventStats(env, urlObj) {
  const eventParam = urlObj.searchParams.get('event') || '5_26';
  const meta = eventMeta(eventParam);
  const cacheKey = `cache:event-stats:${eventParam}`;
  const cached = await cacheGet(env, cacheKey);
  if (cached) return json(cached);

  // 1. Signups (same gate as the confirm queue)
  const signupClause = meta.signupField
    ? `{${meta.signupField}}='Signed up'`
    : `{last_attempt_result}='Signed up'`;
  const signupIds = new Set();
  {
    let offset = null;
    do {
      let q = `?filterByFormula=${encodeURIComponent(signupClause)}&pageSize=100&fields%5B%5D=Name`;
      if (offset) q += `&offset=${encodeURIComponent(offset)}`;
      const page = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
      for (const r of page.records) signupIds.add(r.id);
      offset = page.offset;
    } while (offset);
  }

  // 2. Confirm logs → per-contact confirm state (methods + best status)
  const confirmState = {};
  {
    const rank = { 'Confirmed': 5, 'Cancelled': 4, 'Declined': 3, 'No answer': 2, 'Reminder sent': 1 };
    let offset = null;
    const lf = `{event}='${meta.confirmEvent}'`;
    do {
      let lq = `?filterByFormula=${encodeURIComponent(lf)}&pageSize=100&fields%5B%5D=contact&fields%5B%5D=method&fields%5B%5D=result`;
      if (offset) lq += `&offset=${offset}`;
      const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${lq}`);
      for (const r of d.records) {
        const cid = (r.fields.contact || [])[0];
        if (!cid) continue;
        if (!confirmState[cid]) confirmState[cid] = { call: false, text: false, email: false, status: null };
        const s = confirmState[cid];
        if (r.fields.method === 'Call') s.call = true;
        if (r.fields.method === 'Text') s.text = true;
        if (r.fields.method === 'Email') s.email = true;
        const res = r.fields.result;
        if (res && (rank[res] || 0) > (rank[s.status] || 0)) s.status = res;
      }
      offset = d.offset;
    } while (offset);
  }

  // 3. Attendance from the contact FIELD — authoritative: Airtable grid bulk
  //    edits and dashboard day-of marks both write it. (Counting log rows
  //    missed every grid edit: 33 logged vs 37 marked for 6/9.)
  const attendance = {};
  {
    const af = `{${meta.attendField}}!=BLANK()`;
    let offset = null;
    do {
      let aq = `?filterByFormula=${encodeURIComponent(af)}&pageSize=100&fields%5B%5D=${encodeURIComponent(meta.attendField)}`;
      if (offset) aq += `&offset=${offset}`;
      const d = await at(env, `/${BASE}/${CONTACTS_TBL}${aq}`);
      for (const r of d.records) {
        attendance[r.id] = { result: r.fields[meta.attendField] };
      }
      offset = d.offset;
    } while (offset);
  }

  // 4. Aggregate the funnel
  const statusCounts = { Confirmed: 0, Declined: 0, Cancelled: 0, 'No answer': 0, 'Reminder sent': 0 };
  for (const s of Object.values(confirmState)) {
    if (s.status && statusCounts[s.status] != null) statusCounts[s.status]++;
  }
  let attended = 0, noShow = 0, walkIn = 0;
  for (const a of Object.values(attendance)) {
    if (a.result === 'Attended') attended++;
    else if (a.result === 'No-show') noShow++;
    else if (a.result === 'Walk-in') walkIn++;
  }
  // Flake = confirmed people who then no-showed / all confirmed with a known outcome
  let confirmedAttended = 0, confirmedNoShow = 0;
  for (const [cid, a] of Object.entries(attendance)) {
    if (confirmState[cid]?.status === 'Confirmed') {
      if (a.result === 'Attended' || a.result === 'Walk-in') confirmedAttended++;
      if (a.result === 'No-show') confirmedNoShow++;
    }
  }
  const flakeDen = confirmedAttended + confirmedNoShow;
  const flake_rate = flakeDen > 0 ? Math.round((confirmedNoShow / flakeDen) * 100) : null;
  const turnout_rate = signupIds.size > 0 ? Math.round(((attended + walkIn) / signupIds.size) * 100) : null;

  // 5. Came vs confirmed, by method. Buckets: call > text > email > none.
  // Matrix over ALL signups: someone who signed up and was never marked
  // Attended counts as didn't-come. (Previously only contacts WITH attendance
  // marks were counted, so zero marked no-shows produced a fake 100% show rate.)
  const matrix = {
    call:  { attended: 0, no_show: 0 },
    text:  { attended: 0, no_show: 0 },
    email: { attended: 0, no_show: 0 },
    none:  { attended: 0, no_show: 0 },
  };
  for (const cid of signupIds) {
    const s = confirmState[cid];
    const bucket = !s ? 'none' : s.call ? 'call' : s.text ? 'text' : s.email ? 'email' : 'none';
    const came = ['Attended', 'Walk-in'].includes(attendance[cid]?.result);
    matrix[bucket][came ? 'attended' : 'no_show']++;
  }

  // 6. Conversion to action: attendees with any post-event action log.
  const attendeeIds = Object.entries(attendance)
    .filter(([, a]) => a.result === 'Attended' || a.result === 'Walk-in')
    .map(([cid]) => cid);
  let withAction = 0, withOneOnOne = 0, withCommitment = 0;
  if (attendeeIds.length > 0 && meta.date) {
    const acted = new Set();
    const oneOnOned = new Set();
    const committed = new Set();
    const pf = `IS_AFTER({date},DATETIME_PARSE('${meta.date}'))`;
    let offset = null;
    do {
      let pq = `?filterByFormula=${encodeURIComponent(pf)}&pageSize=100&fields%5B%5D=contact&fields%5B%5D=method&fields%5B%5D=event&fields%5B%5D=result`;
      if (offset) pq += `&offset=${offset}`;
      const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${pq}`);
      for (const r of d.records) {
        const cid = (r.fields.contact || [])[0];
        if (!cid) continue;
        const m = r.fields.method || '';
        const ev = r.fields.event || '';
        // 1-1s and commitments tracked separately — the conversions the team
        // asks about ("how many from that call made at least one commitment?")
        if (ev === '1-1 meeting') oneOnOned.add(cid);
        if (m === 'Commitment') committed.add(cid);
        if (acted.has(cid)) continue;
        const isAction = m === 'Commitment' || m === 'House meeting'
          || ev === '1-1 meeting'
          || /training|amplifier|house/i.test(ev)
          || r.fields.result === 'Signed up';
        if (isAction) acted.add(cid);
      }
      offset = d.offset;
    } while (offset);
    withAction = attendeeIds.filter(cid => acted.has(cid)).length;
    withOneOnOne = attendeeIds.filter(cid => oneOnOned.has(cid)).length;
    withCommitment = attendeeIds.filter(cid => committed.has(cid)).length;
  }

  // 7. Attendee geography — county/city counts straight off the contact
  //    records (zip falls back through the zip→county table). Feeds the
  //    per-event geography section; the full geocoded map comes next pass.
  const geo = { counties: [], cities: [], points: [] };
  if (attendeeIds.length > 0) {
    const countyCounts = {}, cityCounts = {}, zipCounts = {};
    let fieldCommitted = 0;
    for (let i = 0; i < attendeeIds.length; i += 50) {
      const chunk = attendeeIds.slice(i, i + 50);
      const f = `OR(${chunk.map(id => `RECORD_ID()='${id}'`).join(',')})`;
      const q = `?filterByFormula=${encodeURIComponent(f)}&pageSize=100&fields%5B%5D=county&fields%5B%5D=city&fields%5B%5D=zip&fields%5B%5D=amendment5_commitments&fields%5B%5D=house_meeting_commitments`;
      const d = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
      for (const r of d.records) {
        const county = r.fields.county || (r.fields.zip ? zipToCounty(String(r.fields.zip).slice(0, 5)) : null);
        const city = r.fields.city || null;
        if (county) countyCounts[county] = (countyCounts[county] || 0) + 1;
        if (city) cityCounts[city] = (cityCounts[city] || 0) + 1;
        const z = r.fields.zip ? String(r.fields.zip).trim().slice(0, 5) : null;
        if (z && ZIP_LATLON[z]) zipCounts[z] = (zipCounts[z] || 0) + 1;
        // Commitments captured DURING the event (A5/house-meeting fields)
        // count too — not just post-event Commitment logs.
        if (String(r.fields.amendment5_commitments || '').trim() || String(r.fields.house_meeting_commitments || '').trim()) {
          fieldCommitted++;
        }
      }
    }
    geo.counties = Object.entries(countyCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 10);
    geo.cities = Object.entries(cityCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 10);
    geo.points = Object.entries(zipCounts).map(([z, count]) => {
      const [lat, lon, place] = ZIP_LATLON[z];
      return { zip: z, lat, lon, place, count };
    });
    withCommitment = Math.max(withCommitment, fieldCommitted);
  }

  const payload = {
    event: eventParam,
    label: meta.label,
    date: meta.date,
    signups: signupIds.size,
    confirm_status: statusCounts,
    attended, no_show: noShow, walk_in: walkIn,
    flake_rate,         // % of confirmed people who no-showed (null until attendance logged)
    turnout_rate,       // attended+walk-in as % of signups
    no_show_rate: signupIds.size > 0 ? Math.max(0, 100 - Math.round(((attended + walkIn) / signupIds.size) * 100)) : null,
    confirmed_attended: confirmedAttended,
    confirmed_no_show: confirmedNoShow,
    by_confirm_method: matrix,
    conversion: {
      attendees: attendeeIds.length,
      with_action: withAction,
      with_one_on_one: withOneOnOne,
      with_commitment: withCommitment,
      rate: attendeeIds.length > 0 ? Math.round((withAction / attendeeIds.length) * 100) : null,
      one_on_one_rate: attendeeIds.length > 0 ? Math.round((withOneOnOne / attendeeIds.length) * 100) : null,
      commitment_rate: attendeeIds.length > 0 ? Math.round((withCommitment / attendeeIds.length) * 100) : null,
    },
    geo,
  };
  await cachePut(env, cacheKey, payload, 120);
  return json(payload);
}

// =========================================================================
// /feedback — structured issue intake from the dashboards.
// Two flavors: manual (the 🐞 form — category + message) and auto (JS errors
// + failed saves report themselves, once per signature per session).
// Every report emails Liz with full context (organizer, page, list, event,
// contact, recent errors) and is stored in KV for 30 days. The structure is
// the anti-"custom button free-for-all": categories route the conversation.
// =========================================================================
async function submitFeedback(request, env, reporterEmail) {
  const body = await request.json();
  const { category = 'other', message = '', organizer = '', page = '', contact_id = null, auto = false, diag = null } = body;
  if (!auto && !String(message).trim()) return json({ error: 'message required' }, 400);

  // Rate-limit auto reports so an error loop can't flood the inbox
  if (auto) {
    const rlKey = `feedback:rate:${todayCT()}`;
    const n = parseInt((await env.KV_BINDING.get(rlKey)) || '0');
    if (n >= 20) return json({ ok: true, suppressed: true });
    await env.KV_BINDING.put(rlKey, String(n + 1), { expirationTtl: 86400 });
  }

  const ts = new Date().toISOString();
  const entry = { ts, reporter: reporterEmail, category, message, organizer, page, contact_id, auto, diag };
  await env.KV_BINDING.put(`feedback:${ts}:${genToken(6)}`, JSON.stringify(entry), { expirationTtl: 60 * 60 * 24 * 30 });

  const subject = auto
    ? `[GW pilot · auto] ${String(diag?.errors?.[0] || 'JS error').slice(0, 80)}`
    : `[GW pilot] ${category} — ${organizer || reporterEmail}`;
  const html = `<div style="font-family:monospace;font-size:13px;line-height:1.6">
    <p><b>${auto ? 'AUTOMATIC ERROR REPORT' : 'Issue report'}</b> · ${ts}</p>
    <p><b>From:</b> ${escapeHtml(reporterEmail)} (${escapeHtml(organizer)})<br/>
    <b>Category:</b> ${escapeHtml(category)}<br/>
    <b>Page:</b> ${escapeHtml(page)}<br/>
    ${contact_id ? `<b>Contact:</b> <a href="https://airtable.com/${BASE}/${CONTACTS_TBL}/${escapeHtml(contact_id)}">${escapeHtml(contact_id)}</a><br/>` : ''}
    </p>
    ${message ? `<p><b>What happened:</b><br/>${escapeHtml(message)}</p>` : ''}
    ${diag ? `<p><b>Diagnostics:</b><br/><pre style="white-space:pre-wrap;background:#f4f4f4;padding:8px;border-radius:4px">${escapeHtml(JSON.stringify(diag, null, 2)).slice(0, 3000)}</pre></p>` : ''}
  </div>`;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_AUTH, to: ['emckenna@hks.harvard.edu'], subject, html }),
    });
  } catch (e) { /* KV copy survives even if email fails */ }
  return json({ ok: true });
}

async function getRecentActivity(env, url) {
  const days = parseInt(url.searchParams.get('days') || '14');
  const organizer = url.searchParams.get('organizer');
  const cacheKey = organizer
    ? `cache:recent-activity:${days}:${organizer}`
    : `cache:recent-activity:${days}`;
  const cached = await cacheGet(env, cacheKey);
  if (cached) return json(cached);

  const filter = `IS_AFTER({date},DATEADD(TODAY(),-${days},'days'))`;
  const fields = ['contact','method','result','event','date'];
  let q = `?filterByFormula=${encodeURIComponent(filter)}&pageSize=100`;
  for (const f of fields) q += `&fields%5B%5D=${encodeURIComponent(f)}`;
  const records = [];
  let offset = null;
  do {
    const u = `/${BASE}/${CONTACT_LOG_TBL}${q}${offset ? `&offset=${offset}` : ''}`;
    const data = await at(env, u);
    records.push(...data.records);
    offset = data.offset;
  } while (offset);
  // Filter to only this organizer's assigned contacts when organizer param is set
  const allowedIds = organizer ? await organizerContactIds(env, organizer) : null;

  const byDate = {};
  // Only count actual organizer outreach methods. Skip system events (Event attendance,
  // RSVP, Commitment) and auto-generated confirmation emails (Confirm 5/26).
  const OUTREACH_METHODS = new Set(['Call','Text','Email']);
  for (const r of records) {
    const d = r.fields.date;
    if (!d) continue;
    if (r.fields.event === CONFIRM_EVENT) continue;
    if (!OUTREACH_METHODS.has(r.fields.method)) continue;
    const cid = (r.fields.contact || [])[0];
    if (!cid) continue;
    if (allowedIds && !allowedIds.has(cid)) continue;
    if (!byDate[d]) byDate[d] = {};
    if (!byDate[d][cid]) byDate[d][cid] = { methods: new Set(), result: null, event: null };
    if (r.fields.method) byDate[d][cid].methods.add(r.fields.method);
    if (r.fields.result) byDate[d][cid].result = r.fields.result;
    if (r.fields.event) byDate[d][cid].event = r.fields.event;
  }
  const out = {};
  for (const [d, contacts] of Object.entries(byDate)) {
    out[d] = Object.entries(contacts).map(([cid, info]) => {
      let outcome = null;
      if (info.event === '1-1 meeting') outcome = 'oneonone';
      else if (info.event === 'Orientation 5/26') outcome = 'signed-up';
      else if (info.result === 'Signed up') outcome = 'signed-up';
      else if (info.result === 'Conversation') outcome = 'connected';
      else if (info.result === 'Skipped') outcome = 'skipped';
      else if (info.result === 'Wrong number') outcome = 'wrong-number';
      else if (info.result === 'Do not contact') outcome = 'do-not-contact';
      return {
        contact_id: cid,
        methods: Array.from(info.methods).map(m => METHOD_REVERSE[m] || m.toLowerCase()),
        outcome,
      };
    });
  }
  const payload = { by_date: out };
  await cachePut(env, cacheKey, payload);
  return json(payload);
}

// =========================================================================
// /event-create — admin endpoint to create a new event in the Events table.
// Auth required.
// =========================================================================
async function createEvent(request, env) {
  const body = await request.json();
  const { name, type, date, time, host, location, assigned_organizer, notes } = body;
  if (!type || !date) {
    return json({ error: 'type and date are required' }, 400);
  }

  // Auto-generate name if not provided: "House meeting training — 2026-06-04"
  const eventName = (name && name.trim()) || `${type} — ${date}`;

  const fields = {
    Name: eventName,
    type,
    date,
  };
  if (time && time.trim()) fields.time = time.trim();
  if (host && host.trim()) fields.host = host.trim();
  if (location && location.trim()) fields.location = location.trim();
  if (notes && notes.trim()) fields.notes = notes.trim();
  if (assigned_organizer && ORGANIZER_IDS[assigned_organizer]) {
    fields.assigned_organizer = [ORGANIZER_IDS[assigned_organizer]];
  }

  const created = await at(env, `/${BASE}/${EVENTS_TBL}`, {
    method: 'POST',
    body: JSON.stringify({ records: [{ fields }], typecast: true })
  });

  const eventId = created.records[0].id;
  return json({
    ok: true,
    event_id: eventId,
    name: eventName,
    rsvp_url: `https://parents4mopublicschools.org/rsvp/?event=${eventId}`,
    sign_in_url: `https://parents4mopublicschools.org/house-meeting/?event=${eventId}`,
  });
}

// =========================================================================
// /events — list recent events (most-recent first). Auth required.
// =========================================================================
async function listEvents(env, url) {
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const fields = ['Name', 'type', 'date', 'time', 'host', 'location'];
  let q = `?maxRecords=${limit}&sort%5B0%5D%5Bfield%5D=date&sort%5B0%5D%5Bdirection%5D=desc`;
  for (const f of fields) q += `&fields%5B%5D=${encodeURIComponent(f)}`;
  const data = await at(env, `/${BASE}/${EVENTS_TBL}${q}`);
  return json(data.records.map(r => ({
    id: r.id,
    name: r.fields.Name || '',
    type: r.fields.type || '',
    date: r.fields.date || '',
    time: r.fields.time || '',
    host: r.fields.host || '',
    location: r.fields.location || '',
  })));
}

// =========================================================================
// /event-detail — public lookup of a single event by id, for the RSVP form.
// Returns minimal fields needed to render "RSVP to [name] on [date]".
// =========================================================================
async function eventDetail(env, url) {
  const id = url.searchParams.get('id');
  if (!id || !id.startsWith('rec')) return json({ error: 'invalid event id' }, 400);
  try {
    const data = await at(env, `/${BASE}/${EVENTS_TBL}/${id}`);
    const f = data.fields || {};
    return json({
      id: data.id,
      name: f.Name || '',
      type: f.type || '',
      date: f.date || '',
      time: f.time || '',
      host: f.host || '',
      location: f.location || '',
      notes: f.notes || '',
    });
  } catch (e) {
    return json({ error: 'event not found' }, 404);
  }
}

// =========================================================================
// /event-rsvp — public RSVP submission. Dedupes by email/phone, creates a
// contact_log row linked to the event with method=RSVP, result=RSVPd.
// =========================================================================
async function eventRsvp(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rlKey = `rl:rsvp:${ip}`;
  const count = parseInt(await env.KV_BINDING.get(rlKey) || '0');
  if (count >= 20) return json({ error: 'too many requests, try again later' }, 429, { 'Retry-After': '300' });
  await env.KV_BINDING.put(rlKey, String(count + 1), { expirationTtl: 300 });

  const body = await request.json();
  if (honeypotBot(body)) return json({ error: 'bot detected' }, 400);
  const { event_id, first, last, phone, email, school, district, city, zip, notes } = body;
  if (!event_id || !event_id.startsWith('rec')) return json({ error: 'event_id required' }, 400);
  if (!first || !last || (!email && !phone)) return json({ error: 'first and last name, plus an email or phone, are required' }, 400);

  // Get event to know what we're RSVPing to (used in log entry + email)
  let eventName = '';
  let eventRecord = null;
  try {
    const evt = await at(env, `/${BASE}/${EVENTS_TBL}/${event_id}`);
    eventRecord = evt.fields || {};
    eventName = eventRecord.Name || '';
  } catch (e) {
    return json({ error: 'event not found' }, 404);
  }

  const clean = (s) => String(s || '').replace(/^[^\w\s]+/, '').trim();
  const cFirst = clean(first);
  const cLast = clean(last);
  const cEmail = email ? String(email).toLowerCase().trim() : '';
  const cPhone = phone ? String(phone).trim() : '';

  // Dedupe by email then phone
  let existingId = null;
  if (cEmail) {
    const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`LOWER({email})='${cEmail}'`)}&maxRecords=1`);
    if (r.records.length > 0) existingId = r.records[0].id;
  }
  if (!existingId && cPhone) {
    const digits = cPhone.replace(/\D/g, '').slice(-10);
    if (digits.length === 10) {
      const r2 = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`REGEX_REPLACE({phone},'\\\\D','')='${digits}'`)}&maxRecords=1`);
      if (r2.records.length > 0) existingId = r2.records[0].id;
    }
  }

  // Organizer assignment by city heuristic
  const cityLower = (city || '').toLowerCase();
  const KC_CITIES = ['kansas city', 'independence', 'liberty', 'gladstone', 'raytown', 'grandview', "lee's summit", 'lees summit', 'blue springs', 'belton', 'overland park', 'shawnee', 'olathe', 'lenexa', 'leawood', 'mission', 'merriam'];
  const isLaneeArea = KC_CITIES.some(c => cityLower.includes(c));
  const organizerId = isLaneeArea ? LANEE_ID : STEPHANIE_ID;

  let contactId;
  const baseFields = {
    first: cFirst,
    last: cLast,
    email: cEmail,
    source: `event RSVP: ${eventName}`,
  };
  if (cPhone) baseFields.phone = cPhone;
  if (school) baseFields.school = String(school).trim();
  if (district) baseFields.district = String(district).trim();
  if (city) baseFields.city = String(city).trim();
  if (zip) baseFields.zip = String(zip).trim();

  if (existingId) {
    contactId = existingId;
    // Don't blow away existing data — only patch fields that were provided
    const patch = {};
    if (school) patch.school = baseFields.school;
    if (district) patch.district = baseFields.district;
    if (city) patch.city = baseFields.city;
    if (zip) patch.zip = baseFields.zip;
    if (Object.keys(patch).length > 0) {
      await at(env, `/${BASE}/${CONTACTS_TBL}/${contactId}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: patch, typecast: true })
      });
    }
  } else {
    const fields = {
      ...baseFields,
      leader_ladder: 'Prospect',
      assigned_organizer: [organizerId],
    };
    const created = await at(env, `/${BASE}/${CONTACTS_TBL}`, {
      method: 'POST',
      body: JSON.stringify({ records: [{ fields }], typecast: true })
    });
    contactId = created.records[0].id;
  }

  // Log the RSVP — link to event via the contact_log linked field on Events table
  const date = todayCT();
  await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, {
    method: 'POST',
    body: JSON.stringify({
      records: [{
        fields: {
          Summary: `${date} — RSVP: ${eventName}`,
          date,
          method: 'RSVP',
          result: 'RSVPd',
          event: 'Other event',
          contact: [contactId],
          notes: notes ? `RSVPd via shared link to: ${eventName}\n\n${notes}` : `RSVPd via shared link to: ${eventName}`,
        }
      }],
      typecast: true
    })
  });

  // Send confirmation email (best-effort — don't fail the RSVP if email fails)
  let email_sent = false;
  try {
    await sendRsvpConfirmEmail(env, cEmail, cFirst, eventRecord);
    email_sent = true;
  } catch (e) { /* swallow email errors so RSVP still succeeds */ }

  await invalidateReadCaches(env);
  return json({ ok: true, contact_id: contactId, event_name: eventName, email_sent });
}

// =========================================================================
// RSVP confirmation email — sent automatically after /event-rsvp success.
// Renders event details (name, date, time, location, host) from the Events record.
// =========================================================================
async function sendRsvpConfirmEmail(env, toEmail, firstName, eventRecord) {
  const name = eventRecord.Name || 'our event';
  const type = eventRecord.type || 'event';
  const date = eventRecord.date || '';
  const time = eventRecord.time || '';
  const location = eventRecord.location || '';
  const host = eventRecord.host || '';
  const notes = eventRecord.notes || '';

  // Format date for humans
  let dateLabel = date;
  try {
    const d = new Date(date + 'T12:00:00');
    dateLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  } catch (e) {}

  const safeName = firstName ? `, ${escapeHtml(firstName)}` : '';
  const subject = `You're in — ${name}`;
  const locationIsZoom = /zoom/i.test(location);
  const zoomLinkMatch = (location.match(/https?:\/\/\S+/) || [])[0];

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>You're in — ${escapeHtml(name)}</title>
</head>
<body style="margin:0;padding:0;background:#E9E5CE;font-family:Helvetica,Arial,sans-serif;color:#1A2418">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#E9E5CE">
  <tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%">

      <tr><td style="padding:0 0 28px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="44" style="padding-right:14px;vertical-align:middle">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                <td width="44" height="44" bgcolor="#B25048" style="background:#B25048;border-radius:22px" align="center">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                    <td width="32" height="32" bgcolor="#C99633" style="background:#C99633;border-radius:16px" align="center">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                        <td width="16" height="16" bgcolor="#E9E5CE" style="background:#E9E5CE;border-radius:8px"></td>
                      </tr></table>
                    </td>
                  </tr></table>
                </td>
              </tr></table>
            </td>
            <td style="vertical-align:middle;font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:16px;line-height:1.15;text-transform:uppercase;letter-spacing:.01em;color:#1A2418">
              Parents for Missouri<br/>Public Schools
            </td>
          </tr>
        </table>
      </td></tr>

      <tr><td style="padding:0 0 20px">
        <h1 style="margin:0;font-family:Helvetica,Arial,sans-serif;font-weight:800;font-size:44px;line-height:.95;letter-spacing:.005em;text-transform:uppercase;color:#1A2418">You're in.</h1>
      </td></tr>

      <tr><td style="padding:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A2418">
        Hi${safeName}, thanks for RSVPing to <strong>${escapeHtml(name)}</strong>. Here are the details.
      </td></tr>

      <tr><td style="padding:6px 0 22px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#D9D5C0" style="background:#D9D5C0;border:2px solid #1A2418;border-radius:14px">
          <tr><td style="padding:20px 22px">
            <div style="font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.14em;color:#2F5E3D;margin:0 0 8px">${escapeHtml(type)}</div>
            <div style="font-family:Helvetica,Arial,sans-serif;font-weight:800;font-size:22px;line-height:1.2;text-transform:uppercase;letter-spacing:.01em;color:#1A2418;margin:0 0 10px">${escapeHtml(dateLabel)}</div>
            ${time ? `<div style="font-family:Helvetica,Arial,sans-serif;font-weight:600;font-size:14px;color:#1A2418;margin:0 0 4px">${escapeHtml(time)}</div>` : ''}
            ${location ? `<div style="font-family:Helvetica,Arial,sans-serif;font-weight:600;font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#1A2418;opacity:.7;margin:6px 0 0">${escapeHtml(location)}</div>` : ''}
            ${host ? `<div style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#1A2418;opacity:.7;margin:6px 0 0">Hosted by ${escapeHtml(host)}</div>` : ''}
            ${zoomLinkMatch ? `<div style="margin:18px 0 0"><a href="${zoomLinkMatch}" style="display:inline-block;background:#1A2418;color:#E9E5CE;text-decoration:none;font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:14px;text-transform:uppercase;letter-spacing:.06em;padding:13px 20px;border-radius:8px">Open Zoom link →</a></div>` : ''}
          </td></tr>
        </table>
      </td></tr>

      ${notes ? `<tr><td style="padding:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1A2418">${escapeHtml(notes)}</td></tr>` : ''}

      <tr><td style="padding:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1A2418">
        We'll send a reminder closer to the date. If something changes and you can't make it, please reply to this email.
      </td></tr>

      <tr><td style="padding:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1A2418">
        <strong>Help us reach more parents.</strong> Forward this email to a few people in your circle who care about public schools, and ask them to sign up at <a href="https://parents4mopublicschools.org/" style="color:#1A2418;text-decoration:underline"><strong>parents4mopublicschools.org</strong></a>. Every parent we bring in makes our movement for Missouri's kids stronger.
      </td></tr>

      <tr><td style="padding-top:18px;border-top:1px dashed rgba(26,36,24,.25);font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.55;color:#1A2418">
        Parents for Missouri Public Schools<br/>
        <a href="mailto:${REPLY_TO_CONFIRM}" style="color:#1A2418;text-decoration:underline">${REPLY_TO_CONFIRM}</a>
      </td></tr>

      <tr><td style="padding:14px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:10px;line-height:1.55;letter-spacing:.12em;text-transform:uppercase;color:#1A2418;opacity:.55">
        You're receiving this because you RSVPed at parents4mopublicschools.org. Reply to be removed.
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_CONFIRM, to: [toEmail], reply_to: REPLY_TO_CONFIRM, subject, html }),
  });
  if (!emailRes.ok) throw new Error(`rsvp email failed: ${await emailRes.text()}`);
}

// =========================================================================
// /admin/dedupe-merge — gated by X-Admin-Key header.
// Body: { dry_run: bool, clusters: [{ keeper_id, dupe_ids: [], field_updates: {} }] }
// For each cluster: re-link contact_log entries from dupe → keeper, then DELETE dupe.
// =========================================================================
async function adminDedupeMerge(request, env) {
  const key = request.headers.get('X-Admin-Key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return json({ error: 'forbidden' }, 403);
  }
  const body = await request.json();
  const dryRun = !!body.dry_run;
  const clusters = body.clusters || [];
  if (!Array.isArray(clusters)) return json({ error: 'clusters must be array' }, 400);

  const results = [];
  for (const cluster of clusters) {
    const { keeper_id, dupe_ids, field_updates } = cluster;
    if (!keeper_id || !Array.isArray(dupe_ids) || false) {
      results.push({ keeper_id, error: 'invalid cluster (need keeper_id + non-empty dupe_ids)' });
      continue;
    }

    const r = { keeper_id, dupe_ids, relinked: 0, deleted: 0, errors: [] };

    for (const dupeId of dupe_ids) {
      try {
        // Find all contact_log entries linked to this dupe
        const filter = `FIND('${dupeId}',ARRAYJOIN({contact}))>0`;
        const logIds = [];
        let offset = null;
        do {
          let q = `?filterByFormula=${encodeURIComponent(filter)}&pageSize=100&fields%5B%5D=contact`;
          if (offset) q += `&offset=${offset}`;
          const data = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
          for (const rec of data.records) logIds.push({ id: rec.id, contact: rec.fields.contact || [] });
          offset = data.offset;
        } while (offset);

        // Re-link each log entry: swap dupeId for keeper_id
        for (const log of logIds) {
          const newContacts = Array.from(new Set(log.contact.map(c => c === dupeId ? keeper_id : c)));
          if (!dryRun) {
            await at(env, `/${BASE}/${CONTACT_LOG_TBL}/${log.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ fields: { contact: newContacts } })
            });
          }
          r.relinked++;
        }

        // Delete the dupe contact
        if (!dryRun) {
          const delUrl = new URL(`https://api.airtable.com/v0/${BASE}/${CONTACTS_TBL}/${dupeId}`);
          const dr = await fetch(delUrl, { method: 'DELETE', headers: { 'Authorization': `Bearer ${env.AIRTABLE_TOKEN}` } });
          if (dr.ok) r.deleted++;
          else r.errors.push(`delete ${dupeId} failed: ${dr.status} ${await dr.text()}`);
        } else {
          r.deleted++;
        }
      } catch (e) {
        r.errors.push(`dupe ${dupeId}: ${e.message}`);
      }
    }

    // Apply field updates to keeper (e.g. Molly's edits to green-row cells)
    if (field_updates && Object.keys(field_updates).length > 0 && !dryRun) {
      try {
        await at(env, `/${BASE}/${CONTACTS_TBL}/${keeper_id}`, {
          method: 'PATCH',
          body: JSON.stringify({ fields: field_updates, typecast: true })
        });
        r.field_updates_applied = true;
      } catch (e) {
        r.errors.push(`patch keeper ${keeper_id}: ${e.message}`);
      }
    }

    results.push(r);
  }

  if (!dryRun) await invalidateReadCaches(env);
  return json({ ok: true, dry_run: dryRun, clusters: results });
}

// =========================================================================
// /admin/contacts-dump — admin-key gated. Paginated dump of all contacts.
// Query params: ?page_size=100&offset=...  Returns: { records, offset }
// =========================================================================
async function adminContactsDump(request, env, urlObj) {
  const key = request.headers.get('X-Admin-Key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
  const pageSize = Math.min(parseInt(urlObj.searchParams.get('page_size') || '100'), 100);
  const reqOffset = urlObj.searchParams.get('offset') || '';
  const fields = ['Name','first','last','email','phone','school','district','county','city','state','zip','street_address','leader_ladder','assigned_organizer','source','role'];
  let q = `?pageSize=${pageSize}`;
  for (const f of fields) q += `&fields%5B%5D=${encodeURIComponent(f)}`;
  if (reqOffset) q += `&offset=${encodeURIComponent(reqOffset)}`;
  const data = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
  return json({
    records: data.records.map(r => ({ id: r.id, ...r.fields })),
    offset: data.offset || null,
  });
}

// =========================================================================
// /admin/role-append — admin-key gated. Append a role value to multiple
// contacts' multi-select `role` field without overwriting existing values.
// Body: { record_ids: [...], role_value: "Fellow organizer" }
// =========================================================================
async function adminRoleAppend(request, env) {
  const key = request.headers.get('X-Admin-Key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
  const body = await request.json();
  const ids = body.record_ids || [];
  const value = body.role_value;
  if (!Array.isArray(ids) || ids.length === 0) return json({ error: 'record_ids required' }, 400);
  if (!value) return json({ error: 'role_value required' }, 400);

  const results = [];
  for (const id of ids) {
    try {
      const data = await at(env, `/${BASE}/${CONTACTS_TBL}/${id}`);
      const current = Array.isArray(data.fields.role) ? data.fields.role : (data.fields.role ? [data.fields.role] : []);
      if (current.includes(value)) {
        results.push({ id, status: 'already-tagged', role: current });
        continue;
      }
      const next = [...current, value];
      await at(env, `/${BASE}/${CONTACTS_TBL}/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: { role: next }, typecast: true })
      });
      results.push({ id, status: 'updated', role: next });
    } catch (e) {
      results.push({ id, status: 'error', error: e.message });
    }
  }
  await invalidateReadCaches(env);
  return json({ ok: true, count: ids.length, results });
}

// =========================================================================
// /admin/queue-check?organizer=lanee — diagnostic: returns the filter formula
// being used + how many records match + first 5 contact names/IDs. Admin-key gated.
// =========================================================================
async function adminQueueCheck(request, env, urlObj) {
  const key = request.headers.get('X-Admin-Key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
  const organizer = urlObj.searchParams.get('organizer') || null;
  const orgId = organizerId(organizer);
  const filter = prospectsFilter(organizer);
  let q = `?filterByFormula=${encodeURIComponent(filter)}&maxRecords=5&fields%5B%5D=Name&fields%5B%5D=assigned_organizer`;
  const data = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
  // count total (separate request without maxRecords sample)
  let total = 0; let offset = null;
  do {
    let cq = `?filterByFormula=${encodeURIComponent(filter)}&pageSize=100&fields%5B%5D=Name`;
    if (offset) cq += `&offset=${offset}`;
    const cd = await at(env, `/${BASE}/${CONTACTS_TBL}${cq}`);
    total += cd.records.length;
    offset = cd.offset;
  } while (offset);
  return json({
    organizer_param: organizer,
    organizer_id_resolved: orgId,
    filter_formula: filter,
    total_match: total,
    sample: data.records.map(r => ({ id: r.id, name: r.fields.Name, assigned: r.fields.assigned_organizer || [] })),
  });
}

// =========================================================================
// /admin/log-debug?days=1 — returns recent contact_log entries with contact name + assigned organizer.
// Useful for debugging "why are these squares showing up". Admin-key gated.
// =========================================================================
async function adminLogDebug(request, env, urlObj) {
  const key = request.headers.get('X-Admin-Key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
  const days = parseInt(urlObj.searchParams.get('days') || '1');
  const filter = `IS_AFTER({date},DATEADD(TODAY(),-${days},'days'))`;
  let q = `?filterByFormula=${encodeURIComponent(filter)}&pageSize=100&fields%5B%5D=date&fields%5B%5D=method&fields%5B%5D=result&fields%5B%5D=event&fields%5B%5D=contact&fields%5B%5D=Summary&fields%5B%5D=notes`;
  const logs = [];
  let offset = null;
  do {
    let url = `/${BASE}/${CONTACT_LOG_TBL}${q}${offset ? `&offset=${offset}` : ''}`;
    const data = await at(env, url);
    logs.push(...data.records);
    offset = data.offset;
  } while (offset);

  // For each log, look up the contact's name + assigned_organizer
  const results = [];
  for (const log of logs) {
    const contactIds = log.fields.contact || [];
    const contactInfo = [];
    for (const cid of contactIds) {
      try {
        const c = await at(env, `/${BASE}/${CONTACTS_TBL}/${cid}`);
        contactInfo.push({
          id: cid,
          name: c.fields.Name || `${c.fields.first||''} ${c.fields.last||''}`.trim(),
          assigned: c.fields.assigned_organizer || [],
        });
      } catch (e) {
        contactInfo.push({ id: cid, error: e.message });
      }
    }
    results.push({
      log_id: log.id,
      date: log.fields.date,
      method: log.fields.method,
      result: log.fields.result,
      event: log.fields.event,
      summary: log.fields.Summary,
      notes: log.fields.notes,
      contacts: contactInfo,
    });
  }
  return json({ count: results.length, logs: results });
}

// =========================================================================
// /admin/recent-debug?organizer=stephanie — runs the EXACT same logic getRecentActivity does
// and returns the result + the raw log count + the filter steps. Admin-key gated.
// =========================================================================
async function adminRecentDebug(request, env, urlObj) {
  const key = request.headers.get('X-Admin-Key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
  const days = parseInt(urlObj.searchParams.get('days') || '14');
  const organizer = urlObj.searchParams.get('organizer');

  const filter = `IS_AFTER({date},DATEADD(TODAY(),-${days},'days'))`;
  const fields = ['contact','method','result','event','date'];
  let q = `?filterByFormula=${encodeURIComponent(filter)}&pageSize=100`;
  for (const f of fields) q += `&fields%5B%5D=${encodeURIComponent(f)}`;
  const records = [];
  let offset = null;
  do {
    const u = `/${BASE}/${CONTACT_LOG_TBL}${q}${offset ? `&offset=${offset}` : ''}`;
    const data = await at(env, u);
    records.push(...data.records);
    offset = data.offset;
  } while (offset);

  const allowedIds = organizer ? await organizerContactIds(env, organizer) : null;

  let totalRecords = records.length;
  let droppedConfirm = 0;
  let droppedNoContact = 0;
  let droppedOrgFilter = 0;
  let droppedNotOutreach = 0;
  let kept = 0;
  const byDate = {};
  const OUTREACH_METHODS = new Set(['Call','Text','Email']);
  for (const r of records) {
    const d = r.fields.date;
    if (!d) { droppedNoContact++; continue; }
    if (r.fields.event === CONFIRM_EVENT) { droppedConfirm++; continue; }
    if (!OUTREACH_METHODS.has(r.fields.method)) { droppedNotOutreach++; continue; }
    const cid = (r.fields.contact || [])[0];
    if (!cid) { droppedNoContact++; continue; }
    if (allowedIds && !allowedIds.has(cid)) { droppedOrgFilter++; continue; }
    if (!byDate[d]) byDate[d] = {};
    if (!byDate[d][cid]) byDate[d][cid] = { methods: new Set(), result: null, event: null };
    if (r.fields.method) byDate[d][cid].methods.add(r.fields.method);
    if (r.fields.result) byDate[d][cid].result = r.fields.result;
    if (r.fields.event) byDate[d][cid].event = r.fields.event;
    kept++;
  }
  // Summarize byDate
  const summary = {};
  for (const [d, contacts] of Object.entries(byDate)) {
    summary[d] = Object.keys(contacts).length;
  }
  return json({
    organizer,
    organizer_set_size: allowedIds ? allowedIds.size : null,
    confirm_event_constant: CONFIRM_EVENT,
    raw_log_count: totalRecords,
    dropped_confirm: droppedConfirm,
    dropped_not_outreach: droppedNotOutreach,
    dropped_no_contact: droppedNoContact,
    dropped_org_filter: droppedOrgFilter,
    kept: kept,
    grid_squares_per_date: summary,
  });
}

// =========================================================================
// /admin/bulk-reassign — admin-key gated. Reassign contacts matching a filter
// from one organizer to another.
// Body: { from: 'lanee', to: 'stephanie', source_contains: 'website signup', dry_run: bool }
// Matches contacts currently assigned to `from` whose source field contains the substring.
// =========================================================================
async function adminBulkReassign(request, env) {
  const key = request.headers.get('X-Admin-Key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
  const body = await request.json();
  const fromName = organizerName(body.from);
  const toId = organizerId(body.to);
  const sourceContains = body.source_contains || '';
  const dryRun = !!body.dry_run;
  if (!fromName) return json({ error: 'unknown from organizer' }, 400);
  if (!toId) return json({ error: 'unknown to organizer' }, 400);
  if (!sourceContains) return json({ error: 'source_contains required' }, 400);

  const filter = `AND(FIND('${fromName}',{assigned_organizer}&'')>0,FIND(LOWER('${sourceContains}'),LOWER({source}&''))>0)`;
  const matches = [];
  let offset = null;
  do {
    let q = `?filterByFormula=${encodeURIComponent(filter)}&pageSize=100&fields%5B%5D=Name&fields%5B%5D=source&fields%5B%5D=assigned_organizer`;
    if (offset) q += `&offset=${offset}`;
    const data = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
    for (const r of data.records) matches.push({ id: r.id, name: r.fields.Name, source: r.fields.source });
    offset = data.offset;
  } while (offset);

  if (dryRun) {
    return json({ dry_run: true, filter, match_count: matches.length, sample: matches.slice(0, 10), total: matches.length });
  }

  // Batch updates — Airtable allows 10 records per PATCH
  const updated = [];
  const errors = [];
  for (let i = 0; i < matches.length; i += 10) {
    const batch = matches.slice(i, i + 10);
    const records = batch.map(m => ({ id: m.id, fields: { assigned_organizer: [toId] } }));
    try {
      await at(env, `/${BASE}/${CONTACTS_TBL}`, {
        method: 'PATCH',
        body: JSON.stringify({ records, typecast: true })
      });
      for (const m of batch) updated.push(m.id);
    } catch (e) {
      errors.push({ batch_start: i, error: e.message });
    }
  }
  await invalidateReadCaches(env);
  return json({ dry_run: false, filter, match_count: matches.length, updated_count: updated.length, errors });
}

// =========================================================================
// /admin/reassign-website-signups — admin-key gated.
// Body: { from: 'lanee', to: 'stephanie', dry_run: bool }
// Find all contacts currently assigned to `from` that have a log entry with
// method='Event attendance' (signaling they signed up via the website form),
// then reassign them to `to`.
// =========================================================================
async function adminReassignWebsiteSignups(request, env) {
  const key = request.headers.get('X-Admin-Key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
  const body = await request.json();
  const fromName = organizerName(body.from);
  const toId = organizerId(body.to);
  const dryRun = !!body.dry_run;
  if (!fromName) return json({ error: 'unknown from organizer' }, 400);
  if (!toId) return json({ error: 'unknown to organizer' }, 400);

  // Step 1: get all logs with method='Event attendance' — these are website signups
  const logFilter = `{method}='Event attendance'`;
  const signupContactIds = new Set();
  let offset = null;
  do {
    let q = `?filterByFormula=${encodeURIComponent(logFilter)}&pageSize=100&fields%5B%5D=contact`;
    if (offset) q += `&offset=${offset}`;
    const data = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
    for (const r of data.records) {
      const cid = (r.fields.contact || [])[0];
      if (cid) signupContactIds.add(cid);
    }
    offset = data.offset;
  } while (offset);

  // Step 2: get all contacts currently assigned to `from`
  const orgFilter = `FIND('${fromName}',{assigned_organizer}&'')>0`;
  const fromContacts = [];
  offset = null;
  do {
    let q = `?filterByFormula=${encodeURIComponent(orgFilter)}&pageSize=100&fields%5B%5D=Name`;
    if (offset) q += `&offset=${offset}`;
    const data = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
    for (const r of data.records) fromContacts.push({ id: r.id, name: r.fields.Name });
    offset = data.offset;
  } while (offset);

  // Step 3: intersect — website signups assigned to `from`
  const matches = fromContacts.filter(c => signupContactIds.has(c.id));

  if (dryRun) {
    return json({
      dry_run: true,
      total_website_signups: signupContactIds.size,
      total_from_contacts: fromContacts.length,
      match_count: matches.length,
      sample: matches.slice(0, 10),
    });
  }

  // Step 4: batch reassign (10 per PATCH)
  const updated = [];
  const errors = [];
  for (let i = 0; i < matches.length; i += 10) {
    const batch = matches.slice(i, i + 10);
    const records = batch.map(m => ({ id: m.id, fields: { assigned_organizer: [toId] } }));
    try {
      await at(env, `/${BASE}/${CONTACTS_TBL}`, {
        method: 'PATCH',
        body: JSON.stringify({ records, typecast: true })
      });
      for (const m of batch) updated.push({ id: m.id, name: m.name });
    } catch (e) {
      errors.push({ batch_start: i, error: e.message });
    }
  }
  await invalidateReadCaches(env);
  return json({ dry_run: false, match_count: matches.length, updated_count: updated.length, sample: updated.slice(0, 10), errors });
}

// =========================================================================
// /attendance-log — mark a contact as Attended or No-show for the 5/26 event.
// Body: { contact_id, attended: true|false }
// Creates a contact_log entry with method='Event attendance',
// event='Orientation 5/26', result='Attended' or 'No-show'.
// Deletes any prior attendance log for this contact today (idempotent).
// =========================================================================
async function attendanceLog(request, env) {
  const body = await request.json();
  const { contact_id, attended, event = '5_26' } = body;
  const meta = eventMeta(event);
  if (!contact_id) return json({ error: 'contact_id required' }, 400);
  // attended: true → Attended, false → No-show, null → clear (delete only)
  if (attended !== true && attended !== false && attended !== null) {
    return json({ error: 'attended must be true, false, or null' }, 400);
  }
  const date = todayCT();

  // Delete any prior attendance log for this contact for this event
  const dupFilter = `AND({event}='${meta.attendEvent}',{method}='Event attendance',OR({result}='Attended',{result}='No-show'))`;
  const dupes = [];
  let offset = null;
  do {
    let q = `?filterByFormula=${encodeURIComponent(dupFilter)}&pageSize=100&fields%5B%5D=contact`;
    if (offset) q += `&offset=${offset}`;
    const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
    dupes.push(...d.records);
    offset = d.offset;
  } while (offset);
  const dupIds = dupes.filter(r => (r.fields.contact || []).includes(contact_id)).map(r => r.id);
  for (let i = 0; i < dupIds.length; i += 10) {
    const batch = dupIds.slice(i, i + 10);
    const u = new URL(`https://api.airtable.com/v0/${BASE}/${CONTACT_LOG_TBL}`);
    for (const id of batch) u.searchParams.append('records[]', id);
    await fetch(u, { method: 'DELETE', headers: { 'Authorization': `Bearer ${env.AIRTABLE_TOKEN}` } });
  }

  // If clearing, just stop after the delete + clear the contact's denormalized status
  if (attended === null) {
    try {
      await at(env, `/${BASE}/${CONTACTS_TBL}/${contact_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: { [meta.attendField]: null }, typecast: true }),
      });
    } catch (e) {}
    await invalidateReadCaches(env);
    return json({ ok: true, contact_id, result: null });
  }

  const result = attended ? 'Attended' : 'No-show';
  await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, {
    method: 'POST',
    body: JSON.stringify({
      records: [{ fields: {
        Summary: `${date} — ${result} (${meta.attendTag})`,
        date,
        method: 'Event attendance',
        result,
        event: meta.attendEvent,
        contact: [contact_id],
      }}],
      typecast: true,
    }),
  });
  // Patch the denormalized status field too
  try {
    await at(env, `/${BASE}/${CONTACTS_TBL}/${contact_id}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: { [meta.attendField]: result }, typecast: true }),
    });
  } catch (e) {}
  await invalidateReadCaches(env);
  return json({ ok: true, contact_id, result });
}

// =========================================================================
// /walkin — add a walk-in attendee. Dedupes against existing contacts (email/phone).
// Body: { first, last, email, phone, school, district, county, city, role, organizer }
// If existing contact found → just creates attendance log + marks Signed up.
// If new → creates contact (assigned to specified organizer) + attendance log.
// =========================================================================
async function walkinSignup(request, env) {
  const body = await request.json();
  const { first, last, email, phone, school, district, county, city, role, organizer } = body;
  if (!first || !last) return json({ error: 'first and last name required' }, 400);
  const orgId = organizerId(organizer) || STEPHANIE_ID;
  const date = todayCT();
  // Which event this walk-in attended (defaults to 5/26 for back-compat)
  const wMeta = eventMeta(String(body.event || '5_26'));

  const clean = (s) => String(s || '').replace(/^[^\w\s]+/, '').trim();
  const cFirst = clean(first);
  const cLast = clean(last);

  // Dedupe: email first, then phone
  let existingId = null;
  let existingName = null;
  if (email) {
    const e = String(email).toLowerCase().trim();
    const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`LOWER({email})='${e}'`)}&maxRecords=1`);
    if (r.records.length > 0) { existingId = r.records[0].id; existingName = r.records[0].fields.Name; }
  }
  if (!existingId && phone) {
    const digits = String(phone).replace(/\D/g, '').slice(-10);
    if (digits.length === 10) {
      const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`REGEX_REPLACE({phone},'\\\\D','')='${digits}'`)}&maxRecords=1`);
      if (r.records.length > 0) { existingId = r.records[0].id; existingName = r.records[0].fields.Name; }
    }
  }

  let contactId;
  let created = false;
  if (existingId) {
    contactId = existingId;
    // Mark them as signed up too (they might not have been in the DB yet as a signup)
    await at(env, `/${BASE}/${CONTACTS_TBL}/${contactId}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: {
        last_attempt_date: date,
        last_attempt_result: 'Signed up',
      }, typecast: true }),
    });
  } else {
    const fields = {
      first: cFirst,
      last: cLast,
      leader_ladder: 'Prospect',
      assigned_organizer: [orgId],
      source: `walk-in ${wMeta.label.split(' ')[0]}`,
      last_attempt_date: date,
      last_attempt_result: 'Signed up',
    };
    if (email) fields.email = String(email).toLowerCase().trim();
    if (phone) fields.phone = String(phone).trim();
    if (school) fields.school = String(school).trim();
    if (district) fields.district = String(district).trim();
    if (county) fields.county = String(county).trim();
    if (city) fields.city = String(city).trim();
    if (role) fields.role = Array.isArray(role) ? role : [role];
    const c = await at(env, `/${BASE}/${CONTACTS_TBL}`, {
      method: 'POST',
      body: JSON.stringify({ records: [{ fields }], typecast: true }),
    });
    contactId = c.records[0].id;
    created = true;
  }

  // Always create the attendance log marked Attended (walk-ins by definition attended)
  await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, {
    method: 'POST',
    body: JSON.stringify({
      records: [{ fields: {
        Summary: `${date} — Walk-in (${wMeta.attendTag})`,
        date,
        method: 'Event attendance',
        result: 'Attended',
        event: wMeta.attendEvent,
        contact: [contactId],
        notes: created ? 'New walk-in contact' : `Walk-in (matched existing: ${existingName || contactId})`,
      }}],
      typecast: true,
    }),
  });
  // Patch the denormalized status field
  try {
    await at(env, `/${BASE}/${CONTACTS_TBL}/${contactId}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: { [wMeta.attendField]: 'Walk-in' }, typecast: true }),
    });
  } catch (e) {}

  await invalidateReadCaches(env);
  return json({ ok: true, contact_id: contactId, created, matched_existing: !created, existing_name: existingName });
}
