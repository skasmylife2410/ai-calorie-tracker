// doodle-messages.js — the line under the doodle, written for the person reading it.
//
// Messages are built from that person's own numbers (name, streak, protein left, exercise,
// weight trend, goal) and a new one is picked every 12 hours. Within a 12-hour window the
// message only changes if the doodle's state changes (e.g. the day goes over goal), because a
// message about a strong day would be wrong on a well-fed one.
//
// Tone: specific and warm, never shaming. Numbers are there to be useful, not to scold.

const SLOT_MS = 12 * 60 * 60 * 1000;

/** Stable pick: same person + same 12h slot + same pool -> same message. */
function pick(pool, seed) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return pool[Math.abs(h) % pool.length];
}

export function currentSlot(now = Date.now()) {
  return Math.floor(now / SLOT_MS);
}

const fmt = (n, lang) => new Intl.NumberFormat(lang).format(Math.round(n));
const kg = (n, lang) => new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(n);

/**
 * Every message: when(ctx) decides if it applies; en/es build the text.
 * ctx: { name, he/He/him/el/El (the doodle's pronouns), state, streak, eaten, target, remaining, proteinLeft, proteinHit, meals,
 *        exerciseMin, burned, weightDelta30, goalLeft, hour, daysSinceLog }
 */
const MESSAGES = [
  // ---- strong: streaks ------------------------------------------------------
  { state: "strong", when: (c) => c.streak >= 7,
    en: (c) => `${c.name}, ${c.streak} days in a row. That's not luck anymore, that's a habit.`,
    es: (c) => `${c.name}, ${c.streak} días seguidos. Eso ya no es suerte, es un hábito.` },
  { state: "strong", when: (c) => c.streak >= 3 && c.streak < 7,
    en: (c) => `${c.streak}-day streak, ${c.name}. Three more and it's a full week.`,
    es: (c) => `Racha de ${c.streak} días, ${c.name}. Unos días más y completas la semana.` },
  { state: "strong", when: (c) => c.streak >= 14,
    en: (c) => `Two weeks straight, ${c.name}. Most people quit before this point. You didn't.`,
    es: (c) => `Dos semanas seguidas, ${c.name}. Casi todos abandonan antes. Tú no.` },
  { state: "strong", when: (c) => c.streak <= 2,
    en: (c) => `Day ${Math.max(1, c.streak)}, ${c.name}. Every streak starts exactly here.`,
    es: (c) => `Día ${Math.max(1, c.streak)}, ${c.name}. Toda racha empieza justo aquí.` },

  // ---- strong: protein -------------------------------------------------------
  { state: "strong", when: (c) => c.proteinHit,
    en: (c) => `Protein target hit, ${c.name}. That's what keeps the muscle while the fat goes.`,
    es: (c) => `Meta de proteína cumplida, ${c.name}. Eso es lo que cuida el músculo mientras se va la grasa.` },
  { state: "strong", when: (c) => !c.proteinHit && c.proteinLeft > 0 && c.proteinLeft <= 40 && c.hour >= 12,
    en: (c, l) => `Only ${fmt(c.proteinLeft, l)} g of protein to go, ${c.name}. A yogurt or two eggs gets you there.`,
    es: (c, l) => `Te faltan solo ${fmt(c.proteinLeft, l)} g de proteína, ${c.name}. Un yogur o dos huevos y listo.` },
  { state: "strong", when: (c) => c.proteinLeft > 40 && c.hour >= 15,
    en: (c, l) => `${fmt(c.proteinLeft, l)} g of protein left today. Build dinner around it and you're set.`,
    es: (c, l) => `Te quedan ${fmt(c.proteinLeft, l)} g de proteína hoy. Arma la cena alrededor de eso y listo.` },

  // ---- strong: calories & meals ----------------------------------------------
  { state: "strong", when: (c) => c.remaining > 0 && c.remaining < 300 && c.meals >= 2,
    en: (c, l) => `Right on target, ${c.name} — ${fmt(c.remaining, l)} kcal of room left. Nicely judged.`,
    es: (c, l) => `Justo en la meta, ${c.name}: te quedan ${fmt(c.remaining, l)} kcal. Bien calculado.` },
  { state: "strong", when: (c) => c.meals === 0 && c.hour < 11,
    en: (c) => `Good morning, ${c.name}. Log breakfast and ${c.he}'s up and lifting.`,
    es: (c) => `Buenos días, ${c.name}. Registra el desayuno y ${c.el} arranca a entrenar.` },
  { state: "strong", when: (c) => c.meals >= 3,
    en: (c) => `${c.meals} meals logged today, ${c.name}. Tracking is the part most people skip.`,
    es: (c) => `${c.meals} comidas registradas hoy, ${c.name}. Registrar es lo que casi todos se saltan.` },
  { state: "strong", when: (c) => c.meals >= 1 && c.meals < 3,
    en: (c) => `Logging as you go, ${c.name}. That's the whole trick.`,
    es: (c) => `Registrando sobre la marcha, ${c.name}. Ese es todo el truco.` },

  // ---- strong: exercise ------------------------------------------------------
  { state: "strong", when: (c) => c.exerciseMin >= 30,
    en: (c) => `${c.exerciseMin} minutes of movement today, ${c.name}. ${c.He}'s lifting heavier because of it.`,
    es: (c) => `${c.exerciseMin} minutos de movimiento hoy, ${c.name}. Por eso ${c.el} levanta más.` },
  { state: "strong", when: (c) => c.exerciseMin > 0 && c.exerciseMin < 30,
    en: (c) => `Some movement is always better than none. Nice one, ${c.name}.`,
    es: (c) => `Algo de movimiento siempre es mejor que nada. Bien hecho, ${c.name}.` },

  // ---- strong: weight & goal -------------------------------------------------
  { state: "strong", when: (c) => c.weightDelta30 !== null && c.weightDelta30 <= -0.5,
    en: (c, l) => `Down ${kg(-c.weightDelta30, l)} kg on your 7-day average this month, ${c.name}. Slow and real.`,
    es: (c, l) => `Bajaste ${kg(-c.weightDelta30, l)} kg en tu promedio de 7 días este mes, ${c.name}. Lento y real.` },
  { state: "strong", when: (c) => c.goalLeft !== null && c.goalLeft > 0 && c.goalLeft <= 3,
    en: (c, l) => `${kg(c.goalLeft, l)} kg from your goal, ${c.name}. You can see it from here.`,
    es: (c, l) => `A ${kg(c.goalLeft, l)} kg de tu meta, ${c.name}. Ya se ve desde aquí.` },
  { state: "strong", when: (c) => c.goalLeft !== null && c.goalLeft > 3,
    en: (c) => `Every on-target day moves the goal closer, ${c.name}. Today counts.`,
    es: (c) => `Cada día en la meta acerca el objetivo, ${c.name}. Hoy cuenta.` },

  // ---- strong: general -------------------------------------------------------
  { state: "strong", when: () => true,
    en: (c) => `Looking strong, ${c.name}. Keep feeding ${c.him} good days.`,
    es: (c) => `Te ves fuerte, ${c.name}. Sigue dándole buenos días.` },
  { state: "strong", when: () => true,
    en: (c) => `Consistency beats perfection, ${c.name}. You're doing the consistent part.`,
    es: (c) => `La constancia le gana a la perfección, ${c.name}. Estás haciendo la parte constante.` },

  { state: "strong", when: () => true,
    en: (c) => `Small, boring, repeated. That's how it works, ${c.name}, and you're doing it.`,
    es: (c) => `Pequeño, aburrido y repetido. Así funciona, ${c.name}, y lo estás haciendo.` },
  { state: "strong", when: () => true,
    en: (c) => `${c.He} gets a little stronger every day you show up, ${c.name}.`,
    es: (c) => `${c.El} se pone un poco más fuerte cada día que apareces, ${c.name}.` },
  { state: "strong", when: (c) => c.hour >= 18,
    en: (c) => `Evening check-in, ${c.name}: the day's looking good. Finish it the same way.`,
    es: (c) => `Revisión de la noche, ${c.name}: el día va bien. Termínalo igual.` },
  { state: "strong", when: (c) => c.hour < 12,
    en: (c) => `Fresh day, ${c.name}. The plan is the same as yesterday: log it and stay close to target.`,
    es: (c) => `Día nuevo, ${c.name}. El plan es el de ayer: registrar y quedarse cerca de la meta.` },
  { state: "strong", when: (c) => c.remaining > 600 && c.hour >= 17,
    en: (c, l) => `${fmt(c.remaining, l)} kcal still available, ${c.name}. Eat a proper dinner — under-eating backfires.`,
    es: (c, l) => `Aún tienes ${fmt(c.remaining, l)} kcal, ${c.name}. Cena bien: comer de menos se devuelve.` },
  { state: "strong", when: (c) => c.exerciseMin === 0 && c.hour >= 14,
    en: (c) => `Even a 15-minute walk counts, ${c.name}. ${c.He}'d appreciate the company.`,
    es: (c) => `Hasta una caminata de 15 minutos cuenta, ${c.name}. A ${c.el} le gustaría la compañía.` },
  { state: "wellFed", when: (c) => c.proteinHit,
    en: (c) => `Over on calories, but protein target hit, ${c.name}. That part counts for a lot.`,
    es: (c) => `Te pasaste de calorías, pero cumpliste la proteína, ${c.name}. Eso cuenta mucho.` },
  { state: "idle", when: () => true,
    en: (c) => `${c.He}'s been waiting for you, ${c.name}. Nothing fancy needed — just one log.`,
    es: (c) => `${c.El} te ha estado esperando, ${c.name}. Nada complicado: solo un registro.` },
  // ---- well fed ---------------------------------------------------------------
  { state: "wellFed", when: (c) => c.eaten - c.target < 250,
    en: (c, l) => `Just ${fmt(c.eaten - c.target, l)} kcal over, ${c.name}. That's a rounding error, not a setback.`,
    es: (c, l) => `Solo ${fmt(c.eaten - c.target, l)} kcal de más, ${c.name}. Eso es un redondeo, no un retroceso.` },
  { state: "wellFed", when: (c) => c.eaten - c.target >= 250,
    en: (c) => `Big day, ${c.name}. One day doesn't undo a week. Back to normal tomorrow.`,
    es: (c) => `Día grande, ${c.name}. Un día no deshace una semana. Mañana, a lo normal.` },
  { state: "wellFed", when: (c) => c.streak >= 3,
    en: (c) => `Still a ${c.streak}-day logging streak, ${c.name}. Logging the big days is what keeps it honest.`,
    es: (c) => `Sigues con ${c.streak} días registrando, ${c.name}. Registrar los días grandes es lo que lo hace honesto.` },
  { state: "wellFed", when: (c) => c.exerciseMin > 0,
    en: (c) => `You moved today and you ate well. ${c.He}'s resting it off on the couch.`,
    es: (c) => `Hoy te moviste y comiste bien. ${c.El} lo está descansando en el sofá.` },
  { state: "wellFed", when: () => true,
    en: (c) => `Over today, ${c.name}, and that's fine. What happens this week matters more than today.`,
    es: (c) => `Hoy te pasaste, ${c.name}, y está bien. Importa más la semana que el día.` },
  { state: "wellFed", when: () => true,
    en: (c) => `Well fed and honest about it. That's more useful than a perfect-looking log.`,
    es: (c) => `Bien comido y registrado con honestidad. Eso sirve más que un registro perfecto.` },

  // ---- idle -------------------------------------------------------------------
  { state: "idle", when: (c) => c.daysSinceLog >= 2 && c.daysSinceLog < 5,
    en: (c) => `Hey ${c.name}, it's been ${c.daysSinceLog} days. Log one thing today and ${c.he}'s back up.`,
    es: (c) => `Oye ${c.name}, van ${c.daysSinceLog} días. Registra una cosa hoy y ${c.el} se levanta.` },
  { state: "idle", when: (c) => c.daysSinceLog >= 5,
    en: (c) => `Welcome back, ${c.name}. No need to catch up — just start from today.`,
    es: (c) => `Qué bueno verte, ${c.name}. No hace falta ponerse al día: empieza desde hoy.` },
  { state: "idle", when: () => true,
    en: (c) => `One meal logged is all it takes to restart, ${c.name}.`,
    es: (c) => `Con registrar una comida basta para arrancar de nuevo, ${c.name}.` },
  { state: "idle", when: (c) => c.goalLeft !== null,
    en: (c, l) => `Your goal is still ${kg(c.goalLeft, l)} kg away, ${c.name}, and still reachable. Pick up where you left off.`,
    es: (c, l) => `Tu meta sigue a ${kg(c.goalLeft, l)} kg, ${c.name}, y sigue siendo alcanzable. Retoma donde quedaste.` },
];

/**
 * @param {object} ctx  see MESSAGES header
 * @param {{lang:"en"|"es", username:string, now?:number}} opts
 */
export function doodleMessage(ctx, { lang = "en", username = "", now = Date.now() } = {}) {
  // The doodle is "he" or "she" depending on which doodle the person chose.
  const girl = ctx.variant === "b";
  ctx = { ...ctx, he: girl ? "she" : "he", He: girl ? "She" : "He", him: girl ? "her" : "him", el: girl ? "ella" : "él", El: girl ? "Ella" : "Él" };
  const pool = MESSAGES.filter((m) => m.state === ctx.state && safe(() => m.when(ctx)));
  const chosen = pool.length ? pick(pool, `${username}|${currentSlot(now)}|${ctx.state}`) : null;
  if (!chosen) return "";
  const build = chosen[lang] ?? chosen.en;
  return build(ctx, lang === "es" ? "es" : "en");
}

function safe(fn) {
  try { return fn(); } catch { return false; }
}

export const _MESSAGES_FOR_TESTS = MESSAGES;
