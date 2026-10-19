export type MarketplaceCarModel = { id: string; label: string };

function models(entries: readonly (readonly [string, string])[]): readonly MarketplaceCarModel[] {
  return [...entries.map(([id, label]) => ({ id, label })), { id: 'other', label: 'سيارة أخرى' }];
}

// Model families, not years, trim levels, inferred keywords, or a sales ranking.
export const marketplaceCarModelsByBrand: Readonly<Record<string, readonly MarketplaceCarModel[]>> = {
  toyota: models([
    ['camry', 'كامري'], ['corolla', 'كورولا'], ['hilux', 'هايلكس'], ['land_cruiser', 'لاند كروزر'],
    ['land_cruiser_70', 'لاند كروزر 70'], ['prado', 'برادو'], ['fortuner', 'فورتشنر'], ['yaris', 'يارس'],
    ['avalon', 'أفالون'], ['rav4', 'راف فور'], ['fj_cruiser', 'إف جي'], ['innova', 'إنوفا'],
    ['hiace', 'هايس'], ['highlander', 'هايلاندر'], ['sequoia', 'سيكويا'], ['tundra', 'تندرا'],
    ['crown', 'كراون'], ['corolla_cross', 'كورولا كروس'], ['raize', 'رايز'], ['rush', 'راش'],
    ['veloz', 'فيلوز'], ['urban_cruiser', 'أوربان كروزر'], ['supra', 'سوبرا'], ['cressida', 'كرسيدا'],
  ]),
  hyundai: models([
    ['elantra', 'إلنترا'], ['accent', 'أكسنت'], ['sonata', 'سوناتا'], ['azera', 'أزيرا'],
    ['tucson', 'توسان'], ['santa_fe', 'سنتافي'], ['palisade', 'باليسيد'], ['creta', 'كريتا'],
    ['kona', 'كونا'], ['venue', 'فينيو'], ['staria', 'ستاريا'], ['h1', 'إتش 1'], ['ioniq_5', 'أيونيك 5'],
  ]),
  nissan: models([
    ['patrol', 'باترول'], ['patrol_safari', 'باترول سفاري'], ['sunny', 'صني'], ['altima', 'ألتيما'],
    ['maxima', 'مكسيما'], ['datsun', 'ددسن'], ['navara', 'نافارا'], ['pathfinder', 'باثفندر'],
    ['xterra', 'إكستيرا'], ['x_trail', 'إكس تريل'], ['kicks', 'كيكس'], ['sentra', 'سنترا'],
    ['armada', 'أرمادا'], ['urvan', 'أورفان'], ['tiida', 'تيدا'], ['juke', 'جوك'],
    ['murano', 'مورانو'], ['gt_r', 'جي تي آر'], ['z', 'زد'], ['qashqai', 'قاشقاي'],
  ]),
  ford: models([
    ['taurus', 'تورس'], ['expedition', 'إكسبدشن'], ['explorer', 'إكسبلورر'], ['f150', 'إف 150'],
    ['ranger', 'رينجر'], ['mustang', 'موستانج'], ['edge', 'إيدج'], ['everest', 'إيفرست'],
    ['bronco', 'برونكو'], ['territory', 'تيريتوري'], ['fusion', 'فيوجن'], ['crown_victoria', 'كراون فكتوريا'],
  ]),
  kia: models([
    ['cerato', 'سيراتو'], ['k3', 'كي 3'], ['k5', 'كي 5'], ['k8', 'كي 8'], ['k9', 'كي 9'],
    ['optima', 'أوبتيما'], ['cadenza', 'كادينزا'], ['rio', 'ريو'], ['pegas', 'بيجاس'],
    ['sportage', 'سبورتاج'], ['sorento', 'سورينتو'], ['seltos', 'سيلتوس'], ['sonet', 'سونيت'],
    ['carnival', 'كرنفال'], ['telluride', 'تيلورايد'], ['picanto', 'بيكانتو'], ['stinger', 'ستينجر'],
  ]),
  chevrolet: models([
    ['tahoe', 'تاهو'], ['suburban', 'سوبربان'], ['silverado', 'سيلفرادو'], ['caprice', 'كابرس'],
    ['impala', 'إمبالا'], ['malibu', 'ماليبو'], ['cruze', 'كروز'], ['captiva', 'كابتيفا'],
    ['traverse', 'ترافيرس'], ['trailblazer', 'تريل بليزر'], ['blazer', 'بليزر'], ['equinox', 'إكوينوكس'],
    ['groove', 'جروف'], ['spark', 'سبارك'], ['camaro', 'كمارو'], ['corvette', 'كورفيت'],
  ]),
  lexus: models([
    ['es', 'إي إس'], ['ls', 'إل إس'], ['is', 'آي إس'], ['gs', 'جي إس'], ['lx', 'إل إكس'],
    ['gx', 'جي إكس'], ['rx', 'آر إكس'], ['nx', 'إن إكس'], ['ux', 'يو إكس'], ['lc', 'إل سي'], ['rc', 'آر سي'],
  ]),
  mercedes_benz: models([
    ['a_class', 'الفئة إيه'], ['c_class', 'الفئة سي'], ['e_class', 'الفئة إي'], ['s_class', 'الفئة إس'],
    ['g_class', 'الفئة جي'], ['cla', 'سي إل إيه'], ['cls', 'سي إل إس'], ['gla', 'جي إل إيه'],
    ['glb', 'جي إل بي'], ['glc', 'جي إل سي'], ['gle', 'جي إل إي'], ['gls', 'جي إل إس'],
    ['sl', 'إس إل'], ['v_class', 'الفئة في'], ['eqs', 'إي كيو إس'],
  ]),
  gmc: models([['yukon', 'يوكن'], ['sierra', 'سييرا'], ['acadia', 'أكاديا'], ['terrain', 'تيرين'], ['savana', 'سافانا'], ['canyon', 'كانيون'], ['hummer_ev', 'همر الكهربائي']]),
  honda: models([['accord', 'أكورد'], ['civic', 'سيفيك'], ['city', 'سيتي'], ['cr_v', 'سي آر في'], ['hr_v', 'إتش آر في'], ['zr_v', 'زد آر في'], ['pilot', 'بايلوت'], ['odyssey', 'أوديسي']]),
  isuzu: models([['d_max', 'دي ماكس'], ['mu_x', 'إم يو إكس'], ['trooper', 'تروبر']]),
  bmw: models([['1_series', 'الفئة الأولى'], ['2_series', 'الفئة الثانية'], ['3_series', 'الفئة الثالثة'], ['4_series', 'الفئة الرابعة'], ['5_series', 'الفئة الخامسة'], ['6_series', 'الفئة السادسة'], ['7_series', 'الفئة السابعة'], ['8_series', 'الفئة الثامنة'], ['x1', 'إكس 1'], ['x2', 'إكس 2'], ['x3', 'إكس 3'], ['x4', 'إكس 4'], ['x5', 'إكس 5'], ['x6', 'إكس 6'], ['x7', 'إكس 7'], ['z4', 'زد 4'], ['ix', 'آي إكس']]),
  dodge: models([['charger', 'تشارجر'], ['challenger', 'تشالنجر'], ['durango', 'دورانجو'], ['ram', 'رام'], ['neon', 'نيون'], ['journey', 'جورني']]),
  mazda: models([['mazda2', 'مازدا 2'], ['mazda3', 'مازدا 3'], ['mazda6', 'مازدا 6'], ['cx3', 'سي إكس 3'], ['cx5', 'سي إكس 5'], ['cx9', 'سي إكس 9'], ['cx30', 'سي إكس 30'], ['cx60', 'سي إكس 60'], ['cx90', 'سي إكس 90'], ['mx5', 'إم إكس 5']]),
  changan: models([['alsvin', 'ألسفن'], ['eado', 'إيدو'], ['cs35', 'سي إس 35'], ['cs75', 'سي إس 75'], ['cs85', 'سي إس 85'], ['cs95', 'سي إس 95'], ['uni_t', 'يوني تي'], ['uni_k', 'يوني كي'], ['uni_v', 'يوني في'], ['hunter', 'هنتر']]),
  mitsubishi: models([['pajero', 'باجيرو'], ['montero_sport', 'مونتيرو سبورت'], ['l200', 'إل 200'], ['lancer', 'لانسر'], ['attrage', 'أتراج'], ['outlander', 'أوتلاندر'], ['asx', 'إيه إس إكس'], ['eclipse_cross', 'إكليبس كروس'], ['xpander', 'إكسباندر']]),
  land_rover: models([['range_rover', 'رنج روفر'], ['range_rover_sport', 'رنج روفر سبورت'], ['velar', 'فيلار'], ['evoque', 'إيفوك'], ['defender', 'ديفندر'], ['discovery', 'ديسكفري'], ['discovery_sport', 'ديسكفري سبورت']]),
  jetour: models([['t1', 'تي 1'], ['t2', 'تي 2'], ['dashing', 'داشينج'], ['x70', 'إكس 70'], ['x90', 'إكس 90']]),
  geely: models([['emgrand', 'إمجراند'], ['coolray', 'كولراي'], ['tugella', 'توجيلا'], ['monjaro', 'مونجارو'], ['starray', 'ستار راي'], ['okavango', 'أوكافانجو'], ['azkarra', 'أزكارا'], ['preface', 'بريفيس']]),
  jeep: models([['wrangler', 'رانجلر'], ['grand_cherokee', 'جراند شيروكي'], ['cherokee', 'شيروكي'], ['compass', 'كومباس'], ['renegade', 'رينيجيد'], ['gladiator', 'جلاديتور'], ['wagoneer', 'واجونير']]),
  mg: models([['mg3', 'إم جي 3'], ['mg5', 'إم جي 5'], ['mg6', 'إم جي 6'], ['mg7', 'إم جي 7'], ['zs', 'زد إس'], ['hs', 'إتش إس'], ['rx5', 'آر إكس 5'], ['rx8', 'آر إكس 8'], ['one', 'ون'], ['whale', 'ويل']]),
  suzuki: models([['swift', 'سويفت'], ['baleno', 'بالينو'], ['ciaz', 'سياز'], ['dzire', 'ديزاير'], ['jimny', 'جيمني'], ['vitara', 'فيتارا'], ['grand_vitara', 'جراند فيتارا'], ['ertiga', 'إرتيجا'], ['fronx', 'فرونكس']]),
  haval: models([['h6', 'إتش 6'], ['h9', 'إتش 9'], ['jolion', 'جوليان'], ['dargo', 'دارجو']]),
  genesis: models([['g70', 'جي 70'], ['g80', 'جي 80'], ['g90', 'جي 90'], ['gv70', 'جي في 70'], ['gv80', 'جي في 80']]),
  audi: models([['a3', 'إيه 3'], ['a4', 'إيه 4'], ['a5', 'إيه 5'], ['a6', 'إيه 6'], ['a7', 'إيه 7'], ['a8', 'إيه 8'], ['q2', 'كيو 2'], ['q3', 'كيو 3'], ['q5', 'كيو 5'], ['q7', 'كيو 7'], ['q8', 'كيو 8'], ['tt', 'تي تي'], ['r8', 'آر 8'], ['e_tron', 'إي ترون']]),
  chery: models([['arrizo5', 'أريزو 5'], ['arrizo6', 'أريزو 6'], ['arrizo8', 'أريزو 8'], ['tiggo2', 'تيجو 2'], ['tiggo4', 'تيجو 4'], ['tiggo7', 'تيجو 7'], ['tiggo8', 'تيجو 8'], ['tiggo9', 'تيجو 9']]),
  porsche: models([['911', '911'], ['718', '718'], ['cayenne', 'كايين'], ['macan', 'ماكان'], ['panamera', 'باناميرا'], ['taycan', 'تايكان'], ['boxster', 'بوكستر'], ['cayman', 'كايمان']]),
  chrysler: models([['300', '300'], ['200', '200'], ['pacifica', 'باسيفيكا'], ['town_country', 'تاون آند كانتري'], ['sebring', 'سيبرينج']]),
  cadillac: models([['escalade', 'إسكاليد'], ['ct4', 'سي تي 4'], ['ct5', 'سي تي 5'], ['ct6', 'سي تي 6'], ['xt4', 'إكس تي 4'], ['xt5', 'إكس تي 5'], ['xt6', 'إكس تي 6'], ['ats', 'إيه تي إس'], ['cts', 'سي تي إس'], ['lyriq', 'ليريك']]),
  gac: models([['ga4', 'جي إيه 4'], ['ga6', 'جي إيه 6'], ['ga8', 'جي إيه 8'], ['gs3', 'جي إس 3'], ['gs4', 'جي إس 4'], ['gs5', 'جي إس 5'], ['gs8', 'جي إس 8'], ['emkoo', 'إمكو'], ['empow', 'إمباو'], ['m8', 'إم 8']]),
  peugeot: models([['208', '208'], ['301', '301'], ['308', '308'], ['408', '408'], ['508', '508'], ['2008', '2008'], ['3008', '3008'], ['5008', '5008'], ['partner', 'بارتنر'], ['landtrek', 'لاند تريك']]),
  volkswagen: models([['golf', 'جولف'], ['polo', 'بولو'], ['jetta', 'جيتا'], ['passat', 'باسات'], ['tiguan', 'تيجوان'], ['touareg', 'طوارق'], ['teramont', 'تيرامونت'], ['t_roc', 'تي روك'], ['beetle', 'بيتل'], ['arteon', 'أرتيون']]),
  faw: models([['b70', 'بي 70'], ['b50', 'بي 50'], ['t77', 'تي 77'], ['t99', 'تي 99'], ['x40', 'إكس 40'], ['x80', 'إكس 80'], ['t33', 'تي 33']]),
  lincoln: models([['navigator', 'نافيجيتور'], ['aviator', 'أفياتور'], ['nautilus', 'نوتيلوس'], ['corsair', 'كورسير'], ['continental', 'كونتيننتال'], ['town_car', 'تاون كار'], ['mkz', 'إم كي زد'], ['mkx', 'إم كي إكس']]),
  daihatsu: models([['terios', 'تيريوس'], ['sirion', 'سيريون'], ['materia', 'ماتيريا'], ['charade', 'شاريد'], ['gran_max', 'جران ماكس']]),
  infiniti: models([['q50', 'كيو 50'], ['q60', 'كيو 60'], ['q70', 'كيو 70'], ['qx50', 'كيو إكس 50'], ['qx55', 'كيو إكس 55'], ['qx60', 'كيو إكس 60'], ['qx70', 'كيو إكس 70'], ['qx80', 'كيو إكس 80'], ['g', 'الفئة جي'], ['fx', 'إف إكس']]),
  great_wall: models([['wingle5', 'وينجل 5'], ['wingle7', 'وينجل 7'], ['poer', 'باور']]),
  byd: models([['atto3', 'أتو 3'], ['seal', 'سيل'], ['han', 'هان'], ['song_plus', 'سونج بلس'], ['qin_plus', 'تشين بلس'], ['tang', 'تانج'], ['dolphin', 'دولفين'], ['shark', 'شارك']]),
  jac: models([['j7', 'جي 7'], ['js3', 'جي إس 3'], ['js4', 'جي إس 4'], ['js6', 'جي إس 6'], ['s3', 'إس 3'], ['s4', 'إس 4'], ['t6', 'تي 6'], ['t8', 'تي 8'], ['t9', 'تي 9']]),
  fiat: models([['500', '500'], ['tipo', 'تيبو'], ['punto', 'بونتو'], ['panda', 'باندا'], ['doblo', 'دوبلو'], ['ducato', 'دوكاتو']]),
  dongfeng: models([['shine', 'شاين'], ['a30', 'إيه 30'], ['ax7', 'إيه إكس 7'], ['aeolus_yixuan', 'إيولوس ييشوان'], ['rich6', 'ريتش 6']]),
  bentley: models([['continental', 'كونتيننتال'], ['flying_spur', 'فلاينج سبير'], ['bentayga', 'بنتايجا'], ['mulsanne', 'مولسان'], ['arnage', 'أرناج']]),
  tank: models([['300', '300'], ['500', '500'], ['700', '700']]),
  foton: models([['tunland', 'تونلاند'], ['toano', 'توانو'], ['view', 'فيو']]),
  rolls_royce: models([['phantom', 'فانتوم'], ['ghost', 'جوست'], ['cullinan', 'كولينان'], ['wraith', 'ريث'], ['dawn', 'داون'], ['spectre', 'سبيكتر']]),
  jaguar: models([['xe', 'إكس إي'], ['xf', 'إكس إف'], ['xj', 'إكس جي'], ['f_pace', 'إف بيس'], ['e_pace', 'إي بيس'], ['i_pace', 'آي بيس'], ['f_type', 'إف تايب'], ['xk', 'إكس كي']]),
  baic: models([['bj40', 'بي جي 40'], ['bj60', 'بي جي 60'], ['bj80', 'بي جي 80'], ['x35', 'إكس 35'], ['x55', 'إكس 55'], ['x7', 'إكس 7'], ['u5', 'يو 5']]),
  maserati: models([['ghibli', 'جيبلي'], ['quattroporte', 'كواتروبورتي'], ['levante', 'ليفانتي'], ['grecale', 'جريكالي'], ['granturismo', 'جران توريزمو'], ['mc20', 'إم سي 20']]),
  hummer: models([['h1', 'إتش 1'], ['h2', 'إتش 2'], ['h3', 'إتش 3']]),
  jmc: models([['vigus', 'فيجاس'], ['grand_avenue', 'جراند أفينيو']]),
  volvo: models([['s60', 'إس 60'], ['s80', 'إس 80'], ['s90', 'إس 90'], ['xc40', 'إكس سي 40'], ['xc60', 'إكس سي 60'], ['xc90', 'إكس سي 90'], ['v60', 'في 60'], ['ex30', 'إي إكس 30'], ['ex90', 'إي إكس 90']]),
  maxus: models([['d60', 'دي 60'], ['d90', 'دي 90'], ['g10', 'جي 10'], ['g50', 'جي 50'], ['t60', 'تي 60'], ['t90', 'تي 90']]),
  saab: models([['9_3', '9-3'], ['9_5', '9-5'], ['900', '900'], ['9000', '9000']]),
  tata: models([['xenon', 'زينون'], ['safari', 'سفاري'], ['telcoline', 'تيلكولاين'], ['indica', 'إنديكا']]),
  subaru: models([['impreza', 'إمبريزا'], ['legacy', 'ليجاسي'], ['forester', 'فورستر'], ['outback', 'أوتباك'], ['wrx', 'دبليو آر إكس'], ['brz', 'بي آر زد'], ['xv', 'إكس في'], ['crosstrek', 'كروس تريك']]),
  lamborghini: models([['urus', 'أوروس'], ['huracan', 'هوراكان'], ['aventador', 'أفينتادور'], ['gallardo', 'جالاردو'], ['revuelto', 'ريفويلتو']]),
  lucid: models([['air', 'إير'], ['gravity', 'جرافيتي']]),
  buick: models([['enclave', 'إنكليف'], ['encore', 'إنكور'], ['envision', 'إنفيجن'], ['lacrosse', 'لاكروس'], ['regal', 'ريجال'], ['park_avenue', 'بارك أفينيو']]),
  hongqi: models([['h5', 'إتش 5'], ['h9', 'إتش 9'], ['hs3', 'إتش إس 3'], ['hs5', 'إتش إس 5'], ['hs7', 'إتش إس 7'], ['e_hs9', 'إي إتش إس 9']]),
  jaecoo: models([['j5', 'جي 5'], ['j7', 'جي 7'], ['j8', 'جي 8']]),
  smart: models([['fortwo', 'فورتو'], ['forfour', 'فورفور'], ['1', 'رقم 1'], ['3', 'رقم 3']]),
  kg_mobility: models([['rexton', 'ريكستون'], ['korando', 'كوراندو'], ['tivoli', 'تيفولي'], ['torres', 'توريس'], ['musso', 'موسو'], ['actyon', 'أكتيون'], ['kyron', 'كايرون']]),
  skoda: models([['octavia', 'أوكتافيا'], ['superb', 'سوبيرب'], ['kodiaq', 'كودياك'], ['karoq', 'كاروك'], ['kamiq', 'كاميك'], ['scala', 'سكالا'], ['fabia', 'فابيا'], ['rapid', 'رابيد']]),
  lynk_co: models([['01', '01'], ['02', '02'], ['03', '03'], ['05', '05'], ['06', '06'], ['09', '09']]),
  ferrari: models([['458', '458'], ['488', '488'], ['f8', 'إف 8'], ['sf90', 'إس إف 90'], ['296', '296'], ['812', '812'], ['roma', 'روما'], ['portofino', 'بورتوفينو'], ['purosangue', 'بوروسانجوي']]),
  rox: models([['01', '01']]),
  aston_martin: models([['vantage', 'فانتاج'], ['db9', 'دي بي 9'], ['db11', 'دي بي 11'], ['db12', 'دي بي 12'], ['dbx', 'دي بي إكس'], ['dbs', 'دي بي إس'], ['rapide', 'رابيد']]),
  seat: models([['ibiza', 'إيبيزا'], ['leon', 'ليون'], ['ateca', 'أتيكا'], ['arona', 'أرونا'], ['tarraco', 'تاراكو'], ['toledo', 'توليدو']]),
  lifan: models([['520', '520'], ['620', '620'], ['x50', 'إكس 50'], ['x60', 'إكس 60'], ['x70', 'إكس 70']]),
  zxauto: models([['grand_tiger', 'جراند تايجر'], ['terralord', 'تيرالورد'], ['grandlion', 'جراند ليون']]),
  citroen: models([['c3', 'سي 3'], ['c4', 'سي 4'], ['c5', 'سي 5'], ['c3_aircross', 'سي 3 إيركروس'], ['c5_aircross', 'سي 5 إيركروس'], ['berlingo', 'بيرلينجو']]),
  mercury: models([['grand_marquis', 'جراند ماركيز'], ['mountaineer', 'ماونتنير'], ['milan', 'ميلان'], ['mariner', 'مارينر']]),
  exeed: models([['lx', 'إل إكس'], ['txl', 'تي إكس إل'], ['vx', 'في إكس'], ['rx', 'آر إكس']]),
  alfa_romeo: models([['giulia', 'جوليا'], ['stelvio', 'ستلفيو'], ['giulietta', 'جولييتا'], ['tonale', 'تونالي'], ['4c', '4 سي']]),
  tesla: models([['model3', 'موديل 3'], ['modely', 'موديل واي'], ['models', 'موديل إس'], ['modelx', 'موديل إكس'], ['cybertruck', 'سايبر تراك']]),
  soueast: models([['s06', 'إس 06'], ['s07', 'إس 07'], ['s09', 'إس 09'], ['dx3', 'دي إكس 3'], ['dx7', 'دي إكس 7']]),
  mahindra: models([['scorpio', 'سكوربيو'], ['pik_up', 'بيك أب'], ['xuv500', 'إكس يو في 500'], ['xuv700', 'إكس يو في 700'], ['thar', 'ثار']]),
  renault: models([['duster', 'داستر'], ['koleos', 'كوليوس'], ['megane', 'ميجان'], ['talisman', 'تاليسمان'], ['symbol', 'سيمبول'], ['fluence', 'فلوانس'], ['captur', 'كابتشر'], ['clio', 'كليو'], ['dokker', 'دوكر'], ['master', 'ماستر']]),
  mclaren: models([['570s', '570 إس'], ['600lt', '600 إل تي'], ['650s', '650 إس'], ['720s', '720 إس'], ['750s', '750 إس'], ['artura', 'أرتورا'], ['gt', 'جي تي'], ['p1', 'بي 1']]),
  omoda: models([['c5', 'سي 5'], ['c7', 'سي 7'], ['e5', 'إي 5']]),
  opel: models([['astra', 'أسترا'], ['corsa', 'كورسا'], ['insignia', 'إنسيجنيا'], ['mokka', 'موكا'], ['crossland', 'كروس لاند'], ['grandland', 'جراند لاند'], ['vectra', 'فيكترا']]),
  lotus: models([['elise', 'إليز'], ['exige', 'إكسيج'], ['evora', 'إيفورا'], ['emira', 'إميرا'], ['eletre', 'إليترا'], ['emeya', 'إميا']]),
  ineos: models([['grenadier', 'جرينادير'], ['quartermaster', 'كوارتر ماستر']]),
  daewoo: models([['lanos', 'لانوس'], ['nubira', 'نوبيرا'], ['leganza', 'ليجانزا'], ['matiz', 'ماتيز'], ['cielo', 'سييلو'], ['racer', 'ريسر']]),
  kaiyi: models([['e5', 'إي 5'], ['x3', 'إكس 3'], ['x7', 'إكس 7']]),
  proton: models([['saga', 'ساجا'], ['persona', 'بيرسونا'], ['gen2', 'جين 2'], ['preve', 'بريفيه'], ['x50', 'إكس 50'], ['x70', 'إكس 70'], ['x90', 'إكس 90']]),
  ram: models([['1500', '1500'], ['2500', '2500'], ['3500', '3500']]),
  changan_deepal: models([['s05', 'إس 05'], ['s07', 'إس 07'], ['l07', 'إل 07'], ['g318', 'جي 318']]),
};

export const marketplaceCarModelAttribute = 'marketplaceCarModel';

export function getMarketplaceCarModels(brand: string): readonly MarketplaceCarModel[] {
  return Object.hasOwn(marketplaceCarModelsByBrand, brand) ? marketplaceCarModelsByBrand[brand] : [];
}

export function getMarketplaceCarModel(brand: string, value: unknown) {
  return typeof value === 'string' ? getMarketplaceCarModels(brand).find(model => model.id === value) : undefined;
}

export const marketplaceCarModelsPrompt = Object.entries(marketplaceCarModelsByBrand)
  .map(([brand, choices]) => `${brand}: ${choices.map(model => `${model.id}=${model.label}`).join(', ')}`)
  .join('\n');
