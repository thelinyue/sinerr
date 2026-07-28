/* eslint-disable no-console */
import path from 'path';
import * as winston from 'winston';
import 'winston-daily-rotate-file';

const pad = (n: number) => String(n).padStart(2, '0');

const localTimestamp = () => {
  const now = new Date();
  const off = -now.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const absOff = Math.abs(off);
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${String(now.getMilliseconds()).padStart(3, '0')}${sign}${pad(Math.floor(absOff / 60))}:${pad(absOff % 60)}`;
};

const hformat = winston.format.printf(
  ({ level, label, message, timestamp, ...metadata }) => {
    let msg = `${timestamp} [${level}]${
      label ? `[${label}]` : ''
    }: ${message} `;
    if (Object.keys(metadata).length > 0) {
      msg += JSON.stringify(metadata);
    }
    return msg;
  }
);

const sinerrFileTransport = new winston.transports.DailyRotateFile({
  filename: process.env.CONFIG_DIRECTORY
    ? `${process.env.CONFIG_DIRECTORY}/logs/sinerr-%DATE%.log`
    : path.join(__dirname, '../config/logs/sinerr-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '7d',
  createSymlink: true,
  symlinkName: 'sinerr.log',
});
const machineLogFileTransport = new winston.transports.DailyRotateFile({
  filename: process.env.CONFIG_DIRECTORY
    ? `${process.env.CONFIG_DIRECTORY}/logs/.machinelogs-%DATE%.json`
    : path.join(__dirname, '../config/logs/.machinelogs-%DATE%.json'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '1d',
  createSymlink: true,
  symlinkName: '.machinelogs.json',
  format: winston.format.combine(
    winston.format.splat(),
    winston.format.timestamp({ format: localTimestamp }),
    winston.format.json()
  ),
});

sinerrFileTransport.on('error', (err) => {
  console.error('Error in sinerr file transport:', err);
});

machineLogFileTransport.on('error', (err) => {
  console.error('Error in machine log file transport:', err);
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL?.toLowerCase() || 'debug',
  format: winston.format.combine(
    winston.format.splat(),
    winston.format.timestamp({ format: localTimestamp }),
    hformat
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.splat(),
        winston.format.timestamp({ format: localTimestamp }),
        hformat
      ),
    }),
    sinerrFileTransport,
    machineLogFileTransport,
  ],
});

export default logger;
