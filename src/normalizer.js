const typoMap = new Map(Object.entries({
  'blm':'belum','blom':'belum','belom':'belum','bloom':'belum',
  'msk':'masuk','msuk':'masuk','masok':'masuk',
  'wd':'withdraw','wede':'withdraw','withdrw':'withdraw','widraw':'withdraw',
  'dp':'deposit','dpo':'deposit','dps':'deposit','depo':'deposit','depoo':'deposit','depsoit':'deposit','depost':'deposit','depoist':'deposit',
  'psw':'password','pw':'password','pass':'password','paswod':'password','pasword':'password','passwordd':'password','sandi':'password','sndi':'password','sandi':'password','sandiku':'password','sandy':'password',
  'brp':'berapa','brpa':'berapa','brrp':'berapa',
  'min':'minimal','mins':'minimal',
  'gk':'tidak','ga':'tidak','gak':'tidak','nggak':'tidak','ngga':'tidak','gbs':'tidak bisa','gabisa':'tidak bisa',
  'bsa':'bisa','bs':'bisa','bisaa':'bisa',
  'udh':'sudah','uda':'sudah','sdh':'sudah','msh':'masih','dpt':'dapat','gnti':'ganti','dftar':'daftar',
  'hrn':'harian','bnus':'bonus','bns':'bonus','bonuz':'bonus','bonuss':'bonus','bonuus':'bonus','bonusss':'bonus',
  'knp':'kenapa','kpn':'kapan','skrg':'sekarang','tdk':'tidak','klw':'kalau','klo':'kalau','krn':'karena','karna':'karena','trs':'terus','trus':'terus','mksd':'maksud','mksdnya':'maksudnya','batalin':'batalkan','cancelin':'batalkan','brcd':'barcode','qrnya':'qr','qrisnya':'qris','slmt':'selamat','smt':'selamat','mlm':'malam','malem':'malam','pgi':'pagi','pg':'pagi','sre':'sore','sor':'sore','sng':'siang','gngguan':'gangguan','gangguanx':'gangguan','limid':'limit','limitt':'limit','eror':'error','errorr':'error','rolingan':'rollingan','rolllingan':'rollingan','rolinggan':'rollingan','rolling':'rollingan','loginn':'login','ligin':'login','lgin':'login','lupa':'lupa','lpa':'lupa','lp':'lupa','lup':'lupa','alihin':'alihkan','alihkn':'alihkan','rek':'rekening',
  'akun':'akun','user':'username','usr':'username','rungkad':'rungkad','bon':'bonus','klaim':'claim','claim':'claim'
}));

export function normalizeText(text='') {
  return String(text)
    .toLowerCase()
    // Phrase-scoped LC typo repair: "lupa paspor" means "lupa password".
    // Do not globally rewrite standalone "paspor".
    .replace(/\blupa\s+paspor\b/g, 'lupa password')
    .replace(/\blpa\s+paspor\b/g, 'lupa password')
    .replace(/\blupa\s+pasword\b/g, 'lupa password')
    .replace(/\blupa\s+paswod\b/g, 'lupa password')
    .replace(/[^\p{L}\p{N}@._\-\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(w => {
      if (/^(?:dp|dpo|dps|depo|depoo)\d*$/.test(w)) return 'deposit';
      if (/^(?:blm|blom|belom)\d*$/.test(w)) return 'belum';
      if (/^(?:msk|msuk|masuk)\d*$/.test(w)) return 'masuk';
      if (/^ter+u+s+$/.test(w)) return 'terus';
      return typoMap.get(w) || w;
    })
    .join(' ');
}

export function detectIntent(text='') {
  const t = normalizeText(text);
  const has = (...parts) => parts.every(p => t.includes(p));
  const any = (...parts) => parts.some(p => t.includes(p));

  // Password reset must win over generic login/"ga bisa masuk" so cases such as
  // "ga bisa masuk lupa psw" are routed to RESET_PASSWORD, not LOGIN_PROBLEM.
  const forgotPassword =
    has('password','lupa') || has('lupa','password') ||
    (t.includes('reset') && t.includes('password')) ||
    (t.includes('ganti') && t.includes('password')) ||
    (t.includes('password') && any('cek','lihat','ingat','tahu','lupa','hilang','tidak bisa masuk','gagal masuk','salah'));

  if (forgotPassword) return 'FORGOT_PASSWORD';

  // Account/WD redirection must be recognized before generic WD.
  if ((any('ganti','ubah','alihkan','pindah') && any('rekening','bank','dana','ewallet','e wallet','nomor dana','nomor rekening')) ||
      (t.includes('withdraw') && any('alihkan','rekening lain','ganti rekening'))) return 'ACCOUNT_CHANGE_REQUEST';

  // High-risk payout / account problems must win before generic game or complaint intents.
  if ((any('kemenangan','menang','payout','jackpot','jp','hasil menang','win') && any('belum dibayar','belum bayar','belum masuk','tidak dibayar','tidak masuk','pending','belum cair','gagal dibayar','saldo belum','tidak cair')) ||
      (any('saldo kemenangan','hasil kemenangan','hasil win') && any('belum','tidak masuk','pending'))) return 'PAYOUT_NOT_RECEIVED';

  if (any('rekening','bank','dana','e wallet','ewallet','wallet') && any('limit','limited','kena limit','batas','penuh')) return 'BANK_ACCOUNT_LIMIT';

  // QRIS / QR / barcode / scan flow is a screenshot-first operational issue.
  if (any('qris','qr','barcode','scan') && any('tidak muncul','belum muncul','tidak bisa','gagal','error','gangguan','blank','hilang','tidak ada','belum ada')) return 'GENERAL_DISTURBANCE';

  // Registration: distinguish a normal request for the official registration link from a failed registration flow.
  if (any('daftar','register','registrasi','buat akun') && any('tidak bisa','gagal','error','mentok','otp tidak','tidak masuk','macet')) return 'REGISTER_PROBLEM';
  if (any('daftar','register','registrasi','buat akun') && any('mau','cara','link','dimana','bagaimana','ingin','tolong','bantu')) return 'REGISTER_REQUEST';
  if (/^(?:mau\s+)?(?:daftar|register|registrasi|buat akun)\b/.test(t)) return 'REGISTER_REQUEST';

  // Strong loss/frustration language must win before generic LINK_ACCESS wording,
  // but an explicit DP/WD transaction failure still has higher operational priority.
  const explicitDepositFailureEarly =
    t.includes('deposit') && any('belum','pending','tidak masuk','belum masuk','saldo belum','gangguan','masalah','proses','lama','gagal','status','cek','bukti','transfer','saldo tidak');
  const explicitWithdrawFailureEarly =
    (t.includes('withdraw') || t.includes('penarikan')) && any('belum','pending','tidak masuk','belum masuk','belum cair','tidak cair','gangguan','masalah','proses','lama','gagal','status','cek');
  if (!explicitDepositFailureEarly && !explicitWithdrawFailureEarly && (
    t.includes('kalah') || t.includes('rungkad') || t.includes('rugi') || t.includes('boncos') ||
    t.includes('tidak pernah menang') || t.includes('ga pernah menang') || t.includes('gak pernah menang') || t.includes('nggak pernah menang') ||
    t.includes('tidak ada gacor') || t.includes('ga ada gacor') || t.includes('gak ada gacor') || t.includes('nggak ada gacor') ||
    t.includes('tidak pernah jp') || t.includes('ga pernah jp') || t.includes('gak pernah jp') ||
    t.includes('tidak dikasih skater') || t.includes('ga dikasih skater') || t.includes('gak dikasih skater') ||
    t.includes('tidak dikasih scatter') || t.includes('ga dikasih scatter') || t.includes('gak dikasih scatter') ||
    t.includes('tidak dapat scatter')
  )) return 'LOSS_COMPLAINT';

  // Frequently changed information is handled from Menu Penting, never guessed from old chat history.
  if (any('rtp') && !any('error','gangguan','tidak bisa')) return 'RTP_INFO';
  if ((has('prediksi','togel') || any('bbfs','colok bebas','angka togel')) && !any('error','gangguan')) return 'PREDIKSI_TOGEL';
  if (any('link','akses','website','situs') && any('terbaru','alternatif','login','daftar','apk','mana','minta','kasih')) return 'LINK_ACCESS';

  // Strong operational problems.
  if (any('link','web','website','situs','halaman') && any('tidak bisa','gagal','akses','error','blank','down','mati','tidak kebuka','tidak buka','loading')) return 'LINK_PROBLEM';
  if (any('akses') && any('tidak bisa','gagal','error','blank','down','mati') && !any('withdraw','penarikan','deposit','bonus')) return 'LINK_PROBLEM';
  if (any('permainan','game','spin','slot') && any('error','keluar sendiri','force close','tidak bisa','macet','hang','blank','freeze','saldo kepotong','saldo terpotong','result tidak keluar','hasil tidak keluar')) return 'GAME_PROBLEM';
  if (any('gangguan','kendala sistem','server error','server down','maintenance','sistem error')) return 'GENERAL_DISTURBANCE';
  // "Saldo/uang belum masuk" without DP/WD context is ambiguous. Never guess deposit.
  // Ask whether the member means deposit or withdraw, then bind the short answer.
  if (
    any('saldo belum masuk','saldo tidak masuk','uang belum masuk','uang tidak masuk','dana belum masuk','dana tidak masuk') &&
    !any('deposit','withdraw','penarikan','bonus','kemenangan','menang','payout','jackpot','jp')
  ) return 'TRANSACTION_AMBIGUOUS';

  // Do not let generic "ga masuk" login wording hijack an explicit transaction case.
  // E.g. "proses wd ga masuk2" must remain WITHDRAW_PROBLEM.
  if (any('login','masuk') && any('tidak','gagal','tidak bisa','error','mentok','blank') && !any('withdraw','penarikan','deposit')) return 'LOGIN_PROBLEM';

  // Deposit cancellation/reject/reset is a distinct operational flow.
  // In CS chat, members commonly say "reset depo", "reset dp", "cancel depo",
  // "batalkan deposit", or "hapus form deposit". "reset" means cancel ONLY
  // when the sentence explicitly contains deposit context; reset password stays
  // in FORGOT_PASSWORD because that requires password/sandi context above.
  if (
    t.includes('deposit') &&
    any(
      'reset','batal','batalkan','cancel','cancelkan','reject','tolak',
      'hapus deposit','hapus fom','hapus form','batalkan fom','batalkan form',
      'cancel deposit','reset deposit'
    )
  ) return 'DEPOSIT_CANCEL';

  // Asking when/if WD is possible is NOT the same as a failed WD and is not a deposit problem.
  // Examples: "deposit terus kapan WD nya", "udah 3x depo kapan bisa wd", "habis kalah boleh wd?".
  // This must win before the deposit-problem rule merely because the sentence also mentions deposit.
  const withdrawEligibility =
    (any('withdraw','penarikan') && any('kapan','bisa','boleh','mau','habis ini','nanti') &&
      !any('belum masuk','pending','belum cair','tidak cair','gagal','ditolak','belum dibayar')) ||
    (t.includes('deposit') && any('terus','berkali kali','tiap hari','sering','3x','2x','4x','5x') &&
      any('withdraw','penarikan'));
  if (withdrawEligibility) return 'WITHDRAW_REQUEST';

  // WD/DP are high-risk operational categories. Route status/complaint and terse "wd/depo"
  // messages to staff instead of letting the model invent transaction state.
  if ((t.includes('withdraw') || t.includes('penarikan')) &&
      any('belum','pending','tidak masuk','belum masuk','belum cair','tidak cair','gangguan','masalah','proses','lama','gagal','status','cek','alihkan','antrian')) return 'WITHDRAW_PROBLEM';
  if ((t.includes('deposit')) &&
      any('belum','pending','tidak masuk','belum masuk','saldo belum','gangguan','masalah','proses','lama','gagal','status','cek','bukti','transfer','saldo tidak')) return 'DEPOSIT_PROBLEM';

  if ((t.includes('minimal') || t.includes('minimum')) && t.includes('withdraw')) return 'MINIMUM_WITHDRAW';
  if ((t.includes('minimal') || t.includes('minimum')) && t.includes('deposit')) return 'MINIMUM_DEPOSIT';

  // Promo/event claims may be written without the word "bonus" (e.g. "claim scatter hitam").
  const promoWord = any('promo','event','cashback','rollingan','freebet','free bet','freespin','free spin','referral','ronda','new member','newmember','member baru','scatter','maxwin','garansi slot','koi gate','spaceman','joker jewels');
  if (promoWord && any('claim','klaim','minta','ambil','mau','belum masuk','tidak masuk','tidak ada','belum ada','belum dapat','tidak dapat','belum diberikan','tidak diberikan')) return 'BONUS_REQUEST';
  if (promoWord) return 'BONUS_INFO';

  // Bonus knowledge and bonus claim are deliberately separated. Asking about
  // schedule/amount/types must be answered from approved promo knowledge and must NOT
  // open a staff ticket. A real claim / missing-bonus request is routed to Telegram.
  if (t.includes('bonus')) {
    // Preserve the established dedicated harian workflow for compatibility. Weekly
    // promotion information is handled separately below.
    if (t.includes('harian')) return 'BONUS_DAILY';
    const bonusClaim = any('claim','minta bonus','ambil bonus','mau bonus','bonus belum','bonus tidak masuk','bonus belum masuk','claimkan','klaimkan');
    if (bonusClaim) {
      return 'BONUS_REQUEST';
    }
    if (any('apa','berapa','kapan','jadwal','hari','minggu','mingguan','cashback','rollingan','turnover','event','promo','syarat','ketentuan')) return 'BONUS_INFO';
    return 'BONUS_REQUEST';
  }

  // Standalone/high-risk transaction words: still confirm through staff, not free-form AI.
  if (/^(?:withdraw|penarikan)(?:\s|$)/.test(t) || t==='withdraw') return 'WITHDRAW_PROBLEM';
  if (/^(?:deposit)(?:\s|$)/.test(t) || t==='deposit') return 'DEPOSIT_PROBLEM';

  // Generic operational error after the specific checks above.
  if (any('error','gangguan','tidak bisa','gagal') && !t.includes('bonus')) return 'GENERAL_DISTURBANCE';

  // Loss/rungkad is the semantic intent even when the member is angry or uses profanity.
  // Example: "kalah terus anjing, depo tiap hari" is a loss complaint, not a deposit case
  // and not merely ABUSIVE. Explicit DP/WD transaction failures have already returned above.
  if (
    t.includes('kalah') || t.includes('rungkad') || t.includes('rugi') || t.includes('boncos') ||
    t.includes('kalah terus') || t.includes('tidak pernah menang') || t.includes('ga pernah menang') ||
    t.includes('gak pernah menang') || t.includes('nggak pernah menang') || t.includes('enggak pernah menang') ||
    t.includes('ga ada gacor') || t.includes('gak ada gacor') || t.includes('nggak ada gacor') ||
    t.includes('enggak ada gacor') || t.includes('tidak ada gacor') || t.includes('ga pernah gacor') ||
    t.includes('gak pernah gacor') || t.includes('ga pernah jp') || t.includes('gak pernah jp') ||
    t.includes('ga dikasih skater') || t.includes('gak dikasih skater') ||
    t.includes('ga dikasih scatter') || t.includes('gak dikasih scatter') ||
    t.includes('tidak dikasih scatter') || t.includes('tidak dapat scatter')
  ) return 'LOSS_COMPLAINT';
  if (/(kontol|goblok|bodoh|bangsat|anjing|babi|tolol|kampret|sialan)/i.test(t)) return 'ABUSIVE';
  if (t.includes('kecewa') || t.includes('parah') || t.includes('rusak') || t.includes('marah') || t.includes('komplain')) return 'COMPLAINT';
  if (
    /^(?:halo|hallo|hi|hai|p|test|tes)\b/.test(t) ||
    /^selamat\s+(?:pagi|siang|sore|malam)\b/.test(t) ||
    /^(?:pagi|siang|sore|malam)\s+(?:bos|boss|bosku|kak|min|admin)\b/.test(t)
  ) return 'GREETING';
  return 'GENERAL';
}
