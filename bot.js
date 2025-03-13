import 'dotenv/config';
import { Telegraf } from 'telegraf';
import OpenAI from 'openai';
import LocalSession from 'telegraf-session-local';
import axios from 'axios';
import fs from "fs";
import path from 'path'
import { fileURLToPath } from 'url';

// Инициализация OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const telegramToken = process.env.TELEGRAM_BOT_TOKEN;

const bot = new Telegraf(telegramToken);

// Используем LocalSession для управления сессиями
const localSession = new LocalSession({ database: 'sessions.json' });
bot.use(localSession.middleware());

bot.start((ctx) => {
  ctx.reply('Привет! Я бот, использующий ChatGPT. Напишите мне что-нибудь.');
  ctx.session.messages = []; // Инициализируем историю сообщений
});

// Получаем имя текущего файла
const __filename = fileURLToPath(import.meta.url);
// Получаем путь к директории текущего файла
const __dirname = path.dirname(__filename);


// Функция для получения изображения по URL и преобразования его в base64
async function saveImage(imageUrl) {
  const imagePath = path.join(__dirname, 'tempImage.jpg');

  try {
      const response = await axios.get(imageUrl, {
          responseType: 'arraybuffer' // Получаем данные в виде ArrayBuffer
      });

      // Сохраняем изображение на диск
      fs.writeFileSync(imagePath, response.data);

      return imagePath

      
  } catch (error) {
      console.error("Ошибка при загрузке изображения:", error);
      return null; // Возвращаем null в случае ошибки
  }
}



bot.start((ctx) => {
    ctx.reply('Привет! Я бот, использующий ChatGPT. Напишите мне что-нибудь или отправьте картинку.');
    ctx.session.messages = []; // Инициализируем историю сообщений
});

// Обработка текстовых сообщений
bot.on('text', async (ctx) => {
    if (!ctx.session.messages) ctx.session.messages = [];

    const userMessage = ctx.message.text;
    ctx.session.messages.push({ role: 'user', content: userMessage });
    console.log("Текстовое сообщение пользователя:", userMessage);

    // Обращение к OpenAI API
    await handleOpenAIResponse(ctx);
});

// Обработка фото
bot.on('photo', async (ctx) => {
    const photo = ctx.message.photo;
    const userMessage = ctx.message.caption;
    ctx.session.messages.push({ role: 'user', content: userMessage });

    const fileId = photo[photo.length - 1].file_id; // Получаем файл с наибольшим качеством

    const fileLink = await ctx.telegram.getFileLink(fileId);
    console.log("Ссылка на изображение:", fileLink.href);
    
    ctx.reply('Вы отправили фото!');

    try {
      const imagePath = await saveImage(fileLink.href);

      // Преобразуем данные в base64
      const base64Image = fs.readFileSync(imagePath, "base64");

      if (base64Image) {
        try {
          const response = await openai.chat.completions.create({
              model: "gpt-4o-mini", // Убедитесь, что используете правильную модель
              messages: [{
                role: "user",
                content: [
                    { type: "text", text: userMessage },
                    {
                        type: "image_url",
                        image_url: {
                            url: `data:image/jpg;base64,${base64Image}`,
                        },
                    },
                ],
              }],
          });

          // Обработка ответа от OpenAI
          if (response) {
              console.log("Ответ от OpenAI:", response); // Логируем ответ от OpenAI
              const botMessage = response.choices[0].message;
              ctx.reply(botMessage.content || "Не удалось получить ответ.");
              ctx.session.messages.push({ role: 'assistant', content: botMessage.content });

          } else {
              ctx.reply("Не удалось получить ответ от OpenAI.");
          }
      } catch (error) {
          console.error("Ошибка при отправке изображения в OpenAI:", error);
          ctx.reply("Не удалось обработать изображение через OpenAI.");
      }



      }
     
    } catch (error) {
        console.error("Ошибка при обработке изображения:", error);
        ctx.reply("Не удалось обработать изображение.");
    }
});

// Функция для обработки ответа от OpenAI
async function handleOpenAIResponse(ctx) {
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini", // Или "gpt-3.5-turbo", в зависимости от ваших потребностей
            messages: ctx.session.messages,
        });

        console.log("Ответ от OpenAI на текстовое сообщение:", response); // Логируем ответ
        
        const botMessage = response.choices[0].message;
        ctx.session.messages.push({ role: 'assistant', content: botMessage.content });
        ctx.reply(botMessage.content);
    } catch (error) {
        console.error("Ошибка при запросе к OpenAI:", error);
        ctx.reply("Ошибка при получении ответа.");
    }
}

bot.launch();
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));