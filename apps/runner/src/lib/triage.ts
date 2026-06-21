/**
 * First-aid triage decision tree for the Guided Care screen. Static + offline:
 * each node is a question or an instruction with big answer buttons that branch
 * to the next node. Content is bilingual inline (bg/en) so no extra i18n keys.
 *
 * This is layperson bystander guidance for a race event while a medic is en
 * route — it is intentionally simple and conservative, never a substitute for
 * professional care or calling emergency services.
 */
/**
 * Localized string for the guided-care triage tree. `bg` and `en` are always
 * present; other UI languages may add their own key, otherwise the consumer
 * falls back to English (see the `tr` helper in GuidedCare). The medical triage
 * copy is only fully authored in bg/en — falling back to English is safer than
 * shipping an unreviewed machine translation of clinical guidance.
 */
export interface LS {
  bg: string;
  en: string;
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
    title: { en: "Is the person awake and responding to you?", bg: "Будна ли е и реагира ли?" },
    body: { en: "Speak loudly and gently tap their shoulders.", bg: "Говори силно и леко потупай раменете." },
    options: [
      { label: { en: "Yes, responding", bg: "Да, реагира" }, tone: Y, next: "conscious" },
      { label: { en: "No / barely", bg: "Не / едва" }, tone: N, next: "airway" },
    ],
  },

  // ── Unresponsive path ──
  airway: {
    id: "airway",
    kind: "instruction",
    visual: "🫁",
    title: { en: "Open the airway", bg: "Отвори дихателните пътища" },
    body: {
      en: "Tilt the head back gently and lift the chin. Clear anything obvious from the mouth.",
      bg: "Наклони главата назад внимателно и повдигни брадичката. Махни видими предмети от устата.",
    },
    options: [{ label: { en: "Done — check breathing", bg: "Готово — провери дишането" }, next: "breathing" }],
  },
  breathing: {
    id: "breathing",
    kind: "question",
    visual: "👂",
    title: { en: "Look, listen & feel for 10 seconds. Are they breathing normally?", bg: "Гледай, слушай и усещай 10 секунди. Диша ли нормално?" },
    options: [
      { label: { en: "Yes, breathing", bg: "Да, диша" }, tone: Y, next: "recovery" },
      { label: { en: "No / gasping", bg: "Не / задъхва се" }, tone: N, next: "cpr" },
    ],
  },
  recovery: {
    id: "recovery",
    kind: "instruction",
    visual: "🛌",
    tone: "good",
    title: { en: "Recovery position", bg: "Възстановително положение" },
    body: {
      en: "Roll them onto their side, head tilted back so the airway stays open. Stay with them and keep checking they're breathing until the medic arrives.",
      bg: "Завърти го настрани, с леко наклонена назад глава, за да остане отворен дихателният път. Остани до него и проверявай дишането до идването на медика.",
    },
    options: [{ label: { en: "They stopped breathing", bg: "Спря да диша" }, tone: "critical", next: "cpr" }],
  },
  cpr: {
    id: "cpr",
    kind: "instruction",
    visual: "❤️",
    tone: "critical",
    title: { en: "Start CPR now", bg: "Започни CPR веднага" },
    body: {
      en: "Push hard and fast in the centre of the chest — about 2 per second (100–120/min), letting the chest rise fully each time. Don't stop until a medic takes over. Send someone for an AED if there is one.",
      bg: "Натискай силно и бързо в центъра на гръдния кош — около 2 пъти в секунда (100–120/мин), като оставяш гръдния кош да се връща. Не спирай, докато медик не поеме. Изпрати някого за AED, ако има.",
    },
    options: [],
  },

  // ── Conscious path ──
  conscious: {
    id: "conscious",
    kind: "question",
    visual: "❓",
    title: { en: "What's the main problem?", bg: "Какъв е основният проблем?" },
    options: [
      { label: { en: "Heavy bleeding", bg: "Силно кървене" }, tone: "critical", next: "bleeding" },
      { label: { en: "Chest pain / can't breathe", bg: "Болка в гърдите / задух" }, tone: "critical", next: "chest" },
      { label: { en: "Bad fall / can't move a limb", bg: "Тежко падане / неподвижен крайник" }, next: "fracture" },
      { label: { en: "Hot & confused (heat)", bg: "Прегрял и объркан (топлина)" }, next: "heat" },
      { label: { en: "Cold & shivering", bg: "Премръзнал и трепери" }, next: "cold" },
      { label: { en: "Cramps / exhausted", bg: "Крампи / изтощение" }, next: "minor" },
      { label: { en: "Something else", bg: "Друго" }, tone: "neutral", next: "other" },
    ],
  },
  bleeding: {
    id: "bleeding",
    kind: "instruction",
    visual: "🩸",
    tone: "critical",
    title: { en: "Control the bleeding", bg: "Спри кървенето" },
    body: {
      en: "Press firmly on the wound with a clean cloth and keep pressing. Raise the injured part if you can. If blood soaks through, add more cloth on top — don't remove the first.",
      bg: "Притискай силно раната с чиста кърпа и не спирай. Повдигни наранената част, ако можеш. Ако прокърви, добави още кърпа отгоре — не махай първата.",
    },
    options: [{ label: { en: "They became unresponsive", bg: "Изпадна в безсъзнание" }, tone: "critical", next: "airway" }],
  },
  chest: {
    id: "chest",
    kind: "instruction",
    visual: "💢",
    tone: "critical",
    title: { en: "Chest pain / breathing", bg: "Болка в гърдите / дишане" },
    body: {
      en: "Help them sit down and rest in a comfortable position. Loosen tight clothing and keep them calm. If they carry their own heart or asthma medication, help them take it.",
      bg: "Помогни му да седне и да си почине в удобна позиция. Разхлаби стегнатите дрехи и го успокой. Ако носи свое лекарство за сърце или астма, помогни му да го вземе.",
    },
    options: [{ label: { en: "They became unresponsive", bg: "Изпадна в безсъзнание" }, tone: "critical", next: "airway" }],
  },
  fracture: {
    id: "fracture",
    kind: "instruction",
    visual: "🦴",
    title: { en: "Possible fracture", bg: "Възможна фрактура" },
    body: {
      en: "Keep them still — don't try to straighten or move the limb. Support it in the position you found it. Apply something cold wrapped in cloth if available.",
      bg: "Дръж го неподвижен — не се опитвай да изправяш или местиш крайника. Поддържай го в позицията, в която е. Сложи нещо студено, увито в плат, ако има.",
    },
    options: [],
  },
  heat: {
    id: "heat",
    kind: "instruction",
    visual: "🌡️",
    tone: "critical",
    title: { en: "Heat illness", bg: "Топлинно заболяване" },
    body: {
      en: "Move them into shade. Cool them fast — water on the skin, fan them, cold packs to neck/armpits/groin. Sips of water only if fully awake. Confusion means it's serious.",
      bg: "Премести го на сянка. Охлади го бързо — вода по кожата, веене, студени компреси на врат/подмишници/слабини. Глътки вода само ако е напълно в съзнание. Объркване = сериозно.",
    },
    options: [{ label: { en: "They became unresponsive", bg: "Изпадна в безсъзнание" }, tone: "critical", next: "airway" }],
  },
  cold: {
    id: "cold",
    kind: "instruction",
    visual: "❄️",
    title: { en: "Cold / hypothermia", bg: "Премръзване / хипотермия" },
    body: {
      en: "Get them out of wind and rain. Remove wet clothing and wrap them in dry layers or a blanket, including the head. Warm drinks only if fully awake. Handle gently.",
      bg: "Изведи го от вятъра и дъжда. Свали мокрите дрехи и го увий в сухи слоеве или одеяло, включително главата. Топли напитки само ако е в съзнание. Действай внимателно.",
    },
    options: [],
  },
  minor: {
    id: "minor",
    kind: "instruction",
    visual: "🩹",
    tone: "good",
    title: { en: "Cramp / exhaustion", bg: "Крампи / изтощение" },
    body: {
      en: "Help them rest in shade. Sips of water or electrolytes. Gently stretch and massage cramping muscles. Keep watching in case they get worse.",
      bg: "Помогни му да почине на сянка. Глътки вода или електролити. Внимателно разтегни и масажирай схванатите мускули. Наблюдавай за влошаване.",
    },
    options: [],
  },
  other: {
    id: "other",
    kind: "instruction",
    visual: "📝",
    title: { en: "Keep them safe", bg: "Пази го в безопасност" },
    body: {
      en: "Keep them comfortable and don't leave them alone. Note what you see so you can tell the medic on arrival — or call Race Command now.",
      bg: "Дръж го удобно и не го оставяй сам. Запомни какво виждаш, за да го кажеш на медика — или се обади на Командния център сега.",
    },
    options: [],
  },
};
