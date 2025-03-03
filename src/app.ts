import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import http from 'http';

import apiRoutes from './routes';
import { errorHandler } from './middlewares/error';
import Logger from './utils/logger';

const app = express();

app.use(cors({ origin: ['http://localhost:3000', process.env.UI_BASE_URL as string] }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan('dev', { stream: { write: (message: string) => Logger.http(message.trim()) } }));

app.use('/', apiRoutes);

app.use(errorHandler);

export default http.createServer(app);
