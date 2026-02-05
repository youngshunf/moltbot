/**
 * SaaS 登录页面组件
 *
 * 使用中文界面，支持手机号 + 验证码登录
 */

import { html, nothing } from "lit";
import { icons } from "../icons";
import type { LoginState } from "../auth/types";

export type LoginViewProps = {
  state: LoginState;
  onPhoneChange: (phone: string) => void;
  onCodeChange: (code: string) => void;
  onSendCode: () => void;
  onSubmit: () => void;
  onBack: () => void;
};

/**
 * 验证手机号格式
 */
function isValidPhone(phone: string): boolean {
  return /^1[3-9]\d{9}$/.test(phone);
}

/**
 * 验证验证码格式
 */
function isValidCode(code: string): boolean {
  return /^\d{4,6}$/.test(code);
}

/**
 * 渲染登录页面
 */
export function renderLoginView(props: LoginViewProps) {
  const { state, onPhoneChange, onCodeChange, onSendCode, onSubmit, onBack } = props;
  const { step, phone, code, error, countdown } = state;

  const isLoading = step === "loading";
  const phoneValid = isValidPhone(phone);
  const codeValid = isValidCode(code);

  return html`
    <div class="login-container">
      <div class="login-card">
        <!-- Logo 和标题 -->
        <div class="login-header">
          <div class="login-logo">
            ${icons.bot}
          </div>
          <h1 class="login-title">欢迎使用 OpenClaw</h1>
          <p class="login-subtitle">
            ${step === "phone" ? "请输入手机号登录或注册" : "请输入验证码完成登录"}
          </p>
        </div>

        <!-- 错误提示 -->
        ${error ? html`
          <div class="login-error">
            ${icons.alertCircle}
            <span>${error}</span>
          </div>
        ` : nothing}

        <!-- 表单 -->
        <form class="login-form" @submit=${(e: Event) => {
          e.preventDefault();
          if (step === "phone" && phoneValid) {
            onSendCode();
          } else if (step === "code" && codeValid) {
            onSubmit();
          }
        }}>
          ${step === "phone" ? html`
            <!-- 手机号输入 -->
            <div class="login-field">
              <label class="login-label" for="phone">手机号</label>
              <div class="login-input-wrapper">
                <span class="login-input-prefix">+86</span>
                <input
                  id="phone"
                  type="tel"
                  class="login-input"
                  placeholder="请输入手机号"
                  maxlength="11"
                  .value=${phone}
                  ?disabled=${isLoading}
                  @input=${(e: Event) => {
                    const input = e.target as HTMLInputElement;
                    const value = input.value.replace(/\D/g, "");
                    onPhoneChange(value);
                  }}
                  autofocus
                />
              </div>
            </div>

            <button
              type="submit"
              class="login-button"
              ?disabled=${!phoneValid || isLoading}
            >
              ${isLoading ? html`${icons.loader} 发送中...` : "获取验证码"}
            </button>
          ` : html`
            <!-- 返回按钮 -->
            <button
              type="button"
              class="login-back"
              @click=${onBack}
              ?disabled=${isLoading}
            >
              ${icons.chevronLeft} 返回修改手机号
            </button>

            <!-- 显示手机号 -->
            <div class="login-phone-display">
              验证码已发送至 <strong>+86 ${phone}</strong>
            </div>

            <!-- 验证码输入 -->
            <div class="login-field">
              <label class="login-label" for="code">验证码</label>
              <div class="login-code-wrapper">
                <input
                  id="code"
                  type="text"
                  inputmode="numeric"
                  class="login-input login-code-input"
                  placeholder="请输入验证码"
                  maxlength="6"
                  .value=${code}
                  ?disabled=${isLoading}
                  @input=${(e: Event) => {
                    const input = e.target as HTMLInputElement;
                    const value = input.value.replace(/\D/g, "");
                    onCodeChange(value);
                  }}
                  autofocus
                />
                <button
                  type="button"
                  class="login-resend"
                  ?disabled=${countdown > 0 || isLoading}
                  @click=${onSendCode}
                >
                  ${countdown > 0 ? `${countdown}秒后重发` : "重新发送"}
                </button>
              </div>
            </div>

            <button
              type="submit"
              class="login-button"
              ?disabled=${!codeValid || isLoading}
            >
              ${isLoading ? html`${icons.loader} 登录中...` : "登录"}
            </button>
          `}
        </form>

        <!-- 底部提示 -->
        <div class="login-footer">
          <p class="login-hint">
            登录即表示您同意我们的服务条款和隐私政策
          </p>
          <p class="login-hint">
            新用户将自动注册并获得专属 AI 助手
          </p>
        </div>
      </div>
    </div>
  `;
}

/**
 * 创建登录状态
 */
export function createLoginState(): LoginState {
  return {
    step: "phone",
    phone: "",
    code: "",
    error: null,
    countdown: 0,
  };
}
