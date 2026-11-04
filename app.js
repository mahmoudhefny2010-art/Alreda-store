// Vercel's Express entry point. The local listener and timers stay in src/server.js.
const express = require('express');
const { createApp } = require('./src/app');
const { readEnvironment } = require('./src/config/environment');

const environment = readEnvironment();
const app = express();
app.disable('x-powered-by');
app.use(createApp({ environment: process.env.VERCEL ? 'production' : environment.NODE_ENV }));
module.exports = app;
