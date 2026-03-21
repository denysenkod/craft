import type IForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';
import webpack from 'webpack';
import dotenv from 'dotenv';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ForkTsCheckerWebpackPlugin: typeof IForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

// Load .env file from project root
const env = dotenv.config();

export const plugins = [
  new ForkTsCheckerWebpackPlugin({
    logger: 'webpack-infrastructure',
  }),
  new webpack.DefinePlugin({
    'process.env.GOOGLE_CLIENT_ID': JSON.stringify(env.parsed?.GOOGLE_CLIENT_ID || ''),
    'process.env.GOOGLE_CLIENT_SECRET': JSON.stringify(env.parsed?.GOOGLE_CLIENT_SECRET || ''),
    'process.env.LINEAR_CLIENT_ID': JSON.stringify(env.parsed?.LINEAR_CLIENT_ID || ''),
    'process.env.LINEAR_CLIENT_SECRET': JSON.stringify(env.parsed?.LINEAR_CLIENT_SECRET || ''),
    'process.env.ANTHROPIC_API_KEY': JSON.stringify(env.parsed?.ANTHROPIC_API_KEY || ''),
    'process.env.ANTHROPIC_CHAT_MODEL': JSON.stringify(env.parsed?.ANTHROPIC_CHAT_MODEL || 'claude-sonnet-4-20250514'),
  }),
];
