// =========================================================
// ZDE VLOŽTE SVOJÍ URL ADRESU Z GOOGLE APPS SCRIPTU:
// =========================================================
export const VERSION = '2.1';

export const GAS_URL = 'https://script.google.com/macros/s/AKfycbzKcg3Zr5PUQ5MPvxVavSxr8RtySOJ3rtmHTMQaxv13dwqUaP5BFS2IYZRFF3UsHPPP-Q/exec';

export const C = {datum:0,popis:1,castka:2,mena:3,ucet:4,typ:5,kategorie:6,osoba:7,metoda:8,protistrana:9,poznamka:10,castkaSign:11,mesic:12,rok:13,id:14,uctenka:18,bilance:19};

// Sloupce listu "Mzdy" (výplatní pásky)
export const MZ = {id:0,mesic:1,rok:2,tarif:3,prumerHod:4,zakladniMzda:5,svatek:6,premie:7,dovolenaKc:8,stravenky:9,hrubaMzda:10,hrubyPrijem:11,danPoSleve:12,zpPrac:13,spPrac:14,cistaMzda:15,kVyplate:16,odpracHod:17,neodpracHod:18,dovolenaNarok:19,dovolenaZustatek:20,multisport:21,soubor:22};

// Sloupce listu "Fondy" (investiční fondy CODYA / CONSEQ) — klíč = isin
export const FOND = {provider:0,isin:1,nazev:2,mena:3,pocetCP:4,nakupNAV:5,nakupDatum:6,investovanoCZK:7,aktualNAV:8,aktualNAVdatum:9,aktualHodnotaCZK:10,poplatek:11,kurzEUR:12,hotovostCZK:13,poznamka:14};

// Zaměření fondů (čeho se týkají) — necitlivé, může být v kódu. Klíč = ISIN.
export const FUND_FOCUS = {
  // CODYA
  'CZ0008042892': 'Retailové nemovitosti',      // ZDR Investments Real Estate
  'CZ0008045333': 'Realitní podfond',            // AMBEAT II. Realitní
  'CZ0008051224': 'Energetika & výstavba',       // Axelor WATT & BUILD (CZK)
  'CZ0008051711': 'Energetika & výstavba',       // Axelor WATT & BUILD (EUR)
  'CZ1005201499': 'Private equity',              // Direct PRO (CZK)
  'CZ1005201655': 'Private equity',              // Direct PRO (EUR)
  'CZ1005202968': 'Retail parky',                // FIDUROCK Retail Parks
  // CONSEQ
  'CZ1005100618': 'Logistické nemovitosti'       // Conseq Panattoni Logistics Development 1
};

export const DEMO = [
  ['1/1/2026','Soundbar','10000','CZK','mBank','Výdaj','Bydlení','Martin','Karta','Alza','','(10000)','Jan 2026','2026','20260101-001'],
  ['1/16/2026','Televize','27990','CZK','mBank','Výdaj','Bydlení','Martin','Karta','Alza','','(27990)','Jan 2026','2026','20260116-002']
];

export const DEFAULT_LIMITS = {Bydlení:20000,Jídlo:15000,Doprava:5000,Zábava:8000,Zdraví:5000,Investice:10000,Ostatní:5000};

export const CATEGORIES = ['Bydlení','Jídlo','Doprava','Zábava','Zdraví','Investice','Ostatní'];
export const CATEGORY_COLORS = {Bydlení:'var(--amber)',Jídlo:'var(--green)',Doprava:'var(--blue)',Zábava:'var(--purple)',Zdraví:'var(--red)',Investice:'#378ADD',Ostatní:'var(--text3)',Příjem:'var(--green)'};

// Firebase Auth whitelist — doplnit skutečné emaily
export const AUTH_USERS = {
  'martinkafka9@gmail.com': { person: 'Martin', canSeeInvestments: true,  canSeeSalary: true },
  'kafka@logio.cz':         { person: 'Martin', canSeeInvestments: true,  canSeeSalary: true },
  'besarka@gmail.com':      { person: 'Šárka',  canSeeInvestments: false, canSeeSalary: false }
};
