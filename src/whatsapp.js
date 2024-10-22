import axios from "axios";
import { logger } from "./logger.js";

export const sendMessage = (phone, message) => {
  logger.info("Sending message to", phone, ":", message);

  axios
    .post(
      process.env.API_BASE_URL + process.env.API_SEND_MESSAGE_PATH,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: phone,
        type: "text",
        text: {
          body: message,
        },
      },
      {
        headers: { "D360-API-KEY": process.env.API_KEY },
      }
    )
    .then((response) => {
      logger.info("Message sent successfully:", response.data);
    })
    .catch((error) => {
      logger.error("Error sending message:", error);
    });
};

export const setWebhook = (url) => {
  axios
    .post(
      process.env.API_BASE_URL + process.env.API_WEBHOOK_PATH,
      { url: url },
      {
        headers: { "D360-API-KEY": process.env.API_KEY },
      }
    )
    .then((response) => {
      logger.info("Webhook set successfully:", response.data);
    })
    .catch((error) => {
      logger.error("Error setting webhook:", error);
    });
};
