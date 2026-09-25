// foods-local.js — a small built-in food list, searched on the phone.
//
// Why this exists: Open Food Facts and USDA both match WHOLE WORDS, so typing "pech" or
// "chick" returns nothing and people have to type the full word (and the right language).
// This list is matched locally with prefix and accent-insensitive search, so results appear
// from the first few letters, in English or Spanish, instantly and offline.
//
// Everyday foods and Colombian staples, per 100 g (or per 100 ml for drinks).
// It doesn't replace the databases — the remote results are appended underneath.

export const LOCAL_FOODS = [
  { en: "Chicken breast, cooked", es: "Pechuga de pollo cocida", kcal: 165, p: 31, c: 0, f: 3.6, s: "pollo chicken breast pechuga" },
  { en: "Chicken thigh, cooked", es: "Muslo de pollo cocido", kcal: 209, p: 26, c: 0, f: 10.9, s: "pollo muslo thigh" },
  { en: "Beef, lean, cooked", es: "Carne de res magra cocida", kcal: 250, p: 26, c: 0, f: 15, s: "res beef carne steak bistec" },
  { en: "Pork loin, cooked", es: "Lomo de cerdo cocido", kcal: 242, p: 27, c: 0, f: 14, s: "cerdo pork lomo" },
  { en: "Bacon, cooked", es: "Tocineta frita", kcal: 541, p: 37, c: 1.4, f: 42, s: "bacon tocineta tocino" },
  { en: "Salmon, cooked", es: "Salmón cocido", kcal: 208, p: 20, c: 0, f: 13, s: "salmon salmón pescado fish" },
  { en: "Tilapia, cooked", es: "Mojarra/tilapia cocida", kcal: 128, p: 26, c: 0, f: 2.7, s: "tilapia mojarra pescado" },
  { en: "Tuna, canned in water", es: "Atún en agua", kcal: 116, p: 26, c: 0, f: 1, s: "atun atún tuna" },
  { en: "Shrimp, cooked", es: "Camarones cocidos", kcal: 99, p: 24, c: 0.2, f: 0.3, s: "camaron camarón shrimp" },
  { en: "Egg, whole", es: "Huevo entero", kcal: 143, p: 13, c: 0.7, f: 9.5, s: "huevo egg huevos" },
  { en: "Egg white", es: "Clara de huevo", kcal: 52, p: 11, c: 0.7, f: 0.2, s: "clara egg white" },
  { en: "Tofu, firm", es: "Tofu firme", kcal: 144, p: 15, c: 3, f: 9, s: "tofu" },
  { en: "Greek yogurt, plain", es: "Yogur griego natural", kcal: 59, p: 10, c: 3.6, f: 0.4, s: "yogur yogurt griego greek" },
  { en: "Whole milk", es: "Leche entera", kcal: 61, p: 3.2, c: 4.8, f: 3.3, s: "leche milk" },
  { en: "Skim milk", es: "Leche descremada", kcal: 34, p: 3.4, c: 5, f: 0.1, s: "leche descremada skim" },
  { en: "Cheese, fresh (queso fresco)", es: "Queso fresco", kcal: 264, p: 17, c: 3, f: 20, s: "queso cheese fresco" },
  { en: "Cheddar cheese", es: "Queso cheddar", kcal: 403, p: 23, c: 3.4, f: 33, s: "queso cheddar cheese" },
  { en: "Whey protein powder", es: "Proteína en polvo (whey)", kcal: 400, p: 80, c: 8, f: 5, s: "proteina proteína whey polvo protein powder" },
  { en: "White rice, cooked", es: "Arroz blanco cocido", kcal: 130, p: 2.7, c: 28, f: 0.3, s: "arroz rice blanco" },
  { en: "Brown rice, cooked", es: "Arroz integral cocido", kcal: 123, p: 2.7, c: 26, f: 1, s: "arroz integral brown rice" },
  { en: "Pasta, cooked", es: "Pasta cocida", kcal: 158, p: 5.8, c: 31, f: 0.9, s: "pasta espagueti spaghetti fideos noodles" },
  { en: "Bread, white", es: "Pan blanco", kcal: 265, p: 9, c: 49, f: 3.2, s: "pan bread blanco" },
  { en: "Whole wheat bread", es: "Pan integral", kcal: 247, p: 13, c: 41, f: 3.4, s: "pan integral whole wheat bread" },
  { en: "Arepa de maíz", es: "Arepa de maíz", kcal: 219, p: 4.4, c: 45, f: 2.2, s: "arepa maiz maíz" },
  { en: "Arepa con queso", es: "Arepa con queso", kcal: 265, p: 8, c: 38, f: 9, s: "arepa queso" },
  { en: "Empanada, fried", es: "Empanada frita", kcal: 320, p: 9, c: 33, f: 17, s: "empanada" },
  { en: "Pandebono", es: "Pandebono", kcal: 380, p: 12, c: 42, f: 18, s: "pandebono pan de bono" },
  { en: "Buñuelo", es: "Buñuelo", kcal: 400, p: 13, c: 36, f: 23, s: "buñuelo bunuelo" },
  { en: "Tortilla, corn", es: "Tortilla de maíz", kcal: 218, p: 5.7, c: 45, f: 2.9, s: "tortilla maiz maíz corn" },
  { en: "Potato, boiled", es: "Papa cocida", kcal: 87, p: 1.9, c: 20, f: 0.1, s: "papa potato papas" },
  { en: "French fries", es: "Papas fritas", kcal: 312, p: 3.4, c: 41, f: 15, s: "papas fritas french fries" },
  { en: "Sweet potato, baked", es: "Batata/camote al horno", kcal: 90, p: 2, c: 21, f: 0.1, s: "batata camote sweet potato" },
  { en: "Yuca, boiled", es: "Yuca cocida", kcal: 160, p: 1.4, c: 38, f: 0.3, s: "yuca cassava" },
  { en: "Plantain, fried (patacón)", es: "Patacón frito", kcal: 309, p: 2, c: 52, f: 11, s: "patacon patacón platano plátano plantain" },
  { en: "Plantain, ripe fried (maduro)", es: "Plátano maduro frito", kcal: 275, p: 1.5, c: 50, f: 8, s: "maduro platano plátano tajada" },
  { en: "Oats, dry", es: "Avena cruda", kcal: 389, p: 17, c: 66, f: 7, s: "avena oats oatmeal" },
  { en: "Quinoa, cooked", es: "Quinua cocida", kcal: 120, p: 4.4, c: 21, f: 1.9, s: "quinua quinoa" },
  { en: "Black beans, cooked", es: "Frijoles negros cocidos", kcal: 132, p: 8.9, c: 24, f: 0.5, s: "frijol frijoles beans negros" },
  { en: "Red beans, cooked", es: "Fríjoles rojos cocidos", kcal: 127, p: 8.7, c: 23, f: 0.5, s: "frijol frijoles rojos beans" },
  { en: "Lentils, cooked", es: "Lentejas cocidas", kcal: 116, p: 9, c: 20, f: 0.4, s: "lenteja lentejas lentils" },
  { en: "Chickpeas, cooked", es: "Garbanzos cocidos", kcal: 164, p: 8.9, c: 27, f: 2.6, s: "garbanzo garbanzos chickpeas" },
  { en: "Corn, cooked", es: "Maíz cocido", kcal: 96, p: 3.4, c: 21, f: 1.5, s: "maiz maíz corn mazorca" },
  { en: "Avocado", es: "Aguacate", kcal: 160, p: 2, c: 9, f: 15, s: "aguacate avocado" },
  { en: "Banana", es: "Banano", kcal: 89, p: 1.1, c: 23, f: 0.3, s: "banano banana platano plátano" },
  { en: "Apple", es: "Manzana", kcal: 52, p: 0.3, c: 14, f: 0.2, s: "manzana apple" },
  { en: "Orange", es: "Naranja", kcal: 47, p: 0.9, c: 12, f: 0.1, s: "naranja orange" },
  { en: "Mango", es: "Mango", kcal: 60, p: 0.8, c: 15, f: 0.4, s: "mango" },
  { en: "Papaya", es: "Papaya", kcal: 43, p: 0.5, c: 11, f: 0.3, s: "papaya" },
  { en: "Pineapple", es: "Piña", kcal: 50, p: 0.5, c: 13, f: 0.1, s: "pina piña pineapple" },
  { en: "Strawberries", es: "Fresas", kcal: 32, p: 0.7, c: 7.7, f: 0.3, s: "fresa fresas strawberry strawberries" },
  { en: "Blueberries", es: "Arándanos", kcal: 57, p: 0.7, c: 14, f: 0.3, s: "arandano arándanos blueberry blueberries" },
  { en: "Watermelon", es: "Sandía", kcal: 30, p: 0.6, c: 7.6, f: 0.2, s: "sandia sandía watermelon" },
  { en: "Grapes", es: "Uvas", kcal: 69, p: 0.7, c: 18, f: 0.2, s: "uva uvas grapes" },
  { en: "Guava", es: "Guayaba", kcal: 68, p: 2.6, c: 14, f: 1, s: "guayaba guava" },
  { en: "Tomato", es: "Tomate", kcal: 18, p: 0.9, c: 3.9, f: 0.2, s: "tomate tomato" },
  { en: "Lettuce", es: "Lechuga", kcal: 15, p: 1.4, c: 2.9, f: 0.2, s: "lechuga lettuce" },
  { en: "Spinach", es: "Espinaca", kcal: 23, p: 2.9, c: 3.6, f: 0.4, s: "espinaca spinach" },
  { en: "Broccoli, cooked", es: "Brócoli cocido", kcal: 35, p: 2.4, c: 7.2, f: 0.4, s: "brocoli brócoli broccoli" },
  { en: "Carrot", es: "Zanahoria", kcal: 41, p: 0.9, c: 10, f: 0.2, s: "zanahoria carrot" },
  { en: "Onion", es: "Cebolla", kcal: 40, p: 1.1, c: 9.3, f: 0.1, s: "cebolla onion" },
  { en: "Cucumber", es: "Pepino", kcal: 15, p: 0.7, c: 3.6, f: 0.1, s: "pepino cucumber" },
  { en: "Bell pepper", es: "Pimentón", kcal: 31, p: 1, c: 6, f: 0.3, s: "pimenton pimentón pepper" },
  { en: "Green beans", es: "Habichuelas", kcal: 31, p: 1.8, c: 7, f: 0.2, s: "habichuela habichuelas green beans" },
  { en: "Mixed salad", es: "Ensalada mixta", kcal: 20, p: 1.2, c: 4, f: 0.2, s: "ensalada salad" },
  { en: "Olive oil", es: "Aceite de oliva", kcal: 884, p: 0, c: 0, f: 100, s: "aceite oliva olive oil" },
  { en: "Butter", es: "Mantequilla", kcal: 717, p: 0.9, c: 0.1, f: 81, s: "mantequilla butter" },
  { en: "Mayonnaise", es: "Mayonesa", kcal: 680, p: 1, c: 0.6, f: 75, s: "mayonesa mayo mayonnaise" },
  { en: "Peanut butter", es: "Mantequilla de maní", kcal: 588, p: 25, c: 20, f: 50, s: "mani maní peanut butter mantequilla" },
  { en: "Peanuts", es: "Maní", kcal: 567, p: 26, c: 16, f: 49, s: "mani maní peanuts" },
  { en: "Almonds", es: "Almendras", kcal: 579, p: 21, c: 22, f: 50, s: "almendra almendras almonds" },
  { en: "Walnuts", es: "Nueces", kcal: 654, p: 15, c: 14, f: 65, s: "nuez nueces walnuts" },
  { en: "Dark chocolate 70%", es: "Chocolate negro 70%", kcal: 598, p: 7.8, c: 46, f: 43, s: "chocolate negro dark" },
  { en: "Sugar", es: "Azúcar", kcal: 387, p: 0, c: 100, f: 0, s: "azucar azúcar sugar" },
  { en: "Panela", es: "Panela", kcal: 380, p: 0.5, c: 98, f: 0, s: "panela" },
  { en: "Honey", es: "Miel", kcal: 304, p: 0.3, c: 82, f: 0, s: "miel honey" },
  { en: "Coffee, black", es: "Café negro (tinto)", kcal: 2, p: 0.1, c: 0, f: 0, s: "cafe café tinto coffee" },
  { en: "Coffee with milk", es: "Café con leche", kcal: 35, p: 1.8, c: 3, f: 1.5, s: "cafe café leche latte coffee" },
  { en: "Orange juice", es: "Jugo de naranja", kcal: 45, p: 0.7, c: 10, f: 0.2, s: "jugo naranja juice" },
  { en: "Soda, regular", es: "Gaseosa regular", kcal: 42, p: 0, c: 11, f: 0, s: "gaseosa soda coca refresco" },
  { en: "Beer", es: "Cerveza", kcal: 43, p: 0.5, c: 3.6, f: 0, s: "cerveza beer" },
  { en: "Red wine", es: "Vino tinto", kcal: 85, p: 0.1, c: 2.6, f: 0, s: "vino wine tinto" },
  { en: "Sancocho de pollo", es: "Sancocho de pollo", kcal: 85, p: 6, c: 8, f: 3, s: "sancocho sopa soup pollo" },
  { en: "Ajiaco", es: "Ajiaco", kcal: 95, p: 6, c: 11, f: 3, s: "ajiaco sopa soup" },
  { en: "Bandeja paisa (plate)", es: "Bandeja paisa (plato)", kcal: 250, p: 14, c: 20, f: 12, s: "bandeja paisa" },
  { en: "Hamburger", es: "Hamburguesa", kcal: 295, p: 17, c: 24, f: 14, s: "hamburguesa burger hamburger" },
  { en: "Pizza, cheese", es: "Pizza de queso", kcal: 266, p: 11, c: 33, f: 10, s: "pizza" },
  { en: "Hot dog", es: "Perro caliente", kcal: 290, p: 10, c: 22, f: 18, s: "perro caliente hot dog" },
  { en: "Tamal", es: "Tamal", kcal: 180, p: 8, c: 18, f: 8, s: "tamal tamales" },
  { en: "Chicharrón", es: "Chicharrón", kcal: 544, p: 30, c: 0, f: 47, s: "chicharron chicharrón cerdo" },
  { en: "Sausage (chorizo)", es: "Chorizo", kcal: 455, p: 25, c: 2, f: 38, s: "chorizo salchicha sausage" },
  { en: "Ham, sliced", es: "Jamón en lonjas", kcal: 145, p: 18, c: 1.5, f: 7, s: "jamon jamón ham" },
  { en: "Protein bar", es: "Barra de proteína", kcal: 350, p: 30, c: 38, f: 9, s: "barra proteina proteína protein bar" },
  { en: "Granola", es: "Granola", kcal: 471, p: 10, c: 64, f: 20, s: "granola cereal" },
  { en: "Corn flakes", es: "Hojuelas de maíz", kcal: 357, p: 7, c: 84, f: 0.4, s: "cereal hojuelas corn flakes" },
  { en: "Ice cream, vanilla", es: "Helado de vainilla", kcal: 207, p: 3.5, c: 24, f: 11, s: "helado ice cream vainilla" },
  { en: "Cookies", es: "Galletas", kcal: 480, p: 6, c: 64, f: 22, s: "galleta galletas cookies" },
  { en: "Potato chips", es: "Papas de paquete", kcal: 536, p: 7, c: 53, f: 35, s: "papas paquete chips" },
  { en: "Popcorn, plain", es: "Crispetas sin sal", kcal: 387, p: 12, c: 78, f: 4.5, s: "crispeta crispetas popcorn maiz pira" },
];

// Per 100 g: [fiber g, total sugars g, added sugar g, saturated fat g, sodium mg, potassium mg].
// USDA values where a close match exists; Colombian dishes are typical home recipes.
const LOCAL_MICROS = {
  "Chicken breast, cooked": [0, 0, 0, 1.0, 74, 256],
  "Chicken thigh, cooked": [0, 0, 0, 3.0, 95, 240],
  "Beef, lean, cooked": [0, 0, 0, 6.0, 72, 318],
  "Pork loin, cooked": [0, 0, 0, 5.0, 62, 380],
  "Bacon, cooked": [0, 0, 0, 14, 1717, 565],
  "Salmon, cooked": [0, 0, 0, 3.1, 61, 384],
  "Tilapia, cooked": [0, 0, 0, 0.9, 56, 380],
  "Tuna, canned in water": [0, 0, 0, 0.3, 247, 237],
  "Shrimp, cooked": [0, 0, 0, 0.1, 111, 170],
  "Egg, whole": [0, 0.4, 0, 3.1, 142, 138],
  "Egg white": [0, 0.7, 0, 0, 166, 163],
  "Tofu, firm": [2.3, 0.6, 0, 1.3, 14, 237],
  "Greek yogurt, plain": [0, 3.2, 0, 0.1, 36, 141],
  "Whole milk": [0, 4.8, 0, 1.9, 43, 132],
  "Skim milk": [0, 5, 0, 0.1, 42, 156],
  "Cheese, fresh (queso fresco)": [0, 3, 0, 11, 750, 130],
  "Cheddar cheese": [0, 0.5, 0, 19, 653, 76],
  "Whey protein powder": [0, 5, 2, 2.5, 200, 500],
  "White rice, cooked": [0.4, 0.1, 0, 0.1, 1, 35],
  "Brown rice, cooked": [1.6, 0.2, 0, 0.3, 4, 86],
  "Pasta, cooked": [1.8, 0.6, 0, 0.2, 1, 44],
  "Bread, white": [2.7, 5, 4, 0.7, 490, 115],
  "Whole wheat bread": [6, 5.6, 3, 0.7, 450, 250],
  "Arepa de maíz": [3, 0.5, 0, 0.3, 250, 90],
  "Arepa con queso": [2.5, 1, 0, 4.5, 450, 100],
  "Empanada, fried": [2, 1, 0, 3.5, 450, 180],
  "Pandebono": [0.5, 2, 1, 8, 550, 80],
  "Buñuelo": [0.5, 2, 1, 9, 500, 80],
  "Tortilla, corn": [6.3, 0.9, 0, 0.4, 45, 186],
  "Potato, boiled": [1.8, 0.9, 0, 0, 5, 379],
  "French fries": [3.8, 0.3, 0, 2.3, 210, 580],
  "Sweet potato, baked": [3.3, 6.5, 0, 0, 36, 475],
  "Yuca, boiled": [1.8, 1.7, 0, 0.1, 14, 270],
  "Plantain, fried (patacón)": [3, 1, 0, 1.5, 150, 450],
  "Plantain, ripe fried (maduro)": [2.3, 14, 0, 1.3, 5, 450],
  "Oats, dry": [10, 1, 0, 1.2, 2, 430],
  "Quinoa, cooked": [2.8, 0.9, 0, 0.2, 7, 172],
  "Black beans, cooked": [8.7, 0.3, 0, 0.1, 1, 355],
  "Red beans, cooked": [7.4, 0.3, 0, 0.1, 2, 405],
  "Lentils, cooked": [7.9, 1.8, 0, 0.1, 2, 369],
  "Chickpeas, cooked": [7.6, 4.8, 0, 0.3, 7, 291],
  "Corn, cooked": [2.4, 4.5, 0, 0.2, 1, 218],
  "Avocado": [6.7, 0.7, 0, 2.1, 7, 485],
  "Banana": [2.6, 12, 0, 0.1, 1, 358],
  "Apple": [2.4, 10, 0, 0, 1, 107],
  "Orange": [2.4, 9.4, 0, 0, 0, 181],
  "Mango": [1.6, 14, 0, 0.1, 1, 168],
  "Papaya": [1.7, 7.8, 0, 0.1, 8, 182],
  "Pineapple": [1.4, 10, 0, 0, 1, 109],
  "Strawberries": [2, 4.9, 0, 0, 1, 153],
  "Blueberries": [2.4, 10, 0, 0, 1, 77],
  "Watermelon": [0.4, 6.2, 0, 0, 1, 112],
  "Grapes": [0.9, 15, 0, 0.1, 2, 191],
  "Guava": [5.4, 8.9, 0, 0.3, 2, 417],
  "Tomato": [1.2, 2.6, 0, 0, 5, 237],
  "Lettuce": [1.3, 0.8, 0, 0, 28, 194],
  "Spinach": [2.2, 0.4, 0, 0.1, 79, 558],
  "Broccoli, cooked": [3.3, 1.4, 0, 0.1, 41, 293],
  "Carrot": [2.8, 4.7, 0, 0, 69, 320],
  "Onion": [1.7, 4.2, 0, 0, 4, 146],
  "Cucumber": [0.5, 1.7, 0, 0, 2, 147],
  "Bell pepper": [2.1, 4.2, 0, 0, 4, 211],
  "Green beans": [2.7, 3.3, 0, 0, 6, 211],
  "Mixed salad": [1.5, 2, 0, 0, 20, 200],
  "Olive oil": [0, 0, 0, 14, 2, 1],
  "Butter": [0, 0.1, 0, 51, 643, 24],
  "Mayonnaise": [0, 0.6, 0.5, 11.7, 635, 20],
  "Peanut butter": [6, 9, 5, 10, 430, 560],
  "Peanuts": [8.5, 4, 0, 6.3, 18, 705],
  "Almonds": [12.5, 4.4, 0, 3.8, 1, 733],
  "Walnuts": [6.7, 2.6, 0, 6.1, 2, 441],
  "Dark chocolate 70%": [11, 24, 24, 24.5, 20, 715],
  "Sugar": [0, 100, 100, 0, 1, 2],
  "Panela": [0, 85, 85, 0, 30, 300],
  "Honey": [0.2, 82, 82, 0, 4, 52],
  "Coffee, black": [0, 0, 0, 0, 2, 49],
  "Coffee with milk": [0, 3, 0, 0.9, 20, 80],
  "Orange juice": [0.2, 8.4, 0, 0, 1, 200],
  "Soda, regular": [0, 10.6, 10.6, 0, 4, 2],
  "Beer": [0, 0, 0, 0, 4, 27],
  "Red wine": [0, 0.6, 0, 0, 4, 127],
  "Sancocho de pollo": [1, 1, 0, 0.8, 300, 200],
  "Ajiaco": [1.2, 1, 0, 1, 280, 250],
  "Bandeja paisa (plate)": [3, 1, 0, 4, 450, 280],
  "Hamburger": [1.2, 4.5, 3, 5, 420, 230],
  "Pizza, cheese": [2.3, 3.6, 1.5, 4.5, 600, 170],
  "Hot dog": [0.8, 3.5, 2, 6.5, 800, 150],
  "Tamal": [1.5, 1, 0, 3, 380, 150],
  "Chicharrón": [0, 0, 0, 16, 800, 120],
  "Sausage (chorizo)": [0, 1, 0, 14, 1200, 300],
  "Ham, sliced": [0, 1.5, 1, 2.3, 1200, 290],
  "Protein bar": [7, 12, 10, 4, 250, 250],
  "Granola": [6, 24, 20, 4, 30, 450],
  "Corn flakes": [3.3, 9.5, 8, 0.1, 730, 100],
  "Ice cream, vanilla": [0.7, 21, 17, 6.8, 80, 199],
  "Cookies": [2, 32, 30, 9, 350, 120],
  "Potato chips": [4.4, 0.3, 0, 3.5, 527, 1275],
  "Popcorn, plain": [14.5, 0.9, 0, 0.6, 8, 329],
};

/** A local food's nutrients per 100 g as a micros object, or null if the table lacks it. */
export function localMicros(food) {
  const row = LOCAL_MICROS[food?.en];
  if (!row) return null;
  const [fiberG, sugarG, addedSugarG, satFatG, sodiumMg, potassiumMg] = row;
  return { fiberG, sugarG, addedSugarG, satFatG, sodiumMg, potassiumMg };
}

/** Lowercase, strip accents, so "platano" matches "plátano". */
export function normalize(text) {
  return String(text ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

/**
 * Scores a food against a query. Higher is better; 0 means no match.
 * Every query word must match the start of some word in the food's names or synonyms —
 * that's what makes partial typing work without returning nonsense.
 */
export function scoreFood(food, query) {
  const q = normalize(query);
  if (q === "") return 0;
  const haystack = normalize(`${food.en} ${food.es} ${food.s}`);
  const words = haystack.split(/[^a-z0-9]+/).filter(Boolean);
  let score = 0;
  for (const term of q.split(/\s+/).filter(Boolean)) {
    const exact = words.includes(term);
    const prefix = words.some((w) => w.startsWith(term));
    if (!exact && !prefix) return 0;              // every word must match something
    score += exact ? 3 : 2;
    if (normalize(food.en).startsWith(term) || normalize(food.es).startsWith(term)) score += 2;
  }
  // shorter names first: "Banana" should beat "Banana bread" for "banana"
  return score * 100 - Math.min(90, food.en.length);
}

/**
 * @returns {Array} products in the same shape the search screen uses, per 100 g
 */
export function searchLocalFoods(query, { lang = "en", limit = 8 } = {}) {
  return LOCAL_FOODS
    .map((food) => ({ food, score: scoreFood(food, query) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ food }) => ({
      barcode: null,
      name: lang === "es" ? food.es : food.en,
      brand: null,
      servingDescription: "per 100 g",
      calories: food.kcal,
      proteinG: food.p,
      carbsG: food.c,
      fatG: food.f,
      micros: localMicros(food),
      source: "local",
    }));
}
