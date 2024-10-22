import redis from "redis";
import { logger } from "./logger.js";

export class RedisStore {
  constructor(options = {}) {
    this.client = redis.createClient();
    this.client.connect().catch(logger.error);
  }

  async get(key) {
    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (err) {
      logger.error("Error getting key from Redis:", err);
      return null;
    }
  }

  async set(key, value) {
    try {
      await this.client.set(key, JSON.stringify(value));
    } catch (err) {
      logger.error("Error setting key in Redis:", err);
    }
  }

  async del(key) {
    try {
      await this.client.del(key);
    } catch (err) {
      logger.error("Error deleting key from Redis:", err);
    }
  }
}
