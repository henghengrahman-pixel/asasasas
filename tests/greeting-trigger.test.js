import test from 'node:test';
import assert from 'node:assert/strict';
import { isGreetingTriggerMessage, canAutoGreetFromHistory } from '../src/greeting.js';

test('promo LiveChat message triggers greeting even when URLs vary',()=>{
  assert.equal(isGreetingTriggerMessage('Lebih Mudah Menghubungi Kami Via Telegram & Whatsapp Hanya Dengan Klik Link >> https://layanancsomtogel.live | Dapatkan Prediksi Bola Akurat Dengan Klik link >> https://livebolautama.ink'),true);
});

test('normal human agent reply is not an automatic greeting trigger',()=>{
  assert.equal(isGreetingTriggerMessage('Baik bosku, saya bantu cek dulu ya'),false);
});


test('auto greeting allowed only when no prior meaningful conversation exists',()=>{
  assert.equal(canAutoGreetFromHistory([
    {event_id:'promo1',sender_type:'system',text:'promo'}
  ],'promo1'),true);
  assert.equal(canAutoGreetFromHistory([
    {event_id:'old1',sender_type:'customer',text:'xhunter'},
    {event_id:'old2',sender_type:'agent',text:'Silakan ditunggu ya bosku'},
    {event_id:'promo1',sender_type:'system',text:'promo'}
  ],'promo1'),false);
});
