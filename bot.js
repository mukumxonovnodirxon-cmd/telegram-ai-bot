require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

// --- Konfiguratsiya ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

// Oddiy suhbat uchun model
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
// Internet rejimi uchun (Groq'ning o'zida web-qidiruv bo'lgan tizim modeli)
const GROQ_COMPOUND_MODEL = process.env.GROQ_COMPOUND_MODEL || 'groq/compound';
// Rasmni tushuntirish (vision) uchun model
const GROQ_VISION_MODEL = process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';
// Matnni ovozga o'girish (TTS) uchun model va ovoz
const GROQ_TTS_MODEL = process.env.GROQ_TTS_MODEL || 'canopylabs/orpheus-v1-english';
const GROQ_TTS_VOICE = process.env.GROQ_TTS_VOICE || 'autumn'; // autumn, diana, hannah, austin, daniel, troy

if (!TELEGRAM_TOKEN || !GROQ_API_KEY) {
    console.error('XATOLIK: .env faylida TELEGRAM_BOT_TOKEN va GROQ_API_KEY ni to\'ldiring.');
    process.exit(1);
}

// --- Bot yaratish ---
// Render.com kabi bepul HTTP-hostinglarda ishlashi uchun "webhook" rejimi ishlatiladi
// (doimiy "polling" o'rniga). Render o'zi PORT muhit o'zgaruvchisini beradi,
// RENDER_EXTERNAL_URL esa ilovaning ochiq (public) manzilini beradi.
const PORT = process.env.PORT || 3000;
const PUBLIC_URL = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL;

let bot;

if (PUBLIC_URL) {
    // --- Webhook rejimi (Render, Railway va h.k. uchun) ---
    bot = new TelegramBot(TELEGRAM_TOKEN, { webHook: { port: PORT } });
    const webhookPath = `/bot${TELEGRAM_TOKEN}`;
    bot.setWebHook(`${PUBLIC_URL}${webhookPath}`)
        .then(() => console.log(`Webhook o'rnatildi: ${PUBLIC_URL}${webhookPath}`))
        .catch((err) => console.error('Webhook o\'rnatishda xatolik:', err.message));
} else {
    // --- Polling rejimi (lokal kompyuterda sinash uchun) ---
    bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
}

// Groq'ga chat completion so'rovi yuboradigan yordamchi funksiya
async function callGroqChat(model, messages, maxTokens) {
    const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${GROQ_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            messages,
            temperature: 0.7,
            max_tokens: maxTokens || 1024,
        }),
    });

    if (!response.ok) {
        const errText = await response.text();
        const err = new Error(`Groq xatoligi: ${response.status} ${errText}`);
        err.status = response.status;
        throw err;
    }

    const data = await response.json();
    const choice = data.choices && data.choices[0];
    const content = choice && choice.message && choice.message.content;
    return content || null;
}

// Har bir foydalanuvchi uchun suhbat tarixini saqlash (oddiy xotira, RAM'da)
const userHistory = new Map();
const MAX_HISTORY = 10;

// --- Rate limiting: har foydalanuvchi 1.5 soniyada bir marta so'rov yubora oladi ---
const lastRequestTime = new Map();
const RATE_LIMIT_MS = 1500;

function isRateLimited(chatId) {
    const now = Date.now();
    const last = lastRequestTime.get(chatId) || 0;
    if (now - last < RATE_LIMIT_MS) return true;
    lastRequestTime.set(chatId, now);
    return false;
}

// --- Internetdan qidirish rejimi: har foydalanuvchi o'zi yoqib/o'chiradi ---
const internetModeUsers = new Set();

function isInternetMode(chatId) {
    return internetModeUsers.has(chatId);
}

const SYSTEM_PROMPT = `Sen foydali, samimiy va qisqa-lo'nda javob beradigan AI yordamchisan.
Foydalanuvchilarga o'zbek tilida (agar ular boshqa tilda yozmasa) javob ber.`;

function getHistory(chatId) {
    if (!userHistory.has(chatId)) {
        userHistory.set(chatId, []);
    }
    return userHistory.get(chatId);
}

function addToHistory(chatId, role, content) {
    const history = getHistory(chatId);
    history.push({ role, content });
    while (history.length > MAX_HISTORY) {
        history.shift();
    }
}

// --- Buyruqlar ---

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    userHistory.delete(chatId);
    bot.sendMessage(
        chatId,
        `Salom, ${msg.from.first_name || 'foydalanuvchi'}! 👋\n\n` +
        `Men Groq AI asosida ishlaydigan yordamchiman:\n` +
        `💬 Savol yozing — javob beraman (matn + ovoz)\n` +
        `🖼 Rasm yuboring — sizga tasvirlab beraman\n` +
        `🌐 Internetdan ma'lumot olishni yoqishingiz mumkin (/internet)\n\n` +
        `Buyruqlar:\n` +
        `/start - botni qayta ishga tushirish\n` +
        `/help - yordam\n` +
        `/internet - internetdan qidirishni yoqish/o'chirish\n` +
        `/clear - suhbat tarixini tozalash`
    );
});

bot.onText(/\/help/, (msg) => {
    bot.sendMessage(
        msg.chat.id,
        `Botdan foydalanish juda oddiy:\n` +
        `💬 Matn yozing — Groq AI orqali javob beraman, javobni ovozli xabar sifatida ham yuboraman\n` +
        `🖼 Rasm yuboring (izoh bilan yoki bo'lmasa ham) — rasmda nima borligini tushuntirib beraman\n` +
        `🌐 /internet buyrug'i bilan internetdan qidirish rejimini yoqsangiz, bot real vaqtdagi ma'lumotlarni (yangiliklar, narxlar va h.k.) qidirib topadi\n\n` +
        `Buyruqlar:\n` +
        `/start - botni qayta ishga tushirish\n` +
        `/help - bu yordam xabari\n` +
        `/internet - internetdan qidirishni yoqish/o'chirish\n` +
        `/clear - suhbat tarixini tozalash (AI eski xabarlarni unutadi)`
    );
});

bot.onText(/\/internet/, (msg) => {
    const chatId = msg.chat.id;
    if (isInternetMode(chatId)) {
        internetModeUsers.delete(chatId);
        bot.sendMessage(chatId, '🌐 Internetdan qidirish o\'chirildi. Endi oddiy AI rejimida javob beraman.');
    } else {
        internetModeUsers.add(chatId);
        bot.sendMessage(chatId, '🌐 Internetdan qidirish yoqildi! Endi savollaringizga hozirgi ma\'lumotlar (yangiliklar, narxlar va h.k.) asosida javob beraman.\n\nO\'chirish uchun yana /internet deb yozing.');
    }
});

bot.onText(/\/clear/, (msg) => {
    const chatId = msg.chat.id;
    userHistory.delete(chatId);
    bot.sendMessage(chatId, 'Suhbat tarixi tozalandi. ✅');
});

// --- Matnli xabarlarga javob ---

bot.on('message', async(msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Buyruqlarni va boshqa turdagi xabarlarni o'tkazib yuborish
    if (!text || text.startsWith('/')) return;

    if (isRateLimited(chatId)) {
        await bot.sendMessage(chatId, '⏳ Biroz sekinroq, iltimos. Bir necha soniyadan keyin qaytadan yozing.');
        return;
    }

    bot.sendChatAction(chatId, 'typing');

    try {
        addToHistory(chatId, 'user', text);

        // Internet rejimi yoqilgan bo'lsa, Groq'ning o'z ichidagi web-qidiruvli
        // tizim modelidan (groq/compound) foydalanamiz
        const model = isInternetMode(chatId) ? GROQ_COMPOUND_MODEL : GROQ_MODEL;

        const reply = await callGroqChat(
            model, [
                { role: 'system', content: SYSTEM_PROMPT },
                ...getHistory(chatId),
            ],
            1024
        ) || 'Kechirasiz, javob ola olmadim.';

        addToHistory(chatId, 'assistant', reply);

        await sendLongMessage(chatId, reply);
        await sendVoiceReply(chatId, reply);
    } catch (err) {
        await handleApiError(chatId, err);
    }
});

// --- Rasmlarni AI orqali tasvirlash (Vision) — botning yagona rasm funksiyasi ---

bot.on('photo', async(msg) => {
    const chatId = msg.chat.id;

    if (isRateLimited(chatId)) {
        await bot.sendMessage(chatId, '⏳ Biroz sekinroq, iltimos.');
        return;
    }

    bot.sendChatAction(chatId, 'typing');

    try {
        // Eng yuqori sifatdagi versiyasini olamiz (massivning oxirgisi)
        const photo = msg.photo[msg.photo.length - 1];
        const fileLink = await bot.getFileLink(photo.file_id);

        // Foydalanuvchi rasmga izoh yozgan bo'lishi mumkin (caption)
        const userQuestion = msg.caption && msg.caption.trim() ?
            msg.caption.trim() :
            "Bu rasmda nima ko'rinib turibdi? Batafsil tasvirlab ber.";

        const reply = await callGroqChat(GROQ_VISION_MODEL, [{
            role: 'user',
            content: [
                { type: 'text', text: userQuestion },
                { type: 'image_url', image_url: { url: fileLink } },
            ],
        }, ], 1024) || 'Kechirasiz, rasmni tahlil qila olmadim.';

        await sendLongMessage(chatId, reply);
        await sendVoiceReply(chatId, reply);
    } catch (err) {
        await handleApiError(chatId, err);
    }
});

// --- Yordamchi funksiyalar ---

// Telegram xabarlari 4096 belgidan oshmasligi kerak — uzun javoblarni bo'lib yuboramiz
async function sendLongMessage(chatId, text) {
    const CHUNK_SIZE = 4000;
    if (text.length <= CHUNK_SIZE) {
        await bot.sendMessage(chatId, text);
        return;
    }
    for (let i = 0; i < text.length; i += CHUNK_SIZE) {
        await bot.sendMessage(chatId, text.slice(i, i + CHUNK_SIZE));
    }
}

// Matnni Orpheus TTS uchun 200 belgidan oshmaydigan bo'laklarga bo'lish
// (gap chegaralaridan bo'lib, so'zni yarmida kesmaslikka harakat qiladi)
function splitTextForTTS(text, maxLen = 190) {
    const sentences = text.match(/[^.!?\n]+[.!?\n]*/g) || [text];
    const chunks = [];
    let current = '';

    for (const sentence of sentences) {
        const trimmed = sentence.trim();
        if (!trimmed) continue;

        if ((current + ' ' + trimmed).trim().length <= maxLen) {
            current = (current + ' ' + trimmed).trim();
        } else {
            if (current) chunks.push(current);
            if (trimmed.length <= maxLen) {
                current = trimmed;
            } else {
                // Juda uzun gapni to'g'ridan-to'g'ri belgi bo'yicha bo'lamiz
                for (let i = 0; i < trimmed.length; i += maxLen) {
                    chunks.push(trimmed.slice(i, i + maxLen));
                }
                current = '';
            }
        }
    }
    if (current) chunks.push(current);

    return chunks;
}

// Groq Orpheus TTS orqali matndan ovoz (wav) yaratish
async function synthesizeSpeech(text, voice) {
    const response = await fetch(`${GROQ_BASE_URL}/audio/speech`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${GROQ_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: GROQ_TTS_MODEL,
            input: text,
            voice: voice || GROQ_TTS_VOICE,
            response_format: 'wav',
        }),
    });

    if (!response.ok) {
        const errText = await response.text();
        const err = new Error(`Groq TTS xatoligi: ${response.status} ${errText}`);
        err.status = response.status;
        throw err;
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

// AI javobini ovozli xabar(lar) sifatida yuborish.
// TTS ishlamay qolsa ham, botning matnli javobi allaqachon yuborilgan bo'ladi,
// shu sabab bu yerdagi xatolik faqat konsolga yoziladi, foydalanuvchini bezovta qilmaydi.
async function sendVoiceReply(chatId, text) {
    try {
        const chunks = splitTextForTTS(text);
        for (const chunk of chunks) {
            bot.sendChatAction(chatId, 'record_voice');
            const audioBuffer = await synthesizeSpeech(chunk);
            await bot.sendVoice(chatId, audioBuffer, {}, { filename: 'voice.wav', contentType: 'audio/wav' });
        }
    } catch (err) {
        console.error('TTS xatoligi:', err.message);
    }
}

// API xatoliklarini foydalanuvchiga tushunarli qilib ko'rsatish
async function handleApiError(chatId, err) {
    console.error('Xatolik:', err.message);

    let userMessage = 'Kechirasiz, xatolik yuz berdi. Birozdan keyin qaytadan urinib ko\'ring. 🙏';

    if (err.status === 429) {
        userMessage = '⏳ Hozir so\'rovlar juda ko\'p. Bir necha soniyadan keyin qaytadan urinib ko\'ring.';
    } else if (err.status === 413) {
        userMessage = '📦 Fayl hajmi juda katta. Kichikroq fayl yuboring.';
    } else if (err.status >= 500) {
        userMessage = '🔧 AI xizmati vaqtincha ishlamayapti. Birozdan keyin qaytadan urinib ko\'ring.';
    }

    try {
        await bot.sendMessage(chatId, userMessage);
    } catch (sendErr) {
        console.error('Xabar yuborishda xatolik:', sendErr.message);
    }
}

// --- Xatoliklarni log qilish ---
bot.on('polling_error', (err) => {
    console.error('Polling xatoligi:', err.message);
});

bot.on('webhook_error', (err) => {
    console.error('Webhook xatoligi:', err.message);
});

console.log('Bot ishga tushdi (Groq AI)... ✅');