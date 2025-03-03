import 'dotenv/config';
import mongoose from 'mongoose';

import socketService from './services/socket';
import server from './app';
import Logger from './utils/logger';

async function start() {
    await mongoose.connect(process.env.DATABASE_URL as string);
    Logger.info('Connected to MongoDB');

    await socketService.init(mongoose.connection);
    Logger.info('Socket service initialized');

    const port = process.env.PORT || 8080;
    server.listen(port, () => {
        Logger.info(`Server running on port ${port}`);
    });
}

start().catch(error => {
    Logger.error(error);
});
