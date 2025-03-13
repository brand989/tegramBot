import 'dotenv/config'; // Импортируем конфигурацию dotenv
import { Telegraf } from 'telegraf';
import axios from 'axios';
import LocalSession from 'telegraf-session-local';

const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const openAiApiKey = process.env.OPENAI_API_KEY;

const bot = new Telegraf(telegramToken);

// Используем LocalSession для управления сессиями
const localSession = new LocalSession({ database: 'sessions.json' });
bot.use(localSession.middleware());

bot.start((ctx) => {
    ctx.reply('Привет! Я бот, использующий ChatGPT. Напишите мне что-нибудь.');
    ctx.session.messages = []; // Инициализируем историю сообщений
});

bot.on('text', async (ctx) => {
    // Убедитесь, что session инициализирована
    if (!ctx.session.messages) ctx.session.messages = [];

    const userMessage = ctx.message.text;

    // Добавляем сообщение пользователя в историю
    ctx.session.messages.push({ role: 'user', content: userMessage });

    console.log("history:", ctx.session.messages);
   

    try {
        const response = await axios.post(
          "https://api.openai.com/v1/chat/completions", // URL для общения с OpenAI
          {
            model: "gpt-3.5-turbo",  // Используем модель "davinci" или "gpt-3.5-turbo"
            messages: ctx.session.messages,
            max_tokens: 150,            // Максимальное количество токенов в ответе
            temperature: 0.7,           // Уровень случайности в ответах
          },
          {
            headers: {
              "Authorization": `Bearer ${openAiApiKey}`,
              "Content-Type": "application/json",
            },
          }
        );
    
    
         if (response.data.choices && response.data.choices.length > 0) {
          const botMessage = response.data.choices[0].message;
          if (botMessage && botMessage.content) {
            console.log("Content of the message from OpenAI:", botMessage.content);
            ctx.session.messages.push({ role: 'assistant', content: botMessage.content });
            ctx.reply(botMessage.content.trim());
          } else {
            throw new Error("Не удалось найти сообщение в ответе.");
          }
        } else {
          throw new Error("Не удалось получить ответ от OpenAI.");
        } 
    
      } catch (error) {
        console.error("Ошибка при запросе к OpenAI:", error);
        return "Ошибка при получении ответа.";  // Возвращаем ошибку, если не удалось получить ответ
      }
    
});

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));