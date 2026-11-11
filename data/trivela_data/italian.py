"""Italian display labels (not facts): national teams by FIFA code, weekdays, months, rounds."""

NATIONS = {
    "ALG": "Algeria", "ANG": "Angola", "ARG": "Argentina", "AUS": "Australia", "AUT": "Austria",
    "BEL": "Belgio", "BIH": "Bosnia ed Erzegovina", "BOL": "Bolivia", "BRA": "Brasile", "BUL": "Bulgaria",
    "CAN": "Canada", "CHI": "Cile", "CHN": "Cina", "CIV": "Costa d'Avorio", "CMR": "Camerun",
    "COL": "Colombia", "CPV": "Capo Verde", "CRC": "Costa Rica", "CRO": "Croazia", "CUB": "Cuba",
    "CUW": "Curaçao", "CZE": "Repubblica Ceca", "DEI": "Indie orientali olandesi", "DEN": "Danimarca",
    "ECU": "Ecuador", "EGY": "Egitto", "ENG": "Inghilterra", "ESP": "Spagna", "FRA": "Francia",
    "FRG": "Germania Ovest", "GDR": "Germania Est", "GER": "Germania", "GHA": "Ghana", "GRE": "Grecia",
    "HAI": "Haiti", "HON": "Honduras", "HUN": "Ungheria", "IRL": "Irlanda", "IRN": "Iran", "IRQ": "Iraq",
    "ISL": "Islanda", "ISR": "Israele", "ITA": "Italia", "JAM": "Giamaica", "JOR": "Giordania",
    "JPN": "Giappone", "KOR": "Corea del Sud", "KSA": "Arabia Saudita", "KUW": "Kuwait", "MAR": "Marocco",
    "MEX": "Messico", "NED": "Paesi Bassi", "NGA": "Nigeria", "NIR": "Irlanda del Nord",
    "NOR": "Norvegia", "NZL": "Nuova Zelanda", "PAN": "Panama", "PAR": "Paraguay", "PER": "Perù",
    "POL": "Polonia", "POR": "Portogallo", "PRK": "Corea del Nord", "QAT": "Qatar", "ROU": "Romania",
    "RSA": "Sudafrica", "RUS": "Russia", "SCG": "Serbia e Montenegro", "SCO": "Scozia", "SEN": "Senegal",
    "SLV": "El Salvador", "SRB": "Serbia", "SUI": "Svizzera", "SVK": "Slovacchia", "SVN": "Slovenia",
    "SWE": "Svezia", "TCH": "Cecoslovacchia", "TOG": "Togo", "TRI": "Trinidad e Tobago", "TUN": "Tunisia",
    "TUR": "Turchia", "UAE": "Emirati Arabi Uniti", "UKR": "Ucraina", "URS": "Unione Sovietica",
    "URU": "Uruguay", "USA": "Stati Uniti", "UZB": "Uzbekistan", "WAL": "Galles", "YUG": "Jugoslavia",
    "ZAI": "Zaire", "IRE": "Irlanda", "CIS": "CSI", "FIN": "Finlandia", "VEN": "Venezuela",
    "COD": "RD del Congo", "MLI": "Mali", "BFA": "Burkina Faso", "ZAM": "Zambia",
}

WEEKDAYS = ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"]
MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre",
          "ottobre", "novembre", "dicembre"]

POSITIONS = {"GK": "Portiere", "DF": "Difensore", "MF": "Centrocampista", "FW": "Attaccante"}


def date_it(iso: str) -> str:
    y, m, d = (int(x) for x in iso.split("-"))
    return f"{d} {MONTHS[m - 1]} {y}"


def round_it(raw: str) -> str:
    r = raw.lower()
    if "final" in r and "semi" not in r and "quarter" not in r and "third" not in r and "1/" not in r:
        return "Finale"
    if "semi" in r:
        return "Semifinale"
    if "quarter" in r:
        return "Quarti di finale"
    if "third" in r or "3rd" in r:
        return "Finale per il terzo posto"
    if "round of 16" in r or "eighth" in r:
        return "Ottavi di finale"
    if "round of 32" in r:
        return "Sedicesimi di finale"
    if "group" in r or "matchday" in r:
        return "Fase a gironi"
    return "Fase finale"
