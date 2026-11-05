// voice.js: spoken lines for the people at the safe house (visitors.js): grandma (ammamma), the two friends and the
// villagers who drop in. Telugu village speech through the browser's Web Speech API (no voice is cloned from anyone):
//   te-IN voice installed  -> the line in Telugu script
//   else hi-IN voice       -> the same Telugu line transliterated letter-for-letter into Devanagari (the two scripts
//                             share one ISCII layout), so a Hindi voice pronounces the Telugu words, not English ones
//   else en-IN / any voice -> the romanised line
// Each speaker gets its own rate / pitch (grandma slower, softer, higher; friends quick and casual).
// Optional recordings: assets/voices/<speaker>/<line-id>.mp3 is played instead of TTS when it exists (see the README in
// that folder). One line plays at a time (a queue, so speakers never talk over each other), only when the listener
// (the player) is within ~10 m, with distance-based volume. Silent lines (too far / no speech support) still run their
// callbacks on a timer so conversations and speech bubbles keep their rhythm.
// API: Voice.say(speaker, lineId, { pos: () => ({x,z}), onStart(line), onEnd(), prio }) · Voice.level(speaker) 0..1
//      (mouth opening while speaking) · Voice.speaking(speaker) · Voice.LINES · Voice.voices() · Voice.report()
//      Voice.next(pool) picks a line id from Voice.POOLS without repeats (memory in localStorage)
(function () {
  'use strict';
  const HEAR = 8, FULL = 4;                // metres: full volume up to 4 m, fading to nothing at 8 m; beyond, silent
  // speechSynthesis has no spatial audio and fixes the volume when an utterance starts: lines only start inside the
  // range, a running TTS line is cancelled once the listener moves out of it, recorded clips fade live
  const volAt = d => d <= FULL ? 1 : d >= HEAR ? 0 : 1 - (d - FULL) / (HEAR - FULL);
  const L = {
    // ---- passengers (jobs.js)
    px_thanks: ['చాలా థాంక్స్ అన్నా.', 'Chala thanks anna.'],
    px_slow: ['నెమ్మదిగా పోనీయి అన్నా!', 'Nemmadiga poniyi anna!'],
    px_good: ['బాగా నడిపావు, ఇది ఉంచుకో.', 'Baaga nadipavu, idi unchuko.'],
    px_stop: ['రైట్ రైట్! ఇక్కడ ఆపండి.', 'Right right! Ikkada aapandi.'],
    // ---- grandma (ammamma)
    gm_hello: ['వచ్చావా నాన్నా! బాగున్నావా?', 'Vachava nanna! Baagunnava?'],
    gm_eat: ['అన్నం తిన్నావా నాన్నా?', 'Annam tinnava nanna?'],
    gm_eat2: ['రా, కూర్చో. అన్నం పెడతాను.', 'Raa, koorcho. Annam pedatanu.'],
    gm_tiffin: ['టిఫిన్ చేశావా రా?', 'Tiffin chesava ra?'],
    gm_tea: ['టీ తాగుతావా కన్నా?', 'Tea taagutava kanna?'],
    gm_night: ['ఇంత రాత్రి ఎక్కడ తిరుగుతున్నావ్ రా? పడుకో రా.', 'Inta raatri ekkada tirugutunnav ra? Paduko ra.'],
    gm_listen: ['అమ్మ చెప్పిన మాట విను.', 'Amma cheppina maata vinu.'],
    gm_bye3: ['జాగ్రత్తగా వెళ్ళు.', 'Jaagratha ga vellu.'],
    gm_car: ['కారులో వచ్చావా? జాగ్రత్తగా నడుపు రా.', 'Kaarulo vachava? Jaagratha ga nadupu ra.'],
    gm_bike: ['బండి మీద వచ్చావా? హెల్మెట్ పెట్టుకో రా.', 'Bandi meeda vachava? Helmet pettuko ra.'],
    gm_walk: ['నడిచి వచ్చావా? కాళ్ళు నొప్పి లేవా?', 'Nadichi vachava? Kaallu noppi leva?'],
    gm_sit: ['రా కన్నా, కొంచెం కూర్చో.', 'Raa kanna, koncham koorcho.'],
    gm_where: ['ఇంత వరకు ఎక్కడ తిరిగావ్ రా?', 'Inta varaku ekkada tirigav ra?'],
    gm_sun: ['ఎండ ఎక్కువగా ఉంది, నీళ్ళు తాగు.', 'Enda ekkuvaga undi, neellu taagu.'],
    gm_friends: ['నీ ఫ్రెండ్స్ వచ్చారు రా, టీ ఇస్తాను.', 'Nee friends vachaaru ra, tea istanu.'],
    gm_bless: ['దేవుడు నిన్ను చల్లగా చూడాలి.', 'Devudu ninnu challaga choodali.'],
    gm_bye: ['జాగ్రత్తగా వెళ్ళు నాన్నా.', 'Jaagratha ga vellu nanna.'],
    gm_bye2: ['తొందరగా ఇంటికి రా, సరేనా?', 'Tondaraga intiki raa, sarena?'],
    gm_water: ['ఎండలో తిరిగావు, ఈ నీళ్ళు తాగు.', 'Endalo tirigavu, ee neellu taagu.'],
    gm_q_tea: ['టీ పెట్టనా నాన్నా?', 'Tea pettana nanna?'],
    gm_q_food: ['అన్నం వడ్డించనా?', 'Annam vaddinchana?'],
    gm_q_water: ['మంచి నీళ్ళు ఇవ్వనా?', 'Manchi neellu ivvana?'],
    gm_ok_tea: ['సరే, ఇప్పుడే వేడి టీ తెస్తాను.', 'Sare, ippude vedi tea testanu.'],
    gm_ok_food: ['కూర్చో, వేడి వేడిగా పెడతాను.', 'Koorcho, vedi vediga pedatanu.'],
    gm_ok_water: ['ఇదిగో, చల్లటి కుండ నీళ్ళు.', 'Idigo, challati kunda neellu.'],
    gm_no: ['సరే నాన్నా, ఆకలైతే చెప్పు.', 'Sare nanna, aakalaithe cheppu.'],
    gm_later: ['సరే, తర్వాత చేద్దాం.', 'Sare, tarvaatha cheddam.'],
    gm_q_temple: ['శివాలయానికి వెళ్ళావా? దేవుడికి దండం పెట్టి రా.', 'Shivaalayaniki vellava? Devudiki dandam petti raa.'],
    gm_temple_go: ['మంచిది, జాగ్రత్తగా వెళ్ళి రా.', 'Manchidi, jaagrathaga velli raa.'],
    gm_temple_no: ['తప్పకుండా వెళ్ళు రా, ఈ రోజు మంచి రోజు.', 'Tappakunda vellu ra, ee roju manchi roju.'],
    gm_crash: ['అయ్యో! ఏమైంది రా? దెబ్బ తగిలిందా?', 'Ayyo! Emaindi ra? Debba tagilinda?'],
    gm_horn: ['ఎందుకు రా అంత హారన్? చుట్టుపక్కల వాళ్ళు ఏమనుకుంటారు?', 'Enduku ra antha horn? Chuttupakkala vaallu emanukuntaru?'],
    gm_nightdrive: ['రాత్రి పూట బండి నడపకు రా, నాకు భయం ఏస్తుంది.', 'Raatri poota bandi nadapaku ra, naaku bhayam estundi.'],
    gm_morning: ['పొద్దున్నే లేచావా? మంచిది.', 'Poddunne lechava? Manchidi.'],
    gm_evening: ['సాయంత్రం దోమలు ఎక్కువ, లోపలికి రా.', 'Saayantram domalu ekkuva, lopaliki raa.'],
    gm_hot: ['ఈ ఎండకి బయట తిరగకు, తల తిరుగుతుంది.', 'Ee endaki bayata tiragaku, tala tirugutundi.'],
    gm_tractor: ['ట్రాక్టర్ తో వచ్చావా! పొలం పని అయిందా?', 'Tractor tho vachava! Polam pani ayinda?'],
    gm_innova: ['మన ఇన్నోవా బాగా కడుగు రా, దుమ్ము పట్టింది.', 'Mana Innova baaga kadugu ra, dummu pattindi.'],
    // ---- friends
    fr_q_race: ['మామా, హైవే దాకా రేస్ పెడదామా?', 'Mama, highway daaka race pedadama?'],
    fr_q_tank: ['చెరువు దాకా ఒక రైడ్ వెళ్దామా?', 'Cheruvu daaka oka ride veldama?'],
    fr_q_cricket: ['సాయంత్రం గ్రౌండ్ లో క్రికెట్ ఆడదామా?', 'Saayantram ground lo cricket aadadama?'],
    fr_go: ['సూపర్! చలో, బండి తీయ్!', 'Super! Chalo, bandi tiy!'],
    fr_no: ['సరే లే మామా, ఇంకోసారి.', 'Sare le mama, inkosaari.'],
    fr_later: ['సరే, తర్వాత కాల్ చెయ్.', 'Sare, tarvaatha call chey.'],
    fr_crash: ['అరేయ్! బండి గుద్దేశావా? హహ!', 'Arey! Bandi guddesava? Haha!'],
    fr_horn: ['హారన్ ఆపు రా బాబూ!', 'Horn aapu ra baabu!'],
    fr_night: ['ఇంత రాత్రి ఎక్కడికి రా మామా?', 'Inta raatri ekkadiki ra mama?'],
    fr_morning: ['పొద్దున్నే ఏంటి రా ఈ హడావిడి?', 'Poddunne enti ra ee hadavidi?'],
    fr_hungry: ['ఆకలేస్తోంది మామా, బిర్యానీ తిందామా?', 'Aakalestondi mama, biryani tindama?'],
    fr_hey: ['ఏయ్ మామా! ఎలా ఉన్నావ్ రా?', 'Ey mama! Ela unnav ra?'],
    fr_hello: ['హే మామా, హలో!', 'Hey mama, hello!'],
    fr_car: ['బండి సూపర్ గా ఉంది రా!', 'Bandi super ga undi ra!'],
    fr_cinema: ['సాయంత్రం సినిమాకి వెళ్దామా?', 'Saayantram cinema ki veldama?'],
    fr_pulihora: ['అమ్మమ్మ చేసిన పులిహోర అదిరింది!', 'Ammamma chesina pulihora adhirindi!'],
    fr_round: ['చలో, ఒక రౌండ్ కొడదాం రా!', 'Chalo, oka round kodadam ra!'],
    fr_cricket: ['రేపు క్రికెట్ మ్యాచ్ ఉంది, రా మామా.', 'Repu cricket match undi, raa mama.'],
    fr_tease: ['నువ్వు మారవు రా!', 'Nuvvu maaravu ra!'],
    fr_yes: ['అవును రా, నిజమే.', 'Avunu ra, nijame.'],
    fr_slow: ['అరేయ్, నెమ్మదిగా రా!', 'Arey, nemmadiga raa!'],
    fr_wow: ['అబ్బా, ఏం ఎంట్రీ రా మామా!', 'Abba, em entry ra mama!'],
    fr_bye: ['సరే మామా, మళ్ళీ కలుద్దాం!', 'Sare mama, malli kaluddam!'],
    // ---- generated by context: see POOLS below
    gm_x_dawn0: ['లేచావా నాన్నా? ఇంకా చీకటిగానే ఉంది.', 'Lechava nanna? Inka cheekatigane undi.'],
    gm_x_dawn1: ['కోడి కూయక ముందే లేచావు, ఏమైంది రా?', 'Kodi kooyaka munde lechavu, emaindi ra?'],
    gm_x_dawn2: ['ముఖం కడుక్కో, వేడి కాఫీ ఇస్తాను.', 'Mukham kadukko, vedi coffee istanu.'],
    gm_x_dawn3: ['ఈ చలిగాలిలో బయట తిరగకు రా.', 'Ee chaligaalilo bayata tiragaku ra.'],
    gm_x_dawn4: ['వాకిలి ఊడ్చి ముగ్గు వేస్తున్నాను, ఆగు.', 'Vaakili oodchi muggu vestunnanu, aagu.'],
    gm_x_dawn5: ['పొద్దున్నే దేవుడికి దండం పెట్టుకో.', 'Poddunne devudiki dandam pettuko.'],
    gm_x_morn0: ['ఇడ్లీ వేడిగా ఉంది, రెండు తిను.', 'Idli vediga undi, rendu tinu.'],
    gm_x_morn1: ['ఉప్మా చేశాను, కారం పొడి వేసుకో.', 'Upma chesanu, kaaram podi vesuko.'],
    gm_x_morn2: ['పొద్దున్నే ఎక్కడికి బయలుదేరావు రా?', 'Poddunne ekkadiki bayaluderavu ra?'],
    gm_x_morn3: ['ఖాళీ కడుపుతో వెళ్ళకు నాన్నా.', 'Khaali kaduputho vellaku nanna.'],
    gm_x_morn4: ['పాలవాడు ఇంకా రాలేదు రా.', 'Paalavaadu inka raaledu ra.'],
    gm_x_morn5: ['దోశ వేస్తాను, ఐదు నిమిషాలు కూర్చో.', 'Dosa vestanu, aidu nimishalu koorcho.'],
    gm_x_morn6: ['బడికి వెళ్ళే పిల్లలు ఉన్నారు, నెమ్మదిగా వెళ్ళు.', 'Badiki velle pillalu unnaru, nemmadiga vellu.'],
    gm_x_noon0: ['మధ్యాహ్నం అయింది, ఇంకా తినలేదా?', 'Madhyahnam ayindi, inka tinaleda?'],
    gm_x_noon1: ['పప్పు, ఆవకాయ ఉన్నాయి. కలుపుకుని తిను.', 'Pappu, aavakaya unnayi. Kalupukuni tinu.'],
    gm_x_noon2: ['ఈ ఎండలో ఎక్కడికి రా? కాసేపు నీడన కూర్చో.', 'Ee endalo ekkadiki ra? Kaasepu needana koorcho.'],
    gm_x_noon3: ['మజ్జిగ తాగు, ఒంటికి చల్లగా ఉంటుంది.', 'Majjiga taagu, ontiki challaga untundi.'],
    gm_x_noon4: ['తలకి తువ్వాలు కట్టుకో రా.', 'Talaki tuvvaalu kattuko ra.'],
    gm_x_noon5: ['కొంచెం పడుకుని లే, తర్వాత వెళ్దువు.', 'Koncham padukuni le, tarvaatha velduvu.'],
    gm_x_noon6: ['వేడి వేడి అన్నంలో నెయ్యి వేసి పెడతాను.', 'Vedi vedi annamlo neyyi vesi pedatanu.'],
    gm_x_aftn0: ['టీ టైమ్ అయింది, బిస్కెట్లు ఉన్నాయి తీసుకో.', 'Tea time ayindi, biscuits unnayi teesuko.'],
    gm_x_aftn1: ['మిరపకాయ బజ్జీలు చేయనా రా?', 'Mirapakaya bajjilu cheyana ra?'],
    gm_x_aftn2: ['పిల్లలు బడి నుంచి వచ్చే వేళ అయింది.', 'Pillalu badi nunchi vachhe vela ayindi.'],
    gm_x_aftn3: ['పొద్దు వాలుతోంది, ఎక్కువ దూరం వెళ్ళకు.', 'Poddu vaalutondi, ekkuva dooram vellaku.'],
    gm_x_aftn4: ['కాసేపు నా దగ్గర కూర్చో రా, మాట్లాడదాం.', 'Kaasepu naa daggara koorcho ra, maatladadam.'],
    gm_x_aftn5: ['బొబ్బర్లు గుగ్గిళ్ళు ఉడికించాను, తిను.', 'Bobbarlu guggillu udikinchanu, tinu.'],
    gm_x_eve0: ['దీపం పెట్టే వేళ అయింది, ఇంటికి రా.', 'Deepam pette vela ayindi, intiki raa.'],
    gm_x_eve1: ['చీకటి పడుతోంది, బండి లైట్లు వేసుకో.', 'Cheekati padutondi, bandi lights vesuko.'],
    gm_x_eve2: ['పశువులు ఇంటికి వచ్చే వేళ, రోడ్డు మీద జాగ్రత్త.', 'Pashuvulu intiki vachhe vela, roddu meeda jaagratha.'],
    gm_x_eve3: ['రాత్రికి పచ్చి పులుసు చేస్తున్నా, తిని వెళ్ళు.', 'Raatriki pachi pulusu chestunna, tini vellu.'],
    gm_x_eve4: ['చేతులు కాళ్ళు కడుక్కుని లోపలికి రా.', 'Chetulu kaallu kadukkuni lopaliki raa.'],
    gm_x_eve5: ['గుడిలో గంట మోగుతోంది విన్నావా?', 'Gudilo ganta mogutondi vinnava?'],
    gm_x_night0: ['అన్నం తిని పడుకో, రేపు మాట్లాడుకుందాం.', 'Annam tini paduko, repu maatladukundam.'],
    gm_x_night1: ['నీ కోసమే మేలుకొని ఉన్నా రా.', 'Nee kosame melukoni unna ra.'],
    gm_x_night2: ['తలుపు వేసుకో నాన్నా, కుక్కలు మొరుగుతున్నాయి.', 'Talupu vesuko nanna, kukkalu moruguthunnayi.'],
    gm_x_night3: ['ఫోన్ పక్కన పెట్టి నిద్రపో రా.', 'Phone pakkana petti nidrapo ra.'],
    gm_x_night4: ['ఈ వేళప్పుడు బయటకు వెళ్ళకు, నా మాట విను.', 'Ee velappudu bayataku vellaku, naa maata vinu.'],
    gm_x_night5: ['పాలు వేడి చేసి ఇస్తాను, తాగి పడుకో.', 'Paalu vedi chesi istanu, taagi paduko.'],
    gm_x_night6: ['చంద్రుడు ఎంత బాగున్నాడో చూడు రా.', 'Chandrudu entha baagunnado choodu ra.'],
    gm_x_bike0: ['బండి మీద అంత వేగం వద్దు రా.', 'Bandi meeda antha vegam vaddu ra.'],
    gm_x_bike1: ['కొత్త బండా? ఎవరిది రా ఇది?', 'Kotha banda? Evaridi ra idi?'],
    gm_x_bike2: ['రోడ్డు మీద గుంతలు ఉన్నాయి, చూసి నడుపు.', 'Roddu meeda guntalu unnayi, choosi nadupu.'],
    gm_x_bike3: ['దుమ్ముకొట్టుకుపోయావు, ముఖం కడుక్కో.', 'Dummukottukupoyavu, mukham kadukko.'],
    gm_x_bike4: ['ఈ బండి చప్పుడు ఊరంతా వినిపిస్తోంది రా!', 'Ee bandi chappudu oorantha vinipistondi ra!'],
    gm_x_car0: ['ఇంత పెద్ద కారు ఎవరిది రా?', 'Inta pedda kaaru evaridi ra?'],
    gm_x_car1: ['కారు నీడలో పెట్టు, ఎండకు కాలిపోతుంది.', 'Kaaru needalo pettu, endaku kaalipotundi.'],
    gm_x_car2: ['సీట్ బెల్ట్ పెట్టుకుంటున్నావా రా?', 'Seat belt pettukuntunnava ra?'],
    gm_x_car3: ['డీజిల్ రేట్లు పెరిగాయి, తిప్పకు ఊరికే.', 'Diesel rates perigayi, tippaku oorike.'],
    gm_x_car4: ['నన్ను ఎప్పుడు గుడికి తీసుకెళ్తావు ఈ కారులో?', 'Nannu eppudu gudiki teesukeltavu ee kaarulo?'],
    gm_x_innova0: ['ఇన్నోవాలో అందరినీ గుడికి తీసుకెళ్దాం రా.', 'Innova lo andarini gudiki teesukeldam ra.'],
    gm_x_innova1: ['మన బండి ఊర్లో అందరికీ తెలుసు, జాగ్రత్త.', 'Mana bandi oorlo andariki telusu, jaagratha.'],
    gm_x_innova2: ['గేటు మెల్లగా తీయి, గోడకు తగలనివ్వకు.', 'Gate mellaga teeyi, godaku taganivvaku.'],
    gm_x_tractor0: ['పొలం దున్ని వచ్చావా? అలసిపోయావా రా?', 'Polam dunni vachava? Alasipoyava ra?'],
    gm_x_tractor1: ['ట్రాక్టర్ మట్టి వాకిట్లో వేయకు రా.', 'Tractor matti vaakitlo veyaku ra.'],
    gm_x_tractor2: ['విత్తనాలు వేశారా? వాన పడితే బాగుండు.', 'Vittanalu vesara? Vaana padithe baagundu.'],
    gm_x_walk0: ['బండి లేకుండా ఎంత దూరం నడిచావు రా?', 'Bandi lekunda entha dooram nadichavu ra?'],
    gm_x_walk1: ['చెప్పులు వేసుకో, ముళ్ళు ఉంటాయి.', 'Cheppulu vesuko, mullu untayi.'],
    gm_x_walk2: ['ఊరంతా తిరిగి వచ్చావా? ఏం విశేషాలు?', 'Oorantha tirigi vachava? Em visheshalu?'],
    gm_x_walk3: ['అలసిపోయావు, కాళ్ళు కడుక్కొని కూర్చో.', 'Alasipoyavu, kaallu kadukkoni koorcho.'],
    gm_x_crash0: ['మళ్ళీ గుద్దావా? నీతో వేగలేను రా!', 'Malli guddava? Neetho vegalenu ra!'],
    gm_x_crash1: ['బండి పోతే పోయింది, నీకు ఏమీ కాలేదు కదా?', 'Bandi pothe poyindi, neeku emi kaaledu kada?'],
    gm_x_crash2: ['చూపించు ఎక్కడ తగిలింది? పసుపు రాస్తాను.', 'Choopinchu ekkada tagilindi? Pasupu raastanu.'],
    gm_x_crash3: ['అంత వేగం ఎందుకు రా? గుండె ఆగిపోయింది నాకు.', 'Antha vegam enduku ra? Gunde aagipoyindi naaku.'],
    gm_x_crash4: ['దిష్టి తీయాలి నీకు, ఆగు.', 'Dishti teeyali neeku, aagu.'],
    gm_x_horn0: ['చెవులు పగిలిపోతున్నాయి రా!', 'Chevulu pagilipotunnayi ra!'],
    gm_x_horn1: ['నేను ఇక్కడే ఉన్నా, హారన్ ఎందుకు?', 'Nenu ikkade unna, horn enduku?'],
    gm_x_horn2: ['పక్కింటి పిల్లాడు నిద్రపోతున్నాడు రా.', 'Pakkinti pillaadu nidrapotunnadu ra.'],
    gm_x_horn3: ['ఆవులు బెదిరిపోతాయి, ఆపు రా.', 'Aavulu bediripotayi, aapu ra.'],
    gm_x_speed0: ['అంత వేగంగా వచ్చావేంటి రా? కోళ్ళు పరిగెత్తాయి!', 'Antha vegamga vachaventi ra? Kollu parigettayi!'],
    gm_x_speed1: ['ఊర్లో నెమ్మదిగా నడపాలని ఎన్నిసార్లు చెప్పాలి?', 'Oorlo nemmadiga nadapalani ennisarlu cheppali?'],
    gm_x_speed2: ['దుమ్ము లేపుకుంటూ వచ్చావు, బట్టలు పాడయ్యాయి.', 'Dummu lepukuntu vachavu, battalu paadayyayi.'],
    gm_x_away0: ['ఎన్ని రోజులైంది రా నిన్ను చూసి!', 'Enni rojulaindi ra ninnu choosi!'],
    gm_x_away1: ['అమ్మమ్మ గుర్తుందా రా నీకు?', 'Ammamma gurtunda ra neeku?'],
    gm_x_away2: ['చిక్కిపోయావు రా, సరిగ్గా తింటున్నావా?', 'Chikkipoyavu ra, sariggaa tintunnava?'],
    gm_x_away3: ['నీ గురించే అనుకుంటున్నా, వచ్చావు.', 'Nee gurinche anukuntunna, vachavu.'],
    gm_x_general0: ['మీ అమ్మకి ఫోన్ చేశావా రా?', 'Mee ammaki phone chesava ra?'],
    gm_x_general1: ['పెళ్ళి ఎప్పుడు చేసుకుంటావు రా?', 'Pelli eppudu chesukuntavu ra?'],
    gm_x_general2: ['నా కళ్ళద్దాలు ఎక్కడ పెట్టానో చూడు.', 'Naa kalladdalu ekkada pettano choodu.'],
    gm_x_general3: ['మోకాళ్ళ నొప్పులు రా, కూర్చుంటే లేవలేను.', 'Mokaalla noppulu ra, koorchunte levalenu.'],
    gm_x_general4: ['పక్కింటి లక్ష్మి నిన్ను అడిగింది.', 'Pakkinti Lakshmi ninnu adigindi.'],
    gm_x_general5: ['మీ తాతయ్య ఉంటే ఎంత సంతోషించేవారో.', 'Mee thaathayya unte entha santoshinchevaro.'],
    gm_x_general6: ['డబ్బులు ఉన్నాయా రా? దాచినవి ఇస్తాను.', 'Dabbulu unnaya ra? Daachinavi istanu.'],
    gm_x_general7: ['బాగా చదువుకో, పని చేసుకో, మంచి పేరు తెచ్చుకో.', 'Baaga chaduvuko, pani chesuko, manchi peru techukko.'],
    gm_x_general8: ['ఊర్లో ఏం జరిగినా నాకే ముందు తెలుస్తుంది.', 'Oorlo em jarigina naake mundu telustundi.'],
    gm_x_general9: ['కోళ్ళకి గింజలు వేశావా రా?', 'Kollaki ginjalu vesava ra?'],
    gm_x_bye_d0: ['వెళ్ళి వస్తాను అను రా, వెళ్తాను అనకు.', 'Velli vastanu anu ra, veltanu anaku.'],
    gm_x_bye_d1: ['చీకటి పడక ముందే రా.', 'Cheekati padaka munde raa.'],
    gm_x_bye_d2: ['తిన్నగా వెళ్ళి తిన్నగా రా.', 'Tinnaga velli tinnaga raa.'],
    gm_x_bye_d3: ['వచ్చేటప్పుడు కూరగాయలు తీసుకురా.', 'Vachetappudu kooragayalu teesukura.'],
    gm_x_bye_d4: ['గుడి దగ్గర ఆగి దండం పెట్టుకుని వెళ్ళు.', 'Gudi daggara aagi dandam pettukuni vellu.'],
    gm_x_bye_n0: ['ఈ రాత్రి ఎక్కడికి రా? ఉదయం వెళ్ళరాదా?', 'Ee raatri ekkadiki ra? Udayam vellaraada?'],
    gm_x_bye_n1: ['లైట్లు వేసుకుని నెమ్మదిగా వెళ్ళు.', 'Lights vesukuni nemmadiga vellu.'],
    gm_x_bye_n2: ['చేరగానే ఫోన్ చెయ్ రా, నిద్ర పట్టదు నాకు.', 'Cheragane phone chey ra, nidra pattadu naaku.'],
    gm_x_rain0: ['వానలో తడవకు రా, జలుబు చేస్తుంది.', 'Vaanalo tadavaku ra, jalubu chestundi.'],
    gm_x_rain1: ['చెరువు నిండుతోంది, అటు వెళ్ళకు.', 'Cheruvu nindutondi, atu vellaku.'],
    gm_x_rain2: ['పొలాల్లో నాట్లు వేస్తున్నారు చూశావా?', 'Polallo naatlu vestunnaru choosava?'],
    gm_x_cold0: ['చలి పెరిగింది, దుప్పటి కప్పుకో.', 'Chali perigindi, duppati kappuko.'],
    gm_x_cold1: ['కోతలు మొదలయ్యాయి, ఊరంతా పొలాల్లోనే ఉంది.', 'Kotalu modalayyayi, oorantha polallone undi.'],
    gm_x_cold2: ['వేడి నీళ్ళు పెట్టాను, స్నానం చెయ్.', 'Vedi neellu pettanu, snanam chey.'],
    gm_x_summer0: ['మామిడికాయలు తెచ్చాను, పచ్చడి పెడదాం.', 'Mamidikayalu techanu, pachadi pedadam.'],
    gm_x_summer1: ['వడదెబ్బ తగులుతుంది, ఎండలో వెళ్ళకు.', 'Vadadebba tagulutundi, endalo vellaku.'],
    gm_x_summer2: ['కుండలో నీళ్ళు చల్లగా ఉన్నాయి, తాగు.', 'Kundalo neellu challaga unnayi, taagu.'],
    fr_x0: ['మామా, టీ కొట్టు దగ్గరికి వెళ్దామా?', 'Mama, tea kottu daggariki veldama?'],
    fr_x1: ['నిన్న సినిమా చూశావా రా? అదిరింది!', 'Ninna cinema choosava ra? Adhirindi!'],
    fr_x2: ['అమ్మమ్మకి చెప్పకు రా, తిడుతుంది.', 'Ammammaki cheppaku ra, tidutundi.'],
    fr_x3: ['ఈ బండి నాకు ఒక రౌండ్ ఇవ్వు మామా.', 'Ee bandi naaku oka round ivvu mama.'],
    fr_x4: ['పెట్రోల్ డబ్బులు నువ్వే ఇవ్వాలి రా!', 'Petrol dabbulu nuvve ivvali ra!'],
    fr_x5: ['చెరువు దగ్గర చేపలు పడదాం రా.', 'Cheruvu daggara chepalu padadam ra.'],
    // ---- villagers dropping in on grandma (v1_*, v2_*, v3_* are conversations; g lines are grandma's)
    v1_0: ['నమస్కారం, అమ్మమ్మా!', 'Namaskaram, ammamma!'],
    v1_1: ['రా నాన్నా, బాగున్నావా?', 'Raa nanna, baagunnava?'],
    v1_2: ['బాగున్నాను అమ్మమ్మా. మీరు?', 'Baagunnanu ammamma. Meeru?'],
    v1_3: ['ఈ వయసులో ఇంక ఏముంది రా... బాగానే ఉన్నా.', 'Ee vayasulo inka emundi ra... baagane unna.'],
    v1_4: ['పంటలు బాగున్నాయి ఈ సారి!', 'Pantalu baagunnayi ee saari!'],
    v1_5: ['మంచిది. టీ తాగి వెళ్ళు.', 'Manchidi. Tea taagi vellu.'],
    v1_6: ['మళ్ళీ వస్తాను, అమ్మమ్మా!', 'Malli vastanu, ammamma!'],
    v2_0: ['అమ్మమ్మా, నమస్కారం!', 'Ammamma, namaskaram!'],
    v2_1: ['వచ్చావా అమ్మా! పిల్లలు ఎలా ఉన్నారు?', 'Vachava amma! Pillalu ela unnaru?'],
    v2_2: ['అందరూ బాగున్నారు, స్కూల్ కి వెళ్ళారు.', 'Andaru baagunnaru, school ki vellaru.'],
    v2_3: ['సరే సరే. జాగ్రత్తగా ఉండండి.', 'Sare sare. Jaagratha ga undandi.'],
    v2_4: ['ఉంటాను అమ్మమ్మా, వస్తాను!', 'Untanu ammamma, vastanu!'],
    v3_0: ['అమ్మమ్మా, పాలు తెచ్చాను!', 'Ammamma, paalu techanu!'],
    v3_1: ['అయ్యో, ఎందుకు రా అంత శ్రమ?', 'Ayyo, enduku ra antha shrama?'],
    v3_2: ['ఏమీ లేదు అమ్మమ్మా, మా ఆవు బాగా ఇస్తోంది.', 'Emi ledu ammamma, maa aavu baaga istondi.'],
    v3_3: ['దేవుడు చల్లగా చూడాలి నీ కుటుంబాన్ని.', 'Devudu challaga choodali nee kutumbanni.'],
    v3_4: ['వస్తాను అమ్మమ్మా, జాగ్రత్త!', 'Vastanu ammamma, jaagratha!'],
  };
  const LINES = {};
  for (const id in L) LINES[id] = { id, te: L[id][0], tr: L[id][1] };

  // ---------------------------------------------------------------- line selection
  // Pools by context. Voice.next(pool) never repeats a line of a pool until the whole pool has been heard, and also avoids
  // anything heard in the last few lines from any pool. The memory is kept in localStorage, so a reload does not restart it.
  const POOLS = {
    dawn: ['gm_x_dawn0', 'gm_x_dawn1', 'gm_x_dawn2', 'gm_x_dawn3', 'gm_x_dawn4', 'gm_x_dawn5', 'gm_morning'],
    morn: ['gm_x_morn0', 'gm_x_morn1', 'gm_x_morn2', 'gm_x_morn3', 'gm_x_morn4', 'gm_x_morn5', 'gm_x_morn6', 'gm_tiffin', 'gm_hello', 'gm_tea'],
    noon: ['gm_x_noon0', 'gm_x_noon1', 'gm_x_noon2', 'gm_x_noon3', 'gm_x_noon4', 'gm_x_noon5', 'gm_x_noon6', 'gm_eat', 'gm_eat2', 'gm_sun', 'gm_hot', 'gm_water'],
    aftn: ['gm_x_aftn0', 'gm_x_aftn1', 'gm_x_aftn2', 'gm_x_aftn3', 'gm_x_aftn4', 'gm_x_aftn5', 'gm_tea', 'gm_sun'],
    eve: ['gm_x_eve0', 'gm_x_eve1', 'gm_x_eve2', 'gm_x_eve3', 'gm_x_eve4', 'gm_x_eve5', 'gm_evening', 'gm_eat2'],
    night: ['gm_x_night0', 'gm_x_night1', 'gm_x_night2', 'gm_x_night3', 'gm_x_night4', 'gm_x_night5', 'gm_x_night6', 'gm_night', 'gm_nightdrive', 'gm_listen'],
    bike: ['gm_x_bike0', 'gm_x_bike1', 'gm_x_bike2', 'gm_x_bike3', 'gm_x_bike4', 'gm_bike'],
    car: ['gm_x_car0', 'gm_x_car1', 'gm_x_car2', 'gm_x_car3', 'gm_x_car4', 'gm_car'],
    innova: ['gm_x_innova0', 'gm_x_innova1', 'gm_x_innova2', 'gm_innova', 'gm_car'],
    tractor: ['gm_x_tractor0', 'gm_x_tractor1', 'gm_x_tractor2', 'gm_tractor'],
    walk: ['gm_x_walk0', 'gm_x_walk1', 'gm_x_walk2', 'gm_x_walk3', 'gm_walk', 'gm_where'],
    crash: ['gm_x_crash0', 'gm_x_crash1', 'gm_x_crash2', 'gm_x_crash3', 'gm_x_crash4', 'gm_crash'],
    horn: ['gm_x_horn0', 'gm_x_horn1', 'gm_x_horn2', 'gm_x_horn3', 'gm_horn'],
    speed: ['gm_x_speed0', 'gm_x_speed1', 'gm_x_speed2'],
    away: ['gm_x_away0', 'gm_x_away1', 'gm_x_away2', 'gm_x_away3'],
    general: ['gm_x_general0', 'gm_x_general1', 'gm_x_general2', 'gm_x_general3', 'gm_x_general4', 'gm_x_general5', 'gm_x_general6', 'gm_x_general7', 'gm_x_general8', 'gm_x_general9', 'gm_sit', 'gm_bless', 'gm_hello', 'gm_where'],
    bye_d: ['gm_x_bye_d0', 'gm_x_bye_d1', 'gm_x_bye_d2', 'gm_x_bye_d3', 'gm_x_bye_d4', 'gm_bye', 'gm_bye2', 'gm_bye3'],
    bye_n: ['gm_x_bye_n0', 'gm_x_bye_n1', 'gm_x_bye_n2', 'gm_nightdrive', 'gm_bye3'],
    rain: ['gm_x_rain0', 'gm_x_rain1', 'gm_x_rain2'],
    cold: ['gm_x_cold0', 'gm_x_cold1', 'gm_x_cold2'],
    summer: ['gm_x_summer0', 'gm_x_summer1', 'gm_x_summer2'],
    fr: ['fr_x0', 'fr_x1', 'fr_x2', 'fr_x3', 'fr_x4', 'fr_x5', 'fr_round', 'fr_cinema', 'fr_tease', 'fr_pulihora', 'fr_hungry'],
  };
  const MEM_KEY = 'nellutla.voice.mem.v1', RECENT = 14;
  let mem = { used: {}, last: [] };
  try { const m = JSON.parse(localStorage.getItem(MEM_KEY) || 'null'); if (m && m.used && Array.isArray(m.last)) mem = m; } catch (e) {}
  function next(key) {
    const pool = POOLS[key]; if (!pool || !pool.length) return null;
    let used = (mem.used[key] || []).filter(id => pool.includes(id));
    let left = pool.filter(id => !used.includes(id));
    // pool finished: start again, holding back the newest third so the end of one round cannot open the next
    if (!left.length) { used = used.slice(-Math.floor(pool.length / 3)); left = pool.filter(id => !used.includes(id)); }
    const fresh = left.filter(id => !mem.last.includes(id)), from = fresh.length ? fresh : left;
    const id = from[Math.random() * from.length | 0];
    used.push(id); mem.used[key] = used; mark(id);
    return id;
  }
  // record a line chosen outside the pools (answers, questions) so the recent list stays truthful
  function mark(id) {
    mem.last = mem.last.filter(x => x !== id); mem.last.push(id); if (mem.last.length > RECENT) mem.last.shift();
    try { localStorage.setItem(MEM_KEY, JSON.stringify(mem)); } catch (e) {}
  }

  // speaker profiles: gender for voice choice, base rate / pitch / volume
  const PROFILE = {
    ammamma: { g: 'f', rate: 0.8, pitch: 1.3, vol: 0.8 },
    // male speakers are strict: a male voice in any language (male te-IN if installed, else e.g. Rishi en-IN reading
    // the romanised Telugu) rather than a Telugu female voice pitched down
    friend1: { g: 'm', rate: 1.12, pitch: 1.08, vol: 1, strict: true },    // quick, bright, the joker
    friend2: { g: 'm', rate: 0.93, pitch: 0.78, vol: 1, strict: true },    // slower, deeper
    villager_m: { g: 'm', rate: 0.97, pitch: 0.92, vol: 0.9, strict: true },
    villager_f: { g: 'f', rate: 0.95, pitch: 1.1, vol: 0.9 },
  };
  const FEMALE = /lekha|veena|isha|kiyara|kajal|priya|shruti|geeta|swara|neerja|aditi|raveena|female|woman|zira|samantha|karen|moira|tessa|fiona|victoria|serena|kate/i;
  const MALE = /rishi|aman|hemant|prabhat|ravi|madhur|male|man\b|daniel|alex|fred|tom|aaron|arthur|oliver|rocko|eddy|reed/i;

  const synth = typeof window !== 'undefined' && window.speechSynthesis ? window.speechSynthesis : null;
  let VOICES = [];
  function loadVoices() { if (synth) { try { VOICES = synth.getVoices() || []; } catch (e) { VOICES = []; } } }
  loadVoices(); if (synth && synth.addEventListener) synth.addEventListener('voiceschanged', loadVoices);
  // the best installed voice for a speaker: language te-IN > hi-IN > en-IN > any en, then gender by name
  const pickCache = {};
  function pick(spk) {
    if (pickCache[spk] && VOICES.includes(pickCache[spk].v)) return pickCache[spk];
    const g = (PROFILE[spk] || {}).g || 'm';
    const tiers = [v => /^te/i.test(v.lang), v => /^hi/i.test(v.lang), v => /en[-_]IN/i.test(v.lang), v => /^en/i.test(v.lang), () => true];
    const strict = (PROFILE[spk] || {}).strict && VOICES.some(v => /^(te|hi|en)/i.test(v.lang) && (g === 'f' ? FEMALE : MALE).test(v.name));
    for (const t of tiers) {
      let c = VOICES.filter(t); if (strict) c = c.filter(v => (g === 'f' ? FEMALE : MALE).test(v.name)); if (!c.length) continue;
      const same = c.filter(v => (g === 'f' ? FEMALE : MALE).test(v.name)), other = c.filter(v => (g === 'f' ? MALE : FEMALE).test(v.name));
      // two friends: give them different voices when the tier has more than one of their gender
      let list = same.length ? same : c.filter(v => !other.includes(v)).length ? c.filter(v => !other.includes(v)) : c;
      const idx = spk === 'friend2' && list.length > 1 ? 1 : 0;
      const v = list[idx], lang = (v.lang || '').toLowerCase();
      const mode = lang.startsWith('te') ? 'te' : lang.startsWith('hi') ? 'deva' : 'tr';
      // a voice of the other gender (only one installed): shift pitch so grandma still sounds like an old lady
      const mismatch = !same.length && (g === 'f' ? MALE : FEMALE).test(v.name);
      return (pickCache[spk] = { v, mode, mismatch });
    }
    return null;
  }
  // Telugu -> Devanagari (parallel ISCII blocks, 0x0C00 -> 0x0900); short e / o have no common Hindi letter: use long
  function teToDeva(s) {
    let o = '';
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if (c < 0x0C00 || c > 0x0C7F) { o += ch; continue; }
      const m = { 0x0C0E: 0x090F, 0x0C12: 0x0913, 0x0C46: 0x0947, 0x0C4A: 0x094B, 0x0C31: 0x0930, 0x0C33: 0x0933 }[c];
      o += String.fromCodePoint(m || c - 0x300);
    }
    return o;
  }
  const textFor = (line, mode) => mode === 'te' ? line.te : mode === 'deva' ? teToDeva(line.te) : line.tr;

  // ---------------------------------------------------------------- optional recorded clips
  // Which clips exist: assets/voices/manifest.json ({ "ammamma": ["gm_eat", ...], ... }) if present, else the speaker
  // folder's directory listing (dev servers list folders), else no clips for that speaker. At most one request per
  // speaker, so missing recordings don't spam 404s.
  let manifest = null;
  const folders = {};
  const manifestP = fetch('assets/voices/manifest.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null).then(m => (manifest = m));
  function clipsOf(spk) {
    if (folders[spk]) return folders[spk];
    return (folders[spk] = manifestP.then(m => {
      if (m && typeof m === 'object') return new Set(m[spk] || []);
      return fetch('assets/voices/' + spk + '/', { cache: 'no-cache' }).then(r => r.ok ? r.text() : '').catch(() => '')
        .then(t => new Set(Array.from(t.matchAll(/href="([^"?#]+)\.mp3"/gi), x => decodeURIComponent(x[1]).split('/').pop())));
    }));
  }
  function probeClip(spk, id) { return clipsOf(spk).then(set => set.has(id)).catch(() => false); }
  const clipUrl = (spk, id) => 'assets/voices/' + spk + '/' + id + '.mp3';

  // ---------------------------------------------------------------- queue
  const queue = [];
  let cur = null;            // { spk, line, opts, t0, audio?, utt?, pulse }
  const listener = () => { try { if (typeof carPos !== 'undefined' && carPos) return carPos; } catch (e) {} return null; };
  function distTo(opts) {
    const l = listener(), p = opts && opts.pos ? opts.pos() : null;
    if (!l || !p) return 0;
    return Math.hypot(p.x - l.x, p.z - l.z);
  }
  const estDur = line => 0.9 + line.tr.length * 0.075;
  let muted = false;
  try { muted = localStorage.getItem('nellutla.voices') === '0'; } catch (e) {}

  function say(spk, id, opts) {
    opts = opts || {};
    const line = LINES[id]; if (!line) return false;
    // too far to hear, or no speech at all: run the callbacks on a timer (bubbles still show), no queue
    if (muted || distTo(opts) > HEAR || (!synth && typeof Audio === 'undefined')) { silent(spk, line, opts); return true; }
    // the same speaker never queues two lines; low-priority chatter is dropped when the queue is busy
    if (queue.some(q => q.spk === spk) || (queue.length >= 2 && !opts.prio)) { silent(spk, line, opts, true); return true; }
    queue.push({ spk, line, opts, tq: performance.now() });
    pump();
    return true;
  }
  function silent(spk, line, opts, skip) {
    if (skip) { try { opts.onSkip && opts.onSkip(line); } catch (e) {} }
    try { opts.onStart && opts.onStart(line, false); } catch (e) {}
    setTimeout(() => { try { opts.onEnd && opts.onEnd(line); } catch (e) {} }, estDur(line) * 1000);
  }
  function finish() {
    const c = cur; cur = null;
    if (c && !c.done) { c.done = true; try { c.opts.onEnd && c.opts.onEnd(c.line); } catch (e) {} }
    setTimeout(pump, 250);     // a short breath between speakers
  }
  async function pump() {
    if (cur || !queue.length) return;
    const it = queue.shift();
    // stale (queued > 6 s) or the speaker walked out of earshot meanwhile: show it silently
    if (performance.now() - it.tq > 6000 || distTo(it.opts) > HEAR) { silent(it.spk, it.line, it.opts); return pump(); }
    cur = { spk: it.spk, line: it.line, opts: it.opts, t0: performance.now(), pulse: 0 };
    const c = cur;
    const vol = Math.max(0.05, volAt(distTo(it.opts))) * ((PROFILE[it.spk] || {}).vol || 1);
    const start = () => { try { c.opts.onStart && c.opts.onStart(c.line, true); } catch (e) {} };
    // safety net: a voice engine that never fires onend
    const guard = setTimeout(() => { if (cur === c) { try { synth && synth.cancel(); } catch (e) {} if (c.audio) c.audio.pause(); finish(); } }, (estDur(c.line) * 2.2 + 3) * 1000);
    let useClip = false;
    try { useClip = await probeClip(it.spk, it.line.id); } catch (e) {}
    if (cur !== c) return;
    if (useClip) {
      const a = new Audio(clipUrl(it.spk, it.line.id)); c.audio = a; a.volume = vol;
      a.onplay = start; a.onended = a.onerror = () => { clearTimeout(guard); if (cur === c) finish(); };
      a.play().catch(() => { clearTimeout(guard); if (cur === c) { c.audio = null; tts(c, vol, start, guard); } });
      return;
    }
    tts(c, vol, start, guard);
  }
  function tts(c, vol, start, guard) {
    const pk = pick(c.spk), P = PROFILE[c.spk] || { rate: 1, pitch: 1 };
    if (!synth || !pk) { clearTimeout(guard); start(); setTimeout(() => { if (cur === c) finish(); }, estDur(c.line) * 1000); return; }
    const u = new SpeechSynthesisUtterance(textFor(c.line, pk.mode));
    u.voice = pk.v; u.lang = pk.v.lang; u.volume = vol;
    u.rate = P.rate * (pk.mode === 'tr' ? 0.95 : 1);
    u.pitch = Math.min(2, P.pitch * (pk.mismatch ? (P.g === 'f' ? 1.35 : 0.8) : 1));
    u.onstart = start;
    // word boundaries drive the mouth: each word opens it for about its spoken length
    u.onboundary = (e) => { if (e.name && e.name !== 'word') return; const n = Math.max(2, e.charLength || 4); c.bnd = true; c.wT = performance.now(); c.wDur = Math.max(140, n * 62 / (u.rate || 1)); c.wAmp = Math.min(1, 0.55 + n * 0.06); };
    u.onend = u.onerror = () => { clearTimeout(guard); if (cur === c) finish(); };
    c.utt = u;
    try { synth.speak(u); } catch (e) { clearTimeout(guard); start(); setTimeout(() => { if (cur === c) finish(); }, estDur(c.line) * 1000); }
  }
  // mouth opening 0..1 for the current speaker: syllable-rate flap, kicked by word boundaries
  function level(spk) {
    if (!cur || cur.spk !== spk) return 0;
    const now = performance.now(), t = (now - cur.t0) / 1000;
    if (cur.bnd) {
      // inside the current word: an open-close envelope over its length, with a syllable ripple; closed between words
      const k = (now - cur.wT) / cur.wDur; if (k < 0 || k > 1) return 0;
      const env = Math.sin(Math.PI * k), syl = 0.55 + 0.45 * Math.abs(Math.sin(k * Math.PI * Math.max(1, Math.round(cur.wDur / 160))));
      return Math.max(0, Math.min(1, env * syl * cur.wAmp));
    }
    // clips / engines without boundary events: syllable-rate flap
    const syl = 0.5 + 0.5 * Math.sin(t * 15.5) * Math.sin(t * 4.3 + 1);
    return Math.max(0, Math.min(1, 0.2 + syl * 0.6));
  }

  // range watchdog: out of earshot -> cut the voice (the bubble finishes on its own timer); clips follow distance
  setInterval(() => {
    const c = cur; if (!c || c.done) return;
    const d = distTo(c.opts);
    if (c.audio) c.audio.volume = Math.max(0, Math.min(1, volAt(d) * ((PROFILE[c.spk] || {}).vol || 1)));
    if (d > HEAR + 0.5) {
      try { if (c.utt && synth) synth.cancel(); } catch (e) {}
      if (c.audio) c.audio.pause();
      const left = Math.max(300, estDur(c.line) * 1000 - (performance.now() - c.t0));
      c.done = true; cur = null; setTimeout(pump, 250);
      setTimeout(() => { try { c.opts.onEnd && c.opts.onEnd(c.line); } catch (e) {} }, left);
    }
  }, 200);
  window.Voice = {
    LINES, POOLS, next, mark, resetMemory() { mem = { used: {}, last: [] }; try { localStorage.removeItem(MEM_KEY); } catch (e) {} }, PROFILE, HEAR, FULL, volAt, say, level,
    speaking: spk => !!(cur && cur.spk === spk),
    get busy() { return !!cur || queue.length > 0; },
    stop() { queue.length = 0; try { synth && synth.cancel(); } catch (e) {} if (cur && cur.audio) cur.audio.pause(); finish(); },
    setMuted(m) { muted = !!m; try { localStorage.setItem('nellutla.voices', muted ? '0' : '1'); } catch (e) {} if (muted) this.stop(); },
    get muted() { return muted; },
    voices: () => VOICES.map(v => ({ name: v.name, lang: v.lang, local: v.localService })),
    report() { loadVoices(); const r = {}; for (const s in PROFILE) { const p = pick(s); r[s] = p ? { voice: p.v.name, lang: p.v.lang, script: p.mode } : null; } return r; },
    teToDeva, clipUrl,
  };
})();
