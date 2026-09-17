
export const NEW_MEMBER_TERMS=`SYARAT BONUS NEW MEMBER 10%

• Bonus New Member berlaku untuk semua Member Baru OMTOGEL.
• Bonus New Member wajib diklaim melalui LiveChat ataupun WhatsApp.
• Minimal Deposit untuk klaim Bonus New Member Rp50.000.
• Maksimal Bonus yang diberikan adalah Rp50.000.
• Bonus New Member tidak berlaku untuk deposit via PULSA.
• Batas maksimal klaim Bonus New Member adalah 2 (dua) jam setelah deposit.
• Jika melewati batas waktu yang ditentukan, Bonus New Member dianggap hangus.
• Bonus New Member TIDAK dapat diklaim apabila saldo di akun sudah dimainkan.
• Tidak diperbolehkan multiple user/account lebih dari 1 dalam mengklaim Bonus New Member.
• Tidak diperbolehkan IP address yang sama atau penggunaan VPN/SSH/PROXY/TUNNELING untuk mendapatkan promo bonus.
• Bonus tidak dapat diwithdraw sampai mencapai 3x Turnover dari nilai deposit pertama kali termasuk bonus.

Contoh:
Deposit Rp100.000 + Bonus 10% = Rp110.000 x 3 = Rp330.000 Turnover yang harus dicapai.

• Turnover adalah perputaran taruhan selama bermain, baik menang maupun kalah, bukan dilihat dari jumlah credit.`;

export const RONDA_TERMS=`EVENT BONUS RONDA 50% OMTOGEL

Syarat & ketentuan PAKET RONDA PAGI & MALAM:

• Bonus berlaku jam 00.00 - 06.00 (RONDA MALAM) dan 07.00 - 12.00 (RONDA PAGI).
• Bonus 1 hari dapat claim 1x.
• Minimal Deposit Rp25.000 dan TIDAK BERLAKU VIA PULSA.
• Event berlaku untuk semua member OMTOGEL yang bermain slot.
• Screenshot hasil deposit / bukti transfer dapat dilampirkan melalui layanan WhatsApp: https://layanancsomtogel.live/
• Bonus RONDA 50% tidak dapat diklaim jika saldo di akun sudah dimainkan ataupun sudah habis dimainkan.
• Syarat WD: (Deposit + Bonus) x TO 8, baru dapat melakukan penarikan.
• Bonus maksimal per hari Rp250.000/member untuk PRAGMATIC PLAY.
• Bonus maksimal per hari Rp200.000/member untuk PG SOFT.
• OMTOGEL dapat membatalkan/menarik bonus atau menutup akun jika menemukan indikasi kecurangan, kesamaan data player, penipuan, kesamaan IP, atau safety bet.

Contoh:
Deposit Rp500.000 + Bonus 50% Rp250.000 = Rp750.000 x 8 = Rp6.000.000 Turnover sebelum dapat WD.`;

export const DEPOSIT_CANCEL_DONE_REPLY='Transaksi deposit anda sudah kami batalkan ya bosku 😊 Silakan cek kembali pada akun anda.';
export const SPECIAL_BONUS_DONE_REPLY='Bonusnya sudah berhasil diberikan ke akun bosku ya 😊 Silakan cek kembali akun bosku.';
export const NEW_MEMBER_PLAYED_REPLY='Mohon maaf bosku, kami cek deposit anda sudah dimainkan. Sesuai syarat Bonus New Member, bonus tidak dapat diklaim apabila saldo di akun sudah dimainkan. Maka bonusnya tidak bisa diklaim ya bosku.';
export const RONDA_PLAYED_REPLY='Mohon maaf bosku, kami cek deposit anda sudah dimainkan. Sesuai syarat Bonus RONDA, bonus tidak dapat diklaim apabila saldo di akun sudah dimainkan. Maka bonusnya tidak bisa diklaim ya bosku.';
export const RONDA_SAME_IP_REPLY='Mohon maaf bosku, kami cek anda bermain menggunakan beberapa akun dengan 1 IP yang sama. Sesuai syarat Bonus RONDA, claim bonus tidak dapat diproses ya bosku.';

export function isNewMemberBonus(label='',text=''){
  const s=`${label} ${text}`.toLowerCase();
  return /\bnew\s*member\b|\bnewmember\b|\bbonus\s+member\s+baru\b/.test(s);
}
export function isRondaBonus(label='',text=''){
  return /\bronda\b/i.test(`${label} ${text}`);
}
