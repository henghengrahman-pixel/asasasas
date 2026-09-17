import { normalizeText } from './normalizer.js';

export const FREEBET_TERMS = `SYARAT BONUS FREEBET SLOTGAME

• Bonus FreeBet berlaku untuk permainan khusus SlotGames.

• Bonus FreeBet hanya berlaku untuk semua Member OMTOGEL.

• Minimal Deposit untuk klaim Bonus FreeBet Rp.50.000.

• Maksimal Bonus yang diberikan adalah Rp.500.000.

• Bonus FreeBet tidak berlaku untuk deposit via PULSA.

• Bonus berlaku untuk 1x per hari.

• Bonus FreeBet diklaim setelah selesai melakukan transaksi Deposit dan tidak masuk secara otomatis.

• Bonus FreeBet tidak dapat diklaim apabila saldo di akun sudah dimainkan ataupun sudah habis dimainkan.

• Tidak diperbolehkan bermain permainan lain selain SlotGames. Apabila terdapat permainan lain, bonus FreeBet yang diberikan akan dianggap hangus dan kemenangan saldo akan ditarik kembali.

• BONUS FREEBET DILARANG KERAS MENAHAN BUY SPIN. JIKA KETAHUAN, SEMUA SALDO KEMENANGAN AKAN DIANGGAP HANGUS.

• Tidak diperbolehkan adanya multiple user atau account lebih dari satu dalam mengklaim Bonus FreeBet.

• Tidak diperbolehkan adanya IP address yang sama atau 3rd party seperti VPN/SSH/PROXY/TUNNELING dengan tujuan untuk mendapatkan Promo Bonus FreeBet.

• Bonus FreeBet tidak dapat diwithdrawkan sampai mencapai 10x Turnover dari nilai deposit pertama kali (termasuk bonus). Contoh: Deposit Rp50.000 + Bonus 50% = Rp75.000. Turnover yang harus dicapai: Rp75.000 x 10 = Rp750.000.

BONUS FREEBET
- DEPO 50 RIBU JADI 75 RIBU
- DEPO 100 RIBU JADI 150 RIBU
- DEPO 200 RIBU JADI 300 RIBU
- DEPO 1 JUTA JADI 1,5 JUTA

Jika bosku setuju dengan syarat di atas, balas OKE / SETUJU ya bosku 😊`;

export const FREEBET_DONE_REPLY = 'Untuk bonusnya sudah kita masukan ke dalam Akun User IDnya ya bosku. Terima kasih dan selamat bermain bosku 😊';

export const FREEBET_NOT_ELIGIBLE_REPLY = 'Kami cek di sini Anda bermain menggunakan beberapa ID, maka tidak bisa claim ya bosku. Seperti syarat dan ketentuan, tidak diperbolehkan adanya IP address yang sama atau 3rd party seperti VPN/SSH/PROXY/TUNNELING dengan tujuan untuk mendapatkan Promo Bonus FreeBet.';

export function isFreebet50(text='', bonusType=''){
  const n=normalizeText(`${text} ${bonusType}`);
  if(/\bronda\b/.test(n)) return false;
  if(/\bfree\s*bet\b|\bfreebet\b/.test(n)) return true;
  return /\bbonus\b/.test(n) && /\b50\s*%/.test(String(text||''));
}

export function isFreebetAgreement(text=''){
  const n=normalizeText(text).trim();
  return /^(?:ok|oke|okay|setuju|saya setuju|ya setuju|iya setuju|siap|sip|baik|lanjut|gas)(?:\s+(?:bos|bosku|kak|min|admin))?[.!🙏😊👍]*$/i.test(n);
}
