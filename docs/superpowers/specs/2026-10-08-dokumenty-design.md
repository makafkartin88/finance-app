# Dokumenty + přesun Rozpočtů do Nastavení — design

Datum: 2026-10-08

## Cíl

1. Nová sekce **Dokumenty**: rodinný archiv PDF a obrázků (smlouvy, pes, auto, pojištění…) uložený na Google Drive, uspořádaný do složek, s vyhledáváním podle názvu a s viditelností per dokument.
2. Sekce **Rozpočty** se nepoužívá — zmizí z menu, její obsah se přesune do Nastavení.

## Rozhodnutí

- **Viditelnost jen v UI** (stejně jako účtenky / Mzda). GAS endpoint nemá autentizaci a jeho URL je ve veřejném repu, takže kdo ji zná, stáhne si všechno. Vědomě přijato; datový model (sloupec `viditelnost`) umožní později dotáhnout ověření na serveru bez migrace dat.
- **Složky = jedna úroveň**, uložené jako textový sloupec. Žádné vnořování.
- **Sdílení souborů jako u účtenek**: `ANYONE_WITH_LINK / VIEW`, otevírá se Drive náhled.
- **Mazání = koš na Drive** (`setTrashed(true)`), ne trvalé smazání.

## Data — list `Dokumenty`

| sloupec | význam |
|---|---|
| id | unikátní id (`doc_<timestamp>_<random>`) |
| nazev | zobrazovaný název |
| slozka | název složky (jedna úroveň), prázdné = „Bez složky" |
| viditelnost | `Oba` / `Martin` / `Šárka` |
| url | Drive URL (náhled) |
| fileId | Drive file id |
| typ | `pdf` / `image` |
| velikost | bajty |
| nahral | `Martin` / `Šárka` |
| datum | ISO datum nahrání |

Hlavička se vytvoří automaticky při prvním zápisu.

## Drive

`Finance-Dokumenty/<slozka>/<soubor>`. Kořenová složka i podsložky se vytvoří samy (get-or-create podle názvu). Dokument bez složky jde přímo do `Finance-Dokumenty/`.

## GAS akce (vyžaduje redeploy)

- `uploadDocument {nazev, slozka, viditelnost, nahral, fileName, mimeType, data(base64)}` → uloží soubor, zapíše řádek, vrátí `{success, doc}`.
- `updateDocument {id, nazev?, slozka?, viditelnost?}` → upraví řádek; při změně složky přesune soubor (`file.moveTo`).
- `deleteDocument {id}` → soubor do koše, smaže řádek.
- Čtení: `Dokumenty` se přidá do stávajícího dávkového `fetchSheets` v `loadSheets()` (bez extra požadavku).

## Frontend

### Menu
- Položka `Rozpočty` se nahradí položkou `Dokumenty` (`data-page="documents"`), viditelná pro oba uživatele.
- `validPages` v `handleHash()` dostane `documents`, `budgets` vypadne.

### Stránka `#p-documents` (`js/documents.js`)
- Vyhledávání: filtruje průběžně podle `nazev` i `slozka`, case- a diakritika-insensitive (normalizace NFD + odstranění kombinujících znaků).
- Štítky složek s počty (`Vše N`, `<složka> N`, …), klik filtruje, druhý klik zruší.
- Seznam: ikona dle typu, název, složka, štítek viditelnosti, datum. Klik otevře `url` v nové záložce. Menu ⋯: Upravit / Smazat (potvrzení).
- Zobrazí se jen dokumenty s `viditelnost` = `Oba` nebo = `person` přihlášeného uživatele (z `AUTH_USERS`).
- Prázdné / načítací stavy stejně jako u Investic/Mzdy (`state._docsLoaded`).

### Modal nahrání
- Dropzone (`.upzone`) + `<input type=file accept="application/pdf,image/*">` (na mobilu nabídne foťák).
- Název předvyplněný z názvu souboru (bez přípony), složka přes `<input list>` + `<datalist>` existujících složek (nová = napsat), viditelnost 3× radio, výchozí `Oba`.
- Limit 20 MB, srozumitelná hláška při překročení. Tlačítko zablokované během uploadu.

### Modal úprav
- Stejná pole bez souboru; uloží přes `updateDocument`.

### Rozpočty → Nastavení
- Obsah `#p-budgets` (výběr měsíce, 4 metriky, pruhy) se přesune jako karta „Rozpočty" do `#p-settings` nad stávající formulář limitů. `renderBudgets()` zůstává, jen cílí na prvky v Nastavení. Stránka `#p-budgets` a její nav položka se odstraní.

## Chybové stavy
- Upload selže → toast s chybou, modal zůstane otevřený s vyplněnými poli.
- Úprava/smazání selže → toast, seznam se nezmění (změna se do `state` propíše až po úspěchu).
- Načtení listu selže → prázdný stav s hláškou (ne nekonečný spinner).

## Ověření
1. Nahrát PDF i fotku do nové složky → objeví se v seznamu, na Drive je v `Finance-Dokumenty/<složka>`.
2. Vyhledávání „smlouva"/„pes" najde bez ohledu na diakritiku a velikost písmen.
3. Dokument `jen Šárka` Martin nevidí a naopak.
4. Přesun do jiné složky → změní se štítek i umístění na Drive.
5. Smazání → zmizí ze seznamu, soubor je v koši Drive.
6. Nastavení obsahuje kartu Rozpočty, menu už Rozpočty nemá, `#budgets` v URL přesměruje na Přehled.
