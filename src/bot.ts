import 'dotenv/config';
import { Telegraf, Context, session} from 'telegraf';
import { Message } from 'telegraf/types';
import OpenAI from 'openai';
import LocalSession from 'telegraf-session-local';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

console.log("Скрипт запущен");

// Инициализация OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const telegramToken = process.env.TELEGRAM_BOT_TOKEN as string;


// Лимит сообщений от одного пользователя
const messageLimit = 5;
const adminUsers = process.env.ADMIN_USERS!.split(',').map(Number); // исключения для лимитов


// Изменяем структуру сообщений
interface ChatMessage {
    role: "user" | "assistant" | "system";
    content: string;
}


// Определяем интерфейсы
interface SessionData {
    messages: ChatMessage[];
    messageData: Record<number, { count: number; lastReset: number; }>;
  }

 // Расширяем стандартный контекст Telegraf
interface MyContext extends Context {
    session: SessionData; // Используем расширение поля session
  }

const bot = new Telegraf<MyContext>(telegramToken);

// Используем LocalSession для управления сессиями
const localSession = new LocalSession({ database: 'sessions.json' });
bot.use(localSession.middleware());



bot.start((ctx: MyContext) => {
    // Инициализируем сессию
    ctx.session.messages = []; // Инициализируем историю сообщений
    ctx.session.messageData = {}; // Инициализируем данные о сообщениях
    ctx.reply('Привет! Я бот, использующий ChatGPT. Напишите мне что-нибудь.');
  });


  // Получаем имя текущего файла
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


// Функция для получения изображения по URL и преобразования его в base64
async function saveImage(imageUrl: string): Promise<string | null> {

    const imagePath = path.join(__dirname, 'tempImage.jpg');
  
    try {
       // Указываем, что ожидаем массив байтов
       const response = await axios.get<ArrayBuffer>(imageUrl, {
        responseType: 'arraybuffer' // Указываем формат данных
    });

    
    const imageData = Buffer.from(response.data); // Прямое использование Buffer

    // Сохраняем изображение в файл
    fs.writeFileSync(imagePath, imageData);
    return imagePath; // Возвращаем путь к изображению
    
    } catch (error) {
      console.error("Ошибка при загрузке изображения:", error);
      return null;
    }
  }

  // Функция для проверки лимита сообщений
function checkUserLimit(userId: number, sessionData?: { count: number; lastReset: number; }): { count: number; lastReset: number; } | null {
    if (!sessionData) {
      sessionData = {
        count: 0,
        lastReset: Date.now(),
      };
    }
  
    if (Date.now() - sessionData.lastReset >= 86400000) {
      sessionData.count = 0;
      sessionData.lastReset = Date.now();
    }
  
    if (!adminUsers.includes(userId) && sessionData.count >= messageLimit) {
      return null;
    }
  
    sessionData.count++;
    return sessionData;
  }

 


// Проверка на текстовые сообщения
function isTextMessage(message: Message): message is Message & { text: string } {
    return message && 'text' in message;
}

// Проверка на фото сообщения
function isPhotoMessage(message: Message): message is Message & { photo: Array<{ file_id: string }>, caption?: string } {
    return message && 'photo' in message;
}



bot.on('message', async (ctx: MyContext) => {
    const message = ctx.message;

     // Проверяем, существует ли сообщение
     if (!message) {
        return ctx.reply("Сообщение отсутствует.");
    }
  
    const userId = ctx.from?.id!;
    const userData = checkUserLimit(userId, ctx.session.messageData?.[userId]);
  
    if (!ctx.session.messageData) ctx.session.messageData = {};
    ctx.session.messageData[userId] = userData!;
  
    if (userData === null) {
      return ctx.reply("Вы достигли лимита сообщений за день. Пожалуйста, попробуйте позже.");
    }
  
    // Проверяем, содержит ли сообщение текст
    if (isTextMessage(message)) {

       
      const userMessage: string = message.text;
      ctx.session.messages.push({ role: 'user', content: userMessage });
      await handleOpenAIResponse(ctx);
    } 
    // Проверяем, содержит ли сообщение фото
    else if (isPhotoMessage(message)) {

        console.log("запускаю отапрвку изображения")
      const userMessage = message.caption || "Что на изображении?";
      ctx.session.messages.push({ role: 'user', content: userMessage });
  
      const photo = message.photo;
      const fileId = photo[photo.length - 1].file_id; // Получаем ID самого большого фото
      const fileLink = await ctx.telegram.getFileLink(fileId);
  
      ctx.reply('Вы отправили фото!');
      await handleOpenAIResponseImg(ctx, fileLink.href, userMessage);
    } 
    // Если ни текст, ни фото
    else {
      ctx.reply("Пожалуйста, отправьте текст или фото.");
    }
  });





// Функция для обработки ответа текстового сообщения от OpenAI
async function handleOpenAIResponse(ctx: MyContext) {
    try {
         
      // Подготовка сообщений с проверкой на наличие значения content
      const preparedMessages = ctx.session.messages.map(msg => ({
        role: msg.role,
        content: msg.content ?? "Нет содержимого" // Устанавливаем значение по умолчанию, если content равен null
        }));
    
        
        // Удаление сообщений с content равным null
        const validMessages = preparedMessages.filter(msg => msg.content !== null && msg.content !== "");

        // Проверка, есть ли валидные сообщения
        if (validMessages.length === 0) {
            ctx.reply("Нет сообщений для отправки.");
            return;
        }


      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: validMessages,
      });
  
      const botMessage = response.choices[0].message ;

      ctx.session.messages.push({ role: 'assistant', content: botMessage.content || "Нет ответа от GPT" });
      ctx.reply(botMessage.content || "Нет ответа от GPT");

    } catch (error) {
      console.error("Ошибка при запросе к OpenAI:", error);
      ctx.reply("Ошибка при получении ответа.");
    }
  }

// Функция для обработки ответа картинки сообщения от OpenAI
async function handleOpenAIResponseImg(ctx: MyContext, ImgHref: string, userMessage: string) {
    const imagePath = await saveImage(ImgHref);


    if (imagePath) {
      const base64Image = fs.readFileSync(imagePath, "base64"); 
  
      try {
        const response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{
            role: "user",
            content: [
              { type: "text", text: userMessage },
              { type: "image_url", image_url: { url: `data:image/jpg;base64,${base64Image}` } },
            ],
          }],
        });
  
        if (response) {
          const botMessage = response.choices[0].message;
          ctx.reply(botMessage.content || "Не удалось получить ответ.");
          ctx.session.messages.push({ role: 'assistant', content: botMessage.content || "Не удалось получить ответ." });
        } else {
          ctx.reply("Не удалось получить ответ от OpenAI.");
        }
      } catch (error) {
        console.error("Ошибка при отправке изображения в OpenAI:", error);
        ctx.reply("Не удалось обработать изображение через OpenAI.");
      }
    } else {
      ctx.reply("Не удалось обработать изображение.");
    }
  }




bot.launch();
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));