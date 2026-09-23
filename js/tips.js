// tips.js — short, practical advice on logging accurately, shown on Home in rotation with the
// daily myth and the personal message. Every one is something that actually changes a number:
// no "stay hydrated", no cheerleading.

export const TIPS = [
 { en: { t: "Log it before you eat it", b: "Logging first takes ten seconds and you never forget. Logging after means guessing what was on the plate." },
   es: { t: "Registra antes de comer", b: "Registrar primero toma diez segundos y nunca se te olvida. Hacerlo después es adivinar lo que había en el plato." } },
 { en: { t: "Oil is the calorie you never see", b: "A tablespoon of oil is about 120 kcal. Two pans a day is a small meal. If it was fried or sautéed, add the oil as its own item." },
   es: { t: "El aceite es la caloría invisible", b: "Una cucharada de aceite son unas 120 kcal. Dos sartenes al día son una comida pequeña. Si fue frito o salteado, agrega el aceite como otro ingrediente." } },
 { en: { t: "Weigh food for two weeks, then never again", b: "A kitchen scale for two weeks teaches your eye what 150 g of rice looks like. After that, eyeballing is close enough." },
   es: { t: "Pesa la comida dos semanas y ya", b: "Una pesa de cocina por dos semanas le enseña a tu ojo cómo se ven 150 g de arroz. Después, calcular a ojo queda bastante cerca." } },
 { en: { t: "Type beats photo for accuracy", b: "A photo can't see how much oil or how heavy the arepa is. \"150 g chicken, one cup of rice\" gives a far better estimate." },
   es: { t: "Escribir supera a la foto", b: "Una foto no ve el aceite ni el peso de la arepa. «150 g de pollo, una taza de arroz» da un cálculo mucho mejor." } },
 { en: { t: "Say the amount out loud", b: "With voice logging, include the quantity: \"two eggs, one arepa, a coffee with milk\" beats \"breakfast\"." },
   es: { t: "Di la cantidad en voz alta", b: "Al registrar por voz, incluye la cantidad: «dos huevos, una arepa, un café con leche» es mejor que «desayuno»." } },
 { en: { t: "Sauces and dressings count", b: "Two tablespoons of dressing can be 150 kcal — more than the salad. Log them separately so you can see the cost." },
   es: { t: "Las salsas y aderezos cuentan", b: "Dos cucharadas de aderezo pueden ser 150 kcal, más que la ensalada. Regístralas aparte para ver lo que cuestan." } },
 { en: { t: "Drinks are food", b: "Juice, soda, beer and a sweet coffee slip past because you don't chew them. A large juice can equal a meal's worth of sugar." },
   es: { t: "Las bebidas también son comida", b: "El jugo, la gaseosa, la cerveza y un café dulce se escapan porque no se mastican. Un jugo grande puede tener el azúcar de una comida." } },
 { en: { t: "Log the bites you didn't plan", b: "A spoon while cooking, the kids' leftovers, two chips from a friend's plate. They're the usual reason the week doesn't add up." },
   es: { t: "Registra los picoteos", b: "La cucharada mientras cocinas, las sobras de los niños, dos papas del plato de un amigo. Suelen ser la razón por la que la semana no cuadra." } },
 { en: { t: "Restaurant food runs high", b: "Kitchens cook with more oil and butter than you do. When eating out, assume 20–30% more than the same dish at home." },
   es: { t: "La comida de restaurante rinde más calorías", b: "Las cocinas usan más aceite y mantequilla que tú. Al comer fuera, asume 20–30% más que ese mismo plato en casa." } },
 { en: { t: "Check the portion on a plate", b: "In any meal with ingredients, tap \"Check this portion on a plate\" — it draws your meal to scale so you can see if you're eyeballing right." },
   es: { t: "Revisa la porción en un plato", b: "En cualquier comida con ingredientes, toca «Ver esta porción en un plato»: la dibuja a escala para ver si estás calculando bien." } },
 { en: { t: "Use your hand when there's no scale", b: "A palm of meat ≈ 100 g. A fist of vegetables ≈ one cup. A cupped hand of rice ≈ half a cup. A thumb of oil ≈ a tablespoon." },
   es: { t: "Usa la mano cuando no hay pesa", b: "Una palma de carne ≈ 100 g. Un puño de verduras ≈ una taza. Una mano ahuecada de arroz ≈ media taza. Un pulgar de aceite ≈ una cucharada." } },
 { en: { t: "Labels can understate by a fifth", b: "US rules allow up to 20% more calories than the label says. Another reason to watch the weekly trend, not one day." },
   es: { t: "Las etiquetas pueden quedarse cortas", b: "En EE. UU. se permite hasta un 20% más de calorías de lo que dice la etiqueta. Otra razón para mirar la tendencia semanal y no un día." } },
 { en: { t: "Log the bad days too", b: "A skipped day makes the app think you ate less than you did, and your learned maintenance drops. Log it honestly; nobody's judging." },
   es: { t: "Registra también los días malos", b: "Un día sin registrar hace creer a la app que comiste menos, y tu mantenimiento aprendido baja. Regístralo con honestidad; nadie te juzga." } },
 { en: { t: "Save meals you repeat", b: "Heart the meals you eat weekly. Logging them again takes one tap — and repeated meals get more accurate every time you correct them." },
   es: { t: "Guarda las comidas que repites", b: "Dale corazón a las comidas de cada semana. Volver a registrarlas es un toque, y mejoran cada vez que las corriges." } },
 { en: { t: "Correct the estimate, don't delete it", b: "If the AI guessed 600 and it was more like 900, edit the number. Deleting it loses the meal; editing teaches you what 900 looks like." },
   es: { t: "Corrige el cálculo, no lo borres", b: "Si la IA dijo 600 y eran más bien 900, edita el número. Borrarlo pierde la comida; corregirlo te enseña cómo se ven 900." } },
 { en: { t: "Weigh yourself the same way", b: "First thing, after the bathroom, before eating, same clothes. The number matters less than comparing like with like." },
   es: { t: "Pésate siempre igual", b: "Al levantarte, después del baño, antes de comer, con la misma ropa. El número importa menos que comparar lo comparable." } },
 { en: { t: "Rice and pasta double when cooked", b: "100 g dry rice is about 300 g cooked. Log what you actually ate, and say whether it's raw or cooked." },
   es: { t: "El arroz y la pasta se duplican al cocinarse", b: "100 g de arroz crudo son unos 300 g cocidos. Registra lo que comiste y aclara si es crudo o cocido." } },
 { en: { t: "Two weeks beats two days", b: "Weight swings a kilo on salt and water. Judge a change by the 7-day average over two weeks, never by yesterday." },
   es: { t: "Dos semanas valen más que dos días", b: "El peso varía un kilo por sal y agua. Juzga el cambio por el promedio de 7 días durante dos semanas, nunca por ayer." } },
 { en: { t: "Protein first when you're short", b: "If you're near your limit, spend what's left on protein. It keeps muscle while you lose fat, and it's the hardest to catch up on." },
   es: { t: "Primero la proteína cuando queda poco", b: "Si vas justo, gasta lo que queda en proteína. Cuida el músculo mientras pierdes grasa y es lo más difícil de recuperar." } },
 { en: { t: "Log breakfast before you leave", b: "Mornings are the easiest meal to log accurately and the easiest to forget once the day starts." },
   es: { t: "Registra el desayuno antes de salir", b: "La mañana es la comida más fácil de registrar bien y la más fácil de olvidar cuando arranca el día." } },
];

export function tipForSlot(slot, lang = "en") {
  const t = TIPS[((slot % TIPS.length) + TIPS.length) % TIPS.length];
  return t[lang] ?? t.en;
}
