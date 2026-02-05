/**
 * SaaS 认证 API 调用封装
 */

import type {
  ApiResponse,
  SendCodeParams,
  SendCodeResponse,
  PhoneLoginParams,
  PhoneLoginResponse,
} from "./types";
import { getCloudBackendUrl } from "../runtime-config";

/** 获取 API 基础 URL，优先使用运行时配置 */
function getApiBaseUrl(): string {
  const runtimeUrl = getCloudBackendUrl();
  if (runtimeUrl) return runtimeUrl;
  
  // Fallback to environment variable or default
  const envUrl = (import.meta as unknown as { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL;
  return envUrl || "http://localhost:8000";
}

/** API 错误 */
export class ApiError extends Error {
  constructor(
    public code: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * 发起 API 请求
 */
async function request<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string;
  } = {},
): Promise<T> {
  const { method = "GET", body, token } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const baseUrl = getApiBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json() as ApiResponse<T>;

  if (!response.ok || data.code !== 200) {
    throw new ApiError(data.code || response.status, data.msg || "请求失败");
  }

  return data.data;
}

/**
 * 发送验证码
 * @param params 手机号
 * @returns 发送结果
 */
export async function sendVerificationCode(params: SendCodeParams): Promise<SendCodeResponse> {
  return request<SendCodeResponse>("/api/v1/auth/send-code", {
    method: "POST",
    body: params,
  });
}

/**
 * 手机号登录
 * @param params 手机号和验证码
 * @returns 登录结果，包含 JWT Token 和用户信息
 */
export async function phoneLogin(params: PhoneLoginParams): Promise<PhoneLoginResponse> {
  return request<PhoneLoginResponse>("/api/v1/auth/phone-login", {
    method: "POST",
    body: params,
  });
}

/**
 * 完整的登录流程
 * 手机号登录获取 Token，后端直接返回 gateway_token
 * @param phone 手机号
 * @param code 验证码
 * @returns 包含所有 Token 和用户信息的完整认证数据
 */
export async function login(phone: string, code: string) {
  const loginResult = await phoneLogin({ phone, code });

  return {
    accessToken: loginResult.access_token,
    accessTokenExpireTime: loginResult.access_token_expire_time,
    refreshToken: loginResult.refresh_token,
    refreshTokenExpireTime: loginResult.refresh_token_expire_time,
    llmToken: loginResult.llm_token,
    // 使用后端返回的 Gateway Token
    gatewayToken: loginResult.gateway_token,
    user: loginResult.user,
  };
}
