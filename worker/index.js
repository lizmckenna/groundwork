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
const EVENTS_TBL = 'tblHJG5AJagnOr33U';
const METHOD_MAP = { called: 'Call', texted: 'Text', emailed: 'Email' };
const METHOD_REVERSE = { Call: 'called', Text: 'texted', Email: 'emailed' };
const CONFIRM_EVENT = 'Confirm 5/26';
const LANEE_ID = 'rec0OmDN68hlffkTn';
const STEPHANIE_ID = 'recnnEdYIPcclnPLY';
const LANEE_COUNTIES = ['jackson', 'cass', 'johnson', 'platte', 'clay', 'lafayette', 'buchanan', 'ray'];
// KC-metro cities — fallback when no county is supplied
const LANEE_KC_CITIES = ['kansas city','independence','liberty','gladstone','raytown','grandview',"lee's summit",'lees summit','blue springs','belton','overland park','shawnee','olathe','lenexa','leawood','mission','merriam'];
// ZIP → county lookup for MO + KS (generated from pgeocode/GeoNames data — 1905 entries).
// Used both to derive organizer routing AND to populate the contact's county field
// when the form only collects zip.
const MO_KS_ZIP_COUNTY = {"66732":"Allen County, KS","66742":"Allen County, KS","66748":"Allen County, KS","66749":"Allen County, KS","66751":"Allen County, KS","66755":"Allen County, KS","66772":"Allen County, KS","66015":"Anderson County, KS","66032":"Anderson County, KS","66033":"Anderson County, KS","66039":"Anderson County, KS","66091":"Anderson County, KS","66093":"Anderson County, KS","66002":"Atchison County, KS","66016":"Atchison County, KS","66023":"Atchison County, KS","66041":"Atchison County, KS","66058":"Atchison County, KS","67057":"Barber County, KS","67061":"Barber County, KS","67065":"Barber County, KS","67070":"Barber County, KS","67071":"Barber County, KS","67104":"Barber County, KS","67138":"Barber County, KS","67143":"Barber County, KS","67511":"Barton County, KS","67525":"Barton County, KS","67526":"Barton County, KS","67530":"Barton County, KS","67544":"Barton County, KS","67564":"Barton County, KS","67567":"Barton County, KS","66701":"Bourbon County, KS","66716":"Bourbon County, KS","66738":"Bourbon County, KS","66741":"Bourbon County, KS","66754":"Bourbon County, KS","66769":"Bourbon County, KS","66779":"Bourbon County, KS","66424":"Brown County, KS","66425":"Brown County, KS","66434":"Brown County, KS","66439":"Brown County, KS","66515":"Brown County, KS","66527":"Brown County, KS","66532":"Brown County, KS","66842":"Butler County, KS","67002":"Butler County, KS","67010":"Butler County, KS","67012":"Butler County, KS","67017":"Butler County, KS","67039":"Butler County, KS","67041":"Butler County, KS","67042":"Butler County, KS","67072":"Butler County, KS","67074":"Butler County, KS","67123":"Butler County, KS","67132":"Butler County, KS","67133":"Butler County, KS","67144":"Butler County, KS","67154":"Butler County, KS","66843":"Chase County, KS","66845":"Chase County, KS","66850":"Chase County, KS","66862":"Chase County, KS","66869":"Chase County, KS","67024":"Chautauqua County, KS","67334":"Chautauqua County, KS","67355":"Chautauqua County, KS","67360":"Chautauqua County, KS","67361":"Chautauqua County, KS","66713":"Cherokee County, KS","66725":"Cherokee County, KS","66728":"Cherokee County, KS","66739":"Cherokee County, KS","66770":"Cherokee County, KS","66773":"Cherokee County, KS","66778":"Cherokee County, KS","66781":"Cherokee County, KS","66782":"Cherokee County, KS","67731":"Cheyenne County, KS","67756":"Cheyenne County, KS","67831":"Clark County, KS","67840":"Clark County, KS","67865":"Clark County, KS","67432":"Clay County, KS","67447":"Clay County, KS","67458":"Clay County, KS","67468":"Clay County, KS","67487":"Clay County, KS","66901":"Cloud County, KS","66938":"Cloud County, KS","66948":"Cloud County, KS","67417":"Cloud County, KS","67445":"Cloud County, KS","67466":"Cloud County, KS","66839":"Coffey County, KS","66852":"Coffey County, KS","66856":"Coffey County, KS","66857":"Coffey County, KS","66871":"Coffey County, KS","67029":"Comanche County, KS","67127":"Comanche County, KS","67155":"Comanche County, KS","67005":"Cowley County, KS","67008":"Cowley County, KS","67019":"Cowley County, KS","67023":"Cowley County, KS","67038":"Cowley County, KS","67102":"Cowley County, KS","67131":"Cowley County, KS","67146":"Cowley County, KS","67156":"Cowley County, KS","66711":"Crawford County, KS","66712":"Crawford County, KS","66724":"Crawford County, KS","66734":"Crawford County, KS","66735":"Crawford County, KS","66743":"Crawford County, KS","66746":"Crawford County, KS","66753":"Crawford County, KS","66756":"Crawford County, KS","66760":"Crawford County, KS","66762":"Crawford County, KS","66763":"Crawford County, KS","66780":"Crawford County, KS","67635":"Decatur County, KS","67643":"Decatur County, KS","67653":"Decatur County, KS","67749":"Decatur County, KS","67410":"Dickinson County, KS","67431":"Dickinson County, KS","67441":"Dickinson County, KS","67449":"Dickinson County, KS","67451":"Dickinson County, KS","67480":"Dickinson County, KS","67482":"Dickinson County, KS","67492":"Dickinson County, KS","66008":"Doniphan County, KS","66017":"Doniphan County, KS","66024":"Doniphan County, KS","66035":"Doniphan County, KS","66087":"Doniphan County, KS","66090":"Doniphan County, KS","66094":"Doniphan County, KS","66006":"Douglas County, KS","66025":"Douglas County, KS","66044":"Douglas County, KS","66045":"Douglas County, KS","66046":"Douglas County, KS","66047":"Douglas County, KS","66049":"Douglas County, KS","66050":"Douglas County, KS","67519":"Edwards County, KS","67547":"Edwards County, KS","67552":"Edwards County, KS","67563":"Edwards County, KS","67345":"Elk County, KS","67346":"Elk County, KS","67349":"Elk County, KS","67352":"Elk County, KS","67353":"Elk County, KS","67601":"Ellis County, KS","67627":"Ellis County, KS","67637":"Ellis County, KS","67660":"Ellis County, KS","67667":"Ellis County, KS","67671":"Ellis County, KS","67674":"Ellis County, KS","67439":"Ellsworth County, KS","67450":"Ellsworth County, KS","67454":"Ellsworth County, KS","67459":"Ellsworth County, KS","67490":"Ellsworth County, KS","67846":"Finney County, KS","67851":"Finney County, KS","67868":"Finney County, KS","67801":"Ford County, KS","67834":"Ford County, KS","67842":"Ford County, KS","67843":"Ford County, KS","67876":"Ford County, KS","67882":"Ford County, KS","66042":"Franklin County, KS","66067":"Franklin County, KS","66076":"Franklin County, KS","66078":"Franklin County, KS","66079":"Franklin County, KS","66080":"Franklin County, KS","66092":"Franklin County, KS","66095":"Franklin County, KS","66441":"Geary County, KS","66442":"Geary County, KS","66514":"Geary County, KS","67736":"Gove County, KS","67737":"Gove County, KS","67738":"Gove County, KS","67751":"Gove County, KS","67752":"Gove County, KS","67625":"Graham County, KS","67642":"Graham County, KS","67650":"Graham County, KS","67659":"Graham County, KS","67880":"Grant County, KS","67835":"Gray County, KS","67837":"Gray County, KS","67841":"Gray County, KS","67853":"Gray County, KS","67867":"Gray County, KS","67879":"Greeley County, KS","66853":"Greenwood County, KS","66855":"Greenwood County, KS","66860":"Greenwood County, KS","66863":"Greenwood County, KS","66870":"Greenwood County, KS","67045":"Greenwood County, KS","67047":"Greenwood County, KS","67122":"Greenwood County, KS","67137":"Greenwood County, KS","67836":"Hamilton County, KS","67857":"Hamilton County, KS","67878":"Hamilton County, KS","67003":"Harper County, KS","67009":"Harper County, KS","67018":"Harper County, KS","67036":"Harper County, KS","67049":"Harper County, KS","67058":"Harper County, KS","67150":"Harper County, KS","67020":"Harvey County, KS","67056":"Harvey County, KS","67062":"Harvey County, KS","67114":"Harvey County, KS","67117":"Harvey County, KS","67135":"Harvey County, KS","67151":"Harvey County, KS","67870":"Haskell County, KS","67877":"Haskell County, KS","67849":"Hodgeman County, KS","67854":"Hodgeman County, KS","66416":"Jackson County, KS","66418":"Jackson County, KS","66419":"Jackson County, KS","66436":"Jackson County, KS","66440":"Jackson County, KS","66509":"Jackson County, KS","66516":"Jackson County, KS","66540":"Jackson County, KS","66552":"Jackson County, KS","66054":"Jefferson County, KS","66060":"Jefferson County, KS","66066":"Jefferson County, KS","66070":"Jefferson County, KS","66073":"Jefferson County, KS","66088":"Jefferson County, KS","66097":"Jefferson County, KS","66429":"Jefferson County, KS","66512":"Jefferson County, KS","66936":"Jewell County, KS","66941":"Jewell County, KS","66942":"Jewell County, KS","66949":"Jewell County, KS","66956":"Jewell County, KS","66963":"Jewell County, KS","66970":"Jewell County, KS","66018":"Johnson County, KS","66021":"Johnson County, KS","66030":"Johnson County, KS","66031":"Johnson County, KS","66051":"Johnson County, KS","66061":"Johnson County, KS","66062":"Johnson County, KS","66063":"Johnson County, KS","66083":"Johnson County, KS","66085":"Johnson County, KS","66201":"Johnson County, KS","66202":"Johnson County, KS","66203":"Johnson County, KS","66204":"Johnson County, KS","66205":"Johnson County, KS","66206":"Johnson County, KS","66207":"Johnson County, KS","66208":"Johnson County, KS","66209":"Johnson County, KS","66210":"Johnson County, KS","66211":"Johnson County, KS","66212":"Johnson County, KS","66213":"Johnson County, KS","66214":"Johnson County, KS","66215":"Johnson County, KS","66216":"Johnson County, KS","66217":"Johnson County, KS","66218":"Johnson County, KS","66219":"Johnson County, KS","66220":"Johnson County, KS","66221":"Johnson County, KS","66222":"Johnson County, KS","66223":"Johnson County, KS","66224":"Johnson County, KS","66225":"Johnson County, KS","66226":"Johnson County, KS","66227":"Johnson County, KS","66250":"Johnson County, KS","66251":"Johnson County, KS","66276":"Johnson County, KS","66282":"Johnson County, KS","66283":"Johnson County, KS","66285":"Johnson County, KS","66286":"Johnson County, KS","67838":"Kearny County, KS","67860":"Kearny County, KS","67035":"Kingman County, KS","67068":"Kingman County, KS","67111":"Kingman County, KS","67112":"Kingman County, KS","67118":"Kingman County, KS","67142":"Kingman County, KS","67159":"Kingman County, KS","67054":"Kiowa County, KS","67059":"Kiowa County, KS","67109":"Kiowa County, KS","67330":"Labette County, KS","67332":"Labette County, KS","67336":"Labette County, KS","67341":"Labette County, KS","67342":"Labette County, KS","67354":"Labette County, KS","67356":"Labette County, KS","67357":"Labette County, KS","67839":"Lane County, KS","67850":"Lane County, KS","66007":"Leavenworth County, KS","66020":"Leavenworth County, KS","66027":"Leavenworth County, KS","66043":"Leavenworth County, KS","66048":"Leavenworth County, KS","66052":"Leavenworth County, KS","66086":"Leavenworth County, KS","67418":"Lincoln County, KS","67423":"Lincoln County, KS","67455":"Lincoln County, KS","67481":"Lincoln County, KS","66010":"Linn County, KS","66014":"Linn County, KS","66040":"Linn County, KS","66056":"Linn County, KS","66072":"Linn County, KS","66075":"Linn County, KS","66767":"Linn County, KS","67747":"Logan County, KS","67748":"Logan County, KS","67764":"Logan County, KS","66801":"Lyon County, KS","66830":"Lyon County, KS","66833":"Lyon County, KS","66835":"Lyon County, KS","66854":"Lyon County, KS","66864":"Lyon County, KS","66865":"Lyon County, KS","66868":"Lyon County, KS","67107":"McPherson County, KS","67428":"McPherson County, KS","67443":"McPherson County, KS","67456":"McPherson County, KS","67460":"McPherson County, KS","67464":"McPherson County, KS","67476":"McPherson County, KS","67491":"McPherson County, KS","67546":"McPherson County, KS","66840":"Marion County, KS","66851":"Marion County, KS","66858":"Marion County, KS","66859":"Marion County, KS","66861":"Marion County, KS","66866":"Marion County, KS","67053":"Marion County, KS","67063":"Marion County, KS","67073":"Marion County, KS","67438":"Marion County, KS","67475":"Marion County, KS","67483":"Marion County, KS","66403":"Marshall County, KS","66406":"Marshall County, KS","66411":"Marshall County, KS","66412":"Marshall County, KS","66427":"Marshall County, KS","66438":"Marshall County, KS","66508":"Marshall County, KS","66518":"Marshall County, KS","66541":"Marshall County, KS","66544":"Marshall County, KS","66548":"Marshall County, KS","67844":"Meade County, KS","67864":"Meade County, KS","67869":"Meade County, KS","66013":"Miami County, KS","66026":"Miami County, KS","66036":"Miami County, KS","66053":"Miami County, KS","66064":"Miami County, KS","66071":"Miami County, KS","67420":"Mitchell County, KS","67430":"Mitchell County, KS","67446":"Mitchell County, KS","67452":"Mitchell County, KS","67478":"Mitchell County, KS","67485":"Mitchell County, KS","67301":"Montgomery County, KS","67333":"Montgomery County, KS","67335":"Montgomery County, KS","67337":"Montgomery County, KS","67340":"Montgomery County, KS","67344":"Montgomery County, KS","67347":"Montgomery County, KS","67351":"Montgomery County, KS","67363":"Montgomery County, KS","67364":"Montgomery County, KS","66838":"Morris County, KS","66846":"Morris County, KS","66849":"Morris County, KS","66872":"Morris County, KS","66873":"Morris County, KS","67950":"Morton County, KS","67953":"Morton County, KS","67954":"Morton County, KS","66404":"Nemaha County, KS","66408":"Nemaha County, KS","66415":"Nemaha County, KS","66417":"Nemaha County, KS","66428":"Nemaha County, KS","66522":"Nemaha County, KS","66534":"Nemaha County, KS","66538":"Nemaha County, KS","66550":"Nemaha County, KS","66720":"Neosho County, KS","66733":"Neosho County, KS","66740":"Neosho County, KS","66771":"Neosho County, KS","66775":"Neosho County, KS","66776":"Neosho County, KS","67515":"Ness County, KS","67516":"Ness County, KS","67518":"Ness County, KS","67521":"Ness County, KS","67560":"Ness County, KS","67572":"Ness County, KS","67584":"Ness County, KS","67622":"Norton County, KS","67629":"Norton County, KS","67645":"Norton County, KS","67654":"Norton County, KS","66413":"Osage County, KS","66414":"Osage County, KS","66451":"Osage County, KS","66510":"Osage County, KS","66523":"Osage County, KS","66524":"Osage County, KS","66528":"Osage County, KS","66537":"Osage County, KS","66543":"Osage County, KS","67437":"Osborne County, KS","67473":"Osborne County, KS","67474":"Osborne County, KS","67623":"Osborne County, KS","67651":"Osborne County, KS","67422":"Ottawa County, KS","67436":"Ottawa County, KS","67467":"Ottawa County, KS","67484":"Ottawa County, KS","67523":"Pawnee County, KS","67529":"Pawnee County, KS","67550":"Pawnee County, KS","67574":"Pawnee County, KS","67621":"Phillips County, KS","67639":"Phillips County, KS","67644":"Phillips County, KS","67646":"Phillips County, KS","67647":"Phillips County, KS","67661":"Phillips County, KS","67664":"Phillips County, KS","66407":"Pottawatomie County, KS","66422":"Pottawatomie County, KS","66426":"Pottawatomie County, KS","66432":"Pottawatomie County, KS","66520":"Pottawatomie County, KS","66521":"Pottawatomie County, KS","66535":"Pottawatomie County, KS","66536":"Pottawatomie County, KS","66547":"Pottawatomie County, KS","66549":"Pottawatomie County, KS","67021":"Pratt County, KS","67028":"Pratt County, KS","67066":"Pratt County, KS","67124":"Pratt County, KS","67134":"Pratt County, KS","67730":"Rawlins County, KS","67739":"Rawlins County, KS","67744":"Rawlins County, KS","67745":"Rawlins County, KS","67501":"Reno County, KS","67502":"Reno County, KS","67504":"Reno County, KS","67505":"Reno County, KS","67510":"Reno County, KS","67514":"Reno County, KS","67522":"Reno County, KS","67543":"Reno County, KS","67561":"Reno County, KS","67566":"Reno County, KS","67568":"Reno County, KS","67570":"Reno County, KS","67581":"Reno County, KS","67583":"Reno County, KS","67585":"Reno County, KS","66930":"Republic County, KS","66935":"Republic County, KS","66939":"Republic County, KS","66940":"Republic County, KS","66959":"Republic County, KS","66960":"Republic County, KS","66961":"Republic County, KS","66964":"Republic County, KS","66966":"Republic County, KS","67427":"Rice County, KS","67444":"Rice County, KS","67457":"Rice County, KS","67512":"Rice County, KS","67524":"Rice County, KS","67554":"Rice County, KS","67573":"Rice County, KS","67579":"Rice County, KS","66449":"Riley County, KS","66502":"Riley County, KS","66503":"Riley County, KS","66505":"Riley County, KS","66506":"Riley County, KS","66517":"Riley County, KS","66531":"Riley County, KS","66554":"Riley County, KS","67632":"Rooks County, KS","67657":"Rooks County, KS","67663":"Rooks County, KS","67669":"Rooks County, KS","67675":"Rooks County, KS","67513":"Rush County, KS","67520":"Rush County, KS","67548":"Rush County, KS","67553":"Rush County, KS","67556":"Rush County, KS","67559":"Rush County, KS","67565":"Rush County, KS","67575":"Rush County, KS","67626":"Russell County, KS","67634":"Russell County, KS","67640":"Russell County, KS","67648":"Russell County, KS","67649":"Russell County, KS","67658":"Russell County, KS","67665":"Russell County, KS","67673":"Russell County, KS","67401":"Saline County, KS","67402":"Saline County, KS","67416":"Saline County, KS","67425":"Saline County, KS","67442":"Saline County, KS","67448":"Saline County, KS","67470":"Saline County, KS","67871":"Scott County, KS","67001":"Sedgwick County, KS","67016":"Sedgwick County, KS","67025":"Sedgwick County, KS","67026":"Sedgwick County, KS","67030":"Sedgwick County, KS","67037":"Sedgwick County, KS","67050":"Sedgwick County, KS","67052":"Sedgwick County, KS","67055":"Sedgwick County, KS","67060":"Sedgwick County, KS","67067":"Sedgwick County, KS","67101":"Sedgwick County, KS","67108":"Sedgwick County, KS","67120":"Sedgwick County, KS","67147":"Sedgwick County, KS","67149":"Sedgwick County, KS","67201":"Sedgwick County, KS","67202":"Sedgwick County, KS","67203":"Sedgwick County, KS","67204":"Sedgwick County, KS","67205":"Sedgwick County, KS","67206":"Sedgwick County, KS","67207":"Sedgwick County, KS","67208":"Sedgwick County, KS","67209":"Sedgwick County, KS","67210":"Sedgwick County, KS","67211":"Sedgwick County, KS","67212":"Sedgwick County, KS","67213":"Sedgwick County, KS","67214":"Sedgwick County, KS","67215":"Sedgwick County, KS","67216":"Sedgwick County, KS","67217":"Sedgwick County, KS","67218":"Sedgwick County, KS","67219":"Sedgwick County, KS","67220":"Sedgwick County, KS","67221":"Sedgwick County, KS","67223":"Sedgwick County, KS","67226":"Sedgwick County, KS","67227":"Sedgwick County, KS","67228":"Sedgwick County, KS","67230":"Sedgwick County, KS","67232":"Sedgwick County, KS","67235":"Sedgwick County, KS","67260":"Sedgwick County, KS","67275":"Sedgwick County, KS","67276":"Sedgwick County, KS","67277":"Sedgwick County, KS","67278":"Sedgwick County, KS","67859":"Seward County, KS","67901":"Seward County, KS","67905":"Seward County, KS","66402":"Shawnee County, KS","66409":"Shawnee County, KS","66420":"Shawnee County, KS","66533":"Shawnee County, KS","66539":"Shawnee County, KS","66542":"Shawnee County, KS","66546":"Shawnee County, KS","66601":"Shawnee County, KS","66603":"Shawnee County, KS","66604":"Shawnee County, KS","66605":"Shawnee County, KS","66606":"Shawnee County, KS","66607":"Shawnee County, KS","66608":"Shawnee County, KS","66609":"Shawnee County, KS","66610":"Shawnee County, KS","66611":"Shawnee County, KS","66612":"Shawnee County, KS","66614":"Shawnee County, KS","66615":"Shawnee County, KS","66616":"Shawnee County, KS","66617":"Shawnee County, KS","66618":"Shawnee County, KS","66619":"Shawnee County, KS","66620":"Shawnee County, KS","66621":"Shawnee County, KS","66622":"Shawnee County, KS","66624":"Shawnee County, KS","66625":"Shawnee County, KS","66626":"Shawnee County, KS","66629":"Shawnee County, KS","66630":"Shawnee County, KS","66636":"Shawnee County, KS","66647":"Shawnee County, KS","66667":"Shawnee County, KS","66675":"Shawnee County, KS","66683":"Shawnee County, KS","66699":"Shawnee County, KS","67740":"Sheridan County, KS","67757":"Sheridan County, KS","67733":"Sherman County, KS","67735":"Sherman County, KS","67741":"Sherman County, KS","66932":"Smith County, KS","66951":"Smith County, KS","66952":"Smith County, KS","66967":"Smith County, KS","67628":"Smith County, KS","67638":"Smith County, KS","67545":"Stafford County, KS","67557":"Stafford County, KS","67576":"Stafford County, KS","67578":"Stafford County, KS","67855":"Stanton County, KS","67862":"Stanton County, KS","67951":"Stevens County, KS","67952":"Stevens County, KS","67004":"Sumner County, KS","67013":"Sumner County, KS","67022":"Sumner County, KS","67031":"Sumner County, KS","67051":"Sumner County, KS","67103":"Sumner County, KS","67105":"Sumner County, KS","67106":"Sumner County, KS","67110":"Sumner County, KS","67119":"Sumner County, KS","67140":"Sumner County, KS","67152":"Sumner County, KS","67701":"Thomas County, KS","67732":"Thomas County, KS","67734":"Thomas County, KS","67743":"Thomas County, KS","67753":"Thomas County, KS","67631":"Trego County, KS","67656":"Trego County, KS","67672":"Trego County, KS","66401":"Wabaunsee County, KS","66423":"Wabaunsee County, KS","66431":"Wabaunsee County, KS","66501":"Wabaunsee County, KS","66507":"Wabaunsee County, KS","66526":"Wabaunsee County, KS","66834":"Wabaunsee County, KS","67758":"Wallace County, KS","67761":"Wallace County, KS","67762":"Wallace County, KS","66933":"Washington County, KS","66937":"Washington County, KS","66943":"Washington County, KS","66944":"Washington County, KS","66945":"Washington County, KS","66946":"Washington County, KS","66953":"Washington County, KS","66955":"Washington County, KS","66958":"Washington County, KS","66962":"Washington County, KS","66968":"Washington County, KS","67861":"Wichita County, KS","67863":"Wichita County, KS","66710":"Wilson County, KS","66714":"Wilson County, KS","66717":"Wilson County, KS","66736":"Wilson County, KS","66757":"Wilson County, KS","66759":"Wilson County, KS","66758":"Woodson County, KS","66761":"Woodson County, KS","66777":"Woodson County, KS","66783":"Woodson County, KS","66012":"Wyandotte County, KS","66101":"Wyandotte County, KS","66102":"Wyandotte County, KS","66103":"Wyandotte County, KS","66104":"Wyandotte County, KS","66105":"Wyandotte County, KS","66106":"Wyandotte County, KS","66109":"Wyandotte County, KS","66110":"Wyandotte County, KS","66111":"Wyandotte County, KS","66112":"Wyandotte County, KS","66113":"Wyandotte County, KS","66115":"Wyandotte County, KS","66117":"Wyandotte County, KS","66118":"Wyandotte County, KS","66119":"Wyandotte County, KS","66160":"Wyandotte County, KS","63501":"Adair County, MO","63533":"Adair County, MO","63540":"Adair County, MO","63546":"Adair County, MO","63559":"Adair County, MO","64421":"Andrew County, MO","64427":"Andrew County, MO","64436":"Andrew County, MO","64449":"Andrew County, MO","64459":"Andrew County, MO","64480":"Andrew County, MO","64483":"Andrew County, MO","64485":"Andrew County, MO","64506":"Andrew County, MO","64446":"Atchison County, MO","64482":"Atchison County, MO","64491":"Atchison County, MO","64496":"Atchison County, MO","64498":"Atchison County, MO","63345":"Audrain County, MO","63352":"Audrain County, MO","63382":"Audrain County, MO","65232":"Audrain County, MO","65264":"Audrain County, MO","65265":"Audrain County, MO","65280":"Audrain County, MO","65285":"Audrain County, MO","64874":"Barry County, MO","65623":"Barry County, MO","65625":"Barry County, MO","65641":"Barry County, MO","65647":"Barry County, MO","65658":"Barry County, MO","65708":"Barry County, MO","65734":"Barry County, MO","65745":"Barry County, MO","65747":"Barry County, MO","65772":"Barry County, MO","64748":"Barton County, MO","64759":"Barton County, MO","64762":"Barton County, MO","64766":"Barton County, MO","64769":"Barton County, MO","64720":"Bates County, MO","64722":"Bates County, MO","64723":"Bates County, MO","64730":"Bates County, MO","64742":"Bates County, MO","64745":"Bates County, MO","64752":"Bates County, MO","64779":"Bates County, MO","64780":"Bates County, MO","65325":"Benton County, MO","65326":"Benton County, MO","65335":"Benton County, MO","65338":"Benton County, MO","65355":"Benton County, MO","63662":"Bollinger County, MO","63750":"Bollinger County, MO","63751":"Bollinger County, MO","63760":"Bollinger County, MO","63764":"Bollinger County, MO","63781":"Bollinger County, MO","63782":"Bollinger County, MO","63787":"Bollinger County, MO","65010":"Boone County, MO","65039":"Boone County, MO","65201":"Boone County, MO","65202":"Boone County, MO","65203":"Boone County, MO","65205":"Boone County, MO","65211":"Boone County, MO","65212":"Boone County, MO","65215":"Boone County, MO","65216":"Boone County, MO","65217":"Boone County, MO","65218":"Boone County, MO","65240":"Boone County, MO","65255":"Boone County, MO","65256":"Boone County, MO","65279":"Boone County, MO","65284":"Boone County, MO","65299":"Boone County, MO","64401":"Buchanan County, MO","64440":"Buchanan County, MO","64443":"Buchanan County, MO","64448":"Buchanan County, MO","64484":"Buchanan County, MO","64501":"Buchanan County, MO","64502":"Buchanan County, MO","64503":"Buchanan County, MO","64504":"Buchanan County, MO","64505":"Buchanan County, MO","64507":"Buchanan County, MO","64508":"Buchanan County, MO","63901":"Butler County, MO","63902":"Butler County, MO","63932":"Butler County, MO","63938":"Butler County, MO","63940":"Butler County, MO","63945":"Butler County, MO","63954":"Butler County, MO","63961":"Butler County, MO","63962":"Butler County, MO","64624":"Caldwell County, MO","64625":"Caldwell County, MO","64637":"Caldwell County, MO","64644":"Caldwell County, MO","64649":"Caldwell County, MO","64650":"Caldwell County, MO","64671":"Caldwell County, MO","63388":"Callaway County, MO","65043":"Callaway County, MO","65059":"Callaway County, MO","65063":"Callaway County, MO","65067":"Callaway County, MO","65077":"Callaway County, MO","65080":"Callaway County, MO","65231":"Callaway County, MO","65251":"Callaway County, MO","65262":"Callaway County, MO","65020":"Camden County, MO","65049":"Camden County, MO","65052":"Camden County, MO","65065":"Camden County, MO","65079":"Camden County, MO","65324":"Camden County, MO","65567":"Camden County, MO","65591":"Camden County, MO","65786":"Camden County, MO","65787":"Camden County, MO","63701":"Cape Girardeau County, MO","63702":"Cape Girardeau County, MO","63703":"Cape Girardeau County, MO","63739":"Cape Girardeau County, MO","63743":"Cape Girardeau County, MO","63744":"Cape Girardeau County, MO","63745":"Cape Girardeau County, MO","63747":"Cape Girardeau County, MO","63752":"Cape Girardeau County, MO","63755":"Cape Girardeau County, MO","63766":"Cape Girardeau County, MO","63769":"Cape Girardeau County, MO","63770":"Cape Girardeau County, MO","63779":"Cape Girardeau County, MO","63785":"Cape Girardeau County, MO","64622":"Carroll County, MO","64623":"Carroll County, MO","64633":"Carroll County, MO","64639":"Carroll County, MO","64643":"Carroll County, MO","64668":"Carroll County, MO","64680":"Carroll County, MO","64682":"Carroll County, MO","63937":"Carter County, MO","63941":"Carter County, MO","63943":"Carter County, MO","63965":"Carter County, MO","64012":"Cass County, MO","64078":"Cass County, MO","64080":"Cass County, MO","64083":"Cass County, MO","64090":"Cass County, MO","64701":"Cass County, MO","64725":"Cass County, MO","64734":"Cass County, MO","64739":"Cass County, MO","64743":"Cass County, MO","64746":"Cass County, MO","64747":"Cass County, MO","64744":"Cedar County, MO","64756":"Cedar County, MO","65607":"Cedar County, MO","65785":"Cedar County, MO","64660":"Chariton County, MO","64676":"Chariton County, MO","64681":"Chariton County, MO","65236":"Chariton County, MO","65246":"Chariton County, MO","65261":"Chariton County, MO","65281":"Chariton County, MO","65286":"Chariton County, MO","65610":"Christian County, MO","65620":"Christian County, MO","65629":"Christian County, MO","65630":"Christian County, MO","65631":"Christian County, MO","65657":"Christian County, MO","65669":"Christian County, MO","65714":"Christian County, MO","65720":"Christian County, MO","65721":"Christian County, MO","65753":"Christian County, MO","65754":"Christian County, MO","72643":"Christian County, MO","63430":"Clark County, MO","63445":"Clark County, MO","63453":"Clark County, MO","63465":"Clark County, MO","63466":"Clark County, MO","63472":"Clark County, MO","63474":"Clark County, MO","64024":"Clay County, MO","64048":"Clay County, MO","64060":"Clay County, MO","64068":"Clay County, MO","64069":"Clay County, MO","64072":"Clay County, MO","64073":"Clay County, MO","64089":"Clay County, MO","64116":"Clay County, MO","64117":"Clay County, MO","64118":"Clay County, MO","64119":"Clay County, MO","64144":"Clay County, MO","64155":"Clay County, MO","64156":"Clay County, MO","64157":"Clay County, MO","64158":"Clay County, MO","64161":"Clay County, MO","64162":"Clay County, MO","64165":"Clay County, MO","64166":"Clay County, MO","64167":"Clay County, MO","64429":"Clinton County, MO","64454":"Clinton County, MO","64465":"Clinton County, MO","64477":"Clinton County, MO","64492":"Clinton County, MO","64493":"Clinton County, MO","65023":"Cole County, MO","65032":"Cole County, MO","65040":"Cole County, MO","65053":"Cole County, MO","65074":"Cole County, MO","65076":"Cole County, MO","65101":"Cole County, MO","65102":"Cole County, MO","65103":"Cole County, MO","65104":"Cole County, MO","65105":"Cole County, MO","65106":"Cole County, MO","65107":"Cole County, MO","65108":"Cole County, MO","65109":"Cole County, MO","65110":"Cole County, MO","65111":"Cole County, MO","65068":"Cooper County, MO","65233":"Cooper County, MO","65237":"Cooper County, MO","65276":"Cooper County, MO","65287":"Cooper County, MO","65322":"Cooper County, MO","65348":"Cooper County, MO","65441":"Crawford County, MO","65446":"Crawford County, MO","65449":"Crawford County, MO","65453":"Crawford County, MO","65456":"Crawford County, MO","65535":"Crawford County, MO","65565":"Crawford County, MO","65586":"Crawford County, MO","65603":"Dade County, MO","65635":"Dade County, MO","65646":"Dade County, MO","65661":"Dade County, MO","65682":"Dade County, MO","65752":"Dade County, MO","65590":"Dallas County, MO","65622":"Dallas County, MO","65685":"Dallas County, MO","65764":"Dallas County, MO","65767":"Dallas County, MO","65783":"Dallas County, MO","64620":"Daviess County, MO","64636":"Daviess County, MO","64640":"Daviess County, MO","64642":"Daviess County, MO","64647":"Daviess County, MO","64648":"Daviess County, MO","64654":"Daviess County, MO","64670":"Daviess County, MO","64689":"Daviess County, MO","64422":"DeKalb County, MO","64430":"DeKalb County, MO","64469":"DeKalb County, MO","64474":"DeKalb County, MO","64490":"DeKalb County, MO","64494":"DeKalb County, MO","64497":"DeKalb County, MO","65440":"Dent County, MO","65501":"Dent County, MO","65532":"Dent County, MO","65541":"Dent County, MO","65560":"Dent County, MO","65608":"Douglas County, MO","65638":"Douglas County, MO","65755":"Douglas County, MO","65768":"Douglas County, MO","63821":"Dunklin County, MO","63829":"Dunklin County, MO","63837":"Dunklin County, MO","63847":"Dunklin County, MO","63852":"Dunklin County, MO","63855":"Dunklin County, MO","63857":"Dunklin County, MO","63863":"Dunklin County, MO","63875":"Dunklin County, MO","63876":"Dunklin County, MO","63880":"Dunklin County, MO","63933":"Dunklin County, MO","63013":"Franklin County, MO","63014":"Franklin County, MO","63015":"Franklin County, MO","63037":"Franklin County, MO","63039":"Franklin County, MO","63055":"Franklin County, MO","63056":"Franklin County, MO","63060":"Franklin County, MO","63061":"Franklin County, MO","63068":"Franklin County, MO","63069":"Franklin County, MO","63072":"Franklin County, MO","63073":"Franklin County, MO","63077":"Franklin County, MO","63079":"Franklin County, MO","63080":"Franklin County, MO","63084":"Franklin County, MO","63089":"Franklin County, MO","63090":"Franklin County, MO","63091":"Gasconade County, MO","65014":"Gasconade County, MO","65036":"Gasconade County, MO","65041":"Gasconade County, MO","65061":"Gasconade County, MO","65062":"Gasconade County, MO","65066":"Gasconade County, MO","64402":"Gentry County, MO","64438":"Gentry County, MO","64453":"Gentry County, MO","64463":"Gentry County, MO","64489":"Gentry County, MO","64657":"Gentry County, MO","65604":"Greene County, MO","65612":"Greene County, MO","65619":"Greene County, MO","65648":"Greene County, MO","65738":"Greene County, MO","65757":"Greene County, MO","65765":"Greene County, MO","65770":"Greene County, MO","65781":"Greene County, MO","65801":"Greene County, MO","65802":"Greene County, MO","65803":"Greene County, MO","65804":"Greene County, MO","65805":"Greene County, MO","65806":"Greene County, MO","65807":"Greene County, MO","65808":"Greene County, MO","65809":"Greene County, MO","65810":"Greene County, MO","65814":"Greene County, MO","65817":"Greene County, MO","65890":"Greene County, MO","65897":"Greene County, MO","65898":"Greene County, MO","65899":"Greene County, MO","64641":"Grundy County, MO","64652":"Grundy County, MO","64679":"Grundy County, MO","64683":"Grundy County, MO","64424":"Harrison County, MO","64426":"Harrison County, MO","64442":"Harrison County, MO","64458":"Harrison County, MO","64467":"Harrison County, MO","64471":"Harrison County, MO","64481":"Harrison County, MO","64632":"Harrison County, MO","64726":"Henry County, MO","64735":"Henry County, MO","64740":"Henry County, MO","64770":"Henry County, MO","64788":"Henry County, MO","65323":"Henry County, MO","65360":"Henry County, MO","65634":"Hickory County, MO","65668":"Hickory County, MO","65724":"Hickory County, MO","65732":"Hickory County, MO","65735":"Hickory County, MO","65774":"Hickory County, MO","65779":"Hickory County, MO","64437":"Holt County, MO","64451":"Holt County, MO","64466":"Holt County, MO","64470":"Holt County, MO","64473":"Holt County, MO","65230":"Howard County, MO","65248":"Howard County, MO","65250":"Howard County, MO","65254":"Howard County, MO","65274":"Howard County, MO","65548":"Howell County, MO","65626":"Howell County, MO","65688":"Howell County, MO","65775":"Howell County, MO","65777":"Howell County, MO","65788":"Howell County, MO","65789":"Howell County, MO","65790":"Howell County, MO","65793":"Howell County, MO","63620":"Iron County, MO","63621":"Iron County, MO","63623":"Iron County, MO","63636":"Iron County, MO","63650":"Iron County, MO","63656":"Iron County, MO","63663":"Iron County, MO","63675":"Iron County, MO","65439":"Iron County, MO","65566":"Iron County, MO","64002":"Jackson County, MO","64013":"Jackson County, MO","64014":"Jackson County, MO","64015":"Jackson County, MO","64016":"Jackson County, MO","64029":"Jackson County, MO","64030":"Jackson County, MO","64034":"Jackson County, MO","64050":"Jackson County, MO","64051":"Jackson County, MO","64052":"Jackson County, MO","64053":"Jackson County, MO","64054":"Jackson County, MO","64055":"Jackson County, MO","64056":"Jackson County, MO","64057":"Jackson County, MO","64058":"Jackson County, MO","64063":"Jackson County, MO","64064":"Jackson County, MO","64065":"Jackson County, MO","64066":"Jackson County, MO","64070":"Jackson County, MO","64075":"Jackson County, MO","64081":"Jackson County, MO","64082":"Jackson County, MO","64086":"Jackson County, MO","64088":"Jackson County, MO","64101":"Jackson County, MO","64102":"Jackson County, MO","64105":"Jackson County, MO","64106":"Jackson County, MO","64108":"Jackson County, MO","64109":"Jackson County, MO","64110":"Jackson County, MO","64111":"Jackson County, MO","64112":"Jackson County, MO","64113":"Jackson County, MO","64114":"Jackson County, MO","64120":"Jackson County, MO","64121":"Jackson County, MO","64123":"Jackson County, MO","64124":"Jackson County, MO","64125":"Jackson County, MO","64126":"Jackson County, MO","64127":"Jackson County, MO","64128":"Jackson County, MO","64129":"Jackson County, MO","64130":"Jackson County, MO","64131":"Jackson County, MO","64132":"Jackson County, MO","64133":"Jackson County, MO","64134":"Jackson County, MO","64136":"Jackson County, MO","64137":"Jackson County, MO","64138":"Jackson County, MO","64139":"Jackson County, MO","64141":"Jackson County, MO","64145":"Jackson County, MO","64146":"Jackson County, MO","64147":"Jackson County, MO","64148":"Jackson County, MO","64149":"Jackson County, MO","64170":"Jackson County, MO","64171":"Jackson County, MO","64179":"Jackson County, MO","64180":"Jackson County, MO","64184":"Jackson County, MO","64187":"Jackson County, MO","64188":"Jackson County, MO","64191":"Jackson County, MO","64196":"Jackson County, MO","64197":"Jackson County, MO","64198":"Jackson County, MO","64199":"Jackson County, MO","64999":"Jackson County, MO","64755":"Jasper County, MO","64801":"Jasper County, MO","64802":"Jasper County, MO","64803":"Jasper County, MO","64804":"Jasper County, MO","64830":"Jasper County, MO","64832":"Jasper County, MO","64833":"Jasper County, MO","64834":"Jasper County, MO","64835":"Jasper County, MO","64836":"Jasper County, MO","64841":"Jasper County, MO","64848":"Jasper County, MO","64849":"Jasper County, MO","64855":"Jasper County, MO","64857":"Jasper County, MO","64859":"Jasper County, MO","64862":"Jasper County, MO","64870":"Jasper County, MO","63010":"Jefferson County, MO","63012":"Jefferson County, MO","63016":"Jefferson County, MO","63019":"Jefferson County, MO","63020":"Jefferson County, MO","63023":"Jefferson County, MO","63028":"Jefferson County, MO","63030":"Jefferson County, MO","63041":"Jefferson County, MO","63047":"Jefferson County, MO","63048":"Jefferson County, MO","63049":"Jefferson County, MO","63050":"Jefferson County, MO","63051":"Jefferson County, MO","63052":"Jefferson County, MO","63053":"Jefferson County, MO","63057":"Jefferson County, MO","63065":"Jefferson County, MO","63066":"Jefferson County, MO","63070":"Jefferson County, MO","64019":"Johnson County, MO","64040":"Johnson County, MO","64061":"Johnson County, MO","64093":"Johnson County, MO","64733":"Johnson County, MO","64761":"Johnson County, MO","65305":"Johnson County, MO","65336":"Johnson County, MO","63446":"Knox County, MO","63458":"Knox County, MO","63460":"Knox County, MO","63464":"Knox County, MO","63531":"Knox County, MO","63537":"Knox County, MO","63547":"Knox County, MO","65463":"Laclede County, MO","65470":"Laclede County, MO","65536":"Laclede County, MO","65543":"Laclede County, MO","65632":"Laclede County, MO","65722":"Laclede County, MO","64001":"Lafayette County, MO","64011":"Lafayette County, MO","64020":"Lafayette County, MO","64021":"Lafayette County, MO","64022":"Lafayette County, MO","64037":"Lafayette County, MO","64067":"Lafayette County, MO","64071":"Lafayette County, MO","64074":"Lafayette County, MO","64076":"Lafayette County, MO","64096":"Lafayette County, MO","64097":"Lafayette County, MO","65327":"Lafayette County, MO","65605":"Lawrence County, MO","65654":"Lawrence County, MO","65664":"Lawrence County, MO","65705":"Lawrence County, MO","65707":"Lawrence County, MO","65712":"Lawrence County, MO","65723":"Lawrence County, MO","65756":"Lawrence County, MO","65769":"Lawrence County, MO","63435":"Lewis County, MO","63438":"Lewis County, MO","63440":"Lewis County, MO","63447":"Lewis County, MO","63448":"Lewis County, MO","63452":"Lewis County, MO","63457":"Lewis County, MO","63473":"Lewis County, MO","63343":"Lincoln County, MO","63347":"Lincoln County, MO","63349":"Lincoln County, MO","63362":"Lincoln County, MO","63369":"Lincoln County, MO","63370":"Lincoln County, MO","63377":"Lincoln County, MO","63379":"Lincoln County, MO","63381":"Lincoln County, MO","63387":"Lincoln County, MO","63389":"Lincoln County, MO","63557":"Linn County, MO","64628":"Linn County, MO","64630":"Linn County, MO","64631":"Linn County, MO","64651":"Linn County, MO","64653":"Linn County, MO","64658":"Linn County, MO","64659":"Linn County, MO","64674":"Linn County, MO","64601":"Livingston County, MO","64635":"Livingston County, MO","64638":"Livingston County, MO","64656":"Livingston County, MO","64664":"Livingston County, MO","64686":"Livingston County, MO","64688":"Livingston County, MO","64831":"McDonald County, MO","64843":"McDonald County, MO","64847":"McDonald County, MO","64854":"McDonald County, MO","64856":"McDonald County, MO","64861":"McDonald County, MO","64863":"McDonald County, MO","64868":"McDonald County, MO","65730":"McDonald County, MO","63431":"Macon County, MO","63530":"Macon County, MO","63532":"Macon County, MO","63534":"Macon County, MO","63538":"Macon County, MO","63539":"Macon County, MO","63549":"Macon County, MO","63552":"Macon County, MO","63558":"Macon County, MO","65247":"Macon County, MO","63645":"Madison County, MO","63655":"Madison County, MO","65013":"Maries County, MO","65443":"Maries County, MO","65580":"Maries County, MO","65582":"Maries County, MO","63401":"Marion County, MO","63454":"Marion County, MO","63461":"Marion County, MO","63463":"Marion County, MO","63471":"Marion County, MO","64661":"Mercer County, MO","64673":"Mercer County, MO","65017":"Miller County, MO","65026":"Miller County, MO","65047":"Miller County, MO","65064":"Miller County, MO","65075":"Miller County, MO","65082":"Miller County, MO","65083":"Miller County, MO","65486":"Miller County, MO","63820":"Mississippi County, MO","63823":"Mississippi County, MO","63834":"Mississippi County, MO","63845":"Mississippi County, MO","63881":"Mississippi County, MO","63882":"Mississippi County, MO","65018":"Moniteau County, MO","65025":"Moniteau County, MO","65034":"Moniteau County, MO","65042":"Moniteau County, MO","65046":"Moniteau County, MO","65050":"Moniteau County, MO","65055":"Moniteau County, MO","65081":"Moniteau County, MO","63456":"Monroe County, MO","65258":"Monroe County, MO","65263":"Monroe County, MO","65275":"Monroe County, MO","65282":"Monroe County, MO","65283":"Monroe County, MO","63333":"Montgomery County, MO","63350":"Montgomery County, MO","63351":"Montgomery County, MO","63359":"Montgomery County, MO","63361":"Montgomery County, MO","63363":"Montgomery County, MO","63384":"Montgomery County, MO","65069":"Montgomery County, MO","65011":"Morgan County, MO","65037":"Morgan County, MO","65038":"Morgan County, MO","65072":"Morgan County, MO","65078":"Morgan County, MO","65084":"Morgan County, MO","65329":"Morgan County, MO","65354":"Morgan County, MO","63828":"New Madrid County, MO","63833":"New Madrid County, MO","63848":"New Madrid County, MO","63860":"New Madrid County, MO","63862":"New Madrid County, MO","63866":"New Madrid County, MO","63867":"New Madrid County, MO","63868":"New Madrid County, MO","63869":"New Madrid County, MO","63870":"New Madrid County, MO","63873":"New Madrid County, MO","63874":"New Madrid County, MO","63878":"New Madrid County, MO","64840":"Newton County, MO","64842":"Newton County, MO","64844":"Newton County, MO","64850":"Newton County, MO","64853":"Newton County, MO","64858":"Newton County, MO","64864":"Newton County, MO","64865":"Newton County, MO","64866":"Newton County, MO","64867":"Newton County, MO","64873":"Newton County, MO","64423":"Nodaway County, MO","64428":"Nodaway County, MO","64431":"Nodaway County, MO","64432":"Nodaway County, MO","64433":"Nodaway County, MO","64434":"Nodaway County, MO","64445":"Nodaway County, MO","64455":"Nodaway County, MO","64457":"Nodaway County, MO","64461":"Nodaway County, MO","64468":"Nodaway County, MO","64475":"Nodaway County, MO","64476":"Nodaway County, MO","64479":"Nodaway County, MO","64487":"Nodaway County, MO","65606":"Oregon County, MO","65690":"Oregon County, MO","65692":"Oregon County, MO","65778":"Oregon County, MO","65791":"Oregon County, MO","65001":"Osage County, MO","65016":"Osage County, MO","65024":"Osage County, MO","65035":"Osage County, MO","65048":"Osage County, MO","65051":"Osage County, MO","65054":"Osage County, MO","65058":"Osage County, MO","65085":"Osage County, MO","65609":"Ozark County, MO","65618":"Ozark County, MO","65637":"Ozark County, MO","65655":"Ozark County, MO","65666":"Ozark County, MO","65676":"Ozark County, MO","65715":"Ozark County, MO","65729":"Ozark County, MO","65741":"Ozark County, MO","65760":"Ozark County, MO","65761":"Ozark County, MO","65762":"Ozark County, MO","65766":"Ozark County, MO","65773":"Ozark County, MO","65784":"Ozark County, MO","63826":"Pemiscot County, MO","63827":"Pemiscot County, MO","63830":"Pemiscot County, MO","63839":"Pemiscot County, MO","63840":"Pemiscot County, MO","63849":"Pemiscot County, MO","63851":"Pemiscot County, MO","63853":"Pemiscot County, MO","63877":"Pemiscot County, MO","63879":"Pemiscot County, MO","63732":"Perry County, MO","63737":"Perry County, MO","63746":"Perry County, MO","63748":"Perry County, MO","63775":"Perry County, MO","63776":"Perry County, MO","63783":"Perry County, MO","65301":"Pettis County, MO","65302":"Pettis County, MO","65332":"Pettis County, MO","65333":"Pettis County, MO","65334":"Pettis County, MO","65337":"Pettis County, MO","65345":"Pettis County, MO","65350":"Pettis County, MO","65401":"Phelps County, MO","65402":"Phelps County, MO","65409":"Phelps County, MO","65436":"Phelps County, MO","65461":"Phelps County, MO","65462":"Phelps County, MO","65529":"Phelps County, MO","65550":"Phelps County, MO","65559":"Phelps County, MO","63330":"Pike County, MO","63334":"Pike County, MO","63336":"Pike County, MO","63339":"Pike County, MO","63344":"Pike County, MO","63353":"Pike County, MO","63433":"Pike County, MO","63441":"Pike County, MO","64018":"Platte County, MO","64028":"Platte County, MO","64079":"Platte County, MO","64092":"Platte County, MO","64098":"Platte County, MO","64150":"Platte County, MO","64151":"Platte County, MO","64152":"Platte County, MO","64153":"Platte County, MO","64154":"Platte County, MO","64163":"Platte County, MO","64164":"Platte County, MO","64168":"Platte County, MO","64190":"Platte County, MO","64195":"Platte County, MO","64439":"Platte County, MO","64444":"Platte County, MO","65601":"Polk County, MO","65613":"Polk County, MO","65617":"Polk County, MO","65640":"Polk County, MO","65645":"Polk County, MO","65649":"Polk County, MO","65650":"Polk County, MO","65663":"Polk County, MO","65674":"Polk County, MO","65710":"Polk County, MO","65725":"Polk County, MO","65727":"Polk County, MO","65452":"Pulaski County, MO","65457":"Pulaski County, MO","65459":"Pulaski County, MO","65473":"Pulaski County, MO","65534":"Pulaski County, MO","65556":"Pulaski County, MO","65583":"Pulaski County, MO","65584":"Pulaski County, MO","63551":"Putnam County, MO","63565":"Putnam County, MO","63567":"Putnam County, MO","64655":"Putnam County, MO","64672":"Putnam County, MO","63436":"Ralls County, MO","63459":"Ralls County, MO","63462":"Ralls County, MO","63467":"Ralls County, MO","65239":"Randolph County, MO","65243":"Randolph County, MO","65244":"Randolph County, MO","65257":"Randolph County, MO","65259":"Randolph County, MO","65260":"Randolph County, MO","65270":"Randolph County, MO","65278":"Randolph County, MO","64017":"Ray County, MO","64035":"Ray County, MO","64036":"Ray County, MO","64062":"Ray County, MO","64077":"Ray County, MO","64084":"Ray County, MO","64085":"Ray County, MO","63625":"Reynolds County, MO","63629":"Reynolds County, MO","63633":"Reynolds County, MO","63638":"Reynolds County, MO","63654":"Reynolds County, MO","63665":"Reynolds County, MO","63666":"Reynolds County, MO","63931":"Ripley County, MO","63935":"Ripley County, MO","63939":"Ripley County, MO","63942":"Ripley County, MO","63953":"Ripley County, MO","63955":"Ripley County, MO","63301":"St. Charles County, MO","63302":"St. Charles County, MO","63303":"St. Charles County, MO","63304":"St. Charles County, MO","63332":"St. Charles County, MO","63338":"St. Charles County, MO","63341":"St. Charles County, MO","63346":"St. Charles County, MO","63348":"St. Charles County, MO","63365":"St. Charles County, MO","63366":"St. Charles County, MO","63367":"St. Charles County, MO","63368":"St. Charles County, MO","63373":"St. Charles County, MO","63376":"St. Charles County, MO","63385":"St. Charles County, MO","63386":"St. Charles County, MO","64724":"St. Clair County, MO","64738":"St. Clair County, MO","64763":"St. Clair County, MO","64776":"St. Clair County, MO","64781":"St. Clair County, MO","63627":"Ste. Genevieve County, MO","63670":"Ste. Genevieve County, MO","63673":"Ste. Genevieve County, MO","63036":"St. Francois County, MO","63087":"St. Francois County, MO","63601":"St. Francois County, MO","63624":"St. Francois County, MO","63626":"St. Francois County, MO","63628":"St. Francois County, MO","63637":"St. Francois County, MO","63640":"St. Francois County, MO","63651":"St. Francois County, MO","63653":"St. Francois County, MO","63005":"St. Louis County, MO","63006":"St. Louis County, MO","63011":"St. Louis County, MO","63017":"St. Louis County, MO","63021":"St. Louis County, MO","63022":"St. Louis County, MO","63024":"St. Louis County, MO","63025":"St. Louis County, MO","63026":"St. Louis County, MO","63031":"St. Louis County, MO","63032":"St. Louis County, MO","63033":"St. Louis County, MO","63034":"St. Louis County, MO","63038":"St. Louis County, MO","63040":"St. Louis County, MO","63042":"St. Louis County, MO","63043":"St. Louis County, MO","63044":"St. Louis County, MO","63045":"St. Louis County, MO","63074":"St. Louis County, MO","63088":"St. Louis County, MO","63099":"St. Louis County, MO","63105":"St. Louis County, MO","63114":"St. Louis County, MO","63117":"St. Louis County, MO","63119":"St. Louis County, MO","63121":"St. Louis County, MO","63122":"St. Louis County, MO","63123":"St. Louis County, MO","63124":"St. Louis County, MO","63125":"St. Louis County, MO","63126":"St. Louis County, MO","63127":"St. Louis County, MO","63128":"St. Louis County, MO","63129":"St. Louis County, MO","63130":"St. Louis County, MO","63131":"St. Louis County, MO","63132":"St. Louis County, MO","63133":"St. Louis County, MO","63134":"St. Louis County, MO","63135":"St. Louis County, MO","63136":"St. Louis County, MO","63137":"St. Louis County, MO","63138":"St. Louis County, MO","63140":"St. Louis County, MO","63141":"St. Louis County, MO","63143":"St. Louis County, MO","63144":"St. Louis County, MO","63145":"St. Louis County, MO","63146":"St. Louis County, MO","63151":"St. Louis County, MO","63167":"St. Louis County, MO","65320":"Saline County, MO","65321":"Saline County, MO","65330":"Saline County, MO","65339":"Saline County, MO","65340":"Saline County, MO","65344":"Saline County, MO","65347":"Saline County, MO","65349":"Saline County, MO","65351":"Saline County, MO","63535":"Schuyler County, MO","63536":"Schuyler County, MO","63541":"Schuyler County, MO","63548":"Schuyler County, MO","63561":"Schuyler County, MO","63432":"Scotland County, MO","63442":"Scotland County, MO","63543":"Scotland County, MO","63555":"Scotland County, MO","63563":"Scotland County, MO","63736":"Scott County, MO","63740":"Scott County, MO","63742":"Scott County, MO","63758":"Scott County, MO","63767":"Scott County, MO","63771":"Scott County, MO","63774":"Scott County, MO","63780":"Scott County, MO","63784":"Scott County, MO","63801":"Scott County, MO","63824":"Scott County, MO","65438":"Shannon County, MO","65466":"Shannon County, MO","65546":"Shannon County, MO","65588":"Shannon County, MO","63434":"Shelby County, MO","63437":"Shelby County, MO","63439":"Shelby County, MO","63443":"Shelby County, MO","63450":"Shelby County, MO","63451":"Shelby County, MO","63468":"Shelby County, MO","63469":"Shelby County, MO","63730":"Stoddard County, MO","63735":"Stoddard County, MO","63738":"Stoddard County, MO","63822":"Stoddard County, MO","63825":"Stoddard County, MO","63841":"Stoddard County, MO","63846":"Stoddard County, MO","63850":"Stoddard County, MO","63936":"Stoddard County, MO","63960":"Stoddard County, MO","65611":"Stone County, MO","65624":"Stone County, MO","65633":"Stone County, MO","65656":"Stone County, MO","65675":"Stone County, MO","65681":"Stone County, MO","65686":"Stone County, MO","65728":"Stone County, MO","65737":"Stone County, MO","63544":"Sullivan County, MO","63545":"Sullivan County, MO","63556":"Sullivan County, MO","63560":"Sullivan County, MO","63566":"Sullivan County, MO","64645":"Sullivan County, MO","64646":"Sullivan County, MO","64667":"Sullivan County, MO","65614":"Taney County, MO","65615":"Taney County, MO","65616":"Taney County, MO","65627":"Taney County, MO","65653":"Taney County, MO","65672":"Taney County, MO","65673":"Taney County, MO","65679":"Taney County, MO","65680":"Taney County, MO","65726":"Taney County, MO","65731":"Taney County, MO","65733":"Taney County, MO","65739":"Taney County, MO","65740":"Taney County, MO","65744":"Taney County, MO","65759":"Taney County, MO","65771":"Taney County, MO","65444":"Texas County, MO","65464":"Texas County, MO","65468":"Texas County, MO","65479":"Texas County, MO","65483":"Texas County, MO","65484":"Texas County, MO","65542":"Texas County, MO","65552":"Texas County, MO","65555":"Texas County, MO","65557":"Texas County, MO","65564":"Texas County, MO","65570":"Texas County, MO","65571":"Texas County, MO","65589":"Texas County, MO","65689":"Texas County, MO","64728":"Vernon County, MO","64741":"Vernon County, MO","64750":"Vernon County, MO","64765":"Vernon County, MO","64767":"Vernon County, MO","64771":"Vernon County, MO","64772":"Vernon County, MO","64778":"Vernon County, MO","64783":"Vernon County, MO","64784":"Vernon County, MO","64790":"Vernon County, MO","63342":"Warren County, MO","63357":"Warren County, MO","63378":"Warren County, MO","63380":"Warren County, MO","63383":"Warren County, MO","63390":"Warren County, MO","63071":"Washington County, MO","63622":"Washington County, MO","63630":"Washington County, MO","63631":"Washington County, MO","63648":"Washington County, MO","63660":"Washington County, MO","63664":"Washington County, MO","63674":"Washington County, MO","63632":"Wayne County, MO","63763":"Wayne County, MO","63934":"Wayne County, MO","63944":"Wayne County, MO","63950":"Wayne County, MO","63951":"Wayne County, MO","63952":"Wayne County, MO","63956":"Wayne County, MO","63957":"Wayne County, MO","63964":"Wayne County, MO","63966":"Wayne County, MO","63967":"Wayne County, MO","65636":"Webster County, MO","65644":"Webster County, MO","65652":"Webster County, MO","65706":"Webster County, MO","65713":"Webster County, MO","65742":"Webster County, MO","65746":"Webster County, MO","64420":"Worth County, MO","64441":"Worth County, MO","64456":"Worth County, MO","64486":"Worth County, MO","64499":"Worth County, MO","65660":"Wright County, MO","65662":"Wright County, MO","65667":"Wright County, MO","65702":"Wright County, MO","65704":"Wright County, MO","65711":"Wright County, MO","65717":"Wright County, MO","63101":"St. Louis (city) County, MO","63102":"St. Louis (city) County, MO","63103":"St. Louis (city) County, MO","63104":"St. Louis (city) County, MO","63106":"St. Louis (city) County, MO","63107":"St. Louis (city) County, MO","63108":"St. Louis (city) County, MO","63109":"St. Louis (city) County, MO","63110":"St. Louis (city) County, MO","63111":"St. Louis (city) County, MO","63112":"St. Louis (city) County, MO","63113":"St. Louis (city) County, MO","63115":"St. Louis (city) County, MO","63116":"St. Louis (city) County, MO","63118":"St. Louis (city) County, MO","63120":"St. Louis (city) County, MO","63139":"St. Louis (city) County, MO","63147":"St. Louis (city) County, MO","63150":"St. Louis (city) County, MO","63155":"St. Louis (city) County, MO","63156":"St. Louis (city) County, MO","63157":"St. Louis (city) County, MO","63158":"St. Louis (city) County, MO","63160":"St. Louis (city) County, MO","63163":"St. Louis (city) County, MO","63164":"St. Louis (city) County, MO","63166":"St. Louis (city) County, MO","63169":"St. Louis (city) County, MO","63171":"St. Louis (city) County, MO","63177":"St. Louis (city) County, MO","63178":"St. Louis (city) County, MO","63179":"St. Louis (city) County, MO","63180":"St. Louis (city) County, MO","63182":"St. Louis (city) County, MO","63188":"St. Louis (city) County, MO","63195":"St. Louis (city) County, MO","63197":"St. Louis (city) County, MO","63199":"St. Louis (city) County, MO"};
function zipToCounty(zip) {
  const z = String(zip || '').trim();
  return MO_KS_ZIP_COUNTY[z] || null;
}
function deriveOrganizerId({ county, city, zip }) {
  // 1. Use supplied county if present
  let c = (county || '').toLowerCase();
  // 2. If no county, try to derive from zip
  if (!c) {
    const derived = zipToCounty(zip);
    if (derived) c = derived.toLowerCase();
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
};
function organizerId(name) {
  if (!name) return null;
  return ORGANIZER_IDS_LC[String(name).toLowerCase().trim()] || null;
}
// Backward-compat alias for any code still using ORGANIZER_IDS[name]
const ORGANIZER_IDS = new Proxy({}, { get: (_, k) => organizerId(k) });

const AUTO_CONFIRM_EMAIL = false;
const ZOOM_LINK_5_26 = 'https://us02web.zoom.us/j/6284644152?pwd=kweXnAjyLKIcGqxY3uxQSKeMKYfqMv.1';
const EVENT_NAME = 'Emergency Meeting on Public School Funding in Missouri';
const EVENT_DATE_LABEL = 'Tuesday, May 26 · 7:30 PM CST';
const FROM_CONFIRM = 'Parents for MO Kids <groundwork@civicpowerlab.us>';
const REPLY_TO_CONFIRM = 'lanee4kckids@gmail.com';
// Per-organizer profile used by sendConfirmationEmail.
// Key is the lowercase organizer slug the dashboard sends (e.g. 'lanee', 'stephanie').
// If missing → falls back to LaNeé.
const ORGANIZER_PROFILE = {
  'lanee':     { name: 'LaNeé Bridewell',    group: 'Parents for KC Kids', reply_to: 'lanee4kckids@gmail.com' },
  'laneé':     { name: 'LaNeé Bridewell',    group: 'Parents for KC Kids', reply_to: 'lanee4kckids@gmail.com' },
  'stephanie': { name: 'Stephanie Rittgers', group: 'Parents for MO Kids', reply_to: 'srttgrs+civicwork@gmail.com' },
};
// Legacy lookup, kept for any code still reading reply-to only.
const ORGANIZER_REPLY_TO = Object.fromEntries(Object.entries(ORGANIZER_PROFILE).map(([k,v]) => [k, v.reply_to]));

const ALLOWLIST = [
  'laneebridewell@gmail.com',
  'srttgrs@yahoo.com',
  'elizabethmck@gmail.com',
  'emckenna@hks.harvard.edu',
  'ellenginkc@gmail.com',
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
  'cache:today-stats:lanee',
  'cache:today-stats:stephanie',
  'cache:org-contacts:lanee',
  'cache:org-contacts:stephanie',
  'cache:house-hosts',
  'queue:count',
  'queue:count:lanee',
  'queue:count:stephanie',
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
  // Wrap individually — KV has a per-day delete limit; one failure shouldn't
  // crash the whole request (otherwise signups fail when limit's hit).
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
      if (url.pathname === '/amendment5-signup' && request.method === 'POST') return await amendment5Signup(request, env);
      if (url.pathname === '/house-meeting-hosts' && request.method === 'GET') return await houseMeetingHosts(env);
      if (url.pathname === '/event-detail' && request.method === 'GET') return await eventDetail(env, url);
      if (url.pathname === '/event-rsvp' && request.method === 'POST') return await eventRsvp(request, env);
      // Admin endpoints — gated by X-Admin-Key header instead of session token
      if (url.pathname === '/admin/dedupe-merge' && request.method === 'POST') return await adminDedupeMerge(request, env);
      if (url.pathname === '/admin/contacts-dump' && request.method === 'GET') return await adminContactsDump(request, env, url);
      if (url.pathname === '/admin/role-append' && request.method === 'POST') return await adminRoleAppend(request, env);
      if (url.pathname === '/admin/queue-check' && request.method === 'GET') return await adminQueueCheck(request, env, url);
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
              if (district) patch.district = district;
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
              if (district) fields.district = district;
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
      if (url.pathname === '/prospects') return await getProspects(env, url);
      if (url.pathname === '/log' && request.method === 'POST') return await logOutcome(request, env);
      if (url.pathname === '/undo' && request.method === 'POST') return await undoSave(request, env);
      if (url.pathname === '/confirmees') return await getConfirmees(env, url);
      if (url.pathname === '/confirm-log' && request.method === 'POST') return await confirmLog(request, env);
      if (url.pathname === '/attendance-log' && request.method === 'POST') return await attendanceLog(request, env);
      if (url.pathname === '/walkin' && request.method === 'POST') return await walkinSignup(request, env);
      if (url.pathname === '/today-stats') return await getTodayStats(env, url);
      if (url.pathname === '/recent-activity') return await getRecentActivity(env, url);
      if (url.pathname === '/search') return await searchContacts(env, url);
      if (url.pathname === '/queue-count') return await getQueueCount(env, url);
      if (url.pathname === '/send-zoom-email' && request.method === 'POST') return await sendZoomEmailNow(request, env);
      if (url.pathname === '/event-create' && request.method === 'POST') return await createEvent(request, env);
      if (url.pathname === '/events' && request.method === 'GET') return await listEvents(env, url);
      // Note: /event-detail and /event-rsvp are below in the public route block
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }
};

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Groundwork-Session',
  };
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
  if (body.website && String(body.website).trim()) return json({ error: 'bot detected' }, 400);
  const { first, last, email, phone, school, district, county, city, zip, signup_5_26, signup_6_9, source } = body;
  if (!first || !last || (!email && !phone)) {
    return json({ error: 'first name, last name, and email or phone are required' }, 400);
  }

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
  if (body.website && String(body.website).trim()) return json({ error: 'bot detected' }, 400);
  const { date, host_name, first, last, phone, email, street_address, city, state, zip, district, school, commitments = [], other_text, source } = body;
  if (!first || !last || !phone || !email || !date || !host_name) {
    return json({ error: 'first, last, phone, email, date, and host name are required' }, 400);
  }

  const clean = (s) => String(s || '').replace(/^[^\w\s]+/, '').trim();
  const cFirst = clean(first);
  const cLast = clean(last);
  const cEmail = String(email).toLowerCase().trim();
  const cPhone = String(phone).trim();

  let existingId = null;
  const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`LOWER({email})='${cEmail}'`)}&maxRecords=1`);
  if (r.records.length > 0) existingId = r.records[0].id;
  if (!existingId) {
    const digits = cPhone.replace(/\D/g, '').slice(-10);
    if (digits.length === 10) {
      const r2 = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`REGEX_REPLACE({phone},'\\\\D','')='${digits}'`)}&maxRecords=1`);
      if (r2.records.length > 0) existingId = r2.records[0].id;
    }
  }

  // Organizer assignment via county → city → zip cascade
  const organizerId = deriveOrganizerId({ city, zip });

  let contactId;
  const baseFields = {
    first: cFirst,
    last: cLast,
    email: cEmail,
    phone: cPhone,
    source: source || 'house meeting sign-in',
  };
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
  if (body.website && String(body.website).trim()) return json({ error: 'bot detected' }, 400);
  const { first, last, phone, email, street_address, city, state, zip, district, school, commitments = [], other_text, source } = body;
  if (!first || !last || !phone || !email || !zip) {
    return json({ error: 'first, last, phone, email, and zip are required' }, 400);
  }

  const clean = (s) => String(s || '').replace(/^[^\w\s]+/, '').trim();
  const cFirst = clean(first);
  const cLast = clean(last);
  const cEmail = String(email).toLowerCase().trim();
  const cPhone = String(phone).trim();

  // Dedupe by email then phone
  let existingId = null;
  const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`LOWER({email})='${cEmail}'`)}&maxRecords=1`);
  if (r.records.length > 0) existingId = r.records[0].id;
  if (!existingId) {
    const digits = cPhone.replace(/\D/g, '').slice(-10);
    if (digits.length === 10) {
      const r2 = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`REGEX_REPLACE({phone},'\\\\D','')='${digits}'`)}&maxRecords=1`);
      if (r2.records.length > 0) existingId = r2.records[0].id;
    }
  }

  // Organizer assignment via county → city → zip cascade
  const organizerId = deriveOrganizerId({ city, zip });

  // Determine which event this commitment belongs to based on today's date
  const today = todayCT();
  const isAfter526 = today > '2026-05-26';
  const eventName = isAfter526 ? '6/9 Emergency Meeting' : 'Orientation 5/26';
  const eventKey = isAfter526 ? '6_9' : '5_26';

  // Build contact field updates
  const baseFields = {
    first: cFirst,
    last: cLast,
    email: cEmail,
    phone: cPhone,
    source: source || 'amendment 5 commitment form',
  };
  if (street_address) baseFields.street_address = String(street_address).trim();
  if (city) baseFields.city = String(city).trim();
  if (zip) baseFields.zip = String(zip).trim();
  if (district) baseFields.district = String(district).trim();
  if (school) baseFields.school = String(school).trim();
  // Mark as signed-up for the appropriate event
  baseFields.last_attempt_date = today;
  if (isAfter526) {
    baseFields.signup_6_9_status = 'Signed up';
  } else {
    baseFields.last_attempt_result = 'Signed up';
  }
  // Denormalize commitments onto the contact so Ellen's call-through view is self-contained
  const commitmentList = (commitments || []).filter(c => c && c !== 'Other');
  if (commitmentList.length > 0 || (other_text && commitments.includes('Other'))) {
    const parts = commitmentList.slice();
    if (other_text && commitments.includes('Other')) parts.push(`Other: ${other_text}`);
    baseFields.amendment5_commitments = parts.join(' · ');
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

  await invalidateReadCaches(env);
  return json({ ok: true, contact_id: contactId, commitments_logged: commitments.length, event: eventName });
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
};
function organizerName(name) {
  if (!name) return null;
  return ORGANIZER_NAMES_LC[String(name).toLowerCase().trim()] || null;
}

function prospectsFilter(organizerName_) {
  // Name-based filter — record-ID-based was broken because ARRAYJOIN returns names not IDs.
  const orgFullName = organizerName(organizerName_);
  const orgClause = orgFullName ? `,FIND('${orgFullName}',{assigned_organizer}&'')>0` : '';
  const schoolExcl = EXCLUDED_SCHOOL_PATTERNS
    .map(p => `FIND('${p}',LOWER({school}&''))=0`)
    .join(',');
  const roleExcl = EXCLUDED_ROLES
    .map(r => `FIND('${r}',{role}&'')=0`)
    .join(',');
  // CRITICAL: build as a SINGLE LINE so .replace doesn't mangle spaces inside string literals.
  return [
    `AND(`,
    `NOT({leader_ladder}='Core Leader'),`,
    `NOT({leader_ladder}='Not a prospect'),`,
    `OR({last_attempt_date}=BLANK(),DATETIME_DIFF(TODAY(),{last_attempt_date},'days')>7),`,
    `NOT({last_attempt_result}='Signed up'),`,
    `NOT({signup_6_9_status}='Signed up'),`,
    `NOT({last_attempt_result}='Skipped'),`,
    `NOT({last_attempt_result}='Wrong number'),`,
    `NOT({last_attempt_result}='Do not contact'),`,
    `${schoolExcl},`,
    `${roleExcl}`,
    `${orgClause}`,
    `)`,
  ].join('');
}
const PROSPECTS_FILTER = prospectsFilter();  // legacy default — no organizer filter

async function getProspects(env, url) {
  const n = parseInt(url.searchParams.get('n') || '5');
  const organizer = url.searchParams.get('organizer');
  const filter = prospectsFilter(organizer);
  const fields = ['Name','first','last','phone','email','school','district','log_count','organized_by','leader_ladder'];
  let q = `?filterByFormula=${encodeURIComponent(filter)}&maxRecords=${n}`;
  q += `&sort%5B0%5D%5Bfield%5D=log_count&sort%5B0%5D%5Bdirection%5D=desc`;
  for (const f of fields) q += `&fields%5B%5D=${encodeURIComponent(f)}`;
  const data = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
  return json(data.records.map(r => ({
    id: r.id,
    name: r.fields.Name || `${r.fields.first || ''} ${r.fields.last || ''}`.trim(),
    phone: r.fields.phone || '',
    email: r.fields.email || '',
    school: r.fields.school || '',
    district: r.fields.district || '',
    log_count: r.fields.log_count || 0,
    organized_by_count: (r.fields.organized_by || []).length,
    leader_ladder: r.fields.leader_ladder || '',
  })));
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

function resolveOutcome(outcome, methodCount) {
  switch (outcome) {
    case 'oneonone':         return { result: 'Signed up',  event: '1-1 meeting' };
    case 'signed-up':        // backwards compat — treat as 5/26
    case 'signed-up-5-26':   return { result: 'Signed up',  event: 'Orientation 5/26' };
    case 'signed-up-6-9':    return { result: 'Signed up',  event: '6/9 Emergency Meeting' };
    case 'connected':        return { result: 'Conversation', event: null };
    case 'skipped':          return { result: 'Skipped',     event: null };
    case 'wrong-number':     return { result: 'Wrong number', event: null };
    case 'do-not-contact':   return { result: 'Do not contact', event: null };
    default:                 return { result: methodCount > 0 ? 'No answer' : null, event: null };
  }
}

async function logOutcome(request, env) {
  const body = await request.json();
  const { contact_id, methods = [], outcome, next_step, notes } = body;
  if (!contact_id) return json({ error: 'contact_id required' }, 400);
  const date = todayCT();
  const { result, event } = resolveOutcome(outcome, methods.length);

  const ADMIN_OUTCOMES = ['skipped','wrong-number','do-not-contact'];
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
      }
    }];
  } else {
    records = methods.map(m => {
      const method = METHOD_MAP[m] || m;
      const f = { Summary: `${date} — ${method}`, date, method, contact: [contact_id] };
      if (result) f.result = result;
      if (event) f.event = event;
      if (combinedNotes) f.notes = combinedNotes;
      return { fields: f };
    });
  }

  const created = await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, {
    method: 'POST',
    body: JSON.stringify({ records, typecast: true })
  });

  // last_attempt_result on the CONTACT gates the Today queue (signups skip the
  // 7-day re-call cycle) and the 5/26 confirm queue (last_attempt_result='Signed up').
  // For a 6/9 signup we DON'T want them in the 5/26 confirm queue, so override
  // to 'Conversation' — still keeps them out of the Today re-call rotation.
  const contactLastResult = (outcome === 'signed-up-6-9') ? 'Conversation' : result;
  const contactFields = {
    last_attempt_date: date,
    last_attempt_method: isAdmin ? 'Other' : (METHOD_MAP[methods[0]] || methods[0]),
    last_attempt_result: contactLastResult,
  };
  // Event-specific denormalized status field — so each event has its own
  // confirm queue without colliding on last_attempt_result.
  if (outcome === 'signed-up-6-9') {
    contactFields.signup_6_9_status = 'Signed up';
  }
  if (next_step) contactFields.next_step = next_step;
  await at(env, `/${BASE}/${CONTACTS_TBL}/${contact_id}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: contactFields, typecast: true })
  });

  let confirmation_email_sent = false;
  if (AUTO_CONFIRM_EMAIL && (outcome === 'signed-up' || outcome === 'signed-up-5-26' || outcome === 'signed-up-6-9')) {
    const eventKey = outcome === 'signed-up-6-9' ? '6_9' : '5_26';
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
};

async function sendConfirmationEmail(env, toEmail, firstName, contactId, organizer, eventKey) {
  const date = todayCT();
  const safeName = firstName ? firstName : '';
  const greetingComma = safeName ? `, ${escapeHtml(safeName)}` : '';
  const profile = ORGANIZER_PROFILE[String(organizer || '').toLowerCase()] || ORGANIZER_PROFILE['lanee'];
  const replyTo = profile.reply_to;
  const signoffName = profile.name;
  const signoffGroup = profile.group;
  const ev = EMAIL_EVENTS[String(eventKey || '5_26')] || EMAIL_EVENTS['5_26'];
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

        <tr><td style="padding:0 0 28px">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td width="44" style="padding-right:14px;vertical-align:middle">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr><td width="44" height="44" bgcolor="#B25048" style="background:#B25048;border-radius:22px" align="center">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr><td width="32" height="32" bgcolor="#C99633" style="background:#C99633;border-radius:16px" align="center">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                          <tr><td width="16" height="16" bgcolor="#E9E5CE" style="background:#E9E5CE;border-radius:8px"></td></tr>
                        </table>
                      </td></tr>
                    </table>
                  </td></tr>
                </table>
              </td>
              <td style="vertical-align:middle;font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:16px;line-height:1.15;text-transform:uppercase;letter-spacing:.01em;color:#1A2418">
                Parents for Missouri<br/>Public Schools
              </td>
            </tr>
          </table>
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
                On Zoom
              </div>
              <div style="margin:18px 0 0">
                <a href="${ev.zoom_link}" style="display:inline-block;background:#1A2418;color:#E9E5CE;text-decoration:none;font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:14px;text-transform:uppercase;letter-spacing:.06em;padding:13px 20px;border-radius:8px">Open the Zoom link →</a>
              </div>
              <div style="margin:10px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#1A2418;opacity:.65;word-break:break-all">
                ${ev.zoom_link}
              </div>
            </td></tr>
          </table>
        </td></tr>

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
  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_CONFIRM, to: [toEmail], reply_to: replyTo, subject, html }),
  });
  if (!emailRes.ok) throw new Error(`email send failed: ${await emailRes.text()}`);

  await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, {
    method: 'POST',
    body: JSON.stringify({
      records: [{
        fields: {
          Summary: `${date} — Email (auto Zoom confirm)`,
          date,
          method: 'Email',
          result: 'Reminder sent',
          event: CONFIRM_EVENT,
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
  await at(env, `/${BASE}/${CONTACTS_TBL}/${contact_id}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: {
      last_attempt_date: null, last_attempt_method: null,
      last_attempt_result: null, next_step: '',
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
  const signupClause = eventParam === '6_9'
    ? `{signup_6_9_status}='Signed up'`
    : `{last_attempt_result}='Signed up'`;
  const orgFullName = organizerName(organizer);
  const filter = orgFullName
    ? `AND(${signupClause},FIND('${orgFullName}',{assigned_organizer}&'')>0)`
    : signupClause;
  const fields = ['Name','first','last','phone','email','school','district','last_attempt_date','source','signup_6_9_status'];
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
  const lf = `{event}='${CONFIRM_EVENT}'`;
  do {
    let lq = `?filterByFormula=${encodeURIComponent(lf)}&pageSize=100&fields%5B%5D=contact&fields%5B%5D=method&fields%5B%5D=result&fields%5B%5D=date`;
    if (offset) lq += `&offset=${offset}`;
    const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${lq}`);
    confirmLogs.push(...d.records);
    offset = d.offset;
  } while (offset);

  // Attendance logs (Orientation 5/26 + method='Event attendance' + result='Attended' or 'No-show')
  const attendanceByContact = {};
  const af = `AND({event}='Orientation 5/26',{method}='Event attendance',OR({result}='Attended',{result}='No-show',{result}='Walk-in'))`;
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
    attendance: attendanceByContact[r.id]?.result || null,
    signup_6_9: r.fields.signup_6_9_status || null,
  }));
  await cachePut(env, cacheKey, payload);
  return json(payload);
}

async function confirmLog(request, env) {
  const body = await request.json();
  const { contact_id, methods = [], status = null, notes = '', signup_6_9 = null } = body;
  if (!contact_id) return json({ error: 'contact_id required' }, 400);
  const ALLOWED_STATUSES = [null, '', 'Confirmed', 'No answer', 'Declined', 'Cancelled', 'Reminder sent'];
  if (!ALLOWED_STATUSES.includes(status)) return json({ error: 'invalid status' }, 400);
  const ALLOWED_6_9 = [null, '', 'Signed up', 'Maybe', 'Not interested'];
  if (!ALLOWED_6_9.includes(signup_6_9)) return json({ error: 'invalid signup_6_9' }, 400);
  if (!methods.length && !status && !signup_6_9) return json({ error: 'no methods or status' }, 400);
  const date = todayCT();
  const result = status || 'Reminder sent';

  const dupFilter = `AND({date}=DATETIME_PARSE('${date}'),{event}='${CONFIRM_EVENT}')`;
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
      Summary: `${date} — ${method} (5/26 confirm)`,
      date, method, result,
      event: CONFIRM_EVENT,
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
        body: JSON.stringify({ fields: { confirm_5_26_status: status }, typecast: true }),
      });
    } catch (e) { /* field may not exist yet — non-fatal */ }
  }
  // 6/9 emergency meeting tracking
  if (signup_6_9) {
    try {
      await at(env, `/${BASE}/${CONTACTS_TBL}/${contact_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: { signup_6_9_status: signup_6_9 }, typecast: true }),
      });
      // Log it as an outreach record so we have history
      await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, {
        method: 'POST',
        body: JSON.stringify({
          records: [{ fields: {
            Summary: `${date} — 6/9 invite: ${signup_6_9}`,
            date,
            method: 'Other',
            result: signup_6_9,
            event: '6/9 Emergency Meeting',
            contact: [contact_id],
          }}],
          typecast: true,
        }),
      });
    } catch (e) { /* non-fatal */ }
  }
  await invalidateReadCaches(env);
  return json({ ok: true, created_count: created.records.length, status: result, signup_6_9 });
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
  if (body.website && String(body.website).trim()) return json({ error: 'bot detected' }, 400);
  const { event_id, first, last, phone, email, school, district, city, zip, notes } = body;
  if (!event_id || !event_id.startsWith('rec')) return json({ error: 'event_id required' }, 400);
  if (!first || !last || !email) return json({ error: 'first, last, and email are required' }, 400);

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
  const cEmail = String(email).toLowerCase().trim();
  const cPhone = phone ? String(phone).trim() : '';

  // Dedupe by email then phone
  let existingId = null;
  const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`LOWER({email})='${cEmail}'`)}&maxRecords=1`);
  if (r.records.length > 0) existingId = r.records[0].id;
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
  const { contact_id, attended } = body;
  if (!contact_id) return json({ error: 'contact_id required' }, 400);
  // attended: true → Attended, false → No-show, null → clear (delete only)
  if (attended !== true && attended !== false && attended !== null) {
    return json({ error: 'attended must be true, false, or null' }, 400);
  }
  const date = todayCT();

  // Delete any prior attendance log for this contact for the 5/26 event
  const dupFilter = `AND({event}='Orientation 5/26',{method}='Event attendance',OR({result}='Attended',{result}='No-show'))`;
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
        body: JSON.stringify({ fields: { attendance_5_26_status: null }, typecast: true }),
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
        Summary: `${date} — ${result} (5/26 orientation)`,
        date,
        method: 'Event attendance',
        result,
        event: 'Orientation 5/26',
        contact: [contact_id],
      }}],
      typecast: true,
    }),
  });
  // Patch the denormalized status field too
  try {
    await at(env, `/${BASE}/${CONTACTS_TBL}/${contact_id}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: { attendance_5_26_status: result }, typecast: true }),
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
      source: 'walk-in 5/26',
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
        Summary: `${date} — Walk-in (5/26 orientation)`,
        date,
        method: 'Event attendance',
        result: 'Attended',
        event: 'Orientation 5/26',
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
      body: JSON.stringify({ fields: { attendance_5_26_status: 'Walk-in' }, typecast: true }),
    });
  } catch (e) {}

  await invalidateReadCaches(env);
  return json({ ok: true, contact_id: contactId, created, matched_existing: !created, existing_name: existingName });
}
