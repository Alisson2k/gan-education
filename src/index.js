import dotenv from "dotenv";
dotenv.config();

import express from "express";
import OpenAI from "openai";
import { RedisStore as MemoryStore } from "./redis-store.js";
// import MemoryStore from "./store.js";
import { sendMessage, setWebhook } from "./whatsapp.js";
import {
  DEFAULT_ERROR_MESSAGE,
  INITIAL_MESSAGE,
  MESSAGE_CREATION_SCRIPT,
  MESSAGE_INFO_COLLECTION,
  WAIT_MESSAGE,
} from "./messages.js";
import { logger } from "./logger.js";
import RabbitMQ from "./rabbitmq.js";

const app = express();
app.use(express.json());

const port = process.env.PORT || 3000;
const users = new MemoryStore();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const rabbit = new RabbitMQ();
rabbit.connect();

let assistenteInterpretador = null;

app.listen(port, () => {
  logger.info(`Servidor rodando em http://localhost:${port}`);
});

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.post("/message", (req, res) => {
  processMessages(req.body).forEach((message) => {
    logger.info(`Arrived message from ${message.phone}: ${message.content}`);
    run(message.phone, message.content);
  });

  res.json({ status: 200 });
});

function processMessages(body) {
  if (
    !body.entry ||
    !body.entry[0] ||
    !body.entry[0].changes ||
    !body.entry[0].changes[0] ||
    !body.entry[0].changes[0].value ||
    !body.entry[0].changes[0].value.messages
  ) {
    return [];
  }

  return body.entry[0].changes[0].value.messages.map((message) => {
    return {
      phone: message.from,
      content: message.text?.body || "",
    };
  });
}

async function run(phone, message) {
  try {
    const shouldProccess = await mountUser(phone);
    if (!shouldProccess) {
      sendMessage(phone, WAIT_MESSAGE);
      return;
    }

    let user = await users.get(phone);
    users.set(phone, { ...user, executing: true });
    rabbit.sendToQueue(`gan-queue-${phone}`, { phone, message });
  } catch (error) {}
}

async function mountUser(phone) {
  const user = await users.get(phone);
  logger.info("User:", user);

  if (!user) {
    users.set(phone, { phone, step: 1, executing: true });
  } else if (user.executing) {
    return false;
  }

  const queueName = `gan-queue-${phone}`;
  const consumerCount = await rabbit.getConsumerCount(queueName);

  if (consumerCount === 0) {
    rabbit.consume(queueName, receiveMessage);
  }

  return true;
}

async function firstInteraction(user, message) {
  let thread = user.thread || (await openai.beta.threads.create()).id;
  users.set(user.phone, { ...user, thread });

  await openai.beta.threads.messages.create(thread, {
    role: "user",
    content: message,
  });

  let run = await openai.beta.threads.runs.createAndPoll(thread, {
    assistant_id: assistenteInterpretador.id,
  });

  if (run.status === "completed") {
    const messages = await openai.beta.threads.messages.list(run.thread_id);
    const subject = messages.data[0].content[0].text.value;
    const match = subject.match(/.*Assunto:\s*\"(.*?)\"$/);

    logger.info("Resposta:", subject);
    if (match) {
      users.set(user.phone, { subject: match[1], phone: user.phone, step: 2 });
    } else {
      // TODO adicionar confirmação do assunto
      sendMessage(user.phone, subject);
    }
  } else {
    sendMessage(user.phone, DEFAULT_ERROR_MESSAGE);
  }

  user = await users.get(user.phone);
}

async function subjectIteration(user, message) {
  if (!user.assistant) {
    const assistant = await mountInfoCollectionAssistant(user);
    let thread = user.thread
      ? user.thread
      : (await openai.beta.threads.create()).id;

    users.set(user.phone, { ...user, thread, assistant: assistant.id });
    user = await users.get(user.phone);

    await openai.beta.threads.messages.create(thread, {
      role: "user",
      content: INITIAL_MESSAGE,
    });
  } else {
    await openai.beta.threads.messages.create(user.thread, {
      role: "user",
      content: message,
    });
  }

  let run = await openai.beta.threads.runs.createAndPoll(user.thread, {
    assistant_id: user.assistant,
  });

  if (run.status === "completed") {
    const messages = await openai.beta.threads.messages.list(run.thread_id);
    const message = messages.data[0].content[0].text.value;
    const match = message.match(/.*FINISHED\s*(.*)/);

    logger.info("Resposta:", message);

    if (match) {
      users.set(user.phone, {
        subject: user.subject,
        summary: match[1],
        phone: user.phone,
        assistant: user.assistant,
        step: 3,
      });
    } else {
      sendMessage(user.phone, message);
    }
  } else {
    sendMessage(user.phone, DEFAULT_ERROR_MESSAGE);
  }

  user = await users.get(user.phone);
}

async function scriptIteration(user) {
  if (user.assistant) {
    logger.info("Deletando assistente", user.assistant);
    await openai.beta.assistants.del(user.assistant);
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: MESSAGE_CREATION_SCRIPT,
      },
      {
        role: "user",
        content: `Assunto: "${user.subject}". ${user.summary}`,
      },
    ],
  });

  const script = completion.choices[0].message.content;
  logger.info("Resposta da completion:", script);

  users.set(user.phone, {
    script,
    subject: user.subject,
    phone: user.phone,
    step: 4,
  });
  user = await users.get(user.phone);
}

async function mainIteration(user, message) {
  if (!user.assistant) {
    const assistant = await mountMainAssistant(user);
    let thread = user.thread
      ? user.thread
      : (await openai.beta.threads.create()).id;

    users.set(user.phone, { ...user, thread, assistant: assistant.id });
    user = await users.get(user.phone);

    const firstMessage = user.script.replace("{{subject}}", user.subject);

    await openai.beta.threads.messages.create(thread, {
      role: "user",
      content: firstMessage,
    });
  } else {
    await openai.beta.threads.messages.create(user.thread, {
      role: "user",
      content: message,
    });
  }

  let run = await openai.beta.threads.runs.createAndPoll(user.thread, {
    assistant_id: user.assistant,
    max_completion_tokens: 1024,
  });

  if (run.status === "completed") {
    // TODO split into multiple messages, cause has a limit of 4096 characters
    const messages = await openai.beta.threads.messages.list(run.thread_id);
    sendMessage(user.phone, messages.data[0].content[0].text.value);
  } else {
    sendMessage(user.phone, DEFAULT_ERROR_MESSAGE);
  }

  user = await users.get(user.phone);
}

async function mountInfoCollectionAssistant(user) {
  return await openai.beta.assistants.create({
    name:
      `Assistente Coleta de Informações - ${user.phone} - ${user.subject}`.slice(
        0,
        249
      ) + "...",
    instructions: MESSAGE_INFO_COLLECTION.replace("{{subject}}", user.subject),
    model: "gpt-4o",
    temperature: 1,
    top_p: 1,
  });
}

async function mountMainAssistant(user) {
  return await openai.beta.assistants.create({
    name: `Assistente Professor - ${user.phone} - ${Math.random()
      .toString(36)
      .substring(2, 12)}`,
    instructions: user.script,
    model: "gpt-4o",
    temperature: 1,
    top_p: 1,
  });
}

async function initAssistants() {
  const assistants = await openai.beta.assistants.list();

  assistants.data.forEach((assistant) => {
    if (assistant.name === "Assistente Interpretador") {
      assistenteInterpretador = assistant;
    }
  });
}

function init() {
  initAssistants();
  initWebhook();
}

const receiveMessage = async (body) => {
  const phone = body.phone;
  const message = body.message;

  logger.info("Received message:", body);

  try {
    let user = await users.get(phone);

    if (user.step === 1) {
      await firstInteraction(user, message);
    }

    user = await users.get(phone);

    if (user.step === 2) {
      await subjectIteration(user, message);
    }

    user = await users.get(phone);

    if (user.step === 3) {
      await scriptIteration(user);
    }

    user = await users.get(phone);

    if (user.step === 4) {
      await mainIteration(user, message);
    }

    user = await users.get(phone);
  } catch (error) {
    logger.error("Error:", error);
  } finally {
    let user = await users.get(phone);

    if (user) {
      users.set(phone, { ...user, executing: false });
    }
  }
};

init();

async function initWebhook() {
  setWebhook(process.env.WEBHOOK_URL);
}
