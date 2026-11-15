"""Hand-written word lists for the word games on surnames (Tiro Secco, SPEC §4.1).

Not a data source: no football fact comes from here. Each entry only says what a surname *means* (or whom it recalls),
so that a question can cross that meaning with statistics computed on the dataset. A surname matches an entry when the
entry is one of its whole words, accents included ("Di Natale" matches "natale"; "Gallosi" does not match "gallo";
"Conté" does not match "conte").

Entry: lower-case word -> (what it means in Italian, language or note shown in the script).
Only meanings that are plain dictionary words in that language are listed; doubtful etymologies are left out.
"""

from __future__ import annotations

IT, EN, DE, ES, PT, FR, NL = "italiano", "inglese", "tedesco", "spagnolo", "portoghese", "francese", "olandese"

ANIMALS = {
    "gallo": ("gallo", IT), "falco": ("falco", IT), "leone": ("leone", IT), "lupo": ("lupo", IT), "volpe": ("volpe", IT), "orso": ("orso", IT),
    "grillo": ("grillo", IT), "merlo": ("merlo", IT), "cavallo": ("cavallo", IT), "gatto": ("gatto", IT), "colombo": ("colombo", IT),
    "pesce": ("pesce", IT), "toro": ("toro", IT), "capra": ("capra", IT), "vitello": ("vitello", IT), "aquila": ("aquila", IT),
    "cervo": ("cervo", IT), "passero": ("passero", IT), "ragno": ("ragno", IT), "mosca": ("mosca", IT), "formica": ("formica", IT),
    "leoni": ("leoni", IT), "galli": ("galli", IT), "lupi": ("lupi", IT), "volpi": ("volpi", IT), "orsi": ("orsi", IT), "gatti": ("gatti", IT),
    "falcone": ("falcone", IT), "cavalli": ("cavalli", IT), "pavone": ("pavone", IT), "cicogna": ("cicogna", IT), "tasso": ("tasso", IT),
    "wolf": ("lupo", EN + " e " + DE), "fox": ("volpe", EN), "lamb": ("agnello", EN), "bird": ("uccello", EN), "bull": ("toro", EN),
    "swan": ("cigno", EN), "drake": ("anatra maschio", EN), "crow": ("corvo", EN), "finch": ("fringuello", EN), "hawk": ("falco", EN),
    "fish": ("pesce", EN), "bear": ("orso", EN), "hare": ("lepre", EN), "kite": ("nibbio", EN), "dove": ("colomba", EN), "pigeon": ("piccione", EN + " e " + FR),
    "hahn": ("gallo", DE), "fuchs": ("volpe", DE), "adler": ("aquila", DE), "vogel": ("uccello", DE), "fink": ("fringuello", DE), "hirsch": ("cervo", DE),
    "vos": ("volpe", NL), "haan": ("gallo", NL), "wolff": ("lupo", DE),
    "lobo": ("lupo", ES + " e " + PT), "cordero": ("agnello", ES), "águila": ("aquila", ES), "león": ("leone", ES), 
    "leão": ("leone", PT), "coelho": ("coniglio", PT), "pato": ("anatra", PT + " e " + ES), "ganso": ("oca", PT + " e " + ES), "falcao": ("falco", PT + " (falcão)"), "falcão": ("falco", PT),
    "carneiro": ("montone", PT), "cordeiro": ("agnello", PT), "raposo": ("volpe maschio", PT), "bezerra": ("vitella", PT),
    "renard": ("volpe", FR), "loup": ("lupo", FR), "lion": ("leone", FR + " e " + EN), "mouton": ("montone", FR), "poisson": ("pesce", FR),
    "lechat": ("il gatto", FR), "lecoq": ("il gallo", FR), "leboeuf": ("il bue", FR), "cheval": ("cavallo", FR),
}

FIGURES = {
    # dictators and heads of authoritarian regimes
    "castro": ("Fidel Castro, che governò Cuba per quasi cinquant'anni", "dittatore"), "franco": ("Francisco Franco, dittatore della Spagna", "dittatore"),
    "mussolini": ("Benito Mussolini, dittatore dell'Italia fascista", "dittatore"), "stalin": ("Iosif Stalin, dittatore dell'Unione Sovietica", "dittatore"),
    "salazar": ("António de Oliveira Salazar, dittatore del Portogallo", "dittatore"), "batista": ("Fulgencio Batista, dittatore di Cuba", "dittatore"),
    "hoxha": ("Enver Hoxha, dittatore dell'Albania", "dittatore"), "pinochet": ("Augusto Pinochet, dittatore del Cile", "dittatore"),
    "tito": ("Tito, il maresciallo che guidò la Jugoslavia", "storia"), "perón": ("Juan Domingo Perón, presidente dell'Argentina", "storia"),
    "trujillo": ("Rafael Trujillo, dittatore della Repubblica Dominicana", "dittatore"),
    # conquerors, revolutionaries, explorers, statesmen, artists
    "pizarro": ("Francisco Pizarro, il conquistador del Perù", "storia"), "cortés": ("Hernán Cortés, il conquistador del Messico", "storia"),
    "zapata": ("Emiliano Zapata, rivoluzionario messicano", "storia"), "villa": ("Pancho Villa, rivoluzionario messicano", "storia"),
    "guevara": ("Ernesto «Che» Guevara, rivoluzionario", "storia"), "bolívar": ("Simón Bolívar, il Libertador", "storia"),
    "colombo": ("Cristoforo Colombo, il navigatore", "storia"), "polo": ("Marco Polo, il viaggiatore veneziano", "storia"),
    "magellan": ("Ferdinando Magellano, il navigatore", "storia"), "garibaldi": ("Giuseppe Garibaldi, l'eroe dei due mondi", "storia"),
    "mazzini": ("Giuseppe Mazzini, padre del Risorgimento", "storia"), "cavour": ("Camillo Benso conte di Cavour", "storia"),
    "dante": ("Dante Alighieri, il poeta della Divina Commedia", "storia"), "galilei": ("Galileo Galilei, lo scienziato", "storia"),
    "kennedy": ("John Fitzgerald Kennedy, presidente degli Stati Uniti", "storia"), "lincoln": ("Abraham Lincoln, presidente degli Stati Uniti", "storia"),
    "washington": ("George Washington, primo presidente degli Stati Uniti", "storia"), "churchill": ("Winston Churchill, primo ministro britannico", "storia"),
    "nelson": ("Horatio Nelson, l'ammiraglio di Trafalgar", "storia"), "napoleon": ("Napoleone Bonaparte, imperatore dei francesi", "storia"),
    "bonaparte": ("Napoleone Bonaparte, imperatore dei francesi", "storia"), "luther": ("Martin Lutero, il riformatore", "storia"),
    "marx": ("Karl Marx, il filosofo del Capitale", "storia"), "engels": ("Friedrich Engels, il filosofo compagno di Marx", "storia"),
    "darwin": ("Charles Darwin, il naturalista dell'evoluzione", "storia"), "newton": ("Isaac Newton, lo scienziato della gravità", "storia"),
    "einstein": ("Albert Einstein, il fisico della relatività", "storia"), "mozart": ("Wolfgang Amadeus Mozart, il compositore", "storia"),
    "bach": ("Johann Sebastian Bach, il compositore", "storia"), "wagner": ("Richard Wagner, il compositore", "storia"),
    "schubert": ("Franz Schubert, il compositore", "storia"), "verdi": ("Giuseppe Verdi, il compositore", "storia"),
    "rossini": ("Gioachino Rossini, il compositore", "storia"), "puccini": ("Giacomo Puccini, il compositore", "storia"),
    "picasso": ("Pablo Picasso, il pittore", "storia"), "goya": ("Francisco Goya, il pittore", "storia"), "cervantes": ("Miguel de Cervantes, l'autore del Don Chisciotte", "storia"),
    "caravaggio": ("Caravaggio, il pittore", "storia"), "raffaello": ("Raffaello, il pittore", "storia"), "leopardi": ("Giacomo Leopardi, il poeta", "storia"),
    "manzoni": ("Alessandro Manzoni, l'autore dei Promessi sposi", "storia"), "pascoli": ("Giovanni Pascoli, il poeta", "storia"),
    "marconi": ("Guglielmo Marconi, l'inventore della radio", "storia"), "volta": ("Alessandro Volta, l'inventore della pila", "storia"),
    "fermi": ("Enrico Fermi, il fisico", "storia"), "vespucci": ("Amerigo Vespucci, il navigatore", "storia"), "nobel": ("Alfred Nobel, l'inventore della dinamite", "storia"),
    "shakespeare": ("William Shakespeare, il drammaturgo", "storia"), "byron": ("Lord Byron, il poeta", "storia"), "hugo": ("Victor Hugo, lo scrittore", "storia"),
    "voltaire": ("Voltaire, il filosofo", "storia"), "pascal": ("Blaise Pascal, il filosofo e matematico", "storia"),
    "kant": ("Immanuel Kant, il filosofo", "storia"), "nietzsche": ("Friedrich Nietzsche, il filosofo", "storia"),
}

CITIES = {
    "valencia": ("Valencia", "Spagna"), "córdoba": ("Cordova", "Spagna"), "zaragoza": ("Saragozza", "Spagna"), "toledo": ("Toledo", "Spagna"),
    "cáceres": ("Cáceres", "Spagna"), "mérida": ("Mérida", "Spagna"), "burgos": ("Burgos", "Spagna"), "cuenca": ("Cuenca", "Spagna"),
    "zamora": ("Zamora", "Spagna"), "segovia": ("Segovia", "Spagna"), "ávila": ("Ávila", "Spagna"), "soria": ("Soria", "Spagna"),
    "lugo": ("Lugo", "Spagna"), "león": ("León", "Spagna"), "sevilla": ("Siviglia", "Spagna"), "murcia": ("Murcia", "Spagna"),
    "jaén": ("Jaén", "Spagna"), "cartagena": ("Cartagena", "Spagna"), "guimarães": ("Guimarães", "Portogallo"), "braga": ("Braga", "Portogallo"),
    "coimbra": ("Coimbra", "Portogallo"), "faro": ("Faro", "Portogallo"), "aveiro": ("Aveiro", "Portogallo"), "lisboa": ("Lisbona", "Portogallo"),
    "lima": ("Lima", "Perù"), "medina": ("Medina", "Arabia Saudita"), "medellín": ("Medellín", "Colombia"),
    "lodi": ("Lodi", "Italia"), "lucca": ("Lucca", "Italia"), "ancona": ("Ancona", "Italia"), "verona": ("Verona", "Italia"),
    "messina": ("Messina", "Italia"), "pisa": ("Pisa", "Italia"), "siena": ("Siena", "Italia"), "ravenna": ("Ravenna", "Italia"),
    "caserta": ("Caserta", "Italia"), "palermo": ("Palermo", "Italia"), "bologna": ("Bologna", "Italia"), "napoli": ("Napoli", "Italia"),
    "roma": ("Roma", "Italia"), "firenze": ("Firenze", "Italia"), "venezia": ("Venezia", "Italia"), "parma": ("Parma", "Italia"),
    "pavia": ("Pavia", "Italia"), "trento": ("Trento", "Italia"), "taranto": ("Taranto", "Italia"), "como": ("Como", "Italia"),
    "monaco": ("Monaco", "Principato di Monaco e Baviera"), "catania": ("Catania", "Italia"), "cosenza": ("Cosenza", "Italia"),
    "salerno": ("Salerno", "Italia"), "brescia": ("Brescia", "Italia"), "padova": ("Padova", "Italia"), "savona": ("Savona", "Italia"),
    "paris": ("Parigi", "Francia"), "nancy": ("Nancy", "Francia"), "lyon": ("Lione", "Francia"), "caen": ("Caen", "Francia"),
    "berlin": ("Berlino", "Germania"), "kiel": ("Kiel", "Germania"), "kehl": ("Kehl", "Germania"), "worms": ("Worms", "Germania"),
    "london": ("Londra", "Inghilterra"), "york": ("York", "Inghilterra"), "chester": ("Chester", "Inghilterra"), "derby": ("Derby", "Inghilterra"),
    "boston": ("Boston", "Stati Uniti"), "dallas": ("Dallas", "Stati Uniti"), "houston": ("Houston", "Stati Uniti"), "denver": ("Denver", "Stati Uniti"),
    "austin": ("Austin", "Stati Uniti"), "sydney": ("Sydney", "Australia"), "cairo": ("Il Cairo", "Egitto"), "lagos": ("Lagos", "Nigeria"),
    "sofia": ("Sofia", "Bulgaria"), "split": ("Spalato", "Croazia"), "troia": ("Troia", "la città dell'Iliade"), "sparta": ("Sparta", "Grecia"),
}

COLOURS = {
    "rossi": ("rossi", IT), "bianchi": ("bianchi", IT), "verdi": ("verdi", IT), "neri": ("neri", IT), "viola": ("viola", IT), "rosa": ("rosa", IT),
    "bianco": ("bianco", IT), "rosso": ("rosso", IT), "nero": ("nero", IT), "biondi": ("biondi", IT), "bruno": ("bruno", IT), "bruni": ("bruni", IT),
    "grigio": ("grigio", IT), "celeste": ("celeste", IT), "azzurri": ("azzurri", IT),
    "white": ("bianco", EN), "black": ("nero", EN), "brown": ("marrone", EN), "green": ("verde", EN), "gray": ("grigio", EN), "grey": ("grigio", EN),
    "schwarz": ("nero", DE), "weiss": ("bianco", DE), "weiß": ("bianco", DE), "braun": ("marrone", DE), "grün": ("verde", DE),
    "blanco": ("bianco", ES), "rojo": ("rosso", ES), "verde": ("verde", ES + ", " + PT + " e " + IT), "rubio": ("biondo", ES), "pardo": ("bruno", ES),
    "amarillo": ("giallo", ES), "negro": ("nero", ES), "blanc": ("bianco", FR), "roux": ("rosso di capelli", FR), "brun": ("bruno", FR), "lenoir": ("il nero", FR),
    "leblanc": ("il bianco", FR), "branco": ("bianco", PT), "zwart": ("nero", NL), "groen": ("verde", NL),
}

JOBS = {
    "pastore": ("pastore", IT), "cacciatore": ("cacciatore", IT), "molinaro": ("mugnaio", IT), "barbieri": ("barbieri", IT), "sartori": ("sarti", IT),
    "fabbri": ("fabbri", IT), "pescatore": ("pescatore", IT), "marinaro": ("marinaio", IT), "giudice": ("giudice", IT), "medici": ("medici", IT),
    "carbonaro": ("carbonaio", IT), "pecoraro": ("pecoraio", IT), "tessitore": ("tessitore", IT), "muratore": ("muratore", IT), "pittore": ("pittore", IT),
    "cuoco": ("cuoco", IT), "notaro": ("notaio", IT), "maestri": ("maestri", IT), "soldati": ("soldati", IT), 
    "smith": ("fabbro", EN), "baker": ("fornaio", EN), "cook": ("cuoco", EN), "taylor": ("sarto", EN), "miller": ("mugnaio", EN), "fisher": ("pescatore", EN),
    "hunter": ("cacciatore", EN), "archer": ("arciere", EN), "shepherd": ("pastore", EN), "gardner": ("giardiniere", EN), "carpenter": ("carpentiere", EN),
    "butcher": ("macellaio", EN), "barber": ("barbiere", EN), "farmer": ("contadino", EN), "brewer": ("birraio", EN), "potter": ("vasaio", EN),
    "mason": ("muratore", EN), "cooper": ("bottaio", EN), "butler": ("maggiordomo", EN), "turner": ("tornitore", EN), "carter": ("carrettiere", EN),
    "sergeant": ("sergente", EN), "judge": ("giudice", EN), "dyer": ("tintore", EN), "thatcher": ("impagliatore di tetti", EN), "porter": ("facchino", EN),
    "müller": ("mugnaio", DE), "schneider": ("sarto", DE), "fischer": ("pescatore", DE), "becker": ("fornaio", DE), "bauer": ("contadino", DE),
    "schmidt": ("fabbro", DE), "schmid": ("fabbro", DE), "weber": ("tessitore", DE), "koch": ("cuoco", DE), "schuster": ("calzolaio", DE),
    "zimmermann": ("carpentiere", DE), "richter": ("giudice", DE), "schäfer": ("pastore", DE), "jäger": ("cacciatore", DE), "kaufmann": ("mercante", DE),
    "schumacher": ("calzolaio", DE), "schreiber": ("scrivano", DE), "köhler": ("carbonaio", DE), "metzger": ("macellaio", DE), "gärtner": ("giardiniere", DE),
    "kramer": ("bottegaio", DE), "wagner": ("carraio", DE), "meier": ("fattore", DE), "meyer": ("fattore", DE), 
    "zapatero": ("calzolaio", ES), "herrero": ("fabbro", ES), "pastor": ("pastore", ES), "molinero": ("mugnaio", ES),
    "pescador": ("pescatore", ES), "barbero": ("barbiere", ES),
    "boulanger": ("fornaio", FR), "berger": ("pastore", FR), "meunier": ("mugnaio", FR), "marchand": ("mercante", FR), "lefebvre": ("il fabbro", FR),
    "bakker": ("fornaio", NL), "visser": ("pescatore", NL), "de boer": ("il contadino", NL), "smit": ("fabbro", NL), "kuipers": ("bottaio", NL),
}

FOOD = {
    "lasagna": ("lasagna", IT), "polenta": ("polenta", IT), "fagioli": ("fagioli", IT), "pepe": ("pepe", IT), "castagne": ("castagne", IT),
    "farina": ("farina", IT), "cipolla": ("cipolla", IT), "fava": ("fava", IT), "pane": ("pane", IT), "riso": ("riso", IT), "zucca": ("zucca", IT),
    "noce": ("noce", IT), "oliva": ("oliva", IT + " e " + ES), "mela": ("mela", IT), "pera": ("pera", IT), "limone": ("limone", IT), "uva": ("uva", IT),
    "finocchio": ("finocchio", IT), "carota": ("carota", IT), "piselli": ("piselli", IT), "ceci": ("ceci", IT), "panna": ("panna", IT),
    "ricotta": ("ricotta", IT), "pasta": ("pasta", IT), "salame": ("salame", IT), "melone": ("melone", IT), "fragola": ("fragola", IT),
    "biscotti": ("biscotti", IT), "torta": ("torta", IT), "caffè": ("caffè", IT), "vino": ("vino", IT), "sale": ("sale", IT), "zucchero": ("zucchero", IT),
    "rice": ("riso", EN), "bacon": ("pancetta", EN), "berry": ("bacca", EN), "curry": ("curry", EN), "lemon": ("limone", EN), "salt": ("sale", EN),
    "pepper": ("pepe", EN), "bean": ("fagiolo", EN), "honey": ("miele", EN), "cherry": ("ciliegia", EN), "olive": ("oliva", EN + " e " + FR),
    "kohl": ("cavolo", DE), "kirsch": ("ciliegia", DE), "wurst": ("salsiccia", DE), "zucker": ("zucchero", DE), "bier": ("birra", DE),
    "pimenta": ("pepe", PT), "pimienta": ("pepe", ES), "queso": ("formaggio", ES), "trigo": ("grano", ES + " e " + PT), "arroz": ("riso", ES + " e " + PT),
    "manzana": ("mela", ES), "limón": ("limone", ES), "naranja": ("arancia", ES), "pan": ("pane", ES), "sal": ("sale", ES + " e " + PT),
    "pain": ("pane", FR), "citron": ("limone", FR), "poire": ("pera", FR),
}

PLANTS = {
    "olmo": ("olmo", IT + " e " + ES), "pino": ("pino", IT + " e " + ES), "fiore": ("fiore", IT), "giglio": ("giglio", IT), "quercia": ("quercia", IT),
    "abete": ("abete", IT), "salice": ("salice", IT), "rovere": ("rovere", IT), "ginestra": ("ginestra", IT), 
    "robles": ("querce", ES), "flores": ("fiori", ES), "castaño": ("castagno", ES), "naranjo": ("arancio", ES), "manzano": ("melo", ES),
    "olivo": ("ulivo", ES + " e " + IT), "palma": ("palma", IT + " e " + ES), "rosales": ("roseti", ES), "prado": ("prato", ES),
    "oliveira": ("ulivo", PT), "pereira": ("pero", PT), "carvalho": ("quercia", PT), "pinheiro": ("pino", PT), "nogueira": ("noce (albero)", PT),
    "figueira": ("fico (albero)", PT), "laranjeira": ("arancio", PT), 
    "rose": ("rosa", EN), "wood": ("legno, o bosco", EN), "bush": ("cespuglio", EN), "reed": ("canna", EN), "moss": ("muschio", EN), "flower": ("fiore", EN),
    "baum": ("albero", DE), "busch": ("cespuglio", DE), "linde": ("tiglio", DE), "rosen": ("rose", DE), 
    "dubois": ("del bosco", FR), "laforêt": ("la foresta", FR), "fleur": ("fiore", FR), "delarose": ("della rosa", FR),
}

NOBLES = {
    "conti": ("conti", IT), "conte": ("conte", IT), "marchese": ("marchese", IT), "barone": ("barone", IT), "principe": ("principe", IT),
    "cavaliere": ("cavaliere", IT), "re": ("re", IT),
    "king": ("re", EN), "prince": ("principe", EN), "knight": ("cavaliere", EN), "lord": ("lord", EN), "duke": ("duca", EN), "earl": ("conte", EN),
    "kaiser": ("imperatore", DE), "könig": ("re", DE), "herzog": ("duca", DE), "graf": ("conte", DE), "fürst": ("principe", DE), "ritter": ("cavaliere", DE),
    "baron": ("barone", DE + ", " + FR + " e " + EN),
    "rey": ("re", ES), "reyes": ("re (al plurale)", ES), "conde": ("conte", ES + " e " + PT), "duque": ("duca", ES + " e " + PT), "caballero": ("cavaliere", ES),
    "rei": ("re", PT), "reis": ("re (al plurale)", PT), "cavaleiro": ("cavaliere", PT),
    "roi": ("re", FR), "leroy": ("il re", FR + " antico"), "chevalier": ("cavaliere", FR), "leduc": ("il duca", FR), "lecomte": ("il conte", FR),
    "de koning": ("il re", NL), "de graaf": ("il conte", NL), "de ridder": ("il cavaliere", NL), "keizer": ("imperatore", NL),
}

CHURCH = {
    "chiesa": ("chiesa", IT), "papa": ("papa", IT), "vescovi": ("vescovi", IT), "abate": ("abate", IT), "prete": ("prete", IT), "santi": ("santi", IT),
    "angeli": ("angeli", IT), "frati": ("frati", IT), "cardinale": ("cardinale", IT), "campana": ("campana", IT),
    "pope": ("papa", EN), "bishop": ("vescovo", EN), "priest": ("prete", EN), "church": ("chiesa", EN), "monk": ("monaco", EN), "abbot": ("abate", EN),
    "bischof": ("vescovo", DE), "papst": ("papa", DE), "mönch": ("monaco", DE),
    "iglesias": ("chiese", ES), "santos": ("santi", ES + " e " + PT), "obispo": ("vescovo", ES), "cruz": ("croce", ES + " e " + PT), "ángel": ("angelo", ES),
    "anjos": ("angeli", PT), "lévêque": ("il vescovo", FR), "labbé": ("l'abate", FR), "moine": ("monaco", FR),
}

CALENDAR = {
    "natale": ("Natale", IT), "pasqua": ("Pasqua", IT), "maggio": ("maggio", IT), "sabato": ("sabato", IT), "domenica": ("domenica", IT),
    "carnevale": ("Carnevale", IT), "epifani": ("Epifania", IT), "festa": ("festa", IT), "marzo": ("marzo", IT), "gennaio": ("gennaio", IT),
    "aprile": ("aprile", IT), "agosto": ("agosto", IT), "inverno": ("inverno", IT), "estate": ("estate", IT), "primavera": ("primavera", IT),
    "quaresma": ("Quaresima", PT), "domingos": ("domeniche", PT), "natal": ("Natale", PT), "páscoa": ("Pasqua", PT), "janeiro": ("gennaio", PT),
    "sommer": ("estate", DE), "winter": ("inverno", DE + " e " + EN), "herbst": ("autunno", DE), "mai": ("maggio", DE + " e " + FR), "freitag": ("venerdì", DE),
    "sonntag": ("domenica", DE), "montag": ("lunedì", DE), "summer": ("estate", EN), "spring": ("primavera", EN), "friday": ("venerdì", EN),
    "monday": ("lunedì", EN), "may": ("maggio", EN), "noel": ("Natale", FR), "domingo": ("domenica", ES), "navidad": ("Natale", ES),
    "pascual": ("pasquale", ES), "abril": ("aprile", ES + " e " + PT), "mayo": ("maggio", ES), "enero": ("gennaio", ES), "viernes": ("venerdì", ES),
}

CATEGORIES = {
    "animali": ANIMALS,
    "storia": FIGURES,
    "citta": CITIES,
    "colori": COLOURS,
    "mestieri": JOBS,
    "cibo": FOOD,
    "piante": PLANTS,
    "nobili": NOBLES,
    "chiesa": CHURCH,
    "calendario": CALENDAR,
}

# Words that also belong, in everyday speech, to a category they are not listed in (a viola is a flower too, a "papa"
# is a potato in Spanish, Reis is rice in German): a player with one of these surnames is never offered as the wrong
# option of a question about that other category.
ALSO = {
    "viola": {"piante"}, "rosa": {"piante"}, "rose": {"colori"}, "pesce": {"cibo"}, "fish": {"cibo"}, "lamb": {"cibo"}, "vitello": {"cibo"},
    "cordero": {"cibo"}, "cordeiro": {"cibo"}, "carneiro": {"cibo"}, "pato": {"cibo"}, "ganso": {"cibo"}, "oliva": {"piante"}, "olive": {"piante"},
    "noce": {"piante"}, "castagne": {"piante"}, "pepe": {"piante"}, "rice": {"piante"}, "berry": {"piante"}, "lemon": {"piante"},
    "cherry": {"piante"}, "limone": {"piante"}, "fagioli": {"piante"}, "fava": {"piante"}, "zucca": {"piante"},
    "monaco": {"chiesa"}, "pastore": {"chiesa"}, "pastor": {"chiesa"}, "palma": {"citta"}, "lima": {"cibo"}, "papa": {"cibo"},
    "reis": {"cibo"}, "santos": {"citta"}, "cruz": {"citta"}, "roux": {"cibo"}, "león": {"storia"}, "leone": {"storia"}, "king": {"storia"},
    "luther": {"chiesa"}, "nelson": {"citta"}, "washington": {"citta"}, "lincoln": {"citta"}, "kennedy": {"citta"}, "colombo": {"citta"},
    "york": {"nobili"}, "derby": {"nobili"}, "kaiser": {"storia"}, "könig": {"storia"}, "conte": {"storia"}, "rey": {"storia"}, "reyes": {"storia"},
    "medici": {"storia"}, "franco": {"calendario"}, "maggio": {"storia"}, "mai": {"storia"}, "natale": {"chiesa"}, "pasqua": {"chiesa"},
    "quaresma": {"chiesa"}, "noel": {"chiesa"}, "domingo": {"chiesa"}, "domingos": {"chiesa"}, "epifani": {"chiesa"}, "carnevale": {"chiesa"},
    "wood": {"mestieri"}, "cook": {"cibo"}, "koch": {"cibo"}, "cuoco": {"cibo"}, "baker": {"cibo"}, "becker": {"cibo"}, "bakker": {"cibo"},
    "butcher": {"cibo"}, "metzger": {"cibo"}, "fischer": {"animali"}, "fisher": {"animali"}, "visser": {"animali"}, "pescatore": {"animali"},
    "pescador": {"animali"}, "schäfer": {"animali"}, "shepherd": {"animali"}, "hunter": {"animali"}, "jäger": {"animali"}, "cacciatore": {"animali"},
    "gardner": {"piante"}, "gärtner": {"piante"}, "farmer": {"piante"}, "bauer": {"piante"}, "prado": {"citta"}, "valencia": {"cibo"},
    "bologna": {"cibo"}, "parma": {"cibo"}, "lyon": {"animali"}, "lion": {"storia"}, "wolf": {"storia"}, "adler": {"nobili"}, "aquila": {"citta"},
    "falcone": {"storia"}, "falco": {"storia"}, "verde": {"piante"}, "verdi": {"piante"}, "green": {"piante"}, "grün": {"piante"}, "groen": {"piante"},
    "brown": {"cibo"}, "braun": {"storia"}, "bianco": {"cibo"}, "rosso": {"cibo"}, "rossi": {"storia"}, "bruno": {"storia"}, "celeste": {"chiesa"},
    "black": {"storia"}, "white": {"storia"}, "gray": {"storia"}, "grey": {"storia"}, "rojo": {"storia"}, "blanco": {"storia"}, "blanc": {"storia"},
}

# Wrong options of the surname questions: words of the same family (and language) that the generator then checks are
# NOT the surname of any player of the competition in the dataset. They are only words: no player is made up.
# Language codes follow the first language of the lexicon note; "*" serves every language (history, cities).
DECOYS: dict[str, dict[str, list[str]]] = {
    "animali": {
        "it": ["cani", "topi", "salmoni", "maiali", "conigli", "asini", "polli", "tacchini", "tonni", "rospi", "serpenti", "delfini", "squali",
               "polpi", "granchi", "gamberi", "cammelli", "struzzi", "scoiattoli", "castori", "merluzzi", "ghiri", "cane", "topo", "salmone",
               "maiale", "coniglio", "asino", "pollo", "tacchino", "tonno", "rospo", "serpente", "squalo", "polpo", "granchio", "gambero",
               "cammello", "struzzo", "scoiattolo", "castoro", "merluzzo", "ghiro", "talpa", "tigre", "zebra", "giraffa", "pantera", "balena",
               "vipera", "lumaca", "farfalla", "zanzara", "pecora", "mucca", "anatra", "rana"],
        "en": ["dog", "cat", "horse", "sheep", "goat", "mouse", "rat", "pig", "cow", "duck", "goose", "frog", "snake", "shark", "whale", "rabbit",
               "monkey", "tiger", "zebra", "camel", "spider", "salmon", "trout", "owl", "raven", "eagle"],
        "de": ["hund", "katze", "maus", "schwein", "kuh", "pferd", "ziege", "ente", "gans", "frosch", "schlange", "hai", "wal", "affe", "tiger",
               "eule", "rabe", "biene", "spinne", "igel"],
        "es": ["perro", "gato", "ratón", "cerdo", "vaca", "caballo", "cabra", "rana", "serpiente", "tiburón", "ballena", "mono", "tigre",
               "conejo", "oveja", "burro", "pulpo", "araña", "abeja"],
        "pt": ["cão", "gato", "rato", "porco", "vaca", "cavalo", "cabra", "galinha", "cobra", "tubarão", "baleia", "macaco", "tigre",
               "ovelha", "burro", "polvo", "aranha", "abelha"],
        "fr": ["chien", "chat", "souris", "cochon", "vache", "chèvre", "canard", "oie", "grenouille", "serpent", "requin", "baleine", "singe",
               "tigre", "lapin", "ours", "aigle", "hibou", "corbeau", "abeille"],
        "nl": ["hond", "kat", "muis", "varken", "koe", "paard", "geit", "eend", "gans", "kikker", "slang", "haai", "walvis", "aap"],
    },
    "colori": {
        "it": ["gialli", "arancioni", "marroni", "grigi", "turchesi", "giallo", "arancio", "marrone", "grigio", "turchese", "porpora", "cremisi",
               "amaranto", "lilla", "cobalto", "indaco", "ocra", "magenta", "fucsia", "vermiglio"],
        "en": ["yellow", "orange", "purple", "pink", "red", "blue", "violet", "scarlet", "crimson", "beige"],
        "de": ["gelb", "rot", "blau", "grau", "lila", "orange", "violett"],
        "es": ["amarillo", "azul", "naranja", "morado", "gris", "rosado", "violeta", "marrón"],
        "pt": ["amarelo", "azul", "laranja", "roxo", "cinza", "rosado", "vermelho", "preto"],
        "fr": ["jaune", "rouge", "bleu", "gris", "violet", "orange", "vert"],
        "nl": ["geel", "rood", "blauw", "grijs", "oranje", "paars"],
    },
    "mestieri": {
        "it": ["idraulici", "elettricisti", "falegnami", "panettieri", "macellai", "postini", "camerieri", "dentisti", "ingegneri", "avvocati",
               "contadini", "minatori", "marinai", "notai", "idraulico", "elettricista", "falegname", "panettiere", "macellaio", "postino",
               "cameriere", "dentista", "ingegnere", "avvocato", "contadino", "minatore", "marinaio", "fornaio", "calzolaio", "vetraio",
               "spazzino", "pompiere", "giardiniere"],
        "en": ["plumber", "dentist", "lawyer", "nurse", "sailor", "miner", "teacher", "doctor", "waiter", "banker", "driver", "pilot", "glazier", "roofer"],
        "de": ["maler", "lehrer", "arzt", "fahrer", "tischler", "klempner", "dachdecker", "kellner", "seemann", "bergmann", "glaser"],
        "es": ["panadero", "carpintero", "fontanero", "médico", "abogado", "maestro", "cartero", "camarero", "minero", "marinero", "pintor", "albañil"],
        "pt": ["padeiro", "carpinteiro", "pedreiro", "médico", "advogado", "professor", "carteiro", "mineiro", "marinheiro", "pintor", "sapateiro"],
        "fr": ["boucher", "menuisier", "plombier", "médecin", "avocat", "facteur", "mineur", "marin", "peintre", "maçon", "cordonnier", "tailleur"],
        "nl": ["schilder", "timmerman", "slager", "dokter", "leraar", "zeeman", "metselaar", "kapper"],
    },
    "cibo": {
        "it": ["maccheroni", "tortellini", "ravioli", "gnocchi", "cannoli", "carciofi", "pomodori", "zucchini", "peperoni", "cetrioli", "panini",
               "salumi", "formaggi", "funghi", "formaggio", "prosciutto", "risotto", "minestrone", "panettone", "pomodoro", "peperone",
               "carciofo", "cetriolo", "mortadella", "zucchina", "melanzana", "gelato", "biscotto", "cornetto", "pizza", "focaccia", "piadina"],
        "en": ["bread", "cheese", "butter", "apple", "onion", "potato", "carrot", "sugar", "cream", "cookie", "toast", "jam"],
        "de": ["käse", "brot", "butter", "milch", "apfel", "zwiebel", "kartoffel", "tomate", "senf", "honig"],
        "es": ["leche", "huevo", "patata", "cebolla", "tomate", "jamón", "chorizo", "pimiento", "lechuga", "zanahoria", "fresa"],
        "pt": ["queijo", "pão", "leite", "ovo", "batata", "cebola", "tomate", "presunto", "cenoura", "morango", "manteiga", "açúcar"],
        "fr": ["fromage", "beurre", "lait", "oeuf", "pomme", "oignon", "tomate", "jambon", "carotte", "fraise"],
    },
    "piante": {
        "it": ["castagni", "faggi", "pioppi", "cipressi", "ulivi", "tigli", "gerani", "girasoli", "tulipani", "papaveri", "gelsomini", "pioppo",
               "faggio", "cipresso", "tiglio", "frassino", "acero", "betulla", "platano", "geranio", "girasole", "tulipano", "papavero",
               "gelsomino", "margherita", "ortica", "edera", "felce"],
        "en": ["oak", "pine", "birch", "maple", "willow", "tulip", "daisy", "fern", "ivy", "cactus", "poppy", "lily"],
        "de": ["eiche", "tanne", "birke", "ahorn", "weide", "tulpe", "efeu", "kaktus", "mohn", "lilie"],
        "es": ["álamo", "abeto", "haya", "ciprés", "sauce", "girasol", "tulipán", "margarita", "cactus", "helecho", "ortiga", "jazmín"],
        "pt": ["álamo", "abeto", "faia", "cipreste", "salgueiro", "girassol", "tulipa", "margarida", "cacto", "urtiga", "jasmim"],
        "fr": ["chêne", "sapin", "bouleau", "érable", "saule", "tulipe", "lierre", "cactus", "pavot", "lys"],
    },
    "nobili": {
        "it": ["duchi", "imperatori", "sovrani", "duca", "imperatore", "sovrano", "regina", "contessa", "marchesa", "visconte", "granduca",
               "arciduca", "viceré", "zar", "sultano", "faraone"],
        "en": ["queen", "emperor", "viscount", "marquis", "sultan", "pharaoh", "tsar", "squire"],
        "de": ["königin", "herzogin", "prinz", "gräfin", "zar", "sultan", "markgraf"],
        "es": ["reina", "príncipe", "emperador", "marqués", "barón", "vizconde", "sultán", "faraón", "zar"],
        "pt": ["rainha", "príncipe", "imperador", "marquês", "barão", "visconde", "sultão", "faraó"],
        "fr": ["reine", "prince", "empereur", "marquis", "vicomte", "sultan", "pharaon", "tsar"],
        "nl": ["koningin", "prins", "hertog", "gravin"],
    },
    "chiesa": {
        "it": ["suore", "monaci", "parroci", "diaconi", "campanili", "altari", "rosari", "parroco", "diacono", "suora", "altare", "rosario",
               "campanile", "sacrestano", "vangelo", "messa", "chierichetto", "convento", "abbazia", "pontefice"],
        "en": ["nun", "vicar", "deacon", "chapel", "altar", "saint", "angel", "cardinal", "preacher"],
        "de": ["nonne", "pfarrer", "kapelle", "altar", "heiliger", "engel", "kardinal", "kloster", "glocke"],
        "es": ["monja", "cura", "fraile", "capilla", "altar", "santo", "cardenal", "monasterio", "campana", "rosario"],
        "pt": ["freira", "padre", "frade", "capela", "altar", "santo", "cardeal", "mosteiro", "sino", "rosário"],
        "fr": ["nonne", "curé", "chapelle", "autel", "saint", "ange", "cardinal", "abbaye", "cloche"],
    },
    "calendario": {
        "it": ["febbraio", "giugno", "luglio", "settembre", "ottobre", "novembre", "dicembre", "lunedì", "martedì", "mercoledì", "giovedì",
               "venerdì", "autunno", "ferragosto", "capodanno", "vigilia"],
        "en": ["january", "june", "july", "october", "december", "tuesday", "thursday", "autumn", "easter", "christmas"],
        "de": ["januar", "juni", "juli", "oktober", "dezember", "dienstag", "mittwoch", "donnerstag", "ostern", "weihnachten", "frühling"],
        "es": ["febrero", "junio", "julio", "octubre", "diciembre", "martes", "jueves", "otoño", "verano", "invierno", "pascua", "carnaval"],
        "pt": ["fevereiro", "junho", "julho", "outubro", "dezembro", "outono", "verão", "inverno", "carnaval"],
        "fr": ["janvier", "juin", "juillet", "octobre", "décembre", "mardi", "jeudi", "automne", "été", "hiver", "pâques"],
    },
    "citta": {
        "*": ["bergamo", "varese", "cremona", "mantova", "rovigo", "treviso", "vicenza", "ferrara", "rimini", "pesaro", "perugia", "terni",
              "viterbo", "latina", "avellino", "benevento", "foggia", "bari", "matera", "potenza", "ragusa", "trapani", "agrigento",
              "sassari", "nuoro", "oristano", "bilbao", "granada", "oporto", "marsiglia", "tolosa", "amburgo", "dresda", "glasgow",
              "liverpool", "manchester", "chicago", "toronto", "montreal", "rio", "quito", "bogotá"],
    },
    "storia": {
        "*": ["bonaparte", "churchill", "lincoln", "einstein", "darwin", "newton", "mozart", "beethoven", "michelangelo", "copernico",
              "galilei", "marconi", "machiavelli", "petrarca", "boccaccio", "leopardi", "manzoni", "puccini", "rossini", "caravaggio",
              "botticelli", "shakespeare", "cervantes", "picasso", "goya", "gandhi", "bismarck", "cromwell", "robespierre", "voltaire",
              "freud", "edison", "tesla", "garibaldi", "mazzini", "cavour", "vespucci", "magellano"],
    },
    "dittatori": {
        "*": ["stalin", "mussolini", "pinochet", "salazar", "franco", "batista", "hoxha", "ceaușescu", "trujillo", "somoza", "stroessner",
              "videla", "mobutu", "gheddafi"],
    },
}

LANG_CODE = {IT: "it", EN: "en", DE: "de", ES: "es", PT: "pt", FR: "fr", NL: "nl"}
LANG_NAME = {"it": "", "en": "in inglese", "de": "in tedesco", "es": "in spagnolo", "pt": "in portoghese", "fr": "in francese", "nl": "in olandese"}
