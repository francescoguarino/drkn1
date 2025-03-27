import winston from 'winston';
import path from 'path';
import os from 'os';
import { existsSync, mkdirSync } from 'fs';

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

    this.options = {
      writeToFile: false // Per ora disabilitiamo la scrittura su file
    };

    // Aggiungi i file transport solo se la directory esiste
    try {
      if (!existsSync(defaultLogDir)) {
        mkdirSync(defaultLogDir, { recursive: true });
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

  error(message, ...args) {
    const logEntry = this._formatLogEntry('error', message, args);

    // Se args[0] è un Error, stampa anche lo stack
    if (args.length > 0 && args[0] instanceof Error) {
      console.error(logEntry, args[0].stack);
    } else {
      console.error(logEntry);
    }

    // Scrivi nel file se abilitato
    if (this.options.writeToFile) {
      this._writeToFile(logEntry);
    }
  }

  warn(message) {
    this.logger.warn(message);
  }

  debug(message) {
    this.logger.debug(message);
  }

  _formatLogEntry(level, message, args) {
    // Formatta il messaggio
    let formattedMessage = message;

    // Se ci sono argomenti, prova a formattarli
    if (args && args.length > 0) {
      if (args[0] instanceof Error) {
        formattedMessage = `${message}: ${args[0].message}`;
      } else {
        try {
          const formattedArgs = args
            .map(arg => {
              if (typeof arg === 'object') {
                return JSON.stringify(arg);
              }
              return String(arg);
            })
            .join(' ');
          formattedMessage = `${message} ${formattedArgs}`;
        } catch (e) {
          formattedMessage = `${message} [Errore nella formattazione degli argomenti: ${e.message}]`;
        }
      }
    }

    return formattedMessage;
  }

  // Funzione per scrivere il log su file
  _writeToFile(message) {
    // Questa funzione è uno stub e non fa niente
    // perché abbiamo disabilitato la scrittura su file
  }
}
