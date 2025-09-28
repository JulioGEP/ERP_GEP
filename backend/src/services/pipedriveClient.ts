import axios from 'axios';
import { env } from '../config/env';

export const pipedriveClient = axios.create({
  baseURL: env.PIPEDRIVE_BASE_URL,
  params: {
    api_token: env.PIPEDRIVE_API_TOKEN
  }
});
