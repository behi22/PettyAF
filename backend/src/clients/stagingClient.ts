import axios, { AxiosError, AxiosInstance } from 'axios';
import { env } from '../config/env';
import { StagingError } from './staging-error';

interface Tokens {
  token: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

/**
 * Client for the Alebex staging platform.
 *
 * Confirmed against staging:
 *  - login/refresh return { success, data: { user, token, refreshToken, expiresIn } }
 *    (the access token field is `token`, not `accessToken`).
 *  - errors are { success: false, error: { message, status } }.
 *  - list endpoints return { items, pagination } NOT wrapped in success/data.
 *  - single-entity writes (e.g. POST /campaigns) return the entity directly.
 */
class StagingClient {
  private http: AxiosInstance;
  private tokens: Tokens | null = null;

  constructor() {
    this.http = axios.create({ baseURL: env.staging.apiUrl, timeout: 60000 });
  }

  async init(): Promise<void> {
    await this.login();
  }

  private async login(): Promise<void> {
    const res = await axios.post(
      `${env.staging.apiUrl}/auth/login`,
      { email: env.staging.email, password: env.staging.password },
      { timeout: 30000 },
    );
    const data = res.data?.data ?? res.data;
    if (!data?.token) throw new Error('staging login returned no token');
    this.tokens = {
      token: data.token,
      refreshToken: data.refreshToken,
      expiresAt: Date.now() + Number(data.expiresIn || 3600) * 1000,
    };
    console.log(`[staging] login ok role=${data.user?.role} expiresIn=${data.expiresIn}s`);
  }

  private async refresh(): Promise<void> {
    if (!this.tokens?.refreshToken) {
      await this.login();
      return;
    }
    try {
      const res = await axios.post(
        `${env.staging.apiUrl}/auth/refresh`,
        { refreshToken: this.tokens.refreshToken },
        { timeout: 30000 },
      );
      const data = res.data?.data ?? res.data;
      if (!data?.token) throw new Error('refresh returned no token');
      this.tokens = {
        token: data.token,
        refreshToken: data.refreshToken ?? this.tokens.refreshToken,
        expiresAt: Date.now() + Number(data.expiresIn || 3600) * 1000,
      };
      console.log('[staging] token refreshed');
    } catch {
      await this.login();
    }
  }

  private async authHeader(): Promise<Record<string, string>> {
    if (!this.tokens) await this.login();
    else if (Date.now() > this.tokens.expiresAt - 60000) await this.refresh();
    return { Authorization: `Bearer ${this.tokens!.token}` };
  }

  private async request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const started = Date.now();
    const fire = async () => {
      const headers = await this.authHeader();
      return this.http.request({ method, url: path, data: body, headers });
    };
    try {
      const res = await fire();
      console.log(`[staging] ${method} ${path} -> ${res.status} (${Date.now() - started}ms)`);
      return unwrap(res.data) as T;
    } catch (e) {
      const err = e as AxiosError;
      if (err.response?.status === 401) {
        await this.refresh();
        const res = await fire();
        console.log(`[staging] ${method} ${path} -> ${res.status} (retry, ${Date.now() - started}ms)`);
        return unwrap(res.data) as T;
      }
      const msg = extractError(err);
      const status = err.response?.status ?? 500;
      console.log(`[staging] ${method} ${path} -> ${status} ${msg} (${Date.now() - started}ms)`);
      throw new StagingError(msg, status);
    }
  }

  // ---- Campaigns ----
  listCampaigns(): Promise<{ items: any[]; pagination?: any }> {
    return this.request('GET', '/campaigns');
  }
  createCampaign(body: unknown): Promise<any> {
    return this.request('POST', '/campaigns', body);
  }
  updateCampaign(id: string, body: unknown): Promise<any> {
    return this.request('PUT', `/campaigns/${id}`, body);
  }
  deleteCampaign(id: string): Promise<any> {
    return this.request('DELETE', `/campaigns/${id}`);
  }

  // ---- Leads ----
  listLeads(query = ''): Promise<{ items: any[]; pagination?: any }> {
    return this.request('GET', `/leads${query}`);
  }
  getLead(id: string): Promise<any> {
    return this.request('GET', `/leads/${id}`);
  }
  createLead(body: unknown): Promise<any> {
    return this.request('POST', '/leads', body);
  }
  patchLead(id: string, body: unknown): Promise<any> {
    return this.request('PATCH', `/leads/${id}`, body);
  }
  testCall(leadId: string, phoneNumber: string): Promise<any> {
    return this.request('POST', '/leads/test-call', { leadId, phoneNumber });
  }
  getLeadActivities(id: string): Promise<any> {
    return this.request('GET', `/activities/lead/${id}`);
  }
}

// Envelope handling: { success, data } -> data; everything else passes through
// (lists are { items, pagination }; entity writes return the entity directly).
function unwrap(body: any): any {
  if (body && typeof body === 'object' && 'success' in body && 'data' in body) return body.data;
  return body;
}

function extractError(err: AxiosError): string {
  const d: any = err.response?.data;
  return (
    (typeof d === 'string' && d) ||
    d?.error?.message ||
    d?.error ||
    d?.message ||
    err.message
  );
}

export { StagingError };
export const staging = new StagingClient();
