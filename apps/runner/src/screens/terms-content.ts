/**
 * Full Terms & Conditions, localised for every language offered in the picker
 * (see i18n LANGUAGES). Inline emphasis uses **double asterisks**; the Terms
 * screen renders that as bold. Any language missing here falls back to English.
 */

export interface TermsSection {
  title: string;
  paragraphs: string[];
  bullets?: string[];
}

export interface TermsDoc {
  title: string;
  lastUpdated: string;
  intro: string;
  banner: string;
  sections: TermsSection[];
  closing: string;
}

/** Last substantive revision, shown verbatim in every language. */
export const TERMS_LAST_UPDATED = "21 June 2026";

const en: TermsDoc = {
  title: "Terms & Conditions",
  lastUpdated: `Last updated: ${TERMS_LAST_UPDATED}`,
  intro:
    "These Terms & Conditions (the “**Terms**”) form a binding agreement between you (“**you**”, the “**Participant**” or “**User**”) and **Academy First Aid**, the operator of the RaceSafe platform (the “**Service**”, “**we**”, “**us**” or “**our**”). The Service is provided to support on-course safety and emergency medical coordination at organised sporting events. By creating a profile, joining an event, or otherwise using the Service, you confirm that you have read, understood and agree to be bound by these Terms and by our Privacy Notice set out below. If you do not agree, do not use the Service.",
  banner:
    "⚠️ The Service is an aid to event safety only. It does **not** replace your local emergency services. In any life-threatening situation, call **112** (or your local emergency number) immediately.",
  sections: [
    {
      title: "1. Definitions",
      paragraphs: [
        "“**Event**” means an organised race, course or activity that has enabled the Service. “**Race Command**” means the event’s medical and safety coordination team. “**Medic**” means a responder authorised by Race Command. “**Content**” means any data you submit, including incident reports, location data, medical information, photos and messages. “**Organiser**” means the legal entity responsible for the Event.",
      ],
    },
    {
      title: "2. Eligibility & accounts",
      paragraphs: [
        "You must be at least 16 years old, or the age of digital consent in your jurisdiction, to use the Service. If you are under that age, a parent or guardian must accept these Terms on your behalf. You agree to provide accurate registration and medical information and to keep it up to date. You are responsible for activity that occurs under your profile and for keeping any access credentials confidential.",
      ],
    },
    {
      title: "3. The Service is not emergency medical care",
      paragraphs: [
        "The Service is a communications and coordination tool. It does not provide medical advice, diagnosis or treatment, and it is not a substitute for professional emergency services, telephone emergency lines, or on-site first aid. Response times, Medic availability, and the accuracy of any positioning or routing information cannot be guaranteed and depend on factors outside our control (network coverage, GPS accuracy, device battery, terrain and Event staffing). Never rely solely on the Service in an emergency.",
      ],
    },
    {
      title: "4. Location data & how it is used",
      paragraphs: [
        "When you join an Event, the Service collects your device’s geolocation — including in the background while the Event is active, if you grant that permission — and shares it with Race Command and assigned Medics. This enables responders to find you, to estimate arrival times, and to direct help to the right place. Your live position is visible to the Event’s authorised safety personnel for the duration of the Event. You can disable location sharing at any time through your device settings, but doing so will limit or prevent the Service’s safety features from working.",
      ],
    },
    {
      title: "5. Incident reports & acceptable use",
      paragraphs: ["You agree that you will not:"],
      bullets: [
        "submit false, misleading or malicious incident reports, or trigger false alarms;",
        "impersonate another participant, Medic or official;",
        "upload unlawful, offensive or infringing Content;",
        "interfere with, overload, reverse-engineer, or attempt to gain unauthorised access to the Service or its infrastructure;",
        "use the Service for any purpose other than your own participation and safety at the Event.",
      ],
    },
    {
      title: "6. Privacy & data protection",
      paragraphs: [
        "We process personal data in accordance with the EU General Data Protection Regulation (GDPR) and applicable national law. The categories of data we process include your identity and contact details, bib/registration data, geolocation, incident reports, and any medical information you choose to provide (such as allergies, conditions and emergency contacts).",
        "**Lawful basis.** Geolocation and incident data are processed to provide the safety service you have requested (Art. 6(1)(b)) and, where processing is necessary to respond to a medical emergency, to protect your or another person’s vital interests (Art. 6(1)(d)). Health data you provide is special-category data processed on the basis of your explicit consent (Art. 9(2)(a)) and/or to protect vital interests where you are physically or legally incapable of giving consent (Art. 9(2)(c)).",
        "**Recipients.** Your data is shared only with Race Command, assigned Medics, and the Organiser for the purpose of Event safety, and with our hosting and mapping/routing sub-processors strictly as needed to run the Service. We do not sell your personal data or use it for advertising.",
        "**Retention.** Live location data is retained only for the duration of the Event and a short period thereafter for incident review and safety auditing, after which it is deleted or anonymised. Incident records may be retained longer where required to comply with legal obligations or to establish, exercise or defend legal claims.",
        "**Your rights.** Subject to applicable law, you have the right to access, rectify, erase, restrict or object to the processing of your personal data, the right to data portability, and the right to withdraw consent at any time (without affecting processing carried out before withdrawal). You also have the right to lodge a complaint with your local data protection authority. To exercise these rights, contact us using the details in Section 14.",
      ],
    },
    {
      title: "7. Third-party services",
      paragraphs: [
        "The Service relies on third-party providers for mapping, tiles, geocoding and route calculation, and on mobile platform services for location and notifications. Your use of those features may also be subject to the relevant third party’s terms. We are not responsible for the availability or accuracy of third-party data.",
      ],
    },
    {
      title: "8. Intellectual property",
      paragraphs: [
        "The Service, including its software, design, trademarks and content (excluding your Content), is owned by us or our licensors and is protected by intellectual-property laws. We grant you a limited, personal, non-exclusive, non-transferable and revocable licence to use the Service for participating in an Event. You retain ownership of your Content but grant us a licence to host, process and transmit it as necessary to operate the Service and provide the safety functions described in these Terms.",
      ],
    },
    {
      title: "9. Disclaimers",
      paragraphs: [
        "To the maximum extent permitted by law, the Service is provided “as is” and “as available”, without warranties of any kind, whether express or implied, including warranties of merchantability, fitness for a particular purpose, accuracy, reliability, uninterrupted availability or non-infringement. We do not warrant that the Service will be error-free, secure, or available at all times, or that location, routing or timing information will be accurate.",
      ],
    },
    {
      title: "10. Limitation of liability",
      paragraphs: [
        "Nothing in these Terms excludes or limits our liability for death or personal injury caused by our negligence, for fraud, or for any other liability that cannot be excluded under applicable law. Subject to that, to the maximum extent permitted by law we are not liable for any indirect, incidental, special, consequential or punitive damages, or for any loss arising from your reliance on the Service in an emergency, from delayed or failed responses, from inaccurate positioning, or from network, device or third-party failures. Where liability cannot be wholly excluded, our total aggregate liability arising out of or in connection with the Service is limited to the amount (if any) you paid to use it.",
      ],
    },
    {
      title: "11. Indemnity",
      paragraphs: [
        "You agree to indemnify and hold us, the Organiser and Race Command harmless from any claims, losses, liabilities and reasonable expenses arising out of your breach of these Terms, your misuse of the Service, or your submission of false or unlawful Content.",
      ],
    },
    {
      title: "12. Suspension & termination",
      paragraphs: [
        "We or the Organiser may suspend or terminate your access to the Service at any time, with or without notice, if you breach these Terms or if necessary to protect the safety or integrity of the Event. You may stop using the Service at any time. Sections that by their nature should survive termination (including those on privacy, intellectual property, disclaimers, liability and governing law) will continue to apply.",
      ],
    },
    {
      title: "13. Changes to these Terms",
      paragraphs: [
        "We may update these Terms from time to time. The “Last updated” date above reflects the latest version. Material changes will be brought to your attention where practicable. Continued use of the Service after changes take effect constitutes acceptance of the revised Terms.",
      ],
    },
    {
      title: "14. Governing law & contact",
      paragraphs: [
        "These Terms are governed by the laws of the jurisdiction in which the Organiser is established, without regard to conflict-of-laws rules, and the competent courts of that jurisdiction have exclusive jurisdiction, subject to any non-waivable consumer-protection rights you have under your local law. For questions about these Terms, to exercise your data-protection rights, or to report a problem, contact the Organiser or Race Command for your Event, or reach us through the support channel provided in the app.",
      ],
    },
  ],
  closing:
    "By using the Service you acknowledge that you have read and understood these Terms and our Privacy Notice and agree to them.",
};

const bg: TermsDoc = {
  title: "Общи условия",
  lastUpdated: `Последна актуализация: ${TERMS_LAST_UPDATED}`,
  intro:
    "Настоящите Общи условия (наричани „**Условията**“) представляват обвързващо споразумение между Вас („**Вие**“, „**Участникът**“ или „**Потребителят**“) и **Academy First Aid**, оператора на платформата RaceSafe („**Услугата**“, „**ние**“, „**нас**“ или „**нашия**“). Услугата се предоставя в подкрепа на безопасността по трасето и координацията на спешната медицинска помощ на организирани спортни събития. Като създавате профил, присъединявате се към събитие или по друг начин използвате Услугата, Вие потвърждавате, че сте прочели, разбрали и приемате да бъдете обвързани с настоящите Условия и с Уведомлението за поверителност по-долу. Ако не сте съгласни, не използвайте Услугата.",
  banner:
    "⚠️ Услугата е само помощно средство за безопасност на събитието. Тя **не** замества местните спешни служби. При всяка животозастрашаваща ситуация незабавно се обадете на **112** (или на местния спешен номер).",
  sections: [
    {
      title: "1. Определения",
      paragraphs: [
        "„**Събитие**“ означава организирано състезание, трасе или дейност, за което Услугата е активирана. „**Команден център**“ означава медицинският екип и екипът по безопасност и координация на събитието. „**Медик**“ означава лице, оторизирано от Командния център. „**Съдържание**“ означава всякакви данни, които подавате, включително сигнали за инциденти, данни за местоположение, медицинска информация, снимки и съобщения. „**Организатор**“ означава юридическото лице, отговорно за Събитието.",
      ],
    },
    {
      title: "2. Допустимост и профили",
      paragraphs: [
        "За да използвате Услугата, трябва да сте навършили поне 16 години или възрастта за цифрово съгласие във Вашата юрисдикция. Ако сте под тази възраст, родител или настойник трябва да приеме настоящите Условия от Ваше име. Вие се съгласявате да предоставяте точна регистрационна и медицинска информация и да я поддържате актуална. Носите отговорност за действията, извършени през Вашия профил, и за поверителността на всички данни за достъп.",
      ],
    },
    {
      title: "3. Услугата не е спешна медицинска помощ",
      paragraphs: [
        "Услугата е инструмент за комуникация и координация. Тя не предоставя медицински съвети, диагностика или лечение и не замества професионалните спешни служби, телефонните спешни линии или оказването на първа помощ на място. Времето за реакция, наличността на Медици и точността на каквато и да е информация за позициониране или маршрут не могат да бъдат гарантирани и зависят от фактори извън нашия контрол (покритие на мрежата, точност на GPS, заряд на батерията, терен и обезпечеността на Събитието с персонал). Никога не разчитайте единствено на Услугата при спешен случай.",
      ],
    },
    {
      title: "4. Данни за местоположение и тяхното използване",
      paragraphs: [
        "Когато се присъедините към Събитие, Услугата събира геолокацията на Вашето устройство — включително във фонов режим, докато Събитието е активно, ако предоставите това разрешение — и я споделя с Командния център и назначените Медици. Това позволява на отзовалите се да Ви открият, да преценят времето за пристигане и да насочат помощта на правилното място. Вашата позиция на живо е видима за оторизирания персонал по безопасност на Събитието за времетраенето на Събитието. Можете да изключите споделянето на местоположение по всяко време чрез настройките на Вашето устройство, но това ще ограничи или ще попречи на функциите за безопасност на Услугата да работят.",
      ],
    },
    {
      title: "5. Сигнали за инциденти и допустимо ползване",
      paragraphs: ["Вие се съгласявате, че няма да:"],
      bullets: [
        "подавате неверни, подвеждащи или злонамерени сигнали за инциденти, нито да задействате фалшиви тревоги;",
        "се представяте за друг участник, Медик или длъжностно лице;",
        "качвате незаконно, обидно или нарушаващо права Съдържание;",
        "пречите, претоварвате, извършвате обратно инженерство или да правите опити за неоторизиран достъп до Услугата или нейната инфраструктура;",
        "използвате Услугата за каквато и да е цел, различна от собственото Ви участие и безопасност на Събитието.",
      ],
    },
    {
      title: "6. Поверителност и защита на данните",
      paragraphs: [
        "Обработваме лични данни в съответствие с Общия регламент на ЕС относно защитата на данните (GDPR) и приложимото национално законодателство. Категориите данни, които обработваме, включват Вашите идентификационни и данни за контакт, стартов номер/регистрационни данни, геолокация, сигнали за инциденти и всяка медицинска информация, която решите да предоставите (като алергии, заболявания и лица за контакт при спешност).",
        "**Правно основание.** Данните за геолокация и инциденти се обработват, за да Ви предоставим заявената от Вас услуга за безопасност (чл. 6(1)(б)), а когато обработването е необходимо за реакция при медицинска спешност — за защита на Вашите или на друго лице жизненоважни интереси (чл. 6(1)(г)). Предоставените от Вас здравни данни са специална категория данни, обработвани въз основа на Вашето изрично съгласие (чл. 9(2)(а)) и/или за защита на жизненоважни интереси, когато сте физически или юридически неспособни да дадете съгласие (чл. 9(2)(в)).",
        "**Получатели.** Вашите данни се споделят само с Командния център, назначените Медици и Организатора с цел безопасност на Събитието, както и с нашите подизпълнители за хостинг и картографиране/маршрутизиране строго в необходимия за функционирането на Услугата обем. Не продаваме Вашите лични данни и не ги използваме за реклама.",
        "**Срок на съхранение.** Данните за местоположение на живо се съхраняват само за времетраенето на Събитието и за кратък период след това с цел преглед на инциденти и одит на безопасността, след което се изтриват или анонимизират. Записите за инциденти може да се съхраняват по-дълго, когато това се изисква за спазване на законови задължения или за установяване, упражняване или защита на правни претенции.",
        "**Вашите права.** При спазване на приложимото право имате право на достъп, коригиране, изтриване, ограничаване или възражение срещу обработването на личните Ви данни, право на преносимост на данните и право да оттеглите съгласието си по всяко време (без това да засяга обработването, извършено преди оттеглянето). Имате също така право да подадете жалба до Вашия местен надзорен орган за защита на данните. За да упражните тези права, свържете се с нас чрез данните в Раздел 14.",
      ],
    },
    {
      title: "7. Услуги на трети страни",
      paragraphs: [
        "Услугата разчита на доставчици — трети страни за картографиране, тайлове, геокодиране и изчисляване на маршрути, както и на услугите на мобилната платформа за местоположение и известия. Използването на тези функции може да подлежи и на условията на съответната трета страна. Не носим отговорност за наличността или точността на данните на трети страни.",
      ],
    },
    {
      title: "8. Интелектуална собственост",
      paragraphs: [
        "Услугата, включително нейният софтуер, дизайн, търговски марки и съдържание (с изключение на Вашето Съдържание), е собственост на нас или на нашите лицензодатели и е защитена от законите за интелектуална собственост. Предоставяме Ви ограничен, личен, неизключителен, непрехвърляем и отменим лиценз да използвате Услугата за участие в Събитие. Вие запазвате собствеността върху Вашето Съдържание, но ни предоставяте лиценз да го хостваме, обработваме и предаваме, доколкото е необходимо за функционирането на Услугата и за предоставяне на описаните в настоящите Условия функции за безопасност.",
      ],
    },
    {
      title: "9. Отказ от гаранции",
      paragraphs: [
        "В максималната допустима от закона степен Услугата се предоставя „във вида, в който е“ и „според наличността“, без каквито и да е гаранции, изрични или подразбиращи се, включително гаранции за продаваемост, годност за определена цел, точност, надеждност, непрекъсната наличност или ненарушаване на права. Не гарантираме, че Услугата ще бъде без грешки, сигурна или достъпна по всяко време, нито че информацията за местоположение, маршрут или време ще бъде точна.",
      ],
    },
    {
      title: "10. Ограничаване на отговорността",
      paragraphs: [
        "Нищо в настоящите Условия не изключва и не ограничава нашата отговорност за смърт или телесна повреда, причинени от наша небрежност, за измама или за всяка друга отговорност, която не може да бъде изключена съгласно приложимото право. При спазване на това, в максималната допустима от закона степен не носим отговорност за каквито и да е непреки, случайни, специални, последващи или наказателни вреди, нито за загуби, произтичащи от Вашето разчитане на Услугата при спешен случай, от забавени или неуспешни реакции, от неточно позициониране или от повреди в мрежата, устройството или при трети страни. Когато отговорността не може да бъде изцяло изключена, нашата обща съвкупна отговорност, произтичаща от или във връзка с Услугата, е ограничена до сумата (ако има такава), която сте платили за нейното използване.",
      ],
    },
    {
      title: "11. Обезщетение",
      paragraphs: [
        "Вие се съгласявате да обезщетите и да предпазите нас, Организатора и Командния център от всякакви претенции, загуби, отговорности и разумни разходи, произтичащи от нарушаване на настоящите Условия от Ваша страна, от злоупотреба с Услугата или от подаване на неверно или незаконно Съдържание.",
      ],
    },
    {
      title: "12. Спиране и прекратяване",
      paragraphs: [
        "Ние или Организаторът можем да спрем или прекратим Вашия достъп до Услугата по всяко време, със или без предизвестие, ако нарушите настоящите Условия или ако това е необходимо за защита на безопасността или целостта на Събитието. Можете да прекратите използването на Услугата по всяко време. Разделите, които по своето естество следва да останат в сила след прекратяване (включително тези относно поверителност, интелектуална собственост, отказ от гаранции, отговорност и приложимо право), продължават да се прилагат.",
      ],
    },
    {
      title: "13. Промени в настоящите Условия",
      paragraphs: [
        "Можем да актуализираме настоящите Условия от време на време. Датата „Последна актуализация“ по-горе отразява най-новата версия. При възможност съществените промени ще бъдат доведени до Вашето внимание. Продължаването на използването на Услугата след влизането в сила на промените представлява приемане на изменените Условия.",
      ],
    },
    {
      title: "14. Приложимо право и контакт",
      paragraphs: [
        "Настоящите Условия се уреждат от законите на юрисдикцията, в която е установен Организаторът, без оглед на стълкновителните норми, като компетентните съдилища на тази юрисдикция имат изключителна компетентност, при спазване на всички неотменими права за защита на потребителите, които имате съгласно местното си право. За въпроси относно настоящите Условия, за упражняване на правата Ви за защита на данните или за подаване на сигнал за проблем се свържете с Организатора или Командния център на Вашето Събитие или с нас чрез канала за поддръжка в приложението.",
      ],
    },
  ],
  closing:
    "Като използвате Услугата, Вие потвърждавате, че сте прочели и разбрали настоящите Условия и нашето Уведомление за поверителност и сте съгласни с тях.",
};

const uk: TermsDoc = {
  title: "Умови та положення",
  lastUpdated: `Останнє оновлення: ${TERMS_LAST_UPDATED}`,
  intro:
    "Ці Умови та положення (далі — „**Умови**“) становлять обов’язкову угоду між Вами („**Ви**“, „**Учасник**“ або „**Користувач**“) та **Academy First Aid**, оператором платформи RaceSafe („**Сервіс**“, „**ми**“, „**нас**“ або „**наш**“). Сервіс надається для підтримки безпеки на трасі та координації екстреної медичної допомоги на організованих спортивних заходах. Створюючи профіль, приєднуючись до заходу або іншим чином використовуючи Сервіс, Ви підтверджуєте, що прочитали, зрозуміли та погоджуєтесь дотримуватися цих Умов і нашого Повідомлення про конфіденційність, наведеного нижче. Якщо Ви не згодні, не використовуйте Сервіс.",
  banner:
    "⚠️ Сервіс є лише допоміжним засобом для безпеки заходу. Він **не** замінює місцеві служби екстреної допомоги. У будь-якій ситуації, що загрожує життю, негайно телефонуйте **112** (або на місцевий номер екстреної допомоги).",
  sections: [
    {
      title: "1. Визначення",
      paragraphs: [
        "„**Захід**“ означає організовані перегони, трасу чи діяльність, для яких активовано Сервіс. „**Командний центр**“ означає медичну команду та команду з безпеки й координації заходу. „**Медик**“ означає рятувальника, уповноваженого Командним центром. „**Контент**“ означає будь-які дані, які Ви подаєте, зокрема повідомлення про інциденти, дані про місцезнаходження, медичну інформацію, фотографії та повідомлення. „**Організатор**“ означає юридичну особу, відповідальну за Захід.",
      ],
    },
    {
      title: "2. Право на використання та облікові записи",
      paragraphs: [
        "Щоб користуватися Сервісом, Вам має бути щонайменше 16 років або вік цифрової згоди у Вашій юрисдикції. Якщо Ви молодші за цей вік, ці Умови від Вашого імені має прийняти один з батьків або опікун. Ви погоджуєтеся надавати точну реєстраційну та медичну інформацію й підтримувати її в актуальному стані. Ви несете відповідальність за дії, що здійснюються під Вашим профілем, і за збереження конфіденційності будь-яких облікових даних.",
      ],
    },
    {
      title: "3. Сервіс не є екстреною медичною допомогою",
      paragraphs: [
        "Сервіс є інструментом для зв’язку та координації. Він не надає медичних порад, діагностики чи лікування і не замінює професійні служби екстреної допомоги, телефонні лінії екстреної допомоги або надання першої допомоги на місці. Час реагування, наявність Медиків і точність будь-якої інформації про позиціонування чи маршрут не можуть бути гарантовані та залежать від чинників поза нашим контролем (покриття мережі, точність GPS, заряд батареї, рельєф і укомплектованість Заходу персоналом). Ніколи не покладайтеся виключно на Сервіс у разі надзвичайної ситуації.",
      ],
    },
    {
      title: "4. Дані про місцезнаходження та їх використання",
      paragraphs: [
        "Коли Ви приєднуєтеся до Заходу, Сервіс збирає геолокацію Вашого пристрою — зокрема у фоновому режимі, поки Захід активний, якщо Ви надасте такий дозвіл — і надає її Командному центру та призначеним Медикам. Це дає змогу рятувальникам знайти Вас, оцінити час прибуття та спрямувати допомогу в потрібне місце. Ваше місцезнаходження в реальному часі видиме для уповноваженого персоналу з безпеки Заходу протягом усього Заходу. Ви можете вимкнути надання даних про місцезнаходження будь-коли в налаштуваннях пристрою, але це обмежить або унеможливить роботу функцій безпеки Сервісу.",
      ],
    },
    {
      title: "5. Повідомлення про інциденти та допустиме використання",
      paragraphs: ["Ви погоджуєтесь, що не будете:"],
      bullets: [
        "подавати неправдиві, оманливі чи зловмисні повідомлення про інциденти або здіймати неправдиву тривогу;",
        "видавати себе за іншого учасника, Медика чи посадову особу;",
        "завантажувати незаконний, образливий контент або такий, що порушує права;",
        "заважати, перевантажувати, здійснювати зворотне проєктування чи намагатися отримати несанкціонований доступ до Сервісу або його інфраструктури;",
        "використовувати Сервіс із будь-якою метою, окрім власної участі та безпеки на Заході.",
      ],
    },
    {
      title: "6. Конфіденційність і захист даних",
      paragraphs: [
        "Ми обробляємо персональні дані відповідно до Загального регламенту ЄС про захист даних (GDPR) та чинного національного законодавства. Категорії даних, які ми обробляємо, охоплюють Ваші ідентифікаційні та контактні дані, стартовий номер/реєстраційні дані, геолокацію, повідомлення про інциденти та будь-яку медичну інформацію, яку Ви вирішите надати (як-от алергії, захворювання та контактні особи на випадок надзвичайної ситуації).",
        "**Правова підстава.** Дані геолокації та інцидентів обробляються для надання запитаної Вами послуги з безпеки (ст. 6(1)(b)), а коли обробка необхідна для реагування на медичну надзвичайну ситуацію — для захисту життєво важливих інтересів Вас чи іншої особи (ст. 6(1)(d)). Надані Вами дані про здоров’я є особливою категорією даних, що обробляються на підставі Вашої явної згоди (ст. 9(2)(a)) та/або для захисту життєво важливих інтересів, коли Ви фізично чи юридично неспроможні надати згоду (ст. 9(2)(c)).",
        "**Одержувачі.** Ваші дані надаються лише Командному центру, призначеним Медикам та Організатору з метою безпеки Заходу, а також нашим субпідрядникам з хостингу та картографування/маршрутизації виключно в обсязі, необхідному для роботи Сервісу. Ми не продаємо Ваші персональні дані та не використовуємо їх для реклами.",
        "**Зберігання.** Дані про місцезнаходження в реальному часі зберігаються лише протягом Заходу та короткого періоду після нього для розгляду інцидентів та аудиту безпеки, після чого видаляються або знеособлюються. Записи про інциденти можуть зберігатися довше, якщо це потрібно для виконання юридичних зобов’язань або для встановлення, реалізації чи захисту правових вимог.",
        "**Ваші права.** З урахуванням чинного законодавства Ви маєте право на доступ, виправлення, видалення, обмеження чи заперечення щодо обробки Ваших персональних даних, право на перенесення даних і право відкликати згоду будь-коли (без впливу на обробку, здійснену до відкликання). Ви також маєте право подати скаргу до місцевого органу із захисту даних. Щоб реалізувати ці права, зв’яжіться з нами за реквізитами в Розділі 14.",
      ],
    },
    {
      title: "7. Послуги третіх сторін",
      paragraphs: [
        "Сервіс покладається на сторонніх постачальників для картографування, тайлів, геокодування та розрахунку маршрутів, а також на послуги мобільної платформи для визначення місцезнаходження та сповіщень. Використання цих функцій може також підлягати умовам відповідної третьої сторони. Ми не несемо відповідальності за доступність чи точність даних третіх сторін.",
      ],
    },
    {
      title: "8. Інтелектуальна власність",
      paragraphs: [
        "Сервіс, зокрема його програмне забезпечення, дизайн, торговельні марки та контент (за винятком Вашого Контенту), належить нам або нашим ліцензіарам і захищений законами про інтелектуальну власність. Ми надаємо Вам обмежену, особисту, невиключну, без права передачі та відкличну ліцензію на використання Сервісу для участі в Заході. Ви зберігаєте право власності на Ваш Контент, але надаєте нам ліцензію на його розміщення, обробку та передавання в обсязі, необхідному для роботи Сервісу й надання функцій безпеки, описаних у цих Умовах.",
      ],
    },
    {
      title: "9. Відмова від гарантій",
      paragraphs: [
        "У максимально дозволеному законом обсязі Сервіс надається „як є“ та „як доступно“, без жодних гарантій, явних чи неявних, зокрема гарантій придатності для продажу, придатності для певної мети, точності, надійності, безперебійної доступності чи невід’ємності прав. Ми не гарантуємо, що Сервіс буде безпомилковим, безпечним чи доступним повсякчас, а також що інформація про місцезнаходження, маршрут чи час буде точною.",
      ],
    },
    {
      title: "10. Обмеження відповідальності",
      paragraphs: [
        "Ніщо в цих Умовах не виключає та не обмежує нашу відповідальність за смерть чи тілесні ушкодження, спричинені нашою недбалістю, за шахрайство чи за будь-яку іншу відповідальність, яку не можна виключити згідно з чинним законодавством. З урахуванням цього, у максимально дозволеному законом обсязі ми не несемо відповідальності за будь-які непрямі, випадкові, особливі, опосередковані чи штрафні збитки, а також за будь-які втрати, що виникають унаслідок Вашого покладання на Сервіс у надзвичайній ситуації, через затримані чи невдалі реагування, неточне позиціонування або збої мережі, пристрою чи третіх сторін. Якщо відповідальність не може бути повністю виключена, наша сукупна відповідальність, що виникає з Сервісу або у зв’язку з ним, обмежується сумою (за наявності), яку Ви сплатили за його використання.",
      ],
    },
    {
      title: "11. Відшкодування",
      paragraphs: [
        "Ви погоджуєтеся відшкодувати та захистити нас, Організатора й Командний центр від будь-яких претензій, втрат, зобов’язань і обґрунтованих витрат, що виникають унаслідок порушення Вами цих Умов, неналежного використання Сервісу чи подання Вами неправдивого або незаконного Контенту.",
      ],
    },
    {
      title: "12. Призупинення та припинення",
      paragraphs: [
        "Ми або Організатор можемо призупинити чи припинити Ваш доступ до Сервісу будь-коли, з повідомленням або без нього, якщо Ви порушуєте ці Умови або якщо це необхідно для захисту безпеки чи цілісності Заходу. Ви можете припинити користування Сервісом будь-коли. Розділи, які за своєю природою мають залишатися чинними після припинення (зокрема щодо конфіденційності, інтелектуальної власності, відмови від гарантій, відповідальності та застосовного права), продовжують діяти.",
      ],
    },
    {
      title: "13. Зміни до цих Умов",
      paragraphs: [
        "Час від часу ми можемо оновлювати ці Умови. Дата „Останнє оновлення“ вище відображає найновішу версію. За можливості про суттєві зміни Вас буде повідомлено. Подальше використання Сервісу після набуття змінами чинності означає прийняття переглянутих Умов.",
      ],
    },
    {
      title: "14. Застосовне право та контакти",
      paragraphs: [
        "Ці Умови регулюються законодавством юрисдикції, у якій зареєстрований Організатор, без огляду на колізійні норми, а компетентні суди цієї юрисдикції мають виключну юрисдикцію, з урахуванням будь-яких невідмовних прав на захист прав споживачів, які Ви маєте за місцевим законодавством. З питань щодо цих Умов, для реалізації Ваших прав на захист даних чи для повідомлення про проблему звертайтеся до Організатора або Командного центру Вашого Заходу чи до нас через канал підтримки в застосунку.",
      ],
    },
  ],
  closing:
    "Користуючись Сервісом, Ви підтверджуєте, що прочитали та зрозуміли ці Умови й наше Повідомлення про конфіденційність і погоджуєтесь із ними.",
};

const it: TermsDoc = {
  title: "Termini e condizioni",
  lastUpdated: `Ultimo aggiornamento: ${TERMS_LAST_UPDATED}`,
  intro:
    "I presenti Termini e condizioni (i „**Termini**“) costituiscono un accordo vincolante tra te („**tu**“, il „**Partecipante**“ o l’„**Utente**“) e **Academy First Aid**, il gestore della piattaforma RaceSafe (il „**Servizio**“, „**noi**“, „**ci**“ o „**nostro**“). Il Servizio è fornito per supportare la sicurezza sul percorso e il coordinamento dell’assistenza medica d’emergenza in eventi sportivi organizzati. Creando un profilo, partecipando a un evento o utilizzando in altro modo il Servizio, confermi di aver letto, compreso e accettato di essere vincolato dai presenti Termini e dalla nostra Informativa sulla privacy riportata di seguito. Se non accetti, non utilizzare il Servizio.",
  banner:
    "⚠️ Il Servizio è solo un ausilio alla sicurezza dell’evento. **Non** sostituisce i servizi di emergenza locali. In qualsiasi situazione di pericolo di vita, chiama immediatamente il **112** (o il numero di emergenza locale).",
  sections: [
    {
      title: "1. Definizioni",
      paragraphs: [
        "„**Evento**“ indica una gara, un percorso o un’attività organizzata per cui il Servizio è stato attivato. „**Comando Gara**“ indica il team medico e di coordinamento della sicurezza dell’evento. „**Soccorritore**“ indica un operatore autorizzato dal Comando Gara. „**Contenuto**“ indica qualsiasi dato che invii, comprese segnalazioni di incidenti, dati di localizzazione, informazioni mediche, foto e messaggi. „**Organizzatore**“ indica l’entità giuridica responsabile dell’Evento.",
      ],
    },
    {
      title: "2. Idoneità e account",
      paragraphs: [
        "Per utilizzare il Servizio devi avere almeno 16 anni o l’età del consenso digitale nella tua giurisdizione. Se sei al di sotto di tale età, un genitore o tutore deve accettare i presenti Termini per tuo conto. Accetti di fornire informazioni di registrazione e mediche accurate e di mantenerle aggiornate. Sei responsabile delle attività svolte tramite il tuo profilo e della riservatezza di eventuali credenziali di accesso.",
      ],
    },
    {
      title: "3. Il Servizio non è assistenza medica d’emergenza",
      paragraphs: [
        "Il Servizio è uno strumento di comunicazione e coordinamento. Non fornisce consulenza, diagnosi o trattamento medico e non sostituisce i servizi di emergenza professionali, le linee telefoniche di emergenza o il primo soccorso sul posto. I tempi di risposta, la disponibilità dei Soccorritori e l’accuratezza di qualsiasi informazione di posizionamento o di percorso non possono essere garantiti e dipendono da fattori al di fuori del nostro controllo (copertura di rete, precisione del GPS, batteria del dispositivo, terreno e personale dell’Evento). Non affidarti mai esclusivamente al Servizio in caso di emergenza.",
      ],
    },
    {
      title: "4. Dati di localizzazione e relativo utilizzo",
      paragraphs: [
        "Quando partecipi a un Evento, il Servizio raccoglie la geolocalizzazione del tuo dispositivo — anche in background mentre l’Evento è attivo, se concedi tale autorizzazione — e la condivide con il Comando Gara e i Soccorritori assegnati. Ciò consente ai soccorritori di trovarti, stimare i tempi di arrivo e indirizzare l’aiuto nel posto giusto. La tua posizione in tempo reale è visibile al personale di sicurezza autorizzato dell’Evento per tutta la durata dell’Evento. Puoi disattivare la condivisione della posizione in qualsiasi momento dalle impostazioni del dispositivo, ma ciò limiterà o impedirà il funzionamento delle funzioni di sicurezza del Servizio.",
      ],
    },
    {
      title: "5. Segnalazioni di incidenti e uso accettabile",
      paragraphs: ["Accetti che non:"],
      bullets: [
        "invierai segnalazioni di incidenti false, fuorvianti o dolose, né attiverai falsi allarmi;",
        "ti spaccerai per un altro partecipante, Soccorritore o funzionario;",
        "caricherai Contenuti illeciti, offensivi o lesivi di diritti;",
        "interferirai, sovraccaricherai, effettuerai reverse engineering o tenterai di ottenere accesso non autorizzato al Servizio o alla sua infrastruttura;",
        "utilizzerai il Servizio per scopi diversi dalla tua partecipazione e sicurezza all’Evento.",
      ],
    },
    {
      title: "6. Privacy e protezione dei dati",
      paragraphs: [
        "Trattiamo i dati personali in conformità al Regolamento generale dell’UE sulla protezione dei dati (GDPR) e alla legge nazionale applicabile. Le categorie di dati che trattiamo comprendono i tuoi dati identificativi e di contatto, il pettorale/dati di registrazione, la geolocalizzazione, le segnalazioni di incidenti e qualsiasi informazione medica che scegli di fornire (come allergie, patologie e contatti di emergenza).",
        "**Base giuridica.** I dati di geolocalizzazione e di incidente sono trattati per fornirti il servizio di sicurezza che hai richiesto (art. 6(1)(b)) e, ove il trattamento sia necessario per rispondere a un’emergenza medica, per tutelare gli interessi vitali tuoi o di un’altra persona (art. 6(1)(d)). I dati sanitari che fornisci appartengono a categorie particolari e sono trattati sulla base del tuo consenso esplicito (art. 9(2)(a)) e/o per tutelare interessi vitali quando sei fisicamente o giuridicamente incapace di prestare il consenso (art. 9(2)(c)).",
        "**Destinatari.** I tuoi dati sono condivisi solo con il Comando Gara, i Soccorritori assegnati e l’Organizzatore ai fini della sicurezza dell’Evento, e con i nostri responsabili del trattamento per l’hosting e la cartografia/instradamento strettamente nella misura necessaria a far funzionare il Servizio. Non vendiamo i tuoi dati personali né li utilizziamo per finalità pubblicitarie.",
        "**Conservazione.** I dati di posizione in tempo reale sono conservati solo per la durata dell’Evento e per un breve periodo successivo, ai fini della revisione degli incidenti e dell’audit di sicurezza, dopodiché sono cancellati o anonimizzati. I registri degli incidenti possono essere conservati più a lungo ove necessario per adempiere a obblighi di legge o per accertare, esercitare o difendere diritti in sede giudiziaria.",
        "**I tuoi diritti.** Fatta salva la legge applicabile, hai il diritto di accedere, rettificare, cancellare, limitare od opporti al trattamento dei tuoi dati personali, il diritto alla portabilità dei dati e il diritto di revocare il consenso in qualsiasi momento (senza pregiudicare il trattamento svolto prima della revoca). Hai inoltre il diritto di proporre reclamo alla tua autorità locale per la protezione dei dati. Per esercitare tali diritti, contattaci tramite i recapiti indicati nella Sezione 14.",
      ],
    },
    {
      title: "7. Servizi di terze parti",
      paragraphs: [
        "Il Servizio si avvale di fornitori terzi per cartografia, tile, geocodifica e calcolo dei percorsi, nonché dei servizi della piattaforma mobile per posizione e notifiche. L’uso di tali funzioni può essere soggetto anche ai termini della relativa terza parte. Non siamo responsabili della disponibilità o dell’accuratezza dei dati di terze parti.",
      ],
    },
    {
      title: "8. Proprietà intellettuale",
      paragraphs: [
        "Il Servizio, compresi software, design, marchi e contenuti (esclusi i tuoi Contenuti), è di proprietà nostra o dei nostri licenzianti ed è protetto dalle leggi sulla proprietà intellettuale. Ti concediamo una licenza limitata, personale, non esclusiva, non trasferibile e revocabile per utilizzare il Servizio ai fini della partecipazione a un Evento. Conservi la proprietà dei tuoi Contenuti ma ci concedi una licenza per ospitarli, trattarli e trasmetterli nella misura necessaria a far funzionare il Servizio e a fornire le funzioni di sicurezza descritte nei presenti Termini.",
      ],
    },
    {
      title: "9. Esclusioni di garanzia",
      paragraphs: [
        "Nella misura massima consentita dalla legge, il Servizio è fornito „così com’è“ e „come disponibile“, senza garanzie di alcun tipo, espresse o implicite, comprese le garanzie di commerciabilità, idoneità a uno scopo particolare, accuratezza, affidabilità, disponibilità ininterrotta o non violazione di diritti. Non garantiamo che il Servizio sia privo di errori, sicuro o sempre disponibile, né che le informazioni di posizione, percorso o tempistica siano accurate.",
      ],
    },
    {
      title: "10. Limitazione di responsabilità",
      paragraphs: [
        "Nulla nei presenti Termini esclude o limita la nostra responsabilità per morte o lesioni personali causate da nostra negligenza, per frode o per qualsiasi altra responsabilità che non possa essere esclusa ai sensi della legge applicabile. Fermo restando quanto sopra, nella misura massima consentita dalla legge non siamo responsabili per danni indiretti, incidentali, speciali, consequenziali o punitivi, né per perdite derivanti dal tuo affidamento sul Servizio in un’emergenza, da risposte ritardate o mancate, da posizionamento impreciso o da guasti di rete, del dispositivo o di terze parti. Ove la responsabilità non possa essere del tutto esclusa, la nostra responsabilità complessiva derivante da o connessa al Servizio è limitata all’importo (se presente) che hai pagato per utilizzarlo.",
      ],
    },
    {
      title: "11. Manleva",
      paragraphs: [
        "Accetti di manlevare e tenere indenni noi, l’Organizzatore e il Comando Gara da qualsiasi pretesa, perdita, responsabilità e spesa ragionevole derivante dalla tua violazione dei presenti Termini, dall’uso improprio del Servizio o dall’invio da parte tua di Contenuti falsi o illeciti.",
      ],
    },
    {
      title: "12. Sospensione e risoluzione",
      paragraphs: [
        "Noi o l’Organizzatore possiamo sospendere o revocare il tuo accesso al Servizio in qualsiasi momento, con o senza preavviso, se violi i presenti Termini o se necessario per tutelare la sicurezza o l’integrità dell’Evento. Puoi smettere di usare il Servizio in qualsiasi momento. Le sezioni che per loro natura devono sopravvivere alla risoluzione (incluse quelle su privacy, proprietà intellettuale, esclusioni di garanzia, responsabilità e legge applicabile) continuano ad applicarsi.",
      ],
    },
    {
      title: "13. Modifiche ai presenti Termini",
      paragraphs: [
        "Possiamo aggiornare i presenti Termini di volta in volta. La data „Ultimo aggiornamento“ qui sopra riflette la versione più recente. Le modifiche sostanziali ti saranno comunicate ove possibile. L’uso continuato del Servizio dopo l’entrata in vigore delle modifiche costituisce accettazione dei Termini rivisti.",
      ],
    },
    {
      title: "14. Legge applicabile e contatti",
      paragraphs: [
        "I presenti Termini sono regolati dalle leggi della giurisdizione in cui ha sede l’Organizzatore, senza riguardo alle norme sui conflitti di legge, e i tribunali competenti di tale giurisdizione hanno giurisdizione esclusiva, fatti salvi i diritti inderogabili di tutela dei consumatori spettanti in base alla tua legge locale. Per domande sui presenti Termini, per esercitare i tuoi diritti in materia di protezione dei dati o per segnalare un problema, contatta l’Organizzatore o il Comando Gara del tuo Evento, o raggiungici tramite il canale di assistenza presente nell’app.",
      ],
    },
  ],
  closing:
    "Utilizzando il Servizio riconosci di aver letto e compreso i presenti Termini e la nostra Informativa sulla privacy e di accettarli.",
};

const de: TermsDoc = {
  title: "Allgemeine Geschäftsbedingungen",
  lastUpdated: `Zuletzt aktualisiert: ${TERMS_LAST_UPDATED}`,
  intro:
    "Diese Allgemeinen Geschäftsbedingungen (die „**Bedingungen**“) bilden eine verbindliche Vereinbarung zwischen Ihnen („**Sie**“, der „**Teilnehmer**“ oder „**Nutzer**“) und **Academy First Aid**, dem Betreiber der RaceSafe-Plattform (der „**Dienst**“, „**wir**“, „**uns**“ oder „**unser**“). Der Dienst wird bereitgestellt, um die Sicherheit auf der Strecke und die Koordination der medizinischen Notfallversorgung bei organisierten Sportveranstaltungen zu unterstützen. Indem Sie ein Profil erstellen, an einer Veranstaltung teilnehmen oder den Dienst anderweitig nutzen, bestätigen Sie, dass Sie diese Bedingungen und unsere nachstehende Datenschutzerklärung gelesen und verstanden haben und sich damit einverstanden erklären. Wenn Sie nicht einverstanden sind, nutzen Sie den Dienst nicht.",
  banner:
    "⚠️ Der Dienst ist lediglich eine Hilfe für die Sicherheit der Veranstaltung. Er ersetzt **nicht** die örtlichen Rettungsdienste. Rufen Sie in jeder lebensbedrohlichen Situation sofort **112** (oder Ihre örtliche Notrufnummer) an.",
  sections: [
    {
      title: "1. Begriffsbestimmungen",
      paragraphs: [
        "„**Veranstaltung**“ bezeichnet ein organisiertes Rennen, eine Strecke oder Aktivität, für die der Dienst aktiviert wurde. „**Einsatzleitung**“ bezeichnet das medizinische sowie das Sicherheits- und Koordinationsteam der Veranstaltung. „**Sanitäter**“ bezeichnet eine von der Einsatzleitung autorisierte Einsatzkraft. „**Inhalte**“ bezeichnet alle von Ihnen übermittelten Daten, einschließlich Vorfallmeldungen, Standortdaten, medizinischer Informationen, Fotos und Nachrichten. „**Veranstalter**“ bezeichnet die für die Veranstaltung verantwortliche juristische Person.",
      ],
    },
    {
      title: "2. Zugangsberechtigung und Konten",
      paragraphs: [
        "Um den Dienst zu nutzen, müssen Sie mindestens 16 Jahre alt sein oder das Alter der digitalen Einwilligung in Ihrer Rechtsordnung erreicht haben. Sind Sie jünger, muss ein Elternteil oder Erziehungsberechtigter diese Bedingungen in Ihrem Namen akzeptieren. Sie verpflichten sich, korrekte Registrierungs- und medizinische Angaben zu machen und diese aktuell zu halten. Sie sind für Aktivitäten verantwortlich, die unter Ihrem Profil erfolgen, sowie für die Vertraulichkeit etwaiger Zugangsdaten.",
      ],
    },
    {
      title: "3. Der Dienst ist keine medizinische Notfallversorgung",
      paragraphs: [
        "Der Dienst ist ein Kommunikations- und Koordinationswerkzeug. Er bietet keine medizinische Beratung, Diagnose oder Behandlung und ersetzt nicht professionelle Rettungsdienste, telefonische Notrufleitungen oder Erste Hilfe vor Ort. Reaktionszeiten, die Verfügbarkeit von Sanitätern und die Genauigkeit von Standort- oder Routeninformationen können nicht garantiert werden und hängen von Faktoren außerhalb unserer Kontrolle ab (Netzabdeckung, GPS-Genauigkeit, Akkustand des Geräts, Gelände und Personalausstattung der Veranstaltung). Verlassen Sie sich im Notfall niemals ausschließlich auf den Dienst.",
      ],
    },
    {
      title: "4. Standortdaten und deren Verwendung",
      paragraphs: [
        "Wenn Sie an einer Veranstaltung teilnehmen, erfasst der Dienst die Standortdaten Ihres Geräts — auch im Hintergrund, solange die Veranstaltung aktiv ist, sofern Sie diese Berechtigung erteilen — und teilt sie mit der Einsatzleitung und den zugewiesenen Sanitätern. Dadurch können Einsatzkräfte Sie finden, Ankunftszeiten abschätzen und Hilfe an den richtigen Ort lenken. Ihre Live-Position ist für das autorisierte Sicherheitspersonal der Veranstaltung für deren Dauer sichtbar. Sie können die Standortfreigabe jederzeit in den Geräteeinstellungen deaktivieren, dies schränkt jedoch die Sicherheitsfunktionen des Dienstes ein oder verhindert sie.",
      ],
    },
    {
      title: "5. Vorfallmeldungen und zulässige Nutzung",
      paragraphs: ["Sie verpflichten sich, Folgendes zu unterlassen:"],
      bullets: [
        "falsche, irreführende oder böswillige Vorfallmeldungen einzureichen oder Fehlalarme auszulösen;",
        "sich als anderer Teilnehmer, Sanitäter oder Offizieller auszugeben;",
        "rechtswidrige, anstößige oder rechtsverletzende Inhalte hochzuladen;",
        "den Dienst oder seine Infrastruktur zu stören, zu überlasten, zurückzuentwickeln oder sich unbefugten Zugang zu verschaffen;",
        "den Dienst zu anderen Zwecken als Ihrer eigenen Teilnahme und Sicherheit bei der Veranstaltung zu nutzen.",
      ],
    },
    {
      title: "6. Datenschutz",
      paragraphs: [
        "Wir verarbeiten personenbezogene Daten gemäß der EU-Datenschutz-Grundverordnung (DSGVO) und dem anwendbaren nationalen Recht. Zu den von uns verarbeiteten Datenkategorien gehören Ihre Identitäts- und Kontaktdaten, Startnummer-/Registrierungsdaten, Standortdaten, Vorfallmeldungen sowie alle medizinischen Informationen, die Sie freiwillig angeben (etwa Allergien, Erkrankungen und Notfallkontakte).",
        "**Rechtsgrundlage.** Standort- und Vorfalldaten werden verarbeitet, um den von Ihnen angeforderten Sicherheitsdienst bereitzustellen (Art. 6 Abs. 1 lit. b) und, soweit die Verarbeitung zur Reaktion auf einen medizinischen Notfall erforderlich ist, um lebenswichtige Interessen von Ihnen oder einer anderen Person zu schützen (Art. 6 Abs. 1 lit. d). Von Ihnen angegebene Gesundheitsdaten sind besondere Kategorien personenbezogener Daten und werden auf Grundlage Ihrer ausdrücklichen Einwilligung (Art. 9 Abs. 2 lit. a) und/oder zum Schutz lebenswichtiger Interessen verarbeitet, wenn Sie körperlich oder rechtlich nicht in der Lage sind, Ihre Einwilligung zu geben (Art. 9 Abs. 2 lit. c).",
        "**Empfänger.** Ihre Daten werden ausschließlich mit der Einsatzleitung, den zugewiesenen Sanitätern und dem Veranstalter zum Zweck der Veranstaltungssicherheit sowie mit unseren Auftragsverarbeitern für Hosting und Karten-/Routing strikt im erforderlichen Umfang zum Betrieb des Dienstes geteilt. Wir verkaufen Ihre personenbezogenen Daten nicht und nutzen sie nicht für Werbung.",
        "**Speicherdauer.** Live-Standortdaten werden nur für die Dauer der Veranstaltung und einen kurzen Zeitraum danach zur Vorfallüberprüfung und Sicherheitsauditierung gespeichert und anschließend gelöscht oder anonymisiert. Vorfallaufzeichnungen können länger aufbewahrt werden, soweit dies zur Erfüllung gesetzlicher Pflichten oder zur Geltendmachung, Ausübung oder Verteidigung von Rechtsansprüchen erforderlich ist.",
        "**Ihre Rechte.** Vorbehaltlich des anwendbaren Rechts haben Sie das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung oder Widerspruch gegen die Verarbeitung Ihrer personenbezogenen Daten, das Recht auf Datenübertragbarkeit sowie das Recht, Ihre Einwilligung jederzeit zu widerrufen (ohne dass die Rechtmäßigkeit der bis zum Widerruf erfolgten Verarbeitung berührt wird). Sie haben außerdem das Recht, bei Ihrer örtlichen Datenschutzaufsichtsbehörde Beschwerde einzulegen. Zur Ausübung dieser Rechte kontaktieren Sie uns über die in Abschnitt 14 genannten Angaben.",
      ],
    },
    {
      title: "7. Dienste Dritter",
      paragraphs: [
        "Der Dienst stützt sich auf Drittanbieter für Karten, Kacheln, Geokodierung und Routenberechnung sowie auf die Dienste der mobilen Plattform für Standort und Benachrichtigungen. Die Nutzung dieser Funktionen kann zusätzlich den Bedingungen des jeweiligen Dritten unterliegen. Für die Verfügbarkeit oder Richtigkeit von Drittanbieterdaten sind wir nicht verantwortlich.",
      ],
    },
    {
      title: "8. Geistiges Eigentum",
      paragraphs: [
        "Der Dienst, einschließlich seiner Software, seines Designs, seiner Marken und Inhalte (mit Ausnahme Ihrer Inhalte), steht im Eigentum von uns oder unseren Lizenzgebern und ist durch Rechte des geistigen Eigentums geschützt. Wir gewähren Ihnen eine beschränkte, persönliche, nicht ausschließliche, nicht übertragbare und widerrufliche Lizenz zur Nutzung des Dienstes für die Teilnahme an einer Veranstaltung. Sie behalten das Eigentum an Ihren Inhalten, gewähren uns jedoch eine Lizenz, diese zu hosten, zu verarbeiten und zu übertragen, soweit dies zum Betrieb des Dienstes und zur Bereitstellung der in diesen Bedingungen beschriebenen Sicherheitsfunktionen erforderlich ist.",
      ],
    },
    {
      title: "9. Haftungsausschlüsse",
      paragraphs: [
        "Soweit gesetzlich zulässig, wird der Dienst „wie besehen“ und „wie verfügbar“ bereitgestellt, ohne jegliche ausdrückliche oder stillschweigende Gewährleistung, einschließlich Gewährleistungen der Marktgängigkeit, Eignung für einen bestimmten Zweck, Genauigkeit, Zuverlässigkeit, ununterbrochenen Verfügbarkeit oder Nichtverletzung von Rechten. Wir gewährleisten nicht, dass der Dienst fehlerfrei, sicher oder jederzeit verfügbar ist oder dass Standort-, Routen- oder Zeitangaben zutreffend sind.",
      ],
    },
    {
      title: "10. Haftungsbeschränkung",
      paragraphs: [
        "Nichts in diesen Bedingungen schließt unsere Haftung für Tod oder Körperverletzung aufgrund unserer Fahrlässigkeit, für Betrug oder für jede andere Haftung aus oder beschränkt sie, die nach anwendbarem Recht nicht ausgeschlossen werden kann. Vorbehaltlich dessen haften wir, soweit gesetzlich zulässig, nicht für mittelbare, beiläufige, besondere, Folge- oder Strafschäden oder für Verluste, die sich aus Ihrem Vertrauen auf den Dienst in einem Notfall, aus verzögerten oder ausgebliebenen Reaktionen, aus ungenauer Positionsbestimmung oder aus Ausfällen von Netz, Gerät oder Dritten ergeben. Soweit die Haftung nicht vollständig ausgeschlossen werden kann, ist unsere Gesamthaftung im Zusammenhang mit dem Dienst auf den Betrag (sofern vorhanden) beschränkt, den Sie für dessen Nutzung gezahlt haben.",
      ],
    },
    {
      title: "11. Freistellung",
      paragraphs: [
        "Sie verpflichten sich, uns, den Veranstalter und die Einsatzleitung von allen Ansprüchen, Verlusten, Verbindlichkeiten und angemessenen Kosten freizustellen, die sich aus Ihrem Verstoß gegen diese Bedingungen, Ihrer missbräuchlichen Nutzung des Dienstes oder Ihrer Übermittlung falscher oder rechtswidriger Inhalte ergeben.",
      ],
    },
    {
      title: "12. Sperrung und Kündigung",
      paragraphs: [
        "Wir oder der Veranstalter können Ihren Zugang zum Dienst jederzeit mit oder ohne Vorankündigung sperren oder beenden, wenn Sie gegen diese Bedingungen verstoßen oder dies zum Schutz der Sicherheit oder Integrität der Veranstaltung erforderlich ist. Sie können die Nutzung des Dienstes jederzeit beenden. Abschnitte, die ihrer Natur nach die Beendigung überdauern sollen (einschließlich derjenigen zu Datenschutz, geistigem Eigentum, Haftungsausschlüssen, Haftung und anwendbarem Recht), gelten fort.",
      ],
    },
    {
      title: "13. Änderungen dieser Bedingungen",
      paragraphs: [
        "Wir können diese Bedingungen von Zeit zu Zeit aktualisieren. Das oben angegebene Datum „Zuletzt aktualisiert“ gibt die jeweils aktuelle Fassung wieder. Über wesentliche Änderungen werden wir Sie nach Möglichkeit informieren. Die fortgesetzte Nutzung des Dienstes nach Inkrafttreten der Änderungen gilt als Annahme der geänderten Bedingungen.",
      ],
    },
    {
      title: "14. Anwendbares Recht und Kontakt",
      paragraphs: [
        "Diese Bedingungen unterliegen dem Recht der Rechtsordnung, in der der Veranstalter niedergelassen ist, ungeachtet kollisionsrechtlicher Vorschriften, und die zuständigen Gerichte dieser Rechtsordnung haben die ausschließliche Zuständigkeit, vorbehaltlich etwaiger unabdingbarer Verbraucherschutzrechte, die Ihnen nach Ihrem örtlichen Recht zustehen. Bei Fragen zu diesen Bedingungen, zur Ausübung Ihrer Datenschutzrechte oder zur Meldung eines Problems wenden Sie sich an den Veranstalter oder die Einsatzleitung Ihrer Veranstaltung oder erreichen Sie uns über den in der App angebotenen Support-Kanal.",
      ],
    },
  ],
  closing:
    "Durch die Nutzung des Dienstes bestätigen Sie, dass Sie diese Bedingungen und unsere Datenschutzerklärung gelesen und verstanden haben und ihnen zustimmen.",
};

const ro: TermsDoc = {
  title: "Termeni și condiții",
  lastUpdated: `Ultima actualizare: ${TERMS_LAST_UPDATED}`,
  intro:
    "Acești Termeni și condiții („**Termenii**“) constituie un acord obligatoriu între dumneavoastră („**dumneavoastră**“, „**Participantul**“ sau „**Utilizatorul**“) și **Academy First Aid**, operatorul platformei RaceSafe („**Serviciul**“, „**noi**“, „**nouă**“ sau „**al nostru**“). Serviciul este furnizat pentru a sprijini siguranța pe traseu și coordonarea asistenței medicale de urgență la evenimente sportive organizate. Prin crearea unui profil, participarea la un eveniment sau utilizarea în alt mod a Serviciului, confirmați că ați citit, ați înțeles și sunteți de acord să respectați acești Termeni și Nota de informare privind confidențialitatea de mai jos. Dacă nu sunteți de acord, nu utilizați Serviciul.",
  banner:
    "⚠️ Serviciul este doar un ajutor pentru siguranța evenimentului. **Nu** înlocuiește serviciile locale de urgență. În orice situație care vă pune viața în pericol, sunați imediat la **112** (sau la numărul local de urgență).",
  sections: [
    {
      title: "1. Definiții",
      paragraphs: [
        "„**Eveniment**“ înseamnă o cursă, un traseu sau o activitate organizată pentru care Serviciul a fost activat. „**Comandamentul Cursei**“ înseamnă echipa medicală și de coordonare a siguranței evenimentului. „**Salvator**“ înseamnă o persoană autorizată de Comandamentul Cursei. „**Conținut**“ înseamnă orice date pe care le transmiteți, inclusiv rapoarte de incident, date de localizare, informații medicale, fotografii și mesaje. „**Organizator**“ înseamnă entitatea juridică responsabilă de Eveniment.",
      ],
    },
    {
      title: "2. Eligibilitate și conturi",
      paragraphs: [
        "Pentru a utiliza Serviciul, trebuie să aveți cel puțin 16 ani sau vârsta consimțământului digital din jurisdicția dumneavoastră. Dacă sunteți sub această vârstă, un părinte sau tutore trebuie să accepte acești Termeni în numele dumneavoastră. Sunteți de acord să furnizați informații de înregistrare și medicale exacte și să le mențineți actualizate. Sunteți responsabil pentru activitatea desfășurată sub profilul dumneavoastră și pentru păstrarea confidențialității oricăror date de acces.",
      ],
    },
    {
      title: "3. Serviciul nu reprezintă asistență medicală de urgență",
      paragraphs: [
        "Serviciul este un instrument de comunicare și coordonare. Nu oferă consultanță, diagnostic sau tratament medical și nu înlocuiește serviciile profesionale de urgență, liniile telefonice de urgență sau acordarea primului ajutor la fața locului. Timpii de răspuns, disponibilitatea Salvatorilor și acuratețea oricăror informații de poziționare sau de traseu nu pot fi garantate și depind de factori aflați în afara controlului nostru (acoperirea rețelei, precizia GPS, bateria dispozitivului, terenul și personalul Evenimentului). Nu vă bazați niciodată exclusiv pe Serviciu într-o situație de urgență.",
      ],
    },
    {
      title: "4. Datele de localizare și modul de utilizare",
      paragraphs: [
        "Când vă alăturați unui Eveniment, Serviciul colectează geolocalizarea dispozitivului dumneavoastră — inclusiv în fundal cât timp Evenimentul este activ, dacă acordați această permisiune — și o partajează cu Comandamentul Cursei și cu Salvatorii desemnați. Acest lucru permite echipelor de intervenție să vă găsească, să estimeze timpii de sosire și să direcționeze ajutorul în locul potrivit. Poziția dumneavoastră în timp real este vizibilă personalului de siguranță autorizat al Evenimentului pe durata Evenimentului. Puteți dezactiva partajarea locației în orice moment din setările dispozitivului, însă acest lucru va limita sau va împiedica funcționarea funcțiilor de siguranță ale Serviciului.",
      ],
    },
    {
      title: "5. Rapoarte de incident și utilizare acceptabilă",
      paragraphs: ["Sunteți de acord că nu veți:"],
      bullets: [
        "transmite rapoarte de incident false, înșelătoare sau rău intenționate și nu veți declanșa alarme false;",
        "vă da drept alt participant, Salvator sau oficial;",
        "încărca Conținut ilegal, ofensator sau care încalcă drepturi;",
        "interfera, supraîncărca, decompila ori încerca să obțineți acces neautorizat la Serviciu sau la infrastructura acestuia;",
        "utiliza Serviciul în alt scop decât propria participare și siguranță la Eveniment.",
      ],
    },
    {
      title: "6. Confidențialitate și protecția datelor",
      paragraphs: [
        "Prelucrăm datele cu caracter personal în conformitate cu Regulamentul general al UE privind protecția datelor (GDPR) și cu legislația națională aplicabilă. Categoriile de date pe care le prelucrăm includ datele dumneavoastră de identitate și de contact, numărul de concurs/datele de înregistrare, geolocalizarea, rapoartele de incident și orice informații medicale pe care alegeți să le furnizați (cum ar fi alergii, afecțiuni și persoane de contact în caz de urgență).",
        "**Temei juridic.** Datele de geolocalizare și de incident sunt prelucrate pentru a vă furniza serviciul de siguranță solicitat (art. 6 alin. (1) lit. (b)) și, atunci când prelucrarea este necesară pentru a răspunde unei urgențe medicale, pentru a proteja interesele vitale ale dumneavoastră sau ale altei persoane (art. 6 alin. (1) lit. (d)). Datele privind sănătatea pe care le furnizați sunt categorii speciale de date, prelucrate pe baza consimțământului dumneavoastră explicit (art. 9 alin. (2) lit. (a)) și/sau pentru a proteja interese vitale atunci când sunteți în incapacitate fizică sau juridică de a vă da consimțământul (art. 9 alin. (2) lit. (c)).",
        "**Destinatari.** Datele dumneavoastră sunt partajate numai cu Comandamentul Cursei, cu Salvatorii desemnați și cu Organizatorul în scopul siguranței Evenimentului, precum și cu împuterniciții noștri pentru găzduire și cartografiere/rutare, strict în măsura necesară pentru funcționarea Serviciului. Nu vindem datele dumneavoastră cu caracter personal și nu le utilizăm în scopuri publicitare.",
        "**Păstrare.** Datele de localizare în timp real sunt păstrate doar pe durata Evenimentului și pentru o scurtă perioadă ulterioară, în scopul analizării incidentelor și al auditului de siguranță, după care sunt șterse sau anonimizate. Înregistrările privind incidentele pot fi păstrate mai mult timp atunci când acest lucru este necesar pentru respectarea obligațiilor legale sau pentru constatarea, exercitarea ori apărarea unui drept în instanță.",
        "**Drepturile dumneavoastră.** Sub rezerva legislației aplicabile, aveți dreptul de acces, de rectificare, de ștergere, de restricționare sau de opoziție la prelucrarea datelor dumneavoastră cu caracter personal, dreptul la portabilitatea datelor și dreptul de a vă retrage consimțământul în orice moment (fără a afecta prelucrarea efectuată înainte de retragere). De asemenea, aveți dreptul de a depune o plângere la autoritatea locală de protecție a datelor. Pentru a exercita aceste drepturi, contactați-ne folosind detaliile din Secțiunea 14.",
      ],
    },
    {
      title: "7. Servicii ale terților",
      paragraphs: [
        "Serviciul se bazează pe furnizori terți pentru cartografiere, dale, geocodare și calcularea traseelor, precum și pe serviciile platformei mobile pentru localizare și notificări. Utilizarea acestor funcții poate fi supusă și termenilor terțului respectiv. Nu suntem responsabili pentru disponibilitatea sau acuratețea datelor terților.",
      ],
    },
    {
      title: "8. Proprietate intelectuală",
      paragraphs: [
        "Serviciul, inclusiv software-ul, designul, mărcile comerciale și conținutul (cu excepția Conținutului dumneavoastră), aparține nouă sau licențiatorilor noștri și este protejat de legile privind proprietatea intelectuală. Vă acordăm o licență limitată, personală, neexclusivă, netransferabilă și revocabilă de a utiliza Serviciul pentru a participa la un Eveniment. Păstrați dreptul de proprietate asupra Conținutului dumneavoastră, dar ne acordați o licență de a-l găzdui, prelucra și transmite în măsura necesară pentru funcționarea Serviciului și pentru furnizarea funcțiilor de siguranță descrise în acești Termeni.",
      ],
    },
    {
      title: "9. Declinarea garanțiilor",
      paragraphs: [
        "În măsura maximă permisă de lege, Serviciul este furnizat „ca atare“ și „în funcție de disponibilitate“, fără garanții de niciun fel, exprese sau implicite, inclusiv garanții de vandabilitate, de adecvare pentru un anumit scop, de acuratețe, de fiabilitate, de disponibilitate neîntreruptă sau de neîncălcare a drepturilor. Nu garantăm că Serviciul va fi lipsit de erori, sigur sau disponibil în orice moment ori că informațiile de localizare, de traseu sau de timp vor fi exacte.",
      ],
    },
    {
      title: "10. Limitarea răspunderii",
      paragraphs: [
        "Nimic din acești Termeni nu exclude și nu limitează răspunderea noastră pentru deces sau vătămare corporală cauzată de neglijența noastră, pentru fraudă sau pentru orice altă răspundere care nu poate fi exclusă conform legii aplicabile. Sub rezerva celor de mai sus, în măsura maximă permisă de lege nu suntem răspunzători pentru niciun fel de daune indirecte, incidentale, speciale, subsecvente sau punitive, nici pentru pierderi rezultate din faptul că v-ați bazat pe Serviciu într-o urgență, din răspunsuri întârziate sau eșuate, din poziționare inexactă ori din defecțiuni ale rețelei, ale dispozitivului sau ale terților. Atunci când răspunderea nu poate fi exclusă în totalitate, răspunderea noastră cumulată totală care decurge din sau în legătură cu Serviciul este limitată la suma (dacă există) pe care ați plătit-o pentru a-l utiliza.",
      ],
    },
    {
      title: "11. Despăgubire",
      paragraphs: [
        "Sunteți de acord să ne despăgubiți și să ne exonerați pe noi, pe Organizator și pe Comandamentul Cursei de orice pretenții, pierderi, obligații și cheltuieli rezonabile care decurg din încălcarea de către dumneavoastră a acestor Termeni, din utilizarea necorespunzătoare a Serviciului sau din transmiterea de către dumneavoastră a unui Conținut fals ori ilegal.",
      ],
    },
    {
      title: "12. Suspendare și încetare",
      paragraphs: [
        "Noi sau Organizatorul putem suspenda ori înceta accesul dumneavoastră la Serviciu în orice moment, cu sau fără preaviz, dacă încălcați acești Termeni sau dacă este necesar pentru a proteja siguranța ori integritatea Evenimentului. Puteți înceta utilizarea Serviciului în orice moment. Secțiunile care, prin natura lor, trebuie să rămână în vigoare după încetare (inclusiv cele privind confidențialitatea, proprietatea intelectuală, declinarea garanțiilor, răspunderea și legea aplicabilă) continuă să se aplice.",
      ],
    },
    {
      title: "13. Modificări ale acestor Termeni",
      paragraphs: [
        "Putem actualiza acești Termeni din când în când. Data „Ultima actualizare“ de mai sus reflectă cea mai recentă versiune. Modificările semnificative vă vor fi aduse la cunoștință acolo unde este posibil. Continuarea utilizării Serviciului după intrarea în vigoare a modificărilor constituie acceptarea Termenilor revizuiți.",
      ],
    },
    {
      title: "14. Legea aplicabilă și contact",
      paragraphs: [
        "Acești Termeni sunt guvernați de legile jurisdicției în care este stabilit Organizatorul, fără a ține seama de normele privind conflictul de legi, iar instanțele competente din acea jurisdicție au competență exclusivă, sub rezerva oricăror drepturi imperative de protecție a consumatorilor de care beneficiați conform legii dumneavoastră locale. Pentru întrebări privind acești Termeni, pentru exercitarea drepturilor dumneavoastră de protecție a datelor sau pentru a raporta o problemă, contactați Organizatorul ori Comandamentul Cursei al Evenimentului dumneavoastră sau contactați-ne prin canalul de asistență din aplicație.",
      ],
    },
  ],
  closing:
    "Prin utilizarea Serviciului confirmați că ați citit și ați înțeles acești Termeni și Nota noastră de informare privind confidențialitatea și că sunteți de acord cu acestea.",
};

const ru: TermsDoc = {
  title: "Условия и положения",
  lastUpdated: `Последнее обновление: ${TERMS_LAST_UPDATED}`,
  intro:
    "Настоящие Условия и положения («**Условия**») представляют собой обязывающее соглашение между вами («**вы**», «**Участник**» или «**Пользователь**») и **Academy First Aid**, оператором платформы RaceSafe («**Сервис**», «**мы**», «**нас**» или «**наш**»). Сервис предоставляется для обеспечения безопасности на трассе и координации экстренной медицинской помощи на организованных спортивных мероприятиях. Создавая профиль, присоединяясь к мероприятию или иным образом используя Сервис, вы подтверждаете, что прочитали, поняли и согласны соблюдать настоящие Условия и приведённое ниже Уведомление о конфиденциальности. Если вы не согласны, не используйте Сервис.",
  banner:
    "⚠️ Сервис является лишь вспомогательным средством для обеспечения безопасности мероприятия. Он **не** заменяет местные службы экстренной помощи. В любой угрожающей жизни ситуации немедленно звоните **112** (или по местному номеру экстренной помощи).",
  sections: [
    {
      title: "1. Определения",
      paragraphs: [
        "«**Мероприятие**» означает организованный забег, трассу или активность, для которых активирован Сервис. «**Командный центр**» означает медицинскую команду и команду по безопасности и координации мероприятия. «**Медик**» означает спасателя, уполномоченного Командным центром. «**Контент**» означает любые данные, которые вы передаёте, включая сообщения об инцидентах, данные о местоположении, медицинскую информацию, фотографии и сообщения. «**Организатор**» означает юридическое лицо, ответственное за Мероприятие.",
      ],
    },
    {
      title: "2. Право на использование и учётные записи",
      paragraphs: [
        "Для использования Сервиса вам должно быть не менее 16 лет или достигнут возраст цифрового согласия в вашей юрисдикции. Если вы младше этого возраста, родитель или опекун должен принять настоящие Условия от вашего имени. Вы соглашаетесь предоставлять точные регистрационные и медицинские сведения и поддерживать их в актуальном состоянии. Вы несёте ответственность за действия, совершаемые под вашим профилем, и за сохранение конфиденциальности любых учётных данных.",
      ],
    },
    {
      title: "3. Сервис не является экстренной медицинской помощью",
      paragraphs: [
        "Сервис является инструментом связи и координации. Он не предоставляет медицинских консультаций, диагностики или лечения и не заменяет профессиональные службы экстренной помощи, телефонные линии экстренной помощи или оказание первой помощи на месте. Время реагирования, наличие Медиков и точность любой информации о позиционировании или маршруте не могут быть гарантированы и зависят от факторов вне нашего контроля (покрытие сети, точность GPS, заряд батареи устройства, рельеф местности и укомплектованность Мероприятия персоналом). Никогда не полагайтесь исключительно на Сервис в чрезвычайной ситуации.",
      ],
    },
    {
      title: "4. Данные о местоположении и их использование",
      paragraphs: [
        "Когда вы присоединяетесь к Мероприятию, Сервис собирает геолокацию вашего устройства — в том числе в фоновом режиме, пока Мероприятие активно, если вы предоставите такое разрешение, — и передаёт её Командному центру и назначенным Медикам. Это позволяет спасателям найти вас, оценить время прибытия и направить помощь в нужное место. Ваше местоположение в реальном времени видно уполномоченному персоналу по безопасности Мероприятия в течение всего Мероприятия. Вы можете отключить передачу местоположения в любое время в настройках устройства, но это ограничит или сделает невозможной работу функций безопасности Сервиса.",
      ],
    },
    {
      title: "5. Сообщения об инцидентах и допустимое использование",
      paragraphs: ["Вы соглашаетесь, что не будете:"],
      bullets: [
        "подавать ложные, вводящие в заблуждение или злонамеренные сообщения об инцидентах либо поднимать ложную тревогу;",
        "выдавать себя за другого участника, Медика или должностное лицо;",
        "загружать незаконный, оскорбительный или нарушающий права Контент;",
        "вмешиваться, перегружать, осуществлять обратную разработку или пытаться получить несанкционированный доступ к Сервису или его инфраструктуре;",
        "использовать Сервис в любых целях, кроме собственного участия и безопасности на Мероприятии.",
      ],
    },
    {
      title: "6. Конфиденциальность и защита данных",
      paragraphs: [
        "Мы обрабатываем персональные данные в соответствии с Общим регламентом ЕС о защите данных (GDPR) и применимым национальным законодательством. Категории обрабатываемых нами данных включают ваши идентификационные и контактные данные, стартовый номер/регистрационные данные, геолокацию, сообщения об инцидентах и любую медицинскую информацию, которую вы решите предоставить (например, аллергии, заболевания и контактные лица для экстренных случаев).",
        "**Правовое основание.** Данные геолокации и об инцидентах обрабатываются для предоставления запрошенной вами услуги по обеспечению безопасности (ст. 6(1)(b)), а когда обработка необходима для реагирования на медицинскую чрезвычайную ситуацию — для защиты жизненно важных интересов вас или другого лица (ст. 6(1)(d)). Предоставленные вами данные о состоянии здоровья относятся к особой категории данных и обрабатываются на основании вашего явного согласия (ст. 9(2)(a)) и/или для защиты жизненно важных интересов, когда вы физически или юридически неспособны дать согласие (ст. 9(2)(c)).",
        "**Получатели.** Ваши данные передаются только Командному центру, назначенным Медикам и Организатору в целях безопасности Мероприятия, а также нашим субподрядчикам по хостингу и картографии/маршрутизации строго в объёме, необходимом для работы Сервиса. Мы не продаём ваши персональные данные и не используем их для рекламы.",
        "**Срок хранения.** Данные о местоположении в реальном времени хранятся только в течение Мероприятия и непродолжительного периода после него для разбора инцидентов и аудита безопасности, после чего удаляются или обезличиваются. Записи об инцидентах могут храниться дольше, если это необходимо для выполнения юридических обязательств либо для установления, осуществления или защиты правовых требований.",
        "**Ваши права.** С учётом применимого законодательства вы имеете право на доступ, исправление, удаление, ограничение обработки ваших персональных данных или возражение против неё, право на переносимость данных и право отозвать согласие в любое время (без ущерба для обработки, осуществлённой до отзыва). Вы также имеете право подать жалобу в местный надзорный орган по защите данных. Чтобы воспользоваться этими правами, свяжитесь с нами по реквизитам в Разделе 14.",
      ],
    },
    {
      title: "7. Услуги третьих сторон",
      paragraphs: [
        "Сервис использует сторонних поставщиков для картографии, тайлов, геокодирования и расчёта маршрутов, а также сервисы мобильной платформы для определения местоположения и уведомлений. Использование этих функций может также регулироваться условиями соответствующей третьей стороны. Мы не несём ответственности за доступность или точность данных третьих сторон.",
      ],
    },
    {
      title: "8. Интеллектуальная собственность",
      paragraphs: [
        "Сервис, включая его программное обеспечение, дизайн, товарные знаки и контент (за исключением вашего Контента), принадлежит нам или нашим лицензиарам и защищён законами об интеллектуальной собственности. Мы предоставляем вам ограниченную, личную, неисключительную, непередаваемую и отзывную лицензию на использование Сервиса для участия в Мероприятии. Вы сохраняете право собственности на ваш Контент, но предоставляете нам лицензию на его размещение, обработку и передачу в объёме, необходимом для работы Сервиса и предоставления функций безопасности, описанных в настоящих Условиях.",
      ],
    },
    {
      title: "9. Отказ от гарантий",
      paragraphs: [
        "В максимальной степени, разрешённой законом, Сервис предоставляется «как есть» и «по мере доступности», без каких-либо гарантий, явных или подразумеваемых, включая гарантии товарной пригодности, пригодности для определённой цели, точности, надёжности, бесперебойной доступности или ненарушения прав. Мы не гарантируем, что Сервис будет безошибочным, безопасным или доступным в любое время, а также что информация о местоположении, маршруте или времени будет точной.",
      ],
    },
    {
      title: "10. Ограничение ответственности",
      paragraphs: [
        "Ничто в настоящих Условиях не исключает и не ограничивает нашу ответственность за смерть или причинение вреда здоровью вследствие нашей небрежности, за мошенничество или за любую иную ответственность, которая не может быть исключена согласно применимому законодательству. С учётом этого, в максимальной степени, разрешённой законом, мы не несём ответственности за любые косвенные, случайные, специальные, опосредованные или штрафные убытки, а также за любые потери, возникшие вследствие вашего использования Сервиса в чрезвычайной ситуации, задержанного или несостоявшегося реагирования, неточного позиционирования либо сбоев сети, устройства или третьих сторон. Если ответственность не может быть полностью исключена, наша совокупная ответственность, возникающая из Сервиса или в связи с ним, ограничивается суммой (при наличии), которую вы уплатили за его использование.",
      ],
    },
    {
      title: "11. Возмещение ущерба",
      paragraphs: [
        "Вы соглашаетесь возместить и оградить нас, Организатора и Командный центр от любых претензий, убытков, обязательств и разумных расходов, возникающих вследствие нарушения вами настоящих Условий, ненадлежащего использования Сервиса или передачи вами ложного либо незаконного Контента.",
      ],
    },
    {
      title: "12. Приостановление и прекращение",
      paragraphs: [
        "Мы или Организатор можем приостановить либо прекратить ваш доступ к Сервису в любое время, с уведомлением или без него, если вы нарушаете настоящие Условия или если это необходимо для защиты безопасности или целостности Мероприятия. Вы можете прекратить использование Сервиса в любое время. Разделы, которые по своей природе должны действовать после прекращения (включая разделы о конфиденциальности, интеллектуальной собственности, отказе от гарантий, ответственности и применимом праве), продолжают применяться.",
      ],
    },
    {
      title: "13. Изменения настоящих Условий",
      paragraphs: [
        "Время от времени мы можем обновлять настоящие Условия. Дата «Последнее обновление» выше отражает самую актуальную версию. О существенных изменениях вам будет сообщено, когда это практически возможно. Продолжение использования Сервиса после вступления изменений в силу означает принятие изменённых Условий.",
      ],
    },
    {
      title: "14. Применимое право и контакты",
      paragraphs: [
        "Настоящие Условия регулируются законодательством юрисдикции, в которой учреждён Организатор, без учёта коллизионных норм, и компетентные суды этой юрисдикции обладают исключительной юрисдикцией, при условии соблюдения любых неотменяемых прав на защиту прав потребителей, которыми вы обладаете согласно местному законодательству. По вопросам, касающимся настоящих Условий, для реализации ваших прав на защиту данных или для сообщения о проблеме обращайтесь к Организатору или Командному центру вашего Мероприятия либо свяжитесь с нами через канал поддержки в приложении.",
      ],
    },
  ],
  closing:
    "Используя Сервис, вы подтверждаете, что прочитали и поняли настоящие Условия и наше Уведомление о конфиденциальности и согласны с ними.",
};

const tr: TermsDoc = {
  title: "Şartlar ve Koşullar",
  lastUpdated: `Son güncelleme: ${TERMS_LAST_UPDATED}`,
  intro:
    "İşbu Şartlar ve Koşullar (“**Şartlar**”), sizinle (“**siz**”, “**Katılımcı**” veya “**Kullanıcı**”) RaceSafe platformunun işletmecisi **Academy First Aid** (“**Hizmet**”, “**biz**”, “**bize**” veya “**bizim**”) arasında bağlayıcı bir sözleşme oluşturur. Hizmet, düzenlenen spor etkinliklerinde parkur güvenliğini ve acil tıbbi koordinasyonu desteklemek amacıyla sunulur. Bir profil oluşturarak, bir etkinliğe katılarak veya Hizmeti başka bir şekilde kullanarak, işbu Şartları ve aşağıda yer alan Gizlilik Bildirimini okuduğunuzu, anladığınızı ve bunlarla bağlı olmayı kabul ettiğinizi onaylarsınız. Kabul etmiyorsanız Hizmeti kullanmayın.",
  banner:
    "⚠️ Hizmet yalnızca etkinlik güvenliğine yardımcı bir araçtır. Yerel acil servislerin yerine **geçmez**. Hayati tehlike arz eden her durumda derhal **112**’yi (veya yerel acil durum numaranızı) arayın.",
  sections: [
    {
      title: "1. Tanımlar",
      paragraphs: [
        "“**Etkinlik**”, Hizmetin etkinleştirildiği düzenlenmiş bir yarış, parkur veya faaliyet anlamına gelir. “**Yarış Komutası**”, etkinliğin tıbbi ve güvenlik koordinasyon ekibi anlamına gelir. “**Sağlık Görevlisi**”, Yarış Komutası tarafından yetkilendirilmiş bir müdahale görevlisi anlamına gelir. “**İçerik**”, olay bildirimleri, konum verileri, tıbbi bilgiler, fotoğraflar ve mesajlar dâhil olmak üzere ilettiğiniz her türlü veri anlamına gelir. “**Organizatör**”, Etkinlikten sorumlu tüzel kişi anlamına gelir.",
      ],
    },
    {
      title: "2. Uygunluk ve hesaplar",
      paragraphs: [
        "Hizmeti kullanmak için en az 16 yaşında olmanız veya bulunduğunuz yargı bölgesindeki dijital rıza yaşında olmanız gerekir. Bu yaşın altındaysanız, işbu Şartları sizin adınıza bir ebeveyn veya vasinin kabul etmesi gerekir. Doğru kayıt ve tıbbi bilgileri sağlamayı ve bunları güncel tutmayı kabul edersiniz. Profiliniz altında gerçekleşen etkinliklerden ve erişim kimlik bilgilerinizin gizliliğini korumaktan siz sorumlusunuz.",
      ],
    },
    {
      title: "3. Hizmet acil tıbbi bakım değildir",
      paragraphs: [
        "Hizmet, bir iletişim ve koordinasyon aracıdır. Tıbbi tavsiye, teşhis veya tedavi sağlamaz ve profesyonel acil servislerin, acil durum telefon hatlarının veya yerinde ilk yardımın yerine geçmez. Müdahale süreleri, Sağlık Görevlilerinin müsaitliği ve herhangi bir konumlandırma veya rota bilgisinin doğruluğu garanti edilemez ve kontrolümüz dışındaki etkenlere (şebeke kapsamı, GPS doğruluğu, cihaz pili, arazi ve Etkinlik personeli) bağlıdır. Acil bir durumda asla yalnızca Hizmete güvenmeyin.",
      ],
    },
    {
      title: "4. Konum verileri ve nasıl kullanıldığı",
      paragraphs: [
        "Bir Etkinliğe katıldığınızda Hizmet, cihazınızın konumunu — bu izni vermeniz hâlinde Etkinlik etkinken arka planda dâhil olmak üzere — toplar ve bunu Yarış Komutası ile görevlendirilen Sağlık Görevlileriyle paylaşır. Bu, müdahale ekiplerinin sizi bulmasını, varış sürelerini tahmin etmesini ve yardımı doğru yere yönlendirmesini sağlar. Gerçek zamanlı konumunuz, Etkinlik süresince Etkinliğin yetkili güvenlik personeline görünür. Konum paylaşımını cihaz ayarlarınızdan istediğiniz zaman kapatabilirsiniz, ancak bu, Hizmetin güvenlik özelliklerinin çalışmasını kısıtlar veya engeller.",
      ],
    },
    {
      title: "5. Olay bildirimleri ve kabul edilebilir kullanım",
      paragraphs: ["Aşağıdakileri yapmayacağınızı kabul edersiniz:"],
      bullets: [
        "yanlış, yanıltıcı veya kötü niyetli olay bildirimleri göndermek ya da asılsız alarm vermek;",
        "başka bir katılımcı, Sağlık Görevlisi veya yetkili kişi gibi davranmak;",
        "hukuka aykırı, saldırgan veya hak ihlali oluşturan İçerik yüklemek;",
        "Hizmete veya altyapısına müdahale etmek, aşırı yük bindirmek, tersine mühendislik uygulamak ya da yetkisiz erişim sağlamaya çalışmak;",
        "Hizmeti, Etkinlikteki kendi katılımınız ve güvenliğiniz dışında herhangi bir amaçla kullanmak.",
      ],
    },
    {
      title: "6. Gizlilik ve veri koruma",
      paragraphs: [
        "Kişisel verileri, AB Genel Veri Koruma Tüzüğü (GDPR) ve geçerli ulusal hukuka uygun olarak işleriz. İşlediğimiz veri kategorileri arasında kimlik ve iletişim bilgileriniz, göğüs numarası/kayıt verileriniz, konum verileriniz, olay bildirimleri ve sağlamayı tercih ettiğiniz her türlü tıbbi bilgi (alerjiler, rahatsızlıklar ve acil durum kişileri gibi) yer alır.",
        "**Hukuki dayanak.** Konum ve olay verileri, talep ettiğiniz güvenlik hizmetini sunmak için (md. 6(1)(b)) ve işlemenin tıbbi bir acil duruma müdahale için gerekli olduğu durumlarda sizin veya başka bir kişinin hayati menfaatlerini korumak için (md. 6(1)(d)) işlenir. Sağladığınız sağlık verileri özel nitelikli verilerdir ve açık rızanıza dayanılarak (md. 9(2)(a)) ve/veya rıza vermeye fiziksel ya da hukuken muktedir olmadığınız durumlarda hayati menfaatleri korumak amacıyla (md. 9(2)(c)) işlenir.",
        "**Alıcılar.** Verileriniz yalnızca Etkinlik güvenliği amacıyla Yarış Komutası, görevlendirilen Sağlık Görevlileri ve Organizatör ile ve Hizmeti çalıştırmak için kesinlikle gerekli olduğu ölçüde barındırma ve harita/rota alt işleyicilerimizle paylaşılır. Kişisel verilerinizi satmayız ve reklam amacıyla kullanmayız.",
        "**Saklama.** Gerçek zamanlı konum verileri yalnızca Etkinlik süresince ve olay incelemesi ile güvenlik denetimi amacıyla sonrasında kısa bir süre saklanır, ardından silinir veya anonimleştirilir. Olay kayıtları, yasal yükümlülüklere uymak veya hukuki talepleri tesis etmek, kullanmak ya da savunmak için gerekli olduğunda daha uzun süre saklanabilir.",
        "**Haklarınız.** Geçerli hukuka tabi olmak kaydıyla, kişisel verilerinizin işlenmesine erişme, düzeltme, silme, kısıtlama veya itiraz etme hakkına, veri taşınabilirliği hakkına ve rızanızı istediğiniz zaman geri çekme hakkına (geri çekmeden önce yapılan işlemeyi etkilemeksizin) sahipsiniz. Ayrıca yerel veri koruma otoritenize şikâyette bulunma hakkına sahipsiniz. Bu hakları kullanmak için Bölüm 14’teki bilgilerden bizimle iletişime geçin.",
      ],
    },
    {
      title: "7. Üçüncü taraf hizmetleri",
      paragraphs: [
        "Hizmet; harita, döşeme (tile), coğrafi kodlama ve rota hesaplaması için üçüncü taraf sağlayıcılara ve konum ile bildirimler için mobil platform hizmetlerine dayanır. Bu özellikleri kullanmanız, ilgili üçüncü tarafın koşullarına da tabi olabilir. Üçüncü taraf verilerinin kullanılabilirliğinden veya doğruluğundan sorumlu değiliz.",
      ],
    },
    {
      title: "8. Fikrî mülkiyet",
      paragraphs: [
        "Yazılımı, tasarımı, ticari markaları ve içeriği (İçeriğiniz hariç) dâhil olmak üzere Hizmet, bize veya lisans verenlerimize aittir ve fikrî mülkiyet yasalarıyla korunmaktadır. Size, bir Etkinliğe katılmak amacıyla Hizmeti kullanmanız için sınırlı, kişisel, münhasır olmayan, devredilemez ve geri alınabilir bir lisans veririz. İçeriğinizin mülkiyeti sizde kalır, ancak Hizmeti çalıştırmak ve işbu Şartlarda açıklanan güvenlik işlevlerini sağlamak için gerekli olduğu ölçüde onu barındırmamız, işlememiz ve iletmemiz için bize bir lisans verirsiniz.",
      ],
    },
    {
      title: "9. Sorumluluk reddi",
      paragraphs: [
        "Yasaların izin verdiği azami ölçüde Hizmet, herhangi bir açık veya zımni garanti olmaksızın “olduğu gibi” ve “mevcut olduğu şekilde” sunulur; buna ticarete elverişlilik, belirli bir amaca uygunluk, doğruluk, güvenilirlik, kesintisiz kullanılabilirlik veya hak ihlali içermeme garantileri dâhildir. Hizmetin hatasız, güvenli veya her zaman erişilebilir olacağını ya da konum, rota veya zaman bilgilerinin doğru olacağını garanti etmeyiz.",
      ],
    },
    {
      title: "10. Sorumluluğun sınırlandırılması",
      paragraphs: [
        "İşbu Şartlardaki hiçbir hüküm, ihmalimizden kaynaklanan ölüm veya bedensel yaralanmaya, dolandırıcılığa ya da geçerli hukuk uyarınca hariç tutulamayacak herhangi bir sorumluluğa ilişkin sorumluluğumuzu hariç tutmaz veya sınırlamaz. Buna tabi olmak kaydıyla, yasaların izin verdiği azami ölçüde, dolaylı, arızi, özel, sonuçsal veya cezai zararlardan ya da Hizmete bir acil durumda güvenmenizden, gecikmiş veya gerçekleşmemiş müdahalelerden, hatalı konumlandırmadan veya şebeke, cihaz ya da üçüncü taraf arızalarından kaynaklanan herhangi bir kayıptan sorumlu değiliz. Sorumluluğun tamamen hariç tutulamadığı durumlarda, Hizmetten veya Hizmetle bağlantılı olarak doğan toplam toplam sorumluluğumuz, onu kullanmak için ödediğiniz tutarla (varsa) sınırlıdır.",
      ],
    },
    {
      title: "11. Tazminat",
      paragraphs: [
        "İşbu Şartları ihlal etmenizden, Hizmeti kötüye kullanmanızdan veya yanlış ya da hukuka aykırı İçerik göndermenizden kaynaklanan her türlü talep, kayıp, yükümlülük ve makul masraflara karşı bizi, Organizatörü ve Yarış Komutasını tazmin etmeyi ve zarardan korumayı kabul edersiniz.",
      ],
    },
    {
      title: "12. Askıya alma ve fesih",
      paragraphs: [
        "İşbu Şartları ihlal etmeniz hâlinde veya Etkinliğin güvenliğini ya da bütünlüğünü korumak için gerekli olduğunda, biz veya Organizatör, bildirimde bulunarak ya da bulunmaksızın, Hizmete erişiminizi istediğimiz zaman askıya alabilir veya sonlandırabiliriz. Hizmeti kullanmayı istediğiniz zaman bırakabilirsiniz. Niteliği gereği fesihten sonra da yürürlükte kalması gereken bölümler (gizlilik, fikrî mülkiyet, sorumluluk reddi, sorumluluk ve geçerli hukuka ilişkin olanlar dâhil) uygulanmaya devam eder.",
      ],
    },
    {
      title: "13. İşbu Şartlardaki değişiklikler",
      paragraphs: [
        "İşbu Şartları zaman zaman güncelleyebiliriz. Yukarıdaki “Son güncelleme” tarihi en güncel sürümü yansıtır. Önemli değişiklikler, uygulanabilir olduğu durumlarda dikkatinize sunulacaktır. Değişiklikler yürürlüğe girdikten sonra Hizmeti kullanmaya devam etmeniz, revize edilmiş Şartları kabul ettiğiniz anlamına gelir.",
      ],
    },
    {
      title: "14. Geçerli hukuk ve iletişim",
      paragraphs: [
        "İşbu Şartlar, kanunlar ihtilafı kurallarına bakılmaksızın Organizatörün yerleşik olduğu yargı bölgesinin yasalarına tabidir ve söz konusu yargı bölgesinin yetkili mahkemeleri münhasır yargı yetkisine sahiptir; bu, yerel hukukunuz uyarınca sahip olduğunuz feragat edilemez tüketici koruma haklarına tabidir. İşbu Şartlarla ilgili sorular için, veri koruma haklarınızı kullanmak için veya bir sorunu bildirmek için Etkinliğinizin Organizatörü ya da Yarış Komutası ile iletişime geçin veya uygulamada sağlanan destek kanalı aracılığıyla bize ulaşın.",
      ],
    },
  ],
  closing:
    "Hizmeti kullanarak, işbu Şartları ve Gizlilik Bildirimimizi okuduğunuzu, anladığınızı ve bunları kabul ettiğinizi beyan edersiniz.",
};

const el: TermsDoc = {
  title: "Όροι και Προϋποθέσεις",
  lastUpdated: `Τελευταία ενημέρωση: ${TERMS_LAST_UPDATED}`,
  intro:
    "Οι παρόντες Όροι και Προϋποθέσεις (οι «**Όροι**») συνιστούν δεσμευτική συμφωνία ανάμεσα σε εσάς («**εσείς**», ο «**Συμμετέχων**» ή ο «**Χρήστης**») και την **Academy First Aid**, τον φορέα εκμετάλλευσης της πλατφόρμας RaceSafe (η «**Υπηρεσία**», «**εμείς**», «**εμάς**» ή «**μας**»). Η Υπηρεσία παρέχεται για την υποστήριξη της ασφάλειας στη διαδρομή και του συντονισμού της επείγουσας ιατρικής βοήθειας σε οργανωμένες αθλητικές εκδηλώσεις. Δημιουργώντας προφίλ, συμμετέχοντας σε εκδήλωση ή χρησιμοποιώντας με άλλον τρόπο την Υπηρεσία, επιβεβαιώνετε ότι έχετε διαβάσει, κατανοήσει και αποδέχεστε να δεσμεύεστε από τους παρόντες Όρους και από την Ειδοποίηση Απορρήτου που παρατίθεται παρακάτω. Αν δεν συμφωνείτε, μην χρησιμοποιείτε την Υπηρεσία.",
  banner:
    "⚠️ Η Υπηρεσία αποτελεί μόνο βοήθημα για την ασφάλεια της εκδήλωσης. **Δεν** αντικαθιστά τις τοπικές υπηρεσίες έκτακτης ανάγκης. Σε κάθε απειλητική για τη ζωή κατάσταση, καλέστε αμέσως το **112** (ή τον τοπικό αριθμό έκτακτης ανάγκης).",
  sections: [
    {
      title: "1. Ορισμοί",
      paragraphs: [
        "«**Εκδήλωση**» σημαίνει έναν οργανωμένο αγώνα, διαδρομή ή δραστηριότητα για την οποία έχει ενεργοποιηθεί η Υπηρεσία. «**Κέντρο Επιχειρήσεων**» σημαίνει την ιατρική ομάδα και την ομάδα ασφάλειας και συντονισμού της εκδήλωσης. «**Διασώστης**» σημαίνει ένα μέλος ομάδας επέμβασης εξουσιοδοτημένο από το Κέντρο Επιχειρήσεων. «**Περιεχόμενο**» σημαίνει οποιαδήποτε δεδομένα υποβάλλετε, συμπεριλαμβανομένων αναφορών συμβάντων, δεδομένων τοποθεσίας, ιατρικών πληροφοριών, φωτογραφιών και μηνυμάτων. «**Διοργανωτής**» σημαίνει το νομικό πρόσωπο που είναι υπεύθυνο για την Εκδήλωση.",
      ],
    },
    {
      title: "2. Επιλεξιμότητα και λογαριασμοί",
      paragraphs: [
        "Για να χρησιμοποιήσετε την Υπηρεσία πρέπει να είστε τουλάχιστον 16 ετών ή να έχετε την ηλικία ψηφιακής συναίνεσης στη δικαιοδοσία σας. Αν είστε κάτω από αυτή την ηλικία, γονέας ή κηδεμόνας πρέπει να αποδεχθεί τους παρόντες Όρους εκ μέρους σας. Συμφωνείτε να παρέχετε ακριβείς πληροφορίες εγγραφής και ιατρικές πληροφορίες και να τις διατηρείτε ενημερωμένες. Είστε υπεύθυνοι για τη δραστηριότητα που πραγματοποιείται μέσω του προφίλ σας και για τη διατήρηση της εμπιστευτικότητας τυχόν διαπιστευτηρίων πρόσβασης.",
      ],
    },
    {
      title: "3. Η Υπηρεσία δεν αποτελεί επείγουσα ιατρική περίθαλψη",
      paragraphs: [
        "Η Υπηρεσία είναι ένα εργαλείο επικοινωνίας και συντονισμού. Δεν παρέχει ιατρικές συμβουλές, διάγνωση ή θεραπεία και δεν υποκαθιστά τις επαγγελματικές υπηρεσίες έκτακτης ανάγκης, τις τηλεφωνικές γραμμές έκτακτης ανάγκης ή τις πρώτες βοήθειες επιτόπου. Οι χρόνοι ανταπόκρισης, η διαθεσιμότητα των Διασωστών και η ακρίβεια οποιασδήποτε πληροφορίας εντοπισμού ή διαδρομής δεν μπορούν να εγγυηθούν και εξαρτώνται από παράγοντες εκτός του ελέγχου μας (κάλυψη δικτύου, ακρίβεια GPS, μπαταρία συσκευής, έδαφος και στελέχωση της Εκδήλωσης). Ποτέ μην βασίζεστε αποκλειστικά στην Υπηρεσία σε περίπτωση έκτακτης ανάγκης.",
      ],
    },
    {
      title: "4. Δεδομένα τοποθεσίας και πώς χρησιμοποιούνται",
      paragraphs: [
        "Όταν συμμετέχετε σε μια Εκδήλωση, η Υπηρεσία συλλέγει τη γεωγραφική θέση της συσκευής σας — συμπεριλαμβανομένου του παρασκηνίου ενόσω η Εκδήλωση είναι ενεργή, αν παραχωρήσετε αυτή την άδεια — και την κοινοποιεί στο Κέντρο Επιχειρήσεων και στους αρμόδιους Διασώστες. Αυτό επιτρέπει στις ομάδες επέμβασης να σας εντοπίσουν, να εκτιμήσουν τους χρόνους άφιξης και να κατευθύνουν τη βοήθεια στο σωστό σημείο. Η θέση σας σε πραγματικό χρόνο είναι ορατή στο εξουσιοδοτημένο προσωπικό ασφαλείας της Εκδήλωσης για όλη τη διάρκεια της Εκδήλωσης. Μπορείτε να απενεργοποιήσετε την κοινοποίηση τοποθεσίας ανά πάσα στιγμή από τις ρυθμίσεις της συσκευής σας, αλλά αυτό θα περιορίσει ή θα εμποδίσει τη λειτουργία των χαρακτηριστικών ασφαλείας της Υπηρεσίας.",
      ],
    },
    {
      title: "5. Αναφορές συμβάντων και αποδεκτή χρήση",
      paragraphs: ["Συμφωνείτε ότι δεν θα:"],
      bullets: [
        "υποβάλλετε ψευδείς, παραπλανητικές ή κακόβουλες αναφορές συμβάντων ούτε θα προκαλείτε ψευδείς συναγερμούς·",
        "υποδύεστε άλλον συμμετέχοντα, Διασώστη ή αξιωματούχο·",
        "ανεβάζετε παράνομο, προσβλητικό ή παραβατικό Περιεχόμενο·",
        "παρεμβαίνετε, υπερφορτώνετε, αποσυμπιλάτε ή επιχειρείτε να αποκτήσετε μη εξουσιοδοτημένη πρόσβαση στην Υπηρεσία ή στην υποδομή της·",
        "χρησιμοποιείτε την Υπηρεσία για οποιονδήποτε σκοπό πέραν της δικής σας συμμετοχής και ασφάλειας στην Εκδήλωση.",
      ],
    },
    {
      title: "6. Απόρρητο και προστασία δεδομένων",
      paragraphs: [
        "Επεξεργαζόμαστε δεδομένα προσωπικού χαρακτήρα σύμφωνα με τον Γενικό Κανονισμό της ΕΕ για την Προστασία Δεδομένων (GDPR) και την ισχύουσα εθνική νομοθεσία. Οι κατηγορίες δεδομένων που επεξεργαζόμαστε περιλαμβάνουν τα στοιχεία ταυτότητας και επικοινωνίας σας, τον αριθμό συμμετοχής/δεδομένα εγγραφής, τη γεωγραφική θέση, τις αναφορές συμβάντων και κάθε ιατρική πληροφορία που επιλέγετε να παρέχετε (όπως αλλεργίες, παθήσεις και επαφές έκτακτης ανάγκης).",
        "**Νομική βάση.** Τα δεδομένα γεωγραφικής θέσης και συμβάντων υποβάλλονται σε επεξεργασία για την παροχή της υπηρεσίας ασφάλειας που ζητήσατε (άρθρο 6 παρ. 1 στοιχ. β) και, όταν η επεξεργασία είναι απαραίτητη για την ανταπόκριση σε ιατρικό επείγον, για την προστασία των ζωτικών συμφερόντων των δικών σας ή άλλου προσώπου (άρθρο 6 παρ. 1 στοιχ. δ). Τα δεδομένα υγείας που παρέχετε αποτελούν ειδική κατηγορία δεδομένων και υποβάλλονται σε επεξεργασία βάσει της ρητής συγκατάθεσής σας (άρθρο 9 παρ. 2 στοιχ. α) ή/και για την προστασία ζωτικών συμφερόντων όταν είστε σωματικά ή νομικά ανίκανοι να δώσετε συγκατάθεση (άρθρο 9 παρ. 2 στοιχ. γ).",
        "**Αποδέκτες.** Τα δεδομένα σας κοινοποιούνται μόνο στο Κέντρο Επιχειρήσεων, στους αρμόδιους Διασώστες και στον Διοργανωτή για τον σκοπό της ασφάλειας της Εκδήλωσης, καθώς και στους εκτελούντες την επεξεργασία για τη φιλοξενία και τη χαρτογράφηση/δρομολόγηση, αυστηρά στον βαθμό που απαιτείται για τη λειτουργία της Υπηρεσίας. Δεν πουλάμε τα δεδομένα προσωπικού χαρακτήρα σας ούτε τα χρησιμοποιούμε για διαφήμιση.",
        "**Διατήρηση.** Τα δεδομένα θέσης σε πραγματικό χρόνο διατηρούνται μόνο για τη διάρκεια της Εκδήλωσης και για σύντομο διάστημα μετά, για σκοπούς ελέγχου συμβάντων και ασφάλειας, και στη συνέχεια διαγράφονται ή ανωνυμοποιούνται. Τα αρχεία συμβάντων ενδέχεται να διατηρηθούν για μεγαλύτερο διάστημα όταν αυτό απαιτείται για τη συμμόρφωση με νομικές υποχρεώσεις ή για τη θεμελίωση, άσκηση ή υπεράσπιση νομικών αξιώσεων.",
        "**Τα δικαιώματά σας.** Με την επιφύλαξη της ισχύουσας νομοθεσίας, έχετε δικαίωμα πρόσβασης, διόρθωσης, διαγραφής, περιορισμού ή εναντίωσης στην επεξεργασία των δεδομένων σας, δικαίωμα φορητότητας των δεδομένων και δικαίωμα ανάκλησης της συγκατάθεσης ανά πάσα στιγμή (χωρίς να θίγεται η επεξεργασία που πραγματοποιήθηκε πριν από την ανάκληση). Έχετε επίσης δικαίωμα υποβολής καταγγελίας στην τοπική αρχή προστασίας δεδομένων. Για να ασκήσετε αυτά τα δικαιώματα, επικοινωνήστε μαζί μας με τα στοιχεία της Ενότητας 14.",
      ],
    },
    {
      title: "7. Υπηρεσίες τρίτων",
      paragraphs: [
        "Η Υπηρεσία βασίζεται σε τρίτους παρόχους για χαρτογράφηση, πλακίδια (tiles), γεωκωδικοποίηση και υπολογισμό διαδρομών, καθώς και στις υπηρεσίες της κινητής πλατφόρμας για τοποθεσία και ειδοποιήσεις. Η χρήση αυτών των λειτουργιών ενδέχεται επίσης να υπόκειται στους όρους του εκάστοτε τρίτου. Δεν φέρουμε ευθύνη για τη διαθεσιμότητα ή την ακρίβεια των δεδομένων τρίτων.",
      ],
    },
    {
      title: "8. Πνευματική ιδιοκτησία",
      paragraphs: [
        "Η Υπηρεσία, συμπεριλαμβανομένου του λογισμικού, του σχεδιασμού, των εμπορικών σημάτων και του περιεχομένου της (εξαιρουμένου του Περιεχομένου σας), ανήκει σε εμάς ή στους δικαιοπαρόχους μας και προστατεύεται από τη νομοθεσία περί πνευματικής ιδιοκτησίας. Σας χορηγούμε περιορισμένη, προσωπική, μη αποκλειστική, μη μεταβιβάσιμη και ανακλητή άδεια χρήσης της Υπηρεσίας για τη συμμετοχή σας σε μια Εκδήλωση. Διατηρείτε την κυριότητα του Περιεχομένου σας, αλλά μας χορηγείτε άδεια να το φιλοξενούμε, να το επεξεργαζόμαστε και να το μεταδίδουμε στον βαθμό που απαιτείται για τη λειτουργία της Υπηρεσίας και την παροχή των λειτουργιών ασφαλείας που περιγράφονται στους παρόντες Όρους.",
      ],
    },
    {
      title: "9. Αποποιήσεις εγγυήσεων",
      paragraphs: [
        "Στον μέγιστο βαθμό που επιτρέπεται από τον νόμο, η Υπηρεσία παρέχεται «ως έχει» και «ως διαθέσιμη», χωρίς εγγυήσεις οποιουδήποτε είδους, ρητές ή σιωπηρές, συμπεριλαμβανομένων εγγυήσεων εμπορευσιμότητας, καταλληλότητας για συγκεκριμένο σκοπό, ακρίβειας, αξιοπιστίας, αδιάλειπτης διαθεσιμότητας ή μη παραβίασης. Δεν εγγυόμαστε ότι η Υπηρεσία θα είναι χωρίς σφάλματα, ασφαλής ή διαθέσιμη ανά πάσα στιγμή, ούτε ότι οι πληροφορίες τοποθεσίας, διαδρομής ή χρόνου θα είναι ακριβείς.",
      ],
    },
    {
      title: "10. Περιορισμός ευθύνης",
      paragraphs: [
        "Τίποτα στους παρόντες Όρους δεν αποκλείει ούτε περιορίζει την ευθύνη μας για θάνατο ή σωματική βλάβη που προκαλείται από αμέλειά μας, για απάτη ή για οποιαδήποτε άλλη ευθύνη που δεν μπορεί να αποκλειστεί βάσει της ισχύουσας νομοθεσίας. Με την επιφύλαξη των ανωτέρω, στον μέγιστο βαθμό που επιτρέπεται από τον νόμο, δεν ευθυνόμαστε για οποιεσδήποτε έμμεσες, παρεπόμενες, ειδικές, αποθετικές ή τιμωρητικές ζημίες, ούτε για οποιαδήποτε απώλεια προκύπτει από την εκ μέρους σας εξάρτηση από την Υπηρεσία σε περίπτωση έκτακτης ανάγκης, από καθυστερημένες ή αποτυχημένες ανταποκρίσεις, από ανακριβή εντοπισμό ή από βλάβες δικτύου, συσκευής ή τρίτων. Όπου η ευθύνη δεν μπορεί να αποκλειστεί πλήρως, η συνολική σωρευτική ευθύνη μας που απορρέει από ή σε σχέση με την Υπηρεσία περιορίζεται στο ποσό (εφόσον υπάρχει) που καταβάλατε για τη χρήση της.",
      ],
    },
    {
      title: "11. Αποζημίωση",
      paragraphs: [
        "Συμφωνείτε να μας αποζημιώσετε και να απαλλάξετε εμάς, τον Διοργανωτή και το Κέντρο Επιχειρήσεων από κάθε αξίωση, απώλεια, ευθύνη και εύλογη δαπάνη που προκύπτει από την παραβίαση των παρόντων Όρων εκ μέρους σας, από την κατάχρηση της Υπηρεσίας ή από την υποβολή ψευδούς ή παράνομου Περιεχομένου.",
      ],
    },
    {
      title: "12. Αναστολή και λήξη",
      paragraphs: [
        "Εμείς ή ο Διοργανωτής μπορούμε να αναστείλουμε ή να τερματίσουμε την πρόσβασή σας στην Υπηρεσία ανά πάσα στιγμή, με ή χωρίς προειδοποίηση, εάν παραβιάσετε τους παρόντες Όρους ή εάν είναι αναγκαίο για την προστασία της ασφάλειας ή της ακεραιότητας της Εκδήλωσης. Μπορείτε να σταματήσετε να χρησιμοποιείτε την Υπηρεσία ανά πάσα στιγμή. Οι ενότητες που εκ της φύσεώς τους πρέπει να εξακολουθούν να ισχύουν μετά τη λήξη (συμπεριλαμβανομένων εκείνων για το απόρρητο, την πνευματική ιδιοκτησία, τις αποποιήσεις, την ευθύνη και το εφαρμοστέο δίκαιο) εξακολουθούν να ισχύουν.",
      ],
    },
    {
      title: "13. Αλλαγές στους παρόντες Όρους",
      paragraphs: [
        "Ενδέχεται να επικαιροποιούμε τους παρόντες Όρους κατά καιρούς. Η ημερομηνία «Τελευταία ενημέρωση» παραπάνω αντικατοπτρίζει την πιο πρόσφατη έκδοση. Οι ουσιώδεις αλλαγές θα τίθενται υπόψη σας όπου είναι εφικτό. Η συνεχιζόμενη χρήση της Υπηρεσίας μετά την έναρξη ισχύος των αλλαγών συνιστά αποδοχή των αναθεωρημένων Όρων.",
      ],
    },
    {
      title: "14. Εφαρμοστέο δίκαιο και επικοινωνία",
      paragraphs: [
        "Οι παρόντες Όροι διέπονται από το δίκαιο της δικαιοδοσίας στην οποία είναι εγκατεστημένος ο Διοργανωτής, ανεξαρτήτως κανόνων σύγκρουσης νόμων, και τα αρμόδια δικαστήρια της εν λόγω δικαιοδοσίας έχουν αποκλειστική δικαιοδοσία, με την επιφύλαξη τυχόν αναγκαστικού δικαίου δικαιωμάτων προστασίας καταναλωτή που έχετε βάσει του τοπικού σας δικαίου. Για ερωτήσεις σχετικά με τους παρόντες Όρους, για την άσκηση των δικαιωμάτων σας προστασίας δεδομένων ή για την αναφορά προβλήματος, επικοινωνήστε με τον Διοργανωτή ή το Κέντρο Επιχειρήσεων της Εκδήλωσής σας ή μαζί μας μέσω του καναλιού υποστήριξης που παρέχεται στην εφαρμογή.",
      ],
    },
  ],
  closing:
    "Χρησιμοποιώντας την Υπηρεσία, αναγνωρίζετε ότι έχετε διαβάσει και κατανοήσει τους παρόντες Όρους και την Ειδοποίηση Απορρήτου μας και ότι τους αποδέχεστε.",
};

export const TERMS_BY_LANG: Record<string, TermsDoc> = { en, bg, ru, uk, tr, ro, el, de, it };

export function getTermsDoc(lang: string): TermsDoc {
  return TERMS_BY_LANG[lang] ?? TERMS_BY_LANG.en;
}
