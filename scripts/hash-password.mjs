import {hashPassword} from '../src/auth.js'; const p=process.argv[2]; if(!p){console.error('Usage: node scripts/hash-password.mjs \"strong-password\"');process.exit(1)} console.log(hashPassword(p));
