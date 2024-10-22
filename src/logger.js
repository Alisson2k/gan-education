import moment from "moment-timezone";
import { inspect } from "util";
import { createLogger, format, transports } from "winston";

export const logger = createLogger({
  level: "info",
  format: format.combine(
    format.errors({ stack: true }),
    format.timestamp({
      format: () => {
        return moment()
          .tz(process.env.TZ || "America/Sao_Paulo")
          .format("YYYY-MM-DDTHH:mm:SSZ");
      },
    }),
    process.env.NODE_ENV === "dev"
      ? format.printf((inf) => {
          const timestamp = moment()
            .tz(process.env.TZ || "America/Sao_Paulo")
            .format("YYYY-MM-DD HH:mm:ss z");
          const { level } = inf;
          const message = inf.message || "";
          const args = inf[Symbol.for("splat")];
          const strArgs = (args || [])
            .map((arg) =>
              inspect(arg, {
                colors: true,
              })
            )
            .join(" ");
          return `[${timestamp}] - [${level}] --> ${message} ${strArgs}`;
        })
      : format.json()
  ),
  transports: [new transports.Console()],
});
