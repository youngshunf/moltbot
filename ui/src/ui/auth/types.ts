/**
 * SaaS 认证相关类型定义
 */

/** 发送验证码请求参数 */
export interface SendCodeParams {
  phone: string;
}

/** 发送验证码响应 */
export interface SendCodeResponse {
  success: boolean;
  message: string;
}

/** 手机号登录请求参数 */
export interface PhoneLoginParams {
  phone: string;
  code: string;
}

/** 用户信息 */
export interface UserInfo {
  uuid: string;
  username: string;
  nickname: string;
  phone: string | null;
  email: string | null;
  avatar: string | null;
  is_new_user: boolean;
}

/** 手机号登录响应 */
export interface PhoneLoginResponse {
  access_token: string;
  access_token_expire_time: string;
  refresh_token: string;
  refresh_token_expire_time: string;
  llm_token: string;
  /** Gateway 认证 Token */
  gateway_token: string;
  is_new_user: boolean;
  user: UserInfo;
}

/** Gateway Token 创建请求参数 */
export interface CreateGatewayTokenParams {
  openclaw_config?: Record<string, unknown>;
}

/** Gateway Token 响应 */
export interface GatewayTokenResponse {
  gateway_token: string;
  user_id: number;
  status: string;
}

/** API 响应包装 */
export interface ApiResponse<T> {
  code: number;
  msg: string;
  data: T;
}

/** 认证存储数据 */
export interface AuthStorageData {
  /** JWT 访问令牌 */
  accessToken: string;
  /** 访问令牌过期时间 */
  accessTokenExpireTime: string;
  /** 刷新令牌 */
  refreshToken: string;
  /** 刷新令牌过期时间 */
  refreshTokenExpireTime: string;
  /** LLM API Token */
  llmToken: string;
  /** Gateway Token */
  gatewayToken: string;
  /** 用户信息 */
  user: UserInfo;
}

/** 登录步骤 */
export type LoginStep = "phone" | "code" | "loading";

/** 登录状态 */
export interface LoginState {
  step: LoginStep;
  phone: string;
  code: string;
  error: string | null;
  countdown: number;
}
