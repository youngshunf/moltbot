/**
 * SaaS Token 存储管理
 *
 * 使用 localStorage 存储认证信息
 */

import type { AuthStorageData, UserInfo } from "./types";

/** 存储键名 */
const STORAGE_KEY = "openclaw_saas_auth";

/**
 * 保存认证数据到 localStorage
 */
export function saveAuthData(data: AuthStorageData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.error("Failed to save auth data:", err);
  }
}

/**
 * 从 localStorage 读取认证数据
 */
export function loadAuthData(): AuthStorageData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthStorageData;
  } catch (err) {
    console.error("Failed to load auth data:", err);
    return null;
  }
}

/**
 * 清除认证数据
 */
export function clearAuthData(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.error("Failed to clear auth data:", err);
  }
}

/**
 * 检查是否已登录
 */
export function isLoggedIn(): boolean {
  const data = loadAuthData();
  if (!data) return false;

  // 检查 Gateway Token 是否存在
  if (!data.gatewayToken) return false;

  // 检查访问令牌是否过期
  try {
    const expireTime = new Date(data.accessTokenExpireTime).getTime();
    if (Date.now() > expireTime) {
      // 访问令牌已过期，检查刷新令牌
      const refreshExpireTime = new Date(data.refreshTokenExpireTime).getTime();
      if (Date.now() > refreshExpireTime) {
        // 刷新令牌也过期了，清除数据
        clearAuthData();
        return false;
      }
      // 刷新令牌未过期，仍然视为已登录（需要刷新 Token）
      return true;
    }
  } catch {
    // 日期解析失败，视为已登录
  }

  return true;
}

/**
 * 获取 Gateway Token
 */
export function getGatewayToken(): string | null {
  const data = loadAuthData();
  return data?.gatewayToken ?? null;
}

/**
 * 获取访问令牌
 */
export function getAccessToken(): string | null {
  const data = loadAuthData();
  return data?.accessToken ?? null;
}

/**
 * 获取刷新令牌
 */
export function getRefreshToken(): string | null {
  const data = loadAuthData();
  return data?.refreshToken ?? null;
}

/**
 * 获取用户信息
 */
export function getUserInfo(): UserInfo | null {
  const data = loadAuthData();
  return data?.user ?? null;
}

/**
 * 更新访问令牌
 */
export function updateAccessToken(accessToken: string, expireTime: string): void {
  const data = loadAuthData();
  if (!data) return;

  data.accessToken = accessToken;
  data.accessTokenExpireTime = expireTime;
  saveAuthData(data);
}

/**
 * 更新 Gateway Token
 */
export function updateGatewayToken(gatewayToken: string): void {
  const data = loadAuthData();
  if (!data) return;

  data.gatewayToken = gatewayToken;
  saveAuthData(data);
}

/**
 * 判断访问令牌是否需要刷新
 * 如果距离过期不足 5 分钟，则需要刷新
 */
export function shouldRefreshAccessToken(): boolean {
  const data = loadAuthData();
  if (!data) return false;

  try {
    const expireTime = new Date(data.accessTokenExpireTime).getTime();
    const fiveMinutes = 5 * 60 * 1000;
    return Date.now() > expireTime - fiveMinutes;
  } catch {
    return false;
  }
}
