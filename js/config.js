// =========================================================
// ZDE VLOŽTE SVOJÍ URL ADRESU Z GOOGLE APPS SCRIPTU:
// =========================================================
export const GAS_URL = 'https://script.google.com/macros/s/AKfycbz9Vrrm03JkZFQ8FKXQ-bYydxhuSpr2CRWe53Bg7gNNrr03jEI-kMKo9kyBP2O1mnXrzg/exec';

export const C = {datum:0,popis:1,castka:2,mena:3,ucet:4,typ:5,kategorie:6,osoba:7,metoda:8,protistrana:9,poznamka:10,castkaSign:11,mesic:12,rok:13,id:14,uctenka:18};

export const DEMO = [
  ['1/1/2026','Soundbar','10000','CZK','mBank','Výdaj','Bydlení','Martin','Karta','Alza','','(10000)','Jan 2026','2026','20260101-001'],
  ['1/16/2026','Televize','27990','CZK','mBank','Výdaj','Bydlení','Martin','Karta','Alza','','(27990)','Jan 2026','2026','20260116-002']
];

export const DEFAULT_LIMITS = {Bydlení:20000,Jídlo:15000,Doprava:5000,Zábava:8000,Zdraví:5000,Investice:10000,Ostatní:5000};

export const CATEGORIES = ['Bydlení','Jídlo','Doprava','Zábava','Zdraví','Investice','Ostatní'];
export const CATEGORY_COLORS = {Bydlení:'var(--amber)',Jídlo:'var(--green)',Doprava:'var(--blue)',Zábava:'var(--purple)',Zdraví:'var(--red)',Investice:'#378ADD',Ostatní:'var(--text3)',Příjem:'var(--green)'};

// Firebase Auth whitelist — doplnit skutečné emaily
export const AUTH_USERS = {
  'martinkafka9@gmail.com': { person: 'Martin', canSeeInvestments: true },
  'besarka@gmail.com':  { person: 'Šárka', canSeeInvestments: false }
};
