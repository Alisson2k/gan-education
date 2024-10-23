import amqp from "amqplib";
import { logger } from "./logger.js";

export default class RabbitMQ {
  constructor() {
    this.connection = null;
    this.channel = null;
  }

  async connect() {
    try {
      this.connection = await amqp.connect(process.env.RABBIT_URL);
      this.channel = await this.connection.createChannel();
      logger.info("RabbitMQ connected successfully");
    } catch (err) {
      logger.error("Error connecting to RabbitMQ:", err);
    }
  }

  async sendToQueue(queue, message) {
    try {
      await this.channel.assertQueue(queue);
      this.channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)));
    } catch (err) {
      console.error("Error sending message to queue:", err);
    }
  }

  async consume(queue, callback) {
    try {
      await this.channel.assertQueue(queue);
      this.channel.consume(queue, (message) => {
        callback(JSON.parse(message.content.toString()));
        this.channel.ack(message);
      });
      logger.info("Consuming messages from queue:", queue);
    } catch (err) {
      console.error("Error consuming messages from queue:", err);
    }
  }

  async close() {
    try {
      await this.channel.close();
      await this.connection.close();
    } catch (err) {
      logger.error("Error closing connection to RabbitMQ:", err);
    }
  }

  async getConsumerCount(queue) {
    try {
      await this.channel.assertQueue(queue);
      const { consumerCount } = await this.channel.checkQueue(queue);
      return consumerCount;
    } catch (err) {
      logger.error("Error checking queue:", err);
      return 0;
    }
  }
}
