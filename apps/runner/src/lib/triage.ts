/**
 * First-aid triage decision tree for the Guided Care screen. Static + offline:
 * each node is a question or an instruction with big answer buttons that branch
 * to the next node. Content is authored inline for every language the app
 * supports, so no extra i18n keys are needed for the triage tree itself.
 *
 * This is layperson bystander guidance for a race event while a medic is en
 * route — it is intentionally simple and conservative, never a substitute for
 * professional care or calling emergency services. Bulgarian copy follows the
 * register used in Bulgarian Red Cross / WHO first-aid materials: calm,
 * imperative, precise medical terminology.
 */
/**
 * Localized string for the guided-care triage tree. `bg` and `en` are always
 * present; every other UI language the app supports (de, el, it, ro, ru, sr,
 * tr, uk) is also authored explicitly. The `tr` helper in GuidedCare falls
 * back to English only if a language code were ever missing.
 */
export interface LS {
  bg: string;
  en: string;
  de: string;
  el: string;
  it: string;
  ro: string;
  ru: string;
  sr: string;
  tr: string;
  uk: string;
  [lang: string]: string | undefined;
}

export type NodeTone = "normal" | "critical" | "good";
export type OptionTone = "yes" | "no" | "critical" | "neutral";

export interface TriageOption {
  label: LS;
  tone?: OptionTone;
  next: string;
}

export interface TriageNode {
  id: string;
  kind: "question" | "instruction";
  /** Large emoji illustration standing in for the design's step artwork. */
  visual: string;
  title: LS;
  body?: LS;
  tone?: NodeTone;
  options: TriageOption[];
}

const Y: OptionTone = "yes";
const N: OptionTone = "no";

export const TRIAGE_START = "start";

export const TRIAGE: Record<string, TriageNode> = {
  start: {
    id: "start",
    kind: "question",
    visual: "🧍",
    title: {
      en: "Is the person awake and responding to you?",
      bg: "Пострадалият в съзнание ли е и реагира ли?",
      de: "Ist die Person wach und reagiert sie auf Sie?",
      el: "Το άτομο είναι ξύπνιο και ανταποκρίνεται;",
      it: "La persona è cosciente e risponde?",
      ro: "Persoana este trează și reacționează?",
      ru: "Человек в сознании и реагирует на вас?",
      sr: "Da li je osoba pri svesti i da li reaguje?",
      tr: "Kişi uyanık mı ve size tepki veriyor mu?",
      uk: "Людина притомна і реагує на вас?",
    },
    body: {
      en: "Speak loudly and gently tap their shoulders.",
      bg: "Говори му силно и леко го бутни за раменете.",
      de: "Sprechen Sie laut und tippen Sie sanft auf die Schultern.",
      el: "Μιλήστε δυνατά και χτυπήστε ελαφρά τους ώμους του.",
      it: "Parla ad alta voce e tocca delicatamente le spalle.",
      ro: "Vorbește tare și atinge-i ușor umerii.",
      ru: "Громко обратитесь к нему и слегка потормошите за плечи.",
      sr: "Glasno mu se obrati i lagano ga prodrmaj za ramena.",
      tr: "Yüksek sesle konuşun ve omuzlarına hafifçe dokunun.",
      uk: "Голосно покличте і легенько поплескайте по плечах.",
    },
    options: [
      {
        label: {
          en: "Yes, responding",
          bg: "Да, реагира",
          de: "Ja, reagiert",
          el: "Ναι, ανταποκρίνεται",
          it: "Sì, risponde",
          ro: "Da, reacționează",
          ru: "Да, реагирует",
          sr: "Da, reaguje",
          tr: "Evet, tepki veriyor",
          uk: "Так, реагує",
        },
        tone: Y,
        next: "conscious",
      },
      {
        label: {
          en: "No / barely",
          bg: "Не / едва доловимо",
          de: "Nein / kaum",
          el: "Όχι / ελάχιστα",
          it: "No / a malapena",
          ro: "Nu / abia",
          ru: "Нет / едва",
          sr: "Ne / jedva",
          tr: "Hayır / çok az",
          uk: "Ні / ледь",
        },
        tone: N,
        next: "airway",
      },
    ],
  },

  // ── Unresponsive path ──
  airway: {
    id: "airway",
    kind: "instruction",
    visual: "🫁",
    title: {
      en: "Open the airway",
      bg: "Освободи дихателните пътища",
      de: "Atemwege öffnen",
      el: "Ανοίξτε τον αεραγωγό",
      it: "Libera le vie aeree",
      ro: "Deschide căile respiratorii",
      ru: "Освободите дыхательные пути",
      sr: "Otvori disajni put",
      tr: "Hava yolunu açın",
      uk: "Відкрийте дихальні шляхи",
    },
    body: {
      en: "Tilt the head back gently and lift the chin. Clear anything obvious from the mouth.",
      bg: "Внимателно отметни главата назад и повдигни брадичката. Провери устата и почисти видими чужди тела.",
      de: "Kopf vorsichtig nach hinten neigen und Kinn anheben. Sichtbare Fremdkörper aus dem Mund entfernen.",
      el: "Γείρτε απαλά το κεφάλι πίσω και ανασηκώστε το πηγούνι. Καθαρίστε τυχόν εμφανή αντικείμενα από το στόμα.",
      it: "Inclina delicatamente la testa indietro e solleva il mento. Rimuovi eventuali corpi estranei visibili dalla bocca.",
      ro: "Înclină ușor capul pe spate și ridică bărbia. Îndepărtează orice corp străin vizibil din gură.",
      ru: "Аккуратно запрокиньте голову назад и приподнимите подбородок. Уберите изо рта видимые инородные предметы.",
      sr: "Nežno zabaci glavu unazad i podigni bradu. Ukloni sve vidljivo iz usta.",
      tr: "Başı hafifçe geriye eğin ve çeneyi kaldırın. Ağızda görünen yabancı cisimleri temizleyin.",
      uk: "Обережно відкиньте голову назад і підніміть підборіддя. Приберіть з рота помітні сторонні предмети.",
    },
    options: [
      {
        label: {
          en: "Done — check breathing",
          bg: "Готово — провери дишането",
          de: "Erledigt — Atmung prüfen",
          el: "Έγινε — ελέγξτε την αναπνοή",
          it: "Fatto — controlla il respiro",
          ro: "Gata — verifică respirația",
          ru: "Готово — проверьте дыхание",
          sr: "Gotovo — proveri disanje",
          tr: "Tamam — solunumu kontrol edin",
          uk: "Готово — перевірте дихання",
        },
        next: "breathing",
      },
    ],
  },
  breathing: {
    id: "breathing",
    kind: "question",
    visual: "👂",
    title: {
      en: "Look, listen & feel for 10 seconds. Are they breathing normally?",
      bg: "Гледай, слушай и усещай дишането в продължение на 10 секунди. Диша ли нормално?",
      de: "10 Sekunden lang sehen, hören und fühlen. Atmet die Person normal?",
      el: "Κοιτάξτε, ακούστε και νιώστε για 10 δευτερόλεπτα. Αναπνέει κανονικά;",
      it: "Guarda, ascolta e senti per 10 secondi. Respira normalmente?",
      ro: "Privește, ascultă și simte timp de 10 secunde. Respiră normal?",
      ru: "В течение 10 секунд смотрите, слушайте и чувствуйте дыхание. Дышит ли он нормально?",
      sr: "Gledaj, slušaj i oseti 10 sekundi. Da li normalno diše?",
      tr: "10 saniye boyunca bakın, dinleyin ve hissedin. Normal nefes alıyor mu?",
      uk: "Дивіться, слухайте й відчувайте протягом 10 секунд. Чи дихає людина нормально?",
    },
    options: [
      {
        label: {
          en: "Yes, breathing",
          bg: "Да, диша нормално",
          de: "Ja, atmet",
          el: "Ναι, αναπνέει",
          it: "Sì, respira",
          ro: "Da, respiră",
          ru: "Да, дышит",
          sr: "Da, diše",
          tr: "Evet, nefes alıyor",
          uk: "Так, дихає",
        },
        tone: Y,
        next: "recovery",
      },
      {
        label: {
          en: "No / gasping",
          bg: "Не / хрипливо дишане",
          de: "Nein / schnappt nach Luft",
          el: "Όχι / λαχανιάζει",
          it: "No / respiro affannoso",
          ro: "Nu / respirație agonică",
          ru: "Нет / хрипит",
          sr: "Ne / dahće",
          tr: "Hayır / hırıltılı",
          uk: "Ні / хрипить",
        },
        tone: N,
        next: "cpr",
      },
    ],
  },
  recovery: {
    id: "recovery",
    kind: "instruction",
    visual: "🛌",
    tone: "good",
    title: {
      en: "Recovery position",
      bg: "Стабилно странично положение",
      de: "Stabile Seitenlage",
      el: "Θέση ανάνηψης",
      it: "Posizione laterale di sicurezza",
      ro: "Poziția de siguranță",
      ru: "Устойчивое боковое положение",
      sr: "Bočni bezbedni položaj",
      tr: "Koma pozisyonu",
      uk: "Стійке бокове положення",
    },
    body: {
      en: "Roll them onto their side, head tilted back so the airway stays open. Stay with them and keep checking they're breathing until the medic arrives.",
      bg: "Обърни го настрани с леко отметната назад глава, за да остане дихателният път отворен. Остани до него и следи дишането до пристигането на медика.",
      de: "Drehen Sie die Person auf die Seite, Kopf leicht nach hinten geneigt, damit die Atemwege frei bleiben. Bleiben Sie bei ihr und kontrollieren Sie weiter die Atmung, bis der Sanitäter eintrifft.",
      el: "Γυρίστε τον στο πλάι, με το κεφάλι γερμένο πίσω ώστε ο αεραγωγός να παραμένει ανοιχτός. Μείνετε μαζί του και ελέγχετε συνεχώς την αναπνοή μέχρι να έρθει ο διασώστης.",
      it: "Giralo su un fianco, con la testa inclinata indietro in modo che le vie aeree restino aperte. Resta con lui e continua a controllare il respiro finché non arriva il soccorritore.",
      ro: "Întoarce-l pe o parte, cu capul ușor înclinat pe spate, ca să rămână căile respiratorii deschise. Rămâi lângă el și verifică respirația constant până sosește medicul.",
      ru: "Поверните его на бок, голова слегка запрокинута назад, чтобы дыхательные пути оставались открытыми. Оставайтесь рядом и постоянно проверяйте дыхание до приезда медика.",
      sr: "Okreni ga na bok, sa glavom lagano zabačenom unazad da disajni put ostane otvoren. Ostani uz njega i stalno proveravaj disanje dok ne stigne medicinar.",
      tr: "Hava yolu açık kalacak şekilde başı hafifçe geriye eğik olarak onu yan çevirin. Sağlık görevlisi gelene kadar yanında kalın ve solunumunu sürekli kontrol edin.",
      uk: "Поверніть людину на бік, голова злегка відкинута назад, щоб дихальні шляхи залишались відкритими. Залишайтесь поруч і постійно перевіряйте дихання до приїзду медика.",
    },
    options: [
      {
        label: {
          en: "They stopped breathing",
          bg: "Спря да диша",
          de: "Atmung hat aufgehört",
          el: "Σταμάτησε να αναπνέει",
          it: "Ha smesso di respirare",
          ro: "A încetat să respire",
          ru: "Перестал дышать",
          sr: "Prestao je da diše",
          tr: "Nefes almayı durdurdu",
          uk: "Перестав дихати",
        },
        tone: "critical",
        next: "cpr",
      },
    ],
  },
  cpr: {
    id: "cpr",
    kind: "instruction",
    visual: "❤️",
    tone: "critical",
    title: {
      en: "Start CPR now",
      bg: "Започни сърдечно-белодробна реанимация (СБР) веднага",
      de: "Sofort mit der Wiederbelebung beginnen",
      el: "Ξεκινήστε ΚΑΡΠΑ τώρα",
      it: "Inizia subito la RCP",
      ro: "Începe imediat resuscitarea (RCP)",
      ru: "Немедленно начните сердечно-лёгочную реанимацию",
      sr: "Odmah počni sa reanimacijom (KPR)",
      tr: "Hemen KPR'ye başlayın",
      uk: "Негайно почніть серцево-легеневу реанімацію",
    },
    body: {
      en: "Push hard and fast in the centre of the chest — about 2 per second (100–120/min), letting the chest rise fully each time. Don't stop until a medic takes over. Send someone for an AED if there is one.",
      bg: "Натискай силно и бързо в средата на гръдния кош — около 2 пъти в секунда (100–120/мин), като позволяваш на гръдния кош да се повдига напълно след всяко натискане. Не спирай, докато медик не поеме реанимацията. Изпрати някого за дефибрилатор (ДАД), ако има наличен.",
      de: "Drücken Sie fest und schnell in die Mitte des Brustkorbs — etwa 2 Mal pro Sekunde (100–120/min), lassen Sie den Brustkorb dazwischen vollständig zurückfedern. Nicht aufhören, bis ein Sanitäter übernimmt. Schicken Sie jemanden nach einem Defibrillator (AED), falls vorhanden.",
      el: "Πιέστε δυνατά και γρήγορα στο κέντρο του στήθους — περίπου 2 φορές το δευτερόλεπτο (100–120/λεπτό), αφήνοντας το στήθος να ανασηκώνεται πλήρως κάθε φορά. Μη σταματάτε μέχρι να αναλάβει διασώστης. Στείλτε κάποιον για απινιδωτή (AED) αν υπάρχει.",
      it: "Premi forte e veloce al centro del petto — circa 2 volte al secondo (100–120/min), lasciando che il torace risalga completamente ogni volta. Non fermarti finché non subentra un soccorritore. Manda qualcuno a prendere un defibrillatore (DAE) se disponibile.",
      ro: "Apasă puternic și rapid în centrul pieptului — de aproximativ 2 ori pe secundă (100–120/min), lăsând toracele să revină complet de fiecare dată. Nu te opri până nu preia un medic. Trimite pe cineva după un defibrilator (DEA) dacă există unul.",
      ru: "Нажимайте сильно и быстро в центре грудной клетки — примерно 2 раза в секунду (100–120/мин), давая грудной клетке полностью подниматься между нажатиями. Не останавливайтесь, пока не прибудет медик. Пошлите кого-нибудь за дефибриллятором (АНД), если он есть поблизости.",
      sr: "Pritiskaj snažno i brzo u sredini grudnog koša — otprilike 2 puta u sekundi (100–120/min), dozvoljavajući grudnom košu da se svaki put potpuno vrati. Ne prestaj dok medicinar ne preuzme. Pošalji nekoga po defibrilator (AED) ako postoji.",
      tr: "Göğsün tam ortasına sert ve hızlı bastırın — saniyede yaklaşık 2 kez (dakikada 100–120), her seferinde göğsün tamamen geri yükselmesine izin verin. Bir sağlık görevlisi devralana kadar durmayın. Varsa birini defibrilatör (AED) getirmesi için gönderin.",
      uk: "Натискайте сильно і швидко в центрі грудної клітки — приблизно 2 рази за секунду (100–120/хв), даючи грудній клітці повністю підніматися між натисканнями. Не зупиняйтесь, доки медик не перейме реанімацію. Пошліть когось по дефібрилятор (АЗД), якщо він є поблизу.",
    },
    options: [],
  },

  // ── Conscious path ──
  conscious: {
    id: "conscious",
    kind: "question",
    visual: "❓",
    title: {
      en: "What's the main problem?",
      bg: "Кой е основният проблем?",
      de: "Was ist das Hauptproblem?",
      el: "Ποιο είναι το κύριο πρόβλημα;",
      it: "Qual è il problema principale?",
      ro: "Care este principala problemă?",
      ru: "В чём основная проблема?",
      sr: "Koji je glavni problem?",
      tr: "Ana sorun nedir?",
      uk: "У чому основна проблема?",
    },
    options: [
      {
        label: {
          en: "Heavy bleeding",
          bg: "Обилно кървене",
          de: "Starke Blutung",
          el: "Έντονη αιμορραγία",
          it: "Emorragia grave",
          ro: "Sângerare abundentă",
          ru: "Сильное кровотечение",
          sr: "Jako krvarenje",
          tr: "Ağır kanama",
          uk: "Сильна кровотеча",
        },
        tone: "critical",
        next: "bleeding",
      },
      {
        label: {
          en: "Chest pain / can't breathe",
          bg: "Болка в гърдите / затруднено дишане",
          de: "Brustschmerz / Atemnot",
          el: "Πόνος στο στήθος / δυσκολία αναπνοής",
          it: "Dolore al petto / difficoltà respiratoria",
          ro: "Durere în piept / dificultăți de respirație",
          ru: "Боль в груди / затруднённое дыхание",
          sr: "Bol u grudima / otežano disanje",
          tr: "Göğüs ağrısı / nefes darlığı",
          uk: "Біль у грудях / утруднене дихання",
        },
        tone: "critical",
        next: "chest",
      },
      {
        label: {
          en: "Bad fall / can't move a limb",
          bg: "Тежко падане / не може да движи крайник",
          de: "Schwerer Sturz / kann Gliedmaße nicht bewegen",
          el: "Σοβαρή πτώση / δεν μπορεί να κινήσει άκρο",
          it: "Caduta grave / non riesce a muovere un arto",
          ro: "Cădere gravă / nu poate mișca un membru",
          ru: "Серьёзное падение / не может двигать конечностью",
          sr: "Težak pad / ne može da pomeri ud",
          tr: "Ciddi düşme / uzvunu oynatamıyor",
          uk: "Важке падіння / не може рухати кінцівкою",
        },
        next: "fracture",
      },
      {
        label: {
          en: "Hot & confused (heat)",
          bg: "Прегряване и обърканост",
          de: "Überhitzt & verwirrt",
          el: "Ζέστη & σύγχυση",
          it: "Surriscaldamento e confusione",
          ro: "Supraîncălzire și confuzie",
          ru: "Перегрев и спутанность сознания",
          sr: "Pregrejan i konfuzan",
          tr: "Aşırı sıcaklık ve şuur bulanıklığı",
          uk: "Перегрів і сплутаність свідомості",
        },
        next: "heat",
      },
      {
        label: {
          en: "Cold & shivering",
          bg: "Измръзване и треперене",
          de: "Kalt & zittert",
          el: "Κρύο & ρίγος",
          it: "Freddo e brividi",
          ro: "Frig și tremurături",
          ru: "Озноб и дрожь от холода",
          sr: "Hladno mu je i drhti",
          tr: "Üşüme ve titreme",
          uk: "Замерзання і тремтіння",
        },
        next: "cold",
      },
      {
        label: {
          en: "Cramps / exhausted",
          bg: "Мускулни крампи / изтощение",
          de: "Krämpfe / erschöpft",
          el: "Κράμπες / εξάντληση",
          it: "Crampi / sfinimento",
          ro: "Crampe / epuizare",
          ru: "Судороги в мышцах / истощение",
          sr: "Grčevi / iscrpljenost",
          tr: "Kramplar / bitkinlik",
          uk: "Судоми м'язів / виснаження",
        },
        next: "minor",
      },
      {
        label: {
          en: "Something else",
          bg: "Друго",
          de: "Etwas anderes",
          el: "Κάτι άλλο",
          it: "Qualcos'altro",
          ro: "Altceva",
          ru: "Что-то другое",
          sr: "Nešto drugo",
          tr: "Başka bir şey",
          uk: "Щось інше",
        },
        tone: "neutral",
        next: "other",
      },
    ],
  },
  bleeding: {
    id: "bleeding",
    kind: "instruction",
    visual: "🩸",
    tone: "critical",
    title: {
      en: "Control the bleeding",
      bg: "Спри кървенето",
      de: "Blutung stillen",
      el: "Ελέγξτε την αιμορραγία",
      it: "Controlla l'emorragia",
      ro: "Oprește sângerarea",
      ru: "Остановите кровотечение",
      sr: "Zaustavi krvarenje",
      tr: "Kanamayı kontrol altına alın",
      uk: "Зупиніть кровотечу",
    },
    body: {
      en: "Press firmly on the wound with a clean cloth and keep pressing. Raise the injured part if you can. If blood soaks through, add more cloth on top — don't remove the first.",
      bg: "Притисни силно раната с чиста кърпа и продължавай да натискаш непрекъснато. Ако е възможно, повдигни наранената част над нивото на сърцето. Ако кръвта проникне през кърпата, добави още отгоре — не сваляй първата.",
      de: "Drücken Sie fest mit einem sauberen Tuch auf die Wunde und halten Sie den Druck aufrecht. Heben Sie den verletzten Körperteil an, wenn möglich. Wenn Blut durchsickert, legen Sie weiteres Tuch darüber — das erste nicht entfernen.",
      el: "Πιέστε σταθερά την πληγή με ένα καθαρό ύφασμα και συνεχίστε την πίεση. Ανασηκώστε το τραυματισμένο μέλος αν είναι δυνατόν. Αν το αίμα διαπερνά το ύφασμα, προσθέστε κι άλλο από πάνω — μην αφαιρέσετε το πρώτο.",
      it: "Premi con decisione sulla ferita con un panno pulito e continua a premere senza interruzioni. Solleva l'arto ferito se possibile. Se il sangue impregna il panno, aggiungine un altro sopra — non togliere il primo.",
      ro: "Apasă ferm rana cu o cârpă curată și continuă să apeși constant. Ridică membrul rănit dacă este posibil. Dacă sângele pătrunde prin material, adaugă altul deasupra — nu îl scoate pe primul.",
      ru: "Плотно прижмите чистую тряпку к ране и удерживайте давление непрерывно. По возможности приподнимите повреждённую конечность. Если кровь пропитывает тряпку насквозь, добавьте ещё слой сверху — первый не снимайте.",
      sr: "Čvrsto pritisni ranu čistom krpom i drži pritisak neprekidno. Podigni povređeni deo tela ako je moguće. Ako krv probije krpu, dodaj još jednu preko — prvu ne skidaj.",
      tr: "Yarayı temiz bir bezle sıkıca bastırın ve baskıyı kesintisiz sürdürün. Mümkünse yaralı uzvu yukarı kaldırın. Kan bezi ıslatırsa üzerine yenisini ekleyin — ilkini çıkarmayın.",
      uk: "Щільно притисніть до рани чисту ганчірку і утримуйте тиск безперервно. Якщо можливо, підніміть травмовану кінцівку. Якщо кров просочується крізь ганчірку, додайте ще один шар зверху — перший не знімайте.",
    },
    options: [
      {
        label: {
          en: "They became unresponsive",
          bg: "Изпадна в безсъзнание",
          de: "Person wurde bewusstlos",
          el: "Έχασε τις αισθήσεις του",
          it: "È diventato incosciente",
          ro: "A devenit inconștient",
          ru: "Потерял сознание",
          sr: "Izgubio je svest",
          tr: "Bilincini kaybetti",
          uk: "Втратив свідомість",
        },
        tone: "critical",
        next: "airway",
      },
    ],
  },
  chest: {
    id: "chest",
    kind: "instruction",
    visual: "💢",
    tone: "critical",
    title: {
      en: "Chest pain / breathing",
      bg: "Болка в гърдите / затруднено дишане",
      de: "Brustschmerz / Atmung",
      el: "Πόνος στο στήθος / αναπνοή",
      it: "Dolore al petto / respirazione",
      ro: "Durere în piept / respirație",
      ru: "Боль в груди / дыхание",
      sr: "Bol u grudima / disanje",
      tr: "Göğüs ağrısı / solunum",
      uk: "Біль у грудях / дихання",
    },
    body: {
      en: "Help them sit down and rest in a comfortable position. Loosen tight clothing and keep them calm. If they carry their own heart or asthma medication, help them take it.",
      bg: "Помогни му да седне в удобна позиция и да си почине. Разхлаби стегнатите дрехи и го успокой. Ако носи собствено лекарство за сърце или астма, помогни му да го приеме.",
      de: "Helfen Sie der Person, sich hinzusetzen und bequem auszuruhen. Lockern Sie enge Kleidung und beruhigen Sie sie. Falls sie eigene Herz- oder Asthmamedikamente bei sich hat, helfen Sie ihr, diese einzunehmen.",
      el: "Βοηθήστε τον να καθίσει και να ξεκουραστεί σε άνετη στάση. Χαλαρώστε τα σφιχτά ρούχα και κρατήστε τον ήρεμο. Αν έχει δικό του φάρμακο για την καρδιά ή το άσθμα, βοηθήστε τον να το πάρει.",
      it: "Aiutalo a sedersi e a riposare in una posizione comoda. Allenta gli indumenti stretti e mantienilo calmo. Se ha con sé un proprio farmaco per il cuore o l'asma, aiutalo ad assumerlo.",
      ro: "Ajută-l să se așeze și să se odihnească într-o poziție confortabilă. Slăbește hainele strâmte și liniștește-l. Dacă are propriul medicament pentru inimă sau astm, ajută-l să îl ia.",
      ru: "Помогите ему сесть и отдохнуть в удобном положении. Ослабьте тесную одежду и постарайтесь успокоить его. Если у него есть собственное лекарство от сердца или астмы, помогите ему принять его.",
      sr: "Pomozi mu da sedne i odmori se u udobnom položaju. Otpusti stegnutu odeću i umiri ga. Ako nosi sopstveni lek za srce ili astmu, pomozi mu da ga uzme.",
      tr: "Oturmasına ve rahat bir pozisyonda dinlenmesine yardımcı olun. Sıkı giysilerini gevşetin ve sakin kalmasını sağlayın. Kendi kalp veya astım ilacı varsa almasına yardımcı olun.",
      uk: "Допоможіть людині сісти й відпочити у зручному положенні. Розстебніть тісний одяг і заспокойте її. Якщо в неї є власні ліки від серця або астми, допоможіть їй їх прийняти.",
    },
    options: [
      {
        label: {
          en: "They became unresponsive",
          bg: "Изпадна в безсъзнание",
          de: "Person wurde bewusstlos",
          el: "Έχασε τις αισθήσεις του",
          it: "È diventato incosciente",
          ro: "A devenit inconștient",
          ru: "Потерял сознание",
          sr: "Izgubio je svest",
          tr: "Bilincini kaybetti",
          uk: "Втратив свідомість",
        },
        tone: "critical",
        next: "airway",
      },
    ],
  },
  fracture: {
    id: "fracture",
    kind: "instruction",
    visual: "🦴",
    title: {
      en: "Possible fracture",
      bg: "Възможна фрактура",
      de: "Möglicher Knochenbruch",
      el: "Πιθανό κάταγμα",
      it: "Possibile frattura",
      ro: "Posibilă fractură",
      ru: "Возможен перелом",
      sr: "Moguć prelom",
      tr: "Olası kırık",
      uk: "Можливий перелом",
    },
    body: {
      en: "Keep them still — don't try to straighten or move the limb. Support it in the position you found it. Apply something cold wrapped in cloth if available.",
      bg: "Не го премествай — не се опитвай да изправяш или местиш крайника. Обездвижи го в позицията, в която го намери. Ако е възможно, приложи нещо студено, увито в кърпа.",
      de: "Halten Sie die Person ruhig — versuchen Sie nicht, die Gliedmaße zu strecken oder zu bewegen. Stützen Sie sie in der vorgefundenen Position. Wenn verfügbar, legen Sie etwas Kaltes, in ein Tuch gewickelt, auf.",
      el: "Κρατήστε τον ακίνητο — μην προσπαθήσετε να ισιώσετε ή να μετακινήσετε το άκρο. Στηρίξτε το στη θέση που το βρήκατε. Εφαρμόστε κάτι κρύο τυλιγμένο σε ύφασμα, αν είναι διαθέσιμο.",
      it: "Tienilo immobile — non cercare di raddrizzare o spostare l'arto. Sostienilo nella posizione in cui l'hai trovato. Applica qualcosa di freddo avvolto in un panno, se disponibile.",
      ro: "Menține-l nemișcat — nu încerca să îndrepți sau să miști membrul. Susține-l în poziția în care l-ai găsit. Aplică ceva rece învelit într-o cârpă, dacă ai la îndemână.",
      ru: "Не давайте ему двигаться — не пытайтесь выпрямлять или перемещать конечность. Зафиксируйте её в том положении, в котором нашли. При наличии приложите что-то холодное, обёрнутое тряпкой.",
      sr: "Drži ga nepomičnim — ne pokušavaj da ispraviš ili pomeraš ud. Podupri ga u položaju u kom si ga zatekao. Ako je dostupno, stavi nešto hladno umotano u krpu.",
      tr: "Kişiyi hareketsiz tutun — uzvu düzeltmeye veya oynatmaya çalışmayın. Bulduğunuz pozisyonda destekleyin. Varsa, beze sarılmış soğuk bir şey uygulayın.",
      uk: "Не рухайте кінцівку — не намагайтеся її випрямити чи перемістити. Зафіксуйте її в тому положенні, в якому знайшли. За наявності прикладіть щось холодне, загорнуте в ганчірку.",
    },
    options: [],
  },
  heat: {
    id: "heat",
    kind: "instruction",
    visual: "🌡️",
    tone: "critical",
    title: {
      en: "Heat illness",
      bg: "Топлинно изтощение / топлинен удар",
      de: "Hitzeerkrankung",
      el: "Θερμική εξάντληση",
      it: "Malore da calore",
      ro: "Afecțiune cauzată de căldură",
      ru: "Тепловое поражение",
      sr: "Toplotna iscrpljenost",
      tr: "Sıcak çarpması",
      uk: "Теплове ураження",
    },
    body: {
      en: "Move them into shade. Cool them fast — water on the skin, fan them, cold packs to neck/armpits/groin. Sips of water only if fully awake. Confusion means it's serious.",
      bg: "Премести го на сянка. Охлади го бързо — вода върху кожата, вентилиране, студени компреси на шията, подмишниците и слабините. Дай му глътки вода само ако е напълно в съзнание. Обърканост е признак за сериозно състояние.",
      de: "Bringen Sie die Person in den Schatten. Schnell kühlen — Wasser auf die Haut, fächeln, kalte Kompressen an Hals/Achseln/Leiste. Nur bei vollem Bewusstsein kleine Schlucke Wasser geben. Verwirrtheit deutet auf einen Notfall hin.",
      el: "Μεταφέρετέ τον στη σκιά. Δροσίστε τον γρήγορα — νερό στο δέρμα, αερίστε τον, ψυχρές κομπρέσες σε λαιμό/μασχάλες/βουβωνική χώρα. Δώστε λίγες γουλιές νερό μόνο αν είναι πλήρως συνειδητός. Η σύγχυση σημαίνει ότι είναι σοβαρό.",
      it: "Spostalo all'ombra. Raffreddalo rapidamente — acqua sulla pelle, aria con un ventaglio, impacchi freddi su collo/ascelle/inguine. Piccoli sorsi d'acqua solo se pienamente cosciente. La confusione mentale indica gravità.",
      ro: "Mută-l la umbră. Răcește-l rapid — apă pe piele, aerisește-l, comprese reci pe gât/axile/zona inghinală. Oferă-i doar câteva înghițituri de apă dacă este complet treaz. Confuzia mentală indică o stare gravă.",
      ru: "Переместите его в тень. Быстро охлаждайте — вода на кожу, обмахивание, холодные компрессы на шею, подмышки и пах. Давайте пить маленькими глотками только если он полностью в сознании. Спутанность сознания говорит о тяжёлом состоянии.",
      sr: "Premesti ga u hlad. Brzo ga rashladi — voda po koži, hlađenje lepezom, hladni oblozi na vrat/pazuha/prepone. Gutljaje vode daj samo ako je potpuno pri svesti. Konfuzija znači da je stanje ozbiljno.",
      tr: "Kişiyi gölgeye taşıyın. Hızla soğutun — cilde su, yelpazeleyin, boyun/koltuk altı/kasık bölgesine soğuk kompres. Sadece tam bilinçliyse yudum yudum su verin. Şuur bulanıklığı ciddi olduğunu gösterir.",
      uk: "Перенесіть людину в тінь. Швидко охолоджуйте — вода на шкіру, обмахування, холодні компреси на шию, пахви й пах. Давайте пити невеликими ковтками, тільки якщо людина повністю притомна. Сплутаність свідомості означає, що стан серйозний.",
    },
    options: [
      {
        label: {
          en: "They became unresponsive",
          bg: "Изпадна в безсъзнание",
          de: "Person wurde bewusstlos",
          el: "Έχασε τις αισθήσεις του",
          it: "È diventato incosciente",
          ro: "A devenit inconștient",
          ru: "Потерял сознание",
          sr: "Izgubio je svest",
          tr: "Bilincini kaybetti",
          uk: "Втратив свідомість",
        },
        tone: "critical",
        next: "airway",
      },
    ],
  },
  cold: {
    id: "cold",
    kind: "instruction",
    visual: "❄️",
    title: {
      en: "Cold / hypothermia",
      bg: "Измръзване / хипотермия",
      de: "Kälte / Unterkühlung",
      el: "Κρύο / υποθερμία",
      it: "Freddo / ipotermia",
      ro: "Frig / hipotermie",
      ru: "Переохлаждение / гипотермия",
      sr: "Hladnoća / hipotermija",
      tr: "Soğuk / hipotermi",
      uk: "Холод / гіпотермія",
    },
    body: {
      en: "Get them out of wind and rain. Remove wet clothing and wrap them in dry layers or a blanket, including the head. Warm drinks only if fully awake. Handle gently.",
      bg: "Изведи го от вятъра и дъжда. Свали мокрите дрехи и го увий в сухи пластове или одеяло, включително главата. Топли напитки само ако е напълно в съзнание. Действай внимателно и без резки движения.",
      de: "Bringen Sie die Person aus Wind und Regen. Nasse Kleidung entfernen und in trockene Schichten oder eine Decke einwickeln, auch den Kopf bedecken. Nur bei vollem Bewusstsein warme Getränke geben. Vorsichtig behandeln.",
      el: "Απομακρύνετέ τον από τον άνεμο και τη βροχή. Αφαιρέστε τα βρεγμένα ρούχα και τυλίξτε τον σε στεγνά στρώματα ή κουβέρτα, καλύπτοντας και το κεφάλι. Ζεστά ροφήματα μόνο αν είναι πλήρως συνειδητός. Χειριστείτε τον απαλά.",
      it: "Portalo al riparo da vento e pioggia. Rimuovi gli abiti bagnati e avvolgilo in strati asciutti o in una coperta, coprendo anche la testa. Bevande calde solo se pienamente cosciente. Maneggialo con delicatezza.",
      ro: "Adăpostește-l de vânt și ploaie. Îndepărtează hainele ude și înfășoară-l în straturi uscate sau o pătură, acoperindu-i și capul. Băuturi calde doar dacă este complet treaz. Manevrează-l cu blândețe.",
      ru: "Уведите его от ветра и дождя. Снимите мокрую одежду и укутайте в сухие слои или одеяло, укрыв и голову. Тёплое питьё только если он полностью в сознании. Двигайте его осторожно, без резких движений.",
      sr: "Skloni ga od vetra i kiše. Skini mokru odeću i umotaj ga u suve slojeve ili ćebe, uključujući glavu. Tople napitke daj samo ako je potpuno pri svesti. Postupaj s njim nežno.",
      tr: "Rüzgâr ve yağmurdan uzaklaştırın. Islak giysileri çıkarın, baş dahil kuru katmanlara veya bir battaniyeye sarın. Sadece tam bilinçliyse sıcak içecek verin. Nazikçe hareket ettirin.",
      uk: "Виведіть людину з-під вітру та дощу. Зніміть мокрий одяг і загорніть у сухі шари або ковдру, накривши й голову. Теплі напої лише якщо людина повністю притомна. Рухайте її обережно, без різких рухів.",
    },
    options: [],
  },
  minor: {
    id: "minor",
    kind: "instruction",
    visual: "🩹",
    tone: "good",
    title: {
      en: "Cramp / exhaustion",
      bg: "Мускулна крампа / изтощение",
      de: "Krampf / Erschöpfung",
      el: "Κράμπα / εξάντληση",
      it: "Crampo / sfinimento",
      ro: "Crampă / epuizare",
      ru: "Судорога / истощение",
      sr: "Grč / iscrpljenost",
      tr: "Kramp / bitkinlik",
      uk: "Судома / виснаження",
    },
    body: {
      en: "Help them rest in shade. Sips of water or electrolytes. Gently stretch and massage cramping muscles. Keep watching in case they get worse.",
      bg: "Помогни му да си почине на сянка. Глътки вода или разтвор с електролити. Внимателно разтегни и масажирай схванатите мускули. Продължи да го наблюдаваш за влошаване на състоянието.",
      de: "Helfen Sie der Person, sich im Schatten auszuruhen. Schlucke Wasser oder Elektrolytgetränk. Verkrampfte Muskeln vorsichtig dehnen und massieren. Weiter beobachten, falls sich der Zustand verschlechtert.",
      el: "Βοηθήστε τον να ξεκουραστεί στη σκιά. Γουλιές νερού ή ηλεκτρολυτών. Τεντώστε και μασάζ απαλά στους μυς που έχουν κράμπα. Συνεχίστε να τον παρακολουθείτε μήπως επιδεινωθεί.",
      it: "Aiutalo a riposare all'ombra. Sorsi d'acqua o di integratori elettrolitici. Allunga e massaggia delicatamente i muscoli contratti. Continua a monitorarlo in caso peggiori.",
      ro: "Ajută-l să se odihnească la umbră. Înghițituri de apă sau electroliți. Întinde și masează ușor mușchii cu crampe. Continuă să îl supraveghezi în caz că starea se agravează.",
      ru: "Помогите ему отдохнуть в тени. Небольшие глотки воды или раствора с электролитами. Аккуратно растяните и помассируйте сведённые мышцы. Продолжайте наблюдать на случай ухудшения состояния.",
      sr: "Pomozi mu da se odmori u hladu. Gutljaji vode ili elektrolita. Nežno istegni i masiraj grčeve u mišićima. Nastavi da ga posmatraš u slučaju pogoršanja.",
      tr: "Gölgede dinlenmesine yardımcı olun. Yudum yudum su veya elektrolit içecek verin. Kramp giren kasları nazikçe gerin ve masaj yapın. Kötüleşmesi ihtimaline karşı gözlemeye devam edin.",
      uk: "Допоможіть людині відпочити в тіні. Невеликі ковтки води або розчину з електролітами. Обережно розтягніть і помасажуйте зведені м'язи. Продовжуйте спостерігати на випадок погіршення стану.",
    },
    options: [],
  },
  other: {
    id: "other",
    kind: "instruction",
    visual: "📝",
    title: {
      en: "Keep them safe",
      bg: "Осигури безопасност на пострадалия",
      de: "Sicherheit gewährleisten",
      el: "Κρατήστε τον ασφαλή",
      it: "Mantienilo al sicuro",
      ro: "Asigură-i siguranța",
      ru: "Обеспечьте его безопасность",
      sr: "Obezbedi mu sigurnost",
      tr: "Güvende tutun",
      uk: "Забезпечте безпеку постраждалого",
    },
    body: {
      en: "Keep them comfortable and don't leave them alone. Note what you see so you can tell the medic on arrival — or call Race Command now.",
      bg: "Настани го удобно и не го оставяй сам. Запомни какво наблюдаваш, за да информираш медика при пристигането му — или се обади на Командния център веднага.",
      de: "Sorgen Sie für Komfort und lassen Sie die Person nicht allein. Merken Sie sich, was Sie beobachten, um es dem Sanitäter bei der Ankunft zu berichten — oder rufen Sie jetzt die Einsatzleitung an.",
      el: "Κρατήστε τον άνετα και μην τον αφήνετε μόνο. Σημειώστε τι παρατηρείτε ώστε να ενημερώσετε τον διασώστη κατά την άφιξή του — ή καλέστε τώρα το Κέντρο Επιχειρήσεων.",
      it: "Mantienilo a suo agio e non lasciarlo solo. Annota cosa osservi per poterlo riferire al soccorritore al suo arrivo — oppure chiama subito il Comando Gara.",
      ro: "Asigură-i confort și nu îl lăsa singur. Reține ce observi, ca să poți informa medicul la sosire — sau sună acum la Comandamentul Cursei.",
      ru: "Обеспечьте ему комфорт и не оставляйте одного. Запомните, что вы наблюдаете, чтобы сообщить медику по прибытии — или позвоните в Командный центр прямо сейчас.",
      sr: "Obezbedi mu udobnost i ne ostavljaj ga samog. Zapamti šta primećuješ da bi obavestio medicinara po dolasku — ili odmah pozovi Komandni centar.",
      tr: "Rahat ettirin ve yalnız bırakmayın. Sağlık görevlisi geldiğinde bilgi verebilmek için gördüklerinizi not edin — ya da hemen Yarış Komutasını arayın.",
      uk: "Забезпечте їй комфорт і не залишайте саму. Запам'ятайте, що ви спостерігаєте, щоб повідомити медика після прибуття — або зателефонуйте до Командного центру негайно.",
    },
    options: [],
  },
};
