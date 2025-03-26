import winston from 'winston';
import path from 'path';
import os from 'os';
import fs from 'fs';

const { createLogger, format, transports } = winston;
const { combine, timestamp, printf, colorize } = format;

const logFormat = printf(({ level, message, timestamp, label }) => {
  return `${timestamp} ${level} [${label}] ${message}`;
});

const defaultLogDir = path.join(os.homedir(), '.drakon-node', 'logs');

export class Logger {
  constructor(label = 'app') {
    this.logger = createLogger({
      level: 'info',
      format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        format.label({ label }),
        logFormat
      ),
      transports: [
        new transports.Console({
          format: combine(
            colorize(),
            timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            format.label({ label }),
            logFormat
          )
        })
      ]
    });

    // Aggiungi i file transport solo se la directory esiste
    try {
      if (!fs.existsSync(defaultLogDir)) {
        fs.mkdirSync(defaultLogDir, { recursive: true });
      }

      this.logger.add(
        new transports.File({
          filename: path.join(defaultLogDir, 'error.log'),
          level: 'error'
        })
      );

      this.logger.add(
        new transports.File({
          filename: path.join(defaultLogDir, 'combined.log')
        })
      );
    } catch (error) {
      console.warn('Non è stato possibile creare i file di log:', error.message);
    }
  }

  info(message) {
    this.logger.info(message);
  }

  error(message, error) {
    const errorMessage = error ? `${message}: ${error.message}` : message;
    this.logger.error(errorMessage);
  }

  warn(message) {
    this.logger.warn(message);
  }

  debug(message) {
    this.logger.debug(message);
  }
}
